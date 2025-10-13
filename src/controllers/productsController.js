const service = require("../services/productsService");

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
    const updated = await service.update(id, payload);
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error("products update error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/** POST /products/assemble  (eski product-assemblies create) */
exports.assemble = async (req, res) => {
  try {
    const result = await service.assemble(req.body);
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    console.error("products assemble error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/** POST /products/:id/components/remove
 * body: [
 *   {
 *     link_id: number,          // product_components.id (ZORUNLU)
 *     component_id: number,     // components.id (ZORUNLU)
 *     new_barcode?: string,     // opsiyonel – yeni stok satırı açmak için
 *     return_qty?: number,      // M/KG için; EA’de gönderme (1 kabul edilir)
 *     warehouse_id: number,     // iade edilecek/girecek depo
 *     location_id: number       // iade edilecek/girecek lokasyon
 *   }, ...
 * ]
 */

// ✨ yeni/expanded
// Body (mixed):
// [
//   // iade örneği
//   { link_id, component_id, new_barcode?, return_qty?, warehouse_id, location_id },
//   // hurda (FIRE) örneği
//   { link_id, component_id, is_scrap: true, fire_qty?, reason? }
// ]
exports.removeComponents = async (req, res) => {
  try {
    const productId = Number(req.params.id || 0);
    if (!productId) return res.status(400).json({ message: "Geçersiz id" });

    const items = Array.isArray(req.body) ? req.body : [];
    if (!items.length) return res.status(400).json({ message: "Boş payload" });

    const result = await service.removeComponents(productId, items);
    return res.status(200).json(result);
  } catch (err) {
    console.error("products removeComponents error:", err);
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    return res.status(500).json({ message: "Internal error" });
  }
};

/** POST /products/:id/components/add
 * body: [{ component_id:number, consume_qty?:number }]
 * - EA için consume_qty gönderilmez/ignored (1 tüketilir)
 * - M/KG için >0 ve mevcut stoktan küçük/eşit olmalı
 */
exports.addComponents = async (req, res) => {
  try {
    const productId = Number(req.params.id || 0);
    if (!productId) return res.status(400).json({ message: "Geçersiz id" });

    const items = Array.isArray(req.body) ? req.body : [];
    if (!items.length) return res.status(400).json({ message: "Boş payload" });

    const result = await service.addComponents(productId, items);
    res.status(201).json(result); // { added, links }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error("products addComponents error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

