const express = require("express");
const router  = express.Router();
const pool    = require("../data/db");
const { authenticateToken, authorize } = require("../middleware/auth.middleware");
// Roles are checked on the review being acted on (job/unit/stage, own department) —
// req.user.role is the highest role across ALL reviews and only gates pages coarsely.
const {
  RANK, isPEM, highestRoleOnReview, hasReviewRole, reviewOfTag,
  requireReviewRole, requireFolderReviewRole,
} = require("../services/reviewAccess");
// Internal reviews can be created directly on a PIMS job / master unit / stage
const { validateInitiation, getStages } = require("../services/pimsLookup");

/* ── Upload dependencies ── */
const fs       = require("fs");
const path     = require("path");
const multer   = require("multer");
const { v4: uuidv4 }     = require("uuid");
const parseXmlFile        = require("../services/xmlParser");
const validateFolder      = require("../services/folderValidator");
const parseHtmlForImages  = require("../services/htmlParser");
const { loadZones, detectZone } = require("../services/zoneDetector");

/* ── Auth helper ── */
// Any department's GL/LE can manage internal reviews — not just Piping.
// Each department's internal review is isolated from every other
// department's (same job/unit/stage, separate model_review_initiations row
// per department), so every route below scopes its initiation lookups by
// the caller's own department rather than just job/unit/stage.
// NOTE: this is only a coarse gate on the GLOBAL role — every route using it also
// checks the caller's role on the specific review (see services/reviewAccess.js).
function requireDeptGLorLE(req, res, next) {
  const role = req.user?.role;
  if (!["GL", "LE"].includes(role)) {
    return res.status(403).json({ message: "Access denied: GL or LE only" });
  }
  next();
}

/* ── Multer for internal uploads ── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../../uploads/temp", req.uploadId)),
  filename:    (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

const prepareUploadFolder = (req, res, next) => {
  req.uploadId = uuidv4();
  fs.mkdirSync(path.join(__dirname, "../../uploads/temp", req.uploadId), { recursive: true });
  next();
};

/* ══════════════════════════════════════════════════════════════
   DASHBOARD & INITIATION
══════════════════════════════════════════════════════════════ */

/* GET /api/internal/reviews — dashboard cards with tag stats */
router.get("/reviews", authenticateToken, async (req, res) => {
  const employeeId   = req.user.employeeId;
  const dept         = (req.user.department || "").toLowerCase();
  const pem          = isPEM(req.user);

  try {
    let reviews;
    if (pem) {
      const r = await pool.query(
        `SELECT id, job_no, unit_no, stage, description, review_date_from, review_date_to, created_at
         FROM model_review_initiations
         WHERE UPPER(review_type) = 'INTERNAL' AND LOWER(department) = $1
         ORDER BY created_at DESC`,
        [dept]
      );
      reviews = r.rows;
    } else {
      const r = await pool.query(
        `SELECT DISTINCT mri.id, mri.job_no, mri.unit_no, mri.stage,
                mri.description, mri.review_date_from, mri.review_date_to, mri.created_at
         FROM model_review_initiations mri
         JOIN effective_assignments ua
           ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
          AND (ua.stage = mri.stage OR ua.stage IS NULL)
          AND LOWER(ua.department) = LOWER(mri.department)
         WHERE ua.employee_id = $1 AND UPPER(mri.review_type) = 'INTERNAL'
         ORDER BY mri.created_at DESC`,
        [employeeId]
      );
      reviews = r.rows;
    }

    const withStats = await Promise.all(reviews.map(async (rev) => {
      // GL / LE on THIS review see all its tags; others only their department's
      const myRole = await highestRoleOnReview(req.user,
        { jobNo: rev.job_no, unitNo: rev.unit_no, stage: rev.stage }, { sameDept: true });
      const isLead     = ["GL", "LE"].includes(myRole);
      const deptFilter = isLead ? "" : "AND LOWER(ta.department) = LOWER($2)";
      const params     = isLead ? [rev.id] : [rev.id, dept];

      const s = await pool.query(
        `SELECT COUNT(*)                                                    AS total,
                COUNT(*) FILTER (WHERE t.final_status = 'COMPLETED')       AS completed,
                COUNT(*) FILTER (WHERE ta.resolution_status = 'SUBMITTED') AS pending_approval
         FROM tag_assignments ta
         JOIN tags t             ON ta.tag_id   = t.id
         JOIN uploaded_folders uf ON t.folder_id = uf.id
         WHERE uf.initiation_id=$1 AND t.status='LOCKED' ${deptFilter}`,
        params
      );
      const row = s.rows[0] || {};
      return { ...rev,
        total:            parseInt(row.total            || 0),
        completed:        parseInt(row.completed        || 0),
        pending_approval: parseInt(row.pending_approval || 0),
      };
    }));

    res.json({ reviews: withStats });
  } catch (err) {
    console.error("Internal /reviews:", err);
    res.status(500).json({ message: "Failed to fetch internal reviews" });
  }
});

/* GET /api/internal/dropdown — internal reviews visible to the current user.
   A department's own GL/LE see all of THEIR department's internal reviews
   (they initiate them). Everyone else sees only reviews they are assigned to. */
