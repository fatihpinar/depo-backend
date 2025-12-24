// src/modules/recipes/recipes.routes.js
const router = require("express").Router();
const h = require("./recipes.handlers");

router.get("/", h.list);
router.get("/:id/items", h.getItems);
router.post("/", h.create);

module.exports = router;
