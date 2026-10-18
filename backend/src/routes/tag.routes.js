const multer = require("multer");
const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const { authenticateToken, authorize, requirePEM } = require("../middleware/auth.middleware");
const { sendTagAllocationNotification, sendTagReassignmentNotification } = require("../services/mailer");
// Roles are checked on the review being acted on (job/unit/stage), not globally
const { requireReviewRole, requireTagReviewRole } = require("../services/reviewAccess");

const resolutionStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const tagId = req.params.id;
        const uploadPath = `uploads/resolutions/${tagId}`;

        require("fs").mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, "resolved" + require("path").extname(file.originalname));
    },
});

const uploadResolution = multer({
    storage: resolutionStorage,
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            cb(new Error("Only image files allowed"));
        } else {
            cb(null, true);
        }
    },
});


router.get("/tags", authenticateToken, requirePEM, async (req, res) => {
    try {
        const { jobNo, unitNo, stage } = req.query;

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({
                message: "jobNo, unitNo and stage are required",
            });
        }

        const result = await pool.query(
            `SELECT
            t.id,
            t.tag_no,
            t.description,
            t.tag_date,
            t.view_name,
            t.status,
            t.original_snap_path,
            uf.folder_name,
            uf.model_file AS nwd_file_name,
            STRING_AGG(ta.department, ',') AS department
          FROM tags t
          JOIN uploaded_folders uf ON t.folder_id = uf.id
          JOIN model_review_initiations mri ON uf.initiation_id = mri.id
          LEFT JOIN tag_assignments ta ON ta.tag_id = t.id
          WHERE mri.job_no = $1
            AND mri.unit_no = $2
            AND mri.stage = $3
            AND UPPER(mri.review_type) = 'EXTERNAL'
          GROUP BY t.id, t.tag_no, t.description, t.tag_date, t.view_name, t.status, t.original_snap_path, uf.folder_name, uf.model_file
          ORDER BY
            CASE WHEN t.tag_no ~ '^[0-9]+$' THEN t.tag_no::bigint END ASC NULLS LAST,
            t.tag_no ASC
      `,
            [jobNo, unitNo, stage]
        );

        res.json({
            count: result.rows.length,
            tags: result.rows,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Failed to fetch tags",
            error: err.message,
        });
    }
});

