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

// Uploaded files only for signed-in users with a role on the file's review (src/middleware/protectUploads.js)
app.use("/uploads", require("./src/middleware/protectUploads"), express.static(path.join(__dirname, "uploads")));

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

// Live PIMS lookups (jobs, master units, stages) for review forms — read from PC-2
const pimsRoutes = require("./src/routes/pims.routes");
app.use("/api/pims", pimsRoutes);

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

    // model_reviews renamed for clarity — it's really a per-department
    // submission/lock-status row tied to a model_review_initiations row, not
    // a free-standing "review". Guarded via to_regclass so it only fires once;
    // on every later boot the old name no longer exists and this no-ops.
    const { rows: oldReviewsTable } = await pool.query(`SELECT to_regclass('public.model_reviews') AS exists`);
    if (oldReviewsTable[0].exists) {
      await pool.query(`ALTER TABLE model_reviews RENAME TO review_prerequisites_submissions`);
      console.log("✅ model_reviews renamed to review_prerequisites_submissions");
    }

    // Remove date/description columns from review_prerequisites_submissions (now owned by initiation)
    await pool.query(`ALTER TABLE review_prerequisites_submissions DROP COLUMN IF EXISTS from_date`);
    await pool.query(`ALTER TABLE review_prerequisites_submissions DROP COLUMN IF EXISTS to_date`);
    await pool.query(`ALTER TABLE review_prerequisites_submissions DROP COLUMN IF EXISTS description`);
    console.log("✅ review_prerequisites_submissions schema cleaned");

    // Link each submission to the initiation it belongs to — previously only
    // matched loosely by job_no/unit_no/stage text, with no real FK, which
    // silently broke whenever a job/unit/stage had two initiations (internal
    // + external). Nullable: some legacy rows don't match any initiation at
    // all (old test data, or stage text like "30" vs "30%") and stay unlinked
    // rather than being guessed at or deleted.
    await pool.query(`
      ALTER TABLE review_prerequisites_submissions
      ADD COLUMN IF NOT EXISTS initiation_id INTEGER REFERENCES model_review_initiations(id)
    `);

    // One-time: backfill unambiguous matches, delete whatever's left (confirmed
    // stale legacy test data — predates the "%" stage-naming convention every
    // real initiation uses, e.g. "30" instead of "30%"), then drop the now-
    // redundant text columns entirely. Guarded on job_no still existing, so
    // this whole block fires exactly once; after the columns are dropped it
    // no-ops forever.
    const { rows: jobNoColCheck } = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'review_prerequisites_submissions' AND column_name = 'job_no'
    `);
    if (jobNoColCheck.length > 0) {
      await pool.query(`
        UPDATE review_prerequisites_submissions rps
        SET initiation_id = matched.id
        FROM (
          SELECT mri.id, mri.job_no, mri.unit_no, mri.stage
          FROM model_review_initiations mri
          WHERE (
            SELECT COUNT(*) FROM model_review_initiations mri2
            WHERE mri2.job_no = mri.job_no AND mri2.unit_no = mri.unit_no AND mri2.stage = mri.stage
          ) = 1
        ) matched
        WHERE rps.initiation_id IS NULL
          AND rps.job_no = matched.job_no AND rps.unit_no = matched.unit_no AND rps.stage_name = matched.stage
      `);
      const deleted = await pool.query(`DELETE FROM review_prerequisites_submissions WHERE initiation_id IS NULL`);
      console.log(`✅ removed ${deleted.rowCount} orphaned legacy review_prerequisites_submissions row(s) with no matching initiation`);
      await pool.query(`ALTER TABLE review_prerequisites_submissions DROP COLUMN job_no`);
      await pool.query(`ALTER TABLE review_prerequisites_submissions DROP COLUMN unit_no`);
      await pool.query(`ALTER TABLE review_prerequisites_submissions DROP COLUMN stage_name`);
      await pool.query(`ALTER TABLE review_prerequisites_submissions ALTER COLUMN initiation_id SET NOT NULL`);
      console.log("✅ review_prerequisites_submissions normalized: job_no/unit_no/stage_name dropped, initiation_id is now NOT NULL");
    }

    const { rows: submissionsUniqueCheck } = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'review_prereq_submissions_init_dept_unique'`
    );
    if (submissionsUniqueCheck.length === 0) {
      await pool.query(`
        ALTER TABLE review_prerequisites_submissions
        ADD CONSTRAINT review_prereq_submissions_init_dept_unique UNIQUE (initiation_id, department)
      `);
      console.log("✅ review_prerequisites_submissions.initiation_id+department unique constraint added");
    }

    // jobs used to be a separate table, created freely on first upload with
    // no requirement that a review had been initiated, then anchoring
    // zones/uploaded_folders via jobs.id. Its own identity columns
    // (job_no/unit_no/review_stage/review_type) were never anything but a
    // duplicate of the initiation it was supposed to belong to — eliminated
    // entirely: zones/uploaded_folders now anchor straight to
    // model_review_initiations.id, and uploads require that initiation to
    // exist (enforced in upload.routes.js / internal.routes.js). Guarded on
    // the jobs table still existing, so this fires exactly once.
    const { rows: oldJobsTable } = await pool.query(`SELECT to_regclass('public.jobs') AS exists`);
    if (oldJobsTable[0].exists) {
      await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS initiation_id INTEGER REFERENCES model_review_initiations(id)`);
      await pool.query(`ALTER TABLE uploaded_folders ADD COLUMN IF NOT EXISTS initiation_id INTEGER REFERENCES model_review_initiations(id)`);
      await pool.query(`ALTER TABLE zones DROP COLUMN job_id`);
      await pool.query(`ALTER TABLE uploaded_folders DROP COLUMN job_id`);
      await pool.query(`ALTER TABLE uploaded_folders ALTER COLUMN initiation_id SET NOT NULL`);
      await pool.query(`DROP TABLE jobs`);
      console.log("✅ jobs table eliminated — zones/uploaded_folders now anchor directly to model_review_initiations");
    }

    // Internal reviews used to be system-wide singletons (one per
    // job/unit/stage, Piping-only) — now each department can run its own
    // internal review for the same job/unit/stage, isolated from every
    // other department's. External reviews stay department-less (PEM-owned,
    // still one per job/unit/stage). department is nullable because
    // external rows never set it.
    await pool.query(`ALTER TABLE model_review_initiations ADD COLUMN IF NOT EXISTS department VARCHAR(100)`);
    const { rows: mriOldConstraint } = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'mri_unique_per_type'`
    );
    if (mriOldConstraint.length > 0) {
      await pool.query(`ALTER TABLE model_review_initiations DROP CONSTRAINT mri_unique_per_type`);
      await pool.query(`
        CREATE UNIQUE INDEX mri_unique_external ON model_review_initiations (job_no, unit_no, stage)
        WHERE UPPER(review_type) = 'EXTERNAL'
      `);
      await pool.query(`
        CREATE UNIQUE INDEX mri_unique_internal_per_dept ON model_review_initiations (job_no, unit_no, stage, department)
        WHERE UPPER(review_type) = 'INTERNAL'
      `);
      console.log("✅ model_review_initiations.department added; internal reviews now unique per (job/unit/stage/department)");
    }

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
