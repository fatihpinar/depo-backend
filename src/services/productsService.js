// src/services/productsService.js
const pool = require("../config/db");
const { recordTransitions, makeBatchId } = require("./inventoryTransitionsService");
const { ITEM_TYPE, ACTION } = require("../constants/transitions");
// 🔗 Barkod merkezi servis
const { assertFormatAndKind, assertAndConsume } = require("./barcodeService");

/* -------------------------------------------------------
 * Status sözlüğü
 * -----------------------------------------------------*/
const STATUS_IDS = {
  in_stock: 1,
  used: 2,
  pending: 4,
  production: 6,
  screenprint: 7,
  damaged_lost: 5,
};

/** =====================================================
 * LIST
 * ===================================================*/
exports.list = async ({ warehouseId = 0, masterId = 0, search = "" } = {}) => {
  let sql = `
    SELECT
      p.id, p.barcode, p.created_at, p.created_by, p.approved_by,
      p.updated_at, p.approved_at, p.notes,
      w.id AS warehouse_id, w.name AS warehouse_name,
      l.id AS location_id,  l.name AS location_name,
      m.id AS master_id,    m.display_label AS master_display_label,
      st.id AS status_id, st.code AS status_code, st.label AS status_label
    FROM products p
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN locations  l ON l.id = p.location_id
    JOIN masters m         ON m.id = p.master_id
    JOIN statuses st       ON st.id = p.status_id
  `;

  const where = [];
  const params = [];

  if (warehouseId > 0) { params.push(warehouseId); where.push(`p.warehouse_id = $${params.length}`); }
  if (masterId    > 0) { params.push(masterId);    where.push(`p.master_id    = $${params.length}`); }

  if (search) {
    const term = `%${search}%`;
    params.push(term); const p1 = params.length;  // barcode
    params.push(term); const p2 = params.length;  // display_label
    where.push(`(p.barcode ILIKE $${p1} OR m.display_label ILIKE $${p2})`);
  }

  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY p.id DESC`;

  const { rows } = await pool.query(sql, params);
  return rows.map(r => ({
    id: r.id,
    barcode: r.barcode,
    created_at: r.created_at,
    updated_at: r.updated_at,
    approved_at: r.approved_at,
    created_by: r.created_by,
    approved_by: r.approved_by,
    notes: r.notes,
    status: r.status_label || r.status_code,
    warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.warehouse_name } : undefined,
    location:  r.location_id  ? { id: r.location_id,  name: r.location_name }  : undefined,
    master:    r.master_id    ? { id: r.master_id,    display_label: r.master_display_label } : undefined,
  }));
};

/** =====================================================
 * GET BY ID
 * ===================================================*/
exports.getById = async (id) => {
  // 1) ürün temel bilgileri
  const sql = `
    SELECT
      p.*,
      w.id AS warehouse_id, w.name AS warehouse_name,
      l.id AS location_id, l.name AS location_name,
      m.id AS master_id, m.display_label AS master_display_label,
      st.id AS status_id, st.code AS status_code, st.label AS status_label
    FROM products p
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN locations  l ON l.id = p.location_id
    JOIN masters m         ON m.id = p.master_id
    JOIN statuses st       ON st.id = p.status_id
    WHERE p.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [id]);
  const r = rows[0];
  if (!r) return null;

  // 2) bağlı componentler
  const compSql = `
    SELECT
      pc.id        AS link_id,              -- product_components satırı
      c.id         AS component_id,
      c.barcode,
      c.unit,
      pc.consume_qty,
      mm.id        AS comp_master_id,
      mm.display_label AS comp_master_display_label
    FROM product_components pc
    JOIN components c ON c.id = pc.component_id
    JOIN masters   mm ON mm.id = c.master_id
    WHERE pc.product_id = $1
    ORDER BY pc.id ASC
  `;
  const { rows: compRows } = await pool.query(compSql, [id]);
  const components = compRows.map(x => ({
    id: x.component_id,
    barcode: x.barcode,
    unit: x.unit,
    consume_qty: Number(x.consume_qty),
    master: { id: x.comp_master_id, display_label: x.comp_master_display_label },
    link_id: x.link_id,
  }));

  return {
    id: r.id,
    barcode: r.barcode,
    created_at: r.created_at,
    updated_at: r.updated_at,
    approved_at: r.approved_at,
    created_by: r.created_by,
    approved_by: r.approved_by,
    notes: r.notes,
    status_id: r.status_id,
    status: r.status_label || r.status_code,
    warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.warehouse_name } : undefined,
    location:  r.location_id  ? { id: r.location_id,  name: r.location_name }  : undefined,
    master:    r.master_id    ? { id: r.master_id,    display_label: r.master_display_label } : undefined,
    components,
  };
};

