// src/modules/approvals/approvals.service.js
const { ITEM_TYPE, ACTION } = require("../transitions/transitions.constants");
const {
  assertFormatAndKind,
  assertAndConsume,
} = require("../../core/barcode/barcode.service");
const {
  recordTransitions,
  makeBatchId,
  applyStockBalancesForComponentTransitions,
} = require("../transitions/transitions.service");

const repo = require("./approvals.repository");
const {
  STATUS,
  LIST_STATUS_BY_SCOPE,
  DEPT_BY_SCOPE,
  KIND_TABLE,
} = require("./approvals.constants");

/* ---------------- LIST ---------------- */
exports.listPending = async ({
  scope = "stock",
  limit,
  offset = 0,
  search = "",
} = {}) => {
  const statusToList = LIST_STATUS_BY_SCOPE[scope];
  if (!statusToList) return [];

  const rows = await repo.listPendingUnion(statusToList, {
    search,
    limit,
    offset,
  });

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

    // 👇 yalnızca ürünler için dolu olacak
    product_name: r.kind === "product" ? (r.product_name || null) : null,

    warehouse_id: r.warehouse_id,
    location_id: r.location_id,
  }));
};

/* ---------------- APPROVE ----------------
   - in_stock'a geçecekse barkod ZORUNLU + format/kind kontrolü
   - barkod ilk kez atanıyor/değişiyorsa:
       * tablo içinde çakışma yok
       * barcode_pool -> assertAndConsume
   - stok devri:
       * COMPONENT için master.stock_unit'e göre area/weight/length/volume/box_unit/unit
------------------------------------------*/
exports.approveItems = async (scope = "stock", items = [], actorId = null) => {
  if (!["stock", "production", "screenprint"].includes(scope)) {
    const e = new Error("UNSUPPORTED_SCOPE");
    e.status = 400;
    throw e;
  }
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
      const wh = Number(it.warehouse_id || 0);
      const lc = Number(it.location_id || 0);
      if (!id || !wh || !lc) {
        const e = new Error("MISSING_FIELDS");
        e.status = 400;
        throw e;
      }

      const table = KIND_TABLE[it.kind] || null;
      if (!table) {
        const e = new Error("INVALID_KIND");
        e.status = 400;
        throw e;
      }

      // Kilitle + mevcut değerler
      const prev = await repo.lockItem(client, table, id);
      if (!prev) {
        const e = new Error(
          table === "components" ? "COMPONENT_NOT_FOUND" : "PRODUCT_NOT_FOUND"
        );
        e.status = 404;
        throw e;
      }

      const prevStatus = Number(prev.status_id);
      const prevWh = Number(prev.warehouse_id || 0);
      const prevLc = Number(prev.location_id || 0);
      const unit = prev.unit || it.unit || "EA";

      // 🔹 Sadece component için stock_unit & miktar (have) belirle
      let stockUnit = null;
      let have = 0;

      if (it.kind === "component") {
        stockUnit = (prev.stock_unit || "")
          .toString()
          .trim()
          .toLowerCase();

        switch (stockUnit) {
          case "area":
            have = Number(prev.area || 0);
            break;
          case "weight":
            have = Number(prev.weight || 0);
            break;
          case "length":
            have = Number(prev.length || 0);
            break;
          case "volume":
            have = Number(prev.volume || 0);
            break;
          case "box_unit":
            have = Number(prev.box_unit || 0);
            break;
          case "unit":
            // unit: her kayıt 1 adet temsil ediyor
            have = 1;
            break;
          default:
            stockUnit = null;
            have = 0;
            break;
        }
      }

      // Hedef statü (scope ve hedef deponun departmanına göre)
      let toStatus;
      if (scope === "stock") {
        toStatus = STATUS.in_stock;
      } else {
        const dept = await repo.getWarehouseDepartment(client, wh);
        if (!dept) {
          const e = new Error("WAREHOUSE_NOT_FOUND");
          e.status = 404;
          throw e;
        }
        const ownDept = DEPT_BY_SCOPE[scope]; // "production" | "screenprint"
        toStatus = dept === ownDept ? STATUS.in_stock : STATUS.pending;
      }

      // Barkod doğrulama
      const incoming = String(it.barcode || "").trim().toUpperCase();
      const current = String(prev.barcode || "").trim().toUpperCase();
      const nextBarcode = incoming || current;

      if (toStatus === STATUS.in_stock) {
        if (!nextBarcode) {
          const e = new Error("BARCODE_REQUIRED");
          e.status = 400;
          throw e;
        }
        assertFormatAndKind(nextBarcode, it.kind);
      } else if (nextBarcode) {
        // pending'e düşecek olsa bile barkod verildiyse kontrol et
        assertFormatAndKind(nextBarcode, it.kind);
      }

      const changingBarcode = !!nextBarcode && nextBarcode !== current;
      if (changingBarcode) {
        const conflict = await repo.hasBarcodeConflict(
          client,
          table,
          nextBarcode,
          id
        );
        if (conflict) {
          const err = new Error("BARCODE_CONFLICT");
          err.status = 409;
          throw err;
        }

        await assertAndConsume(client, {
          code: nextBarcode,
          kind: it.kind,
          refTable: table,
          refId: id,
        });
      }

      const willMove = prevWh !== wh || prevLc !== lc;
      const setApproved =
        Number(prevStatus) !== STATUS.in_stock &&
        Number(toStatus) === STATUS.in_stock;

      // DB UPDATE
      await repo.updateApproval(client, table, {
        toStatus,
        wh,
        lc,
        id,
        nextBarcode,
        changingBarcode,
        setApproved,
        actorId,
      });

      // ------------- TRANSITIONS -------------

      // 1) DEPO / LOKASYON HAREKETİ
      if (willMove) {
        transitions.push({
          item_type:
            it.kind === "component"
              ? ITEM_TYPE.COMPONENT
              : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.MOVE,
          qty_delta: 0,
          unit,
          from_warehouse_id: prevWh || null,
          from_location_id: prevLc || null,
          to_warehouse_id: wh,
          to_location_id: lc,
        });
      }

      // 2) STATÜ DEĞİŞİMİ
      if (prevStatus !== toStatus) {
        const approveMeta = changingBarcode
          ? {
              field: "barcode",
              before: current || null,
              after: nextBarcode,
              reason: "approve",
            }
          : null;

        // 2.a) Tarihçe için APPROVE
        transitions.push({
          item_type:
            it.kind === "component"
              ? ITEM_TYPE.COMPONENT
              : ITEM_TYPE.PRODUCT,
          item_id: id,
          action: ACTION.APPROVE,
          qty_delta: 0,
          unit,
          from_status_id: prevStatus,
          to_status_id: toStatus,
          from_warehouse_id: prevWh || null,
          from_location_id: prevLc || null,
          to_warehouse_id: wh,
          to_location_id: lc,
          meta: approveMeta,
        });

        // 2.b) Stok bakiyesi devri (sadece COMPONENT)
        //      pending → in_stock (veya genel statü değişimi) için
        if (it.kind === "component" && stockUnit && have > 0) {
          const fromMeta = {
            unit_type: stockUnit,
          };
          const toMeta = {
            unit_type: stockUnit,
          };

          // meta alanlarını stock_unit'e göre doldur
          if (stockUnit === "area") {
            fromMeta.consumed_area = have;
            toMeta.area = have;
          } else if (stockUnit === "weight") {
            fromMeta.consumed_weight = have;
            toMeta.weight = have;
          } else if (stockUnit === "length") {
            fromMeta.consumed_length = have;
            toMeta.length = have;
          } else if (stockUnit === "volume") {
            fromMeta.consumed_volume = have;
            toMeta.volume = have;
          } else if (stockUnit === "box_unit") {
            fromMeta.consumed_box_unit = have;
            toMeta.box_unit = have;
          } else if (stockUnit === "unit") {
            fromMeta.consumed_unit = have;
            toMeta.unit = have;
          }

          // Eski statü / bucket'tan düş
          transitions.push({
            item_type: ITEM_TYPE.COMPONENT,
            item_id: id,
            action: ACTION.ADJUST,
            qty_delta: -1,
            unit,
            from_status_id: prevStatus,
            to_status_id: prevStatus,
            from_warehouse_id: prevWh || null,
            from_location_id: prevLc || null,
            to_warehouse_id: prevWh || null,
            to_location_id: prevLc || null,
            meta: fromMeta,
          });

          // Yeni statü / bucket'a ekle
          transitions.push({
            item_type: ITEM_TYPE.COMPONENT,
            item_id: id,
            action: ACTION.ADJUST,
            qty_delta: +1,
            unit,
            from_status_id: toStatus,
            to_status_id: toStatus,
            from_warehouse_id: wh,
            from_location_id: lc,
            to_warehouse_id: wh,
            to_location_id: lc,
            meta: toMeta,
          });
        }
      }
      // 3) Statü değişmiyor, sadece barkod değiştiyse: ATTRIBUTE_CHANGE
      else if (changingBarcode) {
        transitions.push({
          item_type:
            it.kind === "component"
              ? ITEM_TYPE.COMPONENT
              : ITEM_TYPE.PRODUCT,
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
      // recordTransitions burada hâlâ eski imza ile kullanılıyor; diğer yerlerle aynı
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

/* ---- DELETE (SOFT DELETE + HISTORY) ---- */
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
