const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const { authenticateToken, authorize } = require("../middleware/auth.middleware");
const { sendAssignmentNotification } = require("../services/mailer");
const { validateInitiation } = require("../services/pimsLookup");
// Roles are checked on the review being acted on (job/unit/stage), not globally
const { requireReviewRole } = require("../services/reviewAccess");

// These routes serve the EXTERNAL side. Internal reviews (review_type INTERNAL) share
// model_review_initiations but have their own pages and routes (/api/internal/*).
const EXTERNAL_ONLY     = "(UPPER(review_type) = 'EXTERNAL' OR review_type IS NULL)";
const EXTERNAL_ONLY_MRI = "(UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)";

function requirePEM(req, res, next) {
  const dept = req.user?.department?.toLowerCase();
  const role = req.user?.role;
  if (dept !== "pem" || !["GL", "LE"].includes(role)) {
    return res.status(403).json({ message: "Access denied: PEM GL or PEM LE only" });
  }
  next();
}

// PEM no longer assigns departments' GL / LE (decided 2026-10-18). Department GL now
// comes live from PIMS (GL / SGL roles) or eil_employees.level >= 17, and a GL assigns
// their own department's LE / JE (admin add-user, internal assign). The old PEM
// assignment handlers below are kept but unreachable.
function pemLeadAssignmentRetired(req, res) {
  res.status(410).json({
    message: "PEM no longer assigns department GL / LE. Department GLs come from PIMS or employee level; each department's GL assigns its own LE / JE.",
  });
}

// POST /api/initiation — PEM only: create a new model review initiation
router.post("/", authenticateToken, requirePEM, async (req, res) => {
  try {
    const { jobNo, unitNo, stage, description, reviewDateFrom, reviewDateTo } = req.body;

    if (!jobNo || !unitNo || !stage) {
      return res.status(400).json({ message: "Job No, Unit No and Stage are required" });
    }

    const cleanJob  = jobNo.trim().toUpperCase();
    const cleanUnit = unitNo.trim().toUpperCase();

    // Only PIMS jobs, only MASTER units, only standard stages (live from PC-2)
    let invalid;
    try {
      invalid = await validateInitiation(cleanJob, cleanUnit, stage);
    } catch (err) {
      console.error("validateInitiation: PC-2 unreachable:", err.message);
      return res.status(503).json({ message: "PIMS (PC-2) is unreachable — cannot verify Job / Unit. Please try again shortly." });
    }
    if (invalid) return res.status(400).json({ message: invalid });

    // Explicit duplicate check (case-insensitive) — only another EXTERNAL review counts;
    // departments' internal reviews for the same job / unit / stage may already exist.
    const duplicate = await pool.query(
      `SELECT 1 FROM model_review_initiations
       WHERE UPPER(job_no) = $1 AND UPPER(unit_no) = $2 AND stage = $3 AND ${EXTERNAL_ONLY}`,
      [cleanJob, cleanUnit, stage]
    );
    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        message: `An external review already exists for Job ${cleanJob} / Unit ${cleanUnit} / Stage ${stage}.`
      });
    }

    const result = await pool.query(
      `INSERT INTO model_review_initiations (job_no, unit_no, stage, description, review_date_from, review_date_to, review_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        cleanJob,
        cleanUnit,
        stage,
        description || null,
        reviewDateFrom || null,
        reviewDateTo || null,
        'EXTERNAL',
        req.user.employeeId
      ]
    );

    const initiation = result.rows[0];
    res.status(201).json({ message: "Review initiated successfully", initiation });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "A review for this Job No / Unit No / Stage already exists." });
    }
    console.error(err);
    res.status(500).json({ message: "Failed to create initiation", detail: err.message });
  }
});

// GET /api/initiation — list all initiations (GL/PEM see all; JE/LE see only assigned)
router.get("/", authenticateToken, async (req, res) => {
  try {
    let rows;

    // Only PEM sees every review. Everyone else — including GLs — sees only the
    // reviews they are assigned to (a GL on one review has no rights on others).
    // EXTERNAL reviews only — internal reviews have their own pages (/api/internal/*).
    if (req.user.department?.toLowerCase() === "pem") {
      const result = await pool.query(
        `SELECT * FROM model_review_initiations
         WHERE ${EXTERNAL_ONLY}
         ORDER BY created_at DESC`
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT DISTINCT mri.*
         FROM model_review_initiations mri
         JOIN effective_assignments ua
           ON ua.job_no = mri.job_no
           AND ua.unit_no = mri.unit_no
           AND (ua.stage = mri.stage OR ua.stage IS NULL)
         WHERE ua.employee_id = $1 AND ${EXTERNAL_ONLY_MRI}
         ORDER BY mri.created_at DESC`,
        [req.user.employeeId]
      );
      rows = result.rows;
    }

    res.json({ initiations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch initiations", detail: err.message });
  }
});

