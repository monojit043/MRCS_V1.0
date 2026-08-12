const express = require("express");
const router  = express.Router();
const pool    = require("../data/db");
const { authenticateToken, authorize } = require("../middleware/auth.middleware");

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
function requirePipingLE(req, res, next) {
  const dept = (req.user?.department || "").toLowerCase();
  const role = req.user?.role;
  if (dept !== "piping" || !["GL", "LE"].includes(role)) {
    return res.status(403).json({ message: "Access denied: Piping LE or GL only" });
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
  const employeeId = req.user.employeeId;
  const dept       = (req.user.department || "").toLowerCase();
  const role       = req.user.role;
  const isPipingLE = dept === "piping" && ["GL", "LE"].includes(role);

  try {
    let reviews;
    if (isPipingLE) {
      const r = await pool.query(
        `SELECT id, job_no, unit_no, stage, description, review_date_from, review_date_to, created_at
         FROM model_review_initiations WHERE UPPER(review_type) = 'INTERNAL' ORDER BY created_at DESC`
      );
      reviews = r.rows;
    } else {
      const r = await pool.query(
        `SELECT DISTINCT mri.id, mri.job_no, mri.unit_no, mri.stage,
                mri.description, mri.review_date_from, mri.review_date_to, mri.created_at
         FROM model_review_initiations mri
         JOIN user_assignments ua
           ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
          AND (ua.stage = mri.stage OR ua.stage IS NULL)
         WHERE ua.employee_id = $1 AND UPPER(mri.review_type) = 'INTERNAL'
         ORDER BY mri.created_at DESC`,
        [employeeId]
      );
      reviews = r.rows;
    }

    const withStats = await Promise.all(reviews.map(async (rev) => {
      const deptFilter = isPipingLE ? "" : "AND LOWER(ta.department) = LOWER($4)";
      const params     = isPipingLE
        ? [rev.job_no, rev.unit_no, rev.stage]
        : [rev.job_no, rev.unit_no, rev.stage, dept];

      const s = await pool.query(
        `SELECT COUNT(*)                                                    AS total,
                COUNT(*) FILTER (WHERE t.final_status = 'COMPLETED')       AS completed,
                COUNT(*) FILTER (WHERE ta.resolution_status = 'SUBMITTED') AS pending_approval
         FROM tag_assignments ta
         JOIN tags t             ON ta.tag_id   = t.id
         JOIN uploaded_folders uf ON t.folder_id = uf.id
         JOIN jobs j             ON uf.job_id   = j.id
         WHERE j.job_no=$1 AND j.unit_no=$2 AND j.review_stage=$3
           AND LOWER(j.review_type)='internal' AND t.status='LOCKED' ${deptFilter}`,
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
   Piping LE/GL see all internal reviews (they initiate them).
   Everyone else sees only reviews they are assigned to. */
router.get("/dropdown", authenticateToken, async (req, res) => {
  const employeeId = req.user.employeeId;
  const dept       = (req.user.department || "").toLowerCase();
  const role       = req.user.role;
  const isPipingLE = dept === "piping" && ["GL", "LE"].includes(role);

  try {
    let r;
    if (isPipingLE) {
      r = await pool.query(
        `SELECT id, job_no, unit_no, stage
         FROM model_review_initiations
         WHERE UPPER(review_type) = 'INTERNAL'
         ORDER BY job_no, unit_no, stage`
      );
    } else {
      r = await pool.query(
        `SELECT DISTINCT mri.id, mri.job_no, mri.unit_no, mri.stage
         FROM model_review_initiations mri
         JOIN user_assignments ua
           ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
          AND (ua.stage = mri.stage OR ua.stage IS NULL)
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

/* GET /api/internal/external-assigned-reviews — external reviews where this Piping LE/GL is assigned */
router.get("/external-assigned-reviews", authenticateToken, requirePipingLE, async (req, res) => {
  const employeeId = req.user.employeeId;
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
              ) AS has_internal
       FROM model_review_initiations mri
       JOIN user_assignments ua
         ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
        AND (ua.stage = mri.stage OR ua.stage IS NULL)
       WHERE ua.employee_id = $1
         AND (UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)
       ORDER BY mri.job_no, mri.unit_no, mri.stage`,
      [employeeId]
    );
    res.json({ reviews: r.rows });
  } catch (err) {
    console.error("Internal /external-assigned-reviews:", err);
    res.status(500).json({ message: "Failed to fetch assigned external reviews" });
  }
});

/* POST /api/internal/initiate — create internal review from an assigned external review */
router.post("/initiate", authenticateToken, requirePipingLE, async (req, res) => {
  const { externalReviewId, fromDate, toDate, description } = req.body;
  if (!externalReviewId)
    return res.status(400).json({ message: "externalReviewId is required" });

  const employeeId = req.user.employeeId;
  try {
    /* Verify the external review exists and the user is assigned to it */
    const extR = await pool.query(
      `SELECT DISTINCT mri.job_no, mri.unit_no, mri.stage
       FROM model_review_initiations mri
       JOIN user_assignments ua
         ON ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
        AND (ua.stage = mri.stage OR ua.stage IS NULL)
       WHERE mri.id = $1 AND ua.employee_id = $2
         AND (UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)`,
      [externalReviewId, employeeId]
    );
    if (extR.rows.length === 0)
      return res.status(404).json({ message: "External review not found or you are not assigned to it" });

    const { job_no, unit_no, stage } = extR.rows[0];

    const dup = await pool.query(
      `SELECT 1 FROM model_review_initiations
       WHERE UPPER(job_no)=$1 AND UPPER(unit_no)=$2 AND stage=$3 AND UPPER(review_type)='INTERNAL'`,
      [job_no.toUpperCase(), unit_no.toUpperCase(), stage]
    );
    if (dup.rows.length > 0)
      return res.status(409).json({ message: `An internal review already exists for ${job_no} / ${unit_no} / ${stage}` });

    const result = await pool.query(
      `INSERT INTO model_review_initiations (job_no, unit_no, stage, description, review_type, review_date_from, review_date_to, created_by)
       VALUES ($1, $2, $3, $4, 'INTERNAL', $5, $6, $7) RETURNING *`,
      [job_no, unit_no, stage, description || null, fromDate || null, toDate || null, employeeId]
    );
    res.status(201).json({ message: "Internal review initiated", initiation: result.rows[0] });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ message: "An internal review for this Job / Unit / Stage already exists." });
    console.error("Internal /initiate:", err);
    res.status(500).json({ message: "Failed to initiate internal review" });
  }
});

/* GET /api/internal/initiated — all internal reviews with user counts */
router.get("/initiated", authenticateToken, requirePipingLE, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT mri.id, mri.job_no, mri.unit_no, mri.stage, mri.description, mri.created_at,
              COUNT(ua.employee_id) AS assigned_count
       FROM model_review_initiations mri
       LEFT JOIN user_assignments ua
         ON ua.job_no=mri.job_no AND ua.unit_no=mri.unit_no AND ua.stage=mri.stage
       WHERE UPPER(mri.review_type)='INTERNAL'
       GROUP BY mri.id ORDER BY mri.created_at DESC`
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

/* GET /api/internal/assigned-users */
router.get("/assigned-users", authenticateToken, requirePipingLE, async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });
  try {
    const r = await pool.query(
      `SELECT ua.employee_id, m.employee_name AS full_name, ua.role, ua.department
       FROM user_assignments ua
       JOIN master_employees m ON m.employee_id = ua.employee_id
       WHERE ua.job_no=$1 AND ua.unit_no=$2 AND ua.stage=$3
       ORDER BY ua.department, ua.role`,
      [jobNo.toUpperCase(), unitNo.toUpperCase(), stage]
    );
    res.json({ users: r.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch" });
  }
});

/* POST /api/internal/assign */
router.post("/assign", authenticateToken, requirePipingLE, async (req, res) => {
  const { employeeId, role, department, jobNo, unitNo, stage } = req.body;
  if (!employeeId || !role || !department || !jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "All fields are required" });

  const cleanJob  = jobNo.toUpperCase();
  const cleanUnit = unitNo.toUpperCase();
  const cleanDept = department.toLowerCase();

  try {
    const rev = await pool.query(
      `SELECT 1 FROM model_review_initiations
       WHERE UPPER(job_no)=$1 AND UPPER(unit_no)=$2 AND stage=$3 AND UPPER(review_type)='INTERNAL'`,
      [cleanJob, cleanUnit, stage]
    );
    if (rev.rows.length === 0) return res.status(404).json({ message: "Internal review not found" });

    const dup = await pool.query(
      `SELECT 1 FROM user_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND stage=$4 AND department=$5`,
      [employeeId, cleanJob, cleanUnit, stage, cleanDept]
    );
    if (dup.rows.length > 0) return res.status(409).json({ message: "Already assigned" });

    await pool.query(
      `INSERT INTO user_assignments (employee_id,role,department,job_no,unit_no,stage)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [employeeId, role, cleanDept, cleanJob, cleanUnit, stage]
    );
    res.json({ message: "User assigned" });
  } catch (err) {
    res.status(500).json({ message: "Failed to assign user" });
  }
});

/* DELETE /api/internal/assign */
router.delete("/assign", authenticateToken, requirePipingLE, async (req, res) => {
  const { employeeId, jobNo, unitNo, stage, department } = req.body;
  try {
    await pool.query(
      `DELETE FROM user_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND stage=$4 AND department=$5`,
      [employeeId, jobNo.toUpperCase(), unitNo.toUpperCase(), stage, department.toLowerCase()]
    );
    res.json({ message: "Assignment removed" });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove assignment" });
  }
});

/* ══════════════════════════════════════════════════════════════
   UPLOAD & FINALIZATION  (Piping LE/GL)
══════════════════════════════════════════════════════════════ */

/* POST /api/internal/upload-folder */
router.post("/upload-folder", authenticateToken, requirePipingLE,
  prepareUploadFolder, upload.any(),
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

      /* Find or create job with review_type='internal' */
      let jobId;
      const jobResult = await pool.query(
        `SELECT id FROM jobs WHERE job_no=$1 AND unit_no=$2 AND review_stage=$3 AND LOWER(review_type)='internal'`,
        [jobNo, unitNo, stage]
      );
      if (jobResult.rows.length > 0) {
        jobId = jobResult.rows[0].id;
      } else {
        const newJob = await pool.query(
          `INSERT INTO jobs (job_no,unit_no,review_stage,review_type) VALUES ($1,$2,$3,'internal') RETURNING id`,
          [jobNo, unitNo, stage]
        );
        jobId = newJob.rows[0].id;
      }

      const zones = await loadZones(jobId);

      const folderInsert = await pool.query(
        `INSERT INTO uploaded_folders (job_id,folder_name,uploaded_by,model_file) VALUES ($1,$2,$3,$4) RETURNING id`,
        [jobId, originalFolderName, req.user.employeeId, model_file]
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

      res.json({ message: "Folder uploaded successfully", jobId, folderId, tagCount: tags.length });
    } catch (err) {
      console.error("Internal upload error:", err);
      res.status(500).json({ message: "Upload processing failed", error: err.message });
    }
  }
);

/* GET /api/internal/tags — PipingLE sees all; used in upload panel */
router.get("/tags", authenticateToken, requirePipingLE, async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });
  try {
    const result = await pool.query(
      `SELECT t.id, t.tag_no, t.description, t.tag_date, t.view_name, t.status, t.original_snap_path,
              STRING_AGG(ta.department, ',') AS department
       FROM tags t
       JOIN uploaded_folders uf ON t.folder_id = uf.id
       JOIN jobs j              ON uf.job_id   = j.id
       LEFT JOIN tag_assignments ta ON ta.tag_id = t.id
       WHERE j.job_no=$1 AND j.unit_no=$2 AND j.review_stage=$3 AND LOWER(j.review_type)='internal'
       GROUP BY t.id, t.tag_no, t.description, t.tag_date, t.view_name, t.status, t.original_snap_path
       ORDER BY t.tag_date ASC`,
      [jobNo, unitNo, stage]
    );
    res.json({ count: result.rows.length, tags: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch tags", error: err.message });
  }
});

/* POST /api/internal/tags/lock */
router.post("/tags/lock", authenticateToken, requirePipingLE, async (req, res) => {
  const { updates, lockedBy } = req.body;
  if (!updates || !Array.isArray(updates))
    return res.status(400).json({ message: "Invalid updates payload" });
  try {
    for (const item of updates) {
      const { tagId, departments } = item;
      if (!departments || !Array.isArray(departments)) continue;

      await pool.query(
        `UPDATE tags SET status='LOCKED', locked_by=$1, locked_at=CURRENT_TIMESTAMP WHERE id=$2 AND status='NEW'`,
        [lockedBy || "Unknown", tagId]
      );
      await pool.query(`DELETE FROM tag_assignments WHERE tag_id=$1`, [tagId]);
      for (const dept of departments)
        await pool.query(
          `INSERT INTO tag_assignments (tag_id,department,resolution_status) VALUES ($1,$2,'NOT_STARTED')`,
          [tagId, dept.toLowerCase()]
        );
    }
    res.json({ message: "Tags locked successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to lock tags", error: err.message });
  }
});

/* GET /api/internal/folders */
router.get("/folders", authenticateToken, async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  const dept       = (req.user?.department || "").toLowerCase();
  const role       = req.user?.role;
  const isPipingLE = dept === "piping" && ["GL", "LE"].includes(role);

  if (!isPipingLE) {
    const ac = await pool.query(
      `SELECT 1 FROM user_assignments WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 LIMIT 1`,
      [req.user.employeeId, jobNo, unitNo]
    );
    if (ac.rows.length === 0) return res.status(403).json({ message: "Not assigned" });
  }

  try {
    const result = await pool.query(
      `SELECT uf.id, uf.folder_name, uf.model_file, uf.uploaded_at,
              j.job_no, j.unit_no, j.review_stage,
              COALESCE(me.employee_name, uf.uploaded_by) AS uploaded_by_name,
              COUNT(t.id) AS tag_count,
              MIN(t.tag_date) AS model_review_date
       FROM uploaded_folders uf
       JOIN jobs j            ON uf.job_id    = j.id
       LEFT JOIN tags t       ON t.folder_id  = uf.id
       LEFT JOIN master_employees me ON me.employee_id = uf.uploaded_by
       WHERE j.job_no=$1 AND j.unit_no=$2 AND j.review_stage=$3 AND LOWER(j.review_type)='internal'
       GROUP BY uf.id, j.job_no, j.unit_no, j.review_stage, me.employee_name, uf.uploaded_by
       ORDER BY uf.uploaded_at DESC`,
      [jobNo, unitNo, stage]
    );
    res.json({ count: result.rows.length, folders: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch folders", error: err.message });
  }
});

/* DELETE /api/internal/folders/:folderId */
router.delete("/folders/:folderId", authenticateToken, requirePipingLE, async (req, res) => {
  const { folderId } = req.params;
  try {
    const r = await pool.query(
      `SELECT uf.id, uf.storage_path FROM uploaded_folders uf
       JOIN jobs j ON uf.job_id = j.id
       WHERE uf.id=$1 AND LOWER(j.review_type)='internal'`,
      [folderId]
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
router.get("/job-engineer-tags", authenticateToken, authorize("JE"), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const employeeId = req.user.employeeId;
  const department = req.user.department;

  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  try {
    const ac = await pool.query(
      `SELECT 1 FROM user_assignments
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
       JOIN jobs j              ON uf.job_id   = j.id
       JOIN tag_assignments ta  ON ta.tag_id   = t.id
       WHERE j.job_no=$1 AND j.unit_no=$2 AND j.review_stage=$3
         AND LOWER(j.review_type)='internal'
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
router.get("/lead-review-tags", authenticateToken, authorize("LE"), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const employeeId = req.user.employeeId;

  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  try {
    const ac = await pool.query(
      `SELECT department FROM user_assignments
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
       JOIN jobs j              ON uf.job_id   = j.id
       JOIN tag_assignments ta  ON ta.tag_id   = t.id
       WHERE j.job_no=$1 AND j.unit_no=$2 AND j.review_stage=$3
         AND LOWER(j.review_type)='internal'
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
router.get("/lead-review-summary", authenticateToken, authorize("LE"), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const employeeId = req.user.employeeId;

  try {
    const ac = await pool.query(
      `SELECT department FROM user_assignments
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
       JOIN jobs j              ON uf.job_id   = j.id
       JOIN tag_assignments ta  ON ta.tag_id   = t.id
       WHERE j.job_no=$1 AND j.unit_no=$2 AND j.review_stage=$3
         AND LOWER(j.review_type)='internal' AND ta.department=$4`,
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
router.get("/admin/tag-status", authenticateToken, requirePipingLE, async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  if (!jobNo || !unitNo || !stage)
    return res.status(400).json({ message: "jobNo, unitNo and stage required" });

  const base = `
    FROM tags t
    JOIN uploaded_folders uf ON t.folder_id = uf.id
    JOIN jobs j              ON uf.job_id   = j.id
    JOIN tag_assignments ta  ON ta.tag_id   = t.id
    WHERE j.job_no=$1 AND j.unit_no=$2 AND j.review_stage=$3
      AND LOWER(j.review_type)='internal'`;

  try {
    const [sum, depts, tags] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ta.resolution_status='APPROVED')  AS approved,
                COUNT(*) FILTER (WHERE ta.resolution_status='SUBMITTED') AS pending_approval,
                COUNT(*) FILTER (WHERE ta.resolution_status='REJECTED')  AS rejected,
                COUNT(*) FILTER (WHERE ta.resolution_status='SAVED')     AS draft,
                COUNT(*) FILTER (WHERE ta.resolution_status IS NULL OR ta.resolution_status='NOT_STARTED') AS not_started
         ${base}`, [jobNo, unitNo, stage]),

      pool.query(
        `SELECT ta.department,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ta.resolution_status='APPROVED')  AS approved,
                COUNT(*) FILTER (WHERE ta.resolution_status='SUBMITTED') AS pending_approval,
                COUNT(*) FILTER (WHERE ta.resolution_status='REJECTED')  AS rejected,
                COUNT(*) FILTER (WHERE ta.resolution_status='SAVED')     AS draft,
                COUNT(*) FILTER (WHERE ta.resolution_status IS NULL OR ta.resolution_status='NOT_STARTED') AS not_started
         ${base}
         GROUP BY ta.department ORDER BY ta.department`, [jobNo, unitNo, stage]),

      pool.query(
        `SELECT t.tag_no, t.zone, t.tag_date,
                ta.department, ta.resolution_status
         ${base}
         ORDER BY t.tag_no, ta.department`, [jobNo, unitNo, stage]),
    ]);

    res.json({ summary: sum.rows[0], departments: depts.rows, tags: tags.rows });
  } catch (err) {
    console.error("Internal admin tag-status:", err);
    res.status(500).json({ message: "Failed to fetch tag status" });
  }
});

module.exports = router;
