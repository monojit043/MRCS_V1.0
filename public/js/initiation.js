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
  '#assign':    'panelDashboard',   // "Assign Leads" retired — PEM no longer assigns department GL / LE
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
    applyFilters();
  } catch (err) {
    document.getElementById("initiationTableBody").innerHTML =
      `<tr><td colspan="9" class="empty-state">Failed to load reviews.</td></tr>`;
  }
}

// ===== EXCEL-STYLE PER-COLUMN HEADER FILTERS =====
const FILTER_COLUMNS = [
  { key: "job_no",           isDate: false },
  { key: "unit_no",          isDate: false },
  { key: "stage",            isDate: false },
  { key: "review_date_from", isDate: true  },
  { key: "review_date_to",   isDate: true  },
  { key: "description",      isDate: false },
  { key: "created_by",       isDate: false },
  { key: "created_at",       isDate: true  },
];

let columnFilters = {}; // colKey -> Set of allowed display values; absent key = no filter on that column
let openFilterPopup = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function colDisplayValue(row, colKey) {
  const def = FILTER_COLUMNS.find(c => c.key === colKey);
  let v = row[colKey];
  if (def && def.isDate) v = v ? v.split("T")[0] : "";
  return (v === null || v === undefined || v === "") ? "(Blank)" : String(v);
}

function matchesSearchTerm(row, term) {
  if (!term) return true;
  return (
    (row.job_no || "").toLowerCase().includes(term) ||
    (row.unit_no || "").toLowerCase().includes(term) ||
    (row.stage || "").toLowerCase().includes(term) ||
    (row.description || "").toLowerCase().includes(term) ||
    (row.created_by || "").toLowerCase().includes(term)
  );
}

// Rows passing the search box + every active column filter except `excludeCol`
// (excludeCol lets a column's own popup show values reachable via the OTHER filters)
function rowsPassing(excludeCol) {
  const term = document.getElementById("reviewSearchInput").value.trim().toLowerCase();
  return allInitiations.filter(r => {
    if (!matchesSearchTerm(r, term)) return false;
    for (const colKey in columnFilters) {
      if (colKey === excludeCol) continue;
      if (!columnFilters[colKey].has(colDisplayValue(r, colKey))) return false;
    }
    return true;
  });
}

function applyFilters() {
  renderTable(rowsPassing(null));
  updateFilterButtonStates();
  updateClearFiltersVisibility();
}

function updateFilterButtonStates() {
  document.querySelectorAll(".col-filter-btn").forEach(btn => {
    btn.classList.toggle("active", !!columnFilters[btn.dataset.col]);
  });
}

function updateClearFiltersVisibility() {
  const hasSearch = document.getElementById("reviewSearchInput").value.trim().length > 0;
  const hasColFilter = Object.keys(columnFilters).length > 0;
  document.getElementById("clearFiltersBtn").style.display = (hasSearch || hasColFilter) ? "" : "none";
}

function closeFilterPopup() {
  if (openFilterPopup) {
    openFilterPopup.remove();
    openFilterPopup = null;
  }
}

document.addEventListener("click", (e) => {
  if (!openFilterPopup) return;
  if (e.target.closest(".col-filter-popup") || e.target.closest(".col-filter-btn")) return;
  closeFilterPopup();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openFilterPopup) closeFilterPopup();
});

document.getElementById("reviewSearchInput").addEventListener("input", applyFilters);

document.getElementById("clearFiltersBtn").addEventListener("click", () => {
  document.getElementById("reviewSearchInput").value = "";
  columnFilters = {};
  closeFilterPopup();
  applyFilters();
});

document.querySelectorAll(".col-filter-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const col = btn.dataset.col;
    if (openFilterPopup && openFilterPopup.dataset.col === col) {
      closeFilterPopup();
      return;
    }
    openColumnFilter(btn, col);
  });
});

