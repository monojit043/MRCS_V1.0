// Links mrcs_db to the master DBs on PC-2 with postgres_fdw — LIVE, nothing is copied.
// Same pattern as ePULSE (D:\ePULSE_DEV_v1.0.0\backend\db\linkPc2.js) — see
// PC1_PC2_INTEGRATION_GUIDE.md.
//
//   eil_employees (PC-2) → schema pc2_emp  (foreign table: users)
//   cmp_pims_1014 (PC-2) → schema pc2_pims (foreign tables: projects, units)
//
// Views for jobs / units (MRCS reviews may only use PIMS jobs — decided 2026-10-18):
//   pims_projects  job_no, job_name                       (active PIMS projects)
//   pims_units     job_no, unit_no, unit_name, master_unit, is_master
//                  master_unit = top-most parent via units.parent_unit; a unit with no
//                  parent, or whose parent is itself, is a master (its own master_unit).
//
// The local table master_employees is replaced by a read-only VIEW of the same
// name and columns (employee_id, employee_name, email, department) — every read
// goes to PC-2. No password column. Only ACTIVE users WITH a department are
// visible (MRCS can't work without a department). The FK
// user_assignments → master_employees is dropped (no FKs across databases).
// user_assignments itself stays MRCS's own table (JE / LE / GL roles).
//
// Run once per machine:  npm run db:link-pc2    (safe to re-run)
// DRY_RUN=1 runs every step, prints live counts, then rolls back.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

