// src/modules/products/products.repository.js
const pool = require("../../core/db/index");

/* ---------- READ: LIST ---------- */

// src/modules/products/products.repository.js

exports.findMany = async (filters = {}) => {
  const { warehouseId, statusId, search } = filters;

  let sql = `
    SELECT
      p.id,
      p.barcode,
      p.bimeks_code,
      p.product_name,
      p.recipe_id,
      p.status_id,
      p.warehouse_id,
      p.location_id,
      p.created_by,
      p.approved_by,
      p.created_at,
      p.updated_at,
      p.approved_at,
      p.notes,
      w.name AS warehouse_name,
      l.name AS location_name,
      st.id   AS status_id,
      st.code AS status_code,
      st.label AS status_label,
      ucr.username AS created_by_username,
      ucr.full_name AS created_by_full_name,
      uap.username AS approved_by_username,
      uap.full_name AS approved_by_full_name
    FROM products p
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN locations  l ON l.id = p.location_id
    JOIN statuses st       ON st.id = p.status_id
    LEFT JOIN users ucr    ON ucr.id = p.created_by
    LEFT JOIN users uap    ON uap.id = p.approved_by
  `;

  const where = [];
  const params = [];

  // Depo filtresi
  if (warehouseId) {
    params.push(warehouseId);
    where.push(`p.warehouse_id = $${params.length}`);
  }

  // Statü filtresi 👈 YENİ
  if (statusId) {
    params.push(statusId);
    where.push(`p.status_id = $${params.length}`);
  }

  // Arama filtresi
  if (search) {
    const term = `%${search}%`;
    params.push(term); const p1 = params.length;
    params.push(term); const p2 = params.length;
    params.push(term); const p3 = params.length;

    where.push(`(
      p.barcode ILIKE $${p1}
      OR COALESCE(p.product_name, '') ILIKE $${p2}
      OR COALESCE(p.bimeks_code, '') ILIKE $${p3}
    )`);
  }

  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }

  sql += ` ORDER BY p.id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
};


/* ---------- READ: DETAIL ---------- */

exports.findById = async (id) => {
  const sql = `
    SELECT
      p.*,
      w.id   AS warehouse_id,
      w.name AS warehouse_name,
      l.id   AS location_id,
      l.name AS location_name,
      st.id   AS status_id,
      st.code AS status_code,
      st.label AS status_label,
      ucr.username AS created_by_name,
      uap.username AS approved_by_name
    FROM products p
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN locations  l ON l.id = p.location_id
    JOIN statuses st       ON st.id = p.status_id
    LEFT JOIN users ucr    ON ucr.id = p.created_by
    LEFT JOIN users uap    ON uap.id = p.approved_by
    WHERE p.id = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
};

/* ---------- READ: COMPONENTS OF PRODUCT ---------- */

exports.findComponentsOfProduct = async (productId) => {
  const sql = `
    SELECT
      pc.id                  AS link_id,
      c.id                   AS component_id,
      c.barcode,
      c.area,
      c.area                 AS quantity,
      pc.consume_qty,
      mm.id                  AS comp_master_id,
      mm.bimeks_product_name AS comp_master_name,
      mm.stock_unit          AS unit
    FROM product_components pc
    JOIN components c ON c.id = pc.component_id
    JOIN masters mm   ON mm.id = c.master_id
    WHERE pc.product_id = $1
    ORDER BY pc.id ASC
  `;

  const { rows } = await pool.query(sql, [productId]);
  return rows;
};

/* ---------- MUTATION HELPERS (TRANSACTIONAL) ---------- */

exports.lockComponentById = async (client, id) => {
  const { rows } = await client.query(
    `
      SELECT
        c.id,
        c.master_id,
        c.barcode,
        c.width,
        c.height,
        c.area,
        c.area AS quantity,
        c.status_id,
        c.warehouse_id,
        c.location_id,
        m.stock_unit AS unit
      FROM components c
      JOIN masters m ON m.id = c.master_id
      WHERE c.id = $1
      FOR UPDATE
    `,
    [id]
  );

  return rows[0] || null;
};

