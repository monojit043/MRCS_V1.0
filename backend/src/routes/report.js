const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
// Reports are opened with window.open (no Bearer token) → signed-in user comes from the
// shared single sign-on cookie; access needs a role on THAT review (any role; PEM: all).
const { authenticateCookie } = require("../middleware/auth.middleware");
const { requireReviewRole, isPEM } = require("../services/reviewAccess");

// crs_reports records WHICH review a CRS was generated for (an external review and a
// department's internal review can share job / unit / stage). Self-migrating; the old
// unique (job, unit, stage) is replaced by one per review.
pool.query(`
  ALTER TABLE crs_reports ADD COLUMN IF NOT EXISTS review_type TEXT NOT NULL DEFAULT 'EXTERNAL';
  ALTER TABLE crs_reports ADD COLUMN IF NOT EXISTS department  TEXT NOT NULL DEFAULT '';
  ALTER TABLE crs_reports DROP CONSTRAINT IF EXISTS crs_reports_unique;
  CREATE UNIQUE INDEX IF NOT EXISTS crs_reports_unique_per_review
    ON crs_reports (job_no, unit_no, review_stage, review_type, department);
`).catch(err => console.error("crs_reports migration:", err.message));

// Which review a report covers.
//   default (external pages pass nothing)  → the EXTERNAL review
//   ?reviewType=internal                   → ONE department's internal review: the
//                                            caller's (PEM may pass ?department=)
// Without this, a report would mix external and internal tags, or several
// departments' internal tags, for the same job / unit / stage.
function reviewScope(req) {
  if (String(req.query.reviewType || "").toLowerCase() !== "internal") {
    return { type: "EXTERNAL", dept: "", clause: "AND (UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)", extra: [] };
  }
  const dept = String((isPEM(req.user) && req.query.department) || req.user.department || "").toLowerCase();
  return { type: "INTERNAL", dept, clause: "AND UPPER(mri.review_type) = 'INTERNAL' AND LOWER(mri.department) = $4", extra: [dept] };
}

// ===============================
// LAYOUT CONSTANTS
// ===============================
const M = 40;                     // Page margin
const HEADER_H = 72;              // Header height
const FOOTER_H = 32;              // Footer height
const INFO_H = 52;                // Tag info bar height
const GAP = 12;                   // Standard gap
const COL_GAP = 16;               // Gap between left/right columns
const RULE_COLOR = "#444444";     // Main rule line color
const LIGHT_RULE = "#BBBBBB";     // Light divider color
const TEXT_DARK = "#111111";
const TEXT_MID = "#444444";
const TEXT_LIGHT = "#888888";
const ACCENT = "#1A1A2E";         // Navy accent (used sparingly)

const DEPT_COLORS = {
    piping: "#1E88E5",       // blue
    civil: "#43A047",        // green
    electrical: "#FB8C00",   // orange
    mechanical: "#8E24AA",   // purple
    instrumentation: "#00897B", // teal
    default: "#546E7A"       // grey fallback
};

