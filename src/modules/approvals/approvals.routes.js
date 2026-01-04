const router = require("express").Router();
const controller = require("./approvals.controller");
const { middleware } = require("../auth");

// scope'ı (stock | production | screenprint) oku
function scopeReader(req, _res, next) {
  req._scope = String(req.query.scope || req.body.scope || "stock");
  next();
}

// scope'a göre izin anahtarı seç
function scopePermissionGuard(req, res, next) {
  const scope = req._scope || "stock";
  const need = {
    stock: "receipts.stock.approve",
    production: "receipts.production.approve",
    screenprint: "receipts.screenprint.approve",
  }[scope];

  return middleware.requirePermission(need)(req, res, next);
}

// /api/approvals
router.get(
  "/pending",
  middleware.requirePermission("inventory.read"),
  controller.listPending
);
router.post(
  "/approve",
  scopeReader,
  scopePermissionGuard,
  controller.approveItems
);
router.post(
  "/complete",
  scopeReader,
  scopePermissionGuard,
  controller.completeWork
);

router.post("/delete", controller.deleteItems);

module.exports = router;
