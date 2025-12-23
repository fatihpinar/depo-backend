// src/modules/components/components.service.js
const pool = require("../../core/db/index");
const repo = require("./components.repository");
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
exports.list = async (filters) => repo.findMany(filters);
exports.getById = async (id) => repo.findById(id);
exports.getByBarcode = async (barcode) => repo.findByBarcodeExact(barcode);
exports.search = async ({ q, limit }) => repo.searchMany({ q, limit });

/* =============== HELPERS =============== */
const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

function requirePositiveInt(v, code, message) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    const e = new Error(code);
    e.status = 400;
    e.code = code;
    e.message = message;
    throw e;
  }
  return n;
}

async function getMasterStockUnitCode(client, masterId) {
  const { rows } = await client.query(
    `
      SELECT COALESCE(su.code, 'unit') AS stock_unit_code
      FROM masters m
      LEFT JOIN stock_units su ON su.id = m.stock_unit_id
      WHERE m.id = $1
      LIMIT 1
    `,
    [Number(masterId)]
  );
  return (rows[0]?.stock_unit_code || "unit").toString().trim().toLowerCase();
}

function getMeasureFieldByUnit(stockUnit) {
  if (stockUnit === "area") return "area";
  if (stockUnit === "weight") return "weight";
  if (stockUnit === "length") return "length";
  if (stockUnit === "unit") return null; // adet
  return null;
}

/* =============== UPDATE (senin mevcut halin OK) =============== */
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

    const nextMasterId =
      payload.master_id !== undefined ? Number(payload.master_id) : Number(before.master_id);

    if (!Number.isFinite(nextMasterId) || nextMasterId <= 0) {
      const e = new Error("MASTER_REQUIRED");
      e.status = 400;
      e.code = "MASTER_REQUIRED";
      e.message = "master_id zorunlu.";
      throw e;
    }

    const stockUnit = await getMasterStockUnitCode(client, nextMasterId);

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

    const { nextBarcode } = await ensureChangeAndConsume(client, {
      table: "components",
      id,
      kind: "component",
      incoming: payload.barcode,
      current: before.barcode,
      conflictChecker: async (c, _t, code) => {
        const hits = await repo.barcodesExist(c, [code]);
        return hits.length > 0;
      },
    });

    const fields = {};

    if (payload.master_id !== undefined) fields.master_id = Number(payload.master_id);
    if (payload.status_id !== undefined) fields.status_id = Number(payload.status_id);
    if (payload.warehouse_id !== undefined) fields.warehouse_id = Number(payload.warehouse_id);
    if (payload.location_id !== undefined) fields.location_id = Number(payload.location_id);

    if (payload.notes !== undefined) fields.notes = payload.notes;
    if (payload.invoice_no !== undefined) fields.invoice_no = payload.invoice_no;

    if (payload.barcode !== undefined) fields.barcode = nextBarcode;

    const nextWidth = payload.width !== undefined ? numOrNull(payload.width) : numOrNull(before.width);
    const nextHeight = payload.height !== undefined ? numOrNull(payload.height) : numOrNull(before.height);
    const nextWeight = payload.weight !== undefined ? numOrNull(payload.weight) : numOrNull(before.weight);
    const nextLength = payload.length !== undefined ? numOrNull(payload.length) : numOrNull(before.length);

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
      fields.approved_by = Number(actorId);
    }

    await repo.updateFields(client, id, fields);

    await client.query("COMMIT");
    return await repo.findById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/* =============== BULK CREATE (senin mevcut halin OK) =============== */
