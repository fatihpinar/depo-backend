// src/modules/approvals/approvals.service.js
const repo = require("./approvals.repository");
const { assertFormatAndKind, assertAndConsume } = require("../../core/barcode/barcode.service");

const STATUS = { in_stock: 1, pending: 4 };

exports.listPending = async ({ limit = 100, offset = 0, search = "" } = {}) => {
  const rows = await repo.listPendingComponents({ limit, offset, search });

  return rows.map((r) => ({
    id: r.id,
    kind: "component",
    barcode: r.barcode || "",
    unit: "EA",
    quantity: 1,
    width: r.width ?? null,
    height: r.height ?? null,
    area: r.area ?? (r.width && r.height ? Number(r.width) * Number(r.height) : null),
    master: { id: r.master_id, display_label: r.master_display_label },
    warehouse_id: r.warehouse_id ?? null,
    location_id: r.location_id ?? null,
  }));
};

exports.approveItems = async (items = [], actorId = null) => {
  if (!Array.isArray(items) || !items.length) {
    const e = new Error("EMPTY_ITEMS");
    e.status = 400;
    throw e;
  }

  return repo.withTransaction(async (client) => {
    for (const it of items) {
      const id = Number(it.id || 0);
      const wh = Number(it.warehouse_id || 0);
      const lc = Number(it.location_id || 0);
      const barcode = String(it.barcode || "").trim().toUpperCase();

      if (!id || !wh || !lc) {
        const e = new Error("MISSING_FIELDS");
        e.status = 400;
        throw e;
      }

      // barkod zorunlu
      if (!barcode) {
        const e = new Error("BARCODE_REQUIRED");
        e.status = 400;
        throw e;
      }

      // format/kind kontrol
      assertFormatAndKind(barcode, "component");

      const prev = await repo.lockComponent(client, id);
      if (!prev) {
        const e = new Error("COMPONENT_NOT_FOUND");
        e.status = 404;
        throw e;
      }

      // sadece pending onayla
      if (Number(prev.status_id) !== STATUS.pending) {
        const e = new Error("NOT_PENDING");
        e.status = 409;
        throw e;
      }

      // çakışma
      const conflict = await repo.hasComponentBarcodeConflict(client, barcode, id);
      if (conflict) {
        const e = new Error("BARCODE_CONFLICT");
        e.status = 409;
        throw e;
      }

      // barcode_pool kullanıyorsan: consume
      const current = String(prev.barcode || "").trim().toUpperCase();
      if (barcode !== current) {
        await assertAndConsume(client, {
          code: barcode,
          kind: "component",
          refTable: "components",
          refId: id,
        });
      }

      await repo.updateComponentApproval(client, { id, barcode, wh, lc, actorId });
    }

    return { ok: true, approved: items.length };
  });
};