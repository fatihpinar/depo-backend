// src/modules/masters/masters.controller.js
const service = require("./masters.service");

// GET /components
// src/modules/masters/masters.controller.js
exports.list = async (req, res) => {
  try {
    const productTypeId = Number(req.query.productTypeId || 0);
    const carrierTypeId = Number(req.query.carrierTypeId || 0);
    const supplierId    = Number(req.query.supplierId || 0);
    const search        = (req.query.search || "").trim();

    // ✅ yeni filtreler (tanım listesi hesaplamasını etkileyecek)
    const statusId   = req.query.statusId ? Number(req.query.statusId) : null;
    const warehouseId= req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;

    // istersen FE "Depoda" seçmeden de sadece depodakileri görmek için
    const inStockOnly = String(req.query.inStockOnly || "") === "true";

    const rows = await service.list({
      productTypeId,
      carrierTypeId,
      supplierId,
      search,
      statusId,
      warehouseId,
      locationId,
      inStockOnly,
    });

    res.json(rows);
  } catch (err) {
    console.error("masters list error MESSAGE:", err.message);
    console.error("masters list error DETAIL:", err);
    return res.status(500).json({ message: err.message || "Internal error" });
  }
};



exports.create = async (req, res) => {
  try {
    const created = await service.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.code || err.message, message: err.message });
    console.error("Master ekleme hatası:", err);
    res.status(500).json({ error: "Master kaydı eklenemedi" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id gerekiyor" });

    const row = await service.getById(id);
    if (!row) return res.status(404).json({ error: "Bulunamadı" });

    res.json(row);
  } catch (err) {
    console.error("Master detay hatası:", err);
    res.status(500).json({ error: "Master detayı alınamadı" });
  }
};

exports.updateFull = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id gerekiyor" });

    const updated = await service.update(id, req.body || {});
    res.json(updated);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || err.message, message: err.message });
    }
    console.error("Master full update hatası:", err);
    res.status(500).json({ error: "Master güncellenemedi" });
  }
};
