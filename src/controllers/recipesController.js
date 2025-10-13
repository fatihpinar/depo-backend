// controllers/recipesController.js
const service = require("../services/recipesService");

exports.list = async (req, res) => {
  try {
    const categoryId = Number(req.query.categoryId || 0);
    const typeId     = Number(req.query.typeId || 0);
    const search     = (req.query.search || "").trim();

    const rows = await service.list({ categoryId, typeId, search });
    res.json(rows);
  } catch (err) {
    console.error("recipes list error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

exports.getItems = async (req, res) => {
  try {
    const recipeId = String(req.params.recipeId || "");
    if (!recipeId) return res.status(400).json({ message: "Geçersiz recipeId" });

    const out = await service.getItems(recipeId);
    res.json(out); // { items: [...] }
  } catch (err) {
    console.error("recipes getItems error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await service.create(req.body || {});
    // FE bu alanları bekliyor: { master_id, recipe_id, recipe_name }
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error("recipes create error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};
