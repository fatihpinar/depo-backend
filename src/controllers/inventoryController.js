// src/controllers/inventoryController.js
const service = require("../services/inventoryService");

exports.list = async (req, res) => {
  try {
    const q = {
      warehouseId: req.query.warehouseId ? Number(req.query.warehouseId) : null,
      locationId:  req.query.locationId  ? Number(req.query.locationId)  : null,
      statusId:    req.query.statusId    ? Number(req.query.statusId)    : null,
      type:        req.query.type || "all",
      search:      (req.query.search || "").trim(),
      limit:       Math.min(Number(req.query.limit || 50), 200),
      offset:      Number(req.query.offset || 0),

      // Bu sayfa "Depoda" (in_stock) odağında
      inStockOnly: true,
    };

    const { rows, total } = await service.list(q);
    res.json({ items: rows, total });
  } catch (err) {
    console.error("inventory list error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};
