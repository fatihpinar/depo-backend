// src/modules/components/components.repository.js
const pool = require("../../core/db/index");

exports.findMany = async (filters = {}) => {
  const {
    search = "",
    warehouseId = 0,
    locationId = 0,
    masterId = 0,
    availableOnly = false,
  } = filters;

  let sql = `
    SELECT
      se.id, se.barcode,
      se.width, se.height, se.area,
      se.weight, se.length,
      se.invoice_no, se.created_at, se.created_by, se.approved_by,
      se.updated_at, se.approved_at, se.notes,

      cu.username AS created_by_username,
      cu.full_name AS created_by_full_name,
      au.username AS approved_by_username,
      au.full_name AS approved_by_full_name,

      w.id AS warehouse_id, w.name AS warehouse_name,
      l.id AS location_id, l.name AS location_name,

      pm.id                AS master_id,
      pm.bimeks_product_name AS master_bimeks_product_name,   -- 🔧
      pm.bimeks_code AS master_bimeks_code,
      pm.stock_unit     AS master_stock_unit,
      pm.thickness_unit AS master_thickness_unit,


      st.id AS status_id,
      st.code AS status_code,
      st.label AS status_label,

      t.name AS type_name,
      s.name AS supplier_name
    FROM components se
    LEFT JOIN warehouses w      ON w.id = se.warehouse_id
    LEFT JOIN locations  l      ON l.id = se.location_id
    JOIN masters pm             ON pm.id = se.master_id
    LEFT JOIN product_types t   ON t.id = pm.product_type_id
    LEFT JOIN suppliers s       ON s.id = pm.supplier_id
    JOIN statuses st            ON st.id = se.status_id
    LEFT JOIN users cu          ON cu.id = se.created_by
    LEFT JOIN users au          ON au.id = se.approved_by
  `;

  const where = [];
  const params = [];

  if (availableOnly) where.push(`se.status_id = 1`);
  if (warehouseId > 0) {
    params.push(warehouseId);
    where.push(`se.warehouse_id = $${params.length}`);
  }
  if (locationId > 0) {
    params.push(locationId);
    where.push(`se.location_id = $${params.length}`);
  }
  if (masterId > 0) {
    params.push(masterId);
    where.push(`se.master_id = $${params.length}`);
  }

  if (filters.statusId) {
    where.push(`se.status_id = $${params.length + 1}`);
    params.push(filters.statusId);
  }

  if (search) {
    const term = `%${search}%`;
    params.push(term);
    const p1 = params.length;

    params.push(term);
    const p2 = params.length;

    where.push(`(
      se.barcode ILIKE $${p1}
      OR t.name ILIKE $${p2}
      OR s.name ILIKE $${p2}
      OR pm.bimeks_product_name ILIKE $${p2}
      OR pm.bimeks_code ILIKE $${p2}          -- ✅ EKLE
      OR se.invoice_no ILIKE $${p2}
    )`);
  }


  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY se.id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
};

exports.findById = async (id) => {
  const sql = `
    SELECT
      se.*,

      cu.username AS created_by_username,
      cu.full_name AS created_by_full_name,
      au.username AS approved_by_username,
      au.full_name AS approved_by_full_name,

      w.id AS warehouse_id, w.name AS warehouse_name,
      l.id AS location_id, l.name AS location_name,

      pm.id                  AS master_id,
      pm.bimeks_code AS master_bimeks_code,   -- 🔧
      pm.bimeks_code         AS master_code,
      pm.stock_unit          AS master_stock_unit,
      pm.thickness_unit      AS master_thickness_unit,
      
      st.id AS status_id,
      st.code AS status_code,
      st.label AS status_label
    FROM components se
    LEFT JOIN warehouses w ON w.id = se.warehouse_id
    LEFT JOIN locations  l ON l.id = se.location_id
    JOIN masters pm        ON pm.id = se.master_id
    JOIN statuses st       ON st.id = se.status_id
    LEFT JOIN users cu     ON cu.id = se.created_by
    LEFT JOIN users au     ON au.id = se.approved_by
    WHERE se.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
};

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
    [id]
  );
  return rows[0] || null;
};

exports.updateFields = async (client, id, fields) => {
  const cols = Object.keys(fields);
  if (!cols.length) return exports.findById(id);

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

  params.push(id);
  const { rows } = await client.query(
    `UPDATE components
        SET ${sets.join(", ")}
      WHERE id=$${params.length}
      RETURNING
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
        length`,
    params
  );
  return rows[0];
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
      e.master_id,
      e.barcode,
      e.status_id,
      e.warehouse_id,
      e.location_id,
      e.width ?? null,
      e.height ?? null,
      e.area ?? null,
      e.weight ?? null,
      e.length ?? null,
      e.invoice_no ?? null,
      e.created_by ?? null
    );
  });

  const sql = `INSERT INTO components (${cols.join(",")})
               VALUES ${placeholders.join(",")}
               RETURNING *;`;
  const { rows } = await client.query(sql, params);
  return rows;
};

exports.barcodesExist = async (client, barcodes) => {
  if (!barcodes.length) return [];
  const { rows } = await client.query(
    `SELECT barcode FROM components WHERE barcode = ANY($1)`,
    [barcodes]
  );
  return rows;
};
