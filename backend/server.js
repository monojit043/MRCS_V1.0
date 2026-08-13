require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const os = require("os");

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const pool = require("./src/data/db");
const PORT = process.env.PORT || 5500;

const app = express();

app.use(cors());
app.use(express.json());

// Normalise job/unit identifiers to uppercase on every request
app.use((req, res, next) => {
  const keys = ["jobNo", "unitNo", "job", "unit"];
  keys.forEach(k => {
    if (req.query[k]) req.query[k] = req.query[k].trim().toUpperCase();
    if (req.body && req.body[k]) req.body[k] = req.body[k].trim().toUpperCase();
  });
  next();
});

// Serve frontend
app.use(express.static(path.join(__dirname, "../public")));

// Expose server's LAN IP so the QR code works on phones
app.get("/api/server-info", (req, res) => {
  res.json({ ip: getLocalIP(), port: PORT });
});

// Health check (API + DB)
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT 1");
    res.json({
      message: "Server & DB are running properly 🚀",
      db: "connected",
    });
  } catch (err) {
    res.status(500).json({
      message: "DB connection failed ❌",
      error: err.message,
    });
  }
});
const uploadRoutes = require("./src/routes/upload.routes");

app.use("/api", uploadRoutes);

const tagRoutes = require("./src/routes/tag.routes");
app.use("/api", tagRoutes);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const reviewRoutes = require("./src/routes/review.routes");
app.use("/api/review", reviewRoutes);

const attendanceRoutes = require("./src/routes/attendance.routes");
app.use("/api/attendance", attendanceRoutes);

const reportRoutes = require("./src/routes/report");
app.use("/api/report", reportRoutes);

const authRoutes = require("./src/routes/auth.routes");
app.use("/api/auth", authRoutes);


const { authenticateToken, authorize } = require("./src/middleware/auth.middleware");

app.get(
  "/api/test-protected",
  authenticateToken,
  authorize("LE"),
  (req, res) => {
    res.json({
      message: "Access granted",
      role: req.user.role,
      department: req.user.department
    });
  }
);

const adminRoutes = require("./src/routes/admin.routes");
app.use("/api/admin", adminRoutes);

const initiationRoutes = require("./src/routes/initiation.routes");
app.use("/api/initiation", initiationRoutes);

const momRoutes = require("./src/routes/mom.routes");
app.use("/api/mom", momRoutes);

const internalRoutes = require("./src/routes/internal.routes");
app.use("/api/internal", internalRoutes);

const feedbackRoutes = require("./src/routes/feedback.routes");
app.use("/api/feedback", feedbackRoutes);

// Catch URIError thrown by Express router when a URL contains a bare % (e.g. stage=30%)
app.use((err, req, res, next) => {
  if (err instanceof URIError) {
    return res.status(400).json({ message: "Bad request: malformed URL encoding" });
  }
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prerequisite_verifications (
        id               SERIAL PRIMARY KEY,
        job_no           VARCHAR(50)  NOT NULL,
        unit_no          VARCHAR(50)  NOT NULL,
        stage_name       VARCHAR(50)  NOT NULL,
        prerequisite_text TEXT        NOT NULL,
        department       VARCHAR(100) NOT NULL,
        is_accepted      BOOLEAN      NOT NULL DEFAULT false,
        exception_reason TEXT,
        verified_by      VARCHAR(50),
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (job_no, unit_no, stage_name, department, prerequisite_text)
      )
    `);
    console.log("✅ prerequisite_verifications table ready");

    // Remove date/description columns from model_reviews (now owned by initiation)
    await pool.query(`ALTER TABLE model_reviews DROP COLUMN IF EXISTS from_date`);
    await pool.query(`ALTER TABLE model_reviews DROP COLUMN IF EXISTS to_date`);
    await pool.query(`ALTER TABLE model_reviews DROP COLUMN IF EXISTS description`);
    console.log("✅ model_reviews schema cleaned");

    // Add stage column to attendance tables
    await pool.query(`ALTER TABLE attendance_qr_sessions ADD COLUMN IF NOT EXISTS stage VARCHAR(50)`);
    await pool.query(`ALTER TABLE attendance_logs        ADD COLUMN IF NOT EXISTS stage VARCHAR(50)`);
    console.log("✅ attendance tables stage column ready");

    // user_assignments' unique_assignment constraint was missing stage/department,
    // so the same person+role could never be assigned to a second stage of the
    // same job/unit. Widen it to match how the app actually scopes assignments.
    const { rows: uaConstraint } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'unique_assignment' AND conrelid = 'user_assignments'::regclass
    `);
    const needsFix = uaConstraint.length > 0 && !uaConstraint[0].def.includes("stage");
    if (needsFix) {
      await pool.query(`ALTER TABLE user_assignments DROP CONSTRAINT unique_assignment`);
      await pool.query(`
        ALTER TABLE user_assignments
        ADD CONSTRAINT unique_assignment UNIQUE (employee_id, role, job_no, unit_no, stage, department)
      `);
      console.log("✅ user_assignments unique_assignment constraint widened to include stage+department");
    } else {
      console.log("✅ user_assignments unique_assignment constraint already up to date");
    }

  } catch (err) {
    console.error("❌ initDB error:", err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await initDB();
});
