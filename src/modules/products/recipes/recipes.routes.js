// src/modules/products/recipes/recipes.routes.js
const express = require("express");
const router = express.Router();
const controller = require("./recipes.controller");

router.get("/", controller.list);
router.get("/:recipeId/items", controller.getItems);
router.post("/", controller.create);

module.exports = router;
