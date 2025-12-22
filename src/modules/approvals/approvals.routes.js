// src/modules/approvals/approvals.routes.js
const router = require("express").Router();
const controller = require("./approvals.controller");
const { middleware } = require("../auth");

// /api/approvals/pending
router.get(
  "/pending",
  middleware.requirePermission("inventory.read"),
  controller.listPending
);

// /api/approvals/approve
router.post(
  "/approve",
  middleware.requirePermission("receipts.stock.approve"),
  controller.approveItems
);

module.exports = router;
