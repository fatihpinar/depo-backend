// src/modules/products/recipes/recipes.repository.js
const pool = require("../../../core/db/index");
const { randomUUID } = require("crypto");

/* -------- LIST -------- */
exports.findMany = async ({ categoryId = 0, typeId = 0, search = "" } = {}) => {
  const params = [];
  let sql = `
    SELECT
      m.id AS master_id,
      m.recipe_id,
      m.recipe_name,
      COALESCE(m.display_label, m.recipe_name) AS display_label
    FROM masters m
    WHERE m.recipe_id IS NOT NULL
  `;
  if (categoryId > 0) { params.push(categoryId); sql += ` AND m.category_id = $${params.length}`; }
  if (typeId     > 0) { params.push(typeId);     sql += ` AND m.type_id     = $${params.length}`; }
  if (search) {
    const term = `%${search}%`;
    params.push(term); const p = params.length;
    sql += ` AND (m.recipe_name ILIKE $${p} OR m.display_label ILIKE $${p})`;
  }
  sql += ` ORDER BY m.id DESC`;
  const { rows } = await pool.query(sql, params);
  return rows;
};

/* -------- ITEMS -------- */
exports.findItems = async (recipeId) => {
  const sql = `
    SELECT
      ri.component_master_id,
      COALESCE(cm.display_label, cm.recipe_name) AS component_label,
      ri.qty AS quantity,
      ri.unit
    FROM recipe_items ri
    JOIN masters cm ON cm.id = ri.component_master_id
    WHERE ri.recipe_id = $1
    ORDER BY ri.id ASC
  `;
  const { rows } = await pool.query(sql, [recipeId]);
  return rows;
};

/* -------- CREATE (helpers) -------- */
exports.lockNameConflict = async (client, { category_id, type_id, recipe_name }) => {
  const { rows } = await client.query(
    `SELECT 1
       FROM masters
      WHERE recipe_id IS NOT NULL
        AND category_id = $1
        AND type_id     = $2
        AND LOWER(recipe_name) = LOWER($3)
      LIMIT 1`,
    [category_id, type_id, recipe_name]
  );
  return !!rows.length;
};

exports.insertRecipeMaster = async (client, { category_id, type_id, recipe_id, recipe_name }) => {
  const { rows } = await client.query(
    `INSERT INTO masters
       (category_id, type_id, display_label, recipe_id, recipe_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5, NOW(), NOW())
     RETURNING id`,
    [category_id, type_id, recipe_name, recipe_id, recipe_name]
  );
  return rows[0].id;
};

exports.insertRecipeItems = async (client, recipe_id, items /* [{component_master_id, quantity, unit}] */) => {
  if (!items.length) return;
  const cols = ["recipe_id", "component_master_id", "qty", "unit"];
  const vals = [];
  const params = [];
  let i = 0;
  for (const it of items) {
    vals.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4})`);
    params.push(recipe_id, it.component_master_id, it.quantity, it.unit || "EA");
    i += 4;
  }
  await client.query(
    `INSERT INTO recipe_items (${cols.join(",")}) VALUES ${vals.join(",")}`,
    params
  );
};

/* -------- CREATE (transaction) -------- */
exports.createRecipe = async (payload = {}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const master = payload.master || {};
    const rawItems = Array.isArray(payload.items) ? payload.items : [];

    const category_id = Number(master.category_id || 0);
    const type_id     = Number(master.type_id || 0);
    const recipe_name = String(master.recipe_name || "").trim();

    if (!category_id || !type_id || !recipe_name) {
      const e = new Error("MISSING_FIELDS");
      e.status = 400; e.code = "MISSING_FIELDS"; throw e;
    }

    // benzersizlik
    const hasConflict = await exports.lockNameConflict(client, { category_id, type_id, recipe_name });
    if (hasConflict) {
      const e = new Error("RECIPE_NAME_CONFLICT");
      e.status = 409; e.code = "RECIPE_NAME_CONFLICT"; throw e;
    }

    // master
    const recipe_id = randomUUID();
    const master_id = await exports.insertRecipeMaster(client, {
      category_id, type_id, recipe_id, recipe_name,
    });

    // items: aynı master toplanır, qty>0
    const totals = new Map(); // master_id -> qty
    for (const it of rawItems) {
      const mid = Number(it.component_master_id || 0);
      const q   = Number(it.quantity || 0);
      if (!mid || q <= 0) continue;
      totals.set(mid, (totals.get(mid) || 0) + q);
    }

    if (totals.size) {
      const items = Array.from(totals.entries()).map(([component_master_id, quantity]) => ({
        component_master_id, quantity, unit: "EA",
      }));
      await exports.insertRecipeItems(client, recipe_id, items);
    }

    await client.query("COMMIT");
    return { master_id, recipe_id, recipe_name };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
