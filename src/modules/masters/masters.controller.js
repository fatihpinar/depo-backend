// src/modules/masters/masters.controller.js
const service = require("./masters.service");

exports.list = async (req, res) => {
  try {
    const categoryId = parseInt(req.query.categoryId || 0, 10);
    const typeId     = parseInt(req.query.typeId || 0, 10);
    const search     = (req.query.search || "").trim();

    const rows = await service.list({ categoryId, typeId, search });
    res.json(rows);
  } catch (err) {
    console.error("Master listesi hatası:", err);
    res.status(500).json({ error: "Master kayıtları alınamadı" });
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
