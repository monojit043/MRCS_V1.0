// const fs = require("fs");
// const express = require("express");
// const router = express.Router();
// const multer = require("multer");
// const parseXmlFile = require("../services/xmlParser");
// const path = require("path");
// const { v4: uuidv4 } = require("uuid");
// const validateFolder = require("../services/folderValidator");
// const pool = require("../data/db");
// const parseHtmlForImages = require("../services/htmlParser");
// const { authenticateToken, authorize } = require("../middleware/auth.middleware");



// // Storage config
// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         // Create unique folder per upload
//         const uploadId = req.uploadId;
//         const dest = path.join(__dirname, "../../uploads/temp", uploadId);
//         cb(null, dest);
//     },
//     filename: (req, file, cb) => {
//         cb(null, file.originalname); // keep original file name
//     },
// });

// // Multer middleware
// const upload = multer({ storage });

// // Middleware to create uploadId & folder
// const prepareUploadFolder = (req, res, next) => {
//     const fs = require("fs");

//     const uploadId = uuidv4();
//     req.uploadId = uploadId;

//     const folderPath = path.join(__dirname, "../../uploads/temp", uploadId);

//     fs.mkdirSync(folderPath, { recursive: true });

//     next();
// };

// router.post("/upload-folder",
//     authenticateToken,
//     authorize("LE"),

//     prepareUploadFolder,
//     upload.any(),
//     async (req, res) => {
//         const validation = validateFolder(req.files);

//         if (!validation.isValid) {
//             return res.status(400).json({
//                 message: "Folder validation failed",
//                 errors: validation.errors,
//             });
//         }

//         try {
//             const uploadFolderPath = path.join(
//                 __dirname,
//                 "../../uploads/temp",
//                 req.uploadId
//             );

//             const tags = await parseXmlFile(uploadFolderPath);
//             const htmlMapping = parseHtmlForImages(uploadFolderPath);

//             const { jobNo, unitNo, stage, uploadedBy, originalFolderName } = req.body;

//             if (!jobNo || !unitNo || !stage) {
//                 return res.status(400).json({
//                     message: "Job No, Unit No and Stage are required",
//                 });
//             }

//             // 🔹 1. Check if job exists
//             let jobResult = await pool.query(
//                 `SELECT id FROM jobs 
//            WHERE job_no = $1 
//            AND unit_no = $2 
//            AND review_stage = $3`,
//                 [jobNo, unitNo, stage]
//             );

//             let jobId;

//             if (jobResult.rows.length > 0) {
//                 jobId = jobResult.rows[0].id;
//             } else {
//                 const newJob = await pool.query(
//                     `INSERT INTO jobs (job_no, unit_no, review_stage)
//              VALUES ($1, $2, $3)
//              RETURNING id`,
//                     [jobNo, unitNo, stage]
//                 );

//                 jobId = newJob.rows[0].id;
//             }

//             // 🔹 2. Insert folder
//             const folderInsert = await pool.query(
//                 `INSERT INTO uploaded_folders 
//            (job_id, folder_name, uploaded_by)
//            VALUES ($1, $2, $3)
//            RETURNING id`,
//                 [jobId, originalFolderName, uploadedBy || "Unknown"]
//             );

//             const folderId = folderInsert.rows[0].id;

//             // 🔹 3. Insert tags
//             // for (let tag of tags) {
//             //     await pool.query(
//             //         `INSERT INTO tags
//             //  (folder_id, tag_no, description, tag_date, view_name, status)
//             //  VALUES ($1, $2, $3, $4, $5, 'NEW')`,
//             //         [
//             //             folderId,
//             //             tag.tag_no,
//             //             tag.description,
//             //             tag.tag_date,
//             //             tag.view_name,
//             //         ]
//             //     );
//             // }
//             for (let tag of tags) {

//                 const imageFileName = htmlMapping[tag.view_name] || null;

//                 const originalSnapPath = imageFileName
//                     ? path.join(
//                         "uploads/permanent",
//                         jobNo,
//                         unitNo,
//                         stage,
//                         folderId.toString(),
//                         imageFileName
//                     ).replace(/\\/g, "/")
//                     : null;

//                 await pool.query(
//                     `INSERT INTO tags
//                    (folder_id, tag_no, description, tag_date, view_name, status, original_snap_path)
//                    VALUES ($1, $2, $3, $4, $5, 'NEW', $6)`,
//                     [
//                         folderId,
//                         tag.tag_no,
//                         tag.description,
//                         tag.tag_date,
//                         tag.view_name,
//                         originalSnapPath,
//                     ]
//                 );
//             }

//             // 🔹 4. Move temp folder to permanent location

