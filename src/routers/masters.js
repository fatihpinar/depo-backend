const router = require("express").Router();
const masterController = require("../controllers/mastersController");
router.get("/",    masterController.getMasters);
router.post("/",   masterController.createMaster);
router.get("/:id", masterController.getMasterById);
router.put("/:id", masterController.updateMasterBimeks);
router.put("/:id/full", masterController.updateMasterFull);

module.exports = router;