function openColumnFilter(btn, col) {
  closeFilterPopup();

  const uniqueValues = [...new Set(rowsPassing(col).map(r => colDisplayValue(r, col)))].sort();
  // Clone so in-popup toggles don't mutate the committed filter until OK/Enter
  let selected = new Set(columnFilters[col] ? [...columnFilters[col]] : uniqueValues);

  const popup = document.createElement("div");
  popup.className = "col-filter-popup";
  popup.dataset.col = col;
  popup.innerHTML = `
    <input type="text" class="col-filter-search" placeholder="Search…" />
    <label class="col-filter-selectall">
      <input type="checkbox" class="col-filter-selectall-cb" />
      Select All
    </label>
    <div class="col-filter-list"></div>
    <div class="col-filter-actions">
      <button type="button" class="col-filter-clear">Clear</button>
      <button type="button" class="col-filter-ok">OK</button>
    </div>
  `;
  document.body.appendChild(popup);
  openFilterPopup = popup;

  const rect = btn.getBoundingClientRect();
  const popupWidth = 230;
  let left = Math.min(rect.left, window.innerWidth - popupWidth - 8);
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${Math.max(8, left)}px`;

  const listEl = popup.querySelector(".col-filter-list");
  const searchEl = popup.querySelector(".col-filter-search");
  const selectAllEl = popup.querySelector(".col-filter-selectall-cb");

  function visibleValues() {
    const term = searchEl.value.trim().toLowerCase();
    return uniqueValues.filter(v => v.toLowerCase().includes(term));
  }

  function syncSelectAll(visible) {
    if (!visible.length) { selectAllEl.checked = false; selectAllEl.indeterminate = false; return; }
    const checkedCount = visible.filter(v => selected.has(v)).length;
    selectAllEl.checked = checkedCount === visible.length;
    selectAllEl.indeterminate = checkedCount > 0 && checkedCount < visible.length;
  }

  function renderList() {
    const visible = visibleValues();
    listEl.innerHTML = visible.length
      ? visible.map(v => `
          <label class="col-filter-item" title="${escapeHtml(v)}">
            <input type="checkbox" class="col-filter-item-cb" value="${escapeHtml(v)}" ${selected.has(v) ? "checked" : ""} />
            <span>${escapeHtml(v)}</span>
          </label>
        `).join("")
      : `<div class="col-filter-empty">No matches</div>`;
    syncSelectAll(visible);
  }

  // Values that will actually apply if committed right now: whatever's checked,
  // narrowed further by any still-typed search text (so typing + OK, not just
  // typing + Enter, filters to what's on screen).
  function valuesToCommit() {
    const term = searchEl.value.trim().toLowerCase();
    const checked = [...selected];
    return term ? checked.filter(v => v.toLowerCase().includes(term)) : checked;
  }

  function commitAndClose() {
    const finalValues = valuesToCommit();
    if (finalValues.length === uniqueValues.length) {
      delete columnFilters[col];
    } else {
      columnFilters[col] = new Set(finalValues);
    }
    closeFilterPopup();
    applyFilters();
  }

  renderList();
  searchEl.focus();

  searchEl.addEventListener("input", renderList);

  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAndClose();
    }
  });

  listEl.addEventListener("change", (e) => {
    if (!e.target.classList.contains("col-filter-item-cb")) return;
    if (e.target.checked) selected.add(e.target.value);
    else selected.delete(e.target.value);
    syncSelectAll(visibleValues());
  });

  selectAllEl.addEventListener("change", () => {
    const visible = visibleValues();
    visible.forEach(v => selectAllEl.checked ? selected.add(v) : selected.delete(v));
    renderList();
  });

  popup.querySelector(".col-filter-clear").addEventListener("click", () => {
    delete columnFilters[col];
    closeFilterPopup();
    applyFilters();
  });

  popup.querySelector(".col-filter-ok").addEventListener("click", commitAndClose);
}

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
      <td>${r.unit_no}<div class="unit-group-info" data-job="${escapeHtml(r.job_no)}" data-unit="${escapeHtml(r.unit_no)}"
            style="font-size:11px;opacity:.75;line-height:1.35;"></div></td>
      <td><span class="stage-badge">${r.stage}</span></td>
      <td>${r.review_date_from ? r.review_date_from.split("T")[0] : "—"}</td>
      <td>${r.review_date_to ? r.review_date_to.split("T")[0] : "—"}</td>
      <td>${r.description || "—"}</td>
      <td>${r.created_by || "—"}</td>
      <td>${r.created_at ? r.created_at.split("T")[0] : "—"}</td>
    </tr>`).join("");
  annotateUnitGroups();
}