// ===============================
// ROUTE
// ===============================
router.get("/generate-pdf", authenticateCookie, requireReviewRole("JE"), async (req, res) => {
    try {
        const { job, unit, stage, reviewType } = req.query;

        if (!job || !unit || !stage) {
            return res.status(400).json({ error: "Missing parameters" });
        }

        /* Which review: external (default) or the caller's department's internal review */
        const scope    = reviewScope(req);
        const rtClause = scope.clause;
        const params4  = [job, unit, stage, ...scope.extra];

        const pendingCheck = await pool.query(
            `SELECT COUNT(*)
             FROM tags t
             JOIN uploaded_folders uf ON t.folder_id = uf.id
             JOIN model_review_initiations mri ON uf.initiation_id = mri.id
             WHERE mri.job_no = $1
             AND mri.unit_no = $2
             AND mri.stage = $3
             ${rtClause}
             AND EXISTS (
                 SELECT 1 FROM tag_assignments ta
                 WHERE ta.tag_id = t.id
                 AND ta.resolution_status != 'APPROVED'
             )`,
            params4
        );

        if (parseInt(pendingCheck.rows[0].count) > 0) {
            return res.status(400).json({
                error: "Some tags are not approved. Report generation blocked."
            });
        }

        const result = await pool.query(
            `SELECT
                t.tag_no,
                t.description,
                t.tag_date,

                ta.department,
                ta.resolution,
                ta.resolved_snap_path,

                t.original_snap_path,

                t.approved_by,
                t.approved_at

             FROM tags t
             JOIN uploaded_folders uf ON t.folder_id = uf.id
             JOIN model_review_initiations mri ON uf.initiation_id = mri.id
             JOIN tag_assignments ta ON ta.tag_id = t.id

             WHERE mri.job_no = $1
             AND mri.unit_no = $2
             AND mri.stage = $3
             ${rtClause}

             AND NOT EXISTS (
                 SELECT 1 FROM tag_assignments ta2
                 WHERE ta2.tag_id = t.id
                 AND ta2.resolution_status != 'APPROVED'
             )

             ORDER BY t.id ASC`,
            params4
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No approved tags found." });
        }

        /* Initiation details — the same review the tags came from */
        const initiationResult = await pool.query(
            `SELECT mri.*, me.employee_name AS created_by_name
             FROM model_review_initiations mri
             LEFT JOIN master_employees me ON me.employee_id = mri.created_by
             WHERE mri.job_no = $1 AND mri.unit_no = $2 AND mri.stage = $3
             ${rtClause}`,
            params4
        );
        const initiation = initiationResult.rows[0] || null;

        // Record CRS generation (for THIS review) BEFORE streaming so errors are catchable
        await pool.query(
            `INSERT INTO crs_reports (job_no, unit_no, review_stage, review_type, department)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [job, unit, stage, scope.type, scope.dept]
        );

        const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: true });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=MRCS_${job}_${unit}_${stage}.pdf`);
        doc.pipe(res);

        const totalPages = result.rows.length + 2; // cover + details + tags
        const logoPath = path.join(process.cwd(), "uploads/company-logo.png");
        const logoExists = fs.existsSync(logoPath);

        // Page 1: Cover
        renderCoverPage(doc, logoPath, logoExists, job, unit, stage, result.rows.length);
        renderFooter(doc);

        // Page 2: Review Details
        doc.addPage();
        renderReviewDetailsPage(doc, logoPath, logoExists, job, unit, stage, 2, totalPages, initiation);
        renderFooter(doc);

        // Pages 3+: Tag pages
        for (let i = 0; i < result.rows.length; i++) {
            doc.addPage();
            renderHeader(doc, logoPath, logoExists, job, unit, stage, i + 3, totalPages);
            renderTagContent(doc, result.rows[i]);
            renderFooter(doc);
        }

        doc.end();

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error generating PDF" });
    }
});

// Only reviews the user is assigned to (PEM: all)
router.get("/report-options", authenticateCookie, async (req, res) => {
    const result = await pool.query(`
        SELECT DISTINCT mri.job_no, mri.unit_no, mri.stage AS review_stage
        FROM model_review_initiations mri
        WHERE (UPPER(mri.review_type) = 'EXTERNAL' OR mri.review_type IS NULL)   -- external CRS page
          AND ($1 OR EXISTS (
            SELECT 1 FROM effective_assignments ua
            WHERE UPPER(ua.employee_id) = UPPER($2)
              AND ua.job_no = mri.job_no AND ua.unit_no = mri.unit_no
              AND (ua.stage = mri.stage OR ua.stage IS NULL)))
        ORDER BY mri.job_no
    `, [isPEM(req.user), req.user.employeeId]);
    res.json(result.rows);
});

// ===============================
// HELPERS
// ===============================
function pW(doc) { return doc.page.width; }
function pH(doc) { return doc.page.height; }
function uW(doc) { return pW(doc) - M * 2; }

