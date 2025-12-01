const service = require("./components.service");

function getActorId(req) {
  return req?.user?.id ? Number(req.user.id) : null;
}

// GET /components
// src/modules/components/components.controller.js

exports.list = async (req, res, next) => {
  try {
    const {
      search,
      warehouseId,
      masterId,
      statusId,          // 👈 EKLE
    } = req.query;

    const filters = {
      search: search || undefined,
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      masterId: masterId ? Number(masterId) : undefined,
      statusId: statusId ? Number(statusId) : undefined,  // 👈 EKLE
    };

    const rows = await service.list(filters);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};


// GET /components/:id
exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: "Geçersiz id" });
    const row = await service.getById(id);
    if (!row) return res.status(404).json({ message: "Kayıt bulunamadı" });
    res.json(row);
  } catch (err) {
    console.error("components getById error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: "Geçersiz id" });
    const actorId = getActorId(req);                 // ✅ ek
    const updated = await service.update(id, req.body || {}, actorId); // ✅ ek
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error("components update error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

exports.bulkCreate = async (req, res) => {
  try {
    const entries = Array.isArray(req.body) ? req.body : [];
    if (!entries.length) return res.status(400).json({ message: "Boş payload" });
    const actorId = getActorId(req);                 // ✅ ek
    const created = await service.bulkCreate(entries, { actorId });
    res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, conflicts: err.conflicts, message: err.message });
    console.error("components bulkCreate error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

exports.exitMany = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: "Boş satır listesi" });
    }

    const actorId = getActorId(req);
    const result = await service.exitMany(rows, actorId);

    res.json({ items: result });
  } catch (err) {
    if (err.status) {
      return res
        .status(err.status)
        .json({ code: err.code, message: err.message });
    }
    console.error("components exitMany error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};