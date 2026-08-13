const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const bcrypt = require("bcrypt");
const { authenticateToken, authorize } = require("../middleware/auth.middleware");

// ADD USER (LE and above)
router.post("/add-user", authenticateToken, authorize("LE"), async (req, res) => {
    try {
        const { employeeId, role, department, jobNo, unitNo, stage } = req.body;

        const callerDept = req.user.department?.toLowerCase();
        const isPEM = callerDept === "pem";

        if (!isPEM) {
            if (role !== "JE") {
                return res.status(403).json({ message: "You can only assign JE role" });
            }
            if (department?.toLowerCase() !== callerDept) {
                return res.status(403).json({ message: "You can only assign users to your own department" });
            }
        }

        // department arrives pre-cased from master_employees (e.g. "PEM"
        // uppercase, everything else lowercase) — don't re-case it.
        // department_check requires that exact casing.
        await pool.query(
            `INSERT INTO user_assignments
             (employee_id, role, department, job_no, unit_no, stage)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [employeeId, role, department, jobNo, unitNo, stage || null]
        );

        res.json({ message: "User assignment successful" });

    } catch (err) {
        console.error("ADD USER ERROR:", err.message);
        res.status(500).json({ message: "Failed to add assignment", detail: err.message });
    }
});

router.get("/employees",
    authenticateToken,
    authorize("LE"),
    async (req, res) => {
        try {
            const callerDept = req.user.department?.toLowerCase();
            const isPEM = callerDept === "pem";

            let result;
            if (isPEM) {
                result = await pool.query(
                    "SELECT employee_id, employee_name AS name, department FROM master_employees ORDER BY employee_name"
                );
            } else {
                result = await pool.query(
                    "SELECT employee_id, employee_name AS name, department FROM master_employees WHERE LOWER(department) = $1 ORDER BY employee_name",
                    [callerDept]
                );
            }
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ message: "Failed to fetch employees" });
        }
    }
);

router.get("/list-users", authenticateToken, authorize("LE"), async (req, res) => {
    try {
        const callerDept = req.user.department?.toLowerCase();
        const isPEM = callerDept === "pem";

        const result = isPEM
            ? await pool.query(`
                SELECT
                  ua.employee_id,
                  m.employee_name AS full_name,
                  ua.role,
                  ua.department,
                  ua.job_no,
                  ua.unit_no
                FROM user_assignments ua
                LEFT JOIN master_employees m ON ua.employee_id = m.employee_id
                ORDER BY ua.employee_id, ua.job_no, ua.unit_no
              `)
            : await pool.query(`
                SELECT
                  ua.employee_id,
                  m.employee_name AS full_name,
                  ua.role,
                  ua.department,
                  ua.job_no,
                  ua.unit_no
                FROM user_assignments ua
                LEFT JOIN master_employees m ON ua.employee_id = m.employee_id
                WHERE LOWER(ua.department) = $1
                ORDER BY ua.employee_id, ua.job_no, ua.unit_no
              `, [callerDept]);

        res.json(result.rows);

    } catch (err) {
        console.error("LIST USERS ERROR:", err);
        res.status(500).json({
            message: "Failed to fetch users",
            error: err.message
        });
    }
});

router.get("/employee/:id", authenticateToken, authorize("LE"), async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            "SELECT employee_id, employee_name, department FROM master_employees WHERE employee_id = $1",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Employee not found" });
        }

        res.json(result.rows[0]);

    } catch (err) {
        res.status(500).json({ message: "Failed to fetch employee" });
    }
});

router.get("/tags-summary",
    authenticateToken,
    authorize("GL"),
    async (req, res) => {
        try {

            const { jobNo, unitNo, stage } = req.query;

            if (!jobNo || !unitNo || !stage) {
                return res.status(400).json({
                    message: "jobNo, unitNo and stage required"
                });
            }

            const deptResult = await pool.query(
                `
                SELECT
                    ta.department,
                    COUNT(*) AS total,
            
                    COUNT(*) FILTER (
                        WHERE ta.resolution_status IS NULL
                        OR ta.resolution_status = 'NOT_STARTED'
                    ) AS not_started,
            
                    COUNT(*) FILTER (
                        WHERE ta.resolution_status = 'SAVED'
                    ) AS draft,
            
                    COUNT(*) FILTER (
                        WHERE ta.resolution_status = 'SUBMITTED'
                    ) AS pending_approval,
            
                    COUNT(*) FILTER (
                        WHERE ta.resolution_status = 'APPROVED'
                    ) AS approved,
            
                    COUNT(*) FILTER (
                        WHERE ta.resolution_status = 'REJECTED'
                    ) AS rejected
            
                FROM tag_assignments ta
            
                JOIN tags t ON ta.tag_id = t.id
                JOIN uploaded_folders uf ON t.folder_id = uf.id
                JOIN jobs j ON uf.job_id = j.id
            
                WHERE
                    j.job_no = $1
                    AND j.unit_no = $2
                    AND j.review_stage = $3
                    AND t.status = 'LOCKED'
            
                GROUP BY ta.department
                ORDER BY ta.department
                `,
                [jobNo, unitNo, stage]
            );

            // ✅ 2. OVERALL TAG SUMMARY (NEW)
            const overallResult = await pool.query(
                `
                SELECT
                    COUNT(*) AS total_tags,

                    COUNT(*) FILTER (
                        WHERE t.final_status = 'COMPLETED'
                    ) AS completed_tags,

                    COUNT(*) FILTER (
                        WHERE t.final_status = 'IN_PROGRESS'
                    ) AS in_progress_tags,

                    COUNT(*) FILTER (
                        WHERE t.final_status = 'NOT_STARTED'
                        OR t.final_status IS NULL
                    ) AS not_started_tags

                FROM tags t
                JOIN uploaded_folders uf ON t.folder_id = uf.id
                JOIN jobs j ON uf.job_id = j.id

                WHERE
                    j.job_no = $1
                    AND j.unit_no = $2
                    AND j.review_stage = $3
                    AND t.status = 'LOCKED'
                `,
                [jobNo, unitNo, stage]
            );

            res.json({
                summary: deptResult.rows,
                overall: overallResult.rows[0]
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({
                message: "Failed to fetch GL summary",
                error: err.message
            });
        }
    }
);

router.get("/review-summary", authenticateToken, authorize("GL"), async (req, res) => {
    try {

        const { jobNo, unitNo, stage } = req.query;

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({
                message: "jobNo, unitNo and stage required"
            });
        }

        // Model review status per department
        const reviewResult = await pool.query(
            `SELECT department, status, submitted_at
             FROM model_reviews
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3
             ORDER BY department`,
            [jobNo, unitNo, stage]
        );

        // Prerequisite acceptance counts per department (verified rows only)
        const prereqResult = await pool.query(
            `SELECT department,
                    COUNT(*)                                     AS total,
                    COUNT(*) FILTER (WHERE is_accepted = true)   AS accepted,
                    COUNT(*) FILTER (WHERE is_accepted = false)  AS not_accepted
             FROM prerequisite_verifications
             WHERE job_no = $1 AND unit_no = $2 AND stage_name = $3
             GROUP BY department
             ORDER BY department`,
            [jobNo, unitNo, stage]
        );

        // Master prereq counts per department (to calculate pending)
        const masterResult = await pool.query(
            `SELECT department, COUNT(*) AS master_total
             FROM stage_prerequisites_master
             WHERE stage_name = $1
             GROUP BY department`,
            [stage]
        );

        // Build lookup maps
        const prereqMap = {};
        prereqResult.rows.forEach(r => { prereqMap[r.department] = r; });

        const masterMap = {};
        masterResult.rows.forEach(r => { masterMap[r.department.toLowerCase()] = Number(r.master_total); });

        const calcPending = (dept, verifiedTotal) => {
            const masterTotal = masterMap[dept.toLowerCase()] || 0;
            return Math.max(0, masterTotal - verifiedTotal);
        };

        // Start from review rows and merge prereq counts
        const merged = reviewResult.rows.map(r => {
            const verifiedTotal = Number(prereqMap[r.department]?.total || 0);
            return {
                department:          r.department,
                status:              r.status,
                submitted_at:        r.submitted_at,
                prereq_total:        verifiedTotal,
                prereq_accepted:     Number(prereqMap[r.department]?.accepted     || 0),
                prereq_not_accepted: Number(prereqMap[r.department]?.not_accepted || 0),
                prereq_pending:      calcPending(r.department, verifiedTotal)
            };
        });

        // Add any departments that have prereq data but no model_review row yet
        const reviewedDepts = new Set(reviewResult.rows.map(r => r.department));
        prereqResult.rows.forEach(r => {
            if (!reviewedDepts.has(r.department)) {
                const verifiedTotal = Number(r.total);
                merged.push({
                    department:          r.department,
                    status:              "-",
                    submitted_at:        null,
                    prereq_total:        verifiedTotal,
                    prereq_accepted:     Number(r.accepted),
                    prereq_not_accepted: Number(r.not_accepted),
                    prereq_pending:      calcPending(r.department, verifiedTotal)
                });
            }
        });

        merged.sort((a, b) => a.department.localeCompare(b.department));

        res.json({ departments: merged });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load review summary" });
    }
});

// GET /api/admin/prerequisite-detail — initiation info + full prereq list with verification status
router.get("/prerequisite-detail", authenticateToken, authorize("GL"), async (req, res) => {
    try {
        const { jobNo, unitNo, stage } = req.query;

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({ message: "jobNo, unitNo and stage required" });
        }

        // Initiation details from PEM's initiation step
        const initResult = await pool.query(
            `SELECT description, review_date_from, review_date_to, created_at
             FROM model_review_initiations
             WHERE job_no = $1 AND unit_no = $2 AND stage = $3`,
            [jobNo, unitNo, stage]
        );

        // All master prerequisites for this stage LEFT JOIN current verification status
        const prereqResult = await pool.query(
            `SELECT
                spm.department,
                spm.prerequisite_text,
                pv.is_accepted,
                pv.exception_reason
             FROM stage_prerequisites_master spm
             LEFT JOIN prerequisite_verifications pv
                 ON pv.stage_name = spm.stage_name
                 AND pv.department  = spm.department
                 AND pv.prerequisite_text = spm.prerequisite_text
                 AND pv.job_no  = $1
                 AND pv.unit_no = $2
             WHERE spm.stage_name = $3
             ORDER BY spm.department, spm.id`,
            [jobNo, unitNo, stage]
        );

        res.json({
            initiation:    initResult.rows[0] || null,
            prerequisites: prereqResult.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch prerequisite detail" });
    }
});

module.exports = router;