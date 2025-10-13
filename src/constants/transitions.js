// src/constants/transitions.js

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

// Eğer BE “statuses” tablosundan label gelmezse, to_status_id’ye göre kullanırız
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
  // Öncelik: BE’den gelen to_status_label → fallback → aksiyon sözlüğü
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

/**
 * Tüm detay sayfaları için ortak “geçiş” metinlerini üretir.
 * @param {object} t  // inventory_transitions satırı
 * @returns {{ title: string, placeLine: string|null, extras: string[] }}
 */
function formatTransitionTR(t) {
  // Başlık: to_status_label varsa onu; yoksa fallback→aksiyon
  const title = translateActionTR(t.action, t.to_status_id, t.to_status_label);

  // Yer bilgisi:
  // 1) from/to mevcutsa “Depo/Lokasyon: A/B → C/D”
  // 2) sadece hedef veya mevcut varsa “Depo/Lokasyon: X / Y”
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

  // Ek rozetler: miktar, yeni barkod vb.
  const extras = [];
  const q = qtyText(t.qty_delta, t.unit);
  if (q) extras.push(q);
  if (t.meta && t.meta.new_barcode) extras.push(`Yeni barkod: ${t.meta.new_barcode}`);

  return { title, placeLine, extras };
}

// ——— Dışa aktarım ———
module.exports = {
  ITEM_TYPE,
  ACTION,
  ACTION_LABEL_TR,
  STATUS_LABEL_FALLBACK_TR,
  translateActionTR,
  qtyText,
  formatTransitionTR,
};
