const express = require('express');
const router = express.Router();
const controller = require('../controllers/inventoryController');

router.get('/', controller.list); // GET /inventory?warehouseId=..&locationId=..&type=all|product|component&statusId=&search=&limit=&offset=
module.exports = router;
