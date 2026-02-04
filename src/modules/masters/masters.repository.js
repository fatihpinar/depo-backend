// src/modules/masters/masters.repository.js
const pool = require("../../core/db/index");

/* =========================================================================
   MASTER DETAIL (tekil, JOIN’li)
   - MasterDetailPage bunu kullanıyor.
   ========================================================================= */
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
      at.display_code AS adhesive_type_code,

      (SELECT COUNT(*)::int
       FROM components c
       WHERE c.master_id = m.id
      ) AS component_count

    FROM masters m
    JOIN product_types       pt ON pt.id = m.product_type_id
    LEFT JOIN carrier_types  ct ON ct.id = m.carrier_type_id
    LEFT JOIN suppliers      s  ON s.id  = m.supplier_id
    LEFT JOIN carrier_colors cc ON cc.id = m.carrier_color_id
    LEFT JOIN liner_colors   lc ON lc.id = m.liner_color_id
    LEFT JOIN liner_types    lt ON lt.id = m.liner_type_id
    LEFT JOIN adhesive_types at ON at.id = m.adhesive_type_id
    WHERE m.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
};


/* =========================================================================
   MASTER LIST (Tanım listesi)
   - stock_balances bypass: components üzerinden adet + miktar hesaplar
   - filtreler: productTypeId, carrierTypeId, supplierId, search
   - component filtreleri: statusId / warehouseId / locationId / inStockOnly
   ========================================================================= */
exports.findMany = async (
  {
    productTypeId = 0,
    carrierTypeId = 0,
    supplierId = 0,
    search = "",

    // component bazlı hesap filtreleri
    statusId = null,
    warehouseId = null,
    locationId = null,
    inStockOnly = false,
  } = {}
) => {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  // inStockOnly aktifse ve statusId yoksa 1'e sabitle
  const finalStatusId =
    inStockOnly && (statusId === null || statusId === undefined || statusId === "")
      ? 1
      : statusId;

  // JOIN components filtresi (parametreli)
  const cFilters = [];
  if (finalStatusId) cFilters.push(`c.status_id = ${push(finalStatusId)}`);
  if (warehouseId)   cFilters.push(`c.warehouse_id = ${push(warehouseId)}`);
  if (locationId)    cFilters.push(`c.location_id = ${push(locationId)}`);

  const cFilterSql = cFilters.length ? `AND ${cFilters.join(" AND ")}` : "";

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
      at.display_code AS adhesive_type_code,

      -- ✅ toplam adet = satır sayısı (components)
      COUNT(c.id)::int AS total_count,

      -- ✅ toplam miktar = stock_unit'e göre doğru kolon
      COALESCE(
        SUM(
          CASE
            WHEN m.stock_unit = 'area'     THEN COALESCE(c.area, 0)
            WHEN m.stock_unit = 'weight'   THEN COALESCE(c.weight, 0)
            WHEN m.stock_unit = 'length'   THEN COALESCE(c.length, 0)
            WHEN m.stock_unit = 'volume'   THEN COALESCE(c.volume, 0)  
            WHEN m.stock_unit = 'unit'     THEN 1
            WHEN m.stock_unit = 'box_unit' THEN COALESCE(c.box_unit, 0)
            ELSE COALESCE(c.area, 0)
          END
        ),
        0
      )::float8 AS total_qty

    FROM masters m
    JOIN product_types       pt ON pt.id = m.product_type_id
    LEFT JOIN carrier_types  ct ON ct.id = m.carrier_type_id
    LEFT JOIN suppliers      s  ON s.id  = m.supplier_id
    LEFT JOIN carrier_colors cc ON cc.id = m.carrier_color_id
    LEFT JOIN liner_colors   lc ON lc.id = m.liner_color_id
    LEFT JOIN liner_types    lt ON lt.id = m.liner_type_id
    LEFT JOIN adhesive_types at ON at.id = m.adhesive_type_id

    -- ✅ stock_balances yok: components üzerinden hesap
    LEFT JOIN components c
      ON c.master_id = m.id
      ${cFilterSql}
  `;

  const where = [];

  if (productTypeId > 0) where.push(`m.product_type_id = ${push(productTypeId)}`);
  if (carrierTypeId > 0) where.push(`m.carrier_type_id = ${push(carrierTypeId)}`);
  if (supplierId > 0)    where.push(`m.supplier_id = ${push(supplierId)}`);

  if (search) {
    const term = `%${search}%`;
    const p = push(term);
    where.push(
      `( m.bimeks_code ILIKE ${p}
         OR m.bimeks_product_name ILIKE ${p}
         OR s.name ILIKE ${p}
         OR pt.name ILIKE ${p}
         OR ct.name ILIKE ${p}
         OR cc.name ILIKE ${p}
         OR lc.name ILIKE ${p}
         OR lt.name ILIKE ${p}
         OR at.name ILIKE ${p}
       )`
    );
  }

  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;

  sql += `
    GROUP BY
      m.id,
      pt.id,
      ct.id,
      s.id,
      cc.id,
      lc.id,
      lt.id,
      at.id
    ORDER BY m.id DESC
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
};

/* =========================================================================
   UPDATE (generic)
   ========================================================================= */
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

exports.countComponentsByMasterId = async (id, { statusId = null } = {}) => {
  const params = [id];
  let sql = `SELECT COUNT(*)::int AS cnt FROM components WHERE master_id = $1`;

  if (statusId) {
    params.push(statusId);
    sql += ` AND status_id = $2`;
  }

  const { rows } = await pool.query(sql, params);
  return rows[0]?.cnt ?? 0;
};

exports.deleteOne = async (id) => {
  const { rowCount } = await pool.query(`DELETE FROM masters WHERE id = $1`, [id]);
  return rowCount;
};
