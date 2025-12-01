// src/services/inventoryService.js
const pool = require("../core/db/index");

exports.list = async ({
  warehouseId = null,
  locationId = null,
  statusId = null,
  type = "all",
  search = "",
  limit = 50,
  offset = 0,
  inStockOnly = false, // <- opsiyon
}) => {
  // inStockOnly aktifse ve statusId gelmemişse 1 (in_stock) olarak sabitle
  if (
    inStockOnly &&
    (statusId === null || statusId === undefined || statusId === "")
  ) {
    statusId = 1;
  }

  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  // COMPONENT + PRODUCT union
  const unionSql = `
    (
      SELECT
        'component' AS item_type,
        c.id        AS item_id,
        c.barcode   AS barcode,
        COALESCE(m.bimeks_product_name, CONCAT('#', m.id)) AS name,
        m.length_unit AS unit,
        c.area::float8 AS quantity,           -- 🔴 BURAYI DEĞİŞTİRDİK
        st.id       AS status_id,
        COALESCE(st.label, st.code) AS status_label,
        w.id        AS warehouse_id, w.name AS warehouse_name,
        l.id        AS location_id,  l.name AS location_name,
        c.updated_at AS updated_at
      FROM components c
      JOIN masters   m  ON m.id = c.master_id
      JOIN statuses  st ON st.id = c.status_id
      LEFT JOIN warehouses w ON w.id = c.warehouse_id
      LEFT JOIN locations  l ON l.id = c.location_id
      WHERE c.area > 0
    )
    UNION ALL
    (
      SELECT
        'product' AS item_type,
        p.id      AS item_id,
        p.barcode AS barcode,
        COALESCE(p.product_name, CONCAT('#', p.id)) AS name,
        'Adet'    AS unit,
        1         AS quantity,
        st.id     AS status_id,
        COALESCE(st.label, st.code) AS status_label,
        w.id      AS warehouse_id, w.name AS warehouse_name,
        l.id      AS location_id,  l.name AS location_name,
        p.updated_at AS updated_at
      FROM products p
      JOIN statuses st ON st.id = p.status_id
      LEFT JOIN warehouses w ON w.id = p.warehouse_id
      LEFT JOIN locations  l ON l.id = p.location_id
    )
  `;

  // ---- Filtreler ----
  let where = `WHERE 1=1`;
  if (type && type !== "all") where += ` AND inv.item_type   = ${push(type)}`;
  if (warehouseId) where += ` AND inv.warehouse_id = ${push(warehouseId)}`;
  if (locationId) where += ` AND inv.location_id  = ${push(locationId)}`;
  if (statusId) where += ` AND inv.status_id    = ${push(statusId)}`;
  if (search) {
    const term = `%${search}%`;
    where += ` AND (inv.barcode ILIKE ${push(term)} OR inv.name ILIKE ${push(term)})`;
  }

  const filterParams = [...params];

  // data query paramları (limit/offset dahil)
  const dataParams = [...filterParams];
  const pushData = (v) => {
    dataParams.push(v);
    return `$${dataParams.length}`;
  };

  const dataSql = `
    SELECT *
    FROM (${unionSql}) inv
    ${where}
    ORDER BY inv.updated_at DESC
    LIMIT ${pushData(limit)} OFFSET ${pushData(offset)}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM (${unionSql}) inv
    ${where}
  `;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(dataSql, dataParams),
    pool.query(countSql, filterParams),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0]?.total ?? 0,
  };
};
