// src/modules/masters/masters.repository.js
const pool = require("../../core/db/index");

/* ---- tekil JOIN’li ---- */
exports.findJoinedById = async (id) => {
  const sql = `
    SELECT
      m.*,
      pt.name         AS product_type_name,
      pt.display_code AS product_type_code,
      ct.name         AS carrier_type_name,
      ct.display_code AS carrier_type_code,
      s.name          AS supplier_name,
      s.display_code  AS supplier_code,
      cc.name         AS carrier_color_name,
      cc.display_code AS carrier_color_code,
      lc.name         AS liner_color_name,
      lc.display_code AS liner_color_code,
      lt.name         AS liner_type_name,
      lt.display_code AS liner_type_code,
      at.name         AS adhesive_type_name,
      at.display_code AS adhesive_type_code
    FROM masters m
    JOIN product_types  pt ON pt.id = m.product_type_id
    LEFT JOIN carrier_types   ct ON ct.id = m.carrier_type_id
    LEFT JOIN suppliers       s  ON s.id  = m.supplier_id
    LEFT JOIN carrier_colors  cc ON cc.id = m.carrier_color_id
    LEFT JOIN liner_colors    lc ON lc.id = m.liner_color_id
    LEFT JOIN liner_types     lt ON lt.id = m.liner_type_id
    LEFT JOIN adhesive_types  at ON at.id = m.adhesive_type_id
    WHERE m.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
};

/* ---- liste ---- */
exports.findMany = async ({ productTypeId = 0, carrierTypeId = 0, search = "" } = {}) => {
  let sql = `
    SELECT
      m.*,
      pt.name         AS product_type_name,
      pt.display_code AS product_type_code,
      ct.name         AS carrier_type_name,
      ct.display_code AS carrier_type_code,
      s.name          AS supplier_name,
      s.display_code  AS supplier_code,
      cc.name         AS carrier_color_name,
      cc.display_code AS carrier_color_code,
      lc.name         AS liner_color_name,
      lc.display_code AS liner_color_code,
      lt.name         AS liner_type_name,
      lt.display_code AS liner_type_code,
      at.name         AS adhesive_type_name,
      at.display_code AS adhesive_type_code
    FROM masters m  
    JOIN product_types  pt ON pt.id = m.product_type_id
    LEFT JOIN carrier_types   ct ON ct.id = m.carrier_type_id
    LEFT JOIN suppliers       s  ON s.id  = m.supplier_id
    LEFT JOIN carrier_colors  cc ON cc.id = m.carrier_color_id
    LEFT JOIN liner_colors    lc ON lc.id = m.liner_color_id
    LEFT JOIN liner_types     lt ON lt.id = m.liner_type_id
    LEFT JOIN adhesive_types  at ON at.id = m.adhesive_type_id
  `;

  const where = [];
  const params = [];

  // Ürün türü filtresi
  if (productTypeId > 0) {
    params.push(productTypeId);
    where.push(`m.product_type_id = $${params.length}`);
  }

  // Taşıyıcı türü filtresi
  if (carrierTypeId > 0) {
    params.push(carrierTypeId);
    where.push(`m.carrier_type_id = $${params.length}`);
  }

  // Serbest metin arama
  if (search) {
    params.push(`%${search}%`);
    const p = params.length;

    where.push(
      `( m.bimeks_code ILIKE $${p}
         OR m.bimeks_product_name ILIKE $${p}
         OR s.name ILIKE $${p}
         OR pt.name ILIKE $${p}
         OR ct.name ILIKE $${p}
         OR cc.name ILIKE $${p}
         OR lc.name ILIKE $${p}
         OR lt.name ILIKE $${p}
         OR at.name ILIKE $${p}
       )`
    );
  }

  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }

  sql += " ORDER BY m.id DESC";

  const { rows } = await pool.query(sql, params);
  return rows;
};

/* ---- update (generic) ---- */
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
