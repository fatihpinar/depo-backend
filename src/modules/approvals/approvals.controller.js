const svc = require("./approvals.service");

function getActorId(req) {
  return req?.user?.id ? Number(req.user.id) : null;
}



/* ---- LIST ---- */
exports.listPending = async (req, res) => {
  try {
    const rows = await svc.listPending({
      scope:  req.query.scope  || "stock",
      limit:  Number(req.query.limit  || 100),
      offset: Number(req.query.offset || 0),
      search: (req.query.search || "").trim(),
    });
    res.json(rows);
  } catch (err) {
    console.error("approvals.listPending error:", err);
    res.status(500).json({ message: "Pending kayıtlar getirilemedi." });
  }
};

/* ---- APPROVE ---- */
exports.approveItems = async (req, res) => {
  try {
    const body  = req.body || {};
    const scope = body.scope || "stock";
    const items = Array.isArray(body.items) ? body.items : [];
    const actorId = getActorId(req);             // 👈
    const result = await svc.approveItems(scope, items, actorId); // 👈
    res.json(result);
  } catch (err) {
    console.error("approvals.approveItems error:", err);
    res.status(err.status || 500).json({ message: err.message || "Onay hatası" });
  }
};

/* ---- COMPLETE ----
   Üretim/serigrafi işi bittiğinde aynı onay akışını çalıştırıyoruz.
*/
exports.completeWork = async (req, res) => {
  try {
    const body  = req.body || {};
    const scope = body.scope;
    const items = Array.isArray(body.items) ? body.items : [];
    const actorId = getActorId(req);             // 👈
    const result = await svc.completeWork(scope, items, actorId); // 👈
    res.json(result);
  } catch (err) {
    console.error("approvals.completeWork error:", err);
    res.status(err.status || 500).json({ message: err.message || "Tamamlama hatası" });
  }
};
