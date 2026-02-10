// src/modules/components/components.service.js
const pool = require("../../core/db/index");
const repo = require("./components.repository");
const { mapRowToApi } = require("./components.mappers");
const {
  recordTransitions,
  makeBatchId,
  applyStockBalancesForComponentTransitions,
} = require("../transitions/transitions.service");

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
  return rows.map(mapRowToApi);
};

exports.getById = async (id) => {
  const r = await repo.findById(id);
  return r ? mapRowToApi(r) : null;
};

/* =============== UPDATE =============== */

exports.update = async (id, payload = {}, actorId = null) => {
  const client = await pool.connect();

  const getNumOrNull = (v) =>
    v === undefined || v === null || v === "" ? null : Number(v);

  try {
    await client.query("BEGIN");

    const before = await repo.lockById(client, id);
    if (!before) {
      const e = new Error("NOT_FOUND");
      e.status = 404;
      throw e;
    }

    const nextBoxUnit =
      payload.box_unit !== undefined
        ? getNumOrNull(payload.box_unit)
        : getNumOrNull(before.box_unit);

    const nextMasterId =
      payload.master_id !== undefined
        ? Number(payload.master_id)
        : Number(before.master_id);

    const { rows: ms } = await client.query(
      `SELECT id, stock_unit FROM masters WHERE id = $1`,
      [nextMasterId]
    );
    const stockUnit = (ms[0]?.stock_unit || "").toString().trim().toLowerCase();

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

    const { nextBarcode } = await ensureChangeAndConsume(client, {
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

    const fields = {};
    for (const k of [
      "master_id",
      "status_id",
      "warehouse_id",
      "location_id",
      "notes",
      "invoice_no",
      "supplier_barcode_no",
      "entry_type",
    ]) {
      if (payload[k] !== undefined) fields[k] = payload[k];
    }

    if (payload.supplier_barcode_no !== undefined) {
      fields.supplier_barcode_no =
        payload.supplier_barcode_no === null || payload.supplier_barcode_no === ""
          ? null
          : String(payload.supplier_barcode_no).trim();
    }

    if (payload.entry_type !== undefined) {
      const x = (payload.entry_type ?? "").toString().trim().toLowerCase();
      if (!x) fields.entry_type = null;
      else if (x === "count" || x === "purchase") fields.entry_type = x;
      else {
        const e = new Error("ENTRY_TYPE_INVALID");
        e.status = 400;
        e.code = "ENTRY_TYPE_INVALID";
        e.message = "entry_type geçersiz (count|purchase).";
        throw e;
      }
    }

    if (payload.barcode !== undefined) {
      fields.barcode = nextBarcode;
    }

    const nextWidth =
      payload.width !== undefined ? getNumOrNull(payload.width) : getNumOrNull(before.width);
    const nextHeight =
      payload.height !== undefined ? getNumOrNull(payload.height) : getNumOrNull(before.height);
    const nextWeight =
      payload.weight !== undefined ? getNumOrNull(payload.weight) : getNumOrNull(before.weight);
    const nextLength =
      payload.length !== undefined ? getNumOrNull(payload.length) : getNumOrNull(before.length);
    const nextVolume =
      payload.volume !== undefined ? getNumOrNull(payload.volume) : getNumOrNull(before.volume);

    if (stockUnit === "area") {
      if (
        !Number.isFinite(nextWidth) ||
        nextWidth <= 0 ||
        !Number.isFinite(nextHeight) ||
        nextHeight <= 0
      ) {
        const e = new Error("DIMENSIONS_REQUIRED");
        e.status = 400;
        e.code = "DIMENSIONS_REQUIRED";
        e.message = "area biriminde En ve Boy zorunludur (0'dan büyük).";
        throw e;
      }
      fields.width = nextWidth;
      fields.height = nextHeight;
      fields.area = nextWidth * nextHeight;

      fields.weight = null;
      fields.length = null;
    } else if (stockUnit === "weight") {
      if (!Number.isFinite(nextWeight) || nextWeight <= 0) {
        const e = new Error("WEIGHT_REQUIRED");
        e.status = 400;
        e.code = "WEIGHT_REQUIRED";
        e.message = "weight biriminde Ağırlık zorunludur (0'dan büyük).";
        throw e;
      }
      fields.weight = nextWeight;

      fields.width = null;
      fields.height = null;
      fields.area = null;
      fields.length = null;
    } else if (stockUnit === "box_unit") {
      if (!Number.isFinite(nextBoxUnit) || nextBoxUnit <= 0) {
        const e = new Error("BOX_UNIT_REQUIRED");
        e.status = 400;
        e.code = "BOX_UNIT_REQUIRED";
        e.message = "box_unit biriminde Koli İçi Adet zorunludur (0'dan büyük).";
        throw e;
      }
      fields.box_unit = nextBoxUnit;
    } else if (stockUnit === "volume") {
      if (!Number.isFinite(nextVolume) || nextVolume <= 0) {
        const e = new Error("VOLUME_REQUIRED");
        e.status = 400;
        e.code = "VOLUME_REQUIRED";
        e.message = "volume biriminde Hacim zorunludur (0'dan büyük).";
        throw e;
      }
      fields.volume = nextVolume;

      fields.width = null;
      fields.height = null;
      fields.area = null;
      fields.weight = null;
      fields.length = null;
    } else if (stockUnit === "length") {
      if (!Number.isFinite(nextLength) || nextLength <= 0) {
        const e = new Error("LENGTH_REQUIRED");
        e.status = 400;
        e.code = "LENGTH_REQUIRED";
        e.message = "length biriminde Uzunluk zorunludur (0'dan büyük).";
        throw e;
      }
      fields.length = nextLength;

      fields.width = null;
      fields.height = null;
      fields.area = null;
      fields.weight = null;
    } else if (stockUnit === "unit") {
      fields.width = null;
      fields.height = null;
      fields.area = null;
      fields.weight = null;
      fields.length = null;
    } else {
      const e = new Error("MASTER_STOCK_UNIT_INVALID");
      e.status = 400;
      e.code = "MASTER_STOCK_UNIT_INVALID";
      e.message = `master_id=${nextMasterId} için stock_unit geçersiz/boş: "${stockUnit}"`;
      throw e;
    }

    let isApproval = false;
    if (payload.status_id !== undefined) {
      const to = Number(payload.status_id);
      const from = Number(before.status_id);
      if (from !== to && to === STATUS.in_stock) isApproval = true;
    }
    if (isApproval && actorId) {
      fields.approved_by = actorId;
    }

    await repo.updateFields(client, id, fields);

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

    const masterIds = [...new Set(entries.map((e) => Number(e.master_id)).filter(Boolean))];
    const { rows: ms } = await client.query(
      `SELECT id, stock_unit FROM masters WHERE id = ANY($1)`,
      [masterIds]
    );
    const masterUnitById = new Map(
      ms.map((x) => [Number(x.id), (x.stock_unit || "").toString().trim().toLowerCase()])
    );

    const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

    const prepared = entries.map((e, idx) => {
      const normalizeEntryType = (v) => {
        const x = (v ?? "").toString().trim().toLowerCase();
        if (!x) return null;
        if (x === "count" || x === "purchase") return x;
        const err = new Error("VALIDATION_ERROR");
        err.status = 400;
        err.code = "VALIDATION_ERROR";
        err.errors = [
          { index: idx, field: "entry_type", message: "entry_type geçersiz (count|purchase)." },
        ];
        throw err;
      };

      const master_id = Number(e.master_id);
      const stockUnit = masterUnitById.get(master_id) || "";

      const width = numOrNull(e.width);
      const height = numOrNull(e.height);
      const weight = numOrNull(e.weight);
      const length = numOrNull(e.length);
      const boxUnit = numOrNull(e.box_unit);
      const volume = numOrNull(e.volume);

      let out = {
        master_id,
        barcode: normalize(e.barcode),
        status_id: STATUS.pending,
        warehouse_id: Number(e.warehouse_id),
        location_id: Number(e.location_id),
        width: null,
        height: null,
        area: null,
        weight: null,
        length: null,
        volume: null,
        box_unit: null,
        invoice_no: e.invoice_no ?? null,
        supplier_barcode_no: e.supplier_barcode_no ? String(e.supplier_barcode_no).trim() : null,
        created_by: actorId || null,
        entry_type: normalizeEntryType(e.entry_type),
      };

      if (stockUnit === "area") {
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          const err = new Error("VALIDATION_ERROR");
          err.status = 400;
          err.code = "VALIDATION_ERROR";
          err.errors = [{ index: idx, field: "width_height", message: "area biriminde En ve Boy zorunludur." }];
          throw err;
        }
        out.width = width;
        out.height = height;
        out.area = width * height;
      } else if (stockUnit === "weight") {
        if (!Number.isFinite(weight) || weight <= 0) {
          const err = new Error("VALIDATION_ERROR");
          err.status = 400;
          err.code = "VALIDATION_ERROR";
          err.errors = [{ index: idx, field: "weight", message: "weight biriminde Ağırlık zorunludur." }];
          throw err;
        }
        out.weight = weight;
      } else if (stockUnit === "length") {
        if (!Number.isFinite(length) || length <= 0) {
          const err = new Error("VALIDATION_ERROR");
          err.status = 400;
          err.code = "VALIDATION_ERROR";
          err.errors = [{ index: idx, field: "length", message: "length biriminde Uzunluk zorunludur." }];
          throw err;
        }
        out.length = length;
      } else if (stockUnit === "box_unit") {
        if (!Number.isFinite(boxUnit) || boxUnit <= 0) {
          const err = new Error("VALIDATION_ERROR");
          err.status = 400;
          err.code = "VALIDATION_ERROR";
          err.errors = [{ index: idx, field: "box_unit", message: "box_unit biriminde Koli İçi Adet zorunludur." }];
          throw err;
        }
        out.box_unit = boxUnit;
      } else if (stockUnit === "volume") {
        if (!Number.isFinite(volume) || volume <= 0) {
          const err = new Error("VALIDATION_ERROR");
          err.status = 400;
          err.code = "VALIDATION_ERROR";
          err.errors = [{ index: idx, field: "volume", message: "volume biriminde Hacim zorunludur." }];
          throw err;
        }
        out.volume = volume;
      } else if (stockUnit === "unit") {
        // ölçü yok → hepsi null
      } else {
        const err = new Error("MASTER_STOCK_UNIT_INVALID");
        err.status = 400;
        err.code = "MASTER_STOCK_UNIT_INVALID";
        err.message = `master_id=${master_id} için stock_unit geçersiz/boş: "${stockUnit}"`;
        throw err;
      }

      return out;
    });

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
      qty_delta: 1,
      unit: UNIT_LABEL,
      to_status_id: STATUS.pending,
      to_warehouse_id: r.warehouse_id || null,
      to_location_id: r.location_id || null,
      meta: {
        area: r.area ?? null,
        weight: r.weight ?? null,
        length: r.length ?? null,
        volume: r.volume ?? null,
      },
    }));

    await recordTransitions(client, batchId, recs, { actorId });
    await applyStockBalancesForComponentTransitions(client, recs);

    await client.query("COMMIT");
    return rows.map(mapRowToApi);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * EXIT MANY — DOMAIN B CORRECT (+ MOVE FIX)
 */
