// src/modules/components/components.service.js
const pool = require("../../core/db/index");
const repo = require("./components.repository");
const { recordTransitions, makeBatchId } =
  require("../transitions/transitions.service");


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
exports.list = async (filters) => repo.findMany(filters);
exports.getById = async (id) => repo.findById(id);

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

    // master değişebilir → doğru unit için master_id belirle
    const nextMasterId =
      payload.master_id !== undefined ? Number(payload.master_id) : Number(before.master_id);

    const { rows: ms } = await client.query(
      `
      SELECT m.id, su.code AS stock_unit_code
      FROM masters m
      LEFT JOIN stock_units su ON su.id = m.stock_unit_id
      WHERE m.id = $1
      `,
      [nextMasterId]
    );

    // masters.stock_unit_id boşsa (ya da stock_units kaydı yoksa) boş gelir.
    // İstersen default'u "unit" yapabilirsin:
    const stockUnit = (ms[0]?.stock_unit_code || "").toString().trim().toLowerCase();


    // Barkod zorunluluğu (senin kuralın)
    if (payload.status_id !== undefined && Number(payload.status_id) === STATUS.in_stock) {
      const planned =
        payload.barcode !== undefined ? normalize(payload.barcode) : normalize(before.barcode);
      if (!planned) {
        const e = new Error("BARCODE_REQUIRED_FOR_IN_STOCK");
        e.status = 400;
        e.code = "BARCODE_REQUIRED_FOR_IN_STOCK";
        throw e;
      }
    }

    // Barkod değişimi/çakışma/pool tüketme
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

    // Güncellenecek alanları topla (ortak alanlar)
    const fields = {};
    for (const k of ["master_id", "status_id", "warehouse_id", "location_id", "notes", "invoice_no"]) {
      if (payload[k] !== undefined) fields[k] = payload[k];
    }

    if (payload.barcode !== undefined) {
      fields.barcode = nextBarcode;
    }

    // ✅ stock_unit'e göre zorunlu alan + normalize
    const getNumOrNull = (v) =>
      v === undefined || v === null || v === "" ? null : Number(v);

    // hangi değeri baz alacağız? payload varsa onu, yoksa before'u
    const nextWidth  = payload.width  !== undefined ? getNumOrNull(payload.width)  : getNumOrNull(before.width);
    const nextHeight = payload.height !== undefined ? getNumOrNull(payload.height) : getNumOrNull(before.height);
    const nextWeight = payload.weight !== undefined ? getNumOrNull(payload.weight) : getNumOrNull(before.weight);
    const nextLength = payload.length !== undefined ? getNumOrNull(payload.length) : getNumOrNull(before.length);

    if (stockUnit === "area") {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0 || !Number.isFinite(nextHeight) || nextHeight <= 0) {
        const e = new Error("DIMENSIONS_REQUIRED");
        e.status = 400;
        e.code = "DIMENSIONS_REQUIRED";
        e.message = "area biriminde En ve Boy zorunludur (0'dan büyük).";
        throw e;
      }
      fields.width = nextWidth;
      fields.height = nextHeight;
      fields.area = nextWidth * nextHeight;

      // diğer ölçüler temiz
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

      // area alanlarını temiz
      fields.width = null;
      fields.height = null;
      fields.area = null;
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

      // area alanlarını temiz
      fields.width = null;
      fields.height = null;
      fields.area = null;
      fields.weight = null;
    } else if (stockUnit === "unit") {
      // ölçü yok → hepsini temizle (istersen mevcutları koru diyebilirsin)
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

    // Onay bilgisi (senin kuralın)
    let isApproval = false;
    if (payload.status_id !== undefined) {
      const to = Number(payload.status_id);
      const from = Number(before.status_id);
      if (from !== to && to === STATUS.in_stock) isApproval = true;
    }
    if (isApproval && actorId) {
      fields.approved_by = actorId;
      // approved_at repo.updateFields içinde NOW() ile set ediliyor
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

    const masterIds = [...new Set(entries.map(e => Number(e.master_id)).filter(Boolean))];
    const { rows: ms } = await client.query(
      `
      SELECT m.id, su.code AS stock_unit_code
      FROM masters m
      LEFT JOIN stock_units su ON su.id = m.stock_unit_id
      WHERE m.id = ANY($1::int[])
      `,
      [masterIds]
    );

    const masterUnitById = new Map(
      ms.map(x => [Number(x.id), (x.stock_unit_code || "").toString().trim().toLowerCase()])
    );

    const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

    const prepared = entries.map((e, idx) => {
      const master_id = Number(e.master_id);
      const stockUnit = masterUnitById.get(master_id) || "";

      const width  = numOrNull(e.width);
      const height = numOrNull(e.height);
      const weight = numOrNull(e.weight);
      const length = numOrNull(e.length);

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
        invoice_no: e.invoice_no ?? null,
        created_by: actorId || null,
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

    // barkod format/çakışma
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

    // transitions
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
      },
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

// src/modules/components/components.service.js
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
      const qty = Number(raw.consume_qty || 0);                 // sadece sale için anlamlı

      if (!compId) {
        const e = new Error("INVALID_ROW");
        e.status = 400;
        e.code = "INVALID_ROW";
        e.details = { compId };
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
      if (!Number.isFinite(have) || have <= 0) {
        const e = new Error("CONSUME_GT_STOCK");
        e.status = 409;
        e.code = "CONSUME_GT_STOCK";
        e.details = { have, qty };
        throw e;
      }

      const UNIT_LABEL = "EA";

      /* ================== 1) SATIŞ (target === "sale") ================== */
      if (target === "sale") {
        if (!Number.isFinite(qty) || qty <= 0) {
          const e = new Error("INVALID_ROW");
          e.status = 400;
          e.code = "INVALID_ROW";
          e.details = { compId, qty };
          throw e;
        }

        if (qty > have) {
          const e = new Error("CONSUME_GT_STOCK");
          e.status = 409;
          e.code = "CONSUME_GT_STOCK";
          e.details = { have, qty };
          throw e;
        }

        let left = have - qty; // kalan alan

        // 🔹 SATIŞ:
        //  - KISMİ satışta statü DEĞİŞMEZ (ör: in_stock → in_stock)
        //  - TAM satışta statü Satıldı'ya gider
        let newStatus = c.status_id;

        const fullyConsumed = left <= 0;
        if (fullyConsumed) {
          left = 0;
          newStatus = STATUS.sold;
        }

        await repo.updateFields(client, c.id, {
          area: left,
          status_id: newStatus,
        });

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.CONSUME,
          qty_delta: 0,
          unit: UNIT_LABEL,
          from_status_id: c.status_id,
          to_status_id: newStatus,
          from_warehouse_id: c.warehouse_id || null,
          from_location_id: c.location_id || null,
          to_warehouse_id: c.warehouse_id || null,
          to_location_id: c.location_id || null,
          context_type: "component_exit",
          context_id: null,
          meta: {
            target: "sale",
            consumed_area: qty,    
            remaining_area: left,
            fully_consumed: fullyConsumed,
          },
        });
      }

      /* ============ 2) DEPOYA TRANSFER (target === "stock") ============= */
      else {
        // 🔹 Burada artık PARÇALI taşıma YOK.
        //    Her zaman komponentin TÜM alanını yeni depo/lokasyona taşıyoruz.

        const whId = Number(raw.warehouse_id || 0);
        const locId = Number(raw.location_id || 0);
        if (!whId || !locId) {
          const e = new Error("WAREHOUSE_LOCATION_REQUIRED");
          e.status = 400;
          e.code = "WAREHOUSE_LOCATION_REQUIRED";
          throw e;
        }

        const beforeStatus = c.status_id;
        const beforeWh = c.warehouse_id || null;
        const beforeLc = c.location_id || null;

        // Statü değişmiyor, sadece depo/lokasyon değişiyor
        const newStatus = beforeStatus;

        // Komponent kaydını güncelle:
        //  - alan değişmiyor (have)
        //  - yeni depo/lokasyon yazılıyor
        await repo.updateFields(client, c.id, {
          area: have,
          status_id: newStatus,
          warehouse_id: whId,
          location_id: locId,
        });

        // 1) Eski depo/lokasyondan tamamını düş
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.ADJUST,
          qty_delta: 0, // sadece area_sum için çalışıyoruz
          unit: UNIT_LABEL,
          from_status_id: beforeStatus,
          to_status_id: beforeStatus,
          from_warehouse_id: beforeWh,
          from_location_id: beforeLc,
          to_warehouse_id: beforeWh,
          to_location_id: beforeLc,
          context_type: "component_exit",
          context_id: null,
          meta: {
            target: "stock",
            consumed_area: have,  // stock_balances: area_sum -= have
            remaining_area: 0,
            move_full: true,
          },
        });

        // 2) Yeni depo/lokasyona tamamını ekle
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.ADJUST,
          qty_delta: 0,
          unit: UNIT_LABEL,
          from_status_id: newStatus,
          to_status_id: newStatus,
          from_warehouse_id: whId,
          from_location_id: locId,
          to_warehouse_id: whId,
          to_location_id: locId,
          context_type: "component_exit",
          context_id: null,
          meta: {
            target: "stock",
            area: have,          // stock_balances: area_sum += have
            remaining_area: have,
            move_full: true,
          },
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