// Password from .env, else from %APPDATA%\postgresql\pgpass.conf (same rules as psql)
function resolvePassword(prefix) {
  if (process.env[`${prefix}_PASSWORD`]) return process.env[`${prefix}_PASSWORD`];
  const host = process.env[`${prefix}_HOST`], port = process.env[`${prefix}_PORT`] || "5432";
  const db = process.env[`${prefix}_NAME`], user = process.env[`${prefix}_USER`] || "postgres";
  const file = process.env.PGPASSFILE || path.join(process.env.APPDATA || "", "postgresql", "pgpass.conf");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const f = line.split(/(?<!\\):/).map((s) => s.replace(/\\([:\\])/g, "$1"));
      if (f.length < 5) continue;
      const ok = (v, want) => v === "*" || v === want;
      if (ok(f[0], host) && ok(f[1], port) && ok(f[2], db) && ok(f[3], user)) return f.slice(4).join(":");
    }
  }
  throw new Error(`No password for ${user}@${host}/${db} — set ${prefix}_PASSWORD in .env or add it to ${file}`);
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  const c = {
    host: process.env.EMP_DB_HOST, port: process.env.EMP_DB_PORT || "5432",
    dbname: process.env.EMP_DB_NAME || "eil_employees", user: process.env.EMP_DB_USER || "postgres",
  };
  c.password = resolvePassword("EMP_DB");
  if (!c.host) throw new Error("EMP_DB_HOST missing in .env");

  const p = {
    host: process.env.PIMS_DB_HOST, port: process.env.PIMS_DB_PORT || "5432",
    dbname: process.env.PIMS_DB_NAME || "cmp_pims_1014", user: process.env.PIMS_DB_USER || "postgres",
  };
  if (!p.host) throw new Error("PIMS_DB_HOST missing in .env");
  p.password = resolvePassword("PIMS_DB");

  console.log(`Linking ${process.env.DB_NAME} to PC-2 ${c.host} (${c.dbname}, ${p.dbname})${DRY_RUN ? " — DRY RUN, will roll back" : ""}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("  1/4 creating links and foreign tables...");
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS postgres_fdw;
      DROP SCHEMA IF EXISTS pc2_emp CASCADE;
      DROP SCHEMA IF EXISTS pc2_pims CASCADE;
      DROP SERVER IF EXISTS pc2_employees CASCADE;
      DROP SERVER IF EXISTS pc2_pims CASCADE;

      CREATE SERVER pc2_employees FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host ${lit(c.host)}, port ${lit(c.port)}, dbname ${lit(c.dbname)}, connect_timeout '10');
      CREATE USER MAPPING FOR CURRENT_USER SERVER pc2_employees
        OPTIONS (user ${lit(c.user)}, password ${lit(c.password)});
      CREATE SCHEMA pc2_emp;
      IMPORT FOREIGN SCHEMA public LIMIT TO (users) FROM SERVER pc2_employees INTO pc2_emp;

      CREATE SERVER pc2_pims FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host ${lit(p.host)}, port ${lit(p.port)}, dbname ${lit(p.dbname)}, connect_timeout '10');
      CREATE USER MAPPING FOR CURRENT_USER SERVER pc2_pims
        OPTIONS (user ${lit(p.user)}, password ${lit(p.password)});
      CREATE SCHEMA pc2_pims;
      IMPORT FOREIGN SCHEMA public LIMIT TO (projects, units, user_unit_roles, project_sgls)
        FROM SERVER pc2_pims INTO pc2_pims;
    `);

    console.log("  2/4 removing old local master_employees...");
    const { rows } = await client.query(
      `SELECT relkind FROM pg_class WHERE relname = 'master_employees' AND relnamespace = 'public'::regnamespace`
    );
    if (rows[0]?.relkind === "r") {
      const { rowCount } = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'user_assignments_employee_id_fkey'`
      );
      if (rowCount) await client.query(`ALTER TABLE user_assignments DROP CONSTRAINT user_assignments_employee_id_fkey`);
      await client.query(`DROP TABLE public.master_employees CASCADE`);
      console.log("  dropped local table master_employees (+ FK from user_assignments)");
    }

    console.log("  3/4 creating live views (master_employees, pims_projects, pims_units, effective_assignments)...");
    await client.query(`
      DROP VIEW IF EXISTS public.master_employees;
      CREATE VIEW public.master_employees AS
        SELECT id::varchar(50)          AS employee_id,
               name::varchar(100)       AS employee_name,
               email::varchar(150)      AS email,
               department::varchar(50)  AS department
        FROM pc2_emp.users
        WHERE is_active = 1 AND nullif(trim(department), '') IS NOT NULL;

      CREATE VIEW public.pims_projects AS
        SELECT id::varchar(50) AS job_no, name::varchar(200) AS job_name
        FROM pc2_pims.projects
        WHERE is_active = 1;

      -- Active units of active projects, each with its top-most master unit
      CREATE VIEW public.pims_units AS
        WITH RECURSIVE u AS (
          SELECT un.project_id AS job_no, un.unit_no, un.unit_name,
                 nullif(trim(un.parent_unit), '') AS parent
          FROM pc2_pims.units un
          JOIN pc2_pims.projects pr ON pr.id = un.project_id AND pr.is_active = 1
          WHERE un.is_active = 1
        ),
        chain AS (
          SELECT job_no, unit_no, unit_no AS cur, parent, 0 AS depth FROM u
          UNION ALL
          SELECT ch.job_no, ch.unit_no, up.unit_no, up.parent, ch.depth + 1
          FROM chain ch
          JOIN u up ON up.job_no = ch.job_no AND up.unit_no = ch.parent
          WHERE ch.parent IS NOT NULL AND ch.parent <> ch.cur AND ch.depth < 10
        ),
        top AS (
          SELECT DISTINCT ON (job_no, unit_no) job_no, unit_no, cur AS master_unit
          FROM chain ORDER BY job_no, unit_no, depth DESC
        )
        SELECT u.job_no::varchar(50)   AS job_no,
               u.unit_no::varchar(50)  AS unit_no,
               u.unit_name::varchar(200) AS unit_name,
               t.master_unit::varchar(50) AS master_unit,
               (t.master_unit = u.unit_no) AS is_master
        FROM u JOIN top t ON t.job_no = u.job_no AND t.unit_no = u.unit_no;

      -- Audit columns on MRCS's own assignments (LE / JE given by a GL, inside MRCS)
      ALTER TABLE user_assignments ADD COLUMN IF NOT EXISTS assigned_by VARCHAR(50);
      ALTER TABLE user_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

      -- Everyone's EFFECTIVE roles (decided 2026-10-18). GL is never stored — it is
      -- worked out live from PC-2; LE / JE are stored in user_assignments by a GL.
      --   assigned : user_assignments (MRCS)
      --   pims     : PIMS GL / SGL on ANY unit of a group → GL on that group's master unit;
      --              PIMS project SGL → GL on every master unit of that job
      --   level    : eil_employees.level >= 17 → GL on every master unit of every active PIMS job
      -- Computed GL rows have stage NULL (= every stage) and the person's own department.
      CREATE VIEW public.effective_assignments AS
        SELECT ua.employee_id::varchar(50) AS employee_id, ua.role::varchar(10) AS role,
               ua.department::varchar(100) AS department, ua.job_no::varchar(50) AS job_no,
               ua.unit_no::varchar(50) AS unit_no, ua.stage::varchar(50) AS stage,
               'assigned'::varchar(10) AS source
        FROM user_assignments ua
        UNION
        SELECT u.id::varchar(50), 'GL', u.department::varchar(100), pu.job_no, pu.master_unit, NULL, 'pims'
        FROM pc2_pims.user_unit_roles r
        JOIN pims_units pu ON pu.job_no = r.project_id AND pu.unit_no = r.unit_no
        JOIN pc2_emp.users u ON upper(u.id) = upper(r.user_id)
        WHERE r.role_code IN ('GL', 'SGL')
          AND u.is_active = 1 AND nullif(trim(u.department), '') IS NOT NULL
        UNION
        SELECT u.id::varchar(50), 'GL', u.department::varchar(100), pu.job_no, pu.unit_no, NULL, 'pims'
        FROM pc2_pims.project_sgls s
        JOIN pims_units pu ON pu.job_no = s.project_id AND pu.is_master
        JOIN pc2_emp.users u ON upper(u.id) = upper(s.user_id)
        WHERE u.is_active = 1 AND nullif(trim(u.department), '') IS NOT NULL
        UNION
        SELECT u.id::varchar(50), 'GL', u.department::varchar(100), pu.job_no, pu.unit_no, NULL, 'level'
        FROM pc2_emp.users u
        JOIN pims_units pu ON pu.is_master
        WHERE u.is_active = 1 AND u.level >= 17 AND nullif(trim(u.department), '') IS NOT NULL;
    `);

    console.log("  4/4 reading live counts from PC-2...");
    const { rows: counts } = await client.query(`
      SELECT (SELECT count(*) FROM pc2_emp.users)::int AS eil_employees_total,
             (SELECT count(*) FROM master_employees)::int AS visible_in_mrcs,
             (SELECT count(*) FROM pims_projects)::int AS pims_jobs,
             (SELECT count(*) FROM pims_units)::int AS pims_units,
             (SELECT count(*) FROM pims_units WHERE is_master)::int AS pims_master_units,
             (SELECT count(DISTINCT employee_id) FROM effective_assignments WHERE source = 'pims')::int AS gl_from_pims,
             (SELECT count(DISTINCT employee_id) FROM effective_assignments WHERE source = 'level')::int AS gl_from_level,
             (SELECT count(*) FROM user_assignments ua
               WHERE NOT EXISTS (SELECT 1 FROM master_employees m WHERE upper(m.employee_id) = upper(ua.employee_id)))::int
               AS assignments_for_unknown_users`);

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("✅ Dry run OK — nothing changed. Live counts would be:", counts[0]);
    } else {
      await client.query("COMMIT");
      console.log(`✅ Linked to PC-2 (${c.host}) — live counts:`, counts[0]);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Linking to PC-2 failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Linking to PC-2 failed:", err.message);
  process.exitCode = 1;
});
