// src/modules/approvals/approvals.repository.js
const pool = require("../../core/db/index");

exports.withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

exports.listPendingComponents = async ({ search = "", limit = 100, offset = 0 } = {}) => {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  let where = `WHERE c.status_id = 4`; // pending

  if (search) {
    const term = `%${search}%`;
    const p = push(term);
    where += ` AND (
      c.barcode ILIKE ${p}
      OR m.display_label ILIKE ${p}
    )`;
  }

  const sql = `
    SELECT
      c.id,
      c.barcode,
      c.width,
      c.height,
      c.area,
      c.warehouse_id,
      c.location_id,
      c.updated_at,
      m.id AS master_id,
      m.display_label AS master_display_label
    FROM components c
    JOIN masters m ON m.id = c.master_id
    ${where}
    ORDER BY c.updated_at DESC
    LIMIT ${push(Number(limit))} OFFSET ${push(Number(offset))}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
};

exports.lockComponent = async (client, id) => {
  const { rows } = await client.query(
    `SELECT id, barcode, status_id, warehouse_id, location_id, area
     FROM components
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
};

exports.hasComponentBarcodeConflict = async (client, barcode, id) => {
  const { rows } = await client.query(
    `SELECT 1 FROM components WHERE barcode=$1 AND id<>$2 LIMIT 1`,
    [barcode, id]
  );
  return !!rows.length;
};

exports.updateComponentApproval = async (client, { id, barcode, wh, lc, actorId }) => {
  await client.query(
    `UPDATE components
        SET
          barcode      = $1,
          status_id    = 1,         -- in_stock
          warehouse_id = $2,
          location_id  = $3,
          approved_by  = $4,
          approved_at  = NOW(),
          updated_at   = NOW()
      WHERE id = $5`,
    [barcode, wh, lc, actorId ?? null, id]
  );
};

exports.pool = pool;