// Under each review's unit: the child units its master covers (live from PIMS),
// or a warning if PIMS no longer treats that unit as a master.
const unitGroupCache = {};
async function annotateUnitGroups() {
  for (const el of document.querySelectorAll(".unit-group-info")) {
    const key = `${el.dataset.job}|${el.dataset.unit}`;
    try {
      unitGroupCache[key] ||= await apiFetch(
        `/api/pims/unit-group?jobNo=${encodeURIComponent(el.dataset.job)}&unitNo=${encodeURIComponent(el.dataset.unit)}`);
      const g = unitGroupCache[key];
      if (!g.found) {
        el.innerHTML = `<span style="color:#b45309;">⚠ not an active unit in PIMS</span>`;
      } else if (!g.isMaster) {
        el.innerHTML = `<span style="color:#b45309;">⚠ no longer a master unit in PIMS (now under ${escapeHtml(g.masterUnit)})</span>`;
      } else if (g.children.length) {
        el.textContent = `+ ${g.children.map(c => c.unit_no).join(", ")}`;
      }
    } catch { /* PIMS unreachable — leave blank */ }
  }
}

// ===== POPULATE ASSIGN PICKER (module-level so submitInitBtn can call it) =====
let assignReviewList = [];

async function populateAssignPicker() {
  const picker = document.getElementById("assignReviewPicker");
  const searchInput = document.getElementById("assignReviewSearchInput");
  if (!picker) return;
  try {
    const data = await apiFetch("/api/initiation");
    assignReviewList = data.initiations || [];

    picker.innerHTML = '<option value="">— Select Review —</option>';
    assignReviewList.forEach(r => {
      const opt = document.createElement("option");
      opt.value = `${r.job_no}|${r.unit_no}|${r.stage}`;
      opt.textContent = `${r.job_no}  /  ${r.unit_no}  /  ${r.stage}`;
      picker.appendChild(opt);
    });

    if (searchInput) searchInput.value = "";
  } catch (err) {
    console.error("Failed to load assign picker", err);
  }
}

// ===== SEARCHABLE COMBOBOX BEHAVIOR FOR ASSIGN REVIEW PICKER =====
function closeAssignDropdown() {
  const dropdown = document.getElementById("assignReviewDropdown");
  if (dropdown) dropdown.style.display = "none";
  document.getElementById("assignReviewCombo")?.classList.remove("combo-wrap--open");
}

function renderAssignReviewDropdown(filterText) {
  const dropdown = document.getElementById("assignReviewDropdown");
  if (!dropdown) return;
  const term = (filterText || "").trim().toLowerCase();
  const matches = assignReviewList.filter(r =>
    !term || `${r.job_no} ${r.unit_no} ${r.stage}`.toLowerCase().includes(term)
  );

  dropdown.innerHTML = matches.length
    ? matches.map(r => `
        <div class="combo-item" data-value="${r.job_no}|${r.unit_no}|${r.stage}">
          ${r.job_no} / ${r.unit_no} / ${r.stage}
        </div>
      `).join("")
    : `<div class="combo-empty">No matching reviews</div>`;

  dropdown.style.display = "block";
  document.getElementById("assignReviewCombo")?.classList.add("combo-wrap--open");
}

function selectAssignReview(value, label) {
  const picker = document.getElementById("assignReviewPicker");
  const searchInput = document.getElementById("assignReviewSearchInput");
  picker.value = value;
  searchInput.value = label || "";
  closeAssignDropdown();
  picker.dispatchEvent(new Event("change"));
}

document.getElementById("assignReviewSearchInput")?.addEventListener("input", function () {
  renderAssignReviewDropdown(this.value);
});

function openAssignReviewDropdown() {
  const input = document.getElementById("assignReviewSearchInput");
  // Show the full list on open, regardless of a previously-selected label
  // sitting in the box (e.g. "A100 / 100 / 90%") — that text isn't a valid
  // search term for the "job unit stage" match string, so filtering by it
  // here produced a false "no matching reviews".
  renderAssignReviewDropdown("");
  input.select(); // select existing text so typing immediately replaces it
}

