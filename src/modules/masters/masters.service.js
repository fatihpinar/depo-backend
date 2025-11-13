// src/modules/masters/masters.service.js
const repo = require("./masters.repository");
const { buildDisplayLabel } = require("./masters.display");
const { getFieldsForCategory, getBaseFields } = require("./masters.schema");


/* ---------------- Helpers ---------------- */
const toNull = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;

const isEmpty = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** şema: izinli + zorunlu alanlar */
function deriveSchemaFor(categoryId) {
  const base = getBaseFields();
  const cat  = getFieldsForCategory(categoryId);

  const allowedNames = new Set([
    ...base.map((f) => f.name),
    ...cat.fields.map((f) => f.name),
    "category_id", "type_id", "supplier_id",
  ]);

  const requiredNames = [
    ...base.filter((f) => f.required).map((f) => f.name),
    ...cat.fields.filter((f) => f.required).map((f) => f.name),
  ];

  return { allowedNames, requiredNames };
}

/** display label üretimi için tip/supplier adları resolve */
async function resolveNames({ type_id, supplier_id }) {
  return await repo.resolveNames(type_id, supplier_id);
}

/* ---------------- List ---------------- */
exports.list = async ({ categoryId = 0, typeId = 0, search = "" } = {}) => {
  return await repo.findMany({ categoryId, typeId, search });
};

/* ---------------- GetById ---------------- */
exports.getById = async (id) => {
  return await repo.findJoinedById(id);
};

/* ---------------- Create ---------------- */
exports.create = async (payload = {}) => {
  const category_id = Number(payload.category_id);
  const type_id     = Number(payload.type_id);
  if (!category_id || !type_id) {
    const e = new Error("category_id ve type_id zorunludur");
    e.status = 400; throw e;
  }

  const { allowedNames, requiredNames } = deriveSchemaFor(category_id);

  const clean = {};
  Object.keys(payload || {}).forEach((k) => {
    if (allowedNames.has(k)) clean[k] = payload[k];
  });

  const missing = requiredNames.filter((n) => isEmpty(clean[n]));
  if (missing.length) {
    const e = new Error(`Eksik zorunlu alan(lar): ${missing.join(", ")}`);
    e.status = 400; e.code = "required_fields_missing"; throw e;
  }

  [
    "supplier_id",
    "supplier_product_code",
    "color_pattern",
    "thickness",
    "width",
    "density",
    "weight",
    "liner_thickness",
    "liner_color",
    "adhesive_grammage_gm2",
    "supplier_lot_no",
  ].forEach((k) => { if (k in clean) clean[k] = toNull(clean[k]); });

  clean.unit_kind    = clean.unit_kind    || "count";
  clean.default_unit = clean.default_unit || "EA";

  const { type_name, supplier_name } = await resolveNames({
    type_id: clean.type_id || type_id,
    supplier_id: clean.supplier_id,
  });

  const display_label = buildDisplayLabel({
    category_id,
    supplier_product_code: clean.supplier_product_code,
    color_pattern:         clean.color_pattern,
    thickness:             clean.thickness,
    width:                 clean.width,
    density:               clean.density,
    weight:                clean.weight,
    liner_thickness:       clean.liner_thickness,
    liner_color:           clean.liner_color,
    adhesive_grammage_gm2: clean.adhesive_grammage_gm2,
    supplier_lot_no:       clean.supplier_lot_no,
    type_name,
    supplier_name,
  });

  return await repo.insertOne({ ...clean, category_id, type_id, display_label });
};

/* ---------------- Update (full) ---------------- */
exports.update = async (id, payload = {}) => {
  const current = await repo.findJoinedById(id);
  if (!current) { const e = new Error("NOT_FOUND"); e.status = 404; throw e; }

  const effectiveCategoryId = payload.category_id ?? current.category_id;
  const { allowedNames, requiredNames } = deriveSchemaFor(effectiveCategoryId);

  const clean = {};
  Object.keys(payload || {}).forEach((k) => {
    if (allowedNames.has(k)) clean[k] = payload[k];
  });

  const merged = { ...current, ...clean };
  const missing = requiredNames.filter((n) => isEmpty(merged[n]));
  if (missing.length) {
    const e = new Error(`Eksik zorunlu alan(lar): ${missing.join(", ")}`);
    e.status = 400; e.code = "required_fields_missing"; throw e;
  }

  const finalTypeId     = merged.type_id;
  const finalSupplierId = merged.supplier_id;

  const { type_name, supplier_name } = await resolveNames({
    type_id: finalTypeId,
    supplier_id: finalSupplierId,
  });

  const display_label = buildDisplayLabel({
    category_id: effectiveCategoryId,
    supplier_product_code: merged.supplier_product_code,
    color_pattern:         merged.color_pattern,
    thickness:             merged.thickness,
    width:                 merged.width,
    density:               merged.density,
    weight:                merged.weight,
    liner_thickness:       merged.liner_thickness,
    liner_color:           merged.liner_color,
    adhesive_grammage_gm2: merged.adhesive_grammage_gm2,
    supplier_lot_no:       merged.supplier_lot_no,
    type_name,
    supplier_name,
  });

  await repo.updateOne(id, { ...clean, display_label });
  return await repo.findJoinedById(id);
};
