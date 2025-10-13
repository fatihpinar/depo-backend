// controllers/componentsController.js
const service = require("../services/componentsService");

/**
 * GET /components
 * Query:
 *  - search?: string
 *  - warehouseId?: number
 *  - locationId?: number
 *  - masterId?: number
 *  - availableOnly?: "true" | "false"  // true => sadece in_stock (status_id=1)
 *
 * Not:
 *  - Bu endpoint hem liste ekranı hem de picker için kullanılabilir.
 *    Picker’da availableOnly=true gönderiyoruz.
 */
exports.list = async (req, res) => {
  try {
    const search       = (req.query.search || "").trim();
    const warehouseId  = Number(req.query.warehouseId || 0);
    const locationId   = Number(req.query.locationId  || 0);
    const masterId     = Number(req.query.masterId    || 0);
    const availableOnly = String(req.query.availableOnly || "false") === "true";

    const rows = await service.list({
      search,
      warehouseId,
      locationId,
      masterId,
      availableOnly,
    });

    return res.json(rows);
  } catch (err) {
    console.error("components list error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

/**
 * GET /components/:id
 * Tek component detayı (Details sayfası için)
 */
exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: "Geçersiz id" });

    const row = await service.getById(id);
    if (!row) return res.status(404).json({ message: "Kayıt bulunamadı" });

    return res.json(row);
  } catch (err) {
    console.error("components getById error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

/**
 * PUT /components/:id
 * Body: { barcode?, master_id?, quantity?, unit?, status_id?, warehouse_id?, location_id?, notes? }
 * (Details sayfasındaki düzenlemeleri kaydeder)
 */
exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: "Geçersiz id" });

    const payload = req.body || {};
    const updated = await service.update(id, payload);
    return res.json(updated);
  } catch (err) {
    // servis katmanında err.status/err.code set ediyorsak yakala:
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error("components update error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

/**
 * POST /components/bulk
 * Body: [{ master_id, barcode, unit, quantity, warehouse_id, location_id, status_id? }, ...]
 * Stok giriş (bulk insert). Varsayılan status_id: pending (4) veya
 * servis içinde kuralı nasıl belirlediysek o uygulanır.
 */
exports.bulkCreate = async (req, res) => {
  try {
    const entries = Array.isArray(req.body) ? req.body : [];
    if (!entries.length) {
      return res.status(400).json({ message: "Boş payload" });
    }
    const created = await service.bulkCreate(entries);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ code: err.code, conflicts: err.conflicts, message: err.message });
    }
    console.error("components bulkCreate error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};
