// src/modules/recipes/recipes.repo.js
const pool = require("../../core/db/index");

/* -------- LIST -------- */
exports.list = async ({ search = "" } = {}) => {
  const params = [];
  let sql = `
    SELECT id, recipe_name
    FROM recipes
  `;

  if (search) {
    params.push(`%${search}%`);
    sql += ` WHERE recipe_name ILIKE $1`;
  }

  sql += ` ORDER BY id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
};

/* -------- ITEMS -------- */
exports.getItems = async (recipeId) => {
  const { rows } = await pool.query(
    `
    SELECT
      component_master_id,
      qty,
      unit
    FROM recipe_items
    WHERE recipe_id = $1
    ORDER BY id ASC
    `,
    [recipeId]
  );
  return rows;
};

/* -------- CREATE -------- */
exports.create = async ({ recipe_name, items }) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO recipes (recipe_name)
       VALUES ($1)
       RETURNING id, recipe_name`,
      [recipe_name]
    );

    const recipe = rows[0];

    const values = [];
    const params = [];
    let i = 1;

    for (const it of items) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(
        recipe.id,
        it.component_master_id,
        it.qty,
        it.unit || "EA"
      );
    }

    await client.query(
      `
      INSERT INTO recipe_items (recipe_id, component_master_id, qty, unit)
      VALUES ${values.join(",")}
      `,
      params
    );

    await client.query("COMMIT");
    return recipe;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
