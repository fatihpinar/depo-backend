// src/modules/components/components.repository.js
const pool = require("../../core/db/index");

 //API shape mapper
function mapRowToApi(r) {
  return {
    id: r.id,
    barcode: r.barcode,

    width: r.width ?? null,
    height: r.height ?? null,
    area: r.area ?? null,
    weight: r.weight ?? null,
    length: r.length ?? null,

    invoice_no: r.invoice_no ?? null,

    created_at: r.created_at,
    updated_at: r.updated_at,
    approved_at: r.approved_at,

    created_by: r.created_by,
    approved_by: r.approved_by,

    created_by_user: r.created_by
      ? {
          id: r.created_by,
          full_name: r.created_by_full_name || null,
          username: r.created_by_username || null,
        }
      : null,

    approved_by_user: r.approved_by
      ? {
          id: r.approved_by,
          full_name: r.approved_by_full_name || null,
          username: r.approved_by_username || null,
        }
      : null,

    notes: r.notes,
    status_id: r.status_id,
    status: r.status_label || r.status_code,

    warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.warehouse_name } : null,
    location: r.location_id ? { id: r.location_id, name: r.location_name } : null,

    master: r.master_id
      ? {
          id: r.master_id,
          display_label: r.master_display_label || null,
          category: r.master_category_id ? { id: r.master_category_id, name: r.master_category_name || null } : null,
          type: r.master_type_id ? { id: r.master_type_id, name: r.master_type_name || null } : null,
          supplier: r.master_supplier_id ? { id: r.master_supplier_id, name: r.master_supplier_name || null } : null,
          stock_unit: r.master_stock_unit_id
            ? { id: r.master_stock_unit_id, code: r.master_stock_unit_code || null, label: r.master_stock_unit_label || null }
            : null,
        }
      : null,
  };
}

/**
 * Tek kaynak SELECT + JOIN bloğu
 * - findMany / findById aynı çekirdeği kullanır
 */
function baseSelectSql() {
  return `
    SELECT
      c.id,
      c.barcode,
      c.width,
      c.height,
      c.area,
      c.weight,
      c.length,
      c.invoice_no,
      c.created_at,
      c.created_by,
      c.approved_by,
      c.updated_at,
      c.approved_at,
      c.notes,
      c.warehouse_id,
      c.location_id,
      c.master_id,
      c.status_id,

      cu.username AS created_by_username,
      cu.full_name AS created_by_full_name,
      au.username AS approved_by_username,
      au.full_name AS approved_by_full_name,

      w.name AS warehouse_name,
      l.name AS location_name,

      st.code AS status_code,
      st.label AS status_label,

      m.display_label AS master_display_label,
      m.category_id   AS master_category_id,
      m.type_id       AS master_type_id,
      m.supplier_id   AS master_supplier_id,
      m.stock_unit_id AS master_stock_unit_id,

      cat.name AS master_category_name,
      typ.name AS master_type_name,
      sup.name AS master_supplier_name,

      su.code  AS master_stock_unit_code,
      su.label AS master_stock_unit_label

    FROM components c
    LEFT JOIN warehouses w ON w.id = c.warehouse_id
    LEFT JOIN locations  l ON l.id = c.location_id

    JOIN masters m ON m.id = c.master_id
    LEFT JOIN categories cat ON cat.id = m.category_id
    LEFT JOIN types typ      ON typ.id = m.type_id
    LEFT JOIN suppliers sup  ON sup.id = m.supplier_id
    LEFT JOIN stock_units su ON su.id = m.stock_unit_id

    JOIN statuses st ON st.id = c.status_id

    LEFT JOIN users cu ON cu.id = c.created_by
    LEFT JOIN users au ON au.id = c.approved_by
  `;
}

/**
 * Filtre builder (findMany için)
 * - Tek yerden param yönetimi
 */
