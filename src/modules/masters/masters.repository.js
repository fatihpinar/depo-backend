// src/modules/masters/masters.repository.js
const pool = require("../../core/db/index");

/* ---- isim çözümleyici ---- */
exports.resolveNames = async (type_id, supplier_id) => {
  let type_name = null, supplier_name = null;
  if (type_id) {
    const { rows } = await pool.query("SELECT name FROM types WHERE id=$1", [type_id]);
    type_name = rows[0]?.name || null;
  }
  if (supplier_id) {
    const { rows } = await pool.query("SELECT name FROM suppliers WHERE id=$1", [supplier_id]);
    supplier_name = rows[0]?.name || null;
  }
  return { type_name, supplier_name };
};

/* ---- tekil JOIN’li ---- */
exports.findJoinedById = async (id) => {
  const sql = `
    SELECT
      pm.*,
      t.name AS type_name,
      s.name AS supplier_name,
      c.name AS category_name
    FROM masters pm
    JOIN types t           ON pm.type_id = t.id
    LEFT JOIN suppliers s  ON pm.supplier_id = s.id
    LEFT JOIN categories c ON pm.category_id = c.id
    WHERE pm.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
};

/* ---- liste ---- */
exports.findMany = async ({ categoryId = 0, typeId = 0, search = "" } = {}) => {
  let sql = `
    SELECT
      pm.*,
      t.name AS type_name,
      s.name AS supplier_name,
      c.name AS category_name
    FROM masters pm
    JOIN types t           ON pm.type_id = t.id
    LEFT JOIN suppliers s  ON pm.supplier_id = s.id
    LEFT JOIN categories c ON pm.category_id = c.id
  `;
  const where = [];
  const params = [];

  if (categoryId > 0) { params.push(categoryId); where.push(`pm.category_id = $${params.length}`); }
  if (typeId     > 0) { params.push(typeId);     where.push(`pm.type_id     = $${params.length}`); }
  if (search) {
    const term = `%${search}%`;
    params.push(term); const p1 = params.length;
    params.push(term); const p2 = params.length;
    params.push(term); const p3 = params.length;
    where.push(`(pm.display_label ILIKE $${p1} OR s.name ILIKE $${p2} OR t.name ILIKE $${p3})`);
  }

  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY pm.id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
};

/* ---- insert ---- */
exports.insertOne = async (clean) => {
  const cols = [
    "category_id","type_id","supplier_id","supplier_product_code",
    "color_pattern","thickness","width","density","weight",
    "unit_kind","default_unit",
    "liner_thickness","liner_color","adhesive_grammage_gm2","supplier_lot_no",
    "display_label","created_at","updated_at",
  ];

  const vals = [
    clean.category_id,
    clean.type_id,
    clean.supplier_id || null,
    clean.supplier_product_code || null,
    clean.color_pattern || null,
    clean.thickness || null,
    clean.width || null,
    clean.density || null,
    clean.weight || null,
    clean.unit_kind,
    clean.default_unit,
    clean.liner_thickness || null,
    clean.liner_color || null,
    clean.adhesive_grammage_gm2 || null,
    clean.supplier_lot_no || null,
    clean.display_label,
  ];

  const placeholders = cols.map((_, i) => `$${i + 1}`).slice(0, cols.length - 2);

  const sql = `
    INSERT INTO masters (${cols.join(", ")})
    VALUES (${placeholders.join(", ")}, NOW(), NOW())
    RETURNING id
  `;
  const { rows } = await pool.query(sql, vals);
  const insertedId = rows[0].id;
  return await exports.findJoinedById(insertedId);
};

/* ---- update ---- */
exports.updateOne = async (id, clean) => {
  const fields = [];
  const params = [];
  let i = 1;
  Object.keys(clean).forEach((k) => {
    fields.push(`${k} = $${i++}`);
    params.push(clean[k] === "" ? null : clean[k]);
  });
  fields.push(`updated_at = NOW()`);
  params.push(id);
  const sql = `UPDATE masters SET ${fields.join(", ")} WHERE id = $${i}`;
  await pool.query(sql, params);
};
