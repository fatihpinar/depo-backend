// src/modules/components/components.routes.js
const express = require("express");
const router = express.Router();
const ctrl = require("./components.controller");
const { middleware } = require("../auth");

// LIST (picker + liste)
router.get("/", middleware.requirePermission("components.read"), ctrl.list);

// BULK CREATE (ilk giriş akışı gibi değerlendirelim)
router.post(
  "/bulk",
  middleware.requirePermission("stock.entry.create"),
  ctrl.bulkCreate
);

// COMPONENT EXIT (çoklu statü / depo / lokasyon değişimi)
router.post(
  "/exit",
  middleware.requirePermission("inventory.adjust"),
  ctrl.exitMany
);

// DETAIL + UPDATE
router.get("/:id", middleware.requirePermission("components.read"), ctrl.getById);
router.put("/:id", middleware.requirePermission("inventory.adjust"), ctrl.update);

module.exports = router;
