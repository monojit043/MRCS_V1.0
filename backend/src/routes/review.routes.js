const express = require("express");
const router = express.Router();
const pool = require("../data/db"); // adjust if file name different
const { authenticateToken, authorize } = require("../middleware/auth.middleware");

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

router.get("/", authenticateToken, authorize("LE"), async (req, res) => {

    const { jobNo, unitNo, stage } = req.query;
    const department = req.user.department;

    try {

        // Review record for this department
        const reviewResult = await pool.query(
            `SELECT id, status, is_locked, submitted_at
             FROM model_reviews
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3 AND department = $4`,
            [jobNo, unitNo, stage, department]
        );

        // Prerequisite verifications (all departments)
        const prereqResult = await pool.query(
            `SELECT prerequisite_text, department, is_accepted, exception_reason
             FROM prerequisite_verifications
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3
             ORDER BY department`,
            [jobNo, unitNo, stage]
        );

        // Initiation data — always returned (PEM is authority on dates/description)
        const initResult = await pool.query(
            `SELECT description, review_date_from, review_date_to,
                    COALESCE(qr_generated, false) AS qr_generated
             FROM model_review_initiations
             WHERE job_no = $1 AND unit_no = $2 AND stage = $3`,
            [jobNo, unitNo, stage]
        );
        const initiation = initResult.rows[0] || null;

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
router.post("/save", authenticateToken, authorize("LE"), async (req, res) => {
    try {
        const { jobNo, unitNo, stage, prerequisites } = req.body;

        const department = req.user.department;

        // Check if review exists for this department
        const existing = await pool.query(
            `SELECT id FROM model_reviews
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3 AND department = $4`,
            [jobNo, unitNo, stage, department]
        );

        let reviewId;

        if (existing.rows.length > 0) {

            reviewId = existing.rows[0].id;

            // Check if already locked
            const lockCheck = await pool.query(
                `SELECT is_locked FROM model_reviews WHERE id = $1`,
                [reviewId]
            );

            if (lockCheck.rows[0].is_locked) {
                return res.status(400).json({
                    success: false,
                    message: "Review already submitted. Editing not allowed."
                });
            }

            await pool.query(
                `UPDATE model_reviews
                 SET updated_at = CURRENT_TIMESTAMP, updated_by = $1
                 WHERE id = $2`,
                [req.user.employeeId, reviewId]
            );

        } else {

            const insert = await pool.query(
                `INSERT INTO model_reviews
                 (job_no, unit_no, stage_name, department, status, is_locked, created_by)
                 VALUES ($1,$2,$3,$4,'Draft',false,$5)
                 RETURNING id`,
                [jobNo, unitNo, stage, department, req.user.employeeId]
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

router.post("/submit", authenticateToken, authorize("LE"), async (req, res) => {
    try {
        const { jobNo, unitNo, stage } = req.body;
        const department = req.user.department;

        const reviewCheck = await pool.query(
            `
            SELECT id, is_locked
            FROM model_reviews
            WHERE job_no = $1
            AND unit_no = $2
            AND stage_name = $3
            AND department = $4
            `,
            [jobNo, unitNo, stage, department]
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
            `
            UPDATE model_reviews
            SET status = 'Submitted',
                is_locked = true,
                submitted_at = CURRENT_TIMESTAMP,
                updated_by = $1
            WHERE job_no = $2
            AND unit_no = $3
            AND stage_name = $4
            AND department = $5
            `,
            [req.user.employeeId, jobNo, unitNo, stage, department]
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
router.get("/je-details", authenticateToken, authorize("JE"), async (req, res) => {
    const { jobNo, unitNo, stage } = req.query;
    const department = req.user.department;

    if (!jobNo || !unitNo || !stage) {
        return res.status(400).json({ message: "jobNo, unitNo and stage are required" });
    }

    try {
        const result = await pool.query(
            `SELECT from_date, to_date, description, submitted_at
             FROM model_reviews
             WHERE job_no = $1
             AND unit_no = $2
             AND stage_name = $3
             AND department = $4
             AND status = 'Submitted'
             AND is_locked = true`,
            [jobNo, unitNo, stage, department]
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

router.post("/edit", authenticateToken, authorize("LE"), async (req, res) => {

    const { jobNo, unitNo, stage } = req.body;
    const department = req.user.department;

    try {

        // Block edit if QR has already been generated for this review
        const initCheck = await pool.query(
            `SELECT COALESCE(qr_generated, false) AS qr_generated
             FROM model_review_initiations
             WHERE job_no = $1 AND unit_no = $2 AND stage = $3`,
            [jobNo, unitNo, stage]
        );

        if (initCheck.rows.length > 0 && initCheck.rows[0].qr_generated) {
            return res.status(403).json({
                error: "Editing not allowed. Attendance QR has already been generated for this review."
            });
        }

        const review = await pool.query(
            `SELECT id FROM model_reviews
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3 AND department = $4`,
            [jobNo, unitNo, stage, department]
        );

        if (review.rows.length === 0) {
            return res.status(400).json({ error: "Review not found" });
        }

        await pool.query(
            `UPDATE model_reviews
             SET is_locked = false,
                 status = 'Draft'
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3 AND department = $4`,
            [jobNo, unitNo, stage, department]
        );

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Edit unlock failed" });
    }
});


module.exports = router;
