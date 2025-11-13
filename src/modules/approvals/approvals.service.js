// src/modules/approvals/approvals.service.js
const { recordTransitions, makeBatchId } = require("../transitions/transitions.service");
const { ITEM_TYPE, ACTION } = require("../transitions/transitions.constants");
const { assertFormatAndKind, assertAndConsume } = require("../../core/barcode/barcode.service");

const repo = require("./approvals.repository");
const { STATUS, LIST_STATUS_BY_SCOPE, DEPT_BY_SCOPE, KIND_TABLE } =
  require("./approvals.constants");

/* ---------------- LIST ---------------- */
exports.listPending = async ({ scope = "stock", limit = 100, offset = 0, search = "" } = {}) => {
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
    master: { id: r.master_id, display_label: r.display_label },
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

      const prevStatus = Number(prev.status_id);
      const prevWh = Number(prev.warehouse_id || 0);
      const prevLc = Number(prev.location_id || 0);
      const unit = prev.unit || it.unit || "EA";

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
      await recordTransitions(client, batchId, transitions, actorId); // 👈 actor_user_id yaz
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
