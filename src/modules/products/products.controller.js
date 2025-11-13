const service = require("./products.service");

function getActorId(req) {
  return req?.user?.id ? Number(req.user.id) : null;
}

/** GET /products */
exports.list = async (req, res) => {
  try {
    const warehouseId = Number(req.query.warehouseId || 0);
    const masterId    = Number(req.query.masterId || 0);
    const search      = (req.query.search || "").trim();

    const rows = await service.list({ warehouseId, masterId, search });
    res.json(rows);
  } catch (err) {
    console.error("products list error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/** GET /products/:id */
exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: "Geçersiz id" });

    const row = await service.getById(id);
    if (!row) return res.status(404).json({ message: "Kayıt bulunamadı" });

    res.json(row);
  } catch (err) {
    console.error("products getById error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/** PUT /products/:id */
exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: "Geçersiz id" });

    const payload = req.body || {};
    const actorId = getActorId(req);
    const updated = await service.update(id, payload, actorId);
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error("products update error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/** POST /products/assemble */
exports.assemble = async (req, res) => {
  try {
    const actorId = getActorId(req);
    const result = await service.assemble(req.body, actorId);
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    console.error("products assemble error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/** POST /products/:id/components/remove */
exports.removeComponents = async (req, res) => {
  try {
    const productId = Number(req.params.id || 0);
    if (!productId) return res.status(400).json({ message: "Geçersiz id" });

    const items = Array.isArray(req.body) ? req.body : [];
    if (!items.length) return res.status(400).json({ message: "Boş payload" });

    const actorId = getActorId(req);
    const result = await service.removeComponents(productId, items, actorId);
    return res.status(200).json(result);
  } catch (err) {
    console.error("products removeComponents error:", err);
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    return res.status(500).json({ message: "Internal error" });
  }
};

/** POST /products/:id/components/add */
exports.addComponents = async (req, res) => {
  try {
    const productId = Number(req.params.id || 0);
    if (!productId) return res.status(400).json({ message: "Geçersiz id" });

    const items = Array.isArray(req.body) ? req.body : [];
    if (!items.length) return res.status(400).json({ message: "Boş payload" });

    const actorId = getActorId(req);
    const result = await service.addComponents(productId, items, actorId);
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error("products addComponents error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};
