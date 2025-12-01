    const router = require("express").Router();
    const controller = require("./masters.controller");
    const { middleware } = require("../auth");

    // /api/masters
    router.get("/",    middleware.requirePermission("masters.read"),  controller.list);
    router.post("/",   middleware.requirePermission("masters.write"), controller.create);
    router.get("/:id", middleware.requirePermission("masters.read"),  controller.getById);
    router.put("/:id/full", middleware.requirePermission("masters.write"), controller.updateFull);

    module.exports = router;