router.get("/dropdown", authenticateToken, async (req, res) => {
  const employeeId   = req.user.employeeId;
  const dept         = (req.user.department || "").toLowerCase();

  try {
    let r;
    // PEM sees all of its department's internal reviews; everyone else (incl. GL / LE)
    // only the reviews they are assigned to.
    if (isPEM(req.user)) {
      r = await pool.query(
        `SELECT id, job_no, unit_no, stage
         FROM model_review_initiations
         WHERE UPPER(review_type) = 'INTERNAL' AND LOWER(department) = $1
         ORDER BY job_no, unit_no, stage`,
        [dept]
      );
    } else {
      r = await pool.query(
        `SELECT DISTINCT mri.id, mri.job_no, mri.unit_no, mri.stage
         FROM model_review_initiations mri
         JOIN effective_assignments ua
           ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
          AND (ua.stage = mri.stage OR ua.stage IS NULL)
          AND LOWER(ua.department) = LOWER(mri.department)
         WHERE ua.employee_id = $1 AND UPPER(mri.review_type) = 'INTERNAL'
         ORDER BY mri.job_no, mri.unit_no, mri.stage`,
        [employeeId]
      );
    }
    res.json({ options: r.rows });
  } catch (err) {
    console.error("Internal /dropdown:", err);
    res.status(500).json({ message: "Failed to fetch dropdown" });
  }
});

/* GET /api/internal/external-assigned-reviews — external reviews where this
   department's LE/GL is assigned. has_internal reflects whether THEIR OWN
   department already has an internal review for it, not any department's. */
router.get("/external-assigned-reviews", authenticateToken, requireDeptGLorLE, async (req, res) => {
  const employeeId = req.user.employeeId;
  const dept       = (req.user.department || "").toLowerCase();
  try {
    const r = await pool.query(
      `SELECT DISTINCT mri.id, mri.job_no, mri.unit_no, mri.stage, mri.description,
              mri.review_date_from, mri.review_date_to,
              EXISTS(
                SELECT 1 FROM model_review_initiations i2
                WHERE UPPER(i2.review_type) = 'INTERNAL'
                  AND UPPER(i2.job_no)  = UPPER(mri.job_no)
                  AND UPPER(i2.unit_no) = UPPER(mri.unit_no)
                  AND i2.stage = mri.stage
                  AND LOWER(i2.department) = $2
              ) AS has_internal
       FROM model_review_initiations mri
       JOIN effective_assignments ua
         ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
        AND (ua.stage = mri.stage OR ua.stage IS NULL)
       WHERE ua.employee_id = $1
         AND ua.role IN ('GL', 'LE') AND LOWER(ua.department) = $2   -- GL / LE on THIS review, own dept
         AND (UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)
       ORDER BY mri.job_no, mri.unit_no, mri.stage`,
      [employeeId, dept]
    );
    res.json({ reviews: r.rows });
  } catch (err) {
    console.error("Internal /external-assigned-reviews:", err);
    res.status(500).json({ message: "Failed to fetch assigned external reviews" });
  }
});

/* POST /api/internal/initiate — create this department's internal review.
   Two ways (decided 2026-10-18 — internal reviews no longer depend on PEM):
     • direct:        { jobNo, unitNo, stage }  — PIMS job, master unit, standard stage
     • from external: { externalReviewId }      — copies that review's job / unit / stage
   Either way the caller must be GL / LE on that job / unit / stage in their own
   department (GL comes live from PIMS or employee level; LE is assigned by a GL). */
router.post("/initiate", authenticateToken, requireDeptGLorLE, async (req, res) => {
  const { externalReviewId, fromDate, toDate, description } = req.body;
  const employeeId = req.user.employeeId;
  const department  = (req.user.department || "").toLowerCase();

  if (!externalReviewId) {
    const { jobNo, unitNo, stage } = req.body;
    if (!jobNo || !unitNo || !stage)
      return res.status(400).json({ message: "Select Job, Master Unit and Stage (or an external review)" });
    try {
      const invalid = await validateInitiation(jobNo, unitNo, stage);
      if (invalid) return res.status(400).json({ message: invalid });

      if (!(await hasReviewRole(req.user, { jobNo, unitNo, stage }, "LE", { sameDept: true })))
        return res.status(403).json({ message: `You are not GL / LE for ${department} on ${jobNo} / ${unitNo} / ${stage}` });

      const dup = await pool.query(
        `SELECT 1 FROM model_review_initiations
         WHERE UPPER(job_no)=$1 AND UPPER(unit_no)=$2 AND stage=$3 AND UPPER(review_type)='INTERNAL' AND LOWER(department)=$4`,
        [jobNo.toUpperCase(), unitNo.toUpperCase(), stage, department]
      );
      if (dup.rows.length > 0)
        return res.status(409).json({ message: `An internal review for ${department} already exists for ${jobNo} / ${unitNo} / ${stage}` });

      const result = await pool.query(
        `INSERT INTO model_review_initiations (job_no, unit_no, stage, description, review_type, department, review_date_from, review_date_to, created_by)
         VALUES ($1, $2, $3, $4, 'INTERNAL', $5, $6, $7, $8) RETURNING *`,
        [jobNo.toUpperCase(), unitNo.toUpperCase(), stage, description || null, department, fromDate || null, toDate || null, employeeId]
      );
      return res.status(201).json({ message: "Internal review initiated", initiation: result.rows[0] });
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ message: "An internal review for this Job / Unit / Stage already exists." });
      console.error("Internal /initiate (direct):", err);
      return res.status(500).json({ message: "Failed to initiate internal review" });
    }
  }

  try {
    /* Verify the external review exists and the user is GL / LE on it, in their own department */
    const extR = await pool.query(
      `SELECT DISTINCT mri.job_no, mri.unit_no, mri.stage
       FROM model_review_initiations mri
       JOIN effective_assignments ua
         ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
        AND (ua.stage = mri.stage OR ua.stage IS NULL)
       WHERE mri.id = $1 AND ua.employee_id = $2
         AND ua.role IN ('GL', 'LE') AND LOWER(ua.department) = $3
         AND (UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)`,
      [externalReviewId, employeeId, department]
    );
    if (extR.rows.length === 0)
      return res.status(404).json({ message: "External review not found, or you are not GL / LE on it for your department" });

    const { job_no, unit_no, stage } = extR.rows[0];

    const dup = await pool.query(
      `SELECT 1 FROM model_review_initiations
       WHERE UPPER(job_no)=$1 AND UPPER(unit_no)=$2 AND stage=$3 AND UPPER(review_type)='INTERNAL' AND LOWER(department)=$4`,
      [job_no.toUpperCase(), unit_no.toUpperCase(), stage, department]
    );
    if (dup.rows.length > 0)
      return res.status(409).json({ message: `An internal review for ${department} already exists for ${job_no} / ${unit_no} / ${stage}` });

    const result = await pool.query(
      `INSERT INTO model_review_initiations (job_no, unit_no, stage, description, review_type, department, review_date_from, review_date_to, created_by)
       VALUES ($1, $2, $3, $4, 'INTERNAL', $5, $6, $7, $8) RETURNING *`,
      [job_no, unit_no, stage, description || null, department, fromDate || null, toDate || null, employeeId]
    );
    res.status(201).json({ message: "Internal review initiated", initiation: result.rows[0] });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ message: "An internal review for this Job / Unit / Stage already exists." });
    console.error("Internal /initiate:", err);
    res.status(500).json({ message: "Failed to initiate internal review" });
  }
});

