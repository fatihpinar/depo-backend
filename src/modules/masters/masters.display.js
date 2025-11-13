// src/constants/masterDisplay.js
const joinSp = (xs) =>
  xs.filter(Boolean).map((s) => String(s).trim()).filter(Boolean).join(" ");

const u = (v, unit) => (v || v === 0 ? `${v} ${unit}` : "");

/**
 * masters kaydından display_label üretir
 * @param {object} m  // type_name, supplier_name dahil edilirse daha iyi görünür
 */
function buildDisplayLabel(m = {}) {
  const type     = m.type_name || m.type || "";
  const supplier = m.supplier_name || m.supplier || "";

  switch (Number(m.category_id)) {
    // 1) Carrier / Taşıyıcı
    case 1:
      return joinSp([
        type,
        supplier,
        m.supplier_product_code,
        u(m.thickness ?? m.carrier_thickness, "mm"),
        m.color_pattern ?? m.carrier_color,
        u(m.density ?? m.carrier_density, "m³"),
        m.bimeks_code,
      ]);

    // 2) Release Liner / Koruyucu Folyo
    case 2:
      return joinSp([
        type,
        supplier,
        m.supplier_product_code,
        u(m.liner_thickness ?? m.thickness, "mm"),
        m.liner_color ?? m.color_pattern,
        u(m.liner_density ?? m.density, "m³"),
        m.bimeks_code,
      ]);

    // 3) Adhesive / Yapışkan
    case 3:
      return joinSp([
        type,
        supplier,
        m.supplier_product_code,
        u(m.adhesive_grammage_gm2 ?? m.gramaj, "gr/m²"),
        m.bimeks_code,
      ]);

    // 4) Yarı Mamül / Mamul
    case 4:
      return joinSp([
        type,
        supplier,
        m.supplier_product_code,
        m.supplier_lot_no, // yoksa boş geçer
        m.bimeks_code,
      ]);

    default:
      // kategori gelmezse de makul bir etiket üret
      return joinSp([type, supplier, m.supplier_product_code, m.bimeks_code]);
  }
}

module.exports = { buildDisplayLabel };
