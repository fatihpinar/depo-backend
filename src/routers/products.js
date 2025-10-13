 const express = require("express");
 const router = express.Router();
 const controller = require("../controllers/productsController");

 // LIST
 router.get("/", controller.list);

 // DETAIL & UPDATE
 router.get("/:id", controller.getById);
 router.put("/:id", controller.update);

 // ASSEMBLE (ürün oluştur + component tüket)
 router.post("/assemble", controller.assemble);

 // REMOVE COMPONENTS (üründen component iade / sökme)
 router.post("/:id/components/remove", controller.removeComponents);
 
 // ADD COMPONENTS (mevcut ürüne stok tüketip bağlama)
 router.post("/:id/components/add", controller.addComponents);

 module.exports = router;
