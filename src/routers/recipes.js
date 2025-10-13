// routers/recipes.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/recipesController");

// LIST
router.get("/", controller.list);

// ITEMS OF A RECIPE
router.get("/:recipeId/items", controller.getItems);

// CREATE
router.post("/", controller.create);

module.exports = router;
