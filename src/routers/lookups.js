// src/routes/lookups.js
const express = require("express");
const router = express.Router();

const lookups = require("../controllers/lookupsController");

// master form için temel lookups
router.get("/categories", lookups.getCategories);
router.post("/categories", lookups.createCategory); // ✅ EKLE

router.get("/types/:categoryId", lookups.getTypesByCategory);
router.post("/types", lookups.createType); // ✅ EKLE

router.get("/suppliers", lookups.getSuppliers);
router.post("/suppliers", lookups.createSupplier);

router.get("/warehouses", lookups.getWarehouses);
router.get("/locations", lookups.getLocations);
router.get("/statuses", lookups.statuses);
router.get("/stock-units", lookups.getStockUnits);

module.exports = router;
