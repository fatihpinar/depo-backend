// src/modules/masters/masters.repository.js
const pool = require("../../core/db/index");

exports.findJoinedById = async (id) => {
  const sql = `
    SELECT
      m.id,
      m.display_label,
      m.category_id,
      m.type_id,
      m.supplier_id,
      m.stock_unit_id,
      m.created_at,
      m.updated_at,

      c.name  AS category_name,
      t.name  AS type_name,
      s.name  AS supplier_name,

      su.code  AS stock_unit_code,
      su.label AS stock_unit_label

    FROM masters m
    LEFT JOIN categories  c  ON c.id  = m.category_id
    LEFT JOIN types       t  ON t.id  = m.type_id
    LEFT JOIN suppliers   s  ON s.id  = m.supplier_id
    LEFT JOIN stock_units su ON su.id = m.stock_unit_id
    WHERE m.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
};

exports.findMany = async (
  { categoryId = null, typeId = null, supplierId = null, stockUnitId = null, search = "" } = {}
) => {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  let sql = `
    SELECT
      m.id,
      m.display_label,
      m.category_id,
      m.type_id,
      m.supplier_id,
      m.stock_unit_id,
      m.created_at,
      m.updated_at,

      c.name  AS category_name,
      t.name  AS type_name,
      s.name  AS supplier_name,

      su.code  AS stock_unit_code,
      su.label AS stock_unit_label

    FROM masters m
    LEFT JOIN categories  c  ON c.id  = m.category_id
    LEFT JOIN types       t  ON t.id  = m.type_id
    LEFT JOIN suppliers   s  ON s.id  = m.supplier_id
    LEFT JOIN stock_units su ON su.id = m.stock_unit_id
  `;

  const where = [];
  if (categoryId)  where.push(`m.category_id = ${push(categoryId)}`);
  if (typeId)      where.push(`m.type_id = ${push(typeId)}`);
  if (supplierId)  where.push(`m.supplier_id = ${push(supplierId)}`);
  if (stockUnitId) where.push(`m.stock_unit_id = ${push(stockUnitId)}`);

  if (search) {
    const term = `%${search}%`;
    const p = push(term);
    where.push(`
      (
        m.display_label ILIKE ${p}
        OR c.name ILIKE ${p}
        OR t.name ILIKE ${p}
        OR s.name ILIKE ${p}
        OR su.code ILIKE ${p}
        OR su.label ILIKE ${p}
      )
    `);
  }

  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;

  sql += ` ORDER BY m.id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
};

exports.insertOne = async (clean) => {
  const sql = `
    INSERT INTO masters (
      display_label,
      category_id,
      type_id,
      supplier_id,
      stock_unit_id
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `;
  const { rows } = await pool.query(sql, [
    clean.display_label,
    clean.category_id ?? null,
    clean.type_id ?? null,
    clean.supplier_id ?? null,
    clean.stock_unit_id ?? null,
  ]);
  return rows[0];
};

exports.updateOne = async (id, clean) => {
  const fields = [];
  const params = [];
  let i = 1;

  for (const k of Object.keys(clean)) {
    fields.push(`${k} = $${i++}`);
    params.push(clean[k] === "" ? null : clean[k]);
  }

  fields.push(`updated_at = NOW()`);
  params.push(id);

  const sql = `UPDATE masters SET ${fields.join(", ")} WHERE id = $${i}`;
  await pool.query(sql, params);
};
