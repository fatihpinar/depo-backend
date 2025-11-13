// src/modules/products/recipes/recipes.service.js
const repo = require("./recipes.repository");

async function list({ categoryId = 0, typeId = 0, search = "" } = {}) {
  const rows = (await repo.findMany({ categoryId, typeId, search })) || [];
  return rows.map((r) => ({
    recipe_id: r.recipe_id,
    recipe_name: r.recipe_name,
    master_id: r.master_id,
    display_label: r.display_label,
  }));
}

async function getItems(recipeId) {
  const rows = (await repo.findItems(recipeId)) || [];
  return {
    items: rows.map((r) => ({
      component_master_id: r.component_master_id,
      component_label: r.component_label,
      quantity: Number(r.quantity),
      unit: r.unit,
    })),
  };
}

async function create(payload = {}) {
  // Tüm transaction repository’de
  const out = await repo.createRecipe(payload);
  return {
    master_id: out.master_id,
    recipe_id: out.recipe_id,
    recipe_name: out.recipe_name,
  };
}

/* 👉 export’ları tek noktadan yap */
module.exports = {
  list,
  getItems,
  create,
};
