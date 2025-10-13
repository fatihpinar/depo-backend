// src/services/inventoryService.js
const pool = require('../config/db');

exports.list = async ({ warehouseId=null, locationId=null, statusId=null, type='all', search='', limit=50, offset=0 }) => {
  const params = [];
  const push = v => { params.push(v); return `$${params.length}`; };

  const unionSql = `
  (
    SELECT
      'component' AS item_type,
      c.id        AS item_id,
      c.barcode,
      COALESCE(m.display_label, CONCAT('#', m.id)) AS name,
      c.unit      AS unit,
      CASE WHEN c.unit='EA' THEN 1 ELSE c.quantity END AS quantity,
      st.id       AS status_id,
      COALESCE(st.label, st.code) AS status_label,
      w.id        AS warehouse_id, w.name AS warehouse_name,
      l.id        AS location_id,  l.name AS location_name,
      c.updated_at AS updated_at
    FROM components c
    JOIN masters  m  ON m.id = c.master_id
    JOIN statuses st ON st.id = c.status_id
    LEFT JOIN warehouses w ON w.id = c.warehouse_id
    LEFT JOIN locations  l ON l.id = c.location_id
    WHERE (c.quantity > 0 OR c.unit = 'EA')
  )
  UNION ALL
  (
    SELECT
      'product' AS item_type,
      p.id      AS item_id,
      p.barcode,
      COALESCE(m.display_label, CONCAT('#', m.id)) AS name,
      m.default_unit AS unit,
      1         AS quantity,
      st.id     AS status_id,
      COALESCE(st.label, st.code) AS status_label,
      w.id      AS warehouse_id, w.name AS warehouse_name,
      l.id      AS location_id,  l.name AS location_name,
      p.updated_at AS updated_at
    FROM products p
    JOIN masters  m  ON m.id = p.master_id
    JOIN statuses st ON st.id = p.status_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN locations  l ON l.id = p.location_id
    -- NOT: status burada sabitlenmiyor; dışarıdaki filtre çalışacak
  )`;

  let where = `WHERE 1=1`;
  if (type && type !== 'all') where += ` AND inv.item_type = ${push(type)}`;
  if (warehouseId)          where += ` AND inv.warehouse_id = ${push(warehouseId)}`;
  if (locationId)           where += ` AND inv.location_id  = ${push(locationId)}`;
  if (statusId)             where += ` AND inv.status_id    = ${push(statusId)}`;
  if (search) {
    const term = `%${search}%`;
    where += ` AND (inv.barcode ILIKE ${push(term)} OR inv.name ILIKE ${push(term)})`;
  }

  // filtre parametrelerini kopyala
  const filterParams = [...params];

  // DATA
  const dataParams = [...filterParams];
  const pushData = v => { dataParams.push(v); return `$${dataParams.length}`; };

  const dataSql  = `
    SELECT * FROM (${unionSql}) inv
    ${where}
    ORDER BY inv.updated_at DESC
    LIMIT ${pushData(limit)} OFFSET ${pushData(offset)}
  `;

  // COUNT
  const countSql = `SELECT COUNT(*)::int AS total FROM (${unionSql}) inv ${where}`;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(dataSql,  dataParams),
    pool.query(countSql, filterParams),
  ]);

  return { rows: rowsRes.rows, total: countRes.rows[0].total };
};