/** =====================================================
 * UPDATE  (Depoya alma sırasında barkod zorunlu)
 * ===================================================*/
exports.update = async (id, payload = {}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // before (kilitle)
    const { rows: beforeRows } = await client.query(
      `SELECT id, barcode, master_id, status_id, warehouse_id, location_id, notes
         FROM products WHERE id=$1 FOR UPDATE`,
      [id]
    );
    const before = beforeRows[0];
    if (!before) { const e = new Error("NOT_FOUND"); e.status = 404; throw e; }

    // Yardımcı: barkodu doğrula + çakışma + havuzdan tüket
    async function ensureProductBarcode(next) {
      const code = String(next || "").trim().toUpperCase();
      assertFormatAndKind(code, "product");
      const { rows: hit } = await client.query(
        `SELECT 1 FROM products WHERE barcode=$1 AND id<>$2 LIMIT 1`,
        [code, id]
      );
      if (hit.length) {
        const err = new Error("BARCODE_CONFLICT");
        err.status = 409;
        err.code = "BARCODE_CONFLICT";
        throw err;
      }
      await assertAndConsume(client, {
        code,
        kind: "product",
        refTable: "products",
        refId: id,
      });
      return code; // normalize edilmiş
    }

    // 1) Alan bazlı barkod değişikliği (eski davranış)
    if (
      payload.barcode !== undefined &&
      String(payload.barcode || "").trim().toUpperCase() !== String(before.barcode || "").trim().toUpperCase()
    ) {
      payload.barcode = await ensureProductBarcode(payload.barcode);
    }

    // 2) Depoya alma: status_id → IN_STOCK (1) ise barkod ZORUNLU
    if (payload.status_id !== undefined && Number(payload.status_id) === STATUS_IDS.in_stock) {
      const candidate = String(
        (payload.barcode !== undefined ? payload.barcode : before.barcode) || ""
      ).trim().toUpperCase();

      if (!candidate) {
        const e = new Error("BARCODE_REQUIRED");
        e.status = 400;
        e.code = "BARCODE_REQUIRED";
        throw e;
      }

      // önceki kayıtta yoksa ya da farklıysa doğrula+tüket
      if (candidate !== String(before.barcode || "").trim().toUpperCase()) {
        payload.barcode = await ensureProductBarcode(candidate);
      }
    }

    // UPDATE
    const allowed = ["barcode", "master_id", "status_id", "warehouse_id", "location_id", "notes"];
    const fields = [], params = [];
    let i = 1;
    for (const key of allowed) {
      if (payload[key] !== undefined) { fields.push(`${key} = $${i++}`); params.push(payload[key]); }
    }
    if (!fields.length) {
      await client.query("ROLLBACK");
      return await this.getById(id);
    }

    params.push(id);
    const { rows: afterRows } = await client.query(
      `UPDATE products SET ${fields.join(", ")}, updated_at=NOW() WHERE id=$${i}
       RETURNING id, barcode, master_id, status_id, warehouse_id, location_id, notes`,
      params
    );
    const after = afterRows[0];

    // transitions
    const recs = [];
    const batchId = makeBatchId();

    // STATUS_CHANGE
    if (payload.status_id !== undefined && Number(before.status_id) !== Number(after.status_id)) {
      recs.push({
        item_type: ITEM_TYPE.PRODUCT,
        item_id: id,
        action: ACTION.STATUS_CHANGE,
        qty_delta: 0,
        unit: "EA",
        from_status_id: before.status_id,
        to_status_id: after.status_id,
      });
    }

    // MOVE
    const whChanged  = payload.warehouse_id !== undefined && Number(before.warehouse_id || 0) !== Number(after.warehouse_id || 0);
    const locChanged = payload.location_id  !== undefined && Number(before.location_id  || 0) !== Number(after.location_id  || 0);
    if (whChanged || locChanged) {
      recs.push({
        item_type: ITEM_TYPE.PRODUCT,
        item_id: id,
        action: ACTION.MOVE,
        qty_delta: 0,
        unit: "EA",
        from_warehouse_id: before.warehouse_id || null,
        from_location_id:  before.location_id  || null,
        to_warehouse_id:   after.warehouse_id  || null,
        to_location_id:    after.location_id   || null,
      });
    }

    // ATTRIBUTE_CHANGE (barcode)
    if (payload.barcode !== undefined && String(before.barcode || "") !== String(after.barcode || "")) {
      recs.push({
        item_type: ITEM_TYPE.PRODUCT,
        item_id: id,
        action: ACTION.ATTRIBUTE_CHANGE,
        qty_delta: 0,
        unit: "EA",
        meta: { field: "barcode", before: before.barcode || null, after: after.barcode || null }
      });
    }

    if (recs.length) {
      await recordTransitions(client, batchId, recs);
    }

    await client.query("COMMIT");
    return await this.getById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/** =====================================================
 * ASSEMBLE (ÜRÜN OLUŞTUR) — Barkodsuz kurulum
 * ===================================================*/
// eski productAssembliesService.create
const ASSEMBLE_STATUS = { stock: STATUS_IDS.pending, production: STATUS_IDS.production, screenprint: STATUS_IDS.screenprint, used: STATUS_IDS.used };

exports.assemble = async (payload) => {
  if (!payload || !payload.product || !Array.isArray(payload.components) || !payload.components.length) {
    const e = new Error("INVALID_PAYLOAD"); e.status = 400; e.code = "INVALID_PAYLOAD"; throw e;
  }
  const { product, components } = payload;

  // ❗ Barkod artık zorunlu değil
  if (!product.master_id || !product.target) {
    const e = new Error("MISSING_PRODUCT_FIELDS"); e.status = 400; e.code = "MISSING_PRODUCT_FIELDS"; throw e;
  }

  const target = String(product.target);
  if (!["stock", "production", "screenprint"].includes(target)) {
    const e = new Error("INVALID_TARGET"); e.status = 400; e.code = "INVALID_TARGET"; throw e;
  }
  if (target === "stock" && (!product.warehouse_id || !product.location_id)) {
    const e = new Error("WAREHOUSE_LOCATION_REQUIRED"); e.status = 400; e.code = "WAREHOUSE_LOCATION_REQUIRED"; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ✅ Ürün barkodsuz eklenir (barcode=NULL). Barkod pool tüketimi yok.
    const status_id = ASSEMBLE_STATUS[target];
    const { rows: prodRows } = await client.query(
      `INSERT INTO products
         (master_id, barcode, status_id, warehouse_id, location_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id`,
      [
        product.master_id,
        null, // barkodsuz
        status_id,
        target === "stock" ? product.warehouse_id || null : null,
        target === "stock" ? product.location_id  || null : null,
      ]
    );
    const productId = prodRows?.[0]?.id;
    if (!productId) throw new Error("NO_PRODUCT_ID");

    // CONSUME transitionlarını toplayacağız
    const consumeTransitions = [];

    // Component tüketimleri
    for (const item of components) {
      const compId = Number(item.component_id);
      if (!compId) throw new Error("INVALID_COMPONENT_ID");
      const requested = Number(item.consume_qty || 0);

      const { rows: compRows } = await client.query(
        `SELECT id, unit, quantity, status_id, warehouse_id, location_id
           FROM components WHERE id=$1 FOR UPDATE`,
        [compId]
      );
      if (!compRows.length) throw new Error("COMPONENT_NOT_FOUND");

      const comp = compRows[0];

      if (comp.unit === "EA") {
        await client.query(
          `UPDATE components SET status_id=$1, updated_at=NOW() WHERE id=$2`,
          [STATUS_IDS.used, comp.id]
        );
        await client.query(
          `INSERT INTO product_components (product_id, component_id, consume_qty, created_at)
           VALUES ($1,$2,$3, NOW())`,
          [productId, comp.id, 1]
        );

        consumeTransitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: comp.id,
          action: ACTION.CONSUME,
          qty_delta: -1,
          unit: comp.unit,
          from_warehouse_id: comp.warehouse_id || null,
          from_location_id:  comp.location_id  || null,
          to_status_id: STATUS_IDS.used,
          context_type: "product",
          context_id: productId,
        });
      } else {
        if (requested <= 0) throw new Error("INVALID_CONSUME_QTY");
        if (requested > Number(comp.quantity)) throw new Error("CONSUME_GT_STOCK");

        const left = Number(comp.quantity) - requested;

        if (left === 0) {
          await client.query(
            `UPDATE components
               SET quantity=$1, status_id=$2, updated_at=NOW()
             WHERE id=$3`,
            [0, STATUS_IDS.used, comp.id]
          );
        } else {
          await client.query(
            `UPDATE components
               SET quantity=$1, updated_at=NOW()
             WHERE id=$2`,
            [left, comp.id]
          );
        }

        await client.query(
          `INSERT INTO product_components (product_id, component_id, consume_qty, created_at)
           VALUES ($1,$2,$3, NOW())`,
          [productId, comp.id, requested]
        );

        consumeTransitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: comp.id,
          action: ACTION.CONSUME,
          qty_delta: -requested,
          unit: comp.unit,
          from_warehouse_id: comp.warehouse_id || null,
          from_location_id:  comp.location_id  || null,
          to_status_id: left === 0 ? STATUS_IDS.used : STATUS_IDS.in_stock,
          context_type: "product",
          context_id: productId,
        });
      }
    }

    // tek batch ile product + consume kayıtları
    const batchId = makeBatchId();
    const productTransition = {
      item_type: ITEM_TYPE.PRODUCT,
      item_id: productId,
      action: ACTION.ASSEMBLE_PRODUCT,
      qty_delta: +1,
      unit: "EA",
      to_status_id: status_id,
      to_warehouse_id: target === "stock" ? product.warehouse_id || null : null,
      to_location_id:  target === "stock" ? product.location_id  || null : null,
    };

    await recordTransitions(client, batchId, [productTransition, ...consumeTransitions]);

    await client.query("COMMIT");
    return { product: { id: productId } };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/** =====================================================
 * REMOVE COMPONENTS (iade / hurda)
 * ===================================================*/
