// src/controllers/lookupsController.js
const pool = require("../core/db/index");
//const { getSchema } = require("../modules/masters/masters.schema");

/* -------------------- PRODUCT TYPES (eski categories) -------------------- */
// FE tarafında /lookups/categories endpoint'i bozulmasın diye
// categories yerine product_types tablosundan dönüyoruz.
exports.getCategories = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM product_types ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("Kategori (product_types) hatası:", err);
    res.status(500).json({ error: "Kategoriler alınamadı" });
  }
};

/* İstersen doğrudan product_types diye ayrı endpoint de kullanacağız */
exports.getProductTypes = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, display_code FROM product_types ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("Product types hatası:", err);
    res.status(500).json({ error: "Ürün türleri alınamadı" });
  }
};

/* -------------------- CARRIER TYPES (eski types) -------------------- */
// Artık types tablosu yerine carrier_types kullanıyoruz.
// categoryId parametresini şimdilik dikkate almıyoruz.
exports.getTypesByCategory = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, display_code
         FROM carrier_types
        ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    console.error("Taşıyıcı türleri hatası (getTypesByCategory):", err);
    res.status(500).json({ error: "Türler alınamadı" });
  }
};

exports.getCarrierTypes = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, display_code
         FROM carrier_types
        ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    console.error("Taşıyıcı türleri hatası:", err);
    res.status(500).json({ error: "Taşıyıcı türleri alınamadı" });
  }
};

/* -------------------- COLORS & ADHESIVE TYPES -------------------- */

exports.getCarrierColors = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, display_code
         FROM carrier_colors
        ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    console.error("Taşıyıcı renkleri hatası:", err);
    res.status(500).json({ error: "Taşıyıcı renkleri alınamadı" });
  }
};

exports.getLinerColors = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, display_code
         FROM liner_colors
        ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    console.error("Liner renkleri hatası:", err);
    res.status(500).json({ error: "Liner renkleri alınamadı" });
  }
};

exports.getLinerTypes = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, display_code
         FROM liner_types
        ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    console.error("Liner türleri hatası:", err);
    res.status(500).json({ error: "Liner türleri alınamadı" });
  }
};

exports.getAdhesiveTypes = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, display_code
         FROM adhesive_types
        ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    console.error("Yapışkan türleri hatası:", err);
    res.status(500).json({ error: "Yapışkan türleri alınamadı" });
  }
};

/* -------------------- STATUSES -------------------- */
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
    console.error("lookups.statuses error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

/* -------------------- SUPPLIERS -------------------- */
exports.getSuppliers = async (_req, res) => {
  try {
    // display_code artık var; FE kullanmasa bile dönmekte sakınca yok
    const { rows } = await pool.query(
      "SELECT id, name, display_code FROM suppliers ORDER BY name ASC"
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
    const display_code = String(req.body?.display_code || "").trim() || null;

    if (!name) {
      return res.status(400).json({ error: "İsim zorunlu" });
    }

    const { rows } = await pool.query(
      `INSERT INTO suppliers (name, display_code)
       VALUES ($1, $2)
       RETURNING id, name, display_code`,
      [name, display_code]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Tedarikçi ekleme hatası:", err);
    res.status(500).json({ error: "Tedarikçi eklenemedi" });
  }
};

// CARRIER TYPES
exports.createCarrierType = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const display_code = String(req.body?.display_code || "").trim() || null;

    if (!name) return res.status(400).json({ error: "İsim zorunlu" });

    const { rows } = await pool.query(
      `INSERT INTO carrier_types (name, display_code)
       VALUES ($1, $2)
       RETURNING id, name, display_code`,
      [name, display_code]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Taşıyıcı türü ekleme hatası:", err);
    res.status(500).json({ error: "Taşıyıcı türü eklenemedi" });
  }
};

// CARRIER COLORS
exports.createCarrierColor = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const display_code = String(req.body?.display_code || "").trim() || null;

    if (!name) return res.status(400).json({ error: "İsim zorunlu" });

    const { rows } = await pool.query(
      `INSERT INTO carrier_colors (name, display_code)
       VALUES ($1, $2)
       RETURNING id, name, display_code`,
      [name, display_code]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Taşıyıcı rengi ekleme hatası:", err);
    res.status(500).json({ error: "Taşıyıcı rengi eklenemedi" });
  }
};

// LINER COLORS
exports.createLinerColor = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const display_code = String(req.body?.display_code || "").trim() || null;

    if (!name) return res.status(400).json({ error: "İsim zorunlu" });

    const { rows } = await pool.query(
      `INSERT INTO liner_colors (name, display_code)
       VALUES ($1, $2)
       RETURNING id, name, display_code`,
      [name, display_code]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Liner rengi ekleme hatası:", err);
    res.status(500).json({ error: "Liner rengi eklenemedi" });
  }
};

// LINER TYPES
exports.createLinerType = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const display_code = String(req.body?.display_code || "").trim() || null;

    if (!name) return res.status(400).json({ error: "İsim zorunlu" });

    const { rows } = await pool.query(
      `INSERT INTO liner_types (name, display_code)
       VALUES ($1, $2)
       RETURNING id, name, display_code`,
      [name, display_code]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Liner türü ekleme hatası:", err);
    res.status(500).json({ error: "Liner türü eklenemedi" });
  }
};

// ADHESIVE TYPES
exports.createAdhesiveType = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const display_code = String(req.body?.display_code || "").trim() || null;

    if (!name) return res.status(400).json({ error: "İsim zorunlu" });

    const { rows } = await pool.query(
      `INSERT INTO adhesive_types (name, display_code)
       VALUES ($1, $2)
       RETURNING id, name, display_code`,
      [name, display_code]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Yapışkan türü ekleme hatası:", err);
    res.status(500).json({ error: "Yapışkan türü eklenemedi" });
  }
};


/* -------------------- WAREHOUSES -------------------- */
exports.getWarehouses = async (_req, res) => {
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

/* -------------------- MASTER FIELD SCHEMA (legacy) -------------------- */
exports.getMasterFieldSchema = async (_req, res) => {
  try {
    const schema = getSchema(); // { version, baseFields, categoryFields, categoryMap }
    res.json(schema);
  } catch (err) {
    console.error("getMasterFieldSchema error:", err);
    res.status(500).json({ message: "Schema yüklenemedi" });
  }
};
