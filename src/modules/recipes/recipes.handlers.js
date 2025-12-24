// src/modules/recipes/recipes.handlers.js
const repo = require("./recipes.repo");
const pool = require("../../core/db/index");

exports.list = async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const rows = await repo.list({ search });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Internal error" });
  }
};

exports.getItems = async (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    if (!recipeId) return res.status(400).json({ message: "Invalid recipe id" });

    // İstersen repo.getItems ile raw items
    const items = await repo.getItems(recipeId);

    // Eğer FE component_label istiyorsa (senin FE bunu bekliyor), label join'li query lazım.
    // Bunu iki şekilde yapabiliriz:
    // A) repo.getItemsJoined yaz
    // B) handler içinde pool.query ile join at (ama repo varken gereksiz)

    // Şimdilik FE beklediği format için join'li dönelim:
    const { rows } = await pool.query(
      `
      SELECT
        ri.component_master_id,
        m.display_label AS component_label,
        ri.qty AS quantity,
        ri.unit
      FROM recipe_items ri
      LEFT JOIN masters m ON m.id = ri.component_master_id
      WHERE ri.recipe_id = $1
      ORDER BY ri.id ASC
      `,
      [recipeId]
    );

    return res.json({ items: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { recipe_name, items } = req.body || {};

    if (!recipe_name || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const recipe = await repo.create({ recipe_name, items });
    res.status(201).json(recipe);
  } catch (e) {
    if (e.code === "23505") {
      // unique violation
      return res.status(409).json({ message: "Recipe name already exists" });
    }
    console.error(e);
    res.status(500).json({ message: "Internal error" });
  }
};