function rule(doc, y, x1, x2, color = RULE_COLOR, lw = 0.6) {
    doc.save().strokeColor(color).lineWidth(lw)
        .moveTo(x1, y).lineTo(x2, y).stroke().restore();
}

function vrule(doc, x, y1, y2, color = LIGHT_RULE, lw = 0.5) {
    doc.save().strokeColor(color).lineWidth(lw)
        .moveTo(x, y1).lineTo(x, y2).stroke().restore();
}

function formatDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-GB");
}

// ===============================
// HEADER
// ===============================
function renderHeader(doc, logoPath, logoExists, job, unit, stage, pageNo, totalPages, opts = {}) {
    const {
        title = "MODEL REVIEW COMMENTS RESOLUTION SHEET (CRS)",
        docNoSuffix = "CRS OF",
    } = opts;

    const W = uW(doc);
    const hTop = M;
    const hMid = hTop + HEADER_H / 2;

    // Top rule
    rule(doc, hTop, M, M + W, RULE_COLOR, 1.0);

    // Logo — left zone
    if (logoExists) {
        doc.save();
        doc.image(logoPath, M, hTop + 6, { fit: [175, HEADER_H - 12], valign: "center" });
        doc.restore();
    } else {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_MID)
            .text("COMPANY LOGO", M, hMid - 6, { width: 175, align: "center" });
    }

    // Centre title
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ACCENT)
        .text(
            title,
            M + 195, hMid - 7,
            { width: W - 195 - 195, align: "center" }
        );

    // Right meta — right-aligned stacked
    const metaTop = hTop + 10;
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text(`Document No. : ${stage} ${docNoSuffix} ${unit} UNIT`, M, metaTop, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text(`Revision : 0;  Page ${pageNo} of ${totalPages}`, M, metaTop + 14, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text(`Job: ${job}  |  Unit: ${unit}  |  Stage: ${stage}`, M, metaTop + 28, { width: W, align: "right" });

    // Bottom rule (heavier)
    rule(doc, hTop + HEADER_H, M, M + W, RULE_COLOR, 1.0);
}

// ===============================
// TAG CONTENT
// ===============================
const ANNEXURE_CAPTION =
    "This is not a CRS — a report of all tags taken, provided as an annexure to other documents.";

function renderTagContent(doc, row, opts = {}) {
    const { isAnnexure = false } = opts;

    const W = uW(doc);
    const colW = (W - COL_GAP) / 2;
    const leftX = M;
    const rightX = M + colW + COL_GAP;

    const bodyTop = M + HEADER_H + GAP;
    const bodyBottom = pH(doc) - FOOTER_H - GAP;

    // ---- Info strip — 3 fields only ----
    const infoY = bodyTop;
    const INFO_STRIP_H = 48;

    const fields = [
        { label: "TAG NO.", value: String(row.tag_no), flex: 1 },
        { label: "DEPARTMENT", value: row.department || "Unallocated", flex: 2 },
        { label: "TAG DATE", value: formatDate(row.tag_date), flex: 1 },
    ];

    // Calculate widths from flex ratios
    const totalFlex = fields.reduce((s, f) => s + f.flex, 0);
    let curX = M;

    fields.forEach((f, i) => {
        const fw = (W / totalFlex) * f.flex;

        if (i > 0) vrule(doc, curX, infoY + 6, infoY + INFO_STRIP_H - 6, LIGHT_RULE, 0.5);

        const padX = i === 0 ? 0 : 14;

        // Label
        doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_LIGHT)
            .text(f.label, curX + padX, infoY + 8, { width: fw - padX - 8 });

        // 👉 SPECIAL HANDLING FOR DEPARTMENT
        if (f.label === "DEPARTMENT") {
            drawDeptBadge(doc, f.value, curX + padX, infoY, INFO_STRIP_H);
        } else {
            doc.font("Helvetica-Bold").fontSize(11).fillColor(TEXT_DARK)
                .text(f.value, curX + padX, infoY + 20, { width: fw - padX - 8 });
        }

        curX += fw;
    });

    // Rule below info strip
    const infoBottom = infoY + INFO_STRIP_H;
    rule(doc, infoBottom, M, M + W, RULE_COLOR, 0.75);

    // ---- Two-column content area ----
    const contentTop = infoBottom + GAP;
    const contentH = bodyBottom - contentTop;

    // Size the text zone to fit the actual description/resolution content
    // (was a fixed 66pt with ellipsis truncation — long descriptions got cut
    // off). Grows to fit, capped so images always keep at least MIN_IMG_H;
    // only text that still exceeds that generous cap falls back to ellipsis.
    const LABEL_H = 20;   // column heading + underline + gap before body text
    const MIN_IMG_H = 70;
    const MAX_TEXT_H = Math.max(66, contentH - GAP - MIN_IMG_H);

    const bodyFontOpts = { width: colW, lineGap: 2 };
    doc.font("Helvetica").fontSize(8.5);
    const descBodyH = doc.heightOfString(row.description || "—", bodyFontOpts);

    let captionH = 0;
    if (isAnnexure) {
        doc.font("Helvetica-Oblique").fontSize(6.5);
        captionH = doc.heightOfString(ANNEXURE_CAPTION, { width: colW }) + 6;
    }
    doc.font("Helvetica").fontSize(8.5);
    const resolutionText = row.resolution || "—";
    const resBodyH = doc.heightOfString(resolutionText, bodyFontOpts) + captionH;

    const neededH = Math.max(descBodyH, resBodyH) + LABEL_H;
    const TEXT_ZONE_H = Math.min(Math.max(neededH, 66), MAX_TEXT_H);
    const textFits = neededH <= MAX_TEXT_H;

    const imgH = contentH - TEXT_ZONE_H - GAP;

    // Column labels
    doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT)
        .text("DESCRIPTION", leftX, contentTop);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT)
        .text("RESOLUTION", rightX, contentTop);

    // Underline on column labels
    rule(doc, contentTop + 14, leftX, leftX + colW, ACCENT, 0.75);
    rule(doc, contentTop + 14, rightX, rightX + colW, ACCENT, 0.75);

    // Body text
    const textY = contentTop + 20;
    doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_DARK)
        .text(row.description || "—", leftX, textY, {
            width: colW,
            height: TEXT_ZONE_H - 20,
            ellipsis: !textFits
        });

    let resTextY = textY;
    if (isAnnexure) {
        doc.font("Helvetica-Oblique").fontSize(6.5).fillColor(TEXT_LIGHT)
            .text(ANNEXURE_CAPTION, rightX, resTextY, { width: colW });
        resTextY += captionH;
    }
    doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_DARK)
        .text(resolutionText, rightX, resTextY, {
            width: colW,
            height: (textY + TEXT_ZONE_H - 20) - resTextY,
            ellipsis: !textFits,
            lineGap: 2
        });

    // Light rule between text and images
    const imgStartY = contentTop + TEXT_ZONE_H;
    rule(doc, imgStartY, leftX, leftX + colW, LIGHT_RULE, 0.4);
    rule(doc, imgStartY, rightX, rightX + colW, LIGHT_RULE, 0.4);

    // Centre vertical separator
    vrule(doc, M + colW + COL_GAP / 2, contentTop, bodyBottom, LIGHT_RULE, 0.5);

    // Images
    const imgY = imgStartY + GAP / 2;
    const imgAreaH = imgH - GAP / 2;
    renderImage(doc, row.original_snap_path, leftX, imgY, colW, imgAreaH);
    renderImage(doc, row.resolved_snap_path, rightX, imgY, colW, imgAreaH);

    // Bottom rule
    rule(doc, bodyBottom, M, M + W, RULE_COLOR, 0.75);
}

