const express = require("express");
const router = express.Router();
const pool = require("../data/db"); // adjust if file name different
const { authenticateToken, authorize } = require("../middleware/auth.middleware");
// Role is checked on THIS review (job/unit/stage), in the user's own department
const { requireReviewRole } = require("../services/reviewAccess");

// Resolves (job_no, unit_no, stage) to the EXTERNAL model_review_initiations id.
// These are the external "Model Review Preparation" routes. A department's internal
// review can share the same job / unit / stage (since 2026-10-18 internal reviews
// don't need an external one), so the lookup must name the type explicitly.
const EXTERNAL_ONLY = "(UPPER(review_type) = 'EXTERNAL' OR review_type IS NULL)";

async function resolveInitiationId(jobNo, unitNo, stage) {
    const result = await pool.query(
        `SELECT id FROM model_review_initiations
         WHERE job_no = $1 AND unit_no = $2 AND stage = $3 AND ${EXTERNAL_ONLY}`,
        [jobNo, unitNo, stage]
    );
    if (result.rows.length === 0) {
        return { error: "No external review has been initiated for this job/unit/stage." };
    }
    if (result.rows.length > 1) {
        return { error: "Multiple external reviews exist for this job/unit/stage — contact PEM." };
    }
    return { id: result.rows[0].id };
}