// GET /api/initiation/dropdown — filtered list for dropdowns across all pages
router.get("/dropdown", authenticateToken, async (req, res) => {
  try {
    let rows;

    // EXTERNAL reviews only — this picker is used by the external pages
    if (req.user.department?.toLowerCase() === "pem") {
      const result = await pool.query(
        `SELECT id, job_no, unit_no, stage FROM model_review_initiations
         WHERE ${EXTERNAL_ONLY}
         ORDER BY created_at DESC`
      );
      rows = result.rows;
    } else {
      // GL, LE, JE all see only reviews they are assigned to
      const result = await pool.query(
        `SELECT DISTINCT mri.id, mri.job_no, mri.unit_no, mri.stage
         FROM model_review_initiations mri
         JOIN effective_assignments ua
           ON ua.job_no = mri.job_no
           AND ua.unit_no = mri.unit_no
           AND (ua.stage = mri.stage OR ua.stage IS NULL)
         WHERE ua.employee_id = $1 AND ${EXTERNAL_ONLY_MRI}
         ORDER BY mri.job_no, mri.unit_no, mri.stage`,
        [req.user.employeeId]
      );
      rows = result.rows;
    }

    res.json({ options: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch dropdown options", detail: err.message });
  }
});

// GET /api/initiation/summary — PEM: counts for dashboard (active, upcoming, past, closed, pending)
router.get("/summary", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT mri.id)                                                              AS total,
        COUNT(DISTINCT CASE
          WHEN mri.review_date_from IS NOT NULL AND mri.review_date_to IS NOT NULL
               AND CURRENT_DATE BETWEEN mri.review_date_from AND mri.review_date_to
          THEN mri.id END)                                                                  AS active,
        COUNT(DISTINCT CASE
          WHEN mri.review_date_from IS NOT NULL AND CURRENT_DATE < mri.review_date_from
          THEN mri.id END)                                                                  AS upcoming,
        COUNT(DISTINCT CASE
          WHEN mri.review_date_to IS NOT NULL AND CURRENT_DATE > mri.review_date_to
          THEN mri.id END)                                                                  AS past,
        COUNT(DISTINCT CASE
          WHEN mr.is_locked = true THEN mri.id END)                                        AS report_closed
      FROM model_review_initiations mri
      LEFT JOIN review_prerequisites_submissions mr
        ON mr.initiation_id = mri.id
      WHERE ${EXTERNAL_ONLY_MRI}
    `);

    const s = result.rows[0];
    const total        = parseInt(s.total);
    const report_closed = parseInt(s.report_closed);
    res.json({
      total,
      active:         parseInt(s.active),
      upcoming:       parseInt(s.upcoming),
      past:           parseInt(s.past),
      report_closed,
      report_pending: total - report_closed
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch summary", detail: err.message });
  }
});

// GET /api/initiation/detail?jobNo=&unitNo=&stage= — single initiation record
router.get("/detail", authenticateToken, requireReviewRole("JE"), async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  if (!jobNo || !unitNo || !stage) {
    return res.status(400).json({ message: "jobNo, unitNo, stage required" });
  }
  try {
    const result = await pool.query(
      `SELECT * FROM model_review_initiations WHERE job_no = $1 AND unit_no = $2 AND stage = $3`,
      [jobNo, unitNo, stage]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Initiation not found" });
    }
    res.json({ initiation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch initiation detail", detail: err.message });
  }
});

// GET /api/initiation/my-stats — non-PEM: personal dashboard (assignments + tag counts)
router.get("/my-stats", authenticateToken, async (req, res) => {
  const employeeId = req.user.employeeId;
  try {
    // One row per review, with the user's highest role on it. Computed GL rows
    // (from PIMS / level) have stage NULL = every stage.
    const assignResult = await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (mri.id)
               ua.job_no, ua.unit_no, mri.stage, ua.role, ua.department,
               mri.review_date_from, mri.review_date_to, mri.description, mri.created_at
        FROM effective_assignments ua
        JOIN model_review_initiations mri
          ON mri.job_no = ua.job_no AND mri.unit_no = ua.unit_no
         AND (mri.stage = ua.stage OR ua.stage IS NULL)
        WHERE UPPER(ua.employee_id) = UPPER($1) AND ${EXTERNAL_ONLY_MRI}
        ORDER BY mri.id, CASE ua.role WHEN 'GL' THEN 1 WHEN 'LE' THEN 2 ELSE 3 END
      ) x
      ORDER BY x.created_at DESC
    `, [employeeId]);

    const withStats = await Promise.all(assignResult.rows.map(async (a) => {
      const s = await pool.query(`
        SELECT
          COUNT(*)                                                                          AS total,
          COUNT(*) FILTER (WHERE ta.resolution_status IS NULL
                              OR ta.resolution_status = 'NOT_STARTED')                    AS not_started,
          COUNT(*) FILTER (WHERE ta.resolution_status = 'SAVED')                          AS draft,
          COUNT(*) FILTER (WHERE ta.resolution_status = 'SUBMITTED')                      AS pending,
          COUNT(*) FILTER (WHERE ta.resolution_status = 'APPROVED')                       AS approved,
          COUNT(*) FILTER (WHERE ta.resolution_status = 'REJECTED')                       AS rejected
        FROM tag_assignments ta
        JOIN tags t   ON ta.tag_id   = t.id
        JOIN uploaded_folders uf ON t.folder_id = uf.id
        JOIN model_review_initiations mri2 ON uf.initiation_id = mri2.id
        WHERE mri2.job_no = $1 AND mri2.unit_no = $2 AND mri2.stage = $3
          AND LOWER(ta.department) = LOWER($4)
          AND t.status = 'LOCKED'
      `, [a.job_no, a.unit_no, a.stage, a.department]);
      return { ...a, stats: s.rows[0] || { total:0, not_started:0, draft:0, pending:0, approved:0, rejected:0 } };
    }));

    const totals = withStats.reduce((acc, a) => {
      acc.total       += parseInt(a.stats.total       || 0);
      acc.not_started += parseInt(a.stats.not_started || 0);
      acc.draft       += parseInt(a.stats.draft       || 0);
      acc.pending     += parseInt(a.stats.pending     || 0);
      acc.approved    += parseInt(a.stats.approved    || 0);
      acc.rejected    += parseInt(a.stats.rejected    || 0);
      return acc;
    }, { total:0, not_started:0, draft:0, pending:0, approved:0, rejected:0 });

    res.json({ assignments: withStats, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch dashboard stats", detail: err.message });
  }
});

