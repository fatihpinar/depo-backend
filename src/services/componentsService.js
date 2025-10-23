const pool = require("../config/db");
const { recordTransitions, makeBatchId } = require("./inventoryTransitionsService");
const { ITEM_TYPE, ACTION } = require("../constants/transitions");

// Status id sözlüğü (referans)
const STATUS = {
  in_stock: 1,
  used: 2,
  sold: 3,
  pending: 4,
  damaged_lost: 5,
  production: 6,
  screenprint: 7,
};

/**
 * GENEL LİSTE
 * - Hem listeler hem picker tarafından kullanılır.
 * - availableOnly=true ise sadece in_stock (1) döner (picker için).
 * Filters: search, warehouseId, locationId, masterId
 * Shape: FE’nin beklediği geniş alan seti (status, warehouse/location/master, timestamps…)
 */
exports.list = async ({
  search = "",
  warehouseId = 0,
  locationId = 0,
  masterId = 0,
  availableOnly = false,
} = {}) => {
  let sql = `
    SELECT
      se.id,
      se.barcode,
      se.unit,
      se.quantity,
      se.width,
      se.height, 
      se.created_at,
      se.created_by,
      se.approved_by,
      se.updated_at,
      se.approved_at,
      se.notes,
      w.id   AS warehouse_id,
      w.name AS warehouse_name,
      l.id   AS location_id,
      l.name AS location_name,
      pm.id  AS master_id,
      pm.display_label AS master_display_label,
      st.id  AS status_id,
      st.code AS status_code,
      st.label AS status_label
    FROM components se
    LEFT JOIN warehouses w  ON w.id = se.warehouse_id
    LEFT JOIN locations  l  ON l.id = se.location_id
    JOIN masters pm         ON pm.id = se.master_id
    LEFT JOIN types t       ON t.id = pm.type_id
    LEFT JOIN suppliers s   ON s.id = pm.supplier_id
    JOIN statuses st        ON st.id = se.status_id
  `;

  const where = [];
  const params = [];

  if (availableOnly) where.push(`se.status_id = ${STATUS.in_stock}`);
  if (warehouseId > 0) { params.push(warehouseId); where.push(`se.warehouse_id = $${params.length}`); }
  if (locationId  > 0) { params.push(locationId ); where.push(`se.location_id  = $${params.length}`); }
  if (masterId    > 0) { params.push(masterId   ); where.push(`se.master_id    = $${params.length}`); }

  if (search) {
    const term = `%${search}%`;
    params.push(term); const p1 = params.length; // barcode
    params.push(term); const p2 = params.length; // master alanları
    where.push(`(
      se.barcode ILIKE $${p1}
      OR t.name ILIKE $${p2}
      OR s.name ILIKE $${p2}
      OR pm.bimeks_code ILIKE $${p2}
      OR pm.display_label ILIKE $${p2}
    )`);
  }

  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY se.id DESC`;

  const { rows } = await pool.query(sql, params);

  return rows.map((r) => ({
    id: r.id,
    barcode: r.barcode,
    unit: r.unit,
    quantity: r.quantity,
    width: r.width ?? null,  
    height: r.height ?? null,  
    created_at: r.created_at,
    warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.warehouse_name } : undefined,
    location:  r.location_id  ? { id: r.location_id,  name: r.location_name }  : undefined,
    master:    r.master_id    ? { id: r.master_id,    display_label: r.master_display_label } : undefined,
    status: r.status_label || r.status_code,
    created_by: r.created_by,
    approved_by: r.approved_by,
    updated_at: r.updated_at,
    approved_at: r.approved_at,
    notes: r.notes,
  }));
};

/**
 * TEK KAYIT (Details sayfası)
 */
exports.getById = async (id) => {
  const sql = `
    SELECT
      se.*,
      w.id   AS warehouse_id,
      w.name AS warehouse_name,
      l.id   AS location_id,
      l.name AS location_name,
      pm.id  AS master_id,
      pm.display_label AS master_display_label,
      st.id  AS status_id,
      st.code AS status_code,
      st.label AS status_label
    FROM components se
    LEFT JOIN warehouses w ON w.id = se.warehouse_id
    LEFT JOIN locations  l ON l.id = se.location_id
    JOIN masters pm       ON pm.id = se.master_id
    JOIN statuses st      ON st.id = se.status_id
    WHERE se.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  const r = rows[0];
  if (!r) return null;

  return {
    id: r.id,
    barcode: r.barcode,
    unit: r.unit,
    quantity: r.quantity,
    width: r.width ?? null,    
    height: r.height ?? null,   
    created_at: r.created_at,
    updated_at: r.updated_at,
    approved_at: r.approved_at,
    created_by: r.created_by,
    approved_by: r.approved_by,
    notes: r.notes,
    warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.warehouse_name } : undefined,
    location:  r.location_id  ? { id: r.location_id,  name: r.location_name }  : undefined,
    master:    r.master_id    ? { id: r.master_id,    display_label: r.master_display_label } : undefined,
    status_id: r.status_id,
    status: r.status_label || r.status_code,
  };
};

/**
 * GÜNCELLE (Details sayfası)
 * payload: { barcode?, master_id?, quantity?, unit?, status_id?, warehouse_id?, location_id?, notes? }
 * (Basit örnek; gerekli validasyonları genişletebiliriz.)
 */