// ===============================
// 1️⃣ Get Prerequisites By Stage
// ===============================
router.get("/prerequisites/:stage", authenticateToken, authorize("LE"), async (req, res) => {
    try {
        const { stage } = req.params;

        const department = req.user.department;

        const result = await pool.query(
            `SELECT id, prerequisite_text, department
             FROM stage_prerequisites_master
             WHERE stage_name = $1
               AND LOWER(department) = LOWER($2)
             ORDER BY id`,
            [stage, department]
        );

        res.json(result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load prerequisites" });
    }
});

// ===============================
// GET EXISTING REVIEW
// ===============================

router.get("/", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {

    const { jobNo, unitNo, stage } = req.query;
    const department = req.user.department;

    try {

        // Initiation data — always returned (PEM is authority on dates/description).
        // A job/unit/stage with two initiations (internal + external) is a soft
        // miss here rather than a hard error: this is a read, so fall back to
        // "no review" instead of guessing which initiation the caller means.
        const initResult = await pool.query(
            `SELECT id, description, review_date_from, review_date_to,
                    COALESCE(qr_generated, false) AS qr_generated
             FROM model_review_initiations
             WHERE job_no = $1 AND unit_no = $2 AND stage = $3 AND ${EXTERNAL_ONLY}`,
            [jobNo, unitNo, stage]
        );
        const initiationRow = initResult.rows.length === 1 ? initResult.rows[0] : null;
        const initiation = initiationRow
            ? {
                description: initiationRow.description,
                review_date_from: initiationRow.review_date_from,
                review_date_to: initiationRow.review_date_to,
                qr_generated: initiationRow.qr_generated,
              }
            : null;

        // Review record for this department
        const reviewResult = initiationRow
            ? await pool.query(
                `SELECT id, status, is_locked, submitted_at
                 FROM review_prerequisites_submissions
                 WHERE initiation_id = $1 AND department = $2`,
                [initiationRow.id, department]
              )
            : { rows: [] };

        // Prerequisite verifications (all departments)
        const prereqResult = await pool.query(
            `SELECT prerequisite_text, department, is_accepted, exception_reason
             FROM prerequisite_verifications
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3
             ORDER BY department`,
            [jobNo, unitNo, stage]
        );

        if (reviewResult.rows.length === 0) {
            return res.json({
                exists: false,
                prerequisites: prereqResult.rows,
                initiation
            });
        }

        res.json({
            exists: true,
            review: reviewResult.rows[0],
            prerequisites: prereqResult.rows,
            initiation
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch review" });
    }
});

// ===============================
// SAVE REVIEW
// ===============================
router.post("/save", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
    try {
        const { jobNo, unitNo, stage, prerequisites } = req.body;

        const department = req.user.department;

        const initiationMatch = await resolveInitiationId(jobNo, unitNo, stage);
        if (initiationMatch.error) {
            return res.status(400).json({ success: false, message: initiationMatch.error });
        }
        const initiationId = initiationMatch.id;

        // Check if review exists for this department
        const existing = await pool.query(
            `SELECT id FROM review_prerequisites_submissions
             WHERE initiation_id = $1 AND department = $2`,
            [initiationId, department]
        );

        let reviewId;

        if (existing.rows.length > 0) {

            reviewId = existing.rows[0].id;

            // Check if already locked
            const lockCheck = await pool.query(
                `SELECT is_locked FROM review_prerequisites_submissions WHERE id = $1`,
                [reviewId]
            );

            if (lockCheck.rows[0].is_locked) {
                return res.status(400).json({
                    success: false,
                    message: "Review already submitted. Editing not allowed."
                });
            }

            await pool.query(
                `UPDATE review_prerequisites_submissions
                 SET updated_at = CURRENT_TIMESTAMP, updated_by = $1
                 WHERE id = $2`,
                [req.user.employeeId, reviewId]
            );

        } else {

            const insert = await pool.query(
                `INSERT INTO review_prerequisites_submissions
                 (initiation_id, department, status, is_locked, created_by)
                 VALUES ($1,$2,'Draft',false,$3)
                 RETURNING id`,
                [initiationId, department, req.user.employeeId]
            );

            reviewId = insert.rows[0].id;
        }

        // Upsert prerequisite verifications (cross-department, keyed by job/unit/stage/dept/text)
        for (let item of prerequisites) {
            await pool.query(
                `INSERT INTO prerequisite_verifications
                 (job_no, unit_no, stage_name, prerequisite_text, department, is_accepted, exception_reason, verified_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (job_no, unit_no, stage_name, department, prerequisite_text)
                 DO UPDATE SET
                   is_accepted      = EXCLUDED.is_accepted,
                   exception_reason = EXCLUDED.exception_reason,
                   verified_by      = EXCLUDED.verified_by,
                   updated_at       = CURRENT_TIMESTAMP`,
                [
                    jobNo,
                    unitNo,
                    stage,
                    item.text,
                    item.department,
                    item.isFulfilled,
                    item.explanation || null,
                    req.user.employeeId
                ]
            );
        }

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

router.post("/submit", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {
    try {
        const { jobNo, unitNo, stage } = req.body;
        const department = req.user.department;

        const initiationMatch = await resolveInitiationId(jobNo, unitNo, stage);
        if (initiationMatch.error) {
            return res.status(400).json({ success: false, message: initiationMatch.error });
        }
        const initiationId = initiationMatch.id;

        const reviewCheck = await pool.query(
            `SELECT id, is_locked FROM review_prerequisites_submissions
             WHERE initiation_id = $1 AND department = $2`,
            [initiationId, department]
        );

        if (reviewCheck.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please save review before submitting."
            });
        }

        if (reviewCheck.rows[0].is_locked) {
            return res.status(400).json({
                success: false,
                message: "Review already submitted."
            });
        }

        await pool.query(
            `UPDATE review_prerequisites_submissions
             SET status = 'Submitted',
                 is_locked = true,
                 submitted_at = CURRENT_TIMESTAMP,
                 updated_by = $1
             WHERE initiation_id = $2 AND department = $3`,
            [req.user.employeeId, initiationId, department]
        );

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ===============================
// GET SUBMITTED REVIEW FOR JE
// ===============================
router.get("/je-details", authenticateToken, requireReviewRole("JE", { sameDept: true }), async (req, res) => {
    const { jobNo, unitNo, stage } = req.query;
    const department = req.user.department;

    if (!jobNo || !unitNo || !stage) {
        return res.status(400).json({ message: "jobNo, unitNo and stage are required" });
    }

    try {
        // Soft match, like GET / — an ambiguous (internal + external) or
        // missing initiation just means "not submitted" for this read-only check.
        const initiationMatch = await resolveInitiationId(jobNo, unitNo, stage);
        if (initiationMatch.error) {
            return res.json({ submitted: false });
        }

        // from_date/to_date/description live on the initiation, not the
        // submission (dropped from this table earlier — this query used to
        // select them from here and would have errored on first use).
        const result = await pool.query(
            `SELECT mri.review_date_from AS from_date, mri.review_date_to AS to_date,
                    mri.description, rps.submitted_at
             FROM review_prerequisites_submissions rps
             JOIN model_review_initiations mri ON mri.id = rps.initiation_id
             WHERE rps.initiation_id = $1
             AND rps.department = $2
             AND rps.status = 'Submitted'
             AND rps.is_locked = true`,
            [initiationMatch.id, department]
        );

        if (result.rows.length === 0) {
            return res.json({ submitted: false });
        }

        res.json({ submitted: true, review: result.rows[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch review details" });
    }
});

router.post("/edit", authenticateToken, requireReviewRole("LE", { sameDept: true }), async (req, res) => {

    const { jobNo, unitNo, stage } = req.body;
    const department = req.user.department;

    try {

        const initiationMatch = await resolveInitiationId(jobNo, unitNo, stage);
        if (initiationMatch.error) {
            return res.status(400).json({ error: initiationMatch.error });
        }
        const initiationId = initiationMatch.id;

        // Block edit if QR has already been generated for this review
        const initCheck = await pool.query(
            `SELECT COALESCE(qr_generated, false) AS qr_generated
             FROM model_review_initiations
             WHERE id = $1`,
            [initiationId]
        );

        if (initCheck.rows.length > 0 && initCheck.rows[0].qr_generated) {
            return res.status(403).json({
                error: "Editing not allowed. Attendance QR has already been generated for this review."
            });
        }

        const review = await pool.query(
            `SELECT id FROM review_prerequisites_submissions
             WHERE initiation_id = $1 AND department = $2`,
            [initiationId, department]
        );

        if (review.rows.length === 0) {
            return res.status(400).json({ error: "Review not found" });
        }

        await pool.query(
            `UPDATE review_prerequisites_submissions
             SET is_locked = false,
                 status = 'Draft'
             WHERE initiation_id = $1 AND department = $2`,
            [initiationId, department]
        );

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Edit unlock failed" });
    }
});


module.exports = router;
