const express = require("express");
const router = express.Router();

// İSİM ÖNEMLİ: lookups diye import et
const lookups = require("../controllers/lookupsController");

// Eski endpointler (hala çalışsın diye)
router.get("/categories", lookups.getCategories);
router.get("/types/:categoryId", lookups.getTypesByCategory);

// Yeni, daha net endpointler
router.get("/product-types", lookups.getProductTypes);
router.get("/carrier-types", lookups.getCarrierTypes);
router.get("/carrier-colors", lookups.getCarrierColors);
router.get("/liner-colors", lookups.getLinerColors);
router.get("/liner-types", lookups.getLinerTypes);
router.get("/adhesive-types", lookups.getAdhesiveTypes);

router.get("/suppliers", lookups.getSuppliers);
router.get("/warehouses", lookups.getWarehouses);
router.get("/locations", lookups.getLocations);
router.get("/statuses", lookups.statuses);

router.post("/suppliers",      lookups.createSupplier);
router.post("/carrier-types",  lookups.createCarrierType);
router.post("/carrier-colors", lookups.createCarrierColor);
router.post("/liner-colors",   lookups.createLinerColor);
router.post("/liner-types",    lookups.createLinerType);
router.post("/adhesive-types", lookups.createAdhesiveType);


// legacy (master schema)
router.get("/master-field-schema", lookups.getMasterFieldSchema);

module.exports = router;
