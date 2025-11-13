// src/services/barcodeService.js
const pool = require("../../core/db/index");
const fail = require("../../utils/fail");
/* ---------------- Helpers ---------------- */
function normalize(code) {
  const s = String(code ?? "").trim();
  return s ? s.toUpperCase() : null;
}

/**
 * Barkod formatı + kind doğrulama
 * component: C + 8 hane
 * product  : P + 8 hane
 */
function assertFormatAndKind(code, kind) {
  const c = normalize(code);
  const k = String(kind || "").toLowerCase();

  if (k !== "component" && k !== "product") {
    throw fail("BARCODE_KIND_UNKNOWN", 422, { kind });
  }
  const reComponent = /^C[0-9]{8}$/;
  const reProduct   = /^P[0-9]{8}$/;

  const ok =
    (k === "component" && reComponent.test(c)) ||
    (k === "product"   && reProduct.test(c));

  if (!ok) {
    throw fail("BARCODE_FORMAT_INVALID", 400, {
      code: c, kind: k, expected: k === "component" ? "^C\\d{8}$" : "^P\\d{8}$",
    });
  }
  return { code: c, kind: k };
}

/* İsteğe bağlı client sarmalayıcı */
async function withClient(maybeClient, fn) {
  if (maybeClient) return fn(maybeClient, false);
  const client = await pool.connect();
  try { return await fn(client, true); } finally { client.release(); }
}

/* ---------------- Public API ---------------- */
/**
 * Havuzdan tüket/işaretle (barcode_pool)
 */
async function assertAndConsume(client, { code, kind, refTable = null, refId = null }) {
  const { code: c, kind: k } = assertFormatAndKind(code, kind);

  return withClient(client, async (db) => {
    const { rows } = await db.query(
      `SELECT id, code, kind, status
         FROM barcode_pool
        WHERE code = $1
        FOR UPDATE`,
      [c]
    );
    if (!rows.length) throw fail("BARCODE_NOT_IN_POOL", 409, { code: c, kind: k });

    const row = rows[0];
    if (String(row.kind).toLowerCase() !== k)  throw fail("BARCODE_KIND_MISMATCH", 409, { code: c, expected: k, actual: row.kind });
    const st = String(row.status).toLowerCase();
    if (st === "void")  throw fail("BARCODE_VOID", 409, { code: c });
    if (st === "used")  throw fail("BARCODE_ALREADY_USED", 409, { code: c });
    if (st !== "available") throw fail("BARCODE_STATUS_INVALID", 409, { code: c, status: st });

    await db.query(
      `UPDATE barcode_pool
          SET status='used', used_at=NOW(), used_ref_table=$2, used_ref_id=$3
        WHERE code=$1`,
      [c, refTable, refId ?? null]
    );
    return { ok: true, code: c, kind: k };
  });
}

/**
 * Değişim senaryosu için tek kapı:
 * - incoming undefined ise değiştirme → mevcut döner
 * - incoming normalize + format check
 * - tablo çakışma kontrolü (dışarıdan verilen conflictChecker)
 * - pool tüketme
 * DÖNER: { nextBarcode, changed }
 */
async function ensureChangeAndConsume(client, {
  table,            // "components" | "products"
  id,               // güncellenen kaydın id'si
  kind,             // "component" | "product"
  incoming,         // kullanıcıdan gelen barkod (undefined/null/string)
  current,          // mevcut barkod (string|null)
  conflictChecker,  // async (client, table, code, id) => boolean
}) {
  if (incoming === undefined) {
    // hiç dokunulmadı
    return { nextBarcode: normalize(current), changed: false };
  }

  const next = normalize(incoming);
  const prev = normalize(current);
  const changed = next !== prev;

  if (!changed) return { nextBarcode: prev, changed: false };
  if (next) {
    assertFormatAndKind(next, kind);
    const hasConflict = await conflictChecker(client, table, next, id);
    if (hasConflict) throw fail("BARCODE_CONFLICT", 409, { code: next, table, id });
    await assertAndConsume(client, { code: next, kind, refTable: table, refId: id });
  }
  return { nextBarcode: next, changed: true };
}

module.exports = {
  normalize,
  assertFormatAndKind,
  assertAndConsume,
  ensureChangeAndConsume,
};
