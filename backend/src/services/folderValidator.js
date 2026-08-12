const path = require("path");

const IGNORED_FILES = new Set([
  "thumbs.db",
  "desktop.ini",
  ".ds_store",
]);

const validateFolder = (files) => {
  let counts = {
    nwd: 0,
    xml: 0,
    html: 0,
    images: 0,
    invalid: [],
  };

  files.forEach((file) => {
    const basename = path.basename(file.originalname).toLowerCase();
    if (IGNORED_FILES.has(basename)) return;

    const ext = path.extname(file.originalname).toLowerCase();

    switch (ext) {
      case ".nwd":
        counts.nwd++;
        break;
      case ".xml":
        counts.xml++;
        break;
      case ".html":
        counts.html++;
        break;
      case ".png":
      case ".jpg":
      case ".jpeg":
        counts.images++;
        break;
      default:
        counts.invalid.push(file.originalname);
    }
  });

  const errors = [];

  if (counts.nwd !== 1)
    errors.push(`Expected 1 .nwd file, found ${counts.nwd}`);
  if (counts.xml !== 1)
    errors.push(`Expected 1 .xml file, found ${counts.xml}`);
  if (counts.html !== 1)
    errors.push(`Expected 1 .html file, found ${counts.html}`);
  if (counts.invalid.length > 0)
    errors.push(
      `Invalid files detected: ${counts.invalid.join(", ")}`
    );

  return {
    isValid: errors.length === 0,
    errors,
    summary: counts,
  };
};

module.exports = validateFolder;
