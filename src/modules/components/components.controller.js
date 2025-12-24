// src/modules/components/components.controller.js
const service = require("./components.service");

function getActorId(req) {
  return req?.user?.id ? Number(req.user.id) : null;
}

exports.list = async (req, res, next) => {
  try {
    const { search, warehouseId, masterId, statusId } = req.query;
    const filters = {
      search: search || undefined,
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      masterId: masterId ? Number(masterId) : undefined,
      statusId: statusId ? Number(statusId) : undefined,
    };
    const rows = await service.list(filters);
    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

exports.getByBarcode = async (req, res) => {
  try {
    const barcode = req.query.barcode;
    const row = await service.getByBarcode(barcode);
    if (!row) return res.status(404).json({ message: "Kayıt bulunamadı" });
    return res.json({ id: row.id });
  } catch (err) {
    console.error("components getByBarcode error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

exports.search = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = req.query.limit ? Number(req.query.limit) : 8;
    const items = await service.search({ q, limit });
    return res.json({ items });
  } catch (err) {
    console.error("components search error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

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

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: "Geçersiz id" });
    const actorId = getActorId(req);
    const updated = await service.update(id, req.body || {}, actorId);
    return res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    console.error("components update error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

exports.bulkCreate = async (req, res) => {
  try {
    const entries = Array.isArray(req.body) ? req.body : [];
    if (!entries.length) return res.status(400).json({ message: "Boş payload" });
    const actorId = getActorId(req);
    const created = await service.bulkCreate(entries, { actorId });
    return res.status(201).json(created);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, conflicts: err.conflicts, message: err.message });
    console.error("components bulkCreate error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

exports.exitMany = async (req, res) => {
  try {
    const rows = Array.isArray(req.body)
      ? req.body
      : (Array.isArray(req.body?.rows) ? req.body.rows : []);

    if (!rows.length) return res.status(400).json({ message: "Boş satır listesi" });

    // ✅ recipe_id (integer) — opsiyonel
    const recipeIdRaw = Array.isArray(req.body) ? null : req.body?.recipe_id;
    const recipe_id =
      recipeIdRaw === null || recipeIdRaw === undefined || recipeIdRaw === "" || recipeIdRaw === "none"
        ? null
        : Number(recipeIdRaw);

    if (recipe_id !== null && (!Number.isFinite(recipe_id) || recipe_id <= 0)) {
      return res.status(400).json({ message: "Geçersiz recipe_id" });
    }

    const actorId = getActorId(req);
    const result = await service.exitMany(rows, actorId, { recipe_id });

    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    console.error("components exitMany error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

