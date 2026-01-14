// src/modules/approvals/approvals.repository.js
const pool = require("../../core/db/index");

/* -----------------------------------------------------
 * TRANSACTION HELPER
 * --------------------------------------------------- */
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

/* -----------------------------------------------------
 * LIST (pending/prod/screenprint birleşik sorgu)
 * --------------------------------------------------- */
exports.listPendingUnion = async (
  statusToList,
  { search = "", limit, offset = 0 } = {}
) => {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  const unionSql = `
  (
    SELECT
      'component' AS kind,
      c.id,
      c.barcode,
      m.id AS master_id,
      m.bimeks_code AS bimeks_code,
      COALESCE(m.bimeks_product_name, CONCAT('#', m.id)) AS display_label,
      'EA'::text AS unit,
      1         AS quantity,
      c.width,
      c.height,
      c.area,
      c.warehouse_id,
      c.location_id,
      c.updated_at
    FROM components c
    JOIN masters m ON m.id = c.master_id
    WHERE c.status_id = ${statusToList}
  )
  UNION ALL
  (
    SELECT
      'product' AS kind,
      p.id,
      p.barcode,
      NULL::int AS master_id,
      NULL::text AS bimeks_code,
      COALESCE(p.product_name, p.bimeks_code, CONCAT('#', p.id)) AS display_label,
      'EA'::text AS unit,
      1         AS quantity,
      NULL::numeric AS width,
      NULL::numeric AS height,
      NULL::numeric AS area,
      p.warehouse_id,
      p.location_id,
      p.updated_at
    FROM products p
    WHERE p.status_id = ${statusToList}
  )
`;

  let where = "WHERE 1=1";
  if (search) {
    const term = `%${search}%`;
    where += ` AND (t.barcode ILIKE ${push(term)} OR t.display_label ILIKE ${push(term)})`;
  }

  // LIMIT opsiyonel, OFFSET her zaman uygulanabilir
  const limitSql = limit !== undefined && limit !== null ? `LIMIT ${push(Number(limit))}` : "";
  const offsetSql = offset ? `OFFSET ${push(Number(offset))}` : "";

  const sql = `
    SELECT * FROM (${unionSql}) t
    ${where}
    ORDER BY t.updated_at DESC
    ${limitSql}
    ${offsetSql}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
};


/* -----------------------------------------------------
 * LOCK / LOOKUPS / UPDATE
 * --------------------------------------------------- */
exports.lockItem = async (client, table, id) => {
  if (table === "components") {
    const { rows } = await client.query(
      `SELECT
         id,
         barcode,
         status_id,
         warehouse_id,
         location_id,
         area,
         'EA'::text AS unit
       FROM components
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    return rows[0] || null;
  }

  // products tarafı (area yok, NULL dönsün)
  const { rows } = await client.query(
    `SELECT
       id,
       barcode,
       status_id,
       warehouse_id,
       location_id,
       NULL::numeric AS area,
       'EA'::text AS unit
     FROM products
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
};


exports.getWarehouseDepartment = async (client, whId) => {
  const { rows } = await client.query(
    `SELECT department FROM warehouses WHERE id=$1`,
    [whId]
  );
  return rows[0]?.department || null; // general | production | screenprint
};

exports.hasBarcodeConflict = async (client, table, barcode, id) => {
  const { rows } = await client.query(
    `SELECT 1 FROM ${table} WHERE barcode=$1 AND id<>$2 LIMIT 1`,
    [barcode, id]
  );
  return !!rows.length;
};

exports.deleteItems = async (items = [], actorId = null) => {
  if (!Array.isArray(items) || !items.length) {
    const e = new Error("EMPTY_ITEMS");
    e.status = 400;
    throw e;
  }

  return repo.withTransaction(async (client) => {
    for (const it of items) {
      const table = KIND_TABLE[it.kind];
      if (!table) {
        const e = new Error("INVALID_KIND");
        e.status = 400;
        throw e;
      }

      // kilitle
      const prev = await repo.lockItem(client, table, it.id);
      if (!prev) {
        const e = new Error("ITEM_NOT_FOUND");
        e.status = 404;
        throw e;
      }

      // soft delete
      await repo.softDeleteItem(client, table, it.id, actorId);
    }

    return { ok: true, deleted: items.length };
  });
};


exports.softDeleteItem = async (client, table, id, actorId = null) => {
  await client.query(
    `
    UPDATE ${table}
       SET status_id = $1,
           updated_at = NOW(),
           approved_by = $2,
           approved_at = NOW()
     WHERE id = $3
    `,
    [8, actorId, id] // 👈 STATUS.deleted = 8
  );
};


exports.updateApproval = async (
  client,
  table,
  {
    toStatus,
    wh,
    lc,
    id,
    nextBarcode,
    changingBarcode,
    setApproved = false,
    actorId = null,
  }
) => {
  const sets = [
    `status_id=$1`,
    `warehouse_id=$2`,
    `location_id=$3`,
    `updated_at=NOW()`,
  ];
  const params = [toStatus, wh, lc];

  if (changingBarcode) {
    sets.splice(3, 0, `barcode=$4`); // updated_at'tan önce ekle
    params.push(nextBarcode);
  }

  if (setApproved) {
    sets.push(`approved_by=$${params.length + 1}`);
    params.push(actorId ?? null);
    sets.push(`approved_at=NOW()`);
  }

  params.push(id);

  const sql = `
    UPDATE ${table}
       SET ${sets.join(", ")}
     WHERE id=$${params.length}
  `;
  await client.query(sql, params);
};

// İstersen başka yerlerde ihtiyaç olursa diye:
exports.pool = pool;
