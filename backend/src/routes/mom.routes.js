const express = require("express");
const router  = express.Router();
const pool    = require("../data/db");
const { authenticateToken, authorize } = require("../middleware/auth.middleware");

// GET — load points for a review
router.get("/", authenticateToken, authorize("LE"), async (req, res) => {
    const { jobNo, unitNo, stage } = req.query;
    if (!jobNo || !unitNo || !stage) {
        return res.status(400).json({ message: "jobNo, unitNo and stage are required" });
    }
    try {
        const result = await pool.query(
            `SELECT sl_no, description, to_be_closed_by
             FROM mom_points
             WHERE job_no = $1 AND unit_no = $2 AND stage = $3
             ORDER BY sl_no`,
            [jobNo, unitNo, stage]
        );
        res.json({ points: result.rows });
    } catch (err) {
        console.error("MOM load error:", err);
        res.status(500).json({ message: "Failed to load MOM" });
    }
});

// POST — save points for a review (replace all)
router.post("/save", authenticateToken, authorize("LE"), async (req, res) => {
    const { jobNo, unitNo, stage, points } = req.body;
    if (!jobNo || !unitNo || !stage) {
        return res.status(400).json({ message: "jobNo, unitNo and stage are required" });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            `DELETE FROM mom_points WHERE job_no = $1 AND unit_no = $2 AND stage = $3`,
            [jobNo, unitNo, stage]
        );
        const rows = Array.isArray(points) ? points : [];
        for (let i = 0; i < rows.length; i++) {
            const p = rows[i];
            await client.query(
                `INSERT INTO mom_points (job_no, unit_no, stage, sl_no, description, to_be_closed_by)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [jobNo, unitNo, stage, i + 1, p.description || "", p.to_be_closed_by || ""]
            );
        }
        await client.query("COMMIT");
        res.json({ success: true });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("MOM save error:", err);
        res.status(500).json({ success: false, message: "Failed to save MOM" });
    } finally {
        client.release();
    }
});

module.exports = router;
