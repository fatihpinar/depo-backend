const express = require("express");
const router = express.Router();

const { middleware } = require("../modules/auth");

// Public
router.use("/auth", require("../modules/auth").router);

// ↓↓↓ Buradan sonrası korunur
router.use(middleware.requireAuth);

router.use("/lookups", require("./lookups"));
router.use("/masters", require("../modules/masters/masters.routes"));
router.use("/components", require("../modules/components/components.routes"));
router.use("/products/recipes", require("../modules/products/recipes/recipes.routes"));
router.use("/products", require("../modules/products/products.routes"));
router.use("/inventory", require("./inventory"));
router.use("/inventory-transitions", require("../modules/transitions").router);
router.use("/approvals", require("../modules/approvals/approvals.routes"));

// legacy
router.post("/product-assemblies", (req,res,next)=> {
  require("../modules/products/products.controller").assemble(req,res,next);
});

module.exports = router;