async function ensureLostSeq(client) {
  await client.query(`CREATE SEQUENCE IF NOT EXISTS lost_component_seq START 1;`);
}
async function generateLostBarcode(client) {
  await ensureLostSeq(client);
  const { rows } = await client.query(`SELECT nextval('lost_component_seq') AS seq;`);
  const n = String(rows[0].seq).padStart(9, "0");
  return `L${n}`;
}

/**
 * product’tan componentleri söküp:
 * - iade (stoğa dönüş) VE/VEYA
 * - hurda (FIRE) olarak ayırma
 *
 * Body (mixed):
 * [
 *   { link_id, component_id, new_barcode?, return_qty?, warehouse_id, location_id },
 *   { link_id, component_id, is_scrap: true, fire_qty?, reason? }
 * ]
 */
exports.removeComponents = async (productId, items) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ürün var mı
    const { rows: pRows } = await client.query(`SELECT id FROM products WHERE id=$1 FOR UPDATE`, [productId]);
    if (!pRows.length) { const e = new Error("PRODUCT_NOT_FOUND"); e.status = 404; throw e; }

    const summary = { ok: true, processed: 0, createdScraps: [], returns: [] };
    const transitions = [];
    const batchId = makeBatchId();

    for (const raw of items) {
      const linkId = Number(raw.link_id || 0);
      const compId = Number(raw.component_id || 0);
      if (!linkId || !compId) {
        const e = new Error("MISSING_FIELDS"); e.status = 400; e.code = "MISSING_FIELDS";
        e.details = { link_id: !!linkId, component_id: !!compId }; throw e;
      }

      // link + component + audit alanları — kilitle
      const { rows } = await client.query(
        `
        SELECT 
          pc.id           AS link_id,
          pc.product_id,
          pc.consume_qty  AS consume_qty,      -- kalan bağlı miktar
          pc.returned_qty AS returned_qty,     -- toplam iade (audit)
          pc.scrapped_qty AS scrapped_qty,     -- toplam hurda (audit)

          c.id            AS component_id,
          c.unit,
          c.quantity,
          c.master_id,
          c.status_id,
          c.warehouse_id,
          c.location_id
        FROM product_components pc
        JOIN components c ON c.id = pc.component_id
        WHERE pc.id = $1 AND pc.product_id = $2 AND pc.component_id = $3
        FOR UPDATE
        `,
        [linkId, productId, compId]
      );
      if (!rows.length) { const e = new Error("LINK_NOT_FOUND"); e.status = 404; e.code = "LINK_NOT_FOUND"; throw e; }
      const row = rows[0];

      const isEA = row.unit === "EA";

      // --- BRANCH: HURDA (FIRE) ---
      if (raw.is_scrap === true) {
        const fireQty = isEA ? 1 : Number(raw.fire_qty || 0);
        if (!isEA && fireQty <= 0) {
          const e = new Error("INVALID_FIRE_QTY"); e.status = 400; e.code = "INVALID_FIRE_QTY"; throw e;
        }

        // bağlanmış miktarı aşma
        const remainingBindable = Number(row.consume_qty);
        if (fireQty > remainingBindable) {
          const e = new Error("FIRE_GT_CONSUMED"); e.status = 400; e.code = "FIRE_GT_CONSUMED";
          e.details = { fireQty, remainingBindable }; throw e;
        }

        // Hurda için yeni component oluştur (status=damaged_lost, depo/lokasyon NULL)
        const lostBarcode = await generateLostBarcode(client);
        const insertScrap = await client.query(
          `
          INSERT INTO components
            (master_id, barcode, unit, quantity, status_id,
             warehouse_id, location_id,
             is_scrap, origin_component_id, disposal_reason,
             created_at, updated_at, notes)
          VALUES
            ($1, $2, $3, $4, $5,
             NULL, NULL,
             TRUE, $6, $7,
             NOW(), NOW(), $8)
          RETURNING id, barcode
          `,
          [
            row.master_id,
            lostBarcode,
            row.unit,
            isEA ? 1 : fireQty,
            STATUS_IDS.damaged_lost,
            row.component_id,                         // origin_component_id
            (raw.reason || "").trim() || null,        // disposal_reason
            (raw.reason || "").trim() || null         // notes (opsiyonel)
          ]
        );

        const scrapComp = insertScrap.rows[0];
        summary.createdScraps.push({ id: scrapComp.id, barcode: scrapComp.barcode });

        // product_components: consume_qty azalt + scrapped_qty artır veya sil
        if (fireQty === remainingBindable) {
          await client.query(`DELETE FROM product_components WHERE id=$1`, [linkId]);
        } else {
          await client.query(
            `UPDATE product_components
               SET consume_qty = consume_qty - $1,
                   scrapped_qty = COALESCE(scrapped_qty,0) + $1
             WHERE id=$2`,
            [fireQty, linkId]
          );
        }

        // TRANSITION: CREATE (hurda satırı)
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: scrapComp.id,
          action: ACTION.CREATE,
          qty_delta: isEA ? +1 : +fireQty,
          unit: row.unit,
          to_status_id: STATUS_IDS.damaged_lost,
          context_type: "product",
          context_id: productId,
          meta: {
            link_id: linkId,
            source_component_id: row.component_id,
            reason: (raw.reason || "").trim() || undefined
          }
        });

        summary.processed += 1;
        continue; // sıradaki item
      }

      // --- BRANCH: IADE ---
      const newBarcodeRaw = (raw.new_barcode || "").trim();
      const newBarcode = newBarcodeRaw ? newBarcodeRaw.toUpperCase() : "";
      const whId = Number(raw.warehouse_id || 0);
      const locId = Number(raw.location_id || 0);
      if (!whId || !locId) {
        const e = new Error("WAREHOUSE_LOCATION_REQUIRED"); e.status = 400; e.code = "WAREHOUSE_LOCATION_REQUIRED"; throw e;
      }

      const remainingBindable = Number(row.consume_qty); // şu an ürüne bağlı miktar
      const wantReturn = isEA ? 1 : Number(raw.return_qty || remainingBindable);
      if (!isEA && (wantReturn <= 0 || wantReturn > remainingBindable)) {
        const e = new Error("INVALID_RETURN_QTY"); e.status = 400; e.code = "INVALID_RETURN_QTY";
        e.details = { wantReturn, remainingBindable }; throw e;
      }

      if (newBarcode) {
        // ✅ komponent barkodu format/kind
        assertFormatAndKind(newBarcode, "component");

        // barkod çakışması (components tablosu)
        const { rows: exists } = await client.query(`SELECT 1 FROM components WHERE barcode=$1 LIMIT 1`, [newBarcode]);
        if (exists.length) { const e = new Error("BARCODE_CONFLICT"); e.status = 409; e.code = "BARCODE_CONFLICT"; throw e; }

        // yeni stok satırı aç
        const ins = await client.query(
          `
          INSERT INTO components
            (master_id, barcode, unit, quantity, status_id, warehouse_id, location_id, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7, NOW(), NOW())
          RETURNING id, barcode
          `,
          [row.master_id, newBarcode, row.unit, isEA ? 1 : wantReturn, STATUS_IDS.pending, whId, locId]
        );
        const newComp = ins.rows[0];

        // ✅ havuzdan tüket (yeni component barkodu)
        await assertAndConsume(client, {
          code: newComp.barcode,
          kind: "component",
          refTable: "components",
          refId: newComp.id,
        });

        // TRANSITION: RETURN (yeni barkod)
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: newComp.id,
          action: ACTION.RETURN,
          qty_delta: isEA ? +1 : +wantReturn,
          unit: row.unit,
          to_status_id: STATUS_IDS.in_stock,
          to_warehouse_id: whId,
          to_location_id: locId,
          context_type: "product",
          context_id: productId,
          meta: { source_component_id: row.component_id, link_id: linkId, new_barcode: newComp.barcode }
        });
      } else {
        // orijinal stok satırına iade
        if (isEA) {
          await client.query(
            `UPDATE components
               SET status_id=$1, warehouse_id=$2, location_id=$3, updated_at=NOW()
             WHERE id=$4`,
           [STATUS_IDS.pending, whId, locId, row.component_id]
          );
        } else {
          await client.query(
            `UPDATE components
               SET quantity = quantity + $1, status_id=$2, warehouse_id=$3, location_id=$4, updated_at=NOW()
             WHERE id=$5`,
            [wantReturn, STATUS_IDS.pending, whId, locId, row.component_id]
          );
        }

        // TRANSITION: RETURN (orijinale)
        transitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: row.component_id,
          action: ACTION.RETURN,
          qty_delta: isEA ? +1 : +wantReturn,
          unit: row.unit,
          to_status_id: STATUS_IDS.pending,
          to_warehouse_id: whId,
          to_location_id: locId,
          context_type: "product",
          context_id: productId
        });
      }

      // product_components: consume_qty azalt + returned_qty artır veya sil
      if (wantReturn === remainingBindable) {
        await client.query(`DELETE FROM product_components WHERE id=$1`, [linkId]);
      } else {
        await client.query(
          `UPDATE product_components
             SET consume_qty = consume_qty - $1,
                 returned_qty = COALESCE(returned_qty,0) + $1
           WHERE id=$2`,
          [wantReturn, linkId]
        );
      }

      summary.returns.push({ link_id: linkId, component_id: row.component_id, qty: wantReturn });
      summary.processed += 1;
    }

    // tek batch ile transitions
    if (transitions.length) {
      await recordTransitions(client, batchId, transitions);
    }

    await client.query("COMMIT");
    return summary;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/** =====================================================
 * ADD COMPONENTS
 * ===================================================*/
