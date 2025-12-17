// src/modules/stock-balances/stockBalances.controller.js
const svc = require("./stockBalances.service");

exports.getMasterStockSummary = async (req, res) => {
  try {
    const masterId = Number(req.params.id || 0);
    if (!masterId) {
      return res.status(400).json({ message: "Geçersiz master id" });
    }

    const warehouseId = req.query.warehouseId
      ? Number(req.query.warehouseId)
      : undefined;
    const statusId = req.query.statusId
      ? Number(req.query.statusId)
      : undefined;

    const rows = await svc.getMasterSummary(masterId, {
      warehouseId,
      statusId,
    });

    res.json(rows);
  } catch (err) {
    console.error("stockBalances.getMasterStockSummary error:", err);
    res.status(500).json({ message: "Stok özeti getirilemedi." });
  }
};