// ===============================
// IMAGE RENDERER
// ===============================
function renderImage(doc, relativePath, x, y, boxW, boxH) {

    const absolutePath = relativePath
        ? path.join(process.cwd(), relativePath)
        : null;

    if (absolutePath && fs.existsSync(absolutePath)) {

        try {
            const img = doc.openImage(absolutePath);

            const imgRatio = img.width / img.height;
            const boxRatio = boxW / boxH;

            let drawW, drawH;

            if (imgRatio > boxRatio) {
                // Fit by width
                drawW = boxW;
                drawH = boxW / imgRatio;
            } else {
                // Fit by height
                drawH = boxH;
                drawW = boxH * imgRatio;
            }

            // 👉 CENTERING CALCULATION
            const offsetX = x + (boxW - drawW) / 2;
            const offsetY = y + (boxH - drawH) / 2;

            doc.image(absolutePath, offsetX, offsetY, {
                width: drawW,
                height: drawH
            });

            // Border box (unchanged)
            doc.rect(x, y, boxW, boxH)
                .strokeColor(LIGHT_RULE)
                .lineWidth(0.5)
                .stroke();

        } catch (err) {
            drawPlaceholder(doc, x, y, boxW, boxH, "Image Error");
        }

    } else {
        drawPlaceholder(doc, x, y, boxW, boxH, "Image Not Available");
    }
}

