let currentTags = [];
const uploadInput = document.getElementById("uploadInput");
const dropzone = document.getElementById("dropzone");
const excelUploadInput = document.getElementById("excelUploadInput");
const excelDropzone = document.getElementById("excelDropzone");

// Single source of truth for tag-department checkboxes (upload table,
// finalization table, and the reassign-departments modal all use this).
const ALL_DEPARTMENTS = [
  "piping", "instrumentation", "process", "smed",
  "electrical", "general civil", "structural", "architecture", "PEM",
  "licensor", "client"
];

if (!localStorage.getItem("token")) {
  window.location.href = "login.html";
}

function getReview() {
  return {
    jobNo: document.getElementById("ufJobNo").value,
    unitNo: document.getElementById("ufUnitNo").value,
    stage: document.getElementById("ufStage").value,
  };
}

// Only trigger when clicking the dropzone itself
dropzone.addEventListener("click", (e) => {
  if (e.target.tagName !== "LABEL") {
    uploadInput.click();
  }
});

uploadInput.addEventListener("change", async () => {

  const files = uploadInput.files;
  if (!files.length) return;

  const { jobNo, unitNo, stage } = getReview();

  if (!jobNo || !unitNo || !stage) {
    alert("Please select a Model Review first.");
    return;
  }

  const overlay = document.getElementById("uploadOverlay");

  try {
    overlay.style.display = "flex";

    const formData = new FormData();

    let originalFolderName = null;

    for (let file of files) {
      formData.append("files", file);

      if (!originalFolderName) {
        originalFolderName = file.webkitRelativePath.split("/")[0];
      }
    }

    formData.append("originalFolderName", originalFolderName);
    formData.append("jobNo", jobNo);
    formData.append("unitNo", unitNo);
    formData.append("stage", stage);
    formData.append("uploadedBy", localStorage.getItem("fullName") || "Unknown");

    const result = await apiFetch("/api/upload-folder", {
      method: "POST",
      body: formData,
    });

    alert("Folder uploaded successfully!");

    loadTags();
    loadFolders();

  } catch (err) {
    console.error(err);
    alert(err.message || "Upload failed. Please try again.");
  } finally {
    overlay.style.display = "none";
    uploadInput.value = "";
  }
});

excelDropzone.addEventListener("click", () => {
  excelUploadInput.click();
});

excelUploadInput.addEventListener("change", async () => {

  const file = excelUploadInput.files[0];
  if (!file) return;

  const { jobNo, unitNo, stage } = getReview();

  if (!jobNo || !unitNo || !stage) {
    alert("Please select a Model Review first.");
    return;
  }

  const overlay = document.getElementById("uploadOverlay");

  try {
    overlay.style.display = "flex";

    const formData = new FormData();
    formData.append("excelFile", file);
    formData.append("jobNo", jobNo);
    formData.append("unitNo", unitNo);
    formData.append("stage", stage);

    const result = await apiFetch("/api/upload-excel", {
      method: "POST",
      body: formData,
    });

    alert(`Excel uploaded successfully! ${result.tagCount} tag(s) added.`);

    loadTags();
    loadFolders();

  } catch (err) {
    console.error(err);
    alert(err.message || "Excel upload failed. Please try again.");
  } finally {
    overlay.style.display = "none";
    excelUploadInput.value = "";
  }
});