/* GET /api/internal/initiated — this department's internal reviews with user counts */
router.get("/initiated", authenticateToken, requireDeptGLorLE, async (req, res) => {
  const dept = (req.user.department || "").toLowerCase();
  try {
    // Only internal reviews where the caller is GL / LE on that review (PEM: all of its department's)
    const r = await pool.query(
      `SELECT mri.id, mri.job_no, mri.unit_no, mri.stage, mri.description, mri.created_at,
              COUNT(ua.employee_id) AS assigned_count
       FROM model_review_initiations mri
       LEFT JOIN user_assignments ua
         ON ua.job_no=mri.job_no AND ua.unit_no=mri.unit_no AND ua.stage=mri.stage
        AND LOWER(ua.department)=LOWER(mri.department)
       WHERE UPPER(mri.review_type)='INTERNAL' AND LOWER(mri.department)=$1
         AND ($2 OR EXISTS (
               SELECT 1 FROM effective_assignments me
               WHERE UPPER(me.employee_id) = UPPER($3)
                 AND me.job_no = mri.job_no AND me.unit_no = mri.unit_no
                 AND (me.stage = mri.stage OR me.stage IS NULL)
                 AND me.role IN ('GL', 'LE') AND LOWER(me.department) = $1))
       GROUP BY mri.id ORDER BY mri.created_at DESC`,
      [dept, isPEM(req.user), req.user.employeeId]
    );
    res.json({ reviews: r.rows });
  } catch (err) {
    console.error("Internal /initiated:", err);
    res.status(500).json({ message: "Failed to fetch" });
  }
});

/* ══════════════════════════════════════════════════════════════
   USER ASSIGNMENT
══════════════════════════════════════════════════════════════ */

/* GET /api/internal/assigned-users — assignees under THIS department's
   internal review. Scoped by ua.department since user_assignments has no
   direct link to a specific initiation — the assignee's department is
   treated as which department's internal review they belong to. */
router.get("/assigned-users", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const dept = (req.user.department || "").toLowerCase();
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });
  try {
    // Stored team (LE / JE given inside MRCS) — removable by someone above them
    const r = await pool.query(
      `SELECT ua.employee_id, m.employee_name AS full_name, ua.role, ua.department,
              ua.assigned_by, ua.assigned_at
       FROM user_assignments ua
       JOIN master_employees m ON m.employee_id = ua.employee_id
       WHERE ua.job_no=$1 AND ua.unit_no=$2 AND ua.stage=$3 AND LOWER(ua.department)=$4
       ORDER BY ua.department, ua.role`,
      [jobNo.toUpperCase(), unitNo.toUpperCase(), stage, dept]
    );
    const myRole = await highestRoleOnReview(req.user, { jobNo, unitNo, stage }, { sameDept: true });
    const users = r.rows.map(u => ({
      ...u, source: "assigned",
      canRemove: isPEM(req.user) || RANK[u.role] < RANK[myRole],
    }));

    // GLs computed live from PIMS (GL / SGL roles) — shown read-only; they change in PIMS
    const pims = await pool.query(
      `SELECT DISTINCT e.employee_id, m.employee_name AS full_name, 'GL' AS role, e.department
       FROM effective_assignments e
       JOIN master_employees m ON m.employee_id = e.employee_id
       WHERE e.source = 'pims' AND e.job_no=$1 AND e.unit_no=$2 AND LOWER(e.department)=$3
       ORDER BY 2`,
      [jobNo.toUpperCase(), unitNo.toUpperCase(), dept]
    );
    pims.rows.forEach(g => users.unshift({ ...g, source: "pims", canRemove: false }));

    // GLs by employee level >= 17 apply to every job — only the count is shown
    const lvl = await pool.query(
      `SELECT count(DISTINCT employee_id)::int AS n FROM effective_assignments
       WHERE source = 'level' AND job_no=$1 AND unit_no=$2 AND LOWER(department)=$3`,
      [jobNo.toUpperCase(), unitNo.toUpperCase(), dept]
    );

    res.json({ users, levelGlCount: lvl.rows[0].n, myRole });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch" });
  }
});

