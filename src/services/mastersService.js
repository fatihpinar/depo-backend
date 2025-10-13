// services/mastersService.js
const pool = require("../config/db");
const { buildDisplayLabel } = require("../constants/masterDisplay");
const { getFieldsForCategory, getBaseFields } = require("../constants/masterFieldSchema");

/* -------------------------------------------------------
 * Helpers
 * ----------------------------------------------------- */
const toNull = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

const isEmpty = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Şemaya göre izinli alanları (base + kategoriye özel)
 * ve required alan listesini döndürür.
 */
function deriveSchemaFor(categoryId) {
  const base = getBaseFields();                       // [{name, required, ...}]
  const cat  = getFieldsForCategory(categoryId);      // { fields: [...] }

  const allowedNames = new Set([
    ...base.map((f) => f.name),
    ...cat.fields.map((f) => f.name),
    // FK alanları her zaman izinli:
    "category_id",
    "type_id",
    "supplier_id",
  ]);

  const requiredNames = [
    ...base.filter((f) => f.required).map((f) => f.name),
    ...cat.fields.filter((f) => f.required).map((f) => f.name),
  ];

  return { allowedNames, requiredNames };
}

/**
 * Display label üretimi için gerektiğinde type/supplier isimlerini getirir.
 */
async function resolveNames({ type_id, supplier_id }) {
  let type_name = null;
  if (type_id) {
    const { rows } = await pool.query("SELECT name FROM types WHERE id=$1", [type_id]);
    type_name = rows[0]?.name || null;
  }

  let supplier_name = null;
  if (supplier_id) {
    const { rows } = await pool.query("SELECT name FROM suppliers WHERE id=$1", [supplier_id]);
    supplier_name = rows[0]?.name || null;
  }

  return { type_name, supplier_name };
}

/**
 * Ortak SELECT (JOIN’li) – tek satır
 */
