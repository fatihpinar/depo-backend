const express = require("express");
const router = express.Router();
const controller = require("../controllers/componentsController");

// LIST (picker/listeler)
router.get("/", controller.list);

// ✅ BULK CREATE (stok girişi) — canonical endpoint
router.post("/bulk", controller.bulkCreate);

// DETAIL & UPDATE (ileride)
router.get("/:id", controller.getById);
router.put("/:id", controller.update);

module.exports = router;
