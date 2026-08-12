if (!localStorage.getItem("token")) {
  window.location.href = "login.html";
}

const userDept = (localStorage.getItem("department") || "").toLowerCase();
const userRole = localStorage.getItem("role") || "";
const isPEM = userDept === "pem";


// ===== PANEL SWITCHING (hash-based, tabs live in topbar) =====
const PEM_PANELS    = ["panelDashboard", "panelInitiate", "panelAssign"];
const NONPEM_PANELS = ["panelNonPEMDash"];

const HASH_TO_PANEL = {
  '#dashboard': 'panelDashboard',
  '#initiate':  'panelInitiate',
  '#assign':    'panelAssign',
};

function getPanelFromHash() {
  return HASH_TO_PANEL[window.location.hash] || 'panelDashboard';
}

function showPanel(panelId) {
  PEM_PANELS.forEach(id => {
    document.getElementById(id).style.display = (id === panelId) ? "" : "none";
  });
}

if (isPEM) {
  const activePanel = getPanelFromHash();
  showPanel(activePanel);
  if (activePanel === 'panelDashboard') loadSummary();

  window.addEventListener('hashchange', function () {
    const panelId = getPanelFromHash();
    showPanel(panelId);
    if (panelId === 'panelDashboard') loadSummary();
  });
} else {
  document.getElementById("panelNonPEMDash").style.display = "";
  loadMyReviews();
}

// ===== REVIEW DASHBOARD SUMMARY =====
async function loadSummary() {
  if (!isPEM) return;
  try {
    const s = await apiFetch("/api/initiation/summary");
    const stats = [
      { label: "Total Reviews",    value: s.total,          color: "accent"   },
      { label: "Active Now",       value: s.active,         color: "success"  },
      { label: "Upcoming",         value: s.upcoming,       color: "warn"     },
      { label: "Past / Done",      value: s.past,           color: "muted"    },
      { label: "Reports Closed",   value: s.report_closed,  color: "success"  },
      { label: "Reports Pending",  value: s.report_pending, color: s.report_pending > 0 ? "danger" : "muted" }
    ];
    document.getElementById("summaryStats").innerHTML = stats.map(st => `
      <div class="stat-card stat-card--${st.color}">
        <div class="stat-value">${st.value}</div>
        <div class="stat-label">${st.label}</div>
      </div>
    `).join("");
  } catch (err) {
    document.getElementById("summaryStats").innerHTML =
      `<div class="empty-state">Failed to load dashboard.</div>`;
  }
}

// ===== LOAD EXISTING REVIEWS =====
let allInitiations = [];

async function loadInitiations() {
  try {
    const data = await apiFetch("/api/initiation");
    allInitiations = data.initiations || [];
    renderTable(allInitiations);
  } catch (err) {
    document.getElementById("initiationTableBody").innerHTML =
      `<tr><td colspan="9" class="empty-state">Failed to load reviews.</td></tr>`;
  }
}

document.getElementById("reviewSearchInput").addEventListener("input", function () {
  const term = this.value.trim().toLowerCase();
  if (!term) {
    renderTable(allInitiations);
    return;
  }
  const filtered = allInitiations.filter(r =>
    (r.job_no || "").toLowerCase().includes(term) ||
    (r.unit_no || "").toLowerCase().includes(term) ||
    (r.stage || "").toLowerCase().includes(term) ||
    (r.description || "").toLowerCase().includes(term) ||
    (r.created_by || "").toLowerCase().includes(term)
  );
  renderTable(filtered);
});

