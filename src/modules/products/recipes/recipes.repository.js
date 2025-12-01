// src/modules/products/recipes/recipes.repository.js
const pool = require("../../../core/db/index");
const { randomUUID } = require("crypto");

/* -------- LIST -------- */
/**
 * Artık master/category/type yok.
 * Tarif listesi, recipe_items içinden DISTINCT recipe_id + recipe_name ile geliyor.
 * categoryId / typeId parametrelerini imza olarak tutuyoruz ama kullanmıyoruz (geriye dönük uyum için).
 */
exports.findMany = async ({ categoryId = 0, typeId = 0, search = "" } = {}) => {
  const params = [];
  let sql = `
    SELECT
      ri.recipe_id,
      MIN(ri.recipe_name) AS recipe_name,
      MIN(ri.created_at)  AS created_at
    FROM recipe_items ri
  `;

  if (search) {
    params.push(`%${search}%`);
    sql += ` WHERE ri.recipe_name ILIKE $${params.length}`;
  }

  sql += `
    GROUP BY ri.recipe_id
    ORDER BY created_at DESC
  `;

  const { rows } = await pool.query(sql, params);

  // FE şu alanları bekliyordu: recipe_id, master_id, display_label
  // master_id artık yok → null gönderiyoruz, label için recipe_name kullanıyoruz.
  return rows.map((r) => ({
    recipe_id: r.recipe_id,
    recipe_name: r.recipe_name,
    master_id: null,
    display_label: r.recipe_name || r.recipe_id,
  }));
};

/* -------- ITEMS -------- */

// src/modules/products/recipes/recipes.repository.js

exports.findItems = async (recipeId) => {
  const sql = `
    SELECT
      ri.component_master_id,
      pm.bimeks_product_name AS component_label,  -- 🔧 tek isim kaynağı
      ri.qty AS quantity,
      ri.unit
    FROM recipe_items ri
    JOIN masters pm ON pm.id = ri.component_master_id
    WHERE ri.recipe_id = $1
    ORDER BY ri.id ASC
  `;
  const { rows } = await pool.query(sql, [recipeId]);
  return rows;
};


/* -------- CREATE yardımcıları -------- */

/**
 * Aynı isimde tarif var mı? (case-insensitive)
 */
exports.lockNameConflict = async (client, recipe_name) => {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM recipe_items
      WHERE LOWER(recipe_name) = LOWER($1)
      LIMIT 1
    `,
    [recipe_name]
  );
  return !!rows.length;
};

/**
 * Tarif satırlarını ekler.
 * items: [{ component_master_id, quantity, unit? }]
 */
exports.insertRecipeItems = async (
  client,
  recipe_id,
  recipe_name,
  items /* [{component_master_id, quantity, unit}] */
) => {
  if (!items.length) return;

  const cols = ["recipe_id", "recipe_name", "component_master_id", "qty", "unit"];
  const vals = [];
  const params = [];
  let i = 0;

  for (const it of items) {
    vals.push(
      `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5})`
    );
    params.push(
      recipe_id,
      recipe_name,
      it.component_master_id,
      it.quantity,
      it.unit || "EA"
    );
    i += 5;
  }

  await client.query(
    `INSERT INTO recipe_items (${cols.join(",")}) VALUES ${vals.join(",")}`,
    params
  );
};

/* -------- CREATE (transaction) -------- */
/**
 * Yeni tarif oluşturur.
 * Beklenen payload şekli:
 * {
 *   recipe_name: "Kırmızı Bant 50mm",
 *   items: [{ component_master_id, quantity, unit? }]
 * }
 */
exports.createRecipe = async (payload = {}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const recipe_name = String(payload.recipe_name || "").trim();
    const rawItems = Array.isArray(payload.items) ? payload.items : [];

    if (!recipe_name || !rawItems.length) {
      const e = new Error("MISSING_FIELDS");
      e.status = 400;
      e.code = "MISSING_FIELDS";
      throw e;
    }

    // Benzersizlik kontrolü (isim bazlı)
    const hasConflict = await exports.lockNameConflict(client, recipe_name);
    if (hasConflict) {
      const e = new Error("RECIPE_NAME_CONFLICT");
      e.status = 409;
      e.code = "RECIPE_NAME_CONFLICT";
      throw e;
    }

    // Tarif ID
    const recipe_id = randomUUID();

    // Aynı master için miktarları toparlayalım
    const totals = new Map(); // master_id -> { quantity, unit }
    for (const it of rawItems) {
      const mid = Number(it.component_master_id || 0);
      const q = Number(it.quantity || 0);
      if (!mid || q <= 0) continue;

      const prev = totals.get(mid) || { quantity: 0, unit: it.unit || "EA" };
      totals.set(mid, {
        quantity: prev.quantity + q,
        unit: it.unit || prev.unit || "EA",
      });
    }

    const items = Array.from(totals.entries()).map(
      ([component_master_id, v]) => ({
        component_master_id,
        quantity: v.quantity,
        unit: v.unit || "EA",
      })
    );

    if (!items.length) {
      const e = new Error("MISSING_ITEMS");
      e.status = 400;
      e.code = "MISSING_ITEMS";
      throw e;
    }

    await exports.insertRecipeItems(client, recipe_id, recipe_name, items);

    await client.query("COMMIT");
    return { recipe_id, recipe_name };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