exports.bulkCreate = async (entries, { actorId } = {}) => {
  // (burayı senin attığın haliyle bırakıyorum; sorun exitMany’de)
  // İstersen sonra beraber refine ederiz.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const masterIds = [...new Set(entries.map((e) => Number(e.master_id)).filter(Boolean))];

    const { rows: ms } = await client.query(
      `
      SELECT m.id, COALESCE(su.code, 'unit') AS stock_unit_code
      FROM masters m
      LEFT JOIN stock_units su ON su.id = m.stock_unit_id
      WHERE m.id = ANY($1::int[])
      `,
      [masterIds]
    );

    const masterUnitById = new Map(
      ms.map((x) => [Number(x.id), (x.stock_unit_code || "unit").toString().trim().toLowerCase()])
    );

    const prepared = entries.map((e, idx) => {
      const master_id = requirePositiveInt(e.master_id, "MASTER_REQUIRED", `Satır #${idx + 1}: master_id zorunlu.`);
      const stockUnit = masterUnitById.get(master_id) || "unit";

      const warehouse_id = requirePositiveInt(e.warehouse_id, "WAREHOUSE_REQUIRED", `Satır #${idx + 1}: warehouse_id zorunlu.`);
      const location_id = requirePositiveInt(e.location_id, "LOCATION_REQUIRED", `Satır #${idx + 1}: location_id zorunlu.`);

      const width = numOrNull(e.width);
      const height = numOrNull(e.height);
      const weight = numOrNull(e.weight);
      const length = numOrNull(e.length);

      const out = {
        master_id,
        barcode: normalize(e.barcode),
        status_id: STATUS.pending,
        warehouse_id,
        location_id,
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
        // ölçü yok
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

    const batchId = makeBatchId();
    const recs = rows.map((r) => ({
      item_type: ITEM_TYPE.COMPONENT,
      item_id: r.id,
      action: ACTION.CREATE,
      qty_delta: 1,
      unit: "EA",
      to_status_id: STATUS.pending,
      to_warehouse_id: r.warehouse_id || null,
      to_location_id: r.location_id || null,
      meta: { area: r.area ?? null, weight: r.weight ?? null, length: r.length ?? null },
    }));

    await recordTransitions(client, batchId, recs, { actorId });

    await client.query("COMMIT");
    return await repo.findManyByIds(rows.map((x) => x.id));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/* =============== EXIT MANY (DÜZELTİLMİŞ) =============== */
/**
 * İş kuralın:
 * - Eğer UI "Adet" seçiliyse -> component direkt sold olur (tam satış)
 * - Eğer miktar girdiyse (area/weight/length) -> o kadar düş, eşitse sold yap
 */
exports.exitMany = async (rows, actorId = null) => {
  if (!Array.isArray(rows) || !rows.length) {
    const e = new Error("EMPTY_ROWS");
    e.status = 400;
    e.code = "EMPTY_ROWS";
    e.message = "Boş satır listesi";
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const transitions = [];
    const UNIT_LABEL = "EA";

    for (const raw of rows) {
      const compId = Number(raw.component_id || 0);
      const target = raw.target === "stock" ? "stock" : "sale";

      if (!compId) {
        const e = new Error("INVALID_ROW");
        e.status = 400;
        e.code = "INVALID_ROW";
        e.message = "component_id geçersiz";
        throw e;
      }

      const c = await repo.lockById(client, compId);
      if (!c) {
        const e = new Error("COMPONENT_NOT_FOUND");
        e.status = 404;
        e.code = "COMPONENT_NOT_FOUND";
        e.message = `Component bulunamadı: ${compId}`;
        throw e;
      }

      const stockUnit = await getMasterStockUnitCode(client, c.master_id);
      const measureField = getMeasureFieldByUnit(stockUnit);

      // ============ SALE ============
      if (target === "sale") {
        // UI'de "Adet" seçilince consume_qty gelmez/boş olur.
        const hasQty =
          raw.consume_qty !== undefined &&
          raw.consume_qty !== null &&
          String(raw.consume_qty).trim() !== "";

        // miktar alanı: area/weight/length için hangisi düşecek?
        const stockUnit = await getMasterStockUnitCode(client, c.master_id);
        const measureField =
          stockUnit === "area" ? "area" :
          stockUnit === "weight" ? "weight" :
          stockUnit === "length" ? "length" :
          null;

        // ========= 1) ADET MODU (FULL SALE) =========
        if (!hasQty) {
          // full sale: status sold
          const update = { status_id: STATUS.sold };

          // Eğer ölçülü ürünse (area/weight/length), eldeki miktarı da 0'layalım ki stok/balance tutarlı kalsın
          // (özellikle balances transition meta'sı ölçü üzerinden çalışıyorsa kritik)
          let have = null;
          if (measureField) {
            have = Number(c[measureField] || 0);
            update[measureField] = 0;
          }

          await repo.updateFields(client, c.id, update);

          // transition meta: balances için ölçü bazlı alanları da geç
          const meta = {
            target: "sale",
            mode: "unit",              // UI seçimi
            stock_unit: stockUnit,     // ürünün doğal birimi
            fully_consumed: true,
          };

          if (measureField) {
            // balances logic'in eski anahtarlarıyla uyumlu kalmak için:
            if (measureField === "area") {
              meta.consumed_area = have ?? 0;
              meta.remaining_area = 0;
            } else if (measureField === "weight") {
              meta.consumed_weight = have ?? 0;
              meta.remaining_weight = 0;
            } else if (measureField === "length") {
              meta.consumed_length = have ?? 0;
              meta.remaining_length = 0;
            }
          }

          transitions.push({
            item_type: ITEM_TYPE.COMPONENT,
            item_id: c.id,
            action: ACTION.CONSUME,
            qty_delta: 1,          // "1 adet ürün çıktı" semantiği
            unit: "EA",
            from_status_id: c.status_id,
            to_status_id: STATUS.sold,
            from_warehouse_id: c.warehouse_id || null,
            from_location_id: c.location_id || null,
            to_warehouse_id: c.warehouse_id || null,
            to_location_id: c.location_id || null,
            context_type: "component_exit",
            context_id: null,
            meta,
          });

          continue;
        }

        // ========= 2) MİKTAR MODU (PARTIAL SALE) =========
        // Bu mod sadece area/weight/length için anlamlı.
        if (!measureField) {
          const e = new Error("INVALID_ROW");
          e.status = 400;
          e.code = "INVALID_ROW";
          e.message = "Bu component için miktarlı satış yapılamaz (Adet seçmelisin).";
          e.details = { component_id: c.id, stockUnit };
          throw e;
        }

        const have = Number(c[measureField] || 0);
        const qty = Number(raw.consume_qty || 0);

        if (!Number.isFinite(have) || have <= 0) {
          const e = new Error("CONSUME_GT_STOCK");
          e.status = 409;
          e.code = "CONSUME_GT_STOCK";
          e.message = "Stok yetersiz";
          e.details = { have, qty, stockUnit, measureField, component_id: c.id };
          throw e;
        }

        if (!Number.isFinite(qty) || qty <= 0) {
          const e = new Error("INVALID_ROW");
          e.status = 400;
          e.code = "INVALID_ROW";
          e.message = "consume_qty zorunlu (miktarlı satış)";
          e.details = { have, qty, stockUnit, measureField, component_id: c.id };
          throw e;
        }

        if (qty > have) {
          const e = new Error("CONSUME_GT_STOCK");
          e.status = 409;
          e.code = "CONSUME_GT_STOCK";
          e.message = "Stok yetersiz";
          e.details = { have, qty, stockUnit, measureField, component_id: c.id };
          throw e;
        }

        let left = have - qty;
        const fullyConsumed = left <= 0;

        const upd = {};
        upd[measureField] = fullyConsumed ? 0 : left;
        if (fullyConsumed) upd.status_id = STATUS.sold;

        await repo.updateFields(client, c.id, upd);

        const meta = {
          target: "sale",
          mode: "measure",          // UI seçimi
          stock_unit: stockUnit,
          measure_field: measureField,
          fully_consumed: fullyConsumed,
        };

        if (measureField === "area") {
          meta.consumed_area = qty;
          meta.remaining_area = fullyConsumed ? 0 : left;
        } else if (measureField === "weight") {
          meta.consumed_weight = qty;
          meta.remaining_weight = fullyConsumed ? 0 : left;
        } else if (measureField === "length") {
          meta.consumed_length = qty;
          meta.remaining_length = fullyConsumed ? 0 : left;
        }

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.CONSUME,
          qty_delta: 0, // miktarı meta ile izliyoruz
          unit: "EA",
          from_status_id: c.status_id,
          to_status_id: fullyConsumed ? STATUS.sold : c.status_id,
          from_warehouse_id: c.warehouse_id || null,
          from_location_id: c.location_id || null,
          to_warehouse_id: c.warehouse_id || null,
          to_location_id: c.location_id || null,
          context_type: "component_exit",
          context_id: null,
          meta,
        });

        continue;
      }

      // ============ STOCK TRANSFER ============
      // depo/lokasyon zorunlu, tüm miktarı taşır (kuralın)
      const whId = requirePositiveInt(raw.warehouse_id, "WAREHOUSE_LOCATION_REQUIRED", "Depo zorunlu.");
      const locId = requirePositiveInt(raw.location_id, "WAREHOUSE_LOCATION_REQUIRED", "Lokasyon zorunlu.");

      const beforeStatus = Number(c.status_id);
      const beforeWh = c.warehouse_id || null;
      const beforeLc = c.location_id || null;

      // taşınan miktar:
      const movedQty =
        stockUnit === "unit" ? 1 : Number(c[measureField] || 0);

      await repo.updateFields(client, c.id, {
        warehouse_id: whId,
        location_id: locId,
      });

      // Eski yerden düş
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
        meta: {
          target: "stock",
          stock_unit: stockUnit,
          moved_qty: movedQty,
          move_full: true,
        },
      });

      // Yeni yere ekle
      transitions.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: c.id,
        action: ACTION.ADJUST,
        qty_delta: 0,
        unit: UNIT_LABEL,
        from_status_id: beforeStatus,
        to_status_id: beforeStatus,
        from_warehouse_id: whId,
        from_location_id: locId,
        to_warehouse_id: whId,
        to_location_id: locId,
        context_type: "component_exit",
        context_id: null,
        meta: {
          target: "stock",
          stock_unit: stockUnit,
          moved_qty: movedQty,
          move_full: true,
        },
      });
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
