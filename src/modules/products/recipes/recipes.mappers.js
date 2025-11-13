// src/modules/products/recipes/recipes.mappers.js
exports.mapRecipeRow = (r) => ({
  recipe_id: r.recipe_id,
  recipe_name: r.recipe_name,
  master_id: r.master_id,
  display_label: r.display_label,
});

exports.mapItems = (rows) => ({
  items: rows.map(r => ({
    component_master_id: r.component_master_id,
    component_label: r.component_label,
    quantity: Number(r.quantity),
    unit: r.unit,
  })),
});