/* POST /api/internal/assign — can only assign people into YOUR OWN
   department's internal review, as YOUR OWN department.
   Caller must be GL / LE on THIS review. Allowed roles to give:
   GL on the review → JE or LE;  LE on the review → JE only.
   The person must be from the caller's own department (employee master, PC-2). */
router.post("/assign", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { employeeId, role, jobNo, unitNo, stage } = req.body;
  const cleanDept = (req.user.department || "").toLowerCase();
  if (!employeeId || !role || !jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "All fields are required" });

  const cleanJob  = jobNo.toUpperCase();
  const cleanUnit = unitNo.toUpperCase();

  try {
    const myRole  = await highestRoleOnReview(req.user, { jobNo: cleanJob, unitNo: cleanUnit, stage }, { sameDept: true });
    const allowed = myRole === "GL" ? ["JE", "LE"] : ["JE"];
    if (!allowed.includes(role)) {
      return res.status(403).json({ message: `As ${myRole} on this review you can only assign: ${allowed.join(", ")}` });
    }

    const emp = await pool.query(
      `SELECT department FROM master_employees WHERE UPPER(employee_id) = UPPER($1)`, [employeeId]
    );
    if (!emp.rows.length) {
      return res.status(400).json({ message: `Employee ${employeeId} is not in the employee master (PC-2), or is inactive / has no department` });
    }
    if (String(emp.rows[0].department).toLowerCase() !== cleanDept) {
      return res.status(403).json({ message: `Employee ${employeeId} is not in your department (${cleanDept})` });
    }

    const rev = await pool.query(
      `SELECT 1 FROM model_review_initiations
       WHERE UPPER(job_no)=$1 AND UPPER(unit_no)=$2 AND stage=$3 AND UPPER(review_type)='INTERNAL' AND LOWER(department)=$4`,
      [cleanJob, cleanUnit, stage, cleanDept]
    );
    if (rev.rows.length === 0) return res.status(404).json({ message: "Internal review not found" });

    const dup = await pool.query(
      `SELECT 1 FROM user_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND stage=$4 AND department=$5`,
      [employeeId, cleanJob, cleanUnit, stage, cleanDept]
    );
    if (dup.rows.length > 0) return res.status(409).json({ message: "Already assigned" });

    await pool.query(
      `INSERT INTO user_assignments (employee_id,role,department,job_no,unit_no,stage,assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [employeeId, role, emp.rows[0].department, cleanJob, cleanUnit, stage, req.user.employeeId]
    );
    res.json({ message: "User assigned" });
  } catch (err) {
    res.status(500).json({ message: "Failed to assign user" });
  }
});

/* ── Copy team forward between stages ───────────────────────────────────────
   Assignments are stored per stage, so a 30% team does not apply at 60%.
   These copy the STORED LE / JE of an earlier stage into a later stage's team
   (same job / master unit / department). GL is never copied — it comes from
   PIMS / level and already applies to every stage. Each stage keeps its own team. */

const stageNum = (s) => parseFloat(String(s)) || 0;   // "30%" → 30

/* GET /api/internal/team/copy-sources?jobNo=&unitNo=&stage=
   Earlier stages of this job / unit that have a stored team in the caller's department */
router.get("/team/copy-sources", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const dept = (req.user.department || "").toLowerCase();
  try {
    const r = await pool.query(
      `SELECT stage, count(*)::int AS people,
              count(*) FILTER (WHERE role = 'LE')::int AS le,
              count(*) FILTER (WHERE role = 'JE')::int AS je
       FROM user_assignments
       WHERE job_no = $1 AND unit_no = $2 AND LOWER(department) = $3
         AND stage IS NOT NULL AND stage <> $4 AND role IN ('LE', 'JE')
       GROUP BY stage`,
      [jobNo.toUpperCase(), unitNo.toUpperCase(), dept, stage]
    );
    const sources = r.rows
      .filter(s => stageNum(s.stage) < stageNum(stage))
      .sort((a, b) => stageNum(b.stage) - stageNum(a.stage));   // nearest earlier stage first
    res.json({ sources });
  } catch (err) {
    console.error("Internal /team/copy-sources:", err);
    res.status(500).json({ message: "Failed to load earlier teams" });
  }
});

/* POST /api/internal/team/copy-forward  { jobNo, unitNo, stage (target), fromStage }
   Caller must be GL / LE on the TARGET stage (own department); the target must have
   an internal review. LE may only copy JE (same rule as adding). Skips people who are
   already on the target stage, or who are no longer active / in this department. */
router.post("/team/copy-forward", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { jobNo, unitNo, stage, fromStage } = req.body;
  const dept = (req.user.department || "").toLowerCase();
  if (!fromStage) return res.status(400).json({ message: "fromStage is required" });
  const job = jobNo.toUpperCase(), unit = unitNo.toUpperCase();

  try {
    const stages = await getStages();
    if (!stages.includes(stage) || !stages.includes(fromStage))
      return res.status(400).json({ message: `Stages must be one of: ${stages.join(", ")}` });
    if (stageNum(fromStage) >= stageNum(stage))
      return res.status(400).json({ message: "You can only copy a team from an earlier stage" });

    const rev = await pool.query(
      `SELECT 1 FROM model_review_initiations
       WHERE UPPER(job_no)=$1 AND UPPER(unit_no)=$2 AND stage=$3 AND UPPER(review_type)='INTERNAL' AND LOWER(department)=$4`,
      [job, unit, stage, dept]
    );
    if (!rev.rows.length)
      return res.status(404).json({ message: `Create the ${stage} internal review for ${job} / ${unit} first` });

    const myRole  = await highestRoleOnReview(req.user, { jobNo: job, unitNo: unit, stage }, { sameDept: true });
    const allowed = isPEM(req.user) || myRole === "GL" ? ["LE", "JE"] : ["JE"];

    const src = await pool.query(
      `SELECT ua.employee_id, ua.role, m.employee_id AS active_id, m.department AS home_dept
       FROM user_assignments ua
       LEFT JOIN master_employees m ON UPPER(m.employee_id) = UPPER(ua.employee_id)
       WHERE ua.job_no = $1 AND ua.unit_no = $2 AND ua.stage = $3 AND LOWER(ua.department) = $4
         AND ua.role IN ('LE', 'JE')
       ORDER BY CASE ua.role WHEN 'LE' THEN 1 ELSE 2 END, ua.employee_id`,
      [job, unit, fromStage, dept]
    );
    if (!src.rows.length)
      return res.status(404).json({ message: `No LE / JE team stored for ${job} / ${unit} / ${fromStage}` });

    const copied = [], skipped = [];
    for (const p of src.rows) {
      if (!allowed.includes(p.role)) {
        skipped.push({ employeeId: p.employee_id, role: p.role, reason: `As ${myRole} you can only copy JE` }); continue;
      }
      if (!p.active_id || String(p.home_dept).toLowerCase() !== dept) {
        skipped.push({ employeeId: p.employee_id, role: p.role, reason: "No longer active, or no longer in this department" }); continue;
      }
      const already = await pool.query(
        `SELECT role FROM user_assignments
         WHERE UPPER(employee_id)=UPPER($1) AND job_no=$2 AND unit_no=$3 AND stage=$4 AND LOWER(department)=$5`,
        [p.employee_id, job, unit, stage, dept]
      );
      if (already.rows.length) {
        skipped.push({ employeeId: p.employee_id, role: p.role, reason: `Already ${already.rows[0].role} at ${stage}` }); continue;
      }
      await pool.query(
        `INSERT INTO user_assignments (employee_id, role, department, job_no, unit_no, stage, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.active_id, p.role, p.home_dept, job, unit, stage, req.user.employeeId]
      );
      copied.push({ employeeId: p.active_id, role: p.role });
    }

    res.json({
      message: `Copied ${copied.length} of ${src.rows.length} from ${fromStage} to ${stage}` + (skipped.length ? ` (${skipped.length} skipped)` : ""),
      copied, skipped,
    });
  } catch (err) {
    console.error("Internal /team/copy-forward:", err);
    res.status(500).json({ message: "Failed to copy team" });
  }
});