// "focus" alone misses the case where the field is already focused (e.g. right
// after picking an item, which deliberately keeps focus) — a same-element click
// doesn't fire a new focus event, so re-clicking to reopen did nothing until the
// page was reloaded and focus reset. Binding "click" too covers that case.
document.getElementById("assignReviewSearchInput")?.addEventListener("focus", openAssignReviewDropdown);
document.getElementById("assignReviewSearchInput")?.addEventListener("click", openAssignReviewDropdown);

document.getElementById("assignReviewSearchInput")?.addEventListener("keydown", function (e) {
  const dropdown = document.getElementById("assignReviewDropdown");
  if (e.key === "Enter") {
    e.preventDefault();
    const first = dropdown?.querySelector(".combo-item");
    if (first) selectAssignReview(first.dataset.value, first.textContent.trim());
  } else if (e.key === "Escape") {
    closeAssignDropdown();
    this.blur();
  }
});

// Revert the search box to the confirmed selection (or blank) if the user
// clicks/tabs away without picking an item from the dropdown.
document.getElementById("assignReviewSearchInput")?.addEventListener("blur", function () {
  const input = this;
  setTimeout(() => {
    closeAssignDropdown();
    const picker = document.getElementById("assignReviewPicker");
    const [jobNo, unitNo, stage] = (picker.value || "").split("|");
    const match = assignReviewList.find(r => r.job_no === jobNo && r.unit_no === unitNo && r.stage === stage);
    input.value = match ? `${match.job_no} / ${match.unit_no} / ${match.stage}` : "";
  }, 150);
});

document.getElementById("assignReviewDropdown")?.addEventListener("mousedown", function (e) {
  const item = e.target.closest(".combo-item");
  if (!item) return;
  e.preventDefault(); // keep focus/blur timing predictable
  selectAssignReview(item.dataset.value, item.textContent.trim());
});

// ===== JOB / MASTER UNIT / STAGE PICKERS — live from PIMS on PC-2 =====
// Only PIMS jobs; reviews are created on MASTER units only (a master covers its
// child units). The server re-checks all three on submit.
let initMasterUnits = [];

async function loadInitJobs() {
  const jobSel = document.getElementById("initJobNo");
  if (!jobSel) return;
  try {
    const { jobs } = await apiFetch("/api/pims/jobs");
    jobSel.innerHTML = `<option value="">— Select Job —</option>` +
      jobs.map(j => `<option value="${escapeHtml(j.job_no)}">${escapeHtml(j.job_no)} — ${escapeHtml(j.job_name)}</option>`).join("");
  } catch (err) {
    jobSel.innerHTML = `<option value="">— Could not load jobs from PIMS —</option>`;
  }
}

async function loadInitMasterUnits(jobNo) {
  const unitSel = document.getElementById("initUnitNo");
  document.getElementById("initUnitGroup").textContent = "";
  initMasterUnits = [];
  if (!jobNo) {
    unitSel.innerHTML = `<option value="">— Select Job first —</option>`;
    unitSel.disabled = true;
    return;
  }
  unitSel.innerHTML = `<option value="">— Loading units… —</option>`;
  try {
    const { units } = await apiFetch(`/api/pims/master-units?jobNo=${encodeURIComponent(jobNo)}`);
    initMasterUnits = units;
    unitSel.innerHTML = units.length
      ? `<option value="">— Select Master Unit —</option>` + units.map(u => {
          const name = u.unit_name ? ` — ${escapeHtml(u.unit_name)}` : "";
          const group = u.children.length ? ` (+${u.children.length} unit${u.children.length > 1 ? "s" : ""})` : "";
          return `<option value="${escapeHtml(u.unit_no)}">${escapeHtml(u.unit_no)}${name}${group}</option>`;
        }).join("")
      : `<option value="">— No active units in PIMS for this job —</option>`;
    unitSel.disabled = !units.length;
  } catch (err) {
    unitSel.innerHTML = `<option value="">— Could not load units from PIMS —</option>`;
  }
}

