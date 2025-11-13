const jwt = require("jsonwebtoken");
const { getUserPermissions } = require("./auth.repository");

// JWT zorunlu
exports.requireAuth = (req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role, _permsLoaded: false, perms: [] };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// (opsiyonel) rol bazlı gate – basit durumlarda işine yarar
exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};

// Dahili: request üzerinde permission'ları 1 kez yükle
async function ensurePerms(req) {
  if (!req.user) throw new Error("Auth first");
  if (req.user._permsLoaded) return;
  // admin veya depo_yöneticisi her şeye erişsin isteniyorsa:
  if (["admin", "warehouse_manager"].includes(req.user.role)) {
    req.user.perms = ["*"]; // wildcard
    req.user._permsLoaded = true;
    return;
  }
  const keys = await getUserPermissions(req.user.id);
  req.user.perms = keys;
  req.user._permsLoaded = true;
}

// Tek izin
exports.requirePermission = (permKey) => {
  return async (req, res, next) => {
    try {
      await ensurePerms(req);
      if (req.user.perms.includes("*") || req.user.perms.includes(permKey)) {
        return next();
      }
      return res.status(403).json({ message: "Forbidden" });
    } catch (e) {
      return res.status(500).json({ message: "PERM_CHECK_ERROR" });
    }
  };
};

// Birinden biri
exports.requireAny = (...permKeys) => {
  return async (req, res, next) => {
    try {
      await ensurePerms(req);
      if (req.user.perms.includes("*")) return next();
      const ok = permKeys.some(k => req.user.perms.includes(k));
      if (ok) return next();
      return res.status(403).json({ message: "Forbidden" });
    } catch {
      return res.status(500).json({ message: "PERM_CHECK_ERROR" });
    }
  };
};

// Hepsi
exports.requireAll = (...permKeys) => {
  return async (req, res, next) => {
    try {
      await ensurePerms(req);
      if (req.user.perms.includes("*")) return next();
      const ok = permKeys.every(k => req.user.perms.includes(k));
      if (ok) return next();
      return res.status(403).json({ message: "Forbidden" });
    } catch {
      return res.status(500).json({ message: "PERM_CHECK_ERROR" });
    }
  };
};

exports.getActorId = (req) => Number(req?.user?.id || 0);
