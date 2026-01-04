// src/modules/approvals/approvals.service.js
const { ITEM_TYPE, ACTION } = require("../transitions/transitions.constants");
const { assertFormatAndKind, assertAndConsume } = require("../../core/barcode/barcode.service");
const {
  recordTransitions,
  makeBatchId,
  applyStockBalancesForComponentTransitions,   // 👈 eklendi
} = require("../transitions/transitions.service");


const repo = require("./approvals.repository");
const { STATUS, LIST_STATUS_BY_SCOPE, DEPT_BY_SCOPE, KIND_TABLE } =
  require("./approvals.constants");

/* ---------------- LIST ---------------- */
exports.listPending = async ({ scope = "stock", limit, offset = 0, search = "" } = {}) => {
  const statusToList = LIST_STATUS_BY_SCOPE[scope];
  if (!statusToList) return [];

  const rows = await repo.listPendingUnion(statusToList, { search, limit, offset });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    barcode: r.barcode,
    unit: r.unit,
    quantity: r.quantity,
    width: r.width,
    height: r.height,
    master: r.master_id
      ? {
          id: r.master_id,
          display_label: r.display_label,
          bimeks_code: r.bimeks_code ?? null,
        }
      : null,
    warehouse_id: r.warehouse_id,
    location_id: r.location_id,
  }));
};


/* ---------------- APPROVE ----------------
   - in_stock'a geçecekse barkod ZORUNLU + format/kind kontrolü
   - barkod ilk kez atanıyor/değişiyorsa:
       * tablo içinde çakışma yok
       * barcode_pool -> assertAndConsume
------------------------------------------*/
exports.approveItems = async (scope = "stock", items = [], actorId = null) => {
  if (!["stock", "production", "screenprint"].includes(scope)) {
    const e = new Error("UNSUPPORTED_SCOPE"); e.status = 400; throw e;
  }
  if (!Array.isArray(items) || !items.length) {
    const e = new Error("EMPTY_ITEMS"); e.status = 400; throw e;
  }

  return repo.withTransaction(async (client) => {
    const transitions = [];
    const batchId = makeBatchId();

    for (const it of items) {
      const id = Number(it.id);
      const wh = Number(it.warehouse_id || 0);
      const lc = Number(it.location_id  || 0);
      if (!id || !wh || !lc) { const e = new Error("MISSING_FIELDS"); e.status = 400; throw e; }

      const table = KIND_TABLE[it.kind] || null;
      if (!table) { const e = new Error("INVALID_KIND"); e.status = 400; throw e; }

      // Kilitle + mevcut değerler
      const prev = await repo.lockItem(client, table, id);
      if (!prev) {
        const e = new Error(table === "components" ? "COMPONENT_NOT_FOUND" : "PRODUCT_NOT_FOUND");
        e.status = 404; throw e;
      }

      const prevStatus = Number(prev.status_id);      // 👈 EKSİK OLAN SATIR
      const prevWh = Number(prev.warehouse_id || 0);
      const prevLc = Number(prev.location_id || 0);
      const unit = prev.unit || it.unit || "EA";
      const prevArea = Number(prev.area || 0);  // 👈 yeni


      // Hedef statü (scope ve hedef deponun departmanına göre)
      let toStatus;
      if (scope === "stock") {
        toStatus = STATUS.in_stock;
      } else {
        const dept = await repo.getWarehouseDepartment(client, wh);
        if (!dept) { const e = new Error("WAREHOUSE_NOT_FOUND"); e.status = 404; throw e; }
        const ownDept = DEPT_BY_SCOPE[scope]; // "production" | "screenprint"
        toStatus = (dept === ownDept) ? STATUS.in_stock : STATUS.pending;
      }

      // Barkod doğrulama
      const incoming = String(it.barcode || "").trim().toUpperCase();
      const current  = String(prev.barcode || "").trim().toUpperCase();
      const nextBarcode = incoming || current;

      if (toStatus === STATUS.in_stock) {
        if (!nextBarcode) { const e = new Error("BARCODE_REQUIRED"); e.status = 400; throw e; }
        assertFormatAndKind(nextBarcode, it.kind);
      } else if (nextBarcode) {
        // pending'e düşecek olsa bile barkod verildiyse kontrol et
        assertFormatAndKind(nextBarcode, it.kind);
      }

      const changingBarcode = !!nextBarcode && nextBarcode !== current;
      if (changingBarcode) {
        const conflict = await repo.hasBarcodeConflict(client, table, nextBarcode, id);
        if (conflict) { const err = new Error("BARCODE_CONFLICT"); err.status = 409; throw err; }

        await assertAndConsume(client, {
          code: nextBarcode,
          kind: it.kind,
          refTable: table,
          refId: id,
        });
      }

      const willMove = (prevWh !== wh) || (prevLc !== lc);
      const setApproved =
        Number(prevStatus) !== STATUS.in_stock && Number(toStatus) === STATUS.in_stock;

      // Update
      await repo.updateApproval(client, table, {
        toStatus, wh, lc, id, nextBarcode, changingBarcode,
        setApproved, actorId,                           // 👈 YENİ
      });

      // Transitions
      if (willMove) {
        transitions.push({
          item_type: it.kind === "component" ? ITEM_TYPE.COMPONENT : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.MOVE,
          qty_delta: 0,
          unit,
          from_warehouse_id: prevWh || null,
          from_location_id:  prevLc || null,
          to_warehouse_id:   wh,
          to_location_id:    lc,
        });
      }

      // 🔹 Statü değişiyorsa APPROVE kaydı
      //    + eğer bu sırada barkod da değişmişse, meta içine göm
      if (prevStatus !== toStatus) {
        const approveMeta = changingBarcode
          ? {
              field: "barcode",
              before: current || null,
              after: nextBarcode,
              reason: "approve",
            }
          : null;

        // 1) Tarihçe için APPROVE transition
        transitions.push({
          item_type: it.kind === "component" ? ITEM_TYPE.COMPONENT : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.APPROVE,
          qty_delta: 0,
          unit,
          from_status_id: prevStatus,
          to_status_id: toStatus,
          from_warehouse_id: prevWh || null,
          from_location_id:  prevLc || null,
          to_warehouse_id:   wh,
          to_location_id:    lc,
          meta: approveMeta,
        });

        // 2) Stok bakiyesi için pending → in_stock taşı (sadece component)
        if (it.kind === "component" && prevArea > 0) {
          // 2.a) Eski statüden düş (ör: pending)
          transitions.push({
            item_type: ITEM_TYPE.COMPONENT,
            item_id: id,
            action: ACTION.ADJUST,
            qty_delta: -1,
            unit,
            from_status_id: prevStatus,
            to_status_id: prevStatus,
            from_warehouse_id: prevWh || null,
            from_location_id:  prevLc || null,
            to_warehouse_id:   prevWh || null,
            to_location_id:    prevLc || null,
            meta: {
              // applyStockBalancesForComponentTransitions: consumed_area ⇒ area_sum'dan düş
              consumed_area: prevArea,
            },
          });

          // 2.b) Yeni statüye ekle (ör: in_stock)
          transitions.push({
            item_type: ITEM_TYPE.COMPONENT,
            item_id: id,
            action: ACTION.ADJUST,
            qty_delta: +1,
            unit,
            from_status_id: toStatus,
            to_status_id: toStatus,
            from_warehouse_id: wh,
            from_location_id:  lc,
            to_warehouse_id:   wh,
            to_location_id:    lc,
            meta: {
              // area ⇒ area_sum'a ekle
              area: prevArea,
            },
          });
        }
      }
      // 🔹 Statü değişmiyor, sadece barkod edit edildiyse
      //    (örneğin ileride düzeltme ekranından) ATTRIBUTE_CHANGE kullan
      else if (changingBarcode) {
        transitions.push({
          item_type: it.kind === "component" ? ITEM_TYPE.COMPONENT : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.ATTRIBUTE_CHANGE,
          qty_delta: 0,
          unit,
          meta: {
            field: "barcode",
            before: current || null,
            after: nextBarcode,
            reason: "edit",
          },
        });
      }
    }

        if (transitions.length) {
      await recordTransitions(client, batchId, transitions, actorId);
      await applyStockBalancesForComponentTransitions(client, transitions);
    }

    return { ok: true, approved: items.length };

  });
};

