const pool = require("../../core/db/index");
const { randomUUID } = require("crypto");
const { ITEM_TYPE, ACTION } = require("./transitions.constants");

/**
 * @typedef {Object} TransitionRecord
 * @property {"component"|"product"} item_type
 * @property {number} item_id
 * @property {keyof typeof ACTION} action
 * @property {number} [qty_delta=0]
 * @property {string} unit
 * @property {number|null} [from_status_id]
 * @property {number|null} [to_status_id]
 * @property {number|null} [from_warehouse_id]
 * @property {number|null} [from_location_id]
 * @property {number|null} [to_warehouse_id]
 * @property {number|null} [to_location_id]
 * @property {string|null} [context_type]
 * @property {number|null} [context_id]
 * @property {string|null} [notes]
 * @property {Object} [meta]
 */

function validateRecord(r) {
  if (!r || typeof r !== "object") return "record is empty";
  if (!r.item_type || ![ITEM_TYPE.COMPONENT, ITEM_TYPE.PRODUCT].includes(r.item_type)) return "invalid item_type";
  if (!r.item_id || Number.isNaN(Number(r.item_id))) return "invalid item_id";
  if (!r.action || !Object.values(ACTION).includes(r.action)) return "invalid action";
  if (!r.unit || typeof r.unit !== "string") return "unit is required";
  return null;
}

function makeBatchId() {
  return randomUUID();
}

/**
 * Kayıt atar. 4. parametre geri uyumluluk için iki şekilde verilebilir:
 *   - number: actorUserId
 *   - object: { actorId?: number, enrichMeta?: boolean }
 *
 * enrichMeta=true iken meta içine batch_id enjekte edilir (actor ayrı kolonda tutuluyor).
 */