exports.lockProductExists = async (client, id) => {
  const { rows } = await client.query(
    `SELECT id FROM products WHERE id=$1 FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
};

exports.isProductBarcodeTaken = async (client, code, exceptId) => {
  const { rows } = await client.query(
    `SELECT 1 FROM products WHERE barcode=$1 AND id<>$2 LIMIT 1`,
    [code, exceptId]
  );
  return !!rows.length;
};

exports.updateProductFields = async (client, id, fields = {}) => {
  const keys = Object.keys(fields);
  if (!keys.length) {
    const { rows } = await client.query(
      `SELECT id, barcode, bimeks_code, status_id, warehouse_id, location_id, notes
       FROM products WHERE id=$1`,
      [id]
    );
    return rows[0];
  }

  const sets = [];
  const params = [];

  keys.forEach((k, i) => {
    sets.push(`${k}=$${i + 1}`);
    params.push(fields[k]);
  });

  // approved_by varsa approved_at’i otomatik doldur
  if (fields.approved_by !== undefined && fields.approved_at === undefined) {
    sets.push(`approved_at=NOW()`);
  }

  params.push(id);
  const { rows } = await client.query(
    `UPDATE products
        SET ${sets.join(", ")}, updated_at=NOW()
      WHERE id=$${keys.length + 1}
      RETURNING id, barcode, bimeks_code, status_id, warehouse_id, location_id, notes`,
    params
  );
  return rows[0];
};

exports.insertProduct = async (client, p) => {
  const cols = [
    "barcode",
    "bimeks_code",
    "status_id",
    "warehouse_id",
    "location_id",
    "product_name",
    "recipe_id",
    "created_by",
    "created_at",
    "updated_at",
  ];

  const vals = [
    p.barcode ?? null,
    p.bimeks_code ?? null,
    p.status_id,
    p.warehouse_id ?? null,
    p.location_id ?? null,
    p.product_name ?? null,
    p.recipe_id ?? null,
    p.created_by ?? null,
  ];

  const { rows } = await client.query(
    `INSERT INTO products (${cols.join(",")})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW(), NOW())
     RETURNING id`,
    vals
  );
  return rows[0].id;
};

/* ---------- COMPONENT UPDATE HELPERS ---------- */
/**
 * Alan / durum vs. güncellemesi.
 * fields.quantity gelirse DB’de area kolonuna map’liyoruz.
 */
exports.updateComponentFields = async (client, id, fields = {}) => {
  const sourceKeys = Object.keys(fields);
  if (!sourceKeys.length) {
    const { rows } = await client.query(
      `SELECT id, area, area AS quantity, status_id, warehouse_id, location_id, master_id
       FROM components WHERE id=$1`,
      [id]
    );
    return rows[0];
  }

  const dbFields = {};
  for (const k of sourceKeys) {
    if (k === "quantity") {
      dbFields["area"] = fields[k];
    } else {
      dbFields[k] = fields[k];
    }
  }

  const keys = Object.keys(dbFields);
  const sets = [];
  const params = [];

  keys.forEach((k, i) => {
    sets.push(`${k}=$${i + 1}`);
    params.push(dbFields[k]);
  });

  params.push(id);
  const { rows } = await client.query(
    `UPDATE components
       SET ${sets.join(", ")}, updated_at=NOW()
     WHERE id=$${keys.length + 1}
     RETURNING *`,
    params
  );
  return rows[0];
};

/**
 * Eski isim korunuyor ama quantity artık area kolonu:
 *  quantity = quantity + inc  ->  area = area + inc
 */
exports.incrementComponentQtyAndSet = async (client, id, inc, unit, alsoSet = {}) => {
  const unitKey = String(unit || "").trim().toLowerCase().replace("²", "2");

  let numericColumn = "area";

  if (unitKey === "weight" || unitKey === "kg" || unitKey === "ağırlık (kg)") {
    numericColumn = "weight";
  } else if (unitKey === "length" || unitKey === "m" || unitKey === "uzunluk (m)") {
    numericColumn = "length";
  } else if (unitKey === "volume" || unitKey === "lt" || unitKey === "hacim (lt)") {
    numericColumn = "volume";
  } else if (unitKey === "box_unit" || unitKey === "ea" || unitKey === "koli içi adet (ea)") {
    numericColumn = "box_unit";
  }

  const dbAlsoSet = { ...alsoSet };
  const keys = Object.keys(dbAlsoSet);
  const sets = [`${numericColumn} = COALESCE(${numericColumn}, 0) + $1`];
  const params = [inc];

  keys.forEach((k, i) => {
    sets.push(`${k}=$${i + 2}`);
    params.push(dbAlsoSet[k]);
  });

  params.push(id);

  await client.query(
    `UPDATE components
       SET ${sets.join(", ")}, updated_at=NOW()
     WHERE id=$${keys.length + 2}`,
    params
  );
};

exports.insertProductComponentLink = async (client, { product_id, component_id, consume_qty }) => {
  const { rows } = await client.query(
    `INSERT INTO product_components (product_id, component_id, consume_qty, created_at)
     VALUES ($1,$2,$3, NOW()) RETURNING id`,
    [product_id, component_id, consume_qty]
  );
  return rows[0].id;
};

exports.deleteProductComponentLink = async (client, linkId) => {
  await client.query(`DELETE FROM product_components WHERE id=$1`, [linkId]);
};

exports.addAuditAndDecreaseLink = async (client, { linkId, returned_delta = 0, scrapped_delta = 0 }) => {
  await client.query(
    `UPDATE product_components
       SET consume_qty = consume_qty - $1,
           returned_qty = COALESCE(returned_qty,0) + $2,
           scrapped_qty = COALESCE(scrapped_qty,0) + $3
     WHERE id=$4`,
    [returned_delta + scrapped_delta, returned_delta, scrapped_delta, linkId]
  );
};

exports.lockLinkWithComponent = async (client, { linkId, productId, compId }) => {
  const { rows } = await client.query(
    `
      SELECT 
        pc.id           AS link_id,
        pc.product_id,
        pc.consume_qty  AS consume_qty,
        pc.returned_qty AS returned_qty,
        pc.scrapped_qty AS scrapped_qty,
        c.id            AS component_id,
        c.barcode,
        c.width,
        c.height,
        c.area          AS quantity,
        c.area,
        c.master_id,
        c.status_id,
        c.warehouse_id,
        c.location_id,
        m.stock_unit    AS unit
      FROM product_components pc
      JOIN components c ON c.id = pc.component_id
      JOIN masters m    ON m.id = c.master_id
      WHERE pc.id = $1
        AND pc.product_id = $2
        AND pc.component_id = $3
      FOR UPDATE
    `,
    [linkId, productId, compId]
  );

  return rows[0] || null;
};

exports.isComponentBarcodeTaken = async (client, code) => {
  const { rows } = await client.query(
    `SELECT 1 FROM components WHERE barcode=$1 LIMIT 1`,
    [code]
  );
  return !!rows.length;
};

/**
 * Yeni component oluşturma.
 * Parametrelerde quantity geliyor ama DB’de area kolonuna yazıyoruz.
 * unit parametresi artık tabloya gitmiyor.
 */
exports.createComponent = async (client, {
  master_id,
  barcode,
  unit,
  quantity,
  width = null,
  height = null,
  status_id,
  warehouse_id = null,
  location_id = null,
  is_scrap = false,
  notes = null,
  created_by = null,
}) => {
  const unitKey = String(unit || "").trim().toLowerCase().replace("²", "2");

  let area = null;
  let weight = null;
  let length = null;
  let volume = null;
  let box_unit = null;

  if (unitKey === "area" || unitKey === "m2" || unitKey === "alan (m2)" || unitKey === "alan (m²)") {
    area = quantity ?? null;
  } else if (unitKey === "weight" || unitKey === "kg" || unitKey === "ağırlık (kg)") {
    weight = quantity ?? null;
    width = null;
    height = null;
  } else if (unitKey === "length" || unitKey === "m" || unitKey === "uzunluk (m)") {
    length = quantity ?? null;
    width = null;
    height = null;
  } else if (unitKey === "volume" || unitKey === "lt" || unitKey === "hacim (lt)") {
    volume = quantity ?? null;
    width = null;
    height = null;
  } else if (unitKey === "box_unit" || unitKey === "ea" || unitKey === "koli içi adet (ea)") {
    box_unit = quantity ?? null;
    width = null;
    height = null;
  }

  const cols = [
    "master_id",
    "barcode",
    "status_id",
    "warehouse_id",
    "location_id",
    "is_scrap",
    "created_by",
    "created_at",
    "updated_at",
    "notes",
    "width",
    "height",
    "area",
    "weight",
    "length",
    "volume",
    "box_unit",
  ];

  const vals = [
    master_id,
    barcode ?? null,
    status_id,
    warehouse_id,
    location_id,
    is_scrap ? true : false,
    created_by,
    notes,
    width ?? null,
    height ?? null,
    area,
    weight,
    length,
    volume,
    box_unit,
  ];

  const { rows } = await client.query(
    `INSERT INTO components (${cols.join(",")})
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOW(), NOW(), $8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id, barcode, width, height, area, weight, length, volume, box_unit`,
    vals
  );

  return rows[0];
};

/* ---------- LOST BARCODE SEQ ---------- */

exports.ensureLostSeq = async (client) => {
  await client.query(`CREATE SEQUENCE IF NOT EXISTS lost_component_seq START 1;`);
};

exports.generateLostBarcode = async (client) => {
  await exports.ensureLostSeq(client);
  const { rows } = await client.query(`SELECT nextval('lost_component_seq') AS seq;`);
  const n = String(rows[0].seq).padStart(9, "0");
  return `L${n}`;
};