function renderTable(rows) {
  const tbody = document.getElementById("initiationTableBody");
  const countEl = document.getElementById("reviewCount");

  countEl.textContent = rows.length + " review(s)";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No model reviews initiated yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.job_no}</td>
      <td>${r.unit_no}</td>
      <td><span class="stage-badge">${r.stage}</span></td>
      <td>${r.review_date_from ? r.review_date_from.split("T")[0] : "—"}</td>
      <td>${r.review_date_to ? r.review_date_to.split("T")[0] : "—"}</td>
      <td>${r.description || "—"}</td>
      <td>${r.created_by || "—"}</td>
      <td>${r.created_at ? r.created_at.split("T")[0] : "—"}</td>
    </tr>`).join("");
}

// ===== POPULATE ASSIGN PICKER (module-level so submitInitBtn can call it) =====
async function populateAssignPicker() {
  const picker = document.getElementById("assignReviewPicker");
  if (!picker) return;
  try {
    const data = await apiFetch("/api/initiation");
    picker.innerHTML = '<option value="">— Select Review —</option>';
    (data.initiations || []).forEach(r => {
      const opt = document.createElement("option");
      opt.value = `${r.job_no}|${r.unit_no}|${r.stage}`;
      opt.textContent = `${r.job_no}  /  ${r.unit_no}  /  ${r.stage}`;
      picker.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load assign picker", err);
  }
}

// ===== SUBMIT NEW REVIEW (PEM only) =====
document.getElementById("submitInitBtn")?.addEventListener("click", async () => {
  const jobNo = document.getElementById("initJobNo").value.trim().toUpperCase();
  const unitNo = document.getElementById("initUnitNo").value.trim().toUpperCase();
  const stage = document.getElementById("initStage").value;
  const reviewDateFrom = document.getElementById("initReviewDateFrom").value;
  const reviewDateTo = document.getElementById("initReviewDateTo").value;
  const description = document.getElementById("initDescription").value.trim();

  if (!jobNo || !unitNo || !stage) {
    alert("Please fill in Job No, Unit No and Stage.");
    return;
  }

  if (reviewDateFrom && reviewDateTo && reviewDateTo < reviewDateFrom) {
    alert("Review Date To cannot be earlier than Review Date From.");
    return;
  }

  try {
    await apiFetch("/api/initiation", {
      method: "POST",
      body: JSON.stringify({ jobNo, unitNo, stage, reviewDateFrom, reviewDateTo, description })
    });

    alert("Model review initiated successfully.");
    document.getElementById("initJobNo").value = "";
    document.getElementById("initUnitNo").value = "";
    document.getElementById("initStage").value = "";
    document.getElementById("initReviewDateFrom").value = "";
    document.getElementById("initReviewDateTo").value = "";
    document.getElementById("initDescription").value = "";

    loadInitiations();
    loadSummary();
    populateAssignPicker();
  } catch (err) {
    alert("Failed: " + err.message);
  }
});


// Initial load
loadInitiations();
loadSummary();

// ===== ASSIGN DEPARTMENT LEADS (PEM only) =====

if (isPEM) {

  let assignJobNo = "", assignUnitNo = "", assignStage = "";

  // Load employees once; populate department filter then employee list dynamically
  let allEmployees = [];

  apiFetch("/api/admin/employees").then(employees => {
    allEmployees = employees || [];

    const depts = [...new Set(
      allEmployees.map(e => (e.department || "").toLowerCase()).filter(Boolean)
    )].sort();

    const deptSel = document.getElementById("assignDeptFilter");
    deptSel.innerHTML = '<option value="">— Select Department —</option>';
    depts.forEach(dept => {
      const opt = document.createElement("option");
      opt.value = dept;
      opt.textContent = dept.charAt(0).toUpperCase() + dept.slice(1);
      deptSel.appendChild(opt);
    });
  }).catch(() => {});

  // Filter employees when department is selected
  document.getElementById("assignDeptFilter").addEventListener("change", function () {
    const dept = this.value;
    const empSel = document.getElementById("assignEmployee");
    empSel.innerHTML = '<option value="">Select Employee</option>';
    if (!dept) return;
    allEmployees
      .filter(e => (e.department || "").toLowerCase() === dept)
      .forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.employee_id;
        opt.textContent = `${e.employee_name || e.name} (${e.employee_id})`;
        empSel.appendChild(opt);
      });
  });

  // Review picker for assignment section
  document.getElementById("assignReviewPicker").addEventListener("change", async function () {
    const val = this.value;
    if (!val) {
      document.getElementById("assignFormWrap").style.display = "none";
      document.getElementById("assignReviewLabel").textContent = "Select a review below";
      return;
    }

    [assignJobNo, assignUnitNo, assignStage] = val.split("|");
    document.getElementById("assignReviewLabel").textContent =
      `${assignJobNo} / ${assignUnitNo} / ${assignStage}`;
    document.getElementById("assignFormWrap").style.display = "block";

    loadAssignments();
  });

  populateAssignPicker();

  async function loadAssignments() {
    if (!assignJobNo) return;
    try {
      const data = await apiFetch(
        `/api/initiation/assignments?jobNo=${assignJobNo}&unitNo=${assignUnitNo}&stage=${encodeURIComponent(assignStage)}`
      );
      renderAssignments(data.assignments || []);
    } catch (err) {
      document.getElementById("assignmentsBody").innerHTML =
        `<tr><td colspan="5" class="empty-state">Failed to load assignments.</td></tr>`;
    }
  }

  function renderAssignments(rows) {
    const tbody = document.getElementById("assignmentsBody");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No leads assigned yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((a, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${a.department.charAt(0).toUpperCase() + a.department.slice(1)}</td>
        <td>${a.employee_name}</td>
        <td><span class="stage-badge">${a.role}</span></td>
        <td>
          <button class="btn-delete-init btn-remove-assign"
            data-empid="${a.employee_id}"
            data-dept="${a.department}">Remove</button>
        </td>
      </tr>
    `).join("");
  }

  document.getElementById("confirmAssignBtn").addEventListener("click", async () => {
    const department = document.getElementById("assignDeptFilter").value;
    const employeeId = document.getElementById("assignEmployee").value;
    const role = document.getElementById("assignRole").value;

    if (!department || !employeeId || !role) {
      alert("Please select department, employee and role.");
      return;
    }

    try {
      await apiFetch("/api/initiation/assignments", {
        method: "POST",
        body: JSON.stringify({
          employeeId, role, department,
          jobNo: assignJobNo, unitNo: assignUnitNo, stage: assignStage
        })
      });
      alert("Lead assigned successfully.");
      loadAssignments();
    } catch (err) {
      alert("Failed: " + err.message);
    }
  });

  document.getElementById("assignmentsBody").addEventListener("click", async (e) => {
    if (!e.target.classList.contains("btn-remove-assign")) return;
    if (!confirm("Remove this assignment?")) return;

    const { empid, dept } = e.target.dataset;
    try {
      await apiFetch("/api/initiation/assignments", {
        method: "DELETE",
        body: JSON.stringify({
          employeeId: empid,
          department: dept,
          jobNo: assignJobNo,
          unitNo: assignUnitNo,
          stage: assignStage
        })
      });
      loadAssignments();
    } catch (err) {
      alert("Remove failed: " + err.message);
    }
  });

}