/* DELETE /api/internal/assign — can only remove assignments from YOUR OWN
   department's internal review, and only people BELOW your role on this review
   (LE removes JE; GL removes JE / LE). PEM-assigned GL / LE can't be removed here. */
router.delete("/assign", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { employeeId, jobNo, unitNo, stage } = req.body;
  const department = (req.user.department || "").toLowerCase();
  try {
    if (!isPEM(req.user)) {
      const myRole = await highestRoleOnReview(req.user, { jobNo, unitNo, stage }, { sameDept: true });
      const target = await pool.query(
        `SELECT role FROM user_assignments
         WHERE UPPER(employee_id)=UPPER($1) AND job_no=$2 AND unit_no=$3 AND stage=$4 AND LOWER(department)=$5`,
        [employeeId, jobNo.toUpperCase(), unitNo.toUpperCase(), stage, department]
      );
      if (target.rows.some(t => RANK[t.role] >= RANK[myRole])) {
        return res.status(403).json({ message: `As ${myRole} on this review you can only remove people below your role` });
      }
    }

    const del = await pool.query(
      `DELETE FROM user_assignments
       WHERE UPPER(employee_id)=UPPER($1) AND job_no=$2 AND unit_no=$3 AND stage=$4 AND LOWER(department)=$5`,
      [employeeId, jobNo.toUpperCase(), unitNo.toUpperCase(), stage, department]
    );
    if (!del.rowCount) {
      // e.g. a GL that comes from PIMS / employee level — nothing stored here to remove
      return res.status(404).json({ message: `${employeeId} has no assignment here that can be removed (GL from PIMS or level is managed outside MRCS)` });
    }
    res.json({ message: "Assignment removed" });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove assignment" });
  }
});

/* ══════════════════════════════════════════════════════════════
   UPLOAD & FINALIZATION  (any department's GL/LE, own department only)
══════════════════════════════════════════════════════════════ */

