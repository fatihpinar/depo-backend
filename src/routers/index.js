// src/routes/index.js
const express = require("express");
const router = express.Router();

const approvals = require("../controllers/approvalsController");

/* Lookups */
router.use("/lookups", require("./lookups"));
/* Masters */
router.use("/masters", require("./masters"));
/* Canonical resources */
router.use("/components", require("./components"));
router.use("/products", require("./products"));
/* Envanter (✅ geri ekle) */
router.use("/inventory", require("./inventory"));
/* Timeline */
router.use("/inventory-transitions", require("./transitions"));
/* Recipes */
router.use("/recipes", require("./recipes"));

/* Approvals */
router.get("/approvals/pending", approvals.listPending);
router.post("/approvals/approve", approvals.approveItems);     // stok onayı (pending -> in_stock)
router.post("/approvals/complete", approvals.completeWork);    // üretim/serigrafi tamamlama


module.exports = router;
