// Guards /uploads (served by express.static) — files are only served to signed-in
// users with a role on the review the file belongs to. Pages load these with plain
// <img src> / <a href>, so the user comes from the shared single sign-on cookie.
//
//   permanent/<job>/<unit>/<stage>/<folderId>/...  → role on the folder's review
//   resolutions/<tagId>/...                         → role on the tag's review
//   company-logo.png                                → any signed-in user
//   temp/..., anything else                         → refused
const { authenticateCookie } = require("./auth.middleware");
const { hasReviewRole, reviewOfFolder, reviewOfTag } = require("../services/reviewAccess");

function segments(reqPath) {
  try {
    return reqPath.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null; // malformed encoding
  }
}

async function resolveReview(parts) {
  const [area, ...rest] = parts;
  if (area === "permanent" && rest.length >= 5 && /^\d+$/.test(rest[3])) {
    const review = await reviewOfFolder(rest[3]);
    // the path's job / unit / stage must match the folder's real review
    if (review &&
        review.jobNo.toUpperCase() === rest[0].toUpperCase() &&
        review.unitNo.toUpperCase() === rest[1].toUpperCase() &&
        review.stage === rest[2]) return review;
    return null;
  }
  if (area === "resolutions" && rest.length >= 2 && /^\d+$/.test(rest[0])) {
    return reviewOfTag(rest[0]);
  }
  return null;
}

async function checkAccess(req, res, next) {
  const parts = segments(req.path);
  if (!parts || parts.some((p) => p === ".." || p.includes("\\"))) {
    return res.status(400).json({ message: "Bad file path" });
  }
  if (parts.length === 1 && parts[0] === "company-logo.png") return next();

  try {
    const review = await resolveReview(parts);
    if (!review) return res.status(404).json({ message: "File not found" });
    if (await hasReviewRole(req.user, review, "JE")) return next();
    return res.status(403).json({ message: `Access denied: you have no role on ${review.jobNo} / ${review.unitNo} / ${review.stage}` });
  } catch (err) {
    console.error("protectUploads:", err.message);
    res.status(500).json({ message: "Access check failed" });
  }
}

module.exports = [authenticateCookie, checkAccess];