//             const tempPath = path.join(
//                 __dirname,
//                 "../../uploads/temp",
//                 req.uploadId
//             );

//             const permanentPath = path.join(
//                 __dirname,
//                 "../../uploads/permanent",
//                 jobNo,
//                 unitNo,
//                 stage,
//                 folderId.toString()
//             );

//             // Create permanent directory
//             fs.mkdirSync(permanentPath, { recursive: true });

//             // Move files
//             const filesInTemp = fs.readdirSync(tempPath);

//             for (const file of filesInTemp) {
//                 fs.renameSync(
//                     path.join(tempPath, file),
//                     path.join(permanentPath, file)
//                 );
//             }

//             // Remove temp folder safely
//             fs.rmSync(tempPath, { recursive: true, force: true });


//             res.json({
//                 message: "Folder uploaded and saved to database successfully",
//                 jobId,
//                 folderId,
//                 tagCount: tags.length,
//             });
//         } catch (err) {
//             console.error(err);
//             res.status(500).json({
//                 message: "Upload processing failed",
//                 error: err.message,
//             });
//         }
//     }
// );

// module.exports = router;


const fs = require("fs");
const express = require("express");
const router = express.Router();
const multer = require("multer");
const parseXmlFile = require("../services/xmlParser");
const parseExcelFile = require("../services/excelParser");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const validateFolder = require("../services/folderValidator");
const pool = require("../data/db");
const parseHtmlForImages = require("../services/htmlParser");
const { authenticateToken, requirePEM } = require("../middleware/auth.middleware");
const { loadZones, detectZone } = require("../services/zoneDetector");

// Storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadId = req.uploadId;
        const dest = path.join(__dirname, "../../uploads/temp", uploadId);
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    },
});

// Multer middleware
const upload = multer({ storage });

// Middleware to create uploadId & folder
const prepareUploadFolder = (req, res, next) => {

    const uploadId = uuidv4();
    req.uploadId = uploadId;

    const folderPath = path.join(__dirname, "../../uploads/temp", uploadId);

    fs.mkdirSync(folderPath, { recursive: true });

    next();
};

router.post(
    "/upload-folder",
    authenticateToken,
    requirePEM,

    prepareUploadFolder,
    upload.any(),

    async (req, res) => {

        const validation = validateFolder(req.files);

        if (!validation.isValid) {
            return res.status(400).json({
                message: "Folder validation failed",
                errors: validation.errors,
            });
        }

        try {

            const uploadFolderPath = path.join(
                __dirname,
                "../../uploads/temp",
                req.uploadId
            );

            // 🔹 Updated parser usage
            const { model_file, tags } = await parseXmlFile(uploadFolderPath);

            const htmlMapping = parseHtmlForImages(uploadFolderPath);

            const { jobNo, unitNo, stage, uploadedBy, originalFolderName } = req.body;

            if (!jobNo || !unitNo || !stage) {
                return res.status(400).json({
                    message: "Job No, Unit No and Stage are required",
                });
            }

            // 🔹 1. Check if job exists
            let jobResult = await pool.query(
                `SELECT id FROM jobs 
                 WHERE job_no = $1 
                 AND unit_no = $2 
                 AND review_stage = $3`,
                [jobNo, unitNo, stage]
            );

            let jobId;

            if (jobResult.rows.length > 0) {
                jobId = jobResult.rows[0].id;
            } else {
            
                const newJob = await pool.query(
                    `INSERT INTO jobs (job_no, unit_no, review_stage)
                     VALUES ($1, $2, $3)
                     RETURNING id`,
                    [jobNo, unitNo, stage]
                );
            
                jobId = newJob.rows[0].id;
            }
            
            // 🔹 Load zones AFTER jobId is known
            const zones = await loadZones(jobId);

            // 🔹 2. Insert folder (with model_file)
            const folderInsert = await pool.query(
                `INSERT INTO uploaded_folders 
                 (job_id, folder_name, uploaded_by, model_file)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [jobId, originalFolderName, req.user.employeeId, model_file]
            );

            const folderId = folderInsert.rows[0].id;

            // 🔹 3. Insert tags
            for (let tag of tags) {

                const zone = detectZone(tag.tag_x, tag.tag_y, zones) || null;

                const imageFileName = htmlMapping[tag.view_name] || null;

                const originalSnapPath = imageFileName
                    ? path.join(
                        "uploads/permanent",
                        jobNo,
                        unitNo,
                        stage,
                        folderId.toString(),
                        imageFileName
                    ).replace(/\\/g, "/")
                    : null;

                await pool.query(
                    `INSERT INTO tags
                    (folder_id, tag_no, description, tag_date, view_name, tag_x, tag_y, zone, status, original_snap_path)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW', $9)`,
                    [
                        folderId,
                        tag.tag_no,
                        tag.description,
                        tag.tag_date,
                        tag.view_name,
                        tag.tag_x || null,
                        tag.tag_y || null,
                        zone,
                        originalSnapPath,
                    ]
                );
            }

            // 🔹 4. Move temp folder to permanent location

            const tempPath = path.join(
                __dirname,
                "../../uploads/temp",
                req.uploadId
            );

            const permanentPath = path.join(
                __dirname,
                "../../uploads/permanent",
                jobNo,
                unitNo,
                stage,
                folderId.toString()
            );

            fs.mkdirSync(permanentPath, { recursive: true });

            const filesInTemp = fs.readdirSync(tempPath);

            for (const file of filesInTemp) {
                fs.renameSync(
                    path.join(tempPath, file),
                    path.join(permanentPath, file)
                );
            }

            fs.rmSync(tempPath, { recursive: true, force: true });

            res.json({
                message: "Folder uploaded and saved to database successfully",
                jobId,
                folderId,
                tagCount: tags.length,
            });

        } catch (err) {

            console.error(err);

            res.status(500).json({
                message: "Upload processing failed",
                error: err.message,
            });
        }
    }
);