function drawPlaceholder(doc, x, y, w, h, msg) {
    doc.save().rect(x, y, w, h)
        .strokeColor(LIGHT_RULE).lineWidth(0.5).stroke().restore();
    doc.save().strokeColor("#E8E8E8").lineWidth(0.4)
        .moveTo(x, y).lineTo(x + w, y + h).stroke()
        .moveTo(x + w, y).lineTo(x, y + h).stroke()
        .restore();
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_LIGHT)
        .text(msg, x, y + h / 2 - 5, { width: w, align: "center" });
}

// ===============================
// FOOTER
// ===============================
function renderFooter(doc) {
    const W = uW(doc);
    const footerY = pH(doc) - FOOTER_H;

    rule(doc, footerY, M, M + W, RULE_COLOR, 0.75);

    doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_LIGHT)
        .text("Form No. 3-1643-0412  Rev. 1 / dtd. 09-05-2025", M, footerY + 10);

    doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_LIGHT)
        .text("Copyrights EIL – All rights reserved", M, footerY + 10, {
            width: W,
            align: "right"
        });
}

// ===============================
// COVER PAGE
// ===============================
function renderCoverPage(doc, logoPath, logoExists, job, unit, stage, totalTags, opts = {}) {
    const {
        title = "MODEL REVIEW COMMENTS RESOLUTION SHEET",
        subtitle = "Comments Resolution Sheet (CRS)",
        docNoSuffix = "CRS OF",
        totalLabel = "Total Approved Tags",
        disclaimer = null,
    } = opts;

    const W = uW(doc);
    const H = pH(doc);

    // Top double-rule
    rule(doc, M, M, M + W, RULE_COLOR, 1.2);
    rule(doc, M + 5, M, M + W, RULE_COLOR, 0.4);

    // Logo top-left
    if (logoExists) {
        doc.image(logoPath, M, M + 14, { fit: [180, 48], valign: "center" });
    }

    // Doc ref top-right
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text(`Document No. : ${stage} ${docNoSuffix} ${unit} UNIT`, M, M + 16, { width: W, align: "right" })
        .text("Revision : 0", M, M + 30, { width: W, align: "right" });

    // Rule below header strip
    rule(doc, M + 68, M, M + W, RULE_COLOR, 0.75);

    // ---- Main title block — vertically centred ----
    const centerY = H * 0.36;

    // Decorative rule above title
    rule(doc, centerY - 18, M + 80, M + W - 80, LIGHT_RULE, 0.5);

    doc.font("Helvetica-Bold").fontSize(21).fillColor(ACCENT)
        .text(title, M, centerY, { width: W, align: "center" });

    doc.font("Helvetica").fontSize(11).fillColor(TEXT_MID)
        .text(subtitle, M, centerY + 30, { width: W, align: "center" });

    // Disclaimer paragraph (annexure only) — grows the gap before the info
    // table dynamically so it never overlaps, rather than a fixed offset.
    let ruleY = centerY + 56;
    if (disclaimer) {
        const discW = W - 200;
        const discX = M + 100;
        const discY = centerY + 52;
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(TEXT_MID);
        const discH = doc.heightOfString(disclaimer, { width: discW, align: "center" });
        doc.text(disclaimer, discX, discY, { width: discW, align: "center" });
        ruleY = discY + discH + 14;
    }

    // Rule below title
    rule(doc, ruleY, M + 80, M + W - 80, RULE_COLOR, 0.75);

    // ---- Info table ----
    const tableY = ruleY + 20;
    const tableW = 380;
    const tableX = M + (W - tableW) / 2;
    const rowH = 27;

    const rows = [
        ["Job Number", job],
        ["Unit Number", unit],
        ["Stage", stage],
        [totalLabel, String(totalTags)],
        ["Generated On", new Date().toLocaleString("en-GB")],
    ];

    // Top border of table
    rule(doc, tableY, tableX, tableX + tableW, RULE_COLOR, 0.75);

    rows.forEach(([label, value], i) => {
        const ry = tableY + i * rowH;

        // Subtle alternate stripe
        if (i % 2 === 0) {
            doc.save().rect(tableX, ry, tableW, rowH)
                .fillColor("#F5F6F8").fill().restore();
        }

        // Row bottom rule
        rule(doc, ry + rowH, tableX, tableX + tableW, LIGHT_RULE, 0.4);

        // Vertical divider
        vrule(doc, tableX + 160, ry, ry + rowH, LIGHT_RULE, 0.4);

        doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_MID)
            .text(label, tableX + 12, ry + 9, { width: 140 });
        doc.font("Helvetica").fontSize(9).fillColor(TEXT_DARK)
            .text(value, tableX + 172, ry + 9, { width: tableW - 184 });
    });

    // Bottom border of table
    rule(doc, tableY + rows.length * rowH, tableX, tableX + tableW, RULE_COLOR, 0.75);

    // Bottom double-rule
    rule(doc, H - M - 5, M, M + W, RULE_COLOR, 0.4);
    rule(doc, H - M, M, M + W, RULE_COLOR, 1.2);
}