/* POST /api/internal/upload-folder */
router.post("/upload-folder", authenticateToken, requireDeptGLorLE,
  prepareUploadFolder, upload.any(),
  // jobNo / unitNo / stage arrive in the multipart body, so the per-review check runs
  // after multer; on refusal the temp upload is removed.
  async (req, res, next) => {
    const { jobNo, unitNo, stage } = req.body;
    try {
      if (jobNo && unitNo && stage &&
          await hasReviewRole(req.user, { jobNo, unitNo, stage }, "LE", { sameDept: true })) return next();
    } catch (err) {
      console.error("upload-folder access check:", err.message);
    }
    fs.rmSync(path.join(__dirname, "../../uploads/temp", req.uploadId), { recursive: true, force: true });
    return res.status(403).json({ message: `Access denied: you are not LE or above on ${jobNo} / ${unitNo} / ${stage}` });
  },
  async (req, res) => {
    const validation = validateFolder(req.files);
    if (!validation.isValid)
      return res.status(400).json({ message: "Folder validation failed", errors: validation.errors });

    try {
      const uploadFolderPath = path.join(__dirname, "../../uploads/temp", req.uploadId);
      const { model_file, tags } = await parseXmlFile(uploadFolderPath);
      const htmlMapping = parseHtmlForImages(uploadFolderPath);

      const { jobNo, unitNo, stage, originalFolderName } = req.body;
      if (!jobNo || !unitNo || !stage)
        return res.status(400).json({ message: "jobNo, unitNo and stage are required" });

      /* Resolve the internal initiation this upload belongs to — scoped to
         the caller's own department, since every department now has its own. */
      const dept = (req.user.department || "").toLowerCase();
      const initiation = await pool.query(
        `SELECT id FROM model_review_initiations WHERE job_no=$1 AND unit_no=$2 AND stage=$3 AND UPPER(review_type)='INTERNAL' AND LOWER(department)=$4`,
        [jobNo, unitNo, stage, dept]
      );
      if (initiation.rows.length === 0) {
        return res.status(400).json({ message: "No internal review has been initiated for this job/unit/stage by your department." });
      }
      const initiationId = initiation.rows[0].id;

      const zones = await loadZones(initiationId);

      const folderInsert = await pool.query(
        `INSERT INTO uploaded_folders (initiation_id,folder_name,uploaded_by,model_file) VALUES ($1,$2,$3,$4) RETURNING id`,
        [initiationId, originalFolderName, req.user.employeeId, model_file]
      );
      const folderId = folderInsert.rows[0].id;

      for (const tag of tags) {
        const zone = detectZone(tag.tag_x, tag.tag_y, zones) || null;
        const imageFileName = htmlMapping[tag.view_name] || null;
        const originalSnapPath = imageFileName
          ? path.join("uploads/permanent", jobNo, unitNo, stage, folderId.toString(), imageFileName).replace(/\\/g, "/")
          : null;

        await pool.query(
          `INSERT INTO tags (folder_id,tag_no,description,tag_date,view_name,tag_x,tag_y,zone,status,original_snap_path)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NEW',$9)`,
          [folderId, tag.tag_no, tag.description, tag.tag_date, tag.view_name,
           tag.tag_x || null, tag.tag_y || null, zone, originalSnapPath]
        );
      }

      const tempPath      = path.join(__dirname, "../../uploads/temp", req.uploadId);
      const permanentPath = path.join(__dirname, "../../uploads/permanent", jobNo, unitNo, stage, folderId.toString());
      fs.mkdirSync(permanentPath, { recursive: true });
      for (const file of fs.readdirSync(tempPath))
        fs.renameSync(path.join(tempPath, file), path.join(permanentPath, file));
      fs.rmSync(tempPath, { recursive: true, force: true });

      res.json({ message: "Folder uploaded successfully", initiationId, folderId, tagCount: tags.length });
    } catch (err) {
      console.error("Internal upload error:", err);
      res.status(500).json({ message: "Upload processing failed", error: err.message });
    }
  }
);

/* GET /api/internal/tags — this department's GL/LE sees their own
   department's internal review tags; used in upload panel */
router.get("/tags", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const dept = (req.user.department || "").toLowerCase();
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });
  try {
    const result = await pool.query(
      `SELECT t.id, t.tag_no, t.description, t.tag_date, t.view_name, t.status, t.original_snap_path,
              STRING_AGG(ta.department, ',') AS department
       FROM tags t
       JOIN uploaded_folders uf ON t.folder_id = uf.id
       JOIN model_review_initiations mri ON uf.initiation_id = mri.id
       LEFT JOIN tag_assignments ta ON ta.tag_id = t.id
       WHERE mri.job_no=$1 AND mri.unit_no=$2 AND mri.stage=$3 AND UPPER(mri.review_type)='INTERNAL' AND LOWER(mri.department)=$4
       GROUP BY t.id, t.tag_no, t.description, t.tag_date, t.view_name, t.status, t.original_snap_path
       ORDER BY t.tag_date ASC`,
      [jobNo, unitNo, stage, dept]
    );
    res.json({ count: result.rows.length, tags: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch tags", error: err.message });
  }
});

/* POST /api/internal/tags/lock — only the tag's OWN department's GL/LE may
   lock it, so one department can't reach into another's internal review. */
