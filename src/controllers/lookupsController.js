// src/controllers/lookupsController.js
const pool = require("../core/db/index");

// GET /lookups/categories
exports.getCategories = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name
       FROM categories
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error("getCategories error:", err);
    res.status(500).json({ message: "Categories alınamadı" });
  }
};

// GET /lookups/types/:categoryId
exports.getTypesByCategory = async (req, res) => {
  try {
    const categoryId = Number(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ message: "categoryId gerekiyor" });

    const { rows } = await pool.query(
      `SELECT id, name, category_id
       FROM types
       WHERE category_id = $1
       ORDER BY name ASC`,
      [categoryId]
    );
    res.json(rows);
  } catch (err) {
    console.error("getTypesByCategory error:", err);
    res.status(500).json({ message: "Types alınamadı" });
  }
};

// GET /lookups/suppliers
exports.getSuppliers = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name
       FROM suppliers
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error("getSuppliers error:", err);
    res.status(500).json({ message: "Suppliers alınamadı" });
  }
};

// POST /lookups/suppliers
exports.createSupplier = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "name zorunlu" });

    // Aynı isim varsa geri dön
    const exists = await pool.query(
      `SELECT id, name
       FROM suppliers
       WHERE LOWER(name) = LOWER($1)
       LIMIT 1`,
      [name]
    );
    if (exists.rows[0]) return res.status(201).json(exists.rows[0]);

    const { rows } = await pool.query(
      `INSERT INTO suppliers (name)
       VALUES ($1)
       RETURNING id, name`,
      [name]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createSupplier error:", err);
    res.status(500).json({ message: "Supplier eklenemedi" });
  }
};

// GET /lookups/stock-units
exports.getStockUnits = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label, is_active, sort_order
       FROM stock_units
       ORDER BY COALESCE(sort_order, 9999) ASC, id ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error("getStockUnits error:", err);
    res.status(500).json({ message: "Stock units alınamadı" });
  }
};

// GET /lookups/warehouses
exports.getWarehouses = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, department
       FROM warehouses
       ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    console.error("getWarehouses error:", err);
    res.status(500).json({ message: "Depolar alınamadı" });
  }
};

// POST /lookups/categories
exports.createCategory = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "name zorunlu" });

    const exists = await pool.query(
      `SELECT id, name
       FROM categories
       WHERE LOWER(name) = LOWER($1)
       LIMIT 1`,
      [name]
    );
    if (exists.rows[0]) return res.status(201).json(exists.rows[0]);

    const { rows } = await pool.query(
      `INSERT INTO categories (name)
       VALUES ($1)
       RETURNING id, name`,
      [name]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createCategory error:", err);
    res.status(500).json({ message: "Kategori eklenemedi" });
  }
};

// POST /lookups/types
exports.createType = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const categoryId = Number(req.body?.category_id || 0);

    if (!name) return res.status(400).json({ message: "name zorunlu" });
    if (!categoryId) return res.status(400).json({ message: "category_id zorunlu" });

    const exists = await pool.query(
      `SELECT id, name, category_id
       FROM types
       WHERE category_id = $1 AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [categoryId, name]
    );
    if (exists.rows[0]) return res.status(201).json(exists.rows[0]);

    const { rows } = await pool.query(
      `INSERT INTO types (name, category_id)
       VALUES ($1, $2)
       RETURNING id, name, category_id`,
      [name, categoryId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createType error:", err);
    res.status(500).json({ message: "Tür eklenemedi" });
  }
};

// GET /lookups/locations?warehouseId=1
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
    res.status(500).json({ message: "Lokasyonlar alınamadı" });
  }
};

// GET /lookups/statuses
exports.statuses = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label, is_terminal
       FROM statuses
       ORDER BY id ASC`
    );
    res.json(
      rows.map((r) => ({
        id: Number(r.id),
        code: r.code,
        label: r.label,
        is_terminal: !!r.is_terminal,
      }))
    );
  } catch (err) {
    console.error("statuses error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};