function showInitUnitGroup(unitNo) {
  const el = document.getElementById("initUnitGroup");
  const m = initMasterUnits.find(u => u.unit_no === unitNo);
  el.textContent = !m ? ""
    : m.children.length ? `Covers ${m.unit_no} + ${m.children.map(c => c.unit_no).join(", ")}`
    : "Standalone unit";
}

async function loadInitStages() {
  const stageSel = document.getElementById("initStage");
  if (!stageSel) return;
  try {
    const { stages } = await apiFetch("/api/pims/stages");
    if (stages.length) {
      stageSel.innerHTML = `<option value="">— Select Stage —</option>` +
        stages.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    }
  } catch { /* keep the built-in 30% / 60% / 90% options */ }
}

if (isPEM) {
  document.getElementById("initJobNo")?.addEventListener("change", e => loadInitMasterUnits(e.target.value));
  document.getElementById("initUnitNo")?.addEventListener("change", e => showInitUnitGroup(e.target.value));
  loadInitJobs();
  loadInitStages();
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
    alert("Please select Job No, Master Unit and Stage.");
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
    loadInitMasterUnits("");
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

    // Keep each department's original casing from master_employees — the DB's
    // department_check constraint requires "PEM" uppercase while every other
    // department is lowercase, so lowercasing here made PEM unassignable.
    const depts = [...new Set(
      allEmployees.map(e => (e.department || "").trim()).filter(Boolean)
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
      .filter(e => (e.department || "").toLowerCase() === dept.toLowerCase())
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
    loadAssignSuggestions();
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

  // ===== CARRY-FORWARD SUGGESTIONS (from the most recently initiated other stage) =====
  async function loadAssignSuggestions() {
    const wrap = document.getElementById("assignSuggestWrap");
    if (!assignJobNo) { wrap.style.display = "none"; return; }
    try {
      const data = await apiFetch(
        `/api/initiation/assignments/suggestions?jobNo=${assignJobNo}&unitNo=${assignUnitNo}&stage=${encodeURIComponent(assignStage)}`
      );
      renderSuggestions(data.sourceStage, data.suggestions || []);
    } catch (err) {
      wrap.style.display = "none";
    }
  }

  function renderSuggestions(sourceStage, suggestions) {
    const wrap = document.getElementById("assignSuggestWrap");
    if (!sourceStage || !suggestions.length) {
      wrap.style.display = "none";
      return;
    }

    document.getElementById("suggestSourceStage").textContent = sourceStage;
    document.getElementById("suggestList").innerHTML = suggestions.map((s, i) => `
      <label class="suggest-item">
        <input type="checkbox" class="suggest-item-cb" data-index="${i}" checked />
        ${s.employeeName} (${s.employeeId}) — ${s.department.charAt(0).toUpperCase() + s.department.slice(1)}
        <span class="suggest-role-badge">${s.role}</span>
      </label>
    `).join("");
    wrap.dataset.suggestions = JSON.stringify(suggestions);
    wrap.style.display = "block";
  }

  document.getElementById("suggestCopyBtn").addEventListener("click", async () => {
    const wrap = document.getElementById("assignSuggestWrap");
    const suggestions = JSON.parse(wrap.dataset.suggestions || "[]");
    const checked = [...document.querySelectorAll(".suggest-item-cb:checked")]
      .map(cb => suggestions[Number(cb.dataset.index)]);

    if (!checked.length) {
      alert("Select at least one lead to copy.");
      return;
    }

    try {
      const res = await apiFetch("/api/initiation/assignments/copy-forward", {
        method: "POST",
        body: JSON.stringify({
          jobNo: assignJobNo, unitNo: assignUnitNo, stage: assignStage,
          assignments: checked
        })
      });
      alert(res.message || "Assignments copied.");
      loadAssignments();
      loadAssignSuggestions();
    } catch (err) {
      alert("Failed: " + err.message);
    }
  });

  document.getElementById("suggestDismissBtn").addEventListener("click", () => {
    document.getElementById("assignSuggestWrap").style.display = "none";
  });

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
      loadAssignSuggestions();
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
      loadAssignSuggestions();
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
