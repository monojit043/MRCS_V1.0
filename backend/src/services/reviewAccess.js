// Per-REVIEW access checks (job + unit + stage), read live from effective_assignments
// (MRCS user_assignments + GL worked out from PIMS roles and eil_employees.level).
//
// A person's role is only valid on the review it was assigned for: GL on
// B889/999/30% gives no rights on B862/101/60%. req.user.role (the highest role
// across ALL assignments) is only good for coarse page gating — every route that
// acts on a specific review must check here instead.
//
// - An assignment with stage NULL counts for every stage of that job/unit.
// - PEM (department PEM on PC-2) passes every check — PEM owns all reviews.
// - sameDept: the assignment must be in the user's own department (department-
//   scoped work: prerequisites, internal reviews, tag resolution / approval).
const pool = require("../data/db");

const RANK = { JE: 1, LE: 2, GL: 3 };

const isPEM = (user) => String(user?.department || "").toLowerCase() === "pem";

async function rolesOnReview(user, { jobNo, unitNo, stage }, { sameDept = false } = {}) {
  const params = [user.employeeId, jobNo, unitNo, stage];
  let deptClause = "";
  if (sameDept) {
    params.push(user.department || "");
    deptClause = `AND lower(department) = lower($5)`;
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT role FROM effective_assignments
     WHERE upper(employee_id) = upper($1)
       AND upper(job_no) = upper($2) AND upper(unit_no) = upper($3)
       AND (stage = $4 OR stage IS NULL)
       ${deptClause}`,
    params
  );
  return rows.map((r) => r.role);
}

// Highest role the user holds on this review (null = none). PEM → "GL".
async function highestRoleOnReview(user, review, opts) {
  if (isPEM(user)) return "GL";
  const roles = await rolesOnReview(user, review, opts);
  return roles.reduce((best, r) => (RANK[r] > (RANK[best] || 0) ? r : best), null);
}

async function hasReviewRole(user, review, minRole, opts) {
  const best = await highestRoleOnReview(user, review, opts);
  return !!best && RANK[best] >= RANK[minRole];
}

// Role on a job / unit at ANY stage — for attendance, which has no stage in the request
async function hasRoleOnJobUnit(user, jobNo, unitNo, minRole) {
  if (isPEM(user)) return true;
  const { rows } = await pool.query(
    `SELECT DISTINCT role FROM effective_assignments
     WHERE upper(employee_id) = upper($1) AND upper(job_no) = upper($2) AND upper(unit_no) = upper($3)`,
    [user.employeeId, jobNo, unitNo]
  );
  return rows.some((r) => RANK[r.role] >= RANK[minRole]);
}

// The review (job / unit / stage) a tag belongs to: tags → uploaded_folders → initiation
async function reviewOfTag(tagId) {
  const { rows } = await pool.query(
    `SELECT mri.job_no AS "jobNo", mri.unit_no AS "unitNo", mri.stage
     FROM tags t
     JOIN uploaded_folders uf ON uf.id = t.folder_id
     JOIN model_review_initiations mri ON mri.id = uf.initiation_id
     WHERE t.id = $1`,
    [tagId]
  );
  return rows[0] || null;
}

// The review an uploaded folder belongs to
async function reviewOfFolder(folderId) {
  const { rows } = await pool.query(
    `SELECT mri.job_no AS "jobNo", mri.unit_no AS "unitNo", mri.stage
     FROM uploaded_folders uf
     JOIN model_review_initiations mri ON mri.id = uf.initiation_id
     WHERE uf.id = $1`,
    [folderId]
  );
  return rows[0] || null;
}

function denied(res, minRole, review) {
  return res.status(403).json({
    message: `Access denied: you are not ${minRole}${minRole === "GL" ? "" : " or above"} on ${review.jobNo} / ${review.unitNo} / ${review.stage}`,
  });
}

// Middleware: review comes from the request (query or body: jobNo, unitNo, stage)
function requireReviewRole(minRole, opts = {}) {
  return async (req, res, next) => {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const review = { jobNo: src.jobNo || src.job, unitNo: src.unitNo || src.unit, stage: src.stage };
    if (!review.jobNo || !review.unitNo || !review.stage) {
      return res.status(400).json({ message: "jobNo, unitNo and stage are required" });
    }
    try {
      if (await hasReviewRole(req.user, review, minRole, opts)) return next();
      return denied(res, minRole, review);
    } catch (err) {
      console.error("requireReviewRole:", err.message);
      res.status(500).json({ message: "Access check failed" });
    }
  };
}

// Middleware: review comes from the tag in req.params.id
function requireTagReviewRole(minRole, opts = {}) {
  return async (req, res, next) => {
    try {
      const review = await reviewOfTag(req.params.id);
      if (!review) return res.status(404).json({ message: "Tag not found" });
      if (await hasReviewRole(req.user, review, minRole, opts)) return next();
      return denied(res, minRole, review);
    } catch (err) {
      console.error("requireTagReviewRole:", err.message);
      res.status(500).json({ message: "Access check failed" });
    }
  };
}

// Middleware: review comes from the folder in req.params.folderId
function requireFolderReviewRole(minRole, opts = {}) {
  return async (req, res, next) => {
    try {
      const review = await reviewOfFolder(req.params.folderId);
      if (!review) return res.status(404).json({ message: "Folder not found" });
      if (await hasReviewRole(req.user, review, minRole, opts)) return next();
      return denied(res, minRole, review);
    } catch (err) {
      console.error("requireFolderReviewRole:", err.message);
      res.status(500).json({ message: "Access check failed" });
    }
  };
}

module.exports = {
  RANK, isPEM, rolesOnReview, highestRoleOnReview, hasReviewRole, hasRoleOnJobUnit, reviewOfTag, reviewOfFolder,
  requireReviewRole, requireTagReviewRole, requireFolderReviewRole,
};
