// src/modules/approvals/approvals.controller.js
const svc = require("./approvals.service");

function getActorId(req) {
  return req?.user?.id ? Number(req.user.id) : null;
}

exports.listPending = async (req, res) => {
  try {
    const rows = await svc.listPending({
      limit: Number(req.query.limit || 100),
      offset: Number(req.query.offset || 0),
      search: (req.query.search || "").trim(),
    });
    res.json(rows);
  } catch (err) {
    console.error("approvals.listPending error:", err);
    res.status(500).json({ message: "Pending kayıtlar getirilemedi." });
  }
};

exports.approveItems = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const actorId = getActorId(req);
    const result = await svc.approveItems(items, actorId);
    res.json(result);
  } catch (err) {
    console.error("approvals.approveItems error:", err);
    res.status(err.status || 500).json({ message: err.message || "Onay hatası" });
  }
};
