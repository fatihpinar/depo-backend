const pool = require("../../core/db");

/**
 * users tablosu iki olasılığı da desteklemek için yazıldı:
 *  - users.role_id -> roles.id (FK)
 *  - users.role    -> roles.key (enum/text)
 */
const BASE_USER_SELECT = `
  SELECT
    u.id,
    u.full_name,
    u.username,
    u.email,
    u.password_hash,
    u.is_active,
    COALESCE(r.id, NULL)        AS role_id,
    COALESCE(r.key, CAST(u.role AS text)) AS role_key,
    COALESCE(r.name, CAST(u.role AS text)) AS role_name
  FROM users u
  LEFT JOIN roles r
    ON (r.id = u.role_id)
    OR (r.key = CAST(u.role AS text))
`;

exports.findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `${BASE_USER_SELECT}
     WHERE LOWER(u.email) = LOWER($1)
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

exports.findUserById = async (userId) => {
  const { rows } = await pool.query(
    `${BASE_USER_SELECT}
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

exports.getPermissionsForRoleId = async (roleId) => {
  if (!roleId) return [];
  const { rows } = await pool.query(
    `SELECT p.key
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [roleId]
  );
  return rows.map(r => r.key);
};

exports.getAllPermissionKeys = async () => {
  const { rows } = await pool.query(`SELECT key FROM permissions`);
  return rows.map(r => r.key);
};

exports.getUserPermissions = async (userId) => {
  const { rows } = await pool.query(
    `
    SELECT p.key
    FROM users u
    JOIN roles r                   ON r.id = u.role_id
    JOIN role_permissions rp       ON rp.role_id = r.id
    JOIN permissions p             ON p.id = rp.permission_id
    WHERE u.id = $1
    ORDER BY p.key ASC
    `,
    [userId]
  );
  return rows.map(r => r.key);
};

exports.getUserBasicById = async (id) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, username, email FROM users WHERE id=$1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};