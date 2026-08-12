// const fs = require("fs");
// const path = require("path");
// const xml2js = require("xml2js");

// const parseXmlFile = async (uploadFolderPath) => {
//     const files = fs.readdirSync(uploadFolderPath);

//     const xmlFile = files.find(
//         (file) => path.extname(file).toLowerCase() === ".xml"
//     );

//     if (!xmlFile) {
//         throw new Error("No XML file found in folder");
//     }

//     const xmlPath = path.join(uploadFolderPath, xmlFile);
//     const xmlContent = fs.readFileSync(xmlPath, "utf-8");

//     const parser = new xml2js.Parser({
//         explicitArray: false,
//         mergeAttrs: true,   // Important: attributes become direct properties
//     });

//     const result = await parser.parseStringPromise(xmlContent);

//     const tags = [];

//     // Find viewpoints node dynamically
//     let viewpointsNode = null;

//     if (result.viewpoints) {
//         viewpointsNode = result.viewpoints;
//     } else {
//         // search one level deep
//         const rootKeys = Object.keys(result);
//         for (let key of rootKeys) {
//             if (result[key].viewpoints) {
//                 viewpointsNode = result[key].viewpoints;
//                 break;
//             }
//         }
//     }

//     if (!viewpointsNode || !viewpointsNode.view) {
//         throw new Error("Invalid XML structure: <viewpoints> not found");
//     }

//     const views = Array.isArray(viewpointsNode.view)
//         ? viewpointsNode.view
//         : [viewpointsNode.view];


//     views.forEach((view) => {
//         const viewName = view.name || "Unknown View";

//         if (!view.comments || !view.comments.comment) return;

//         const comments = Array.isArray(view.comments.comment)
//             ? view.comments.comment
//             : [view.comments.comment];

//         comments.forEach((comment) => {
//             const dateObj = comment.createddate?.date;

//             let formattedDate = null;

//             if (dateObj) {
//                 formattedDate = `${dateObj.year}-${dateObj.month.padStart(2, "0")}-${dateObj.day.padStart(2, "0")}`;
//             }

//             tags.push({
//                 tag_no: comment.id,
//                 description: comment.body || "",
//                 tag_date: formattedDate,
//                 view_name: viewName,
//             });
//         });
//     });

//     return tags;
// };

// module.exports = parseXmlFile;


const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

const parseXmlFile = async (uploadFolderPath) => {
    const files = fs.readdirSync(uploadFolderPath);

    const xmlFile = files.find(
        (file) => path.extname(file).toLowerCase() === ".xml"
    );

    if (!xmlFile) {
        throw new Error("No XML file found in folder");
    }

    const xmlPath = path.join(uploadFolderPath, xmlFile);
    const xmlContent = fs.readFileSync(xmlPath, "utf-8");

    const parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
    });

    const result = await parser.parseStringPromise(xmlContent);

    const tags = [];

    // 🔹 Extract model file name
    let model_file = null;
    if (result.exchange && result.exchange.filename) {
        model_file = result.exchange.filename;
    }

    // 🔹 Find viewpoints node dynamically
    let viewpointsNode = null;

    if (result.viewpoints) {
        viewpointsNode = result.viewpoints;
    } else {
        const rootKeys = Object.keys(result);
        for (let key of rootKeys) {
            if (result[key].viewpoints) {
                viewpointsNode = result[key].viewpoints;
                break;
            }
        }
    }

    if (!viewpointsNode || !viewpointsNode.view) {
        throw new Error("Invalid XML structure: <viewpoints> not found");
    }

    const views = Array.isArray(viewpointsNode.view)
        ? viewpointsNode.view
        : [viewpointsNode.view];

    views.forEach((view) => {
        const viewName = view.name || "Unknown View";

        if (!view.comments || !view.comments.comment) return;

        const comments = Array.isArray(view.comments.comment)
            ? view.comments.comment
            : [view.comments.comment];

        comments.forEach((comment) => {

            const dateObj = comment.createddate?.date;
            let formattedDate = null;

            if (dateObj) {
                formattedDate = `${dateObj.year}-${dateObj.month.padStart(2, "0")}-${dateObj.day.padStart(2, "0")}`;
            }

            // 🔹 Extract tag coordinates from redlines
            let tag_x = null;
            let tag_y = null;

            if (view.redlines && view.redlines.rltag) {

                const rltags = Array.isArray(view.redlines.rltag)
                    ? view.redlines.rltag
                    : [view.redlines.rltag];

                const matchingTag = rltags.find(
                    (r) => String(r.commentid) === String(comment.id)
                );

                if (matchingTag && matchingTag.pos3d && matchingTag.pos3d.pos3f) {
                    tag_x = parseFloat(matchingTag.pos3d.pos3f.x);
                    tag_y = parseFloat(matchingTag.pos3d.pos3f.y);
                }
            }

            tags.push({
                tag_no: comment.id,
                description: comment.body || "",
                tag_date: formattedDate,
                view_name: viewName,
                tag_x: tag_x,
                tag_y: tag_y,
            });
        });
    });

    return {
        model_file,
        tags
    };
};

module.exports = parseXmlFile;