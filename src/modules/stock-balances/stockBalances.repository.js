// src/modules/stock-balances/stockBalances.repository.js
const pool = require("../../core/db");

/**
 * Stok bakiyesini upsert eder:
 *  - quantity   → adet (EA satırlarında)
 *  - area_sum   → alan (m² satırlarında)
 *
 * Eski payload ile uyum için:
 *  - master_id veya item_id gelebilir (master_id > item_id)
 *  - delta  -> quantity_delta
 *  - area_delta opsiyonel
 */
async function upsertDelta(client, payload) {
  const {
    item_type,
    master_id,
    warehouse_id,
    location_id,
    status_id,
    unit,          // 'EA', 'KG', 'M' gibi. **ASLA 'm²' yapmıyoruz**
    qty_delta = 0,
    area_delta = 0,
  } = payload;

  const q = Number(qty_delta) || 0;
  const a = Number(area_delta) || 0;

  if (!Number.isFinite(q) || !Number.isFinite(a)) {
    throw new Error("Invalid qty/area delta");
  }
  // İkisi de 0 ise boşuna DB’ye gitme
  if (q === 0 && a === 0) return;

  const sql = `
    INSERT INTO stock_balances
      (item_type, master_id, warehouse_id, location_id, status_id, unit, quantity, area_sum)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (item_type, master_id, warehouse_id, location_id, status_id, unit)
    DO UPDATE SET
      quantity = stock_balances.quantity + EXCLUDED.quantity,
      area_sum = stock_balances.area_sum + EXCLUDED.area_sum,
      updated_at = now()
  `;

  const params = [
    item_type,
    master_id,
    warehouse_id,
    location_id,
    status_id,
    unit,
    q,
    a,
  ];

  if (client) {
    return client.query(sql, params);
  }

  const c = await pool.connect();
  try {
    await c.query(sql, params);
  } finally {
    c.release();
  }
}

/**
 * Yeni fonksiyon: bir master (tanım) için stok özetini döner.
 * İsteğe bağlı filtreler:
 *  - warehouseId
 *  - statusId
 */
async function getMasterSummary({ masterId, warehouseId = 0, statusId = 0 }) {
  if (!masterId) {
    throw new Error("masterId required");
  }

  const params = [masterId];
  const where = ["sb.master_id = $1"];

  if (warehouseId > 0) {
    params.push(warehouseId);
    where.push(`sb.warehouse_id = $${params.length}`);
  }

  if (statusId > 0) {
    params.push(statusId);
    where.push(`sb.status_id = $${params.length}`);
  }

  const sql = `
    SELECT
      sb.master_id,

      sb.warehouse_id,
      w.name AS warehouse_name,

      sb.location_id,
      l.name AS location_name,

      sb.status_id,
      st.label AS status_label,
      st.code  AS status_code,

      sb.unit,

      SUM(sb.quantity) AS unit_count,
      SUM(sb.area_sum) AS total_area

    FROM stock_balances sb
    LEFT JOIN warehouses w ON w.id = sb.warehouse_id
    LEFT JOIN locations  l ON l.id = sb.location_id
    LEFT JOIN statuses   st ON st.id = sb.status_id
    WHERE ${where.join(" AND ")}
    GROUP BY
      sb.master_id,
      sb.warehouse_id, w.name,
      sb.location_id,  l.name,
      sb.status_id,    st.label, st.code,
      sb.unit
    ORDER BY
      warehouse_name NULLS LAST,
      location_name  NULLS LAST,
      sb.status_id,
      sb.unit;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

module.exports = {
  upsertDelta,
  getMasterSummary,
};
