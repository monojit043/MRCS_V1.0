const nodemailer = require("nodemailer");

const isGmail    = (process.env.EMAIL_HOST || "").toLowerCase().includes("gmail");
const hasAuth    = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
const emailPort  = parseInt(process.env.EMAIL_PORT || (isGmail ? "465" : "25"));
const emailHost  = isGmail ? "smtp.gmail.com" : (process.env.EMAIL_HOST || "localhost");

// Connection type follows the PORT, for every provider (Gmail, Office 365, …):
//   465 → implicit SSL (secure: true)
//   587 → plain connection upgraded with STARTTLS (secure: false + requireTLS)
// Forcing secure:true on 587 (the old Gmail branch) made every send fail with
// "SSL routines … wrong version number".
const transporterConfig = {
  host:   emailHost,
  port:   emailPort,
  secure: emailPort === 465,
  family: 4,  // always force IPv4
  tls:    { rejectUnauthorized: false },
};

if (hasAuth) {
  transporterConfig.auth = {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  };
}

if (emailPort === 587) {
  transporterConfig.requireTLS = true;
}

const transporter = nodemailer.createTransport(transporterConfig);

const FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;

/**
 * Send a single email.
 * @param {string|string[]} to
 * @param {string} subject
 * @param {string} html
 */
async function sendMail(to, subject, html) {
  await transporter.sendMail({
    from:    `"MRCS System" <${FROM}>`,
    to:      Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
  });
}

/**
 * Build and send the "new external model review" notification.
 *
 * @param {object} review  – row from model_review_initiations
 * @param {string} createdByName
 * @param {object[]} recipients  – [{ employee_name, email, department, role }]
 */