async function loadTags() {
  const { jobNo, unitNo, stage } = getReview();

  if (!jobNo || !unitNo || !stage) return;

  try {
    const data = await apiFetch(
      `/api/tags?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
    );
    populateTagTable(data.tags || []);
    loadFolders();
  } catch (err) {
    console.error("Failed to load tags:", err);
  }
}

function populateTagTable(tags) {
  currentTags = tags;
  renderTagTable(tags);
}

function renderTagTable(tags) {
  const tbody = document.querySelector(".tag-table tbody");
  tbody.innerHTML = "";

  tags.forEach((tag, index) => {
    const row = document.createElement("tr");
    row.dataset.tagId = tag.id;
    row.dataset.tagNo = tag.tag_no;

    const locked = tag.status === "LOCKED";

    row.innerHTML = `
    <td>${index + 1}</td>
    <td>${tag.view_name || ""}</td>
    <td>${tag.tag_no}</td>
    <td>${tag.description}</td>
    <td>${tag.tag_date || ""}</td>
    <td>${tag.nwd_file_name || ""}</td>
    <td>${tag.folder_name || ""}</td>
    <td>${tag.original_snap_path
      ? `<button class="snap-view-btn" data-snap="${tag.original_snap_path}" data-tagno="${tag.tag_no}" title="View original snap">&#128247; View</button>`
      : '<span class="snap-na">—</span>'}</td>
    <td>
      <div class="dept-checkbox-group ${locked ? "disabled" : ""}">
        ${ALL_DEPARTMENTS
        .map(dep => `
            <label>
              <input type="checkbox" value="${dep}" ${locked ? "disabled" : ""}>
              ${dep.charAt(0).toUpperCase() + dep.slice(1)}
            </label>
          `).join("")}
      </div>
    </td>
    `;

    const checkboxes = row.querySelectorAll(".dept-checkbox-group input");

    if (tag.department) {
      const deptArray = tag.department
        .split(",")
        .map(d => d.trim().toLowerCase());

      checkboxes.forEach(cb => {
        if (deptArray.includes(cb.value)) {
          cb.checked = true;
        }
      });
    }

    if (locked) row.classList.add("locked-row");

    tbody.appendChild(row);
  });
}

document.getElementById("uploadSaveBtn").addEventListener("click", async () => {
  const rows = document.querySelectorAll("#panelUpload .tag-table tbody tr");

  const updates = [];

  rows.forEach((row) => {

    const checkboxes = row.querySelectorAll(".dept-checkbox-group input");

    if (!checkboxes.length || checkboxes[0].disabled) return;

    const selectedDepartments = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    if (selectedDepartments.length > 0) {
      updates.push({
        tagId: row.dataset.tagId,
        departments: selectedDepartments
      });
    }

  });

  if (updates.length === 0) {
    alert("No departments selected to save.");
    return;
  }

  try {
    const result = await apiFetch("/api/tags/lock", {
      method: "POST",
      body: JSON.stringify({
        updates,
        lockedBy: localStorage.getItem("fullName") || "Unknown",
      }),
    });
    alert(result.message || "Tags locked successfully.");
    loadTags();
    loadFinTags();
  } catch (err) {
    alert("Failed to lock tags: " + err.message);
  }
});

async function loadFolders() {
  const { jobNo, unitNo, stage } = getReview();

  if (!jobNo || !unitNo || !stage) return;

  try {
    const data = await apiFetch(
      `/api/folders?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
    );
    populateFolderTable(data.folders || []);
  } catch (err) {
    console.error("Failed to load folders:", err);
  }
}