// ===============================
// REVIEW DETAILS PAGE (Page 2)
// ===============================
function renderReviewDetailsPage(doc, logoPath, logoExists, job, unit, stage, pageNo, totalPages, initiation) {
    const W = uW(doc);

    renderHeader(doc, logoPath, logoExists, job, unit, stage, pageNo, totalPages);

    const bodyTop    = M + HEADER_H + GAP;
    const bodyBottom = pH(doc) - FOOTER_H - GAP;

    // Page title
    doc.font("Helvetica-Bold").fontSize(13).fillColor(ACCENT)
        .text("REVIEW DETAILS", M, bodyTop, { width: W, align: "center" });
    rule(doc, bodyTop + 22, M, M + W, RULE_COLOR, 0.75);

    let y = bodyTop + 34;

    // ---- Overview table ----
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(TEXT_LIGHT)
        .text("REVIEW OVERVIEW", M, y);
    y += 13;

    const overviewRows = [
        ["Job Number",       job],
        ["Unit Number",      unit],
        ["Stage",            stage],
        ["Review Type",      initiation ? (initiation.review_type || "INTERNAL") : "—"],
        ["Review Date From", initiation ? formatDate(initiation.review_date_from) : "—"],
        ["Review Date To",   initiation ? formatDate(initiation.review_date_to)   : "—"],
        ["Initiated By",     initiation ? (initiation.created_by_name || initiation.created_by || "—") : "—"],
        ["Initiated On",     initiation ? formatDate(initiation.created_at) : "—"],
    ];

    const labelColW = 170;
    const rowH      = 22;

    rule(doc, y, M, M + W, RULE_COLOR, 0.5);
    overviewRows.forEach(([label, value], i) => {
        const ry = y + i * rowH;
        if (i % 2 === 0) {
            doc.save().rect(M, ry, W, rowH).fillColor("#F5F6F8").fill().restore();
        }
        rule(doc, ry + rowH, M, M + W, LIGHT_RULE, 0.3);
        vrule(doc, M + labelColW, ry, ry + rowH, LIGHT_RULE, 0.4);

        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(TEXT_MID)
            .text(label, M + 10, ry + 6, { width: labelColW - 20 });
        doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_DARK)
            .text(String(value || "—"), M + labelColW + 10, ry + 6, { width: W - labelColW - 20 });
    });

    y += overviewRows.length * rowH + 18;

    // ---- Description ----
    if (initiation && initiation.description) {
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(TEXT_LIGHT)
            .text("REVIEW DESCRIPTION", M, y);
        y += 13;

        const descText = initiation.description;
        const descBodyH = doc.heightOfString(descText, { width: W - 20, fontSize: 8.5 });
        const descBoxH  = Math.max(descBodyH + 18, 38);

        doc.save()
            .rect(M, y, W, descBoxH)
            .fillAndStroke("#FAFBFC", LIGHT_RULE)
            .restore();
        doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_DARK)
            .text(descText, M + 10, y + 9, { width: W - 20 });

        y += descBoxH + 18;
    }

    rule(doc, bodyBottom, M, M + W, RULE_COLOR, 0.75);
}