router.post("/tags/lock", authenticateToken, requirePEM, async (req, res) => {
    try {
        const { updates, lockedBy } = req.body;

        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({
                message: "Invalid updates payload",
            });
        }

        for (let item of updates) {

            const { tagId, departments } = item;

            if (!departments || !Array.isArray(departments)) continue;

            // 1️⃣ Lock tag (same as before)
            await pool.query(
                `
                UPDATE tags
                SET status = 'LOCKED',
                    locked_by = $1,
                    locked_at = CURRENT_TIMESTAMP
                WHERE id = $2
                  AND status = 'NEW'
                `,
                [lockedBy || "Unknown", tagId]
            );

            // 2️⃣ Remove existing assignments (safety)
            await pool.query(
                `DELETE FROM tag_assignments WHERE tag_id = $1`,
                [tagId]
            );

            // 3️⃣ Insert multiple departments
            for (let dept of departments) {

                await pool.query(
                    `
                    INSERT INTO tag_assignments
                    (tag_id, department, resolution_status)
                    VALUES ($1, $2, 'NOT_STARTED')
                    `,
                    [tagId, dept.toLowerCase()]
                );
            }
        }

        res.json({
            message: "Tags locked with multiple departments successfully",
        });

        /* ── Notify assigned GL/LEs per department (fire-and-forget) ── */
        setImmediate(async () => {
            try {
                // Resolve job/unit/stage from the first tag that has departments
                const firstUpdate = updates.find(u => u.departments && u.departments.length > 0);
                if (!firstUpdate) return;

                const jobResult = await pool.query(
                    `SELECT mri.job_no, mri.unit_no, mri.stage
                     FROM tags t
                     JOIN uploaded_folders uf ON t.folder_id = uf.id
                     JOIN model_review_initiations mri ON uf.initiation_id = mri.id
                     WHERE t.id = $1`,
                    [firstUpdate.tagId]
                );
                if (jobResult.rows.length === 0) return;
                const { job_no, unit_no, stage } = jobResult.rows[0];

                // Allocator name
                const allocatorR = await pool.query(
                    `SELECT employee_name FROM master_employees WHERE employee_id = $1`,
                    [req.user.employeeId]
                );
                const allocatedByName = allocatorR.rows[0]?.employee_name || req.user.employeeId;

                // Build dept → [{ tag_no, description }] map from the batch
                const deptTagsMap = {};
                for (const update of updates) {
                    if (!update.departments || !update.departments.length) continue;
                    const tagR = await pool.query(
                        `SELECT tag_no, description FROM tags WHERE id = $1`,
                        [update.tagId]
                    );
                    const tag = tagR.rows[0];
                    if (!tag) continue;
                    for (const dept of update.departments) {
                        const key = dept.toLowerCase();
                        if (!deptTagsMap[key]) deptTagsMap[key] = [];
                        deptTagsMap[key].push(tag);
                    }
                }

                // For each department, find assigned GL/LEs and notify
                for (const [dept, tags] of Object.entries(deptTagsMap)) {
                    const assigneesR = await pool.query(
                        `SELECT DISTINCT ua.role, me.employee_name, me.email
                         FROM effective_assignments ua   -- stored + GL from PIMS (not the level>=17 population)
                         JOIN master_employees me ON me.employee_id = ua.employee_id
                         WHERE ua.job_no = $1 AND ua.unit_no = $2 AND (ua.stage = $3 OR ua.stage IS NULL)
                           AND ua.source IN ('assigned', 'pims')
                           AND LOWER(ua.department) = $4
                           AND ua.role IN ('GL', 'LE')
                           AND me.email IS NOT NULL AND me.email <> ''`,
                        [job_no, unit_no, stage, dept]
                    );
                    for (const assignee of assigneesR.rows) {
                        try {
                            await sendTagAllocationNotification(
                                { job_no, unit_no, stage },
                                { ...assignee, department: dept },
                                tags,
                                allocatedByName
                            );
                            console.log(`[MRCS Mailer] ✓ Tag allocation email sent to ${assignee.employee_name} <${assignee.email}> (${dept})`);
                        } catch (e) {
                            console.error(`[MRCS Mailer] ✗ Failed for ${assignee.email}:`, e.message);
                        }
                    }
                }
            } catch (mailErr) {
                console.error("[MRCS Mailer] Tag allocation notification error:", mailErr.message);
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Failed to lock tags",
            error: err.message,
        });
    }
});

router.get("/folders", authenticateToken, async (req, res) => {
    try {
        const { jobNo, unitNo, stage } = req.query;

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({
                message: "jobNo, unitNo and stage are required",
            });
        }

        // PEM GL/LE have full access; everyone else must be assigned to this review
        const dept  = (req.user?.department || "").toLowerCase();
        const role  = req.user?.role;
        const isPEM = dept === "pem" && ["GL", "LE"].includes(role);

        if (!isPEM) {
            const assignCheck = await pool.query(
                `SELECT 1 FROM effective_assignments
                 WHERE employee_id = $1 AND job_no = $2 AND unit_no = $3
                 LIMIT 1`,
                [req.user.employeeId, jobNo, unitNo]
            );
            if (assignCheck.rows.length === 0) {
                return res.status(403).json({
                    message: "Access denied: not assigned to this review",
                });
            }
        }

        const result = await pool.query(
            `
        SELECT
          uf.id,
          uf.folder_name,
          uf.model_file,
          uf.uploaded_at,
          mri.job_no,
          mri.unit_no,
          mri.stage AS review_stage,
          COALESCE(me.employee_name, uf.uploaded_by) AS uploaded_by_name,
          COUNT(t.id) AS tag_count,
          MIN(t.tag_date) AS model_review_date
        FROM uploaded_folders uf
        JOIN model_review_initiations mri ON uf.initiation_id = mri.id
        LEFT JOIN tags t ON t.folder_id = uf.id
        LEFT JOIN master_employees me ON me.employee_id = uf.uploaded_by
        WHERE mri.job_no = $1
          AND mri.unit_no = $2
          AND mri.stage = $3
          AND UPPER(mri.review_type) = 'EXTERNAL'
        GROUP BY uf.id, mri.job_no, mri.unit_no, mri.stage, me.employee_name, uf.uploaded_by
        ORDER BY uf.uploaded_at DESC
        `,
            [jobNo, unitNo, stage]
        );

        res.json({
            count: result.rows.length,
            folders: result.rows,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Failed to fetch folders",
            error: err.message,
        });
    }
});

