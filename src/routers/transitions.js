// src/routers/transitions.js
const express = require("express");
const ctrl = require("../controllers/inventoryTransitionsController");
const router = express.Router();

router.get("/", ctrl.list);

module.exports = router;
