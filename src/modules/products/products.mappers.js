// products.mappers.js
// mapListRow
exports.mapListRow = (r) => ({
  id: r.id,
  barcode: r.barcode,
  bimeks_code: r.bimeks_code || null,
  created_at: r.created_at,
  updated_at: r.updated_at,
  approved_at: r.approved_at,

  created_by: r.created_by,
  approved_by: r.approved_by,

  // 👇 isim gösterimi için
  created_by_user: r.created_by ? {
    id: r.created_by,
    full_name: r.created_by_full_name || null,
    username:  r.created_by_username  || null,
  } : null,
  approved_by_user: r.approved_by ? {
    id: r.approved_by,
    full_name: r.approved_by_full_name || null,
    username:  r.approved_by_username  || null,
  } : null,

  notes: r.notes,
  status: r.status_label || r.status_code,
  warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.warehouse_name } : undefined,
  location:  r.location_id  ? { id: r.location_id,  name: r.location_name }  : undefined,
  master:    r.master_id    ? { id: r.master_id,    display_label: r.master_display_label } : undefined,
});

exports.mapDetails = (r, components) => ({
  id: r.id,
  barcode: r.barcode,
  bimeks_code: r.bimeks_code || null,
  created_at: r.created_at,
  updated_at: r.updated_at,
  approved_at: r.approved_at,
  created_by: r.created_by,
  approved_by: r.approved_by,
  created_by_user: r.created_by
    ? { id: r.created_by, username: r.created_by_name || String(r.created_by) }   // 👈 EKLENDİ
    : undefined,
  approved_by_user: r.approved_by
    ? { id: r.approved_by, username: r.approved_by_name || String(r.approved_by) } // 👈 EKLENDİ
    : undefined,
  notes: r.notes,
  status_id: r.status_id,
  status: r.status_label || r.status_code,
  warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.warehouse_name } : undefined,
  location:  r.location_id  ? { id: r.location_id,  name: r.location_name }  : undefined,
  master:    r.master_id    ? { id: r.master_id,    display_label: r.master_display_label } : undefined,
  components: components.map(x => ({
    id: x.component_id,
    barcode: x.barcode,
    unit: x.unit,
    consume_qty: Number(x.consume_qty),
    master: { id: x.comp_master_id, display_label: x.comp_master_display_label },
    link_id: x.link_id,
  })),
});