function populateFolderTable(folders) {
  const tbody = document.querySelector(".uploaded-table tbody");
  tbody.innerHTML = "";

  folders.forEach((folder, index) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${folder.folder_name}</td>
      <td>${folder.tag_count}</td>
      <td>${folder.uploaded_by || ""}</td>
      <td>
      <button class="delete-folder-btn" data-id="${folder.id}">
        Delete
      </button>
    </td>
    `;

    tbody.appendChild(row);
  });
}

document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-folder-btn")) return;

  const folderId = e.target.dataset.id;

  const confirmDelete = confirm("Are you sure you want to delete this folder and all its tags?");

  if (!confirmDelete) return;

  try {
    const result = await apiFetch(`/api/folders/${folderId}`, { method: "DELETE" });
    alert(result.message || "Folder deleted.");
    loadTags();
    loadFolders();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
});

document.getElementById("tagSearchInput").addEventListener("input", (e) => {
  const searchTerm = e.target.value.toLowerCase();

  const filtered = currentTags.filter(tag =>
    (tag.tag_no && tag.tag_no.toLowerCase().includes(searchTerm)) ||
    (tag.description && tag.description.toLowerCase().includes(searchTerm)) ||
    (tag.view_name && tag.view_name.toLowerCase().includes(searchTerm)) ||
    (tag.department && tag.department.toLowerCase().includes(searchTerm))
  );

  renderTagTable(filtered);
});

// ===== GL REASSIGN — Right-click context menu =====

const contextMenu = document.getElementById("tagContextMenu");
const reassignModal = document.getElementById("reassignModal");
const reassignDeptGrid = document.getElementById("reassignDeptGrid");

let ctxTagId = null;
let ctxTagNo = "";
let ctxCurrentDepts = [];
let ctxSourcePanel = "upload";

ALL_DEPARTMENTS.forEach(dept => {
  const label = document.createElement("label");
  label.className = "reassign-dept-label";
  label.innerHTML = `<input type="checkbox" value="${dept}"> ${dept.charAt(0).toUpperCase() + dept.slice(1)}`;
  reassignDeptGrid.appendChild(label);
});

function openContextMenu(e) {
  const row = e.target.closest("tr");
  if (!row || !row.classList.contains("locked-row")) return;

  e.preventDefault();

  ctxTagId = row.dataset.tagId;
  ctxTagNo = row.dataset.tagNo || "";

  const deptCell = row.querySelector(".dept-checkbox-group");
  ctxCurrentDepts = deptCell
    ? Array.from(deptCell.querySelectorAll("input[type=checkbox]"))
        .filter(cb => cb.checked)
        .map(cb => cb.value)
    : [];

  contextMenu.style.left = e.clientX + "px";
  contextMenu.style.top = e.clientY + "px";
  contextMenu.style.display = "block";
}

document.querySelector("#panelUpload .tag-table tbody").addEventListener("contextmenu", (e) => {
  if (localStorage.getItem("role") !== "GL") return;
  ctxSourcePanel = "upload";
  openContextMenu(e);
});

document.getElementById("finTagBody").addEventListener("contextmenu", (e) => {
  const role = localStorage.getItem("role");
  const dept = (localStorage.getItem("dept") || "").toLowerCase();
  if (role !== "GL" && dept !== "pem") return;
  ctxSourcePanel = "fin";
  openContextMenu(e);
});

document.addEventListener("click", () => {
  contextMenu.style.display = "none";
});

document.getElementById("contextReassignBtn").addEventListener("click", () => {
  document.getElementById("reassignTagLabel").textContent = ctxTagNo;

  reassignDeptGrid.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.checked = ctxCurrentDepts.includes(cb.value);
  });

  reassignModal.style.display = "flex";
});

document.getElementById("cancelReassignBtn").addEventListener("click", () => {
  reassignModal.style.display = "none";
});

document.getElementById("confirmReassignBtn").addEventListener("click", async () => {
  const selected = Array.from(reassignDeptGrid.querySelectorAll("input[type=checkbox]"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  if (selected.length === 0) {
    alert("Select at least one department.");
    return;
  }

  try {
    await apiFetch(`/api/tags/${ctxTagId}/reassign`, {
      method: "POST",
      body: JSON.stringify({ departments: selected })
    });

    reassignModal.style.display = "none";
    alert("Tag reassigned successfully.");
    loadTags();
    loadFinTags();
  } catch (err) {
    alert("Reassign failed: " + err.message);
  }
});

// ================================================================
// HASH-BASED PANEL SWITCHING (Upload ↔ Tag Finalization)
// ================================================================

const UF_PANELS = ["panelUpload", "panelFinalization", "panelExport"];

function getUfPanelFromHash() {
  const h = window.location.hash;
  if (h === "#finalization") return "panelFinalization";
  if (h === "#export")       return "panelExport";
  return "panelUpload";
}

function showUfPanel(panelId) {
  UF_PANELS.forEach(id => {
    document.getElementById(id).style.display = (id === panelId) ? "" : "none";
  });
}

showUfPanel(getUfPanelFromHash());

window.addEventListener("hashchange", () => {
  showUfPanel(getUfPanelFromHash());
});

// ================================================================
// TAG FINALIZATION — allocation table + department summary
// ================================================================

let finCurrentTags = [];

function getFinReview() {
  return {
    jobNo: document.getElementById("finJobNo").value,
    unitNo: document.getElementById("finUnitNo").value,
    stage: document.getElementById("finStage").value,
  };
}

async function loadFinTags() {
  const { jobNo, unitNo, stage } = getFinReview();
  if (!jobNo || !unitNo || !stage) return;

  try {
    const data = await apiFetch(
      `/api/tags?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
    );
    const tags = data.tags || [];
    finCurrentTags = tags;
    renderFinTagTable(tags);
    renderFinSummary(tags);
    document.getElementById("finTagDetailsCard").style.display = "";
    document.getElementById("finTagCard").style.display = "";
  } catch (err) {
    console.error("Failed to load finalization tags:", err);
  }
}

