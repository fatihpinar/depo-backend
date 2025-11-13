const router = require("express").Router();
const ctrl = require("./auth.controller");
const { requireAuth } = require("./auth.middleware");

router.post("/login", ctrl.login);
router.get("/me", requireAuth, ctrl.me);   // ✅ SADECE BU

module.exports = router;