// GET /api/initiation/assignments?jobNo=&unitNo=&stage= — PEM to manage, GL/LE to view
router.get("/assignments", authenticateToken, requireReviewRole("JE"), async (req, res) => {
  try {
    const { jobNo, unitNo, stage } = req.query;
    if (!jobNo || !unitNo || !stage) {
      return res.status(400).json({ message: "jobNo, unitNo, stage required" });
    }

    const result = await pool.query(
      `SELECT ua.employee_id, m.employee_name, ua.role, ua.department
       FROM user_assignments ua
       JOIN master_employees m ON m.employee_id = ua.employee_id
       WHERE ua.job_no = $1 AND ua.unit_no = $2 AND ua.stage = $3
         AND ua.role IN ('GL', 'LE')
       ORDER BY ua.department, ua.role`,
      [jobNo, unitNo, stage]
    );

    res.json({ assignments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch assignments", detail: err.message });
  }
});

// POST /api/initiation/assignments — PEM only: assign GL/LE to a review
router.post("/assignments", authenticateToken, requirePEM, pemLeadAssignmentRetired, async (req, res) => {
  try {
    const { employeeId, role, department, jobNo, unitNo, stage } = req.body;

    if (!employeeId || !role || !department || !jobNo || !unitNo || !stage) {
      return res.status(400).json({ message: "All fields required" });
    }

    if (!["GL", "LE"].includes(role)) {
      return res.status(400).json({ message: "Only GL or LE roles can be assigned here" });
    }

    // department arrives pre-cased from master_employees via the department
    // dropdown (e.g. "PEM" uppercase, everything else lowercase) — don't
    // re-case it. department_check requires that exact casing, and
    // lowercasing it here made PEM-department assignment fail.
    const existing = await pool.query(
      `SELECT 1 FROM user_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND stage=$4 AND LOWER(department)=LOWER($5)`,
      [employeeId, jobNo, unitNo, stage, department]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "This employee is already assigned to this review for this department" });
    }

    await pool.query(
      `INSERT INTO user_assignments (employee_id, role, department, job_no, unit_no, stage)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [employeeId, role, department, jobNo, unitNo, stage]
    );

    res.json({ message: "Lead assigned successfully" });

    /* ── Notify the newly assigned person (fire-and-forget) ── */
    setImmediate(async () => {
      try {
        const [assigneeR, reviewR, assignerR] = await Promise.all([
          pool.query(
            `SELECT employee_name, email FROM master_employees WHERE employee_id = $1`,
            [employeeId]
          ),
          pool.query(
            `SELECT * FROM model_review_initiations WHERE job_no=$1 AND unit_no=$2 AND stage=$3`,
            [jobNo, unitNo, stage]
          ),
          pool.query(
            `SELECT employee_name FROM master_employees WHERE employee_id = $1`,
            [req.user.employeeId]
          )
        ]);

        const assignee     = assigneeR.rows[0];
        const review       = reviewR.rows[0];
        const assignerName = assignerR.rows[0]?.employee_name || req.user.employeeId;

        if (!assignee?.email) {
          console.log(`[MRCS Mailer] No email for ${employeeId} — skipping assignment notification.`);
          return;
        }

        await sendAssignmentNotification(review, {
          employee_name: assignee.employee_name,
          email:         assignee.email,
          role,
          department
        }, assignerName);

        console.log(`[MRCS Mailer] ✓ Assignment notification sent to ${assignee.employee_name} <${assignee.email}>`);
      } catch (mailErr) {
        console.error("[MRCS Mailer] Failed to send assignment notification:", mailErr.message);
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to assign lead", detail: err.message });
  }
});

// DELETE /api/initiation/assignments — PEM only: remove by composite key
router.delete("/assignments", authenticateToken, requirePEM, pemLeadAssignmentRetired, async (req, res) => {
  try {
    const { employeeId, jobNo, unitNo, stage, department } = req.body;

    await pool.query(
      `DELETE FROM user_assignments
       WHERE employee_id=$1 AND job_no=$2 AND unit_no=$3 AND stage=$4 AND department=$5`,
      [employeeId, jobNo, unitNo, stage, department]
    );

    res.json({ message: "Assignment removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove assignment", detail: err.message });
  }
});

// GET /api/initiation/assignments/suggestions?jobNo=&unitNo=&stage=
// PEM only: suggest GL/LE carried over from the most recently initiated OTHER
// stage of the same job/unit, excluding anyone already assigned to this stage.
router.get("/assignments/suggestions", authenticateToken, requirePEM, pemLeadAssignmentRetired, async (req, res) => {
  try {
    const { jobNo, unitNo, stage } = req.query;
    if (!jobNo || !unitNo || !stage) {
      return res.status(400).json({ message: "jobNo, unitNo, stage required" });
    }

    // Other stages of this job/unit, most recently initiated first
    const otherStages = await pool.query(
      `SELECT stage FROM model_review_initiations
       WHERE job_no = $1 AND unit_no = $2 AND stage <> $3
       ORDER BY created_at DESC`,
      [jobNo, unitNo, stage]
    );

    let sourceStage = null;
    let sourceRows = [];

    for (const { stage: candidateStage } of otherStages.rows) {
      const candidateAssignments = await pool.query(
        `SELECT employee_id, role, department FROM user_assignments
         WHERE job_no = $1 AND unit_no = $2 AND stage = $3 AND role IN ('GL', 'LE')`,
        [jobNo, unitNo, candidateStage]
      );
      if (candidateAssignments.rows.length > 0) {
        sourceStage = candidateStage;
        sourceRows = candidateAssignments.rows;
        break;
      }
    }

    if (!sourceStage) {
      return res.json({ sourceStage: null, suggestions: [] });
    }

    // Drop anyone already assigned (same employee+role+department) to the target stage
    const currentAssignments = await pool.query(
      `SELECT employee_id, role, department FROM user_assignments
       WHERE job_no = $1 AND unit_no = $2 AND stage = $3 AND role IN ('GL', 'LE')`,
      [jobNo, unitNo, stage]
    );
    const alreadyPresent = new Set(
      currentAssignments.rows.map(r => `${r.employee_id}|${r.role}|${r.department}`)
    );
    const toSuggest = sourceRows.filter(
      r => !alreadyPresent.has(`${r.employee_id}|${r.role}|${r.department}`)
    );

    if (toSuggest.length === 0) {
      return res.json({ sourceStage, suggestions: [] });
    }

    const names = await pool.query(
      `SELECT employee_id, employee_name FROM master_employees WHERE employee_id = ANY($1)`,
      [toSuggest.map(r => r.employee_id)]
    );
    const nameMap = {};
    names.rows.forEach(n => { nameMap[n.employee_id] = n.employee_name; });

    res.json({
      sourceStage,
      suggestions: toSuggest.map(r => ({
        employeeId: r.employee_id,
        employeeName: nameMap[r.employee_id] || r.employee_id,
        role: r.role,
        department: r.department
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load assignment suggestions", detail: err.message });
  }
});

// POST /api/initiation/assignments/copy-forward — PEM only: apply a chosen
// subset of suggested assignments to the target stage.
router.post("/assignments/copy-forward", authenticateToken, requirePEM, pemLeadAssignmentRetired, async (req, res) => {
  try {
    const { jobNo, unitNo, stage, assignments } = req.body;

    if (!jobNo || !unitNo || !stage || !Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ message: "jobNo, unitNo, stage and at least one assignment required" });
    }

    let copied = 0;
    for (const a of assignments) {
      if (!a.employeeId || !a.role || !a.department) continue;
      const result = await pool.query(
        `INSERT INTO user_assignments (employee_id, role, department, job_no, unit_no, stage)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ON CONSTRAINT unique_assignment DO NOTHING`,
        // department is copied verbatim from an existing row (see /assignments/suggestions),
        // not fresh user input — don't re-case it. department_check requires 'PEM' uppercase
        // while every other department is lowercase; lowercasing here broke PEM copy-forward.
        [a.employeeId, a.role, a.department, jobNo, unitNo, stage]
      );
      if (result.rowCount > 0) copied++;
    }

    res.json({ message: `${copied} assignment(s) copied forward`, copied });

    /* ── Notify newly assigned people (fire-and-forget) ── */
    setImmediate(async () => {
      try {
        const review = (await pool.query(
          `SELECT * FROM model_review_initiations WHERE job_no=$1 AND unit_no=$2 AND stage=$3`,
          [jobNo, unitNo, stage]
        )).rows[0];
        const assignerName = (await pool.query(
          `SELECT employee_name FROM master_employees WHERE employee_id = $1`,
          [req.user.employeeId]
        )).rows[0]?.employee_name || req.user.employeeId;

        for (const a of assignments) {
          if (!a.employeeId || !a.role || !a.department) continue;
          const assignee = (await pool.query(
            `SELECT employee_name, email FROM master_employees WHERE employee_id = $1`,
            [a.employeeId]
          )).rows[0];
          if (!assignee?.email) continue;

          await sendAssignmentNotification(review, {
            employee_name: assignee.employee_name,
            email: assignee.email,
            role: a.role,
            department: a.department
          }, assignerName);
        }
      } catch (mailErr) {
        console.error("[MRCS Mailer] Failed to send copy-forward notifications:", mailErr.message);
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to copy assignments forward", detail: err.message });
  }
});

// GET /api/initiation/my-review-detail?jobNo=&unitNo=&stage= — tag detail for a single assigned review
router.get("/my-review-detail", authenticateToken, async (req, res) => {
  const { jobNo, unitNo, stage } = req.query;
  const employeeId = req.user.employeeId;

  if (!jobNo || !unitNo || !stage) {
    return res.status(400).json({ message: "jobNo, unitNo, stage required" });
  }

  try {
    const assignCheck = await pool.query(
      `SELECT role, department FROM effective_assignments
       WHERE UPPER(employee_id) = UPPER($1) AND job_no = $2 AND unit_no = $3
         AND (stage = $4 OR stage IS NULL)
       ORDER BY CASE role WHEN 'GL' THEN 1 WHEN 'LE' THEN 2 ELSE 3 END
       LIMIT 1`,
      [employeeId, jobNo, unitNo, stage]
    );

    if (assignCheck.rows.length === 0) {
      return res.status(403).json({ message: "Not assigned to this review" });
    }

    const assignment = assignCheck.rows[0];

    const reviewResult = await pool.query(
      `SELECT mri.*, COALESCE(mr.is_locked, false) AS is_locked
       FROM model_review_initiations mri
       LEFT JOIN review_prerequisites_submissions mr
         ON mr.initiation_id = mri.id
       WHERE mri.job_no = $1 AND mri.unit_no = $2 AND mri.stage = $3 AND ${EXTERNAL_ONLY_MRI}`,
      [jobNo, unitNo, stage]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ message: "Review not found" });
    }

    const tagsResult = await pool.query(
      `SELECT t.tag_no, t.description, t.tag_date,
              COALESCE(ta.resolution_status, 'NOT_STARTED') AS resolution_status
       FROM tag_assignments ta
       JOIN tags t         ON ta.tag_id   = t.id
       JOIN uploaded_folders uf ON t.folder_id = uf.id
       WHERE uf.initiation_id = $1
         AND LOWER(ta.department) = LOWER($2)
         AND t.status = 'LOCKED'
       ORDER BY t.tag_no`,
      [reviewResult.rows[0].id, assignment.department]
    );

    res.json({
      review:     reviewResult.rows[0],
      assignment: { role: assignment.role, department: assignment.department },
      tags:       tagsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch review detail", detail: err.message });
  }
});

// DELETE /api/initiation/:id — PEM only
router.delete("/:id", authenticateToken, requirePEM, async (req, res) => {
  try {
    const { id } = req.params;

    // PEM deletes EXTERNAL reviews only — departments' internal reviews are theirs
    const result = await pool.query(
      `DELETE FROM model_review_initiations WHERE id = $1 AND ${EXTERNAL_ONLY} RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "External review not found" });
    }

    res.json({ message: "Review initiation deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete initiation", detail: err.message });
  }
});

module.exports = router;