function renderFinTagTable(tags) {
  const tbody = document.getElementById("finTagBody");
  tbody.innerHTML = "";

  tags.forEach((tag, index) => {
    const row = document.createElement("tr");
    row.dataset.tagId = tag.id;
    row.dataset.tagNo = tag.tag_no;

    const isLocked = tag.status === "LOCKED";

    row.innerHTML = `
    <td>${index + 1}</td>
    <td>${tag.tag_no}</td>
    <td>${tag.description}</td>
    <td>${tag.tag_date || ""}</td>
    <td>${tag.view_name || ""}</td>
    <td>${tag.original_snap_path
      ? `<button class="snap-view-btn" data-snap="${tag.original_snap_path}" data-tagno="${tag.tag_no}" title="View original snap">&#128247; View</button>`
      : '<span class="snap-na">—</span>'}</td>
    <td><span class="fin-status fin-status--${isLocked ? "locked" : "open"}">${isLocked ? "LOCKED" : "OPEN"}</span></td>
    <td>
      <div class="dept-checkbox-group ${isLocked ? "disabled" : ""}">
        ${ALL_DEPARTMENTS
          .map(dep => `
            <label>
              <input type="checkbox" value="${dep}" ${isLocked ? "disabled" : ""}>
              ${dep.charAt(0).toUpperCase() + dep.slice(1)}
            </label>
          `).join("")}
      </div>
    </td>
    `;

    if (tag.department) {
      const deptArray = tag.department.split(",").map(d => d.trim().toLowerCase());
      row.querySelectorAll(".dept-checkbox-group input").forEach(cb => {
        if (deptArray.includes(cb.value)) cb.checked = true;
      });
    }

    if (isLocked) row.classList.add("locked-row");

    tbody.appendChild(row);
  });
}

document.getElementById("finSaveBtn").addEventListener("click", async () => {
  const rows = document.querySelectorAll("#finTagBody tr");
  const updates = [];

  rows.forEach(row => {
    const checkboxes = row.querySelectorAll(".dept-checkbox-group input");
    if (!checkboxes.length) return;

    const selectedDepts = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    if (selectedDepts.length > 0) {
      updates.push({ tagId: row.dataset.tagId, departments: selectedDepts });
    }
  });

  if (updates.length === 0) {
    alert("No departments selected to save.");
    return;
  }

  try {
    const result = await apiFetch("/api/tags/lock", {
      method: "POST",
      body: JSON.stringify({
        updates,
        lockedBy: localStorage.getItem("fullName") || "Unknown",
      }),
    });
    alert(result.message || "Allocations saved.");
    loadFinTags();
    loadTags();
  } catch (err) {
    alert("Failed to save allocations: " + err.message);
  }
});

document.getElementById("finTagSearchInput").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  const filtered = finCurrentTags.filter(tag =>
    (tag.tag_no && tag.tag_no.toLowerCase().includes(term)) ||
    (tag.description && tag.description.toLowerCase().includes(term)) ||
    (tag.view_name && tag.view_name.toLowerCase().includes(term)) ||
    (tag.department && tag.department.toLowerCase().includes(term))
  );
  renderFinTagTable(filtered);
});

// ================================================================
// SNAP IMAGE MODAL
// ================================================================

const snapModal = document.getElementById("snapModal");
const snapModalImg = document.getElementById("snapModalImg");
const snapModalTagNo = document.getElementById("snapModalTagNo");

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".snap-view-btn");
  if (!btn) return;
  snapModalTagNo.textContent = btn.dataset.tagno;
  snapModalImg.style.display = "block";
  document.getElementById("snapModalError").style.display = "none";
  snapModalImg.src = encodeURI("/" + btn.dataset.snap);
  snapModal.style.display = "flex";
});

snapModalImg.addEventListener("error", () => {
  snapModalImg.style.display = "none";
  document.getElementById("snapModalError").style.display = "block";
});

document.getElementById("snapModalClose").addEventListener("click", () => {
  snapModal.style.display = "none";
  snapModalImg.src = "";
});

snapModal.addEventListener("click", (e) => {
  if (e.target === snapModal) {
    snapModal.style.display = "none";
    snapModalImg.src = "";
  }
});

function renderFinSummary(tags) {
  const deptCount = {};

  tags.forEach(tag => {
    if (tag.department) {
      tag.department.split(",").map(d => d.trim()).filter(Boolean).forEach(dept => {
        const key = dept.charAt(0).toUpperCase() + dept.slice(1).toLowerCase();
        deptCount[key] = (deptCount[key] || 0) + 1;
      });
    }
  });

  const tbody = document.getElementById("finSummaryBody");
  tbody.innerHTML = "";

  const entries = Object.entries(deptCount).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:32px;opacity:.5;">No tags allocated yet for this review.</td></tr>`;
    return;
  }

  entries.forEach(([dept, count], i) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${i + 1}</td><td>${dept}</td><td>${count}</td>`;
    tbody.appendChild(row);
  });

  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const totalRow = document.createElement("tr");
  totalRow.className = "fin-total-row";
  totalRow.innerHTML = `<td colspan="2">Total Allocated Tags</td><td>${total}</td>`;
  tbody.appendChild(totalRow);
}
