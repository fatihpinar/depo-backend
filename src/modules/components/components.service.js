// src/modules/components/components.service.js
const pool = require("../../core/db/index");
const repo = require("./components.repository");
const { mapRowToApi } = require("./components.mappers");


const { recordTransitions, makeBatchId } = require("../transitions/transitions.service");
const { ITEM_TYPE, ACTION } = require("../transitions/transitions.constants");

const {
  assertFormatAndKind,
  assertAndConsume,
  ensureChangeAndConsume,
  normalize,
} = require("../../core/barcode/barcode.service");

const STATUS = {
  in_stock: 1,
  used: 2,
  sold: 3,
  pending: 4,
  damaged_lost: 5,
  production: 6,
  screenprint: 7,
};

/* =============== LIST / GET =============== */

exports.list = async (filters) => {
  const rows = await repo.findMany(filters);
  return rows.map(mapRowToApi);             // 👈 fonksiyon artık garanti var
};

exports.getById = async (id) => {
  const r = await repo.findById(id);
  return r ? mapRowToApi(r) : null;
};

/* =============== UPDATE =============== */

exports.update = async (id, payload = {}, actorId = null) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await repo.lockById(client, id);
    if (!before) {
      const e = new Error("NOT_FOUND");
      e.status = 404;
      throw e;
    }

    // 1) in_stock'a geçişte barkod zorunlu
    if (
      payload.status_id !== undefined &&
      Number(payload.status_id) === STATUS.in_stock
    ) {
      const planned =
        payload.barcode !== undefined
          ? normalize(payload.barcode)
          : normalize(before.barcode);
      if (!planned) {
        const e = new Error("BARCODE_REQUIRED_FOR_IN_STOCK");
        e.status = 400;
        e.code = "BARCODE_REQUIRED_FOR_IN_STOCK";
        throw e;
      }
    }

    // 2) Barkod değişimi/çakışma/pool tüketme
    const { nextBarcode, changed } = await ensureChangeAndConsume(client, {
      table: "components",
      id,
      kind: "component",
      incoming: payload.barcode,
      current: before.barcode,
      conflictChecker: async (c, _t, code, _id) => {
        const hits = await repo.barcodesExist(c, [code]);
        return hits.length > 0;
      },
    });

    // 3) En / boy zorunlu + alan hesaplama
    let nextWidth =
      payload.width !== undefined ? payload.width : before.width;
    let nextHeight =
      payload.height !== undefined ? payload.height : before.height;

    // Boş bırakma yasak
    if (
      nextWidth === null ||
      nextWidth === "" ||
      nextHeight === null ||
      nextHeight === ""
    ) {
      const e = new Error("DIMENSIONS_REQUIRED");
      e.status = 400;
      e.code = "DIMENSIONS_REQUIRED";
      e.message = "En ve boy alanları zorunludur.";
      throw e;
    }

    nextWidth = Number(nextWidth);
    nextHeight = Number(nextHeight);

    if (
      !Number.isFinite(nextWidth) ||
      !Number.isFinite(nextHeight) ||
      nextWidth <= 0 ||
      nextHeight <= 0
    ) {
      const e = new Error("DIMENSIONS_INVALID");
      e.status = 400;
      e.code = "DIMENSIONS_INVALID";
      e.message = "En ve boy 0'dan büyük sayısal değerler olmalıdır.";
      throw e;
    }

    const nextArea = nextWidth * nextHeight;

    // 4) Güncellenecek alanları topla
    const fields = {};

    // quantity / unit yok; status vs.
    for (const k of [
      "master_id",
      "status_id",
      "warehouse_id",
      "location_id",
      "notes",
      "invoice_no",
    ]) {
      if (payload[k] !== undefined) fields[k] = payload[k];
    }

    // width / height / area her durumda normalize edilmiş haliyle set ediliyor
    fields.width = nextWidth;
    fields.height = nextHeight;
    fields.area = nextArea;

    if (payload.barcode !== undefined) {
      fields.barcode = nextBarcode;
    }

    // 5) Onay bilgisi
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
      // approved_at repo.updateFields içinde NOW() ile set ediliyor (approved_by gelince)
    }

    // 6) DB update
    const after = await repo.updateFields(client, id, fields);

    // 7) Transitions
    const recs = [];
    const batchId = makeBatchId();
    const UNIT_LABEL = "EA"; // her satır 1 adet parça gibi düşünüyoruz

    // statü değişti mi?
    if (
      payload.status_id !== undefined &&
      Number(before.status_id) !== Number(after.status_id)
    ) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: id,
        action: ACTION.STATUS_CHANGE,
        qty_delta: 0,
        unit: UNIT_LABEL,
        from_status_id: before.status_id,
        to_status_id: after.status_id,
      });
    }

    // depo / lokasyon değişti mi?
    const whChanged =
      payload.warehouse_id !== undefined &&
      Number(before.warehouse_id || 0) !== Number(after.warehouse_id || 0);
    const locChanged =
      payload.location_id !== undefined &&
      Number(before.location_id || 0) !== Number(after.location_id || 0);

    if (whChanged || locChanged) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: id,
        action: ACTION.MOVE,
        qty_delta: 0,
        unit: UNIT_LABEL,
        from_warehouse_id: before.warehouse_id || null,
        from_location_id: before.location_id || null,
        to_warehouse_id: after.warehouse_id || null,
        to_location_id: after.location_id || null,
      });
    }

    // barkod değişti mi?
    if (changed) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: id,
        action: ACTION.ATTRIBUTE_CHANGE,
        qty_delta: 0,
        unit: UNIT_LABEL,
        meta: {
          field: "barcode",
          before: before.barcode || null,
          after: nextBarcode || null,
        },
      });
    }

    // fatura no değişti mi?
    if (
      payload.invoice_no !== undefined &&
      String(before.invoice_no || "") !== String(after.invoice_no || "")
    ) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: id,
        action: ACTION.ATTRIBUTE_CHANGE,
        qty_delta: 0,
        unit: UNIT_LABEL,
        meta: {
          field: "invoice_no",
          before: before.invoice_no || null,
          after: after.invoice_no || null,
        },
      });
    }

    if (recs.length) {
      await recordTransitions(client, batchId, recs, { actorId });
    }

    await client.query("COMMIT");
    const full = await repo.findById(id);
    return mapRowToApi(full);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};