const ADD_STATUS = { in_stock: STATUS_IDS.in_stock, used: STATUS_IDS.used };

exports.addComponents = async (productId, items) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ürün var mı?
    const { rows: pRows } = await client.query(`SELECT id FROM products WHERE id=$1 FOR UPDATE`, [productId]);
    if (!pRows.length) { const e = new Error("PRODUCT_NOT_FOUND"); e.status = 404; throw e; }

    const links = [];
    const consumeTransitions = [];

    for (const raw of items) {
      const compId = Number(raw.component_id || 0);
      const reqQty = Number(raw.consume_qty || 0);
      if (!compId) { const e = new Error("INVALID_COMPONENT_ID"); e.status = 400; throw e; }

      // component’i kilitle
      const { rows: cRows } = await client.query(
        `SELECT id, unit, quantity, status_id, warehouse_id, location_id
           FROM components WHERE id=$1 FOR UPDATE`,
        [compId]
      );
      if (!cRows.length) { const e = new Error("COMPONENT_NOT_FOUND"); e.status = 404; throw e; }

      const c = cRows[0];
      const isEA = c.unit === "EA";

      if (isEA) {
        if (c.status_id === ADD_STATUS.used) { const e = new Error("COMPONENT_ALREADY_USED"); e.status = 409; throw e; }
        await client.query(`UPDATE components SET status_id=$1, updated_at=NOW() WHERE id=$2`, [ADD_STATUS.used, c.id]);
        const { rows: link } = await client.query(
          `INSERT INTO product_components (product_id, component_id, consume_qty, created_at)
           VALUES ($1,$2,$3, NOW()) RETURNING id`,
          [productId, c.id, 1]
        );
        links.push({ id: link[0].id, component_id: c.id, consume_qty: 1 });

        consumeTransitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.CONSUME,
          qty_delta: -1,
          unit: c.unit,
          from_warehouse_id: c.warehouse_id || null,
          from_location_id:  c.location_id  || null,
          to_status_id: ADD_STATUS.used,
          context_type: "product",
          context_id: productId,
        });
      } else {
        if (reqQty <= 0) { const e = new Error("INVALID_CONSUME_QTY"); e.status = 400; throw e; }
        const have = Number(c.quantity || 0);
        if (reqQty > have) { const e = new Error("CONSUME_GT_STOCK"); e.status = 409; throw e; }

        const left = have - reqQty;
        if (left === 0) {
          await client.query(`UPDATE components SET quantity=0, status_id=$1, updated_at=NOW() WHERE id=$2`,
            [ADD_STATUS.used, c.id]);
        } else {
          await client.query(`UPDATE components SET quantity=$1, updated_at=NOW() WHERE id=$2`, [left, c.id]);
        }

        const { rows: link } = await client.query(
          `INSERT INTO product_components (product_id, component_id, consume_qty, created_at)
           VALUES ($1,$2,$3, NOW()) RETURNING id`,
          [productId, c.id, reqQty]
        );
        links.push({ id: link[0].id, component_id: c.id, consume_qty: reqQty });

        consumeTransitions.push({
          item_type: ITEM_TYPE.COMPONENT,
          item_id: c.id,
          action: ACTION.CONSUME,
          qty_delta: -reqQty,
          unit: c.unit,
          from_warehouse_id: c.warehouse_id || null,
          from_location_id:  c.location_id  || null,
          to_status_id: left === 0 ? ADD_STATUS.used : ADD_STATUS.in_stock,
          context_type: "product",
          context_id: productId,
        });
      }
    }

    if (consumeTransitions.length) {
      const batchId = makeBatchId();
      await recordTransitions(client, batchId, consumeTransitions);
    }

    await client.query("COMMIT");
    return { added: links.length, links };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
