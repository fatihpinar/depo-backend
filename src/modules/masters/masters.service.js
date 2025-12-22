// src/modules/masters/masters.service.js
const repo = require("./masters.repository");

function normalizePayload(payload = {}) {
  const clean = {};

  if (payload.display_label !== undefined)
    clean.display_label = String(payload.display_label || "").trim();

  if (payload.category_id !== undefined)
    clean.category_id = payload.category_id ? Number(payload.category_id) : null;

  if (payload.type_id !== undefined)
    clean.type_id = payload.type_id ? Number(payload.type_id) : null;

  if (payload.supplier_id !== undefined)
    clean.supplier_id = payload.supplier_id ? Number(payload.supplier_id) : null;

  if (payload.stock_unit_id !== undefined)
    clean.stock_unit_id = payload.stock_unit_id ? Number(payload.stock_unit_id) : null;

  return clean;
}

exports.list = (filters) => repo.findMany(filters);
exports.getById = (id) => repo.findJoinedById(id);

exports.create = async (payload = {}) => {
  const clean = normalizePayload(payload);
  try {
    const created = await repo.insertOne(clean);
    return repo.findJoinedById(created.id);
  } catch (err) {
    throw mapDbError(err);
  }
};

exports.update = async (id, payload = {}) => {
  const clean = normalizePayload(payload);
  try {
    await repo.updateOne(id, clean);
    return repo.findJoinedById(id);
  } catch (err) {
    throw mapDbError(err);
  }
};

function mapDbError(err) {
  if (!err || !err.code) return err;

  if (["23502", "23503", "23514"].includes(err.code)) {
    const e = new Error("INVALID_DATA");
    e.status = 400;
    e.message = "Geçersiz veya eksik alanlar mevcut.";
    return e;
  }
  return err;
}