async function recordTransitions(client, batchId, records, optsOrActor = null) {
  if (!Array.isArray(records) || records.length === 0) return;

  for (const r of records) {
    const err = validateRecord(r);
    if (err) throw new Error(`recordTransitions validation: ${err}`);
  }

  // opts parse (geri uyumlu)
  let actorId = null;
  let enrichMeta = true;
  if (typeof optsOrActor === "number") {
    actorId = optsOrActor;
  } else if (optsOrActor && typeof optsOrActor === "object") {
    actorId = optsOrActor.actorId ?? null;
    if (typeof optsOrActor.enrichMeta === "boolean") enrichMeta = optsOrActor.enrichMeta;
  }

  const cols = [
    "batch_id","item_type","item_id","action","qty_delta","unit",
    "from_status_id","to_status_id",
    "from_warehouse_id","from_location_id","to_warehouse_id","to_location_id",
    "context_type","context_id","actor_user_id","notes","meta",
  ];

  const values = [];
  const placeholders = [];

  records.forEach((r, i) => {
    const base = i * cols.length;
    placeholders.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17})`
    );

    const meta = r.meta || {};
    const finalMeta = enrichMeta ? { ...meta, batch_id: batchId } : meta;

    values.push(
      batchId,
      r.item_type,
      Number(r.item_id),
      r.action,
      Number(r.qty_delta ?? 0),
      r.unit,
      r.from_status_id ?? null,
      r.to_status_id ?? null,
      r.from_warehouse_id ?? null,
      r.from_location_id ?? null,
      r.to_warehouse_id ?? null,
      r.to_location_id ?? null,
      r.context_type ?? null,
      r.context_id ?? null,
      actorId ?? null,
      r.notes ?? null,
      JSON.stringify(finalMeta)
    );
  });

  const sql = `
    INSERT INTO inventory_transitions
      (${cols.join(", ")})
    VALUES
      ${placeholders.join(", ")}
  `;

  if (!client) {
    const own = await pool.connect();
    try {
      await own.query("BEGIN");
      await own.query(sql, values);
      await own.query("COMMIT");
    } catch (e) {
      await own.query("ROLLBACK");
      throw e;
    } finally {
      own.release();
    }
    return;
  }

  await client.query(sql, values);
}

async function listTransitions({ itemType, itemId, limit = 50, cursorId = null }) {
  if (!itemType || !itemId) throw new Error("listTransitions: itemType & itemId required");

  const params = [itemType, Number(itemId)];
  let sql = `
    SELECT
      id, batch_id, item_type, item_id, action, qty_delta, unit,
      from_status_id, to_status_id,
      from_warehouse_id, from_location_id, to_warehouse_id, to_location_id,
      context_type, context_id, actor_user_id, notes, meta, created_at
    FROM inventory_transitions
    WHERE item_type = $1 AND item_id = $2
  `;

  if (cursorId) {
    params.push(Number(cursorId));
    sql += ` AND id < $${params.length}`;
  }

  params.push(Number(limit));
  sql += ` ORDER BY id DESC LIMIT $${params.length}`;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function list({
  item_type,
  item_id,
  limit = 50,
  offset = 0,
  actions = [],
  fromDate,
  toDate,
} = {}) {
  if (!item_type || !item_id) {
    const e = new Error("item_type ve item_id zorunlu");
    e.status = 400;
    throw e;
  }

  const where = ["t.item_type = $1", "t.item_id = $2"];
  const params = [item_type, Number(item_id)];

  if (Array.isArray(actions) && actions.length) {
    params.push(actions);
    where.push(`t.action = ANY($${params.length})`);
  }
  if (fromDate) {
    params.push(fromDate);
    where.push(`t.created_at >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    where.push(`t.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const baseSql = `
    FROM inventory_transitions t
    LEFT JOIN statuses   fs ON fs.id = t.from_status_id
    LEFT JOIN statuses   ts ON ts.id = t.to_status_id
    LEFT JOIN warehouses fw ON fw.id = t.from_warehouse_id
    LEFT JOIN warehouses tw ON tw.id = t.to_warehouse_id
    LEFT JOIN locations  fl ON fl.id = t.from_location_id
    LEFT JOIN locations  tl ON tl.id = t.to_location_id

    LEFT JOIN components c ON (t.item_type = 'component' AND c.id = t.item_id)
    LEFT JOIN products   p ON (t.item_type = 'product'   AND p.id = t.item_id)

    LEFT JOIN warehouses cw ON cw.id = COALESCE(t.to_warehouse_id, t.from_warehouse_id, c.warehouse_id, p.warehouse_id)
    LEFT JOIN locations  cl ON cl.id = COALESCE(t.to_location_id,  t.from_location_id,  c.location_id,  p.location_id)

    WHERE ${where.join(" AND ")}
  `;

  const dataSql = `
    SELECT
      t.id, t.batch_id, t.item_type, t.item_id, t.action,
      t.qty_delta, t.unit,
      t.from_status_id, t.to_status_id,
      t.from_warehouse_id, t.from_location_id,
      t.to_warehouse_id,   t.to_location_id,
      t.context_type, t.context_id,
      t.actor_user_id, t.created_at,
      t.notes, t.meta,

      fs.label AS from_status_label,
      ts.label AS to_status_label,

      fw.name  AS from_warehouse_name,
      tw.name  AS to_warehouse_name,
      fl.name  AS from_location_name,
      tl.name  AS to_location_name,

      cw.name  AS current_warehouse_name,
      cl.name  AS current_location_name
    ${baseSql}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const countSql = `SELECT COUNT(*)::int AS total ${baseSql}`;

  const dataParams = [...params, Number(limit), Number(offset)];

  const [rowsRes, countRes] = await Promise.all([
    pool.query(dataSql, dataParams),
    pool.query(countSql, params),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0]?.total ?? 0,
  };
}

module.exports = {
  // helpers
  makeBatchId,
  recordTransitions,
  listTransitions,

  // query API
  list,

  // re-export enums
  ITEM_TYPE,
  ACTION,
};
