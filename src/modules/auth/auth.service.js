const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const repo = require("./auth.repository");

function signJwt(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });
}

/** Ortak paketleme: user + permissions + token yok (me için) */
async function buildSessionForUser(user) {
  // Rol anahtarı
  const roleKey = user.role_key;

  // admin ve depo yöneticisi => tüm izinler
  let permissions = [];
  if (roleKey === "admin" || roleKey === "warehouse_manager") {
    permissions = await repo.getAllPermissionKeys();
  } else {
    permissions = await repo.getPermissionsForRoleId(user.role_id);
  }

  const safeUser = {
    id: user.id,
    full_name: user.full_name,
    email: String(user.email).toLowerCase(),
    username: user.username,
    role_key: roleKey,
    role_name: user.role_name,
  };

  return { user: safeUser, permissions };
}

/** LOGIN */
exports.loginWithEmail = async (email, password) => {
  const user = await repo.findUserByEmail(email);
  if (!user) { const e = new Error("INVALID_CREDENTIALS"); e.status = 401; throw e; }
  if (user.is_active === false) { const e = new Error("USER_INACTIVE"); e.status = 403; throw e; }

  const ok = await bcrypt.compare(password, user.password_hash || "");
  if (!ok) { const e = new Error("INVALID_CREDENTIALS"); e.status = 401; throw e; }

  const session = await buildSessionForUser(user);

  // minimal payload
  const token = signJwt({ sub: user.id, role: user.role_key });

  return { token, ...session };
};

/** /auth/me için (token ile) */
exports.getSessionByUserId = async (userId) => {
  const user = await repo.findUserById(userId);
  if (!user) { const e = new Error("USER_NOT_FOUND"); e.status = 404; throw e; }
  return buildSessionForUser(user);
};
