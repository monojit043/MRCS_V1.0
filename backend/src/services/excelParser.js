const ExcelJS = require("exceljs");

const REQUIRED_HEADERS = ["Tag No", "Tag Description"];

function cellToText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map(rt => rt.text).join("").trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
    return "";
  }
  return String(value).trim();
}

function cellToDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(cellToText(value));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Parses a manually-entered tag list. Only "Tag No" and "Tag Description" are
// required — this is the alternate ingestion path for departments (e.g.
// Electrical) that don't have a Navisworks model to derive tags from, so it
// intentionally carries no view/coordinate/snapshot data.
async function parseExcelFile(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { tags: [], errors: ["Excel file has no sheets."] };
  }

  const headerRow = sheet.getRow(1);
  const colIndex = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    colIndex[cellToText(cell.value)] = colNumber;
  });

  const missing = REQUIRED_HEADERS.filter(h => !(h in colIndex));
  if (missing.length) {
    return {
      tags: [],
      errors: [`Missing required column(s): ${missing.join(", ")}. Expected headers: ${REQUIRED_HEADERS.join(", ")}.`],
    };
  }

  const tagNoCol = colIndex["Tag No"];
  const descCol = colIndex["Tag Description"];
  const dateCol = colIndex["Tag Taken Date"];

  const tags = [];
  const errors = [];
  const seenTagNos = new Set();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const tagNo = cellToText(row.getCell(tagNoCol).value);
    const description = cellToText(row.getCell(descCol).value);

    if (!tagNo && !description) return; // fully blank row, skip silently

    if (!tagNo || !description) {
      errors.push(`Row ${rowNumber}: Tag No and Tag Description are both required.`);
      return;
    }

    if (seenTagNos.has(tagNo)) {
      errors.push(`Row ${rowNumber}: duplicate Tag No "${tagNo}" within this file.`);
      return;
    }
    seenTagNos.add(tagNo);

    const tagDate = dateCol ? cellToDate(row.getCell(dateCol).value) : null;

    tags.push({ tag_no: tagNo, description, tag_date: tagDate });
  });

  return { tags, errors };
}

module.exports = parseExcelFile;
