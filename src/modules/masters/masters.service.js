// src/modules/masters/masters.service.js
const pool = require("../../core/db/index");
const repo = require("./masters.repository");


// ---- LIST / DETAIL ----
exports.list = async (filters = {}) => {
  return repo.findMany(filters);
};

exports.getById = async (id) => {
  return repo.findJoinedById(id);
};


// NULL ise "00", varsa display_code dönen yardımcı
async function getDisplayCode(client, table, id, pad = 0, defaultCode = "00") {
  if (!id) return defaultCode;
  const { rows } = await client.query(
    `SELECT display_code FROM ${table} WHERE id = $1`,
    [id]
  );
  if (!rows[0] || !rows[0].display_code) return defaultCode;

  let code = String(rows[0].display_code).trim();
  if (pad > 0) code = code.padStart(pad, "0");
  return code;
}

// Sayısal alanları (kalınlık / yoğunluk) kodlamak için
function numericToCode(value, totalDigits) {
  if (value === null || value === undefined || value === "") {
    return "".padStart(totalDigits, "0");
  }
  const s = String(value).replace(",", "."); // TR decimal -> .
  const normalized = s.replace(".", "");
  return normalized.padStart(totalDigits, "0");
}


/* ========== CREATE (YENİ MİMARİ) ========== */

exports.create = async (payload = {}) => {
  const {
    product_type_id,
    supplier_id,
    carrier_type_id,
    carrier_color_id,
    liner_color_id,
    liner_type_id,
    adhesive_type_id,
    thickness,           // numeric
    carrier_density,     // numeric
    supplier_product_code,
    bimeks_product_name,

    // 🔹 Yeni alanlar:
    stock_unit,          // "area" | "weight"
  } = payload || {};

  // ---- Zorunlu alan kontrolleri ----
  if (!product_type_id) {
    const e = new Error("PRODUCT_TYPE_REQUIRED");
    e.status = 400;
    e.message = "Ürün türü zorunludur.";
    throw e;
  }
  if (!supplier_id) {
    const e = new Error("SUPPLIER_REQUIRED");
    e.status = 400;
    e.message = "Tedarikçi zorunludur.";
    throw e;
  }
  if (!bimeks_product_name || !String(bimeks_product_name).trim()) {
    const e = new Error("BIMEKS_PRODUCT_NAME_REQUIRED");
    e.status = 400;
    e.message = "Bimeks ürün tanımı zorunludur.";
    throw e;
  }
  if (!supplier_product_code || !String(supplier_product_code).trim()) {
    const e = new Error("SUPPLIER_PRODUCT_CODE_REQUIRED");
    e.status = 400;
    e.message = "Tedarikçi ürün kodu zorunludur.";
    throw e;
  }

  // ---- Stok birimi ("area" veya "weight") ----
  const allowedStockUnits = ["area", "weight", "length", "unit", "box_unit"];

  let finalStockUnit = (stock_unit || "").toLowerCase();

  if (!allowedStockUnits.includes(finalStockUnit)) {
    const e = new Error("STOCK_UNIT_REQUIRED");
    e.status = 400;
    e.message =
      "Geçerli bir stok birimi seçilmelidir (alan / ağırlık / uzunluk / adet).";
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Display code'ları çek
    const supplierCode     = await getDisplayCode(client, "suppliers",      supplier_id,      0, "00");
    const productTypeCode  = await getDisplayCode(client, "product_types",  product_type_id,  0, "0");
    const carrierTypeCode  = await getDisplayCode(client, "carrier_types",  carrier_type_id,  0, "0");
    const carrierColorCode = await getDisplayCode(client, "carrier_colors", carrier_color_id, 0, "00");
    const linerColorCode   = await getDisplayCode(client, "liner_colors",   liner_color_id,   0, "00");
    const linerTypeCode    = await getDisplayCode(client, "liner_types",    liner_type_id,    0, "00");
    const adhesiveTypeCode = await getDisplayCode(client, "adhesive_types", adhesive_type_id, 0, "0");

    // 2) Kalınlık ve yoğunluk kodları
    const thicknessCode = numericToCode(thickness, 4);
    const densityCode   = numericToCode(carrier_density, 3);

    // 3) Bimeks kodu
    const bimeks_code = [
      supplierCode,
      productTypeCode,
      carrierTypeCode,
      thicknessCode,
      carrierColorCode,
      densityCode,
      linerColorCode,
      linerTypeCode,
      adhesiveTypeCode,
    ].join("");

    // 4) DB insert
    const insertSql = `
    INSERT INTO masters (
      product_type_id,
      carrier_type_id,
      supplier_id,
      supplier_product_code,
      thickness,
      carrier_density,
      carrier_color_id,
      liner_color_id,
      liner_type_id,
      adhesive_type_id,
      bimeks_code,
      bimeks_product_name,
      stock_unit
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING
      id,
      product_type_id,
      carrier_type_id,
      supplier_id,
      supplier_product_code,
      thickness,
      carrier_density,
      carrier_color_id,
      liner_color_id,
      liner_type_id,
      adhesive_type_id,
      bimeks_code,
      bimeks_product_name,
      stock_unit
  `;

    const { rows } = await client.query(insertSql, [
      product_type_id,
      carrier_type_id || null,
      supplier_id,
      supplier_product_code.trim(),
      thickness !== undefined ? thickness : null,
      carrier_density !== undefined ? carrier_density : null,
      carrier_color_id || null,
      liner_color_id || null,
      liner_type_id || null,
      adhesive_type_id || null,
      bimeks_code,
      bimeks_product_name.trim(),
      finalStockUnit,
    ]);

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");

    if (err.code === "23505") {
      err.status = 409;
      err.message = "Bu Bimeks kodu ile kayıt zaten mevcut.";
    }
    throw err;
  } finally {
    client.release();
  }
};

exports.update = async (id, payload = {}) => {
  await repo.updateOne(id, payload);
  return repo.findJoinedById(id);
};

