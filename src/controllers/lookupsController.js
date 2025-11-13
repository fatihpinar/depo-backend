// src/controllers/lookupsController.js
const pool = require("../core/db/index");
const { getSchema } = require("../modules/masters/masters.schema");

/* -------------------- CATEGORIES -------------------- */
exports.getCategories = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM categories ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("Kategori hatası:", err);
    res.status(500).json({ error: "Kategoriler alınamadı" });
  }
};

/* -------------------- TYPES (by category) -------------------- */
exports.getTypesByCategory = async (req, res) => {
  try {
    const categoryId = parseInt(req.params.categoryId, 10);
    if (!categoryId) {
      return res.status(400).json({ error: "Geçersiz categoryId" });
    }

    const { rows } = await pool.query(
      `SELECT id, name, category_id
       FROM types
       WHERE category_id = $1
       ORDER BY id`,
      [categoryId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Tür hatası:", err);
    res.status(500).json({ error: "Türler alınamadı" });
  }
};

exports.statuses = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label, is_terminal
         FROM statuses
       ORDER BY id ASC`
    );
    // FE’nin beklediği sade shape
    res.json(rows.map(r => ({
      id: Number(r.id),
      code: r.code,
      label: r.label,         // “Depoda / Kullanıldı …”
      is_terminal: !!r.is_terminal
    })));
  } catch (err) {
    console.error("lookups.statuses error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/* -------------------- SUPPLIERS -------------------- */
exports.getSuppliers = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM suppliers ORDER BY name ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Tedarikçi listesi hatası:", err);
    res.status(500).json({ error: "Tedarikçi listesi alınamadı" });
  }
};

exports.createSupplier = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "İsim zorunlu" });

    const { rows } = await pool.query(
      `INSERT INTO suppliers (name)
       VALUES ($1)
       RETURNING id, name`,
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Tedarikçi ekleme hatası:", err);
    res.status(500).json({ error: "Tedarikçi eklenemedi" });
  }
};

/* -------------------- WAREHOUSES -------------------- */
exports.getWarehouses = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, department
      FROM warehouses
      ORDER BY id
    `);
    res.json(rows);
  } catch (e) {
    console.error("lookups.getWarehouses error:", e);
    res.status(500).json({ message: "Depolar alınamadı" });
  }
};


/* -------------------- LOCATIONS -------------------- */
exports.getLocations = async (req, res) => {
  try {
    const warehouseId = Number(req.query.warehouseId || 0);

    if (warehouseId) {
      const { rows } = await pool.query(
        `SELECT id, name, warehouse_id
         FROM locations
         WHERE warehouse_id = $1
         ORDER BY name ASC`,
        [warehouseId]
      );
      return res.json(rows);
    }

    const { rows } = await pool.query(
      `SELECT id, name, warehouse_id
       FROM locations
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error("getLocations error:", err);
    res.status(500).json({ error: "Lokasyonlar alınamadı" });
  }
};

exports.getMasterFieldSchema = async (_req, res) => {
  try {
    const schema = getSchema(); // { version, baseFields, categoryFields, categoryMap }
    res.json(schema);
  } catch (err) {
    console.error("getMasterFieldSchema error:", err);
    res.status(500).json({ message: "Schema yüklenemedi" });
  }
};