// Manually-entered tag list (Excel) — for departments without a Navisworks
// model to derive tags from. Kept in memory (never written to disk) since,
// unlike a folder upload, there's nothing to serve/store afterward.
const excelUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — a tag list is never legitimately larger
});

router.post(
    "/upload-excel",
    authenticateToken,
    requirePEM,
    excelUpload.single("excelFile"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: "No Excel file provided." });
            }

            const ext = path.extname(req.file.originalname).toLowerCase();
            if (![".xlsx", ".xls"].includes(ext)) {
                return res.status(400).json({ message: "Only .xlsx or .xls files are supported." });
            }

            const { jobNo, unitNo, stage } = req.body;

            if (!jobNo || !unitNo || !stage) {
                return res.status(400).json({
                    message: "Job No, Unit No and Stage are required",
                });
            }

            let parsed;
            try {
                parsed = await parseExcelFile(req.file.buffer);
            } catch (parseErr) {
                return res.status(400).json({
                    message: "Could not read the Excel file — it may be corrupted or not a valid .xlsx/.xls file.",
                });
            }

            const { tags, errors } = parsed;

            if (errors.length > 0) {
                const shown = errors.slice(0, 10);
                const suffix = errors.length > shown.length ? ` (+${errors.length - shown.length} more)` : "";
                return res.status(400).json({
                    message: `Excel validation failed: ${shown.join(" | ")}${suffix}`,
                });
            }

            if (tags.length === 0) {
                return res.status(400).json({
                    message: "No valid tag rows found in the Excel file.",
                });
            }

            // 🔹 1. Check if job exists (identical to /upload-folder)
            let jobResult = await pool.query(
                `SELECT id FROM jobs
                 WHERE job_no = $1
                 AND unit_no = $2
                 AND review_stage = $3`,
                [jobNo, unitNo, stage]
            );

            let jobId;

            if (jobResult.rows.length > 0) {
                jobId = jobResult.rows[0].id;
            } else {
                const newJob = await pool.query(
                    `INSERT INTO jobs (job_no, unit_no, review_stage)
                     VALUES ($1, $2, $3)
                     RETURNING id`,
                    [jobNo, unitNo, stage]
                );

                jobId = newJob.rows[0].id;
            }

            // 🔹 2. Insert folder row — model_file marks this as a non-model source
            const folderInsert = await pool.query(
                `INSERT INTO uploaded_folders
                 (job_id, folder_name, uploaded_by, model_file)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [jobId, req.file.originalname, req.user.employeeId, "(Manual entry — no model file)"]
            );

            const folderId = folderInsert.rows[0].id;

            // 🔹 3. Insert tags — no view/snap/coordinates/zone, this isn't model-derived
            for (const tag of tags) {
                await pool.query(
                    `INSERT INTO tags
                    (folder_id, tag_no, description, tag_date, status)
                    VALUES ($1, $2, $3, $4, 'NEW')`,
                    [folderId, tag.tag_no, tag.description, tag.tag_date]
                );
            }

            res.json({
                message: "Excel tags uploaded and saved to database successfully",
                jobId,
                folderId,
                tagCount: tags.length,
            });

        } catch (err) {

            console.error(err);

            res.status(500).json({
                message: "Excel upload processing failed",
                error: err.message,
            });
        }
    }
);

module.exports = router;