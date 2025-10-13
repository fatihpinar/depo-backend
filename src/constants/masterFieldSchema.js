// src/constants/masterFieldSchema.js
const VERSION = 1;

/** Üstte her kategori için gösterilecek 5 alan */
const BASE_FIELDS = [
  { key: "type_id",               label: "Tür",                    kind: "select", required: true },
  { key: "supplier_id",           label: "Tedarikçi",              kind: "select", required: false },
  { key: "supplier_product_code", label: "Tedarikçi Ürün Kodu",    kind: "text",   required: false },
  { key: "supplier_lot_no",       label: "Tedarikçi Lot Numarası", kind: "text",   required: false },
  { key: "bimeks_code",           label: "Bimeks Kodu",            kind: "text",   required: false },
];

/** Kategoriye özel alanlar (Excel’e bire bir) */
const CATEGORY_FIELDS = {
  carrier: [
    { key: "thickness",     label: "Kalınlık",     kind: "number", unitSuffix: "mm"    , required: false },
    { key: "color_pattern", label: "Renk / Desen", kind: "text"                         , required: false },
    { key: "density",       label: "Yoğunluk",     kind: "number", unitSuffix: "kg/m³" , required: false },
  ],

  release_liner: [
    { key: "thickness",     label: "Kalınlık",     kind: "number", unitSuffix: "mm"    , required: false },
    { key: "color_pattern", label: "Renk / Desen", kind: "text"                         , required: false },
    { key: "density",       label: "Yoğunluk",     kind: "number", unitSuffix: "kg/m³" , required: false },
  ],

  adhesive: [
    { key: "weight",                label: "Ağırlık / Kutu", kind: "number", unitSuffix: "kg/kutu", required: false },
    { key: "adhesive_grammage_gm2", label: "Gramaj",         kind: "number", unitSuffix: "gr/m²"  , required: false },
  ],

  semi_product: [
    { key: "adhesive_type",         label: "Yapışkan Türü",      kind: "text"                        , required: false },
    { key: "adhesive_grammage_gm2", label: "Yapışkan Gramajı",   kind: "number", unitSuffix: "gr/m²" , required: false },
    { key: "carrier_color",         label: "Taşıyıcı Rengi",     kind: "text"                        , required: false },
    { key: "carrier_thickness",     label: "Taşıyıcı Kalınlığı", kind: "number", unitSuffix: "mm"    , required: false },
    { key: "liner_type",            label: "Liner Cinsi",        kind: "text"                        , required: false },
    { key: "carrier_density",       label: "Taşıyıcı Yoğunluğu", kind: "number", unitSuffix: "kg/m³" , required: false },
    { key: "liner_color",           label: "Liner Rengi",        kind: "text"                        , required: false },
  ],
};

/** İsim ve ID ile çalışabilen map — FE hiç dokunmadan kullanabilsin */
const CATEGORY_MAP_BY_ID = {
  1: "carrier",
  2: "release_liner",
  3: "adhesive",
  4: "semi_product",
};
const CATEGORY_MAP_BY_NAME = {
  "CARRIER": "carrier",
  "RELEASE LINER": "release_liner",
  "ADHESIVE": "adhesive",
  "PRODUCT": "semi_product",
};

/* ----------------- Şema yardımcıları (BE için) ----------------- */

// FE yapısındaki {key,...} alanlarını BE için {name,...}’e dönüştür.
const normalize = (field) => ({
  name: field.key,
  label: field.label,
  required: !!field.required,
  kind: field.kind,
  unitSuffix: field.unitSuffix,
  options: field.options,
});

/** Tüm kategoriler için ortak alanlar (BE kullanımı) */
function getBaseFields() {
  return BASE_FIELDS.map(normalize);
}

/**
 * Kategoriye özel alanlar (BE kullanımı)
 * @param {number|string} category - id (1..4) veya isim ("CARRIER" vb.)
 * @returns {{ fields: Array<{name:string,label:string,required:boolean}> }}
 */
function getFieldsForCategory(category) {
  const key =
    typeof category === "number" || /^[0-9]+$/.test(String(category))
      ? CATEGORY_MAP_BY_ID[Number(category)]
      : CATEGORY_MAP_BY_NAME[String(category).toUpperCase()];

  const raw = key ? CATEGORY_FIELDS[key] || [] : [];
  return { fields: raw.map(normalize) };
}

/** FE’nin kullandığı tam şema (değiştirmiyoruz) */
function getSchema() {
  return {
    version: VERSION,
    baseFields: BASE_FIELDS,
    categoryFields: CATEGORY_FIELDS,
    categoryMapById: CATEGORY_MAP_BY_ID,
    categoryMapByName: CATEGORY_MAP_BY_NAME,
  };
}

module.exports = {
  // FE için mevcut export’lar
  VERSION,
  BASE_FIELDS,
  CATEGORY_FIELDS,
  CATEGORY_MAP_BY_ID,
  CATEGORY_MAP_BY_NAME,
  getSchema,

  // BE için yeni yardımcılar
  getBaseFields,
  getFieldsForCategory,
};