// ===============================
// DEPT BADGE
// ===============================
function drawDeptBadge(doc, text, x, y, containerHeight = 48) {

    const label = (text || "N/A").toUpperCase();
    const color = DEPT_COLORS[label.toLowerCase()] || DEPT_COLORS.default;

    const paddingX = 10;
    const paddingY = 5;

    doc.font("Helvetica-Bold").fontSize(9);

    const textWidth = doc.widthOfString(label);
    const textHeight = doc.currentLineHeight();

    const boxW = textWidth + paddingX * 2;
    const boxH = textHeight + paddingY;

    // 👉 CENTER VERTICALLY inside info strip
    const offsetY = y + (containerHeight - boxH) / 2;

    // Background
    doc.save()
        .fillColor(color)
        .roundedRect(x, offsetY, boxW, boxH, 5)
        .fill();

    // Text
    doc.fillColor("#FFFFFF")
        .text(label, x + paddingX, offsetY + 3);

    doc.restore();
}

// ===============================
// EXPORT ALL TAGS — same page format as the CRS, but includes every tag
// regardless of allocation/approval status, and is clearly marked as not
// being an official CRS.
// ===============================
const ANNEXURE_DISCLAIMER =
    "This is not a Comments Resolution Sheet (CRS). It is a report of all tags taken during the review, provided as an annexure to other project documentation.";

// scope = reviewScope(req): the external review, or one department's internal review
async function fetchAllTagsForExport(jobNo, unitNo, stage, scope) {
    const rtClause = scope.clause;
    const params = [jobNo, unitNo, stage, ...scope.extra];
    const result = await pool.query(
        `SELECT
            t.tag_no,
            t.description,
            t.tag_date,
            ta.department,
            ta.resolution,
            ta.resolution_status,
            ta.resolved_snap_path,
            t.original_snap_path
         FROM tags t
         JOIN uploaded_folders uf ON t.folder_id = uf.id
         JOIN model_review_initiations mri ON uf.initiation_id = mri.id
         LEFT JOIN tag_assignments ta ON ta.tag_id = t.id
         WHERE mri.job_no = $1
           AND mri.unit_no = $2
           AND mri.stage = $3
           ${rtClause}
         ORDER BY
           CASE WHEN t.tag_no ~ '^[0-9]+$' THEN t.tag_no::bigint END ASC NULLS LAST,
           t.tag_no ASC,
           ta.department ASC NULLS LAST`,
        params
    );
    return result.rows;
}