exports.update = async (id, payload = {}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 0) Önce mevcut kaydı kilitle çek (FOR UPDATE) — diff için gerekli
    const { rows: beforeRows } = await client.query(
      `SELECT id, barcode, master_id, quantity, unit, status_id, warehouse_id, location_id, notes
         FROM components WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const before = beforeRows[0];
    if (!before) {
      const e = new Error("NOT_FOUND"); e.status = 404; throw e;
    }

    // 1) Normal UPDATE logic (senin mevcut kodun) — allowed set
    const allowed = [
      "barcode", "master_id", "quantity", "unit",
      "status_id", "warehouse_id", "location_id", "notes"
    ];

    const fields = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (payload[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        params.push(payload[key]);
      }
    }
    if (!fields.length) {
      await client.query("ROLLBACK"); // değişiklik yoksa eski fonksiyon davranışı
      return await this.getById(id);
    }

    params.push(id);
    const updSql = `
      UPDATE components
         SET ${fields.join(", ")}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, barcode, master_id, quantity, unit, status_id, warehouse_id, location_id, notes
    `;
    const { rows: afterRows } = await client.query(updSql, params);
    const after = afterRows[0];

    // 2) Diffs → transition kayıtları
    const recs = [];
    const batchId = makeBatchId();

    // a) STATUS_CHANGE
    if (payload.status_id !== undefined && Number(before.status_id) !== Number(after.status_id)) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: id,
        action: ACTION.STATUS_CHANGE,
        qty_delta: 0,
        unit: after.unit || before.unit || "EA",
        from_status_id: before.status_id,
        to_status_id: after.status_id,
      });
    }

    // b) MOVE (warehouse/location değişimi)
    const whChanged  = payload.warehouse_id !== undefined && Number(before.warehouse_id || 0) !== Number(after.warehouse_id || 0);
    const locChanged = payload.location_id  !== undefined && Number(before.location_id  || 0) !== Number(after.location_id  || 0);
    if (whChanged || locChanged) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: id,
        action: ACTION.MOVE,
        qty_delta: 0,
        unit: after.unit || before.unit || "EA",
        from_warehouse_id: before.warehouse_id || null,
        from_location_id:  before.location_id  || null,
        to_warehouse_id:   after.warehouse_id  || null,
        to_location_id:    after.location_id   || null,
      });
    }

    // c) ADJUST (miktar elle değiştiyse)
    if (payload.quantity !== undefined) {
      const beforeQ = Number(before.quantity || 0);
      // EA için quantity kolonunu kullanmıyorsun; ama yine de diff 0 ise log atma
      const afterQ  = Number(after.quantity  || 0);
      const delta   = afterQ - beforeQ;
      if (delta !== 0) {
        recs.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: id,
          action: ACTION.ADJUST,
          qty_delta: delta,               // + ya da -
          unit: after.unit || before.unit || "EA",
          to_status_id: after.status_id,  // mevcut son durum
        });
      }
    }

    // d) ATTRIBUTE_CHANGE (barcode gibi kimlik alanları)
    if (payload.barcode !== undefined && String(before.barcode || "") !== String(after.barcode || "")) {
      recs.push({
        item_type: ITEM_TYPE.COMPONENT,
        item_id: id,
        action: ACTION.ATTRIBUTE_CHANGE,
        qty_delta: 0,
        unit: after.unit || before.unit || "EA",
        notes: null,
        meta: { field: "barcode", before: before.barcode || null, after: after.barcode || null }
      });
    }

    // (notes değişimini timeline’a almak istemezsek yorumla)
    // if (payload.notes !== undefined && String(before.notes || "") !== String(after.notes || "")) {
    //   recs.push({
    //     item_type: ITEM_TYPE.COMPONENT,
    //     item_id: id,
    //     action: ACTION.ATTRIBUTE_CHANGE,
    //     qty_delta: 0,
    //     unit: after.unit || before.unit || "EA",
    //     meta: { field: "notes", before: before.notes || null, after: after.notes || null }
    //   });
    // }

    if (recs.length) {
      await recordTransitions(client, batchId, recs);
    }

    await client.query("COMMIT");
    // Detay sayfasının beklediği response:
    return await this.getById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};


/**
 * BULK CREATE (stok girişi) — her zaman status_id=4 (pending)
 * entries: [{ master_id, barcode, unit, quantity, warehouse_id, location_id }]
 */
exports.bulkCreate = async (entries) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Barkod çakışması
    const incoming = entries.map(e => String(e.barcode));
    if (incoming.length) {
      const { rows: existing } = await client.query(
        "SELECT barcode FROM components WHERE barcode = ANY($1)",
        [incoming]
      );
      if (existing.length) {
        const err = new Error("BARCODE_CONFLICT");
        err.status = 409;
        err.code = "BARCODE_CONFLICT";
        err.conflicts = existing; // [{ barcode }]
        throw err;
      }
    }

    // 2) Dinamik insert
    const cols = [
      "master_id","barcode","unit","quantity",
      "status_id","warehouse_id","location_id", "width","height",
    ];
    const placeholders = [];
    const params = [];

    entries.forEach((e, i) => {
      const base = i * cols.length;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
      );
      params.push(
        e.master_id,
        e.barcode,
        e.unit,
        e.quantity,
        STATUS.pending,        // 4
        e.warehouse_id,
        e.location_id,
        e.width ?? null,    // ✨ yeni
        e.height ?? null
      );
    });

    const sql = `
      INSERT INTO components (${cols.join(", ")})
      VALUES ${placeholders.join(", ")}
      RETURNING *;
    `;
    const { rows } = await client.query(sql, params);

    /* NEW: CREATE transitions */
    const batchId = makeBatchId();
    const createRecords = rows.map(r => ({
      item_type: ITEM_TYPE.COMPONENT,
      item_id: r.id,
      action: ACTION.CREATE,
      qty_delta: r.unit === "EA" ? 1 : Number(r.quantity || 0),
      unit: r.unit || "EA",
      to_status_id: STATUS.pending,
      to_warehouse_id: r.warehouse_id || null,
      to_location_id: r.location_id || null,
    }));
    await recordTransitions(client, batchId, createRecords);

    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