const fs = require("fs");
const path = require("path");

router.delete("/folders/:folderId", authenticateToken, requirePEM, async (req, res) => {
    try {
        const { folderId } = req.params;

        // Get folder info first
        const folderResult = await pool.query(
            `
      SELECT
        uf.id,
        uf.folder_name,
        uf.storage_path,
        mri.job_no,
        mri.unit_no,
        mri.stage AS review_stage
      FROM uploaded_folders uf
      JOIN model_review_initiations mri ON uf.initiation_id = mri.id
      WHERE uf.id = $1
      `,
            [folderId]
        );

        if (folderResult.rows.length === 0) {
            return res.status(404).json({
                message: "Folder not found",
            });
        }

        const folderData = folderResult.rows[0];

        // Delete folder row (tags auto deleted via cascade)
        await pool.query(
            `DELETE FROM uploaded_folders WHERE id = $1`,
            [folderId]
        );

        // Delete physical files
        if (folderData.storage_path && fs.existsSync(folderData.storage_path)) {
            fs.rmSync(folderData.storage_path, { recursive: true, force: true });
        }

        res.json({
            message: "Folder and its tags deleted successfully",
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Failed to delete folder",
            error: err.message,
        });
    }
});

router.get("/job-engineer-tags", authenticateToken, requireReviewRole("JE", { sameDept: true }), async (req, res) => {
    try {

        const { jobNo, unitNo, stage } = req.query;
        const employeeId = req.user.employeeId;
        const department = req.user.department; // ✅ FIXED

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({ message: "jobNo, unitNo and stage required" });
        }

        // ✅ STRICT assignment validation
        const assignmentCheck = await pool.query(
            `
            SELECT 1
            FROM effective_assignments
            WHERE employee_id = $1
            AND job_no = $2
            AND unit_no = $3
            AND department = $4
            AND role IN ('JE','LE','GL')
            `,
            [employeeId, jobNo, unitNo, department]
        );

        if (assignmentCheck.rows.length === 0) {
            return res.status(403).json({ message: "No access to this job/unit/department" });
        }

        // ✅ Fetch department-specific assignments
        const result = await pool.query(
            `
            SELECT 
                t.id,
                t.tag_no,
                t.description,
                t.tag_date,
                t.view_name,
                t.zone,
                uf.model_file,

                ta.department,
                ta.resolution,
                ta.resolution_status,
                ta.resolved_snap_path,

                t.original_snap_path

            FROM tags t

            JOIN uploaded_folders uf
                ON t.folder_id = uf.id

            JOIN model_review_initiations mri
                ON uf.initiation_id = mri.id

            JOIN tag_assignments ta
                ON ta.tag_id = t.id

            WHERE
                mri.job_no = $1
                AND mri.unit_no = $2
                AND mri.stage = $3
                AND UPPER(mri.review_type) = 'EXTERNAL'
                AND t.status = 'LOCKED'
                AND ta.department = $4

            ORDER BY t.tag_no ASC
            `,
            [jobNo, unitNo, stage, department]
        );

        res.json({
            count: result.rows.length,
            tags: result.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch JE tags" });
    }
});

router.post("/tags/:id/save-resolution",
    authenticateToken,
    requireTagReviewRole("JE", { sameDept: true }),
    uploadResolution.single("resolvedSnap"),
    async (req, res) => {
        try {
            const tagId = req.params.id;
            const { resolution } = req.body;
            const employeeId = req.user.employeeId;

            // 🔥 IMPORTANT: department comes from logged-in user
            const department = req.user.department;

            // 1️⃣ Validate assignment
            const assignment = await pool.query(
                `
                SELECT 1 FROM effective_assignments
                WHERE employee_id = $1
                AND department = $2
                `,
                [employeeId, department]
            );

            if (assignment.rows.length === 0) {
                return res.status(403).json({
                    message: "No access to this department",
                });
            }

            // 2️⃣ Handle snap
            let snapPath = null;
            if (req.file) {
                snapPath = req.file.path.replace(/\\/g, "/");
            }

            // 3️⃣ Update ONLY this department row
            await pool.query(
                `
                UPDATE tag_assignments
                SET resolution = $1,
                    resolved_snap_path = COALESCE($2, resolved_snap_path),
                    resolution_status = CASE
                        WHEN resolution_status = 'SUBMITTED' THEN 'SUBMITTED'
                        ELSE 'SAVED'
                    END,
                    resolved_at = CURRENT_TIMESTAMP,
                    resolved_by = $3
                WHERE tag_id = $4
                AND department = $5
                `,
                [resolution, snapPath, employeeId, tagId, department]
            );

            res.json({
                message: "Resolution saved successfully",
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({
                message: "Failed to save resolution",
                error: err.message,
            });
        }
    }
);

router.post("/tags/:id/delete-snap",
    authenticateToken,
    requireTagReviewRole("JE", { sameDept: true }),
    async (req, res) => {
        try {

            const tagId = req.params.id;
            const department = req.user.department; // 🔥 important

            // 1️⃣ Fetch assignment row
            const result = await pool.query(
                `
                SELECT resolved_snap_path, resolution_status
                FROM tag_assignments
                WHERE tag_id = $1 AND department = $2
                `,
                [tagId, department]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    message: "Tag assignment not found"
                });
            }

            const tag = result.rows[0];

            // 🔒 Prevent deletion after submit/approval
            if (
                tag.resolution_status === "SUBMITTED" ||
                tag.resolution_status === "APPROVED"
            ) {
                return res.status(400).json({
                    message: "Cannot delete image after submission"
                });
            }

            const filePath = tag.resolved_snap_path;

            // 2️⃣ Delete file from server (if exists)
            if (filePath) {

                const fullPath = path.join(__dirname, "..", filePath);

                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                }
            }

            // 3️⃣ Update DB
            await pool.query(
                `
                UPDATE tag_assignments
                SET resolved_snap_path = NULL
                WHERE tag_id = $1 AND department = $2
                `,
                [tagId, department]
            );

            res.json({
                message: "Image removed successfully"
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({
                message: "Failed to delete image",
                error: err.message
            });
        }
    }
);

router.post("/tags/:id/submit-resolution",
    authenticateToken,
    requireTagReviewRole("JE", { sameDept: true }),
    async (req, res) => {
        try {
            const tagId = req.params.id;
            const employeeId = req.user.employeeId;
            const department = req.user.department;

            // 1️⃣ Get current assignment
            const assignment = await pool.query(
                `
                SELECT resolution, resolution_status
                FROM tag_assignments
                WHERE tag_id = $1
                AND department = $2
                `,
                [tagId, department]
            );

            if (assignment.rows.length === 0) {
                return res.status(404).json({
                    message: "Assignment not found",
                });
            }

            const data = assignment.rows[0];

            // 2️⃣ Validate
            if (!data.resolution) {
                return res.status(400).json({
                    message: "Please SAVE resolution before submitting.",
                });
            }

            if (data.resolution_status === "SUBMITTED") {
                return res.status(400).json({
                    message: "Already submitted",
                });
            }

            // 3️⃣ Submit only THIS department
            await pool.query(
                `
                UPDATE tag_assignments
                SET resolution_status = 'SUBMITTED',
                    resolved_at = CURRENT_TIMESTAMP,
                    resolved_by = $1
                WHERE tag_id = $2
                AND department = $3
                `,
                [employeeId, tagId, department]
            );

            res.json({
                message: "Resolution submitted successfully",
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({
                message: "Failed to submit resolution",
                error: err.message,
            });
        }
    }
);

router.get("/lead-review-tags",
    authenticateToken,
    requireReviewRole("LE"),
    async (req, res) => {
        try {
            const { jobNo, unitNo, stage } = req.query;
            const employeeId = req.user.employeeId;

            if (!jobNo || !unitNo || !stage) {
                return res.status(400).json({
                    message: "jobNo, unitNo and stage are required",
                });
            }

            // 1️⃣ Validate assignment for this job/unit
            const assignmentCheck = await pool.query(
                `
          SELECT department
          FROM effective_assignments
          WHERE employee_id = $1
          AND job_no = $2
          AND unit_no = $3
          AND role IN ('LE','GL')
          `,
                [employeeId, jobNo, unitNo]
            );

            if (assignmentCheck.rows.length === 0) {
                return res.status(403).json({
                    message: "No LE/GL access to this job/unit",
                });
            }

            const department = assignmentCheck.rows[0].department;

            // 2️⃣ Fetch only submitted tags of that department
            const result = await pool.query(
                `
                SELECT 
                    t.id,
                    t.tag_no,
                    t.description,
                    t.tag_date,
                    t.view_name,
                    t.zone,
                    uf.model_file,

                    ta.department,
                    ta.resolution,
                    ta.resolution_status,
                    ta.resolved_snap_path,

                    t.original_snap_path

                FROM tags t

                JOIN uploaded_folders uf ON t.folder_id = uf.id
                JOIN model_review_initiations mri ON uf.initiation_id = mri.id
                JOIN tag_assignments ta ON ta.tag_id = t.id

                WHERE
                    mri.job_no = $1
                    AND mri.unit_no = $2
                    AND mri.stage = $3
                    AND UPPER(mri.review_type) = 'EXTERNAL'
                    AND ta.department = $4

                ORDER BY t.tag_no ASC
                `,
                [jobNo, unitNo, stage, department]
            );

            res.json({
                count: result.rows.length,
                tags: result.rows,
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({
                message: "Failed to fetch lead review tags",
                error: err.message,
            });
        }
    }
);

router.post("/tags/:id/approve",
    authenticateToken,
    requireTagReviewRole("LE", { sameDept: true }),
    async (req, res) => {
        try {
            const tagId = req.params.id;
            const employeeId = req.user.employeeId;
            const { department } = req.body; // 🔥 NEW

            if (!department) {
                return res.status(400).json({ message: "Department required" });
            }

            // 1️⃣ Validate assignment
            const assignment = await pool.query(
                `
                SELECT 1 FROM effective_assignments
                WHERE employee_id = $1
                AND job_no = (
                    SELECT mri.job_no
                    FROM tags t
                    JOIN uploaded_folders uf ON t.folder_id = uf.id
                    JOIN model_review_initiations mri ON uf.initiation_id = mri.id
                    WHERE t.id = $2
                )
                AND unit_no = (
                    SELECT mri.unit_no
                    FROM tags t
                    JOIN uploaded_folders uf ON t.folder_id = uf.id
                    JOIN model_review_initiations mri ON uf.initiation_id = mri.id
                    WHERE t.id = $2
                )
                AND department = $3
                AND role IN ('LE','GL')
                `,
                [employeeId, tagId, department]
            );

            if (assignment.rows.length === 0) {
                return res.status(403).json({
                    message: "No approval rights",
                });
            }

            // 2️⃣ Approve ONLY that department
            await pool.query(
                `
                UPDATE tag_assignments
                SET resolution_status = 'APPROVED',
                    approved_by = $1,
                    approved_at = CURRENT_TIMESTAMP
                WHERE tag_id = $2
                AND department = $3
                `,
                [employeeId, tagId, department]
            );

            // 🔥 ENGINE: Check if all departments approved

            const check = await pool.query(
                `
                SELECT COUNT(*) AS pending_count
                FROM tag_assignments
                WHERE tag_id = $1
                AND resolution_status != 'APPROVED'
                `,
                [tagId]
            );

            const pendingCount = parseInt(check.rows[0].pending_count);

            if (pendingCount === 0) {
                // ✅ ALL APPROVED → COMPLETED
                await pool.query(
                    `
                    UPDATE tags
                    SET final_status = 'COMPLETED'
                    WHERE id = $1
                    `,
                    [tagId]
                );
            } else {
                // 🔄 STILL IN PROGRESS
                await pool.query(
                    `
                    UPDATE tags
                    SET final_status = 'IN_PROGRESS'
                    WHERE id = $1
                    `,
                    [tagId]
                );
            }

            res.json({ message: "Approved successfully" });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Approval failed" });
        }
    }
);

router.post("/tags/:id/reject",
    authenticateToken,
    requireTagReviewRole("LE", { sameDept: true }),
    async (req, res) => {
        try {
            const tagId = req.params.id;
            const { rejectionComment, department } = req.body;
            const employeeId = req.user.employeeId;

            if (!rejectionComment) {
                return res.status(400).json({
                    message: "Rejection comment required",
                });
            }

            if (!department) {
                return res.status(400).json({
                    message: "Department required",
                });
            }

            // 1️⃣ Reject only that department
            await pool.query(
                `
                UPDATE tag_assignments
                SET resolution_status = 'REJECTED',
                    rejection_comment = $1,
                    approved_by = $2,
                    approved_at = CURRENT_TIMESTAMP
                WHERE tag_id = $3
                AND department = $4
                `,
                [rejectionComment, employeeId, tagId, department]
            );

            // 🔥 ENGINE: On rejection → always IN_PROGRESS

            await pool.query(
                `
                UPDATE tags
                SET final_status = 'IN_PROGRESS'
                WHERE id = $1
                `,
                [tagId]
            );

            res.json({ message: "Rejected successfully" });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Rejection failed" });
        }
    }
);

router.get("/lead-review-history",
    authenticateToken,
    requireReviewRole("LE"),
    async (req, res) => {
        try {
            const { jobNo, unitNo, stage } = req.query;
            const employeeId = req.user.employeeId;

            if (!jobNo || !unitNo || !stage) {
                return res.status(400).json({
                    message: "jobNo, unitNo and stage required",
                });
            }

            // 1️⃣ Validate assignment
            const assignmentCheck = await pool.query(
                `
          SELECT department
          FROM effective_assignments
          WHERE employee_id = $1
          AND job_no = $2
          AND unit_no = $3
          AND role IN ('LE','GL')
          `,
                [employeeId, jobNo, unitNo]
            );

            if (assignmentCheck.rows.length === 0) {
                return res.status(403).json({
                    message: "No LE/GL access to this job/unit",
                });
            }

            const department = assignmentCheck.rows[0].department;

            // 2️⃣ Fetch approved & rejected tags
            const result = await pool.query(
                `
                SELECT
                    t.id,
                    t.tag_no,
                    t.description,
                    t.zone,
                    uf.model_file,
                    t.tag_date,
                    ta.resolution,
                    ta.resolution_status,
                    ta.approved_by,
                    ta.approved_at

                FROM tags t

                JOIN uploaded_folders uf ON t.folder_id = uf.id
                JOIN model_review_initiations mri ON uf.initiation_id = mri.id

                JOIN tag_assignments ta ON ta.tag_id = t.id

                WHERE
                    mri.job_no = $1
                    AND mri.unit_no = $2
                    AND mri.stage = $3
                    AND UPPER(mri.review_type) = 'EXTERNAL'
                    AND ta.department = $4
                    AND ta.resolution_status IN ('APPROVED','REJECTED')

                ORDER BY ta.approved_at DESC
                `,
                [jobNo, unitNo, stage, department]
            );

            res.json({
                count: result.rows.length,
                history: result.rows,
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({
                message: "Failed to fetch review history",
                error: err.message,
            });
        }
    }
);

router.get("/lead-review-summary",
    authenticateToken,
    requireReviewRole("LE"),
    async (req, res) => {
        try {
            const { jobNo, unitNo, stage } = req.query;
            const employeeId = req.user.employeeId;

            if (!jobNo || !unitNo || !stage) {
                return res.status(400).json({
                    message: "jobNo, unitNo and stage required",
                });
            }

            // 1️⃣ Validate assignment
            const assignmentCheck = await pool.query(
                `
          SELECT department
          FROM effective_assignments
          WHERE employee_id = $1
          AND job_no = $2
          AND unit_no = $3
          AND role IN ('LE','GL')
          `,
                [employeeId, jobNo, unitNo]
            );

            if (assignmentCheck.rows.length === 0) {
                return res.status(403).json({
                    message: "No LE/GL access to this job/unit",
                });
            }

            const department = assignmentCheck.rows[0].department;

            // 2️⃣ Fetch summary counts
            const result = await pool.query(
                `
                SELECT 
                    COUNT(*) AS total,
            
                    COUNT(*) FILTER (WHERE ta.resolution_status = 'SUBMITTED') AS pending_approval,
            
                    COUNT(*) FILTER (WHERE ta.resolution_status = 'APPROVED') AS approved,
            
                    COUNT(*) FILTER (WHERE ta.resolution_status = 'REJECTED') AS rejected,
            
                    COUNT(*) FILTER (WHERE ta.resolution_status = 'SAVED') AS draft,
            
                    COUNT(*) FILTER (
                        WHERE ta.resolution_status IS NULL 
                        OR ta.resolution_status = 'NOT_STARTED'
                    ) AS not_started
            
                FROM tags t

                JOIN uploaded_folders uf ON t.folder_id = uf.id
                JOIN model_review_initiations mri ON uf.initiation_id = mri.id

                JOIN tag_assignments ta ON ta.tag_id = t.id

                WHERE
                    mri.job_no = $1
                    AND mri.unit_no = $2
                    AND mri.stage = $3
                    AND UPPER(mri.review_type) = 'EXTERNAL'
                    AND ta.department = $4
                `,
                [jobNo, unitNo, stage, department]
            );

            res.json(result.rows[0]);

        } catch (err) {
            console.error(err);
            res.status(500).json({
                message: "Failed to fetch summary",
                error: err.message,
            });
        }
    }
);

router.post("/tags/:id/reassign",
    authenticateToken,
    requirePEM,
    async (req, res) => {
        try {
            const tagId = req.params.id;
            const { departments } = req.body;

            if (!departments || !Array.isArray(departments) || departments.length === 0) {
                return res.status(400).json({ message: "At least one department required" });
            }

            const requestedDepts = departments.map(d => d.toLowerCase());

            // 1. Resolve job/unit/stage for this tag
            const jobResult = await pool.query(
                `SELECT mri.job_no, mri.unit_no, mri.stage AS review_stage
                 FROM tags t
                 JOIN uploaded_folders uf ON t.folder_id = uf.id
                 JOIN model_review_initiations mri ON uf.initiation_id = mri.id
                 WHERE t.id = $1`,
                [tagId]
            );

            if (jobResult.rows.length === 0) {
                return res.status(404).json({ message: "Tag not found" });
            }

            const { job_no, unit_no, review_stage } = jobResult.rows[0];

            // 2. Block if the EXTERNAL review's CRS is already generated
            //    (a department's internal CRS for the same job/unit/stage doesn't count)
            const crsCheck = await pool.query(
                `SELECT 1 FROM crs_reports
                 WHERE job_no = $1 AND unit_no = $2 AND review_stage = $3 AND review_type = 'EXTERNAL'`,
                [job_no, unit_no, review_stage]
            );

            if (crsCheck.rows.length > 0) {
                return res.status(409).json({
                    message: "CRS report already generated for this job/unit/stage. Reassignment is no longer allowed."
                });
            }

            // 3. Get current department assignments
            const currentResult = await pool.query(
                `SELECT department FROM tag_assignments WHERE tag_id = $1`,
                [tagId]
            );
            const currentDepts = currentResult.rows.map(r => r.department);

            // 4. Compute diff — only touch what changed
            const toDelete = currentDepts.filter(d => !requestedDepts.includes(d));
            const toAdd = requestedDepts.filter(d => !currentDepts.includes(d));

            // 5. Remove dropped departments (their work is discarded)
            for (const dept of toDelete) {
                await pool.query(
                    `DELETE FROM tag_assignments WHERE tag_id = $1 AND department = $2`,
                    [tagId, dept]
                );
            }

            // 6. Add new departments as fresh NOT_STARTED (existing ones untouched)
            for (const dept of toAdd) {
                await pool.query(
                    `INSERT INTO tag_assignments (tag_id, department, resolution_status)
                     VALUES ($1, $2, 'NOT_STARTED')`,
                    [tagId, dept]
                );
            }

            // 7. Recalculate final_status based on remaining assignments
            await pool.query(
                `UPDATE tags SET final_status =
                    CASE
                        WHEN (SELECT COUNT(*) FROM tag_assignments
                              WHERE tag_id = $1 AND resolution_status != 'APPROVED') = 0
                            THEN 'COMPLETED'
                        ELSE 'IN_PROGRESS'
                    END
                 WHERE id = $1`,
                [tagId]
            );

            res.json({ message: "Tag reassigned successfully" });

            /* ── Notify newly assigned GL/LEs (fire-and-forget) ── */
            if (toAdd.length > 0) {
                setImmediate(async () => {
                    try {
                        const [tagR, reassignerR] = await Promise.all([
                            pool.query(`SELECT tag_no, description FROM tags WHERE id = $1`, [tagId]),
                            pool.query(`SELECT employee_name FROM master_employees WHERE employee_id = $1`, [req.user.employeeId])
                        ]);
                        const tag = tagR.rows[0];
                        const reassignedByName = reassignerR.rows[0]?.employee_name || req.user.employeeId;
                        if (!tag) return;

                        for (const dept of toAdd) {
                            const assigneesR = await pool.query(
                                `SELECT DISTINCT ua.role, me.employee_name, me.email
                                 FROM effective_assignments ua   -- stored + GL from PIMS (not the level>=17 population)
                                 JOIN master_employees me ON me.employee_id = ua.employee_id
                                 WHERE ua.job_no = $1 AND ua.unit_no = $2 AND (ua.stage = $3 OR ua.stage IS NULL)
                                   AND ua.source IN ('assigned', 'pims')
                                   AND LOWER(ua.department) = $4
                                   AND ua.role IN ('GL', 'LE')
                                   AND me.email IS NOT NULL AND me.email <> ''`,
                                [job_no, unit_no, review_stage, dept]
                            );
                            for (const assignee of assigneesR.rows) {
                                try {
                                    await sendTagReassignmentNotification(
                                        { job_no, unit_no, stage: review_stage },
                                        { ...assignee, department: dept },
                                        tag,
                                        reassignedByName
                                    );
                                    console.log(`[MRCS Mailer] ✓ Reassignment email sent to ${assignee.employee_name} <${assignee.email}> (${dept})`);
                                } catch (e) {
                                    console.error(`[MRCS Mailer] ✗ Failed for ${assignee.email}:`, e.message);
                                }
                            }
                        }
                    } catch (mailErr) {
                        console.error("[MRCS Mailer] Tag reassignment notification error:", mailErr.message);
                    }
                });
            }

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Failed to reassign tag", error: err.message });
        }
    }
);

module.exports = router;
