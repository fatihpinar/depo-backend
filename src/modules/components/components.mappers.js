// src/modules/components/components.mappers.js

exports.mapRowToApi = (r) => ({
  id: r.id,
  barcode: r.barcode,

  // Artık unit & quantity yok
  width: r.width ?? null,
  height: r.height ?? null,
  area: r.area ?? null,
  invoice_no: r.invoice_no ?? null,

  created_at: r.created_at,
  updated_at: r.updated_at,
  approved_at: r.approved_at,

  created_by: r.created_by,
  approved_by: r.approved_by,

  created_by_user: r.created_by
    ? {
        id: r.created_by,
        full_name: r.created_by_full_name || null,
        username: r.created_by_username || null,
      }
    : null,
  approved_by_user: r.approved_by
    ? {
        id: r.approved_by,
        full_name: r.approved_by_full_name || null,
        username: r.approved_by_username || null,
      }
    : null,

  notes: r.notes,
  status_id: r.status_id,
  status: r.status_label || r.status_code,

  warehouse: r.warehouse_id
    ? { id: r.warehouse_id, name: r.warehouse_name }
    : undefined,
  location: r.location_id
    ? { id: r.location_id, name: r.location_name }
    : undefined,

  master: r.master_id
    ? {
        id: r.master_id,
        bimeks_product_name: r.master_bimeks_product_name || null, // 🔧 tek kaynak
        bimeks_code: r.master_code || null,
        length_unit: r.master_length_unit || null,
      }
    : undefined,
});
