// src/modules/products/products.service.js
const pool = require("../../core/db/index");
const repo = require("./products.repository");
const map  = require("./products.mappers");

// transitions: dosyadan
const { recordTransitions, makeBatchId } = require("../transitions/transitions.service");
const { ITEM_TYPE, ACTION } = require("../transitions/transitions.constants");

// barkod: dosyadan (normalize + ensureChangeAndConsume bu dosyada kullanılıyor)
const {
  normalize,
  assertFormatAndKind,
  assertAndConsume,
  ensureChangeAndConsume,
} = require("../../core/barcode/barcode.service");

const STATUS_IDS = {
  in_stock: 1,
  used: 2,
  sold: 3,
  pending: 4,
  damaged_lost: 5,
  production: 6,
  screenprint: 7,
};

/* ======================== READ ======================== */

exports.list = async (filters = {}) => {
  const rows = await repo.findMany(filters);
  return rows.map(map.mapListRow);
};

exports.getById = async (id) => {
  const base = await repo.findById(id);
  if (!base) return null;
  const comps = await repo.findComponentsOfProduct(id);
  return map.mapDetails(base, comps);
};

/* ======================== UPDATE ======================== */

/* ======================== UPDATE ======================== */

exports.update = async (id, payload = {}, actorId = null) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await repo.lockProductById(client, id);
    if (!before) { const e = new Error("NOT_FOUND"); e.status = 404; throw e; }

    // 1) in_stock’a geçişte barkod zorunlu
    if (payload.status_id !== undefined && Number(payload.status_id) === STATUS_IDS.in_stock) {
      const planned = payload.barcode !== undefined ? normalize(payload.barcode) : normalize(before.barcode);
      if (!planned) { const e = new Error("BARCODE_REQUIRED"); e.status = 400; e.code = "BARCODE_REQUIRED"; throw e; }
    }

    // 2) Barkod değişimi/çakışma/pool tüketme
    const { nextBarcode, changed } = await ensureChangeAndConsume(client, {
      table: "products",
      id,
      kind: "product",
      incoming: payload.barcode,
      current:  before.barcode,
      conflictChecker: async (c, _t, code, productId) =>
        repo.isProductBarcodeTaken(c, code, productId),
    });

    // 3) Alan güncelle
    const allowed = ["barcode","bimeks_code","product_name","status_id","warehouse_id","location_id","notes"];
    const fields = {};
    for (const k of allowed) if (payload[k] !== undefined) fields[k] = payload[k];
    if (payload.barcode !== undefined) fields.barcode = nextBarcode;

    // in_stock’a ilk kez geçiyorsa onaylayan yaz
    if (
      payload.status_id !== undefined &&
      Number(before.status_id) !== Number(payload.status_id) &&
      Number(payload.status_id) === STATUS_IDS.in_stock &&
      actorId
    ) {
      fields.approved_by = actorId; // approved_at repo’da NOW()
    }

    const after = await repo.updateProductFields(client, id, fields);

    // 4) Transitions
    const recs = [];
    const batchId = makeBatchId();

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

    if (changed) {
      recs.push({
        item_type: ITEM_TYPE.PRODUCT,
        item_id: id,
        action: ACTION.ATTRIBUTE_CHANGE,
        qty_delta: 0,
        unit: "EA",
        meta: { field: "barcode", before: before.barcode || null, after: nextBarcode || null }
      });
    }
    if (payload.bimeks_code !== undefined && String(before.bimeks_code || "") !== String(after.bimeks_code || "")) {
      recs.push({
        item_type: ITEM_TYPE.PRODUCT,
        item_id: id,
        action: ACTION.ATTRIBUTE_CHANGE,
        qty_delta: 0,
        unit: "EA",
        meta: { field: "bimeks_code", before: before.bimeks_code || null, after: after.bimeks_code || null }
      });
    }

    if (recs.length) await recordTransitions(client, batchId, recs, actorId);

    await client.query("COMMIT");
    return await this.getById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};


/* ======================== ASSEMBLE ======================== */

const ASSEMBLE_STATUS = {
  stock: STATUS_IDS.pending,
  production: STATUS_IDS.production,
  screenprint: STATUS_IDS.screenprint,
  used: STATUS_IDS.used,
};

