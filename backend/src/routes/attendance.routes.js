const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const { randomUUID } = require("crypto");
// Attendance pages call these with plain fetch (no Bearer token) → the signed-in user
// comes from the shared single sign-on cookie. Generating a QR / viewing live attendance
// needs LE or GL on that review (PEM: all). /mark-attendance stays PUBLIC on purpose:
// visitors scan the QR on their phones; it is protected by the QR token instead.
const { authenticateCookie } = require("../middleware/auth.middleware");
const { isPEM, hasReviewRole, hasRoleOnJobUnit } = require("../services/reviewAccess");

// Generate QR
router.post("/generate-qr", authenticateCookie, async (req, res) => {
    const { job_no, unit_no } = req.body;

    if (!job_no || !unit_no) {
        return res.status(400).json({ success: false, message: "Missing job or unit" });
    }

    try {

        // 1. Auto-detect active stage from initiation date range
        const initiationResult = await pool.query(
            `SELECT id, stage FROM model_review_initiations
             WHERE job_no = $1 AND unit_no = $2
             AND (UPPER(review_type) = 'EXTERNAL' OR review_type IS NULL)   -- attendance is for external review meetings
             AND CURRENT_DATE BETWEEN review_date_from AND review_date_to
             LIMIT 1`,
            [job_no, unit_no]
        );

        if (initiationResult.rows.length === 0) {
            return res.json({ success: false, message: "No active review scheduled for today" });
        }

        const stage = initiationResult.rows[0].stage;
        const initiationId = initiationResult.rows[0].id;

        // Only LE / GL on THIS review (PEM: any) may generate its attendance QR
        if (!(await hasReviewRole(req.user, { jobNo: job_no, unitNo: unit_no, stage }, "LE"))) {
            return res.status(403).json({ success: false, message: `Access denied: you are not LE or above on ${job_no} / ${unit_no} / ${stage}` });
        }

        // 2. Required departments for this stage
        const deptResult = await pool.query(
            `SELECT DISTINCT LOWER(department) AS department
             FROM stage_prerequisites_master
             WHERE stage_name = $1`,
            [stage]
        );
        const requiredDepts = deptResult.rows.map(r => r.department);

        if (requiredDepts.length === 0) {
            return res.json({ success: false, message: "No prerequisites defined for this stage" });
        }

        // 3. Check all required departments have submitted
        const submittedResult = await pool.query(
            `SELECT LOWER(department) AS department
             FROM review_prerequisites_submissions
             WHERE initiation_id = $1
             AND is_locked = true AND LOWER(status) = 'submitted'`,
            [initiationId]
        );
        const submittedDepts = new Set(submittedResult.rows.map(r => r.department));
        const pendingDepts = requiredDepts.filter(d => !submittedDepts.has(d));

        if (pendingDepts.length > 0) {
            return res.json({
                success: false,
                message: `Pending review submissions from: ${pendingDepts.join(", ")}`
            });
        }

        // 4. Delete expired tokens
        await pool.query(`DELETE FROM attendance_qr_sessions WHERE expires_at < NOW()`);

        // 5. Delete existing active token for same job/unit
        await pool.query(
            `DELETE FROM attendance_qr_sessions WHERE job_no = $1 AND unit_no = $2`,
            [job_no, unit_no]
        );

        // 6. Generate new token with stage
        const qrToken = randomUUID();
        const result = await pool.query(
            `INSERT INTO attendance_qr_sessions
             (job_no, unit_no, stage, qr_token, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '3 minutes')
             RETURNING qr_token, expires_at`,
            [job_no, unit_no, stage, qrToken]
        );

        // 7. Lock prerequisites — no further edits allowed after QR generation
        await pool.query(
            `UPDATE model_review_initiations
             SET qr_generated = true
             WHERE job_no = $1 AND unit_no = $2 AND stage = $3`,
            [job_no, unit_no, stage]
        );

        return res.json({
            success: true,
            qr_token: result.rows[0].qr_token,
            expires_at: result.rows[0].expires_at
        });

    } catch (err) {
        console.error("QR generation error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// Mark Attendance
router.post("/mark-attendance", async (req, res) => {
    let { qr_token, name, phone_number, company_name, designation } = req.body;

    if (!qr_token || !name || !phone_number) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }
    // QR tokens are UUIDs — reject anything else cleanly instead of a database error
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(qr_token))) {
        return res.status(400).json({ success: false, message: "Invalid or expired QR code" });
    }

    try {

        name = name.trim().toLowerCase();
        phone_number = phone_number.replace(/\D/g, "");
        if (phone_number.length > 10) phone_number = phone_number.slice(-10);

        // Validate QR token
        const tokenCheck = await pool.query(
            `SELECT job_no, unit_no, stage
             FROM attendance_qr_sessions
             WHERE qr_token = $1 AND expires_at > NOW()`,
            [qr_token]
        );

        if (tokenCheck.rows.length === 0) {
            return res.json({ success: false, message: "QR expired or invalid" });
        }

        const { job_no, unit_no, stage } = tokenCheck.rows[0];

        await pool.query(
            `INSERT INTO attendance_logs
             (job_no, unit_no, stage, name, phone_number, company_name, designation, qr_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [job_no, unit_no, stage, name, phone_number, company_name, designation, qr_token]
        );

        return res.json({ success: true, message: "Attendance marked successfully" });

    } catch (err) {

        if (err.code === "23505") {
            return res.json({ success: false, message: "Attendance already marked for today" });
        }

        console.error("Attendance error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// Live Attendance
router.get("/live-attendance", authenticateCookie, async (req, res) => {
    const { job_no, unit_no } = req.query;

    if (!job_no || !unit_no) {
        return res.status(400).json({ success: false, message: "Missing job or unit" });
    }

    try {
        // Visitor names / phone numbers — only LE / GL on that job / unit (PEM: any)
        if (!(await hasRoleOnJobUnit(req.user, job_no, unit_no, "LE"))) {
            return res.status(403).json({ success: false, message: `Access denied: you are not LE or above on ${job_no} / ${unit_no}` });
        }

        const result = await pool.query(
            `SELECT name, phone_number, designation, company_name, scan_time
             FROM attendance_logs
             WHERE job_no = $1 AND unit_no = $2
             AND attendance_date = CURRENT_DATE
             ORDER BY scan_time DESC`,
            [job_no, unit_no]
        );

        return res.json({ success: true, count: result.rows.length, records: result.rows });

    } catch (err) {
        console.error("Live attendance error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// Valid sessions for attendance modal dropdown
router.get("/valid-sessions", authenticateCookie, async (req, res) => {
    try {

        // Initiations where today falls in the review date range — only those where
        // the user is LE / GL (they are the ones who run attendance); PEM: all
        const initiations = await pool.query(
            `SELECT mri.id, mri.job_no, mri.unit_no, mri.stage
             FROM model_review_initiations mri
             WHERE CURRENT_DATE BETWEEN mri.review_date_from AND mri.review_date_to
               AND (UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)
               AND ($1 OR EXISTS (
                   SELECT 1 FROM effective_assignments ua
                   WHERE UPPER(ua.employee_id) = UPPER($2)
                     AND ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
                     AND (ua.stage = mri.stage OR ua.stage IS NULL)
                     AND ua.role IN ('GL', 'LE')))
             ORDER BY mri.job_no, mri.unit_no`,
            [isPEM(req.user), req.user.employeeId]
        );

        const validSessions = [];

        for (const init of initiations.rows) {

            // Required departments for this stage
            const deptResult = await pool.query(
                `SELECT DISTINCT LOWER(department) AS department
                 FROM stage_prerequisites_master
                 WHERE stage_name = $1`,
                [init.stage]
            );
            const requiredDepts = deptResult.rows.map(r => r.department);
            if (requiredDepts.length === 0) continue;

            // Submitted departments
            const submittedResult = await pool.query(
                `SELECT LOWER(department) AS department
                 FROM review_prerequisites_submissions
                 WHERE initiation_id = $1
                 AND is_locked = true AND LOWER(status) = 'submitted'`,
                [init.id]
            );
            const submittedDepts = new Set(submittedResult.rows.map(r => r.department));

            if (requiredDepts.every(d => submittedDepts.has(d))) {
                validSessions.push({ job_no: init.job_no, unit_no: init.unit_no });
            }
        }

        res.json({ success: true, sessions: validSessions });

    } catch (err) {
        console.error("Fetch sessions error:", err);
        res.status(500).json({ success: false });
    }
});

module.exports = router;
