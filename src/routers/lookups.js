const express = require("express");
const router = express.Router();

// İSİM ÖNEMLİ: lookups diye import et
const lookups = require("../controllers/lookupsController");

router.get("/categories", lookups.getCategories);
router.get("/types/:categoryId", lookups.getTypesByCategory);
router.get("/suppliers", lookups.getSuppliers);
router.post("/suppliers", lookups.createSupplier);
router.get("/warehouses", lookups.getWarehouses);
router.get("/locations", lookups.getLocations);
router.get("/statuses", lookups.statuses);

// ✅ yeni endpoint
router.get("/master-field-schema", lookups.getMasterFieldSchema);

module.exports = router;
