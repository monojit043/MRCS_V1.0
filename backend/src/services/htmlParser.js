const fs = require("fs");

function parseHtmlForImages(folderPath) {
  const files = fs.readdirSync(folderPath);

  const htmlFile = files.find(f => f.endsWith(".html"));
  if (!htmlFile) return {};

  const htmlPath = require("path").join(folderPath, htmlFile);
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  const mapping = {};

  // Match each viewpoint block
  const regex = /<div class="viewpoint">([\s\S]*?)<\/div>/g;

  let match;

  while ((match = regex.exec(htmlContent)) !== null) {
    const block = match[1];

    const viewMatch = block.match(/<h2>(.*?)<\/h2>/);
    const imgMatch = block.match(/<a href="(.*?)"/);

    if (viewMatch && imgMatch) {
      const viewName = viewMatch[1].trim();
      const imageFile = imgMatch[1].trim();

      mapping[viewName] = imageFile;
    }
  }

  return mapping;
}

module.exports = parseHtmlForImages;
