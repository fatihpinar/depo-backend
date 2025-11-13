const express = require("express");
const router = express.Router();
const controller = require("./products.controller");
const recipesRoutes = require("./recipes/recipes.routes");
const { middleware } = require("../auth");

// LIST
router.get("/", middleware.requirePermission("inventory.read"), controller.list);

// DETAIL & UPDATE
router.get("/:id", middleware.requirePermission("inventory.read"), controller.getById);
router.put("/:id", middleware.requirePermission("inventory.adjust"), controller.update);

// ASSEMBLE (ürün oluştur + component tüket)
router.post("/assemble", middleware.requirePermission("product.assemble"), controller.assemble);

// REMOVE COMPONENTS / ADD COMPONENTS
router.post("/:id/components/remove", middleware.requirePermission("inventory.adjust"), controller.removeComponents);
router.post("/:id/components/add",    middleware.requirePermission("inventory.adjust"), controller.addComponents);

// TARİFLER (okuma-yazma kuralları recipes.routes içinde)
router.use("/recipes", recipesRoutes);

module.exports = router;