// ================================================================
// NON-PEM DASHBOARD — ASSIGNED REVIEWS LIST + DETAIL
// ================================================================

let npAllReviews = [];
let npDetailTags = [];

function npReviewStatus(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return { key: "nodates", label: "No Dates" };
  const today = new Date().toISOString().split("T")[0];
  const from  = dateFrom.split("T")[0];
  const to    = dateTo.split("T")[0];
  if (today < from) return { key: "upcoming", label: "Upcoming" };
  if (today > to)   return { key: "past",     label: "Completed" };
  return { key: "active", label: "Active" };
}

async function loadMyReviews() {
  try {
    const data = await apiFetch("/api/initiation/my-stats");
    npAllReviews = data.assignments || [];
    renderReviewCards(npAllReviews);
  } catch (err) {
    console.error("loadMyReviews failed:", err);
    document.getElementById("myReviewsGrid").innerHTML =
      '<div class="empty-state">Failed to load reviews.</div>';
  }
}

function renderReviewCards(reviews) {
  const countEl = document.getElementById("npReviewCount");
  if (countEl) countEl.textContent = reviews.length + " review(s)";

  const grid = document.getElementById("myReviewsGrid");
  if (!reviews.length) {
    grid.innerHTML = '<div class="empty-state">No reviews match your search.</div>';
    return;
  }

  grid.innerHTML = reviews.map((r) => {
    const stats    = r.stats;
    const total    = parseInt(stats.total    || 0);
    const approved = parseInt(stats.approved || 0);
    const pct      = total ? Math.round(approved / total * 100) : 0;
    const rs       = npReviewStatus(r.review_date_from, r.review_date_to);
    const dateText = r.review_date_from
      ? `${r.review_date_from.split("T")[0]} &rarr; ${(r.review_date_to || "").split("T")[0] || "—"}`
      : "No dates set";
    const dept = r.department.charAt(0).toUpperCase() + r.department.slice(1);

    return `
      <div class="np-review-card"
           data-jobno="${r.job_no}"
           data-unitno="${r.unit_no}"
           data-stage="${encodeURIComponent(r.stage)}">
        <div class="np-card-top">
          <div class="np-card-job">
            <span class="np-job-text">${r.job_no} / ${r.unit_no}</span>
            <span class="stage-badge">${r.stage}</span>
          </div>
          <span class="np-review-status np-status--${rs.key}">${rs.label}</span>
        </div>
        <div class="np-card-desc">${r.description || "&nbsp;"}</div>
        <div class="np-card-meta">
          <span>&#128197; ${dateText}</span>
          <span>&#128100; ${r.role} &bull; ${dept}</span>
        </div>
        <div class="np-card-footer">
          <div class="np-progress-wrap">
            <div class="np-progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="np-progress-text">${approved} / ${total} Approved</span>
        </div>
      </div>`;
  }).join("");
}

