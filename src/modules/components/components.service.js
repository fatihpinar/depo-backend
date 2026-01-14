// src/modules/components/components.service.js
const pool = require("../../core/db/index");
const repo = require("./components.repository");
const { mapRowToApi } = require("./components.mappers");
const { recordTransitions, makeBatchId, applyStockBalancesForComponentTransitions } =
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

  // ✅ en üste al
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

    // ✅ before geldikten sonra hesapla
    const nextBoxUnit =
      payload.box_unit !== undefined
        ? getNumOrNull(payload.box_unit)
        : getNumOrNull(before.box_unit);

    
    // master değişebilir → doğru unit için master_id belirle
    const nextMasterId =
      payload.master_id !== undefined ? Number(payload.master_id) : Number(before.master_id);

    const { rows: ms } = await client.query(
      `SELECT id, stock_unit FROM masters WHERE id = $1`,
      [nextMasterId]
    );
    const stockUnit = (ms[0]?.stock_unit || "").toString().trim().toLowerCase();

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
    for (const k of ["master_id", "status_id", "warehouse_id", "location_id", "notes", "invoice_no", "supplier_barcode_no", "entry_type",]) {
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

    // ✅ stock_unit'e göre zorunlu alan + normalize
    const getNumOrNull = (v) =>
      v === undefined || v === null || v === "" ? null : Number(v);

    // hangi değeri baz alacağız? payload varsa onu, yoksa before'u
    const nextWidth = payload.width !== undefined ? getNumOrNull(payload.width) : getNumOrNull(before.width);
    const nextHeight = payload.height !== undefined ? getNumOrNull(payload.height) : getNumOrNull(before.height);
    const nextWeight = payload.weight !== undefined ? getNumOrNull(payload.weight) : getNumOrNull(before.weight);
    const nextLength = payload.length !== undefined ? getNumOrNull(payload.length) : getNumOrNull(before.length);
    const nextVolume = payload.volume !== undefined ? getNumOrNull(payload.volume) : getNumOrNull(before.volume);

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
    }
    else if (stockUnit === "box_unit") {
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

      // diğer ölçüler temiz
      fields.width = null;
      fields.height = null;
      fields.area = null;
      fields.weight = null;
      fields.length = null;
    }

    else if (stockUnit === "length") {
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
      `SELECT id, stock_unit FROM masters WHERE id = ANY($1)`,
      [masterIds]
    );
    const masterUnitById = new Map(
      ms.map(x => [Number(x.id), (x.stock_unit || "").toString().trim().toLowerCase()])
    );

    const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v));


    const prepared = entries.map((e, idx) => {
      const normalizeEntryType = (v) => {
        const x = (v ?? "").toString().trim().toLowerCase();
        if (!x) return null;
        if (x === "count" || x === "purchase") return x;
        const e = new Error("VALIDATION_ERROR");
        e.status = 400;
        e.code = "VALIDATION_ERROR";
        e.errors = [{ index: idx, field: "entry_type", message: "entry_type geçersiz (count|purchase)." }];
        throw e;
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
      }
      else if (stockUnit === "box_unit") {
        if (!Number.isFinite(boxUnit) || boxUnit <= 0) {
          const err = new Error("VALIDATION_ERROR");
          err.status = 400;
          err.code = "VALIDATION_ERROR";
          err.errors = [{ index: idx, field: "box_unit", message: "box_unit biriminde Koli İçi Adet zorunludur." }];
          throw err;
        }
        out.box_unit = boxUnit;
        } 
      else if (stockUnit === "volume") {
        if (!Number.isFinite(volume) || volume <= 0) {
          const err = new Error("VALIDATION_ERROR");
          err.status = 400;
          err.code = "VALIDATION_ERROR";
          err.errors = [{ index: idx, field: "volume", message: "volume biriminde Hacim zorunludur." }];
          throw err;
        }
        out.volume = volume;
        } 
      else if (stockUnit === "unit") {
        // ölçü yok → hepsi null
        } 
      else {
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
      const qty = Number(raw.consume_qty || 0);                 // tüketilecek miktar (sale için)

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

      // 🔹 master'ın stok birimini getir
      const { rows: ms } = await client.query(
        `SELECT stock_unit FROM masters WHERE id = $1`,
        [c.master_id]
      );
      const stockUnit = (ms[0]?.stock_unit || "").toString().trim().toLowerCase();

      // 🔹 hangi alanı kullanacağımıza ve mevcut miktara karar ver
      let fieldName = null;
      let have = 0;

      switch (stockUnit) {
        case "area":
          fieldName = "area";
          have = Number(c.area || 0);
          break;
        case "weight":
          fieldName = "weight";
          have = Number(c.weight || 0);
          break;
        case "length":
          fieldName = "length";
          have = Number(c.length || 0);
          break;
        case "volume":
          fieldName = "volume";
          have = Number(c.volume || 0);
          break;
        case "box_unit":
          fieldName = "box_unit";
          have = Number(c.box_unit || 0);
          break;
        case "unit":
          // unit'te her satır 1 adet kabul ediyoruz
          fieldName = null; // numeric alan yok, sadece status ile yönetiyoruz
          have = 1;
          break;
        default:
          {
            const e = new Error("MASTER_STOCK_UNIT_INVALID");
            e.status = 400;
            e.code = "MASTER_STOCK_UNIT_INVALID";
            e.message = `master_id=${c.master_id} için stock_unit geçersiz/boş: "${stockUnit}"`;
            throw e;
          }
      }

      if (!Number.isFinite(have) || have <= 0) {
        const e = new Error("NO_STOCK");
        e.status = 409;
        e.code = "NO_STOCK";
        e.message = "Bu kayıt için kullanılabilecek stok miktarı bulunmuyor.";
        e.details = { stockUnit, have };
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

        // unit biriminde satılacak miktarı 1 ile sınırla (bu satır 1 adeti temsil ediyor)
        if (stockUnit === "unit" && qty !== 1) {
          const e = new Error("UNIT_QTY_INVALID");
          e.status = 400;
          e.code = "UNIT_QTY_INVALID";
          e.message = "unit biriminde tek kayıt üzerinden sadece 1 adet tüketilebilir.";
          e.details = { qty };
          throw e;
        }

        if (qty > have) {
          const e = new Error("CONSUME_GT_STOCK");
          e.status = 409;
          e.code = "CONSUME_GT_STOCK";
          e.details = { have, qty, stockUnit };
          throw e;
        }

        let left = have - qty;

        // 🔹 SATIŞ:
        //  - KISMİ satışta statü DEĞİŞMEZ (ör: in_stock → in_stock)
        //  - TAM satışta statü Satıldı'ya gider
        let newStatus = c.status_id;
        const fullyConsumed = left <= 0;

        if (fullyConsumed) {
          left = 0;
          newStatus = STATUS.sold;
        }

        // güncellenecek alanlar
        const updateFields = { status_id: newStatus };
        if (fieldName) {
          updateFields[fieldName] = left;
        }

        await repo.updateFields(client, c.id, updateFields);

        // 🔹 transition meta'yı birime göre doldur
        const meta = {
          target: "sale",
          unit_type: stockUnit,
          consumed: qty,
          remaining: left,
          fully_consumed: fullyConsumed,
        };

        if (stockUnit === "area") {
          meta.consumed_area = qty;
          meta.remaining_area = left;
        } else if (stockUnit === "weight") {
          meta.consumed_weight = qty;
          meta.remaining_weight = left;
        } else if (stockUnit === "length") {
          meta.consumed_length = qty;
          meta.remaining_length = left;
        } else if (stockUnit === "volume") {
          meta.consumed_volume = qty;
          meta.remaining_volume = left;
        } else if (stockUnit === "box_unit") {
          meta.consumed_box_unit = qty;
          meta.remaining_box_unit = left;
        } else if (stockUnit === "unit") {
          meta.consumed_unit = qty;
          meta.remaining_unit = left;
        }

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.CONSUME,      // tüketim
          qty_delta: 0,                // adet değişmiyor, miktar alanından düşüyoruz
          unit: UNIT_LABEL,
          from_status_id: c.status_id,
          to_status_id: newStatus,
          from_warehouse_id: c.warehouse_id || null,
          from_location_id: c.location_id || null,
          to_warehouse_id: c.warehouse_id || null,
          to_location_id: c.location_id || null,
          context_type: "component_exit",
          context_id: null,
          meta,
        });
      }

      /* ============ 2) DEPOYA TRANSFER (target === "stock") ============= */
      else {
        // 🔹 Burada her zaman komponentin TÜM miktarını yeni depo/lokasyona taşıyoruz.
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
        const updateFields = {
          status_id: newStatus,
          warehouse_id: whId,
          location_id: locId,
        };
        if (fieldName) {
          // miktar aynı kalıyor, sadece lokasyon değişiyor
          updateFields[fieldName] = have;
        }

        await repo.updateFields(client, c.id, updateFields);

        // 🔹 meta hazırlığı (eski lokasyondan çıkar, yeni lokasyona ekle)
        const metaBase = {
          target: "stock",
          unit_type: stockUnit,
          move_full: true,
        };

        const metaFrom = { ...metaBase };
        const metaTo = { ...metaBase };

        if (stockUnit === "area") {
          metaFrom.consumed_area = have;  // eski yerden have kadar düş
          metaFrom.remaining_area = 0;
          metaTo.area = have;             // yeni yerde have kadar ekle
          metaTo.remaining_area = have;
        } else if (stockUnit === "weight") {
          metaFrom.consumed_weight = have;
          metaFrom.remaining_weight = 0;
          metaTo.weight = have;
          metaTo.remaining_weight = have;
        } else if (stockUnit === "length") {
          metaFrom.consumed_length = have;
          metaFrom.remaining_length = 0;
          metaTo.length = have;
          metaTo.remaining_length = have;
        } else if (stockUnit === "volume") {
          metaFrom.consumed_volume = have;
          metaFrom.remaining_volume = 0;
          metaTo.volume = have;
          metaTo.remaining_volume = have;
        } else if (stockUnit === "box_unit") {
          metaFrom.consumed_box_unit = have;
          metaFrom.remaining_box_unit = 0;
          metaTo.box_unit = have;
          metaTo.remaining_box_unit = have;
        } else if (stockUnit === "unit") {
          metaFrom.consumed_unit = have;
          metaFrom.remaining_unit = 0;
          metaTo.unit = have;
          metaTo.remaining_unit = have;
        }

        // 1) Eski depo/lokasyondan tamamını düş
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.ADJUST,
          qty_delta: 0,
          unit: UNIT_LABEL,
          from_status_id: beforeStatus,
          to_status_id: beforeStatus,
          from_warehouse_id: beforeWh,
          from_location_id: beforeLc,
          to_warehouse_id: beforeWh,
          to_location_id: beforeLc,
          context_type: "component_exit",
          context_id: null,
          meta: metaFrom,
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
          meta: metaTo,
        });
      }
    }

    if (transitions.length) {
      const batchId = makeBatchId();
      await recordTransitions(client, batchId, transitions, { actorId });
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



