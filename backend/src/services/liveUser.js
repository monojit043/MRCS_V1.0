// Who a user is RIGHT NOW — read live on every request, never trusted from the token.
//   name, department, active   → master_employees (live view of eil_employees on PC-2)
//   highest MRCS role          → effective_assignments (MRCS LE / JE + GL from PIMS / level)
// See PC1_PC2_INTEGRATION_GUIDE.md.
const pool = require("../data/db");

const ROLE_RANK = { JE: 1, LE: 2, GL: 3 };

// Returns { employeeId, fullName, department, role }. ANY active employee on PC-2
// can sign in (decided 2026-10-17); what they see depends on their MRCS
// assignments. role is null when they have none, department may be null.
// Returns null only if the user doesn't exist or is inactive.
async function loadLiveUser(employeeId) {
  const { rows } = await pool.query(
    `SELECT u.id AS employee_id, u.name AS employee_name, nullif(trim(u.department), '') AS department,
            ARRAY(SELECT DISTINCT ua.role FROM effective_assignments ua
                  WHERE upper(ua.employee_id) = upper(u.id)) AS roles
     FROM pc2_emp.users u
     WHERE upper(u.id) = upper($1) AND u.is_active = 1`,
    [employeeId]
  );
  const u = rows[0];
  if (!u) return null;
  let role = (u.roles || []).reduce(
    (best, r) => (ROLE_RANK[r] > (ROLE_RANK[best] || 0) ? r : best), null);

  // PEM rights come from the department alone (decided 2026-10-17): anyone whose
  // department on PC-2 is PEM acts as PEM GL — no MRCS assignment needed. This is
  // what lets PEM create reviews and assign the first GL / LE / JE on them.
  if (String(u.department).toLowerCase() === "pem") role = "GL";

  return { employeeId: u.employee_id, fullName: u.employee_name, department: u.department, role };
}

// Password check against eil_employees on PC-2 (plain-text column there; never copied)
async function checkCredentials(employeeId, password) {
  const { rows } = await pool.query(
    `SELECT id FROM pc2_emp.users
     WHERE upper(id) = upper($1) AND password_hash = $2 AND is_active = 1`,
    [employeeId, password]
  );
  return rows[0]?.id || null;
}

module.exports = { loadLiveUser, checkCredentials };