document.getElementById("npReviewSearch").addEventListener("input", function () {
  const term = this.value.trim().toLowerCase();
  if (!term) { renderReviewCards(npAllReviews); return; }
  renderReviewCards(npAllReviews.filter(r =>
    (r.job_no      || "").toLowerCase().includes(term) ||
    (r.unit_no     || "").toLowerCase().includes(term) ||
    (r.stage       || "").toLowerCase().includes(term) ||
    (r.description || "").toLowerCase().includes(term) ||
    (r.department  || "").toLowerCase().includes(term)
  ));
});

document.getElementById("myReviewsGrid").addEventListener("click", (e) => {
  const card = e.target.closest(".np-review-card");
  if (!card) return;
  showReviewDetail(card.dataset.jobno, card.dataset.unitno, card.dataset.stage);
});

async function showReviewDetail(jobNo, unitNo, stageEncoded) {
  document.getElementById("npDashList").style.display   = "none";
  document.getElementById("npDashDetail").style.display = "";

  const stage = decodeURIComponent(stageEncoded);

  document.getElementById("npDetailTitle").textContent = `${jobNo} / ${unitNo} / ${stage}`;
  document.getElementById("npDetailBadges").innerHTML  = "";
  document.getElementById("npDetailInfo").innerHTML    = '<div class="empty-state" style="padding:12px 0;">Loading…</div>';
  document.getElementById("npStageBreakdown").innerHTML = "";
  document.getElementById("npTagsBody").innerHTML      = '<tr><td colspan="5" class="empty-state">Loading…</td></tr>';

  try {
    const data = await apiFetch(
      `/api/initiation/my-review-detail?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
    );
    const { review, assignment, tags } = data;
    npDetailTags = tags;

    const rs  = npReviewStatus(review.review_date_from, review.review_date_to);
    const crs = review.is_locked
      ? '<span class="np-crs-badge np-crs--closed">CRS Closed</span>'
      : '<span class="np-crs-badge np-crs--pending">CRS Pending</span>';

    document.getElementById("npDetailBadges").innerHTML =
      `<span class="np-review-status np-status--${rs.key}">${rs.label}</span>${crs}`;

    const dept = assignment.department.charAt(0).toUpperCase() + assignment.department.slice(1);
    const fromDate = review.review_date_from ? review.review_date_from.split("T")[0] : "—";
    const toDate   = review.review_date_to   ? review.review_date_to.split("T")[0]   : "—";

    document.getElementById("npDetailInfo").innerHTML = `
      <div class="np-detail-info-item">
        <div class="np-detail-info-label">Review Period</div>
        <div class="np-detail-info-value">${fromDate} &rarr; ${toDate}</div>
      </div>
      <div class="np-detail-info-item">
        <div class="np-detail-info-label">Role</div>
        <div class="np-detail-info-value">${assignment.role}</div>
      </div>
      <div class="np-detail-info-item">
        <div class="np-detail-info-label">Department</div>
        <div class="np-detail-info-value">${dept}</div>
      </div>
      <div class="np-detail-info-item">
        <div class="np-detail-info-label">Description</div>
        <div class="np-detail-info-value">${review.description || "—"}</div>
      </div>`;

    const s = tags.reduce((acc, t) => {
      switch (t.resolution_status) {
        case "SAVED":      acc.draft++;       break;
        case "SUBMITTED":  acc.pending++;     break;
        case "APPROVED":   acc.approved++;    break;
        case "REJECTED":   acc.rejected++;    break;
        default:           acc.not_started++; break;
      }
      acc.total++;
      return acc;
    }, { total: 0, not_started: 0, draft: 0, pending: 0, approved: 0, rejected: 0 });

    document.getElementById("npStageBreakdown").innerHTML = `
      <div class="np-stage-card np-stage--notstarted">
        <div class="np-stage-value">${s.not_started}</div>
        <div class="np-stage-label">Not Started</div>
      </div>
      <div class="np-stage-card np-stage--draft">
        <div class="np-stage-value">${s.draft}</div>
        <div class="np-stage-label">Draft / Saved</div>
      </div>
      <div class="np-stage-card np-stage--pending">
        <div class="np-stage-value">${s.pending}</div>
        <div class="np-stage-label">Pending Approval</div>
      </div>
      <div class="np-stage-card np-stage--approved">
        <div class="np-stage-value">${s.approved}</div>
        <div class="np-stage-label">Approved</div>
      </div>
      <div class="np-stage-card np-stage--rejected">
        <div class="np-stage-value">${s.rejected}</div>
        <div class="np-stage-label">Rejected</div>
      </div>`;

    renderNpTagsTable(tags);

  } catch (err) {
    console.error("showReviewDetail failed:", err);
    document.getElementById("npDetailInfo").innerHTML =
      '<div class="empty-state">Failed to load review detail.</div>';
  }
}

function renderNpTagsTable(tags) {
  const tbody = document.getElementById("npTagsBody");
  if (!tags.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No locked tags for this review.</td></tr>';
    return;
  }
  const statusMap = {
    NOT_STARTED: { label: "Not Started", cls: "not-started" },
    SAVED:       { label: "Draft",       cls: "draft"       },
    SUBMITTED:   { label: "Pending",     cls: "pending"     },
    APPROVED:    { label: "Approved",    cls: "approved"    },
    REJECTED:    { label: "Rejected",    cls: "rejected"    },
  };
  tbody.innerHTML = tags.map((t, i) => {
    const st = statusMap[t.resolution_status] || statusMap.NOT_STARTED;
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${t.tag_no}</strong></td>
        <td>${t.description || "—"}</td>
        <td>${t.tag_date ? t.tag_date.split("T")[0] : "—"}</td>
        <td><span class="tag-status-badge tag-status-badge--${st.cls}">${st.label}</span></td>
      </tr>`;
  }).join("");
}

document.getElementById("npBackBtn").addEventListener("click", () => {
  document.getElementById("npDashDetail").style.display = "none";
  document.getElementById("npDashList").style.display   = "";
});

document.getElementById("npTagSearch").addEventListener("input", function () {
  const term = this.value.trim().toLowerCase();
  if (!term) { renderNpTagsTable(npDetailTags); return; }
  renderNpTagsTable(npDetailTags.filter(t =>
    (t.tag_no      || "").toLowerCase().includes(term) ||
    (t.description || "").toLowerCase().includes(term)
  ));
});
