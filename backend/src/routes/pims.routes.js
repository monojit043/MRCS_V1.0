// Live PIMS lookups for MRCS forms (jobs, master units, stages) — read from PC-2.
const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth.middleware");
const pims = require("../services/pimsLookup");

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    console.error("PIMS lookup:", err.message);
    res.status(503).json({ message: "PIMS (PC-2) is unreachable. Please try again shortly." });
  }
};

// ?lead=1 → only jobs / master units where the caller is GL / LE for their department
// (used by the department internal-review form; PEM sees everything)

// GET /api/pims/jobs → [{ job_no, job_name }]
router.get("/jobs", authenticateToken, wrap(async (req) => {
  let jobs = await pims.getJobs();
  if (req.query.lead) {
    const scope = await pims.getLeadScope(req.user);
    if (scope) jobs = jobs.filter((j) => scope[j.job_no]);
  }
  return { jobs };
}));

// GET /api/pims/master-units?jobNo= → [{ unit_no, unit_name, children: [...] }]
router.get("/master-units", authenticateToken, wrap(async (req) => {
  if (!req.query.jobNo) return { units: [] };
  let units = await pims.getMasterUnits(req.query.jobNo);
  if (req.query.lead) {
    const scope = await pims.getLeadScope(req.user);
    if (scope) units = units.filter((u) => scope[req.query.jobNo]?.has(u.unit_no));
  }
  return { units };
}));

// GET /api/pims/unit-group?jobNo=&unitNo= → { found, isMaster, masterUnit, unitName, children }
router.get("/unit-group", authenticateToken, wrap(async (req) =>
  pims.getUnitGroup(req.query.jobNo || "", req.query.unitNo || "")));

// GET /api/pims/stages → ["30%", "60%", "90%"]
router.get("/stages", authenticateToken, wrap(async () => ({ stages: await pims.getStages() })));

module.exports = router;
