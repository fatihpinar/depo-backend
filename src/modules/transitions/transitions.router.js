const express = require("express");
const router = express.Router();
const ctrl = require("./transitions.controller");
const { middleware } = require("../auth");

// /api/inventory-transitions
router.get("/", middleware.requirePermission("inventory.read"), ctrl.list);

module.exports = router;