/* ---- COMPLETE ----
   Üretim/Serigrafi işi tamamlandığında aynı onay kurallarıyla ilerliyoruz.
*/
exports.completeWork = async (scope, items) => {
  return exports.approveItems(scope, items);
};

// src/modules/approvals/approvals.service.js
// approvals.service.js
exports.deleteItems = async (items = [], actorId = null) => {
  if (!Array.isArray(items) || !items.length) {
    const e = new Error("EMPTY_ITEMS");
    e.status = 400;
    throw e;
  }

  return repo.withTransaction(async (client) => {
    const transitions = [];
    const batchId = makeBatchId();

    for (const it of items) {
      const id = Number(it.id);
      const table = KIND_TABLE[it.kind];
      if (!table) throw new Error("INVALID_KIND");

      const prev = await repo.lockItem(client, table, id);
      if (!prev) throw new Error("ITEM_NOT_FOUND");

      await repo.softDeleteItem(client, table, id, actorId);

      transitions.push({
        item_type:
          it.kind === "component"
            ? ITEM_TYPE.COMPONENT
            : ITEM_TYPE.PRODUCT,
        item_id: id,
        action: ACTION.STATUS_CHANGE,
        qty_delta: 0,
        unit: prev.unit || "EA",
        from_status_id: prev.status_id,
        to_status_id: STATUS.deleted,
      });
    }

    if (transitions.length) {
      await recordTransitions(client, batchId, transitions, actorId);
    }

    return { ok: true, deleted: items.length };
  });
};