router.get("/export-all-tags", authenticateCookie, requireReviewRole("JE"), async (req, res) => {
    try {
        const { jobNo, unitNo, stage, reviewType } = req.query;

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({ error: "Missing parameters: jobNo, unitNo, stage" });
        }

        const tags = await fetchAllTagsForExport(jobNo, unitNo, stage, reviewScope(req));

        if (tags.length === 0) {
            return res.status(404).json({ error: "No tags found for the selected review." });
        }

        const totalPages = tags.length + 1;

        const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: true });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=AllTagsReport_${jobNo}_${unitNo}_${stage}.pdf`);
        doc.pipe(res);

        const logoPath = path.join(process.cwd(), "uploads/company-logo.png");
        const logoExists = fs.existsSync(logoPath);

        const headerOpts = {
            title: "ALL TAGS REPORT — ANNEXURE (NOT A CRS)",
            docNoSuffix: "ALL TAGS REPORT OF",
        };

        renderCoverPage(doc, logoPath, logoExists, jobNo, unitNo, stage, tags.length, {
            title: "ALL TAGS REPORT",
            subtitle: "Annexure — Complete Tag Listing",
            docNoSuffix: "ALL TAGS REPORT OF",
            totalLabel: "Total Tags",
            disclaimer: ANNEXURE_DISCLAIMER,
        });
        renderFooter(doc);

        for (let i = 0; i < tags.length; i++) {
            doc.addPage();
            renderHeader(doc, logoPath, logoExists, jobNo, unitNo, stage, i + 2, totalPages, headerOpts);
            renderTagContent(doc, tags[i], { isAnnexure: true });
            renderFooter(doc);
        }

        doc.end();

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ error: "Error generating tag export PDF" });
        }
    }
});

// ===============================
// EXPORT ALL TAGS — Excel
// ===============================
router.get("/export-all-tags-excel", authenticateCookie, requireReviewRole("JE"), async (req, res) => {
    try {
        const { jobNo, unitNo, stage, reviewType } = req.query;

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({ error: "Missing parameters: jobNo, unitNo, stage" });
        }

        const tags = await fetchAllTagsForExport(jobNo, unitNo, stage, reviewScope(req));

        if (tags.length === 0) {
            return res.status(404).json({ error: "No tags found for the selected review." });
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("All Tags");

        sheet.mergeCells("A1:F1");
        sheet.getCell("A1").value = ANNEXURE_DISCLAIMER;
        sheet.getCell("A1").font = { italic: true, color: { argb: "FF666666" } };
        sheet.getCell("A1").alignment = { wrapText: true, vertical: "top" };
        sheet.getRow(1).height = 30;

        const headerRow = sheet.getRow(3);
        headerRow.values = ["Tag No", "Description", "Department", "Tag Date", "Status", "Resolution"];
        headerRow.font = { bold: true };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };

        tags.forEach(row => {
            const status = row.department ? (row.resolution_status || "NOT_STARTED") : "UNALLOCATED";
            sheet.addRow([
                row.tag_no,
                row.description || "",
                row.department ? row.department.toUpperCase() : "Unallocated",
                row.tag_date ? new Date(row.tag_date).toLocaleDateString("en-GB") : "",
                status,
                row.resolution || "",
            ]);
        });

        sheet.columns = [
            { width: 12 },
            { width: 55 },
            { width: 18 },
            { width: 14 },
            { width: 16 },
            { width: 55 },
        ];
        sheet.getColumn(2).alignment = { wrapText: true, vertical: "top" };
        sheet.getColumn(6).alignment = { wrapText: true, vertical: "top" };

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename=AllTagsReport_${jobNo}_${unitNo}_${stage}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ error: "Error generating tag export Excel" });
        }
    }
});

module.exports = router;