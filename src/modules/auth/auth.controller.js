const svc = require("./auth.service");
const repo = require("./auth.repository");

exports.login = async (req, res) => {
  try {
    const { email = "", password = "" } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: "E-posta ve şifre zorunlu." });
    }
    const out = await svc.loginWithEmail(String(email).toLowerCase().trim(), password);
    res.json(out);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Login error" });
  }
};

exports.me = async (req, res) => {
  try {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const session = await svc.getSessionByUserId(userId); // { user, permissions }
    const u = session.user;

    // FE için düz cevap
    return res.json({
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      email: u.email,
      role_key: u.role_key,
      role_name: u.role_name,
      permissions: session.permissions,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message || "ME_ERROR" });
  }
};