exports.exitMany = async (payload, actorId = null) => {
  let rows;

  if (Array.isArray(payload)) rows = payload;
  else if (Array.isArray(payload?.rows)) rows = payload.rows;
  else rows = [];

  if (!rows.length) {
    const e = new Error("EMPTY_ROWS");
    e.status = 400;
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const transitions = [];

    for (const raw of rows) {
      const compId = Number(raw.component_id);
      if (!compId) {
        const e = new Error("INVALID_COMPONENT_ID");
        e.status = 400;
        throw e;
      }

      const mode = raw.mode === "quantity" ? "quantity" : "unit";
      const target = raw.target === "stock" ? "stock" : "sale";
      const qty = Number(raw.consume_qty || 0);

      // 1) Lock + fetch component
      const c = await repo.lockById(client, compId);
      if (!c) {
        const e = new Error("COMPONENT_NOT_FOUND");
        e.status = 404;
        throw e;
      }

      // 2) master.stock_unit (hem MOVE hem CONSUME için lazım)
      const { rows: msRows } = await client.query(
        `SELECT stock_unit FROM masters WHERE id=$1`,
        [c.master_id]
      );
      const stockUnit = (msRows[0]?.stock_unit || "").trim().toLowerCase();

      const numericField =
        stockUnit === "area"     ? "area" :
        stockUnit === "length"   ? "length" :
        stockUnit === "volume"   ? "volume" :
        stockUnit === "weight"   ? "weight" :
        stockUnit === "box_unit" ? "box_unit" :
        null;

      const have = numericField ? Number(c[numericField] || 0) : 1;

      // ✅ MOVE: target=stock ise status DEĞİŞMEZ, sadece depo/lokasyon değişir
      if (target === "stock") {
        // Depo transferi satır bazlıdır; quantity mode kabul etmiyoruz
        if (mode === "quantity") {
          const e = new Error("INVALID_MODE_FOR_STOCK_TARGET");
          e.status = 400;
          e.code = "INVALID_MODE_FOR_STOCK_TARGET";
          e.message = "Depo hedefinde quantity modu desteklenmez. Satır bazlı taşıma yap.";
          throw e;
        }

        const toWarehouseId = Number(raw.warehouse_id || 0);
        const toLocationId = Number(raw.location_id || 0);

        if (!toWarehouseId || !toLocationId) {
          const e = new Error("WAREHOUSE_LOCATION_REQUIRED");
          e.status = 400;
          e.code = "WAREHOUSE_LOCATION_REQUIRED";
          e.message = "Depo hedefinde warehouse_id ve location_id zorunludur.";
          throw e;
        }

        // Aynı yere taşıma → no-op (istersen yine de transition yazdırırsın)
        if (toWarehouseId === Number(c.warehouse_id) && toLocationId === Number(c.location_id)) {
          continue;
        }

        await repo.updateFields(client, compId, {
          warehouse_id: toWarehouseId,
          location_id: toLocationId,
          // status_id dokunma
        });

        // Stock balance doğru güncellensin diye 2 transition:
        // 1) FROM (-1)
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: compId,
          action: ACTION.MOVE,
          qty_delta: -1,
          unit: "EA",

          from_status_id: c.status_id,
          to_status_id: c.status_id,

          from_warehouse_id: c.warehouse_id,
          from_location_id: c.location_id,
          to_warehouse_id: c.warehouse_id,
          to_location_id: c.location_id,

          context_type: "component_move",
          context_id: null,
          meta: numericField === "area"
            ? { target: "stock", mode: "unit", consumed_area: have } // area_sum düşsün
            : { target: "stock", mode: "unit", moved: true },
        });

        // 2) TO (+1)
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: compId,
          action: ACTION.MOVE,
          qty_delta: +1,
          unit: "EA",

          from_status_id: c.status_id,
          to_status_id: c.status_id,

          from_warehouse_id: c.warehouse_id,
          from_location_id: c.location_id,
          to_warehouse_id: toWarehouseId,
          to_location_id: toLocationId,

          context_type: "component_move",
          context_id: null,
          meta: numericField === "area"
            ? { target: "stock", mode: "unit", area: have } // area_sum artsın
            : { target: "stock", mode: "unit", moved: true },
        });

        continue;
      }

      // ========== UNIT EXIT ==========
      if (mode === "unit") {
        const newStatus = target === "sale" ? STATUS.sold : STATUS.used;

        const meta = {
          target,
          unit_type: stockUnit,
          mode: "unit",
          consumed: have,
          remaining: 0,
          fully_consumed: true,
        };

        if (numericField) {
          meta[`consumed_${numericField}`] = have;
          meta[`remaining_${numericField}`] = 0;
          if (numericField === "area") meta.consumed_area = have; // stock_balances için
        } else {
          meta.consumed_unit = 1;
          meta.remaining_unit = 0;
        }

        await repo.updateFields(client, compId, {
          status_id: newStatus,
          ...(numericField ? { [numericField]: 0 } : {}),
        });

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: compId,
          action: ACTION.CONSUME,
          qty_delta: 0,
          unit: "EA",
          from_status_id: c.status_id,
          to_status_id: newStatus,
          from_warehouse_id: c.warehouse_id,
          from_location_id: c.location_id,
          to_warehouse_id: c.warehouse_id,
          to_location_id: c.location_id,
          context_type: "component_exit",
          context_id: null,
          meta,
        });

        continue;
      }

      // ========== QUANTITY EXIT ==========
      if (!numericField) {
        const e = new Error("INVALID_QUANTITY_FOR_UNIT_TYPE");
        e.status = 400;
        throw e;
      }

      if (qty <= 0) {
        const e = new Error("INVALID_CONSUME_QTY");
        e.status = 400;
        throw e;
      }

      if (have <= 0) {
        const e = new Error("NO_STOCK");
        e.status = 409;
        throw e;
      }

      if (qty > have) {
        const e = new Error("CONSUME_GT_STOCK");
        e.status = 409;
        throw e;
      }

      const left = have - qty;
      const fully = left === 0;

      const newStatus = fully ? (target === "sale" ? STATUS.sold : STATUS.used) : c.status_id;

      const meta = {
        target,
        unit_type: stockUnit,
        mode: "quantity",
        consumed: qty,
        remaining: left,
        fully_consumed: fully,
      };

      meta[`consumed_${numericField}`] = qty;
      meta[`remaining_${numericField}`] = left;
      if (numericField === "area") meta.consumed_area = qty; // stock_balances için

      await repo.updateFields(client, compId, {
        status_id: newStatus,
        [numericField]: left,
      });

      transitions.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: compId,
        action: ACTION.CONSUME,
        qty_delta: 0,
        unit: "EA",
        from_status_id: c.status_id,
        to_status_id: newStatus,
        from_warehouse_id: c.warehouse_id,
        from_location_id: c.location_id,
        to_warehouse_id: c.warehouse_id,
        to_location_id: c.location_id,
        context_type: "component_exit",
        context_id: null,
        meta,
      });
    }

    if (transitions.length) {
      const batch = makeBatchId();
      await recordTransitions(client, batch, transitions, { actorId });
      await applyStockBalancesForComponentTransitions(client, transitions);
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
