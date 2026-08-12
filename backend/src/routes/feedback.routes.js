const express = require("express");
const router  = express.Router();
const pool    = require("../data/db");
const { authenticateToken } = require("../middleware/auth.middleware");

/* Ensure table exists; add employee_id column if upgrading from older schema */
pool.query(`
  CREATE TABLE IF NOT EXISTS feedback (
    id            SERIAL PRIMARY KEY,
    employee_id   VARCHAR(100),
    submitted_by  VARCHAR(100),
    user_role     VARCHAR(50),
    department    VARCHAR(50),
    category      VARCHAR(60) NOT NULL,
    message       TEXT        NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )
`).then(() =>
  pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100)`)
).catch(err => console.error("[feedback] table init error:", err.message));

/* POST /api/feedback — submit feedback */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { category, message } = req.body;
    if (!category || !message || !message.trim()) {
      return res.status(400).json({ error: "Category and message are required." });
    }

    const { employeeId, role, department } = req.user || {};

    /* Look up full name from master_employees */
    const nameRow = await pool.query(
      `SELECT employee_name FROM master_employees WHERE employee_id = $1`,
      [employeeId]
    );
    const fullName = nameRow.rows[0]?.employee_name || null;

    await pool.query(
      `INSERT INTO feedback (employee_id, submitted_by, user_role, department, category, message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [employeeId || null, fullName, role || null, department || null, category, message.trim()]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("[feedback] submit error:", err);
    res.status(500).json({ error: "Failed to save feedback." });
  }
});

/* GET /api/feedback/my — current user's own submissions */
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const { employeeId } = req.user || {};
    const result = await pool.query(
      `SELECT id, category, message, created_at
       FROM feedback
       WHERE employee_id = $1
       ORDER BY created_at DESC`,
      [employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[feedback] my list error:", err);
    res.status(500).json({ error: "Failed to fetch your feedback." });
  }
});

/* GET /api/feedback — list all (admin view) */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, employee_id, submitted_by, user_role, department, category, message, created_at
       FROM feedback ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[feedback] list error:", err);
    res.status(500).json({ error: "Failed to fetch feedback." });
  }
});

module.exports = router;
