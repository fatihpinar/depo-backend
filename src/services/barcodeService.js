// src/services/barcodeService.js
const pool = require("../config/db");
const fail = require("../utils/fail");

/** -------------------------------------------------------
 * Helpers
 * ----------------------------------------------------- */
function normalize(code) {
  return String(code || "").trim().toUpperCase();
}

/**
 * Barkod formatı + kind doğrulama
 * - component: C + 8 hane
 * - product  : P + 8 hane
 * Hatalarda fail(code, status, details) döner.
 */
function assertFormatAndKind(code, kind) {
  const c = normalize(code);
  const k = String(kind || "").toLowerCase();

  if (k !== "component" && k !== "product") {
    throw fail("BARCODE_KIND_UNKNOWN", 422, { kind });
  }

  const reComponent = /^C[0-9]{8}$/;
  const reProduct = /^P[0-9]{8}$/;

  const ok =
    (k === "component" && reComponent.test(c)) ||
    (k === "product" && reProduct.test(c));

  if (!ok) {
    throw fail("BARCODE_FORMAT_INVALID", 400, {
      code: c,
      kind: k,
      expected: k === "component" ? "^C\\d{8}$" : "^P\\d{8}$",
    });
  }

  return { code: c, kind: k };
}

/**
 * İsteğe bağlı dışarıdan client kullan (aynı transaction içinde).
 */
async function withClient(maybeClient, fn) {
  if (maybeClient) return fn(maybeClient, false);
  const client = await pool.connect();
  try {
    return await fn(client, true);
  } finally {
    client.release();
  }
}

/** -------------------------------------------------------
 * Public API
 * ----------------------------------------------------- */
/**
 * Havuzdan “tüket/işaretle” (consume):
 * - code/kind doğrula
 * - barcode_pool satırını FOR UPDATE ile kilitle
 * - status kontrolü: available → OK; used/void → hata
 * - UPDATE: status='used', used_at, used_ref_table, used_ref_id
 *
 * @param {object|null} client   - opsiyonel pg client (transaction içinde)
 * @param {object}      params   - { code, kind: 'component'|'product', refTable?, refId? }
 */
async function assertAndConsume(client, { code, kind, refTable = null, refId = null }) {
  const { code: c, kind: k } = assertFormatAndKind(code, kind);

  return withClient(client, async (db) => {
    // 1) Satırı kilitle
    const { rows } = await db.query(
      `SELECT id, code, kind, status
         FROM barcode_pool
        WHERE code = $1
        FOR UPDATE`,
      [c]
    );

    if (rows.length === 0) {
      // Basılı/pool listesinde yok
      throw fail("BARCODE_NOT_IN_POOL", 409, { code: c, kind: k });
    }

    const row = rows[0];

    // Kind uyuşmazlığı
    if (String(row.kind).toLowerCase() !== k) {
      throw fail("BARCODE_KIND_MISMATCH", 409, {
        code: c,
        expected: k,
        actual: row.kind,
      });
    }

    // Status kontrolleri
    const st = String(row.status).toLowerCase();
    if (st === "void") {
      throw fail("BARCODE_VOID", 409, { code: c });
    }
    if (st === "used") {
      throw fail("BARCODE_ALREADY_USED", 409, { code: c });
    }
    if (st !== "available") {
      // beklenmedik bir statü; güvenli tarafta kal
      throw fail("BARCODE_STATUS_INVALID", 409, { code: c, status: st });
    }

    // 2) Kullanıldı olarak işaretle
    await db.query(
      `UPDATE barcode_pool
          SET status = 'used',
              used_at = NOW(),
              used_ref_table = $2,
              used_ref_id = $3
        WHERE code = $1`,
      [c, refTable, refId ?? null]
    );

    return { ok: true, code: c, kind: k };
  });
}

module.exports = {
  assertFormatAndKind,
  assertAndConsume,
};
