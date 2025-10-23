// src/services/approvalsService.js
const pool = require("../config/db");
const { recordTransitions, makeBatchId } = require("./inventoryTransitionsService");
const { ITEM_TYPE, ACTION } = require("../constants/transitions");
const { assertFormatAndKind, assertAndConsume } = require("./barcodeService"); // ✅ EKLENDİ

// DB status ids
const STATUS = {
  in_stock: 1,
  used: 2,
  sold: 3,
  pending: 4,
  damaged_lost: 5,
  production: 6,
  screenprint: 7,
};

const LIST_STATUS_BY_SCOPE = {
  stock: STATUS.pending,
  production: STATUS.production,
  screenprint: STATUS.screenprint,
};

const DEPT_BY_SCOPE = { production: "production", screenprint: "screenprint" };

/* ---------------- LIST ---------------- */
exports.listPending = async ({ scope = "stock", limit = 100, offset = 0, search = "" } = {}) => {
  const statusToList = LIST_STATUS_BY_SCOPE[scope];
  if (!statusToList) return [];

  const params = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };

  const unionSql = `
  (
    SELECT
      'component' AS kind,
      c.id,
      c.barcode,
      m.id AS master_id,
      COALESCE(m.display_label, CONCAT('#', m.id)) AS display_label,
      c.unit,
      CASE WHEN c.unit='EA' THEN 1 ELSE c.quantity END AS quantity,
      c.width,
      c.height,
      c.warehouse_id,
      c.location_id,
      c.updated_at
    FROM components c
    JOIN masters m ON m.id=c.master_id
    WHERE c.status_id = ${statusToList}
  )
  UNION ALL
  (
    SELECT
      'product' AS kind,
      p.id,
      p.barcode,
      m.id AS master_id,
      COALESCE(m.display_label, CONCAT('#', m.id)) AS display_label,
      m.default_unit AS unit,
      1 AS quantity,
      NULL::numeric AS width,
      NULL::numeric AS height,
      p.warehouse_id,
      p.location_id,
      p.updated_at
    FROM products p
    JOIN masters m ON m.id = p.master_id
    WHERE p.status_id = ${statusToList}
  )`;

  let where = "WHERE 1=1";
  if (search) {
    const term = `%${search}%`;
    where += ` AND (t.barcode ILIKE ${push(term)} OR t.display_label ILIKE ${push(term)})`;
  }

  const sql = `
    SELECT * FROM (${unionSql}) t
    ${where}
    ORDER BY t.updated_at DESC
    LIMIT ${push(limit)} OFFSET ${push(offset)}
  `;

  const { rows } = await pool.query(sql, params);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    barcode: r.barcode,
    unit: r.unit,
    quantity: r.quantity,
    width: r.width,
    height: r.height,
    master: { id: r.master_id, display_label: r.display_label },
    warehouse_id: r.warehouse_id,
    location_id: r.location_id,
  }));
};