async function sendReviewCreatedNotification(review, createdByName, recipients) {
  if (!recipients || recipients.length === 0) return;

  const fmt = (d) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const dateRange =
    review.review_date_from || review.review_date_to
      ? `${fmt(review.review_date_from)} — ${fmt(review.review_date_to)}`
      : "Not specified";

  /* Send individual emails (personalised greeting per recipient) */
  const results = await Promise.allSettled(
    recipients.map((r) => {
      const subject = `[MRCS] New Model Review Created — Job: ${review.job_no} / Unit: ${review.unit_no} / Stage: ${review.stage}`;

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  body { margin:0; padding:0; background:#f4f7fb; font-family:'Segoe UI',Arial,sans-serif; color:#1a2540; }
  .wrapper { max-width:620px; margin:32px auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.10); }
  .header  { background:#0a1a3a; padding:28px 32px; }
  .header h1 { margin:0; color:#ffffff; font-size:20px; font-weight:700; letter-spacing:-.3px; }
  .header p  { margin:4px 0 0; color:#8ab4d8; font-size:12px; }
  .body    { padding:28px 32px; }
  .greeting { font-size:15px; margin-bottom:18px; }
  .intro    { font-size:13.5px; color:#374151; line-height:1.6; margin-bottom:24px; }
  .info-box { background:#f0f5ff; border:1px solid #c7d8f5; border-radius:6px; padding:18px 20px; margin-bottom:24px; }
  .info-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #dde8f8; font-size:13px; }
  .info-row:last-child { border-bottom:none; }
  .info-label { color:#6b7898; font-weight:600; min-width:140px; }
  .info-val   { color:#1a2540; font-weight:500; text-align:right; }
  .section-title { font-size:12px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:#6b7898; margin-bottom:10px; }
  .badge { display:inline-block; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:700; background:#dbeafe; color:#1d4ed8; }
  .action { margin:24px 0; }
  .action a { display:inline-block; background:#0077cc; color:#ffffff; text-decoration:none; padding:11px 24px; border-radius:5px; font-size:13.5px; font-weight:600; }
  .prereq-note { background:#fef9c3; border:1px solid #fde68a; border-radius:6px; padding:14px 18px; font-size:13px; color:#854d0e; line-height:1.5; margin-bottom:24px; }
  .footer { background:#f4f7fb; padding:18px 32px; font-size:11px; color:#8892a8; border-top:1px solid #e5eaf3; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>MRCS — Model Review System</h1>
    <p>External Model Review Notification</p>
  </div>
  <div class="body">
    <p class="greeting">Dear <strong>${r.employee_name}</strong>,</p>
    <p class="intro">
      A new <strong>External Model Review</strong> has been initiated. As a department lead,
      you are requested to complete the <strong>Departmental Prerequisites</strong> for this review
      at the earliest.
    </p>

    <div class="section-title">Review Details</div>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Job No</span>
        <span class="info-val">${review.job_no}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Unit No</span>
        <span class="info-val">${review.unit_no}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Stage</span>
        <span class="info-val"><span class="badge">${review.stage}</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">Review Period</span>
        <span class="info-val">${dateRange}</span>
      </div>
      ${review.description ? `
      <div class="info-row">
        <span class="info-label">Description</span>
        <span class="info-val">${review.description}</span>
      </div>` : ""}
      <div class="info-row">
        <span class="info-label">Initiated By</span>
        <span class="info-val">${createdByName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Your Department</span>
        <span class="info-val">${(r.department || "—").toUpperCase()}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Your Role</span>
        <span class="info-val">${r.role}</span>
      </div>
    </div>

    <div class="prereq-note">
      &#9888;&nbsp; Please log in to MRCS and complete all <strong>departmental prerequisites</strong>
      for this review. Timely completion ensures the review proceeds without delays.
    </div>

    <div class="action">
      <a href="http://10.40.36.130:5500/login.html">Log in to MRCS &rarr;</a>
    </div>

    <p style="font-size:12px;color:#8892a8;">
      This is an automated notification from the MRCS system. Please do not reply to this email.
    </p>
  </div>
  <div class="footer">
    MRCS &nbsp;&bull;&nbsp; Model Review Compliance System &nbsp;&bull;&nbsp; EIL
  </div>
</div>
</body>
</html>`;

      return sendMail(r.email, subject, html);
    })
  );

  /* Log per-recipient outcome so failures are visible in the console */
  results.forEach((res, i) => {
    const r = recipients[i];
    if (res.status === "fulfilled") {
      console.log(`[MRCS Mailer] ✓ Sent to ${r.employee_name} <${r.email}>`);
    } else {
      console.error(`[MRCS Mailer] ✗ Failed for ${r.employee_name} <${r.email}>: ${res.reason?.message}`);
    }
  });

  return results;
}

/**
 * Send a "you have been assigned" notification to a single GL/LE.
 *
 * @param {object} review      – row from model_review_initiations
 * @param {object} assignee    – { employee_name, email, role, department }
 * @param {string} assignedByName
 */
async function sendAssignmentNotification(review, assignee, assignedByName) {
  if (!assignee?.email) return;

  const fmt = (d) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const dateRange =
    review.review_date_from || review.review_date_to
      ? `${fmt(review.review_date_from)} — ${fmt(review.review_date_to)}`
      : "Not specified";

  const subject = `[MRCS] You have been assigned to a Model Review — Job: ${review.job_no} / Unit: ${review.unit_no} / Stage: ${review.stage}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  body { margin:0; padding:0; background:#f4f7fb; font-family:'Segoe UI',Arial,sans-serif; color:#1a2540; }
  .wrapper { max-width:620px; margin:32px auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.10); }
  .header  { background:#0a1a3a; padding:28px 32px; }
  .header h1 { margin:0; color:#ffffff; font-size:20px; font-weight:700; letter-spacing:-.3px; }
  .header p  { margin:4px 0 0; color:#8ab4d8; font-size:12px; }
  .body    { padding:28px 32px; }
  .greeting { font-size:15px; margin-bottom:18px; }
  .intro    { font-size:13.5px; color:#374151; line-height:1.6; margin-bottom:24px; }
  .info-box { background:#f0f5ff; border:1px solid #c7d8f5; border-radius:6px; padding:18px 20px; margin-bottom:24px; }
  .info-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #dde8f8; font-size:13px; }
  .info-row:last-child { border-bottom:none; }
  .info-label { color:#6b7898; font-weight:600; min-width:140px; }
  .info-val   { color:#1a2540; font-weight:500; text-align:right; }
  .assign-box { background:#e8f5e9; border:1px solid #a5d6a7; border-radius:6px; padding:14px 18px; margin-bottom:24px; font-size:13.5px; color:#1b5e20; line-height:1.6; }
  .assign-box strong { color:#1b5e20; }
  .badge { display:inline-block; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:700; background:#dbeafe; color:#1d4ed8; }
  .badge-role { background:#d1fae5; color:#065f46; }
  .action { margin:24px 0; }
  .action a { display:inline-block; background:#0077cc; color:#ffffff; text-decoration:none; padding:11px 24px; border-radius:5px; font-size:13.5px; font-weight:600; }
  .footer { background:#f4f7fb; padding:18px 32px; font-size:11px; color:#8892a8; border-top:1px solid #e5eaf3; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>MRCS — Model Review System</h1>
    <p>Department Lead Assignment Notification</p>
  </div>
  <div class="body">
    <p class="greeting">Dear <strong>${assignee.employee_name}</strong>,</p>
    <p class="intro">
      You have been assigned as <strong>${assignee.role}</strong> for the
      <strong>${assignee.department.toUpperCase()}</strong> department for the following
      External Model Review by <strong>${assignedByName}</strong>.
    </p>

    <div class="assign-box">
      &#10003;&nbsp; <strong>Assignment:</strong>
      ${assignee.role} &mdash; ${assignee.department.toUpperCase()} Department
    </div>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Job No</span>
        <span class="info-val">${review.job_no}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Unit No</span>
        <span class="info-val">${review.unit_no}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Stage</span>
        <span class="info-val"><span class="badge">${review.stage}</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">Review Period</span>
        <span class="info-val">${dateRange}</span>
      </div>
      ${review.description ? `
      <div class="info-row">
        <span class="info-label">Description</span>
        <span class="info-val">${review.description}</span>
      </div>` : ""}
      <div class="info-row">
        <span class="info-label">Assigned By</span>
        <span class="info-val">${assignedByName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Your Role</span>
        <span class="info-val"><span class="badge badge-role">${assignee.role}</span></span>
      </div>
    </div>

    <p class="intro" style="margin-bottom:24px;">
      Please log in to MRCS and complete all <strong>departmental prerequisites</strong>
      for this review at the earliest so the review can proceed on schedule.
    </p>

    <div class="action">
      <a href="http://10.40.36.130:5500/login.html">Log in to MRCS &rarr;</a>
    </div>

    <p style="font-size:12px;color:#8892a8;">
      This is an automated notification from the MRCS system. Please do not reply to this email.
    </p>
  </div>
  <div class="footer">
    MRCS &nbsp;&bull;&nbsp; Model Review Compliance System &nbsp;&bull;&nbsp; EIL
  </div>
</div>
</body>
</html>`;

  await sendMail(assignee.email, subject, html);
}

/**
 * Send "tags have been allocated to your department" to a single GL/LE.
 *
 * @param {object}   review          – { job_no, unit_no, stage }
 * @param {object}   assignee        – { employee_name, email, role, department }
 * @param {object[]} tags            – [{ tag_no, description }]
 * @param {string}   allocatedByName
 */
async function sendTagAllocationNotification(review, assignee, tags, allocatedByName) {
  if (!assignee?.email || !tags?.length) return;

  const subject = `[MRCS] Tags Allocated to Your Department — Job: ${review.job_no} / Unit: ${review.unit_no} / Stage: ${review.stage}`;

  const tagRows = tags.map(t => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #dde8f8;font-size:13px;color:#1a2540;font-weight:600;">${t.tag_no}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #dde8f8;font-size:13px;color:#374151;">${t.description || "—"}</td>
    </tr>`).join("");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  body { margin:0; padding:0; background:#f4f7fb; font-family:'Segoe UI',Arial,sans-serif; color:#1a2540; }
  .wrapper { max-width:640px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.10); }
  .header  { background:#0a1a3a; padding:28px 32px; }
  .header h1 { margin:0; color:#fff; font-size:20px; font-weight:700; letter-spacing:-.3px; }
  .header p  { margin:4px 0 0; color:#8ab4d8; font-size:12px; }
  .body    { padding:28px 32px; }
  .greeting { font-size:15px; margin-bottom:16px; }
  .intro    { font-size:13.5px; color:#374151; line-height:1.6; margin-bottom:20px; }
  .alloc-banner { background:#e8f5e9; border:1px solid #a5d6a7; border-radius:6px; padding:14px 18px; margin-bottom:22px; font-size:13.5px; color:#1b5e20; }
  .info-box { background:#f0f5ff; border:1px solid #c7d8f5; border-radius:6px; padding:14px 18px; margin-bottom:22px; }
  .info-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #dde8f8; font-size:13px; }
  .info-row:last-child { border-bottom:none; }
  .info-label { color:#6b7898; font-weight:600; min-width:130px; }
  .info-val   { color:#1a2540; font-weight:500; text-align:right; }
  .badge { display:inline-block; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:700; background:#dbeafe; color:#1d4ed8; }
  .section-title { font-size:12px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:#6b7898; margin-bottom:8px; }
  table.tag-list { width:100%; border-collapse:collapse; margin-bottom:24px; border:1px solid #c7d8f5; border-radius:6px; overflow:hidden; }
  table.tag-list th { background:#e8eef8; padding:8px 10px; font-size:12px; font-weight:700; color:#4a5568; text-align:left; letter-spacing:.04em; }
  .action { margin:20px 0; }
  .action a { display:inline-block; background:#0077cc; color:#fff; text-decoration:none; padding:11px 24px; border-radius:5px; font-size:13.5px; font-weight:600; }
  .footer { background:#f4f7fb; padding:18px 32px; font-size:11px; color:#8892a8; border-top:1px solid #e5eaf3; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>MRCS — Model Review System</h1>
    <p>Tag Allocation Notification</p>
  </div>
  <div class="body">
    <p class="greeting">Dear <strong>${assignee.employee_name}</strong>,</p>
    <p class="intro">
      <strong>${tags.length} tag${tags.length > 1 ? "s have" : " has"} been allocated</strong>
      to the <strong>${assignee.department.toUpperCase()}</strong> department for the following
      model review by <strong>${allocatedByName}</strong>.
      Please log in to MRCS and begin resolution at the earliest.
    </p>

    <div class="alloc-banner">
      &#10003;&nbsp; <strong>${tags.length} Tag${tags.length > 1 ? "s" : ""} Allocated</strong>
      &mdash; ${assignee.department.toUpperCase()} &nbsp;|&nbsp; ${assignee.role}
    </div>

    <div class="info-box">
      <div class="info-row"><span class="info-label">Job No</span><span class="info-val">${review.job_no}</span></div>
      <div class="info-row"><span class="info-label">Unit No</span><span class="info-val">${review.unit_no}</span></div>
      <div class="info-row"><span class="info-label">Stage</span><span class="info-val"><span class="badge">${review.stage}</span></span></div>
      <div class="info-row"><span class="info-label">Allocated By</span><span class="info-val">${allocatedByName}</span></div>
    </div>

    <div class="section-title">Allocated Tags</div>
    <table class="tag-list">
      <thead><tr><th>Tag No</th><th>Description</th></tr></thead>
      <tbody>${tagRows}</tbody>
    </table>

    <div class="action">
      <a href="http://10.40.36.130:5500/login.html">Log in to MRCS &rarr;</a>
    </div>
    <p style="font-size:12px;color:#8892a8;">This is an automated notification from MRCS. Please do not reply.</p>
  </div>
  <div class="footer">MRCS &nbsp;&bull;&nbsp; Model Review Compliance System &nbsp;&bull;&nbsp; EIL</div>
</div>
</body>
</html>`;

  await sendMail(assignee.email, subject, html);
}

/**
 * Send "a tag has been reassigned to your department" to a single GL/LE.
 *
 * @param {object} review          – { job_no, unit_no, stage }
 * @param {object} assignee        – { employee_name, email, role, department }
 * @param {object} tag             – { tag_no, description }
 * @param {string} reassignedByName
 */
async function sendTagReassignmentNotification(review, assignee, tag, reassignedByName) {
  if (!assignee?.email) return;

  const subject = `[MRCS] Tag Reassigned to Your Department — Job: ${review.job_no} / Unit: ${review.unit_no} / Stage: ${review.stage}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  body { margin:0; padding:0; background:#f4f7fb; font-family:'Segoe UI',Arial,sans-serif; color:#1a2540; }
  .wrapper { max-width:620px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.10); }
  .header  { background:#0a1a3a; padding:28px 32px; }
  .header h1 { margin:0; color:#fff; font-size:20px; font-weight:700; letter-spacing:-.3px; }
  .header p  { margin:4px 0 0; color:#8ab4d8; font-size:12px; }
  .body    { padding:28px 32px; }
  .greeting { font-size:15px; margin-bottom:16px; }
  .intro    { font-size:13.5px; color:#374151; line-height:1.6; margin-bottom:20px; }
  .reassign-banner { background:#fff3e0; border:1px solid #ffcc80; border-radius:6px; padding:14px 18px; margin-bottom:22px; font-size:13.5px; color:#e65100; }
  .info-box { background:#f0f5ff; border:1px solid #c7d8f5; border-radius:6px; padding:14px 18px; margin-bottom:22px; }
  .info-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #dde8f8; font-size:13px; }
  .info-row:last-child { border-bottom:none; }
  .info-label { color:#6b7898; font-weight:600; min-width:130px; }
  .info-val   { color:#1a2540; font-weight:500; text-align:right; }
  .badge { display:inline-block; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:700; background:#dbeafe; color:#1d4ed8; }
  .action { margin:20px 0; }
  .action a { display:inline-block; background:#0077cc; color:#fff; text-decoration:none; padding:11px 24px; border-radius:5px; font-size:13.5px; font-weight:600; }
  .footer { background:#f4f7fb; padding:18px 32px; font-size:11px; color:#8892a8; border-top:1px solid #e5eaf3; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>MRCS — Model Review System</h1>
    <p>Tag Reassignment Notification</p>
  </div>
  <div class="body">
    <p class="greeting">Dear <strong>${assignee.employee_name}</strong>,</p>
    <p class="intro">
      A tag has been <strong>reassigned</strong> to the
      <strong>${assignee.department.toUpperCase()}</strong> department for the following
      model review by <strong>${reassignedByName}</strong>.
      Please log in to MRCS to begin resolution.
    </p>

    <div class="reassign-banner">
      &#8635;&nbsp; <strong>Tag Reassigned</strong>
      &mdash; ${assignee.department.toUpperCase()} &nbsp;|&nbsp; ${assignee.role}
    </div>

    <div class="info-box">
      <div class="info-row"><span class="info-label">Job No</span><span class="info-val">${review.job_no}</span></div>
      <div class="info-row"><span class="info-label">Unit No</span><span class="info-val">${review.unit_no}</span></div>
      <div class="info-row"><span class="info-label">Stage</span><span class="info-val"><span class="badge">${review.stage}</span></span></div>
      <div class="info-row"><span class="info-label">Tag No</span><span class="info-val"><strong>${tag.tag_no}</strong></span></div>
      <div class="info-row"><span class="info-label">Description</span><span class="info-val">${tag.description || "—"}</span></div>
      <div class="info-row"><span class="info-label">Reassigned By</span><span class="info-val">${reassignedByName}</span></div>
    </div>

    <div class="action">
      <a href="http://10.40.36.130:5500/login.html">Log in to MRCS &rarr;</a>
    </div>
    <p style="font-size:12px;color:#8892a8;">This is an automated notification from MRCS. Please do not reply.</p>
  </div>
  <div class="footer">MRCS &nbsp;&bull;&nbsp; Model Review Compliance System &nbsp;&bull;&nbsp; EIL</div>
</div>
</body>
</html>`;

  await sendMail(assignee.email, subject, html);
}

module.exports = {
  sendMail,
  sendReviewCreatedNotification,
  sendAssignmentNotification,
  sendTagAllocationNotification,
  sendTagReassignmentNotification,
};
