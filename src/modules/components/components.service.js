// src/modules/components/components.service.js
const pool = require("../../core/db/index");
const repo = require("./components.repository");
const map = require("./components.mappers").mapRowToApi;

// transitions doğrudan dosyadan
const { recordTransitions, makeBatchId } = require("../transitions/transitions.service");
const { ITEM_TYPE, ACTION } = require("../transitions/transitions.constants");

// barkod servis (barrel yok)
const { assertFormatAndKind, assertAndConsume, ensureChangeAndConsume, normalize } =
  require("../../core/barcode/barcode.service");


const STATUS = { in_stock: 1, used: 2, sold: 3, pending: 4, damaged_lost: 5, production: 6, screenprint: 7 };

/* ======================== LIST / GET ======================== */

exports.list = async (filters) => {
  const rows = await repo.findMany(filters);
  return rows.map(map);
};

exports.getById = async (id) => {
  const r = await repo.findById(id);
  return r ? map(r) : null;
};

/* ======================== UPDATE ======================== */

exports.update = async (id, payload = {}, actorId = null) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await repo.lockById(client, id);
    if (!before) { const e = new Error("NOT_FOUND"); e.status = 404; throw e; }

    // 1) in_stock'a geçişte barkod zorunlu
    if (payload.status_id !== undefined && Number(payload.status_id) === STATUS.in_stock) {
      const planned = payload.barcode !== undefined ? normalize(payload.barcode) : normalize(before.barcode);
      if (!planned) { const e = new Error("BARCODE_REQUIRED_FOR_IN_STOCK"); e.status = 400; e.code = "BARCODE_REQUIRED_FOR_IN_STOCK"; throw e; }
    }

    // 2) Barkod değişimi/çakışma/pool tüketme → TEK KAPI
    const { nextBarcode, changed } = await ensureChangeAndConsume(client, {
      table: "components",
      id,
      kind: "component",
      incoming: payload.barcode,           // undefined ise hiç dokunulmadı sayılır
      current: before.barcode,
      conflictChecker: async (c, _t, code, _id) => {
        const hits = await repo.barcodesExist(c, [code]);
        return hits.length > 0;            // mevcutla zaten farklı olduğu için self hariç kontrol gerekmiyor
      },
    });

    const fields = {};

    for (const k of ["master_id", "quantity", "unit", "status_id", "warehouse_id", "location_id", "notes", "invoice_no"]) {
      if (payload[k] !== undefined) fields[k] = payload[k];
    }
    if (payload.barcode !== undefined) fields.barcode = nextBarcode;

    let isApproval = false;
    if (payload.status_id !== undefined) {
      const to = Number(payload.status_id);
      const from = Number(before.status_id);
      if (from !== to && to === STATUS.in_stock) {
        isApproval = true;
      }
    }
    if (isApproval && actorId) {
      fields.approved_by = actorId;
      // approved_at'i repo.updateFields içinde NOW() olarak setleteceğiz (aşağıda).
    }


    const after = await repo.updateFields(client, id, fields);

    // 4) Transitions
    const recs = [];
    const batchId = makeBatchId();

    if (payload.status_id !== undefined && Number(before.status_id) !== Number(after.status_id)) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT, item_id: id, action: ACTION.STATUS_CHANGE, qty_delta: 0,
        unit: after.unit || before.unit || "EA",
        from_status_id: before.status_id, to_status_id: after.status_id
      });
    }

    const whChanged = payload.warehouse_id !== undefined && Number(before.warehouse_id || 0) !== Number(after.warehouse_id || 0);
    const locChanged = payload.location_id !== undefined && Number(before.location_id || 0) !== Number(after.location_id || 0);
    if (whChanged || locChanged) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT, item_id: id, action: ACTION.MOVE, qty_delta: 0,
        unit: after.unit || before.unit || "EA",
        from_warehouse_id: before.warehouse_id || null, from_location_id: before.location_id || null,
        to_warehouse_id: after.warehouse_id || null, to_location_id: after.location_id || null
      });
    }

    if (payload.quantity !== undefined) {
      const delta = Number(after.quantity || 0) - Number(before.quantity || 0);
      if (delta !== 0) {
        recs.push({
          item_type: ITEM_TYPE.COMPONENT, item_id: id, action: ACTION.ADJUST, qty_delta: delta,
          unit: after.unit || before.unit || "EA", to_status_id: after.status_id
        });
      }
    }

    if (changed) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT, item_id: id, action: ACTION.ATTRIBUTE_CHANGE, qty_delta: 0,
        unit: after.unit || before.unit || "EA",
        meta: { field: "barcode", before: before.barcode || null, after: nextBarcode || null }
      });
    }

    if (payload.invoice_no !== undefined && String(before.invoice_no || "") !== String(after.invoice_no || "")) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT, item_id: id, action: ACTION.ATTRIBUTE_CHANGE, qty_delta: 0,
        unit: after.unit || before.unit || "EA",
        meta: { field: "invoice_no", before: before.invoice_no || null, after: after.invoice_no || null }
      });
    }

    if (recs.length) await recordTransitions(client, batchId, recs, { actorId }); // 👈

    await client.query("COMMIT");
    const full = await repo.findById(id);
    return map(full);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/* ======================== BULK CREATE ======================== */

exports.bulkCreate = async (entries, { actorId } = {}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const prepared = entries.map(e => ({
      master_id: Number(e.master_id),
      barcode: normalize(e.barcode),
      unit: e.unit,
      quantity: e.unit === "EA" ? 1 : Number(e.quantity || 0),
      status_id: STATUS.pending,
      warehouse_id: Number(e.warehouse_id),
      location_id: Number(e.location_id),
      width: e.width ?? null,
      height: e.height ?? null,
      invoice_no: e.invoice_no ?? null,
      created_by: actorId || null,            // 👈
    }));

    for (const e of prepared) if (e.barcode) assertFormatAndKind(e.barcode, "component");

    const incoming = prepared.map(e => e.barcode).filter(Boolean);
    if (incoming.length) {
      const exists = await repo.barcodesExist(client, incoming);
      if (exists.length) {
        const err = new Error("BARCODE_CONFLICT");
        err.status = 409; err.code = "BARCODE_CONFLICT"; err.conflicts = exists;
        throw err;
      }
    }

    const rows = await repo.insertMany(client, prepared); // 👈 repo güncellenecek

    for (const r of rows) {
      if (!r.barcode) continue;
      await assertAndConsume(client, { code: r.barcode, kind: "component", refTable: "components", refId: r.id });
    }

    const batchId = makeBatchId();
    const recs = rows.map(r => ({
      item_type: ITEM_TYPE.COMPONENT,
      item_id: r.id,
      action: ACTION.CREATE,
      qty_delta: r.unit === "EA" ? 1 : Number(r.quantity || 0),
      unit: r.unit || "EA",
      to_status_id: STATUS.pending,
      to_warehouse_id: r.warehouse_id || null,
      to_location_id: r.location_id || null,
    }));
    await recordTransitions(client, makeBatchId(), rows.map(r => ({
      item_type: ITEM_TYPE.COMPONENT,
      item_id: r.id,
      action: ACTION.CREATE,
      qty_delta: r.unit === "EA" ? 1 : Number(r.quantity || 0),
      unit: r.unit || "EA",
      to_status_id: STATUS.pending,
      to_warehouse_id: r.warehouse_id || null,
      to_location_id: r.location_id || null,
    })), { actorId }); // 👈
    await client.query("COMMIT");
    return rows.map(map);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