function buildWhere(filters = {}) {
  const {
    search = "",
    warehouseId,
    locationId,
    masterId,
    statusId,
    availableOnly = false,
  } = filters;

  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (availableOnly) where.push(`c.status_id = 1`);

  if (warehouseId && Number(warehouseId) > 0) {
    where.push(`c.warehouse_id = ${push(Number(warehouseId))}`);
  }
  if (locationId && Number(locationId) > 0) {
    where.push(`c.location_id = ${push(Number(locationId))}`);
  }
  if (masterId && Number(masterId) > 0) {
    where.push(`c.master_id = ${push(Number(masterId))}`);
  }
  if (statusId && Number(statusId) > 0) {
    where.push(`c.status_id = ${push(Number(statusId))}`);
  }

  const term = String(search || "").trim();
  if (term) {
    const like = `%${term}%`;
    const p = push(like);
    where.push(`(
      c.barcode ILIKE ${p}
      OR c.invoice_no ILIKE ${p}
      OR m.display_label ILIKE ${p}
      OR cat.name ILIKE ${p}
      OR typ.name ILIKE ${p}
      OR sup.name ILIKE ${p}
    )`);
  }

  return { where, params };
}

/**
 * LIST
 */
exports.findMany = async (filters = {}) => {
  const { where, params } = buildWhere(filters);

  let sql = baseSelectSql();
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY c.id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows.map(mapRowToApi);
};

/**
 * GET BY ID
 */
exports.findById = async (id) => {
  const sql = `
    ${baseSelectSql()}
    WHERE c.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [Number(id)]);
  return rows[0] ? mapRowToApi(rows[0]) : null;
};

/**
 * LOCK (update/exit işlemleri için minimal alan seti)
 */
exports.lockById = async (client, id) => {
  const { rows } = await client.query(
    `SELECT
       id,
       barcode,
       master_id,
       status_id,
       warehouse_id,
       location_id,
       notes,
       invoice_no,
       width,
       height,
       area,
       weight,
       length
     FROM components
     WHERE id=$1
     FOR UPDATE`,
    [Number(id)]
  );
  return rows[0] || null;
};

/**
 * UPDATE FIELDS (transaction içinde)
 * - Dikkat: RETURNING minimal dönüyor; Service sonunda repo.findById ile full+map'li döndür.
 */
exports.updateFields = async (client, id, fields) => {
  const cols = Object.keys(fields || {});
  if (!cols.length) return null;

  const sets = [];
  const params = [];

  cols.forEach((k, i) => {
    params.push(fields[k]);
    sets.push(`${k}=$${i + 1}`);
  });

  if (fields.approved_by !== undefined && fields.approved_at === undefined) {
    sets.push(`approved_at=NOW()`);
  }

  sets.push(`updated_at=NOW()`);

  params.push(Number(id));
  const { rows } = await client.query(
    `UPDATE components
        SET ${sets.join(", ")}
      WHERE id=$${params.length}
      RETURNING id`,
    params
  );

  return rows[0] || null;
};

exports.insertMany = async (client, entries) => {
  const cols = [
    "master_id",
    "barcode",
    "status_id",
    "warehouse_id",
    "location_id",
    "width",
    "height",
    "area",
    "weight",
    "length",
    "invoice_no",
    "created_by",
  ];

  const placeholders = [];
  const params = [];

  entries.forEach((e, i) => {
    const b = i * cols.length;
    placeholders.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`
    );

    params.push(
      Number(e.master_id),
      e.barcode || null,
      Number(e.status_id),
      Number(e.warehouse_id),
      Number(e.location_id),
      e.width ?? null,
      e.height ?? null,
      e.area ?? null,
      e.weight ?? null,
      e.length ?? null,
      e.invoice_no ?? null,
      e.created_by ?? null
    );
  });

  const sql = `
    INSERT INTO components (${cols.join(",")})
    VALUES ${placeholders.join(",")}
    RETURNING id;
  `;

  const { rows } = await client.query(sql, params);
  // sadece id döndürüyoruz; full view için service -> findByIds yapacağız
  return rows.map((r) => Number(r.id));
};

exports.findManyByIds = async (ids = []) => {
  const clean = [...new Set(ids.map(Number).filter((x) => Number.isFinite(x) && x > 0))];
  if (!clean.length) return [];

  const sql = `
    ${baseSelectSql()}
    WHERE c.id = ANY($1::int[])
    ORDER BY c.id DESC
  `;

  const { rows } = await pool.query(sql, [clean]);
  return rows.map(mapRowToApi);
};

exports.barcodesExist = async (client, barcodes) => {
  const arr = (barcodes || []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!arr.length) return [];
  const { rows } = await client.query(
    `SELECT barcode FROM components WHERE barcode = ANY($1)`,
    [arr]
  );
  return rows;
};
