// Jobs, units and master units come LIVE from PIMS on PC-2 (views pims_projects /
// pims_units, built by src/data/linkPc2.js). MRCS reviews may only use PIMS jobs
// and are created on MASTER units only — a review on a master covers its whole
// group (master + child units). Stages come from stage_prerequisites_master.
const pool = require("../data/db");

async function getJobs() {
  const { rows } = await pool.query(
    `SELECT job_no, job_name FROM pims_projects ORDER BY job_no`
  );
  return rows;
}

// Master units of a job, each with its child units (standalone masters have none)
async function getMasterUnits(jobNo) {
  const { rows } = await pool.query(
    `SELECT unit_no, unit_name, master_unit, is_master
     FROM pims_units WHERE upper(job_no) = upper($1)
     ORDER BY unit_no`,
    [jobNo]
  );
  const masters = rows.filter(r => r.is_master).map(r => ({
    unit_no: r.unit_no, unit_name: r.unit_name, children: [],
  }));
  const byNo = Object.fromEntries(masters.map(m => [m.unit_no, m]));
  rows.filter(r => !r.is_master).forEach(r => {
    byNo[r.master_unit]?.children.push({ unit_no: r.unit_no, unit_name: r.unit_name });
  });
  return masters;
}

// Group info for a review's unit — used to show the group and to flag a unit
// that is no longer a master in PIMS (e.g. moved under another master later)
async function getUnitGroup(jobNo, unitNo) {
  const { rows } = await pool.query(
    `SELECT unit_no, unit_name, master_unit, is_master
     FROM pims_units
     WHERE upper(job_no) = upper($1)
       AND (upper(unit_no) = upper($2)
            OR master_unit = (SELECT master_unit FROM pims_units
                              WHERE upper(job_no) = upper($1) AND upper(unit_no) = upper($2)))`,
    [jobNo, unitNo]
  );
  const self = rows.find(r => r.unit_no.toUpperCase() === String(unitNo).toUpperCase());
  if (!self) return { found: false, isMaster: false, masterUnit: null, unitName: null, children: [] };
  return {
    found: true,
    isMaster: self.is_master,
    masterUnit: self.master_unit,
    unitName: self.unit_name,
    children: self.is_master
      ? rows.filter(r => !r.is_master).map(r => ({ unit_no: r.unit_no, unit_name: r.unit_name }))
      : [],
  };
}

async function getStages() {
  const { rows } = await pool.query(
    `SELECT DISTINCT stage_name FROM stage_prerequisites_master ORDER BY stage_name`
  );
  return rows.map(r => r.stage_name);
}

// Returns an error message, or null when job / unit / stage are all valid
async function validateInitiation(jobNo, unitNo, stage) {
  const { rows: job } = await pool.query(
    `SELECT 1 FROM pims_projects WHERE upper(job_no) = upper($1)`, [jobNo]
  );
  if (!job.length) return `Job ${jobNo} is not an active job in PIMS.`;

  const group = await getUnitGroup(jobNo, unitNo);
  if (!group.found) return `Unit ${unitNo} is not an active unit of job ${jobNo} in PIMS.`;
  if (!group.isMaster) return `Unit ${unitNo} belongs to master unit ${group.masterUnit} — initiate the review on ${group.masterUnit}.`;

  const stages = await getStages();
  if (!stages.includes(stage)) return `Stage must be one of: ${stages.join(", ")}.`;
  return null;
}

// Master units (job → [unit_no]) where the user is GL / LE for their own department —
// from PIMS GL / SGL, employee level, or an LE assignment. PEM: null (= everything).
async function getLeadScope(user) {
  if (String(user?.department || "").toLowerCase() === "pem") return null;
  const { rows } = await pool.query(
    `SELECT DISTINCT job_no, unit_no FROM effective_assignments
     WHERE UPPER(employee_id) = UPPER($1) AND role IN ('GL', 'LE')
       AND LOWER(department) = LOWER($2)`,
    [user.employeeId, user.department || ""]
  );
  const scope = {};
  rows.forEach((r) => (scope[r.job_no] ||= new Set()).add(r.unit_no));
  return scope;
}

module.exports = { getJobs, getMasterUnits, getUnitGroup, getStages, validateInitiation, getLeadScope };