router.post("/tags/lock", authenticateToken, requireDeptGLorLE, async (req, res) => {
  const { updates, lockedBy } = req.body;
  const dept = (req.user.department || "").toLowerCase();
  if (!updates || !Array.isArray(updates))
    return res.status(400).json({ message: "Invalid updates payload" });
  try {
    let skipped = 0;
    for (const item of updates) {
      const { tagId, departments } = item;
      if (!departments || !Array.isArray(departments)) continue;

      // Caller must be GL / LE on the review this tag belongs to
      const review = await reviewOfTag(tagId);
      if (!review || !(await hasReviewRole(req.user, review, "LE", { sameDept: true }))) { skipped++; continue; }

      const ownerCheck = await pool.query(
        `SELECT 1 FROM tags t
         JOIN uploaded_folders uf ON t.folder_id = uf.id
         JOIN model_review_initiations mri ON uf.initiation_id = mri.id
         WHERE t.id = $1 AND UPPER(mri.review_type) = 'INTERNAL' AND LOWER(mri.department) = $2`,
        [tagId, dept]
      );
      if (ownerCheck.rows.length === 0) continue; // not this department's tag — skip silently

      await pool.query(
        `UPDATE tags SET status='LOCKED', locked_by=$1, locked_at=CURRENT_TIMESTAMP WHERE id=$2 AND status='NEW'`,
        [lockedBy || "Unknown", tagId]
      );
      await pool.query(`DELETE FROM tag_assignments WHERE tag_id=$1`, [tagId]);
      for (const assignDept of departments)
        await pool.query(
          `INSERT INTO tag_assignments (tag_id,department,resolution_status) VALUES ($1,$2,'NOT_STARTED')`,
          [tagId, assignDept.toLowerCase()]
        );
    }
    res.json({
      message: skipped ? `Tags locked; ${skipped} skipped (not GL / LE on their review)` : "Tags locked successfully",
      skipped,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to lock tags", error: err.message });
  }
});

/* GET /api/internal/folders */
router.get("/folders", authenticateToken, async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  const dept         = (req.user?.department || "").toLowerCase();
  // Role on THIS review (own department), not the global highest role
  const myRole       = await highestRoleOnReview(req.user, { jobNo, unitNo, stage }, { sameDept: true });
  const isDeptGLorLE = ["GL", "LE"].includes(myRole);

  if (!isDeptGLorLE) {
    const ac = await pool.query(
      `SELECT 1 FROM effective_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND (stage=$4 OR stage IS NULL) LIMIT 1`,
      [req.user.employeeId, jobNo, unitNo, stage]
    );
    if (ac.rows.length === 0) return res.status(403).json({ message: "Not assigned" });
  }

  // GL/LE see only their own department's internal review; an assigned
  // non-GL/LE (JE) sees whichever department's review they were put on.
  const deptClause = isDeptGLorLE ? "AND LOWER(mri.department) = $4" : "";
  const params      = isDeptGLorLE ? [jobNo, unitNo, stage, dept] : [jobNo, unitNo, stage];

  try {
    const result = await pool.query(
      `SELECT uf.id, uf.folder_name, uf.model_file, uf.uploaded_at,
              mri.job_no, mri.unit_no, mri.stage AS review_stage,
              COALESCE(me.employee_name, uf.uploaded_by) AS uploaded_by_name,
              COUNT(t.id) AS tag_count,
              MIN(t.tag_date) AS model_review_date
       FROM uploaded_folders uf
       JOIN model_review_initiations mri ON uf.initiation_id = mri.id
       LEFT JOIN tags t       ON t.folder_id  = uf.id
       LEFT JOIN master_employees me ON me.employee_id = uf.uploaded_by
       WHERE mri.job_no=$1 AND mri.unit_no=$2 AND mri.stage=$3 AND UPPER(mri.review_type)='INTERNAL' ${deptClause}
       GROUP BY uf.id, mri.job_no, mri.unit_no, mri.stage, me.employee_name, uf.uploaded_by
       ORDER BY uf.uploaded_at DESC`,
      params
    );
    res.json({ count: result.rows.length, folders: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch folders", error: err.message });
  }
});

/* DELETE /api/internal/folders/:folderId — only the owning department's GL/LE may delete it */
router.delete("/folders/:folderId", authenticateToken, requireFolderReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { folderId } = req.params;
  const dept = (req.user.department || "").toLowerCase();
  try {
    const r = await pool.query(
      `SELECT uf.id, uf.storage_path FROM uploaded_folders uf
       JOIN model_review_initiations mri ON uf.initiation_id = mri.id
       WHERE uf.id=$1 AND UPPER(mri.review_type)='INTERNAL' AND LOWER(mri.department)=$2`,
      [folderId, dept]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Folder not found" });

    await pool.query(`DELETE FROM uploaded_folders WHERE id=$1`, [folderId]);

    const sp = r.rows[0].storage_path;
    if (sp && fs.existsSync(sp)) fs.rmSync(sp, { recursive: true, force: true });

    res.json({ message: "Folder deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete folder", error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   JOB ENGINEER (reads)
══════════════════════════════════════════════════════════════ */

/* GET /api/internal/job-engineer-tags */
router.get("/job-engineer-tags", authenticateToken, requireReviewRole("JE", { sameDept: true }), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const employeeId = req.user.employeeId;
  const department = req.user.department;

  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  try {
    const ac = await pool.query(
      `SELECT 1 FROM effective_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND department=$4 AND role IN ('JE','LE','GL')`,
      [employeeId, jobNo, unitNo, department]
    );
    if (ac.rows.length === 0) return res.status(403).json({ message: "No access" });

    const result = await pool.query(
      `SELECT t.id, t.tag_no, t.description, t.tag_date, t.view_name, t.zone, uf.model_file,
              ta.department, ta.resolution, ta.resolution_status, ta.resolved_snap_path,
              t.original_snap_path
       FROM tags t
       JOIN uploaded_folders uf ON t.folder_id = uf.id
       JOIN model_review_initiations mri ON uf.initiation_id = mri.id
       JOIN tag_assignments ta  ON ta.tag_id   = t.id
       WHERE mri.job_no=$1 AND mri.unit_no=$2 AND mri.stage=$3
         AND UPPER(mri.review_type)='INTERNAL' AND LOWER(mri.department)=LOWER($4)
         AND t.status='LOCKED' AND ta.department=$4
       ORDER BY t.tag_no ASC`,
      [jobNo, unitNo, stage, department]
    );
    res.json({ count: result.rows.length, tags: result.rows });
  } catch (err) {
    console.error("Internal JE tags:", err);
    res.status(500).json({ message: "Failed to fetch JE tags" });
  }
});

/* ══════════════════════════════════════════════════════════════
   LEAD ENGINEER (reads)
══════════════════════════════════════════════════════════════ */

/* GET /api/internal/lead-review-tags */
router.get("/lead-review-tags", authenticateToken, requireReviewRole("LE"), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const employeeId = req.user.employeeId;

  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  try {
    const ac = await pool.query(
      `SELECT department FROM effective_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND role IN ('LE','GL')`,
      [employeeId, jobNo, unitNo]
    );
    if (ac.rows.length === 0) return res.status(403).json({ message: "No LE/GL access" });
    const department = ac.rows[0].department;

    const result = await pool.query(
      `SELECT t.id, t.tag_no, t.description, t.tag_date, t.view_name, t.zone, uf.model_file,
              ta.department, ta.resolution, ta.resolution_status, ta.resolved_snap_path,
              t.original_snap_path
       FROM tags t
       JOIN uploaded_folders uf ON t.folder_id = uf.id
       JOIN model_review_initiations mri ON uf.initiation_id = mri.id
       JOIN tag_assignments ta  ON ta.tag_id   = t.id
       WHERE mri.job_no=$1 AND mri.unit_no=$2 AND mri.stage=$3
         AND UPPER(mri.review_type)='INTERNAL' AND LOWER(mri.department)=LOWER($4)
         AND ta.department=$4
       ORDER BY t.tag_no ASC`,
      [jobNo, unitNo, stage, department]
    );
    res.json({ count: result.rows.length, tags: result.rows, department });
  } catch (err) {
    console.error("Internal LE tags:", err);
    res.status(500).json({ message: "Failed to fetch LE tags" });
  }
});

/* GET /api/internal/lead-review-summary */
router.get("/lead-review-summary", authenticateToken, requireReviewRole("LE"), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const employeeId = req.user.employeeId;

  try {
    const ac = await pool.query(
      `SELECT department FROM effective_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND role IN ('LE','GL')`,
      [employeeId, jobNo, unitNo]
    );
    if (ac.rows.length === 0) return res.status(403).json({ message: "No LE/GL access" });
    const department = ac.rows[0].department;

    const result = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE ta.resolution_status='SUBMITTED') AS pending_approval,
              COUNT(*) FILTER (WHERE ta.resolution_status='APPROVED')  AS approved,
              COUNT(*) FILTER (WHERE ta.resolution_status='REJECTED')  AS rejected,
              COUNT(*) FILTER (WHERE ta.resolution_status='SAVED')     AS draft,
              COUNT(*) FILTER (WHERE ta.resolution_status IS NULL OR ta.resolution_status='NOT_STARTED') AS not_started
       FROM tags t
       JOIN uploaded_folders uf ON t.folder_id = uf.id
       JOIN model_review_initiations mri ON uf.initiation_id = mri.id
       JOIN tag_assignments ta  ON ta.tag_id   = t.id
       WHERE mri.job_no=$1 AND mri.unit_no=$2 AND mri.stage=$3
         AND UPPER(mri.review_type)='INTERNAL' AND LOWER(mri.department)=LOWER($4) AND ta.department=$4`,
      [jobNo, unitNo, stage, department]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch summary" });
  }
});

/* ══════════════════════════════════════════════════════════════
   ADMIN — tag status & dept breakdown
══════════════════════════════════════════════════════════════ */

/* GET /api/internal/admin/tag-status */
router.get("/admin/tag-status", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const dept = (req.user.department || "").toLowerCase();
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  const base = `
    FROM tags t
    JOIN uploaded_folders uf ON t.folder_id = uf.id
    JOIN model_review_initiations mri ON uf.initiation_id = mri.id
    JOIN tag_assignments ta  ON ta.tag_id   = t.id
    WHERE mri.job_no=$1 AND mri.unit_no=$2 AND mri.stage=$3
      AND UPPER(mri.review_type)='INTERNAL' AND LOWER(mri.department)=$4`;
  const params = [jobNo, unitNo, stage, dept];

  try {
    const [sum, depts, tags] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ta.resolution_status='APPROVED')  AS approved,
                COUNT(*) FILTER (WHERE ta.resolution_status='SUBMITTED') AS pending_approval,
                COUNT(*) FILTER (WHERE ta.resolution_status='REJECTED')  AS rejected,
                COUNT(*) FILTER (WHERE ta.resolution_status='SAVED')     AS draft,
                COUNT(*) FILTER (WHERE ta.resolution_status IS NULL OR ta.resolution_status='NOT_STARTED') AS not_started
         ${base}`, params),

      pool.query(
        `SELECT ta.department,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ta.resolution_status='APPROVED')  AS approved,
                COUNT(*) FILTER (WHERE ta.resolution_status='SUBMITTED') AS pending_approval,
                COUNT(*) FILTER (WHERE ta.resolution_status='REJECTED')  AS rejected,
                COUNT(*) FILTER (WHERE ta.resolution_status='SAVED')     AS draft,
                COUNT(*) FILTER (WHERE ta.resolution_status IS NULL OR ta.resolution_status='NOT_STARTED') AS not_started
         ${base}
         GROUP BY ta.department ORDER BY ta.department`, params),

      pool.query(
        `SELECT t.tag_no, t.zone, t.tag_date,
                ta.department, ta.resolution_status
         ${base}
         ORDER BY t.tag_no, ta.department`, params),
    ]);

    res.json({ summary: sum.rows[0], departments: depts.rows, tags: tags.rows });
  } catch (err) {
    console.error("Internal admin tag-status:", err);
    res.status(500).json({ message: "Failed to fetch tag status" });
  }
});

module.exports = router;