/* ---------------- APPROVE ----------------
   Kurallar:
   - toStatus === in_stock ise barkod ZORUNLU ve formata uymalı
   - barkod değişiyorsa/ilk kez atanıyorsa:
       * aynı tabloda çakışma kontrolü
       * barcode_pool -> assertAndConsume (kullanıldı olarak işaretle)
------------------------------------------*/
exports.approveItems = async (scope = "stock", items = []) => {
  if (!["stock", "production", "screenprint"].includes(scope)) {
    const e = new Error("UNSUPPORTED_SCOPE"); e.status = 400; throw e;
  }
  if (!Array.isArray(items) || !items.length) {
    const e = new Error("EMPTY_ITEMS"); e.status = 400; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const transitions = [];
    const batchId = makeBatchId();

    for (const it of items) {
      const id = Number(it.id);
      const wh = Number(it.warehouse_id || 0);
      const lc = Number(it.location_id  || 0);
      if (!id || !wh || !lc) { const e = new Error("MISSING_FIELDS"); e.status = 400; throw e; }

      const table =
        it.kind === "component" ? "components" :
        it.kind === "product"   ? "products"   : null;
      if (!table) { const e = new Error("INVALID_KIND"); e.status = 400; throw e; }

      // Kayıt kilitle + önceki değerler
      const lockRes = await client.query(
        `SELECT id, barcode, status_id, warehouse_id, location_id, ${table === "components" ? "unit" : "NULL::text AS unit"} 
         FROM ${table} WHERE id=$1 FOR UPDATE`,
        [id]
      );
      if (!lockRes.rows.length) {
        const e = new Error(table === "components" ? "COMPONENT_NOT_FOUND" : "PRODUCT_NOT_FOUND");
        e.status = 404; throw e;
      }
      const prev = lockRes.rows[0];
      const prevStatus = Number(prev.status_id);
      const prevWh = Number(prev.warehouse_id || 0);
      const prevLc = Number(prev.location_id || 0);
      const unit = prev.unit || it.unit || "EA";

      // Hedef statü
      let toStatus;
      if (scope === "stock") {
        toStatus = STATUS.in_stock;
      } else {
        const wr = await client.query(`SELECT department FROM warehouses WHERE id=$1`, [wh]);
        if (!wr.rows.length) { const e = new Error("WAREHOUSE_NOT_FOUND"); e.status = 404; throw e; }
        const dept = wr.rows[0].department; // general | production | screenprint
        const ownDept = DEPT_BY_SCOPE[scope]; // "production" | "screenprint"
        toStatus = (dept === ownDept) ? STATUS.in_stock : STATUS.pending;
      }

      // Barkod doğrulama / zorunluluk
      const incoming = String(it.barcode || "").trim().toUpperCase();
      const current  = String(prev.barcode || "").trim().toUpperCase();
      const nextBarcode = incoming || current;

      if (toStatus === STATUS.in_stock) {
        if (!nextBarcode) {
          const e = new Error("BARCODE_REQUIRED"); e.status = 400; throw e;
        }
        // format/kind
        assertFormatAndKind(nextBarcode, it.kind);
      } else {
        // pending'e düşecekse ama barkod geldiyse format yine kontrol edilebilir (opsiyonel)
        if (nextBarcode) assertFormatAndKind(nextBarcode, it.kind);
      }

      // Barkod değişiyor mu? (ilk atama veya farklı değere geçiş)
      const changingBarcode = !!nextBarcode && nextBarcode !== current;

      if (changingBarcode) {
        // tablo çakışması
        const hit = await client.query(
          `SELECT 1 FROM ${table} WHERE barcode=$1 AND id<>$2 LIMIT 1`,
          [nextBarcode, id]
        );
        if (hit.rows.length) {
          const err = new Error("BARCODE_CONFLICT"); err.status = 409; throw err;
        }

        // havuzdan tüket
        await assertAndConsume(client, {
          code: nextBarcode,
          kind: it.kind,
          refTable: table,
          refId: id,
        });
      }

      // Depo/Lokasyon değişti mi?
      const willMove = (prevWh !== wh) || (prevLc !== lc);

      // UPDATE (barkod değişiyorsa set et)
      await client.query(
        `UPDATE ${table}
           SET status_id=$1,
               warehouse_id=$2,
               location_id=$3,
               ${changingBarcode ? "barcode=$5," : ""} 
               updated_at=NOW()
         WHERE id=$4`,
        changingBarcode ? [toStatus, wh, lc, id, nextBarcode] : [toStatus, wh, lc, id]
      );

      // TRANSITIONS
      if (willMove) {
        transitions.push({
          item_type: it.kind === "component" ? ITEM_TYPE.COMPONENT : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.MOVE,            // ✅ MOVE
          qty_delta: 0,
          unit,
          from_warehouse_id: prevWh || null,
          from_location_id:  prevLc || null,
          to_warehouse_id:   wh,
          to_location_id:    lc,
        });
      }

      // Statü değişimi
      if (prevStatus !== toStatus) {
        transitions.push({
          item_type: it.kind === "component" ? ITEM_TYPE.COMPONENT : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.APPROVE,
          qty_delta: 0,
          unit,
          from_status_id: prevStatus,
          to_status_id: toStatus,
        });
      }

      // Barkod attribute change log'u isterseniz (opsiyonel)
      if (changingBarcode) {
        transitions.push({
          item_type: it.kind === "component" ? ITEM_TYPE.COMPONENT : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.ATTRIBUTE_CHANGE,
          qty_delta: 0,
          unit,
          meta: { field: "barcode", before: current || null, after: nextBarcode },
        });
      }
    }

    if (transitions.length) {
      await recordTransitions(client, batchId, transitions);
    }

    await client.query("COMMIT");
    return { ok: true, approved: items.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