async function getJoinedById(id) {
  const sql = `
    SELECT
      pm.*,
      t.name AS type_name,
      s.name AS supplier_name,
      c.name AS category_name
    FROM masters pm
    JOIN types t           ON pm.type_id = t.id
    LEFT JOIN suppliers s  ON pm.supplier_id = s.id
    LEFT JOIN categories c ON pm.category_id = c.id
    WHERE pm.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

/* -------------------------------------------------------
 * LIST
 * ----------------------------------------------------- */
exports.list = async ({ categoryId = 0, typeId = 0, search = "" } = {}) => {
  let sql = `
    SELECT
      pm.*,
      t.name AS type_name,
      s.name AS supplier_name,
      c.name AS category_name
    FROM masters pm
    JOIN types t           ON pm.type_id = t.id
    LEFT JOIN suppliers s  ON pm.supplier_id = s.id
    LEFT JOIN categories c ON pm.category_id = c.id
  `;

  const where = [];
  const params = [];

  if (categoryId > 0) { params.push(categoryId); where.push(`pm.category_id = $${params.length}`); }
  if (typeId     > 0) { params.push(typeId);     where.push(`pm.type_id     = $${params.length}`); }

  if (search) {
    const term = `%${search}%`;
    params.push(term); const p1 = params.length; // display_label
    params.push(term); const p2 = params.length; // bimeks_code
    params.push(term); const p3 = params.length; // supplier name
    params.push(term); const p4 = params.length; // type name
    where.push(`(
      pm.display_label ILIKE $${p1} OR
      pm.bimeks_code   ILIKE $${p2} OR
      s.name           ILIKE $${p3} OR
      t.name           ILIKE $${p4}
    )`);
  }

  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY pm.id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
};

/* -------------------------------------------------------
 * CREATE  (name tamamen kaldırıldı)
 *  - Şemadan required kontrolü
 *  - Sadece şemada izinli alanları yazar
 *  - display_label otomatik üretilir
 * ----------------------------------------------------- */
exports.create = async (payload = {}) => {
  // temel zorunlular
  const category_id = Number(payload.category_id);
  const type_id     = Number(payload.type_id);
  if (!category_id || !type_id) {
    const e = new Error("category_id ve type_id zorunludur");
    e.status = 400; throw e;
  }

  // şema & required
  const { allowedNames, requiredNames } = deriveSchemaFor(category_id);

  // payload’ı izinli set’e göre filtrele
  const clean = {};
  Object.keys(payload || {}).forEach((k) => {
    if (allowedNames.has(k)) clean[k] = payload[k];
  });

  // required alan kontrolü (gelen değerlere bakılır)
  const missing = requiredNames.filter((n) => isEmpty(clean[n]));
  if (missing.length) {
    const e = new Error(`Eksik zorunlu alan(lar): ${missing.join(", ")}`);
    e.status = 400; e.code = "required_fields_missing"; throw e;
  }

  // NULL normalizasyonu
  [
    "supplier_id",
    "supplier_product_code",
    "color_pattern",
    "thickness",
    "width",
    "density",
    "bimeks_code",
    "weight",
    "liner_thickness",
    "liner_color",
    "adhesive_grammage_gm2",
    "supplier_lot_no",
  ].forEach((k) => { if (k in clean) clean[k] = toNull(clean[k]); });

  // defaultlar
  clean.unit_kind    = clean.unit_kind    || "count";
  clean.default_unit = clean.default_unit || "EA";

  // type/supplier isimleri
  const { type_name, supplier_name } = await resolveNames({
    type_id: clean.type_id || type_id,
    supplier_id: clean.supplier_id,
  });

  // display label
  const display_label = buildDisplayLabel({
    category_id,
    supplier_product_code: clean.supplier_product_code,
    color_pattern:         clean.color_pattern,
    thickness:             clean.thickness,
    width:                 clean.width,
    density:               clean.density,
    bimeks_code:           clean.bimeks_code,
    weight:                clean.weight,
    liner_thickness:       clean.liner_thickness,
    liner_color:           clean.liner_color,
    adhesive_grammage_gm2: clean.adhesive_grammage_gm2,
    supplier_lot_no:       clean.supplier_lot_no,
    type_name,
    supplier_name,
  });

  // INSERT kolonları – name yok!
  const cols = [
    "category_id", "type_id", "supplier_id", "supplier_product_code",
    "color_pattern", "thickness", "width", "density",
    "bimeks_code", "weight", "unit_kind", "default_unit",
    "liner_thickness", "liner_color", "adhesive_grammage_gm2", "supplier_lot_no",
    "display_label", "created_at", "updated_at",
  ];

  const vals = [
    category_id,
    type_id,
    clean.supplier_id || null,
    clean.supplier_product_code || null,
    clean.color_pattern || null,
    clean.thickness || null,
    clean.width || null,
    clean.density || null,
    clean.bimeks_code || null,
    clean.weight || null,
    clean.unit_kind,
    clean.default_unit,
    clean.liner_thickness || null,
    clean.liner_color || null,
    clean.adhesive_grammage_gm2 || null,
    clean.supplier_lot_no || null,
    display_label,
  ];

  const placeholders = cols.map((_, i) => `$${i + 1}`).slice(0, cols.length - 2); // created_at / updated_at manuel
  const sql = `
    INSERT INTO masters (${cols.join(", ")})
    VALUES (${placeholders.join(", ")}, NOW(), NOW())
    RETURNING id
  `;

  const { rows } = await pool.query(sql, vals);
  const insertedId = rows[0].id;
  return await getJoinedById(insertedId);
};

/* -------------------------------------------------------
 * GET BY ID (JOIN’li)
 * ----------------------------------------------------- */
exports.getById = async (id) => {
  return await getJoinedById(id);
};

/* -------------------------------------------------------
 * UPDATE Bimeks Code (+display_label yeniden)
 * ----------------------------------------------------- */
exports.updateBimeks = async (id, bimeks_code) => {
  const current = await exports.getById(id);
  if (!current) {
    const e = new Error("NOT_FOUND"); e.status = 404; throw e;
  }

  const new_bimeks = toNull(bimeks_code);

  const display_label = buildDisplayLabel({
    ...current,
    bimeks_code: new_bimeks,
    // current zaten type_name & supplier_name içeriyor
  });

  const { rowCount } = await pool.query(
    `UPDATE masters
       SET bimeks_code = $1,
           display_label = $2,
           updated_at = NOW()
     WHERE id = $3`,
    [new_bimeks, display_label, id]
  );

  if (!rowCount) {
    const e = new Error("NOT_FOUND"); e.status = 404; throw e;
  }
  return await exports.getById(id);
};

/* -------------------------------------------------------
 * UPDATE (şema-temelli, kısmi update)
 *  - Sadece izinli alanları günceller
 *  - Zorunlu alanları (base + kategori) doğrular
 *  - display_label’ı yeniden üretir
 * ----------------------------------------------------- */
exports.update = async (id, payload = {}) => {
  const current = await exports.getById(id);
  if (!current) {
    const e = new Error("NOT_FOUND"); e.status = 404; throw e;
  }

  const effectiveCategoryId = payload.category_id ?? current.category_id;
  const { allowedNames, requiredNames } = deriveSchemaFor(effectiveCategoryId);

  // sadece izinli alanlar
  const clean = {};
  Object.keys(payload || {}).forEach((k) => {
    if (allowedNames.has(k)) clean[k] = payload[k];
  });

  // required kontrolü (mevcut + gelen birleşik)
  const merged = { ...current, ...clean };
  const missing = requiredNames.filter((n) => isEmpty(merged[n]));
  if (missing.length) {
    const e = new Error(`Eksik zorunlu alan(lar): ${missing.join(", ")}`);
    e.status = 400; e.code = "required_fields_missing"; throw e;
  }

  // type/supplier adları (değişmişse yeniden çöz)
  const finalTypeId     = merged.type_id;
  const finalSupplierId = merged.supplier_id;

  let type_name     = current.type_name || null;
  let supplier_name = current.supplier_name || null;

  if (finalTypeId && finalTypeId !== current.type_id) {
    const { rows } = await pool.query("SELECT name FROM types WHERE id=$1", [finalTypeId]);
    type_name = rows[0]?.name || null;
  }
  if (finalSupplierId && finalSupplierId !== current.supplier_id) {
    const { rows } = await pool.query("SELECT name FROM suppliers WHERE id=$1", [finalSupplierId]);
    supplier_name = rows[0]?.name || null;
  }

  // display label
  const display_label = buildDisplayLabel({
    category_id: effectiveCategoryId,
    supplier_product_code: merged.supplier_product_code,
    color_pattern:         merged.color_pattern,
    thickness:             merged.thickness,
    width:                 merged.width,
    density:               merged.density,
    bimeks_code:           merged.bimeks_code,
    weight:                merged.weight,
    liner_thickness:       merged.liner_thickness,
    liner_color:           merged.liner_color,
    adhesive_grammage_gm2: merged.adhesive_grammage_gm2,
    supplier_lot_no:       merged.supplier_lot_no,
    type_name,
    supplier_name,
  });

  // dinamik UPDATE
  const fields = [];
  const params = [];
  let i = 1;

  Object.keys(clean).forEach((k) => {
    fields.push(`${k} = $${i++}`);
    params.push(clean[k] === "" ? null : clean[k]);
  });

  fields.push(`display_label = $${i++}`);
  params.push(display_label);

  fields.push(`updated_at = NOW()`);

  params.push(id);
  const sql = `
    UPDATE masters
       SET ${fields.join(", ")}
     WHERE id = $${i}
  `;

  await pool.query(sql, params);
  return await exports.getById(id);
};
