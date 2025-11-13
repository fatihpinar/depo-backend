const svc = require("../../modules/transitions/transitions.service");

exports.list = async (req, res, next) => {
  try {
    const {
      item_type,   // "component" | "product"
      item_id,     // number
      limit = 20,
      offset = 0,
    } = req.query;

    const out = await svc.list({
      item_type,
      item_id: item_id ? Number(item_id) : undefined,
      limit: Number(limit),
      offset: Number(offset),
    });

    // Hem {rows,total} hem dizi destekli
    if (Array.isArray(out)) {
      res.json({ rows: out, total: out.length });
    } else {
      res.json(out);
    }
  } catch (err) {
    next(err);
  }
};