exports.assemble = async (payload, actorId = null) => {
  if (!payload || !payload.product || !Array.isArray(payload.components) || !payload.components.length) {
    const e = new Error("INVALID_PAYLOAD"); e.status = 400; e.code = "INVALID_PAYLOAD"; throw e;
  }
    const { product, components } = payload;

  const target      = String(product.target || "").trim();
  const productName = String(product.product_name || "").trim();
  const recipeId    = product.recipe_id ? String(product.recipe_id) : null;

  // Artık sadece ürün adı ve hedef zorunlu
  if (!productName || !target) {
    const e = new Error("MISSING_PRODUCT_FIELDS");
    e.status = 400;
    e.code   = "MISSING_PRODUCT_FIELDS";
    throw e;
  }


    if (!["stock","production","screenprint"].includes(target)) {
    const e = new Error("INVALID_TARGET"); e.status = 400; e.code = "INVALID_TARGET"; throw e;
  }
  if (target === "stock" && (!product.warehouse_id || !product.location_id)) {
    const e = new Error("WAREHOUSE_LOCATION_REQUIRED"); e.status = 400; e.code = "WAREHOUSE_LOCATION_REQUIRED"; throw e;
  }


    const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const status_id = ASSEMBLE_STATUS[target];
    const productId = await repo.insertProduct(client, {
      barcode: null,
      bimeks_code: (product.bimeks_code || "").trim() || null,
      status_id,
      warehouse_id: target === "stock" ? product.warehouse_id || null : null,
      location_id:  target === "stock" ? product.location_id  || null : null,
      product_name: productName,
      recipe_id:    recipeId,
      created_by:   actorId || null,
    });

    const consumeTransitions = [];

    // src/modules/products/products.service.js → assemble() içinde for döngüsü

    // products.service.js → assemble() içinde

    for (const item of components) {
    const compId = Number(item.component_id || 0);
    if (!compId) {
      const e = new Error("INVALID_COMPONENT_ID");
      e.status = 400;
      e.code   = "INVALID_COMPONENT_ID";
      throw e;
    }

    // FE HER ZAMAN ALAN GÖNDERİYOR (um²/m²)
    const requested = Number(item.consume_qty || 0);
    if (!Number.isFinite(requested) || requested <= 0) {
      const e = new Error("INVALID_CONSUME_QTY");
      e.status = 400;
      e.code   = "INVALID_CONSUME_QTY";
      throw e;
    }

    const comp = await repo.lockComponentById(client, compId);
    if (!comp) {
      const e = new Error("COMPONENT_NOT_FOUND");
      e.status = 404;
      e.code   = "COMPONENT_NOT_FOUND";
      throw e;
    }

    // 🔴 KRİTİK: STOK HER ZAMAN ALAN → area
    const currentArea = Number(comp.area || 0);
    if (!Number.isFinite(currentArea) || currentArea <= 0) {
      const e = new Error("NO_STOCK");
      e.status = 409;
      e.code   = "NO_STOCK";
      throw e;
    }

    if (requested > currentArea) {
      const e = new Error("CONSUME_GT_STOCK");
      e.status = 409;
      e.code   = "CONSUME_GT_STOCK";
      throw e;
    }

    const leftArea = currentArea - requested;

    // 🟢 ORİJİNAL COMPONENT’İN STOK ALANI DÜŞÜYOR
    const updateFields = {
      area: leftArea,
      quantity: leftArea,             // istersen bırak, istersen hiç set etme
    };
    if (leftArea === 0) {
      updateFields.status_id = STATUS_IDS.used;
    }

    await repo.updateComponentFields(client, comp.id, updateFields);

    // 🟢 PRODUCT_COMPONENTS: CONSUME_QTY = KULLANILAN ALAN
    await repo.insertProductComponentLink(client, {
      product_id: productId,
      component_id: comp.id,
      consume_qty: requested,
    });

    // 🟢 TRANSITION: alan kadar tüketim
    consumeTransitions.push({
      item_type: ITEM_TYPE.COMPONENT,
      item_id: comp.id,
      action: ACTION.CONSUME,
      qty_delta: -requested,
      unit: comp.unit || "EA", // burada sadece label; um²/m² vs düşün
      from_warehouse_id: comp.warehouse_id || null,
      from_location_id: comp.location_id || null,
      to_status_id: leftArea === 0 ? STATUS_IDS.used : STATUS_IDS.in_stock,
      context_type: "product",
      context_id: productId,
    });
  }




    const batchId = makeBatchId();
    await recordTransitions(client, batchId, [{
      item_type: ITEM_TYPE.PRODUCT, item_id: productId, action: ACTION.ASSEMBLE_PRODUCT,
      qty_delta: 1, unit: "EA", to_status_id: status_id,
      to_warehouse_id: target === "stock" ? product.warehouse_id || null : null,
      to_location_id:  target === "stock" ? product.location_id  || null : null,
    }, ...consumeTransitions], actorId);

    await client.query("COMMIT");
    return { product: { id: productId } };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/* ============ REMOVE COMPONENTS (iade / hurda) ============ */

exports.removeComponents = async (productId, items, actorId = null) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const product = await repo.lockProductExists(client, productId);
    if (!product) { const e = new Error("PRODUCT_NOT_FOUND"); e.status = 404; throw e; }

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

      const row = await repo.lockLinkWithComponent(client, { linkId, productId, compId });
      if (!row) { const e = new Error("LINK_NOT_FOUND"); e.status = 404; e.code = "LINK_NOT_FOUND"; throw e; }
      const isEA = row.unit === "EA";

      // HURDA
      if (raw.is_scrap === true) {
        const fireQty = isEA ? 1 : Number(raw.fire_qty || 0);
        if (!isEA && fireQty <= 0) {
          const e = new Error("INVALID_FIRE_QTY"); e.status = 400; e.code = "INVALID_FIRE_QTY"; throw e;
        }

        const remainingBindable = Number(row.consume_qty);
        if (fireQty > remainingBindable) {
          const e = new Error("FIRE_GT_CONSUMED"); e.status = 400; e.code = "FIRE_GT_CONSUMED";
          e.details = { fireQty, remainingBindable }; throw e;
        }

        const lostBarcode = await repo.generateLostBarcode(client);
        const scrapComp = await repo.createComponent(client, {
          master_id: row.master_id,
          barcode: lostBarcode,
          unit: row.unit,
          quantity: isEA ? 1 : fireQty,
          status_id: STATUS_IDS.damaged_lost,
          warehouse_id: null, location_id: null,
          is_scrap: true,
          origin_component_id: row.component_id,
          disposal_reason: (raw.reason || "").trim() || null,
          notes: (raw.reason || "").trim() || null,
          created_by: actorId || null, 
        });

        if (fireQty === remainingBindable) {
          await repo.deleteProductComponentLink(client, linkId);
        } else {
          await repo.addAuditAndDecreaseLink(client, {
            linkId,
            returned_delta: 0,
            scrapped_delta: fireQty,
          });
        }

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT, item_id: scrapComp.id, action: ACTION.CREATE,
          qty_delta: isEA ? 1 : fireQty, unit: row.unit,
          to_status_id: STATUS_IDS.damaged_lost, context_type: "product", context_id: productId,
          meta: { link_id: linkId, source_component_id: row.component_id, reason: (raw.reason || "").trim() || undefined }
        });

        summary.createdScraps.push({ id: scrapComp.id, barcode: scrapComp.barcode });
        summary.processed += 1;
        continue;
      }

      // IADE
      const newBarcode = String((raw.new_barcode || "").trim()).toUpperCase();
      const whId = Number(raw.warehouse_id || 0);
      const locId = Number(raw.location_id || 0);
      if (!whId || !locId) {
        const e = new Error("WAREHOUSE_LOCATION_REQUIRED"); e.status = 400; e.code = "WAREHOUSE_LOCATION_REQUIRED"; throw e;
      }

      const remainingBindable = Number(row.consume_qty);
      const wantReturn = isEA ? 1 : Number(raw.return_qty || remainingBindable);
      if (!isEA && (wantReturn <= 0 || wantReturn > remainingBindable)) {
        const e = new Error("INVALID_RETURN_QTY"); e.status = 400; e.code = "INVALID_RETURN_QTY";
        e.details = { wantReturn, remainingBindable }; throw e;
      }

      if (newBarcode) {
        assertFormatAndKind(newBarcode, "component");
        const conflict = await repo.isComponentBarcodeTaken(client, newBarcode);
        if (conflict) { const e = new Error("BARCODE_CONFLICT"); e.status = 409; e.code = "BARCODE_CONFLICT"; throw e; }

        const newComp = await repo.createComponent(client, {
          master_id: row.master_id,
          barcode: newBarcode,
          unit: row.unit,
          quantity: isEA ? 1 : wantReturn,
          status_id: STATUS_IDS.pending,
          warehouse_id: whId, location_id: locId,
          created_by: actorId || null,
        });

        await assertAndConsume(client, {
          code: newComp.barcode, kind: "component", refTable: "components", refId: newComp.id,
        });

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT, item_id: newComp.id, action: ACTION.RETURN,
          qty_delta: isEA ? 1 : wantReturn, unit: row.unit,
          to_status_id: STATUS_IDS.in_stock, to_warehouse_id: whId, to_location_id: locId,
          context_type: "product", context_id: productId,
          meta: { source_component_id: row.component_id, link_id: linkId, new_barcode: newComp.barcode }
        });
      } else {
        if (isEA) {
          await repo.updateComponentFields(client, row.component_id, {
            status_id: STATUS_IDS.pending, warehouse_id: whId, location_id: locId
          });
        } else {
          await repo.incrementComponentQtyAndSet(client, row.component_id, wantReturn, {
            status_id: STATUS_IDS.pending, warehouse_id: whId, location_id: locId
          });
        }

        transitions.push({
          item_type: ITEM_TYPE.COMPONENT, item_id: row.component_id, action: ACTION.RETURN,
          qty_delta: isEA ? 1 : wantReturn, unit: row.unit,
          to_status_id: STATUS_IDS.pending, to_warehouse_id: whId, to_location_id: locId,
          context_type: "product", context_id: productId,
        });
      }

      if (wantReturn === remainingBindable) {
        await repo.deleteProductComponentLink(client, linkId);
      } else {
        await repo.addAuditAndDecreaseLink(client, {
          linkId,
          returned_delta: wantReturn,
          scrapped_delta: 0,
        });
      }

      summary.returns.push({ link_id: linkId, component_id: row.component_id, qty: wantReturn });
      summary.processed += 1;
    }

    if (transitions.length) {
      await recordTransitions(client, batchId, transitions, actorId);
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

/* ======================== ADD COMPONENTS ======================== */

exports.addComponents = async (productId, items, actorId = null) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const product = await repo.lockProductExists(client, productId);
    if (!product) { const e = new Error("PRODUCT_NOT_FOUND"); e.status = 404; throw e; }

    const links = [];
    const consumeTransitions = [];

    for (const raw of items) {
      const compId = Number(raw.component_id || 0);
      const reqQty = Number(raw.consume_qty || 0);
      if (!compId) { const e = new Error("INVALID_COMPONENT_ID"); e.status = 400; throw e; }

      const c = await repo.lockComponentById(client, compId);
      if (!c) { const e = new Error("COMPONENT_NOT_FOUND"); e.status = 404; throw e; }
      const isEA = c.unit === "EA";

      if (isEA) {
        if (c.status_id === STATUS_IDS.used) { const e = new Error("COMPONENT_ALREADY_USED"); e.status = 409; throw e; }
        await repo.updateComponentFields(client, c.id, { status_id: STATUS_IDS.used });
        const linkId = await repo.insertProductComponentLink(client, { product_id: productId, component_id: c.id, consume_qty: 1 });
        links.push({ id: linkId, component_id: c.id, consume_qty: 1 });

        consumeTransitions.push({
          item_type: ITEM_TYPE.COMPONENT, item_id: c.id, action: ACTION.CONSUME,
          qty_delta: -1, unit: c.unit,
          from_warehouse_id: c.warehouse_id || null, from_location_id: c.location_id || null,
          to_status_id: STATUS_IDS.used, context_type: "product", context_id: productId,
        });
      } else {
        if (reqQty <= 0) { const e = new Error("INVALID_CONSUME_QTY"); e.status = 400; throw e; }
        const have = Number(c.quantity || 0);
        if (reqQty > have) { const e = new Error("CONSUME_GT_STOCK"); e.status = 409; throw e; }

        const left = have - reqQty;
        if (left === 0) {
          await repo.updateComponentFields(client, c.id, { quantity: 0, status_id: STATUS_IDS.used });
        } else {
          await repo.updateComponentFields(client, c.id, { quantity: left });
        }

        const linkId = await repo.insertProductComponentLink(client, { product_id: productId, component_id: c.id, consume_qty: reqQty });
        links.push({ id: linkId, component_id: c.id, consume_qty: reqQty });

        consumeTransitions.push({
          item_type: ITEM_TYPE.COMPONENT, item_id: c.id, action: ACTION.CONSUME,
          qty_delta: -reqQty, unit: c.unit,
          from_warehouse_id: c.warehouse_id || null, from_location_id: c.location_id || null,
          to_status_id: left === 0 ? STATUS_IDS.used : STATUS_IDS.in_stock,
          context_type: "product", context_id: productId,
        });
      }
    }

    if (consumeTransitions.length) {
      const batchId = makeBatchId();
      await recordTransitions(client, batchId, consumeTransitions, actorId);
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