/* =============== BULK CREATE =============== */

exports.bulkCreate = async (entries, { actorId } = {}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const prepared = entries.map((e) => {
      const width =
        e.width !== undefined && e.width !== null && e.width !== ""
          ? Number(e.width)
          : null;

      const height =
        e.height !== undefined && e.height !== null && e.height !== ""
          ? Number(e.height)
          : null;

      const area =
        width !== null && height !== null ? width * height : null;

      return {
        master_id: Number(e.master_id),
        barcode: normalize(e.barcode),
        status_id: STATUS.pending,
        warehouse_id: Number(e.warehouse_id),
        location_id: Number(e.location_id),
        width,
        height,
        area,
        invoice_no: e.invoice_no ?? null,
        created_by: actorId || null,
      };
    });

        // 🔴 En / boy zorunlu + pozitif olmalı
    const dimErrors = [];
    prepared.forEach((e, idx) => {
      if (e.width === null || e.height === null) {
        dimErrors.push({
          index: idx,
          field: "width_height",
          message: "En ve boy zorunludur.",
        });
      } else if (
        !Number.isFinite(e.width) ||
        !Number.isFinite(e.height) ||
        e.width <= 0 ||
        e.height <= 0
      ) {
        dimErrors.push({
          index: idx,
          field: "width_height",
          message: "En ve boy 0'dan büyük sayılar olmalıdır.",
        });
      }
    });

    if (dimErrors.length) {
      const err = new Error("VALIDATION_ERROR");
      err.status = 400;
      err.code = "VALIDATION_ERROR";
      err.errors = dimErrors;
      throw err;
    }


    for (const e of prepared) {
      if (e.barcode) assertFormatAndKind(e.barcode, "component");
    }

    const incoming = prepared.map((e) => e.barcode).filter(Boolean);
    if (incoming.length) {
      const exists = await repo.barcodesExist(client, incoming);
      if (exists.length) {
        const err = new Error("BARCODE_CONFLICT");
        err.status = 409;
        err.code = "BARCODE_CONFLICT";
        err.conflicts = exists;
        throw err;
      }
    }

    const rows = await repo.insertMany(client, prepared);

    for (const r of rows) {
      if (!r.barcode) continue;
      await assertAndConsume(client, {
        code: r.barcode,
        kind: "component",
        refTable: "components",
        refId: r.id,
      });
    }

    const UNIT_LABEL = "EA";
    const batchId = makeBatchId();
    const recs = rows.map((r) => ({
      item_type: ITEM_TYPE.COMPONENT,
      item_id: r.id,
      action: ACTION.CREATE,
      qty_delta: 1, // her satır 1 fiziksel parça
      unit: UNIT_LABEL,
      to_status_id: STATUS.pending,
      to_warehouse_id: r.warehouse_id || null,
      to_location_id: r.location_id || null,
    }));

    await recordTransitions(client, batchId, recs, { actorId });

    await client.query("COMMIT");
    return rows.map(mapRowToApi); 
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

exports.exitMany = async (payload, actorId = null) => {
  // 🔹 1) Payload'ı normalize et
  let rows;

  if (Array.isArray(payload)) {
    rows = payload;                 // eski kullanım: exitMany(rows, userId)
  } else if (Array.isArray(payload?.rows)) {
    rows = payload.rows;            // yeni kullanım: exitMany({ rows }, userId)
  } else {
    rows = [];
  }

  if (!rows.length) {
    const e = new Error("EMPTY_ROWS");
    e.status = 400;
    e.code = "EMPTY_ROWS";
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const transitions = [];

    for (const raw of rows) {
      const compId = Number(raw.component_id || 0);
      const target = raw.target === "stock" ? "stock" : "sale"; // default: sale
      const qty = Number(raw.consume_qty || 0);

      if (!compId || !Number.isFinite(qty) || qty <= 0) {
        const e = new Error("INVALID_ROW");
        e.status = 400;
        e.code = "INVALID_ROW";
        e.details = { compId, qty };
        throw e;
      }

      // 🔹 komponenti kilitle
      const c = await repo.lockById(client, compId);
      if (!c) {
        const e = new Error("COMPONENT_NOT_FOUND");
        e.status = 404;
        e.code = "COMPONENT_NOT_FOUND";
        throw e;
      }

      const have = Number(c.area || 0);
      if (!Number.isFinite(have) || have <= 0 || qty > have) {
        const e = new Error("CONSUME_GT_STOCK");
        e.status = 409;
        e.code = "CONSUME_GT_STOCK";
        e.details = { have, qty };
        throw e;
      }

      const left = have - qty; // kalan alan
      const UNIT_LABEL = "m²"; // sende hangi birim mantıklıysa onu yaz

      if (target === "sale") {
        // 🔹 SATIŞ → statü her durumda Satıldı
        const newStatus = STATUS.sold;

        await repo.updateFields(client, c.id, {
          area: left,
          status_id: newStatus,
        });

        // 🔹 TRANSITION: tüketim + statü değişimi
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.CONSUME,      // aksiyon: tüketim
          qty_delta: -qty,
          unit: UNIT_LABEL,
          from_status_id: c.status_id,
          to_status_id: newStatus,      // ⬅ 3 (Satıldı)
          from_warehouse_id: c.warehouse_id || null,
          from_location_id: c.location_id || null,
          to_warehouse_id: c.warehouse_id || null,
          to_location_id: c.location_id || null,
          context_type: "component_exit",
          context_id: null,
          meta: { target: "sale" },
        });
      } else {
        // 🔹 target === "stock" → başka depoya/loc'a çıkış
        const whId = Number(raw.warehouse_id || 0);
        const locId = Number(raw.location_id || 0);
        if (!whId || !locId) {
          const e = new Error("WAREHOUSE_LOCATION_REQUIRED");
          e.status = 400;
          e.code = "WAREHOUSE_LOCATION_REQUIRED";
          throw e;
        }

        const newStatus = STATUS.in_stock;

        await repo.updateFields(client, c.id, {
          area: left,
          status_id: newStatus,
          warehouse_id: whId,
          location_id: locId,
        });

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.MOVE,
          qty_delta: -qty,
          unit: UNIT_LABEL,
          from_status_id: c.status_id,
          to_status_id: newStatus,
          from_warehouse_id: c.warehouse_id || null,
          from_location_id: c.location_id || null,
          to_warehouse_id: whId,
          to_location_id: locId,
          context_type: "component_exit",
          context_id: null,
          meta: { target: "stock" },
        });
      }
    }

    if (transitions.length) {
      const batchId = makeBatchId();
      await recordTransitions(client, batchId, transitions, { actorId });
    }

    await client.query("COMMIT");
    return { processed: rows.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

