// src/controllers/inventoryTransitionsController.js
const svc = require("../services/inventoryTransitionsService");

exports.list = async (req, res, next) => {
  try {
    const {
      item_type,            // "component" | "product"
      item_id,              // number
      limit = 20,
      offset = 0,
    } = req.query;

    const rows = await svc.list({
      item_type: item_type,
      item_id: item_id ? Number(item_id) : undefined,
      limit: Number(limit),
      offset: Number(offset),
    });

    // svc.list hem {rows,total} dönebilir, hem dizi dönebilir — FE her ikisini de destekliyor.
    if (Array.isArray(rows)) {
      res.json({ rows, total: rows.length });
    } else {
      res.json(rows);
    }
  } catch (err) {
    next(err);
  }
};
