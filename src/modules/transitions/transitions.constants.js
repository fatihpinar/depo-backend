// ——— VAR OLANLAR (aynen dursun) ———
const ITEM_TYPE = Object.freeze({ COMPONENT: "component", PRODUCT: "product" });
const ACTION = Object.freeze({
  CREATE: "CREATE",
  APPROVE: "APPROVE",
  ASSEMBLE_PRODUCT: "ASSEMBLE_PRODUCT",
  CONSUME: "CONSUME",
  RETURN: "RETURN",
  MOVE: "MOVE",
  STATUS_CHANGE: "STATUS_CHANGE",
  ADJUST: "ADJUST",
  ATTRIBUTE_CHANGE: "ATTRIBUTE_CHANGE",
});

// ——— YENİ: TR aksiyon ve (fallback) statü sözlükleri ———
const ACTION_LABEL_TR = Object.freeze({
  CREATE: "Yeni kayıt",
  APPROVE: "Onaylandı",
  ASSEMBLE_PRODUCT: "Ürün oluşturuldu",
  CONSUME: "Tüketim",
  RETURN: "İade",
  MOVE: "Yer değişti",
  STATUS_CHANGE: "Durum değişti",
  ADJUST: "Düzeltme",
  ATTRIBUTE_CHANGE: "Özellik değişti",
});

const STATUS_LABEL_FALLBACK_TR = Object.freeze({
  1: "Depoda",           // in_stock
  2: "Kullanıldı",       // used
  3: "Satıldı",          // sold
  4: "Beklemede",        // pending
  5: "Hasarlı / Kayıp",  // damaged_lost
  6: "Üretimde",         // production
  7: "Serigrafide",      // screenprint
});

// ——— Yardımcılar ———
function translateActionTR(action, toStatusId, toStatusLabel) {
  if (toStatusLabel) return String(toStatusLabel);
  if (toStatusId && STATUS_LABEL_FALLBACK_TR[toStatusId]) {
    return STATUS_LABEL_FALLBACK_TR[toStatusId];
  }
  return ACTION_LABEL_TR[action] || String(action);
}

function qtyText(delta, unit) {
  if (typeof delta !== "number" || !unit) return null;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const abs = Math.abs(delta);
  return `${sign}${abs} ${unit}`;
}

function formatTransitionTR(t) {
  const title = translateActionTR(t.action, t.to_status_id, t.to_status_label);

  const fromWh = t.from_warehouse_name || null;
  const fromLc = t.from_location_name || null;
  const toWh = t.to_warehouse_name || null;
  const toLc = t.to_location_name || null;

  let placeLine = null;
  const show = (w, l) => `${w || "—"} / ${l || "—"}`;

  if (fromWh || fromLc || toWh || toLc) {
    if ((fromWh || fromLc) && (toWh || toLc)) {
      placeLine = `Yer: ${show(fromWh, fromLc)} → ${show(toWh, toLc)}`;
    } else if (toWh || toLc) {
      placeLine = `Yer: ${show(toWh, toLc)}`;
    } else {
      placeLine = `Yer: ${show(fromWh, fromLc)}`;
    }
  }

  const extras = [];
  const q = qtyText(t.qty_delta, t.unit);
  if (q) extras.push(q);
  if (t.meta && t.meta.new_barcode) extras.push(`Yeni barkod: ${t.meta.new_barcode}`);

  return { title, placeLine, extras };
}

module.exports = {
  ITEM_TYPE,
  ACTION,
  ACTION_LABEL_TR,
  STATUS_LABEL_FALLBACK_TR,
  translateActionTR,
  qtyText,
  formatTransitionTR,
};
