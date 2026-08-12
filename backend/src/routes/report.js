const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

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
router.get("/generate-pdf", async (req, res) => {
    try {
        const { job, unit, stage, reviewType } = req.query;

        if (!job || !unit || !stage) {
            return res.status(400).json({ error: "Missing parameters" });
        }

        /* Optional review_type filter — pass reviewType=internal for internal CRS */
        const rt     = reviewType ? reviewType.toLowerCase() : null;
        const rtClause = rt ? `AND LOWER(j.review_type) = $4` : '';
        const params3  = [job, unit, stage];
        const params4  = rt ? [job, unit, stage, rt] : params3;

        const pendingCheck = await pool.query(
            `SELECT COUNT(*)
             FROM tags t
             JOIN uploaded_folders uf ON t.folder_id = uf.id
             JOIN jobs j ON uf.job_id = j.id
             WHERE j.job_no = $1
             AND j.unit_no = $2
             AND j.review_stage = $3
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
             JOIN jobs j ON uf.job_id = j.id
             JOIN tag_assignments ta ON ta.tag_id = t.id

             WHERE j.job_no = $1
             AND j.unit_no = $2
             AND j.review_stage = $3
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

        /* Initiation details — filter by review_type when provided */
        const initiationResult = await pool.query(
            `SELECT mri.*, me.employee_name AS created_by_name
             FROM model_review_initiations mri
             LEFT JOIN master_employees me ON me.employee_id = mri.created_by
             WHERE mri.job_no = $1 AND mri.unit_no = $2 AND mri.stage = $3
             ${rt ? "AND UPPER(mri.review_type) = $4" : ""}`,
            rt ? [job, unit, stage, rt.toUpperCase()] : [job, unit, stage]
        );
        const initiation = initiationResult.rows[0] || null;

        // Record CRS generation BEFORE streaming so errors are catchable
        await pool.query(
            `INSERT INTO crs_reports (job_no, unit_no, review_stage)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [job, unit, stage]
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

router.get("/report-options", async (req, res) => {
    const result = await pool.query(`
        SELECT DISTINCT job_no, unit_no, review_stage
        FROM jobs
        ORDER BY job_no
    `);
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
function renderHeader(doc, logoPath, logoExists, job, unit, stage, pageNo, totalPages) {
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
            "MODEL REVIEW COMMENTS RESOLUTION SHEET (CRS)",
            M + 195, hMid - 7,
            { width: W - 195 - 195, align: "center" }
        );

    // Right meta — right-aligned stacked
    const metaTop = hTop + 10;
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text(`Document No. : ${stage} CRS OF ${unit} UNIT`, M, metaTop, { width: W, align: "right" });
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
function renderTagContent(doc, row) {
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
        { label: "DEPARTMENT", value: row.department || "—", flex: 2 },
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
    const TEXT_ZONE_H = 66;
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
            ellipsis: true
        });
    doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_DARK)
        .text(row.resolution || "—", rightX, textY, {
            width: colW,
            height: TEXT_ZONE_H - 20,
            ellipsis: true,
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
function renderCoverPage(doc, logoPath, logoExists, job, unit, stage, totalTags) {
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
        .text(`Document No. : ${stage} CRS OF ${unit} UNIT`, M, M + 16, { width: W, align: "right" })
        .text("Revision : 0", M, M + 30, { width: W, align: "right" });

    // Rule below header strip
    rule(doc, M + 68, M, M + W, RULE_COLOR, 0.75);

    // ---- Main title block — vertically centred ----
    const centerY = H * 0.36;

    // Decorative rule above title
    rule(doc, centerY - 18, M + 80, M + W - 80, LIGHT_RULE, 0.5);

    doc.font("Helvetica-Bold").fontSize(21).fillColor(ACCENT)
        .text("MODEL REVIEW COMMENTS RESOLUTION SHEET", M, centerY, { width: W, align: "center" });

    doc.font("Helvetica").fontSize(11).fillColor(TEXT_MID)
        .text("Comments Resolution Sheet (CRS)", M, centerY + 30, { width: W, align: "center" });

    // Rule below title
    rule(doc, centerY + 56, M + 80, M + W - 80, RULE_COLOR, 0.75);

    // ---- Info table ----
    const tableY = centerY + 76;
    const tableW = 380;
    const tableX = M + (W - tableW) / 2;
    const rowH = 27;

    const rows = [
        ["Job Number", job],
        ["Unit Number", unit],
        ["Stage", stage],
        ["Total Approved Tags", String(totalTags)],
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
// EXPORT ALL TAGS ROUTE
// ===============================
router.get("/export-all-tags", async (req, res) => {
    try {
        const { jobNo, unitNo, stage } = req.query;

        if (!jobNo || !unitNo || !stage) {
            return res.status(400).json({ error: "Missing parameters: jobNo, unitNo, stage" });
        }

        const result = await pool.query(
            `SELECT
                t.id,
                t.tag_no,
                t.description,
                t.tag_date,
                t.original_snap_path,
                COALESCE(
                    STRING_AGG(DISTINCT UPPER(ta.department), ', ' ORDER BY UPPER(ta.department)),
                    'Unallocated'
                ) AS departments,
                CASE WHEN COUNT(ta.id) = 0 THEN 'Unallocated' ELSE 'Allocated' END AS alloc_status
             FROM tags t
             JOIN uploaded_folders uf ON t.folder_id = uf.id
             JOIN jobs j ON uf.job_id = j.id
             LEFT JOIN tag_assignments ta ON ta.tag_id = t.id
             WHERE j.job_no = $1
               AND j.unit_no = $2
               AND j.review_stage = $3
             GROUP BY t.id, t.tag_no, t.description, t.tag_date, t.original_snap_path
             ORDER BY
               CASE WHEN t.tag_no ~ '^[0-9]+$' THEN t.tag_no::bigint END ASC NULLS LAST,
               t.tag_no ASC`,
            [jobNo, unitNo, stage]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No tags found for the selected review." });
        }

        const tags = result.rows;
        const totalPages = tags.length + 1;

        const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0, autoFirstPage: true });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=AllTags_${jobNo}_${unitNo}_${stage}.pdf`);
        doc.pipe(res);

        const logoPath = path.join(process.cwd(), "uploads/company-logo.png");
        const logoExists = fs.existsSync(logoPath);

        renderExportCoverPage(doc, logoPath, logoExists, jobNo, unitNo, stage, tags.length);
        renderFooter(doc);

        for (let i = 0; i < tags.length; i++) {
            doc.addPage();
            renderExportTagPage(doc, logoPath, logoExists, jobNo, unitNo, stage, i + 2, totalPages, tags[i]);
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
// EXPORT HELPERS
// ===============================
function renderExportHeader(doc, logoPath, logoExists, job, unit, stage, pageNo, totalPages) {
    const W = uW(doc);
    const hTop = M;
    const hMid = hTop + HEADER_H / 2;

    rule(doc, hTop, M, M + W, RULE_COLOR, 1.0);

    if (logoExists) {
        doc.save();
        doc.image(logoPath, M, hTop + 6, { fit: [175, HEADER_H - 12], valign: "center" });
        doc.restore();
    } else {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_MID)
            .text("COMPANY LOGO", M, hMid - 6, { width: 175, align: "center" });
    }

    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ACCENT)
        .text("ALL TAGS EXPORT", M + 195, hMid - 7, { width: W - 390, align: "center" });

    const metaTop = hTop + 10;
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text(`Page ${pageNo} of ${totalPages}`, M, metaTop, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text(`Job: ${job}  |  Unit: ${unit}  |  Stage: ${stage}`, M, metaTop + 14, { width: W, align: "right" });

    rule(doc, hTop + HEADER_H, M, M + W, RULE_COLOR, 1.0);
}

function renderExportCoverPage(doc, logoPath, logoExists, job, unit, stage, totalTags) {
    const W = uW(doc);
    const H = pH(doc);

    rule(doc, M, M, M + W, RULE_COLOR, 1.2);
    rule(doc, M + 5, M, M + W, RULE_COLOR, 0.4);

    if (logoExists) {
        doc.image(logoPath, M, M + 14, { fit: [180, 48], valign: "center" });
    }

    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MID)
        .text("Model Review — Tag Export Report", M, M + 16, { width: W, align: "right" })
        .text(new Date().toLocaleString("en-GB"), M, M + 30, { width: W, align: "right" });

    rule(doc, M + 68, M, M + W, RULE_COLOR, 0.75);

    const centerY = H * 0.38;

    rule(doc, centerY - 18, M + 60, M + W - 60, LIGHT_RULE, 0.5);

    doc.font("Helvetica-Bold").fontSize(22).fillColor(ACCENT)
        .text("ALL TAGS EXPORT", M, centerY, { width: W, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor(TEXT_MID)
        .text("Complete Tag Listing — All Tags Regardless of Allocation Status", M, centerY + 34, { width: W, align: "center" });

    rule(doc, centerY + 58, M + 60, M + W - 60, RULE_COLOR, 0.75);

    const tableW = 300;
    const tableX = M + (W - tableW) / 2;
    const tableY = centerY + 78;
    const rowH   = 26;

    const rows = [
        ["Job Number",  job],
        ["Unit Number", unit],
        ["Stage",       stage],
        ["Total Tags",  String(totalTags)],
        ["Exported On", new Date().toLocaleString("en-GB")],
    ];

    rule(doc, tableY, tableX, tableX + tableW, RULE_COLOR, 0.75);
    rows.forEach(([label, value], i) => {
        const ry = tableY + i * rowH;
        if (i % 2 === 0) {
            doc.save().rect(tableX, ry, tableW, rowH).fillColor("#F5F6F8").fill().restore();
        }
        rule(doc, ry + rowH, tableX, tableX + tableW, LIGHT_RULE, 0.4);
        vrule(doc, tableX + 130, ry, ry + rowH, LIGHT_RULE, 0.4);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_MID)
            .text(label, tableX + 12, ry + 8, { width: 110 });
        doc.font("Helvetica").fontSize(9).fillColor(TEXT_DARK)
            .text(value, tableX + 142, ry + 8, { width: tableW - 154 });
    });
    rule(doc, tableY + rows.length * rowH, tableX, tableX + tableW, RULE_COLOR, 0.75);

    rule(doc, H - M - 5, M, M + W, RULE_COLOR, 0.4);
    rule(doc, H - M, M, M + W, RULE_COLOR, 1.2);
}

function renderExportTagPage(doc, logoPath, logoExists, job, unit, stage, pageNo, totalPages, tag) {
    const W = uW(doc);

    renderExportHeader(doc, logoPath, logoExists, job, unit, stage, pageNo, totalPages);

    const bodyTop    = M + HEADER_H + GAP;
    const bodyBottom = pH(doc) - FOOTER_H - GAP;

    // Info strip
    const INFO_STRIP_H = 52;
    const infoY = bodyTop;

    const fields = [
        { label: "TAG NO.",       value: String(tag.tag_no),           flex: 0.9 },
        { label: "DESCRIPTION",   value: tag.description || "—",       flex: 2.5 },
        { label: "DEPARTMENT(S)", value: tag.departments || "—",       flex: 2.0 },
        { label: "DATE",          value: formatDate(tag.tag_date),      flex: 0.9 },
        { label: "STATUS",        value: tag.alloc_status || "—",      flex: 1.0 },
    ];

    const totalFlex = fields.reduce((s, f) => s + f.flex, 0);
    let curX = M;

    fields.forEach((f, i) => {
        const fw = (W / totalFlex) * f.flex;
        if (i > 0) vrule(doc, curX, infoY + 6, infoY + INFO_STRIP_H - 6, LIGHT_RULE, 0.5);
        const padX = i === 0 ? 0 : 12;

        doc.font("Helvetica-Bold").fontSize(6.5).fillColor(TEXT_LIGHT)
            .text(f.label, curX + padX, infoY + 8, { width: fw - padX - 6 });

        if (f.label === "STATUS") {
            const isAllocated = f.value === "Allocated";
            const color = isAllocated ? "#43A047" : "#FB8C00";
            const badgeW = 72;
            doc.save()
                .fillColor(color)
                .roundedRect(curX + padX, infoY + 22, badgeW, 18, 4)
                .fill();
            doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8)
                .text(f.value.toUpperCase(), curX + padX, infoY + 26, { width: badgeW, align: "center" });
            doc.restore();
        } else {
            const fontSize = (f.label === "DESCRIPTION" || f.label === "DEPARTMENT(S)") ? 8 : 11;
            const valueY   = (f.label === "DESCRIPTION" || f.label === "DEPARTMENT(S)") ? infoY + 20 : infoY + 20;
            doc.font("Helvetica-Bold").fontSize(fontSize).fillColor(TEXT_DARK)
                .text(f.value, curX + padX, valueY, { width: fw - padX - 8, ellipsis: true });
        }

        curX += fw;
    });

    const infoBottom = infoY + INFO_STRIP_H;
    rule(doc, infoBottom, M, M + W, RULE_COLOR, 0.75);

    // Snap image — takes remaining body area
    const snapLabelY = infoBottom + GAP;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(ACCENT)
        .text("ORIGINAL SNAP", M, snapLabelY);

    const snapY = snapLabelY + 16;
    const snapH = bodyBottom - snapY;

    renderImage(doc, tag.original_snap_path, M, snapY, W, snapH);

    rule(doc, bodyBottom, M, M + W, RULE_COLOR, 0.75);
}

module.exports = router;