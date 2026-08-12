let jeTags = [];
let jeAllTags = [];
let jeCurrentIndex = 0;
let isDirty = false;
let jeSearchMatches = [];
let jeSearchMatchIndex = 0;
let jeIsSearchActive = false;
let jeLastRenderedTagId = null;

// Redirect if not logged in
if (!localStorage.getItem("token")) {
    window.location.href = "login.html";
}


// Use real department from login
const currentDepartment = localStorage.getItem("department");

// Load button
document.getElementById("jeLoadBtn").addEventListener("click", loadJobEngineerTags);

function sortTagsByTagNo(tags) {

    return tags.sort((a, b) => {
        return (a.tag_no || "").localeCompare(
            (b.tag_no || ""),
            undefined,
            { numeric: true, sensitivity: "base" }
        );
    });

}

async function loadJobEngineerTags() {

    const jobNo = document.getElementById("jobNoInput").value.trim().toUpperCase();
    const unitNo = document.getElementById("unitNoInput").value.trim().toUpperCase();
    const stage = document.getElementById("stageSelect").value;

    if (!jobNo || !unitNo || !stage) {
        alert("Please fill Job No, Unit No and Stage");
        return;
    }

    const data = await apiFetch(
        `/api/job-engineer-tags?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}&department=${currentDepartment}`
    );

    jeAllTags = sortTagsByTagNo(data.tags || []);

    updateJESummary();

    // Reset both filters
    document.getElementById("zoneFilter").value = "ALL";
    document.getElementById("statusFilter").value = "ALL";
    document.getElementById("zoneFilter").dataset.filterActive = "false";

    jeTags = [...jeAllTags];
    jeCurrentIndex = 0;

    populateZoneFilter();

    if (jeTags.length === 0) {
        document.getElementById("jeStatusText").innerText = "No allocated tags found.";
        clearCard();
        return;
    }

    document.getElementById("jeStatusText").innerText =
        `Loaded ${jeTags.length} tags (Department: ${currentDepartment})`;

    renderCurrentTag();
    renderTagPointsTable();
}

function populateZoneFilter() {

    const zoneSelect = document.getElementById("zoneFilter");

    const zones = [...new Set(
        jeAllTags.map(t => t.zone || "Unassigned")
    )];

    zoneSelect.innerHTML = `<option value="ALL">All</option>`;

    zones.forEach(z => {
        zoneSelect.innerHTML += `<option value="${z}">${z}</option>`;
    });

    // Reset after repopulating
    zoneSelect.value = "ALL";
    zoneSelect.dataset.filterActive = "false";
}

// function renderCurrentTag() {
//     if (!jeTags.length) return;
//     const tag = jeTags[jeCurrentIndex];

//     if (!tag) {
//         clearCard();
//         return;
//     }

//     // document.getElementById("jeTagNo").value = tag.tag_no || "";
//     // Only update tag no field if search is not active
//     if (!jeIsSearchActive) {
//         document.getElementById("jeTagNo").value = tag.tag_no || "";
//     }
//     document.getElementById("jeViewName").value = tag.view_name || "";
//     document.getElementById("jeModelName").value = tag.model_file || "";

//     const zoneSelect = document.getElementById("zoneFilter");

//     // Fixed: don't override dropdown when ALL is selected
//     if (zoneSelect.value !== "ALL" && zoneSelect.dataset.filterActive !== "true") {
//         zoneSelect.value = tag.zone || "Unassigned";
//     }

//     if (tag.tag_date) {
//         const dateObj = new Date(tag.tag_date);
//         const formatted =
//             dateObj.getFullYear() + "-" +
//             String(dateObj.getMonth() + 1).padStart(2, "0") + "-" +
//             String(dateObj.getDate()).padStart(2, "0");

//         document.getElementById("jeReviewDate").value = formatted;
//     } else {
//         document.getElementById("jeReviewDate").value = "";
//     }

//     document.getElementById("jeDescription").value = tag.description || "";
//     document.getElementById("jeResolution").value = tag.resolution || "";

//     const isLocked =
//         tag.resolution_status === "SUBMITTED" ||
//         tag.resolution_status === "APPROVED";

//     const resolutionBox = document.getElementById("jeResolution");
//     const saveBtn = document.getElementById("jeSaveBtn");
//     const submitBtn = document.getElementById("jeSubmitBtn");
//     const uploadBtn = document.getElementById("jeUploadSnapBtn");
//     const fileInput = document.getElementById("jeResolvedSnap");

//     resolutionBox.disabled = isLocked;
//     saveBtn.disabled = isLocked;
//     submitBtn.disabled = isLocked;
//     fileInput.disabled = isLocked;
//     uploadBtn.disabled = isLocked;

//     if (tag.resolution_status === "SUBMITTED") {
//         submitBtn.innerText = "Submitted";
//     } else if (tag.resolution_status === "APPROVED") {
//         submitBtn.innerText = "Approved";
//     } else if (tag.resolution_status === "REJECTED") {
//         submitBtn.innerText = "Rejected";
//     } else {
//         submitBtn.innerText = "Submit";
//     }

//     const statusText = document.getElementById("jeResolutionStatus");
//     const status = tag.resolution_status;

//     if (!status || status === "NOT_STARTED") {
//         statusText.innerText = "NOT STARTED";
//         statusText.style.color = "#94a3b8";
//     }
//     else if (status === "SAVED") {
//         statusText.innerText = "SAVED (Draft)";
//         statusText.style.color = "#facc15";
//     }
//     else if (status === "SUBMITTED") {
//         statusText.innerText = "SUBMITTED";
//         statusText.style.color = "#60a5fa";
//     }
//     else if (status === "APPROVED") {
//         statusText.innerText = "APPROVED";
//         statusText.style.color = "#4ade80";
//     }
//     else if (status === "REJECTED") {
//         statusText.innerText = "REJECTED";
//         statusText.style.color = "#f87171";
//     }

//     // const preview = document.getElementById("jeSnapPreview");

//     // if (tag.resolved_snap_path) {
//     //     preview.innerHTML = `
//     //         <img src="/${tag.resolved_snap_path}" 
//     //              style="max-width:100%; max-height:100%; border-radius:8px;">
//     //     `;
//     // } else {
//     //     preview.innerText = "No image selected";
//     // }

//     const preview = document.getElementById("jeSnapPreview");

//     // fileInput is already declared above in this function, just use it directly
//     fileInput.value = "";
//     preview.innerHTML = "";

//     if (tag.resolved_snap_path) {
//         preview.innerHTML = `
//         <img src="/${tag.resolved_snap_path}" 
//              style="max-width:100%; max-height:100%; border-radius:8px;">
//     `;
//     } else {
//         preview.innerText = "No image selected";
//     }

//     document.getElementById("jePositionInfo").innerText =
//         `Tag ${jeCurrentIndex + 1} of ${jeTags.length}`;

//     document.getElementById("jePrevBtn").disabled = jeCurrentIndex === 0;
//     document.getElementById("jeNextBtn").disabled = jeCurrentIndex === jeTags.length - 1;

//     const originalSnapDiv = document.getElementById("jeOriginalSnap");

//     if (tag.original_snap_path) {
//         originalSnapDiv.innerHTML = `
//             <img src="/${tag.original_snap_path}" 
//                  style="border-radius:8px;">
//         `;
//     } else {
//         originalSnapDiv.innerText = "No original snap";
//     }

//     isDirty = false;
// }

function renderCurrentTag() {
    if (!jeTags.length) return;
    const tag = jeTags[jeCurrentIndex];

    if (!tag) {
        clearCard();
        return;
    }

    const jeIsRenderingSameTag = (jeLastRenderedTagId === tag.id);
    jeLastRenderedTagId = tag.id;

    if (!jeIsSearchActive) {
        document.getElementById("jeTagNo").value = tag.tag_no || "";
    }

    document.getElementById("jeViewName").value = tag.view_name || "";
    document.getElementById("jeModelName").value = tag.model_file || "";

    const zoneSelect = document.getElementById("zoneFilter");

    if (zoneSelect.value !== "ALL" && zoneSelect.dataset.filterActive !== "true") {
        zoneSelect.value = tag.zone || "Unassigned";
    }

    if (tag.tag_date) {
        const dateObj = new Date(tag.tag_date);
        const formatted =
            dateObj.getFullYear() + "-" +
            String(dateObj.getMonth() + 1).padStart(2, "0") + "-" +
            String(dateObj.getDate()).padStart(2, "0");
        document.getElementById("jeReviewDate").value = formatted;
    } else {
        document.getElementById("jeReviewDate").value = "";
    }

    document.getElementById("jeDescription").value = tag.description || "";
    document.getElementById("jeResolution").value = tag.resolution || "";

    const isLocked =
        tag.resolution_status === "SUBMITTED" ||
        tag.resolution_status === "APPROVED";

    const resolutionBox = document.getElementById("jeResolution");
    const saveBtn = document.getElementById("jeSaveBtn");
    const submitBtn = document.getElementById("jeSubmitBtn");
    const uploadBtn = document.getElementById("jeUploadSnapBtn");
    const fileInput = document.getElementById("jeResolvedSnap");
    const deleteBtn = document.getElementById("jeDeleteSnapBtn");

    resolutionBox.disabled = isLocked;
    saveBtn.disabled = isLocked;
    submitBtn.disabled = isLocked;
    fileInput.disabled = isLocked;
    uploadBtn.disabled = isLocked;

    const hasUnsavedImage = fileInput.files && fileInput.files.length > 0;

    deleteBtn.disabled = isLocked || (!tag.resolved_snap_path && !hasUnsavedImage);

    if (tag.resolution_status === "SUBMITTED") {
        submitBtn.innerText = "Submitted";
    } else if (tag.resolution_status === "APPROVED") {
        submitBtn.innerText = "Approved";
    } else if (tag.resolution_status === "REJECTED") {
        submitBtn.innerText = "Rejected";
    } else {
        submitBtn.innerText = "Submit";
    }

    const statusText = document.getElementById("jeResolutionStatus");
    const status = tag.resolution_status;

    if (!status || status === "NOT_STARTED") {
        statusText.innerText = "NOT STARTED";
        statusText.style.color = "#94a3b8";
    } else if (status === "SAVED") {
        statusText.innerText = "SAVED (Draft)";
        statusText.style.color = "#facc15";
    } else if (status === "SUBMITTED") {
        statusText.innerText = "SUBMITTED";
        statusText.style.color = "#60a5fa";
    } else if (status === "APPROVED") {
        statusText.innerText = "APPROVED";
        statusText.style.color = "#4ade80";
    } else if (status === "REJECTED") {
        statusText.innerText = "REJECTED";
        statusText.style.color = "#f87171";
    }

    // Clear file input and preview before rendering
    const preview = document.getElementById("jeSnapPreview");

    // Only clear file input if tag has changed (switching tags)
    if (!jeIsRenderingSameTag) {
        fileInput.value = "";
        preview.innerHTML = "";
    }

    if (tag.resolved_snap_path) {
        preview.innerHTML = `
            <img src="${encodeURI("/" + tag.resolved_snap_path)}"
                 style="max-width:100%; max-height:100%; border-radius:8px;">
        `;
    } else if (fileInput.files && fileInput.files.length > 0) {
        // Keep showing the attached image preview, don't wipe it
    } else {
        preview.innerHTML = "";
        preview.innerText = "No image selected";
    }

    document.getElementById("jePositionInfo").innerText =
        `Tag ${jeCurrentIndex + 1} of ${jeTags.length}`;

    document.getElementById("jePrevBtn").disabled = jeCurrentIndex === 0;
    document.getElementById("jeNextBtn").disabled = jeCurrentIndex === jeTags.length - 1;

    const originalSnapDiv = document.getElementById("jeOriginalSnap");

    if (tag.original_snap_path) {
        originalSnapDiv.innerHTML = `
            <img src="${encodeURI("/" + tag.original_snap_path)}"
                 style="max-width:100%; max-height:100%; border-radius:8px;">
        `;
    } else {
        originalSnapDiv.innerText = "No original snap";
    }

    isDirty = false;
}

async function refreshCurrentTag() {

    if (jeTags.length === 0) return;

    const currentTagId = jeTags[jeCurrentIndex].id;

    const jobNo = document.getElementById("jobNoInput").value.trim().toUpperCase();
    const unitNo = document.getElementById("unitNoInput").value.trim().toUpperCase();
    const stage = document.getElementById("stageSelect").value;

    try {

        const data = await apiFetch(
            `/api/job-engineer-tags?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}&department=${currentDepartment}`
        );

        // ✅ Always update master list
        jeAllTags = sortTagsByTagNo(data.tags || []).map(t => ({ ...t }));

        // ✅ Re-apply filter correctly
        const zoneSelect = document.getElementById("zoneFilter");

        if (zoneSelect.dataset.filterActive === "true") {
            const selectedZone = zoneSelect.value;

            jeTags = jeAllTags
                .filter(t => (t.zone || "Unassigned") === selectedZone)
                .map(t => ({ ...t }));   // ✅ FIX

        } else {
            jeTags = jeAllTags.map(t => ({ ...t })); // ✅ FIX
        }

        if (jeTags.length === 0) {
            clearCard();
            document.getElementById("jeStatusText").innerText = "No allocated tags found.";
            return;
        }

        // ✅ Maintain correct position
        const newIndex = jeTags.findIndex(t => t.id === currentTagId);

        jeCurrentIndex = newIndex !== -1 ? newIndex : 0;

        renderCurrentTag();
        renderTagPointsTable(document.getElementById("tagSearchInput").value.trim().toLowerCase());

    } catch (err) {
        console.error(err);
        alert(err.message || "Failed to refresh tag.");
    }
}

function clearCard() {

    document.getElementById("jeTagNo").value = "";
    document.getElementById("jeModelName").value = "";
    document.getElementById("jeReviewDate").value = "";
    document.getElementById("jeDescription").value = "";
    document.getElementById("jeResolution").value = "";

    document.getElementById("jeSnapPreview").innerText = "No image selected";
    document.getElementById("jeOriginalSnap").innerText = "No original snap";

    document.getElementById("jePositionInfo").innerText = "Tag 0 of 0";
}

// document.getElementById("jePrevBtn").addEventListener("click", () => {
//     if (jeCurrentIndex > 0) {
//         jeCurrentIndex--;
//         renderCurrentTag();
//     }
// });

// document.getElementById("jeNextBtn").addEventListener("click", () => {
//     if (jeCurrentIndex < jeTags.length - 1) {
//         jeCurrentIndex++;
//         renderCurrentTag();
//     }
// });

document.getElementById("jePrevBtn").addEventListener("click", () => {

    if (jeIsSearchActive && jeSearchMatches.length > 1) {
        // Move to previous search match
        jeSearchMatchIndex = (jeSearchMatchIndex - 1 + jeSearchMatches.length) % jeSearchMatches.length;
        jeCurrentIndex = jeSearchMatches[jeSearchMatchIndex];

        document.getElementById("jeTagMatchInfo").innerText =
            `Match ${jeSearchMatchIndex + 1} of ${jeSearchMatches.length}`;

        renderCurrentTag();

    } else if (!jeIsSearchActive && jeCurrentIndex > 0) {
        jeCurrentIndex--;
        renderCurrentTag();
    }
});

document.getElementById("jeNextBtn").addEventListener("click", () => {

    if (jeIsSearchActive && jeSearchMatches.length > 1) {
        // Move to next search match
        jeSearchMatchIndex = (jeSearchMatchIndex + 1) % jeSearchMatches.length;
        jeCurrentIndex = jeSearchMatches[jeSearchMatchIndex];

        document.getElementById("jeTagMatchInfo").innerText =
            `Match ${jeSearchMatchIndex + 1} of ${jeSearchMatches.length}`;

        renderCurrentTag();

    } else if (!jeIsSearchActive && jeCurrentIndex < jeTags.length - 1) {
        jeCurrentIndex++;
        renderCurrentTag();
    }
});

document.getElementById("jeSaveBtn").addEventListener("click", saveResolution);

document.getElementById("jeResolution")
    .addEventListener("input", () => {
        isDirty = true;
    });

document.getElementById("jeResolvedSnap")
    .addEventListener("change", () => {
        isDirty = true;
    });

async function saveResolution() {

    if (jeTags.length === 0) return;

    const currentTag = jeTags[jeCurrentIndex];

    const resolutionText = document.getElementById("jeResolution").value;
    const imageFile = document.getElementById("jeResolvedSnap").files[0];

    if (!resolutionText) {
        alert("Resolution cannot be empty.");
        return;
    }

    const formData = new FormData();
    formData.append("resolution", resolutionText);

    if (imageFile) {
        formData.append("resolvedSnap", imageFile);
    }

    try {
        const result = await apiFetch(
            `/api/tags/${currentTag.id}/save-resolution`,
            {
                method: "POST",
                body: formData,
            }
        );

        alert(result.message);

        // ✅ ONLY THIS
        await refreshCurrentTag();
        isDirty = false;

    } catch (err) {
        console.error(err);
        alert(err.message || "Save failed.");
    }
}

document.getElementById("jeSubmitBtn").addEventListener("click", submitResolution);

async function submitResolution() {

    if (jeTags.length === 0) return;

    if (isDirty) {
        alert("You have unsaved changes. Please SAVE before submitting.");
        return;
    }

    const currentTag = jeTags[jeCurrentIndex];

    // 🔥 Must save first
    if (!currentTag.resolution || currentTag.resolution.trim() === "") {
        alert("Please SAVE resolution before submitting.");
        return;
    }

    await refreshCurrentTag(); // get latest DB state

    const updatedTag = jeTags[jeCurrentIndex];

    if (!updatedTag.resolution || updatedTag.resolution.trim() === "") {
        alert("Please SAVE resolution before submitting.");
        return;
    }

    const confirmSubmit = confirm("Once submitted, resolution cannot be changed. Proceed?");
    if (!confirmSubmit) return;

    try {

        const result = await apiFetch(
            `/api/tags/${currentTag.id}/submit-resolution`,
            { method: "POST" }
        );

        alert(result.message);

        // ✅ NEW FIX
        jeTags[jeCurrentIndex].resolution_status = "SUBMITTED";

        const tagId = currentTag.id;

        const masterIndex = jeAllTags.findIndex(t => t.id === tagId);
        if (masterIndex !== -1) {
            jeAllTags[masterIndex].resolution_status = "SUBMITTED";
        }

        renderCurrentTag();

        // keep this
        await refreshCurrentTag();

    } catch (err) {
        console.error(err);
        alert(err.message || "Submit failed.");
    }
}

document
    .getElementById("jeUploadSnapBtn")
    .addEventListener("click", () => {
        document.getElementById("jeResolvedSnap").click();
    });

document.getElementById("jeResolvedSnap")
    .addEventListener("change", function () {

        const file = this.files[0];
        if (!file) return;

        const preview = document.getElementById("jeSnapPreview");
        const reader = new FileReader();

        reader.onload = function (e) {
            preview.innerHTML = `
                <img src="${e.target.result}" 
                     style="max-width:100%; max-height:100%; border-radius:8px;">
            `;
        };

        reader.readAsDataURL(file);

        // ✅ Re-enable delete button now that a file is attached
        const currentTag = jeTags[jeCurrentIndex];
        const isLocked =
            currentTag.resolution_status === "SUBMITTED" ||
            currentTag.resolution_status === "APPROVED";

        document.getElementById("jeDeleteSnapBtn").disabled = isLocked ? true : false;

        isDirty = true;
    });


// document
//     .getElementById("jeResolvedSnap")
//     .addEventListener("change", function () {

//         const file = this.files[0];

//         if (!file) return;

//         const preview = document.getElementById("jeSnapPreview");

//         const reader = new FileReader();

//         reader.onload = function (e) {
//             preview.innerHTML = `
//         <img src="${e.target.result}" 
//              style="max-width:100%; max-height:100%; border-radius:8px;">
//       `;
//         };

//         reader.readAsDataURL(file);
//     });

document.getElementById("zoneFilter")
    .addEventListener("change", filterByZone);

function updateJESummary() {

    if (!jeAllTags || jeAllTags.length === 0) {

        document.getElementById("jeTotal").innerText = 0;
        document.getElementById("jeNotStarted").innerText = 0;
        document.getElementById("jeSaved").innerText = 0;
        document.getElementById("jeSubmitted").innerText = 0;
        document.getElementById("jeApproved").innerText = 0;
        document.getElementById("jeRejected").innerText = 0;

        return;
    }

    const total = jeAllTags.length;

    let notStarted = 0;
    let saved = 0;
    let submitted = 0;
    let approved = 0;
    let rejected = 0;

    jeAllTags.forEach(tag => {

        const status = tag.resolution_status;

        if (!status || status === "PENDING" || status === "NOT_STARTED") {
            notStarted++;
        }
        else if (status === "SAVED") {
            saved++;
        }
        else if (status === "SUBMITTED") {
            submitted++;
        }
        else if (status === "APPROVED") {
            approved++;
        }
        else if (status === "REJECTED") {
            rejected++;
        }
    });

    // 🔥 Update UI
    document.getElementById("jeTotal").innerText = total;
    document.getElementById("jeNotStarted").innerText = notStarted;
    document.getElementById("jeSaved").innerText = saved;
    document.getElementById("jeSubmitted").innerText = submitted;
    document.getElementById("jeApproved").innerText = approved;
    document.getElementById("jeRejected").innerText = rejected;
}

document.getElementById("statusFilter")
    .addEventListener("change", filterByStatus);

function applyFilters() {

    const selectedZone = document.getElementById("zoneFilter").value;
    const selectedStatus = document.getElementById("statusFilter").value;

    const zoneSelect = document.getElementById("zoneFilter");
    zoneSelect.dataset.filterActive = selectedZone !== "ALL" ? "true" : "false";

    jeTags = jeAllTags.filter(t => {

        const zoneMatch =
            selectedZone === "ALL" ||
            (t.zone || "Unassigned") === selectedZone;

        const s = t.resolution_status;
        const statusMatch =
            selectedStatus === "ALL" ||
            (selectedStatus === "NOT_STARTED"
                ? (!s || s === "PENDING" || s === "NOT_STARTED")
                : s === selectedStatus);

        return zoneMatch && statusMatch;
    });

    jeCurrentIndex = 0;

    if (jeTags.length === 0) {
        clearCard();
        document.getElementById("jeStatusText").innerText =
            "No tags for selected filters.";
        return;
    }

    renderCurrentTag();
}

function filterByZone() {
    applyFilters();
}

function filterByStatus() {
    applyFilters();
}

function searchByTagNo() {

    const input = document.getElementById("jeTagNo").value.trim().toLowerCase();

    if (!input) {
        // If empty, clear search and go back to normal
        jeIsSearchActive = false;
        jeSearchMatches = [];
        document.getElementById("jeTagMatchInfo").innerText = "";
        jeCurrentIndex = 0;
        renderCurrentTag();
        return;
    }

    // Find all matching indices in jeTags
    jeSearchMatches = [];
    jeTags.forEach((t, i) => {
        if ((t.tag_no || "").toLowerCase() === input) {
            jeSearchMatches.push(i);
        }
    });

    if (jeSearchMatches.length === 0) {
        document.getElementById("jeTagMatchInfo").innerText = "No match found";
        return;
    }

    jeIsSearchActive = true;
    jeSearchMatchIndex = 0;
    jeCurrentIndex = jeSearchMatches[0];

    document.getElementById("jeTagMatchInfo").innerText =
        `Match 1 of ${jeSearchMatches.length}`;

    renderCurrentTag();
}

document.getElementById("jeTagNo").addEventListener("keydown", function (e) {

    if (e.key === "Enter") {

        // If search already active and same value, cycle to next match
        if (jeIsSearchActive && jeSearchMatches.length > 1) {

            jeSearchMatchIndex = (jeSearchMatchIndex + 1) % jeSearchMatches.length;
            jeCurrentIndex = jeSearchMatches[jeSearchMatchIndex];

            document.getElementById("jeTagMatchInfo").innerText =
                `Match ${jeSearchMatchIndex + 1} of ${jeSearchMatches.length}`;

            renderCurrentTag();

        } else {
            // Fresh search
            searchByTagNo();
        }
    }

    // Clear search on Escape
    if (e.key === "Escape") {
        jeIsSearchActive = false;
        jeSearchMatches = [];
        document.getElementById("jeTagMatchInfo").innerText = "";
        document.getElementById("jeTagNo").value = "";
        jeCurrentIndex = 0;
        renderCurrentTag();
    }
});

async function deleteResolvedImage() {

    if (jeTags.length === 0) return;

    const currentTag = jeTags[jeCurrentIndex];

    const fileInput = document.getElementById("jeResolvedSnap");
    const preview = document.getElementById("jeSnapPreview");

    const hasUnsavedImage = fileInput.files && fileInput.files.length > 0;
    const hasSavedImage = currentTag.resolved_snap_path;

    const confirmDelete = confirm("Are you sure you want to remove the image?");
    if (!confirmDelete) return;

    try {

        // 🔥 CASE 1 → UNSAVED IMAGE (UI only)
        if (hasUnsavedImage && !hasSavedImage) {
            fileInput.value = "";
            preview.innerHTML = "";
            preview.innerText = "No image selected";
            // Also disable delete button since nothing left
            document.getElementById("jeDeleteSnapBtn").disabled = true;
            alert("Image removed (not saved yet).");
            return;
        }

        // 🔥 CASE 2 → SAVED IMAGE (DB)
        if (hasSavedImage) {
            const result = await apiFetch(
                `/api/tags/${currentTag.id}/delete-snap`,
                { method: "POST" }
            );

            alert(result.message);

            // Force renderCurrentTag to treat this as a fresh render
            jeLastRenderedTagId = null;

            await refreshCurrentTag();
            return;
        }

        // 🔥 CASE 3 → Nothing to delete
        alert("No image to remove.");

    } catch (err) {
        console.error(err);
        alert(err.message || "Failed to delete image.");
    }
}

document
    .getElementById("jeDeleteSnapBtn")
    .addEventListener("click", deleteResolvedImage);

// ===== TAG POINTS TABLE =====

document.getElementById("tagSearchInput").addEventListener("input", function () {
    renderTagPointsTable(this.value.trim().toLowerCase());
});

function renderTagPointsTable(searchQuery = "") {
    const body = document.getElementById("tagpointsBody");
    body.innerHTML = "";

    if (!jeAllTags || jeAllTags.length === 0) {
        body.innerHTML = `<div class="tagpoints-empty-msg">No tags loaded. Use "Load Tags" first.</div>`;
        return;
    }

    const filtered = jeAllTags.filter(tag => {
        if (!searchQuery) return true;
        return (
            (tag.tag_no || "").toLowerCase().includes(searchQuery) ||
            (tag.description || "").toLowerCase().includes(searchQuery) ||
            (tag.zone || "").toLowerCase().includes(searchQuery) ||
            (tag.resolution || "").toLowerCase().includes(searchQuery) ||
            (tag.resolution_status || "").toLowerCase().includes(searchQuery)
        );
    });

    if (filtered.length === 0) {
        body.innerHTML = `<div class="tagpoints-empty-msg">No matching tags found.</div>`;
        return;
    }

    filtered.forEach((tag, i) => {
        const statusLabel = getStatusLabel(tag.resolution_status);
        const statusColor = getStatusColor(tag.resolution_status);

        let dateDisplay = "";
        if (tag.tag_date) {
            const d = new Date(tag.tag_date);
            dateDisplay =
                String(d.getDate()).padStart(2, "0") + "-" +
                String(d.getMonth() + 1).padStart(2, "0") + "-" +
                d.getFullYear();
        }

        const masterIndex = jeAllTags.indexOf(tag);

        const row = document.createElement("div");
        row.className = "tagpoints-row";
        row.dataset.rowId = tag.id;

        row.innerHTML = `
            <div>${i + 1}</div>
            <div>${tag.tag_no || "—"}</div>
            <div title="${(tag.description || "").replace(/"/g, "&quot;")}">${truncate(tag.description, 60)}</div>
            <div>${tag.zone || "—"}</div>
            <div title="${(tag.model_file || "").replace(/"/g, "&quot;")}">${truncate(tag.model_file, 40)}</div>
            <div>${dateDisplay || "—"}</div>
            <div title="${(tag.resolution || "").replace(/"/g, "&quot;")}">${truncate(tag.resolution, 60)}</div>
            <div style="color:${statusColor};font-weight:600;">${statusLabel}</div>
            <div>
              <button class="tp-go-btn" data-index="${masterIndex}">↗</button>
            </div>
        `;

        body.appendChild(row);
    });

    body.querySelectorAll(".tp-go-btn").forEach(btn => {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            const idx = parseInt(this.dataset.index);
            jeIsSearchActive = false;
            jeSearchMatches = [];
            document.getElementById("jeTagMatchInfo").innerText = "";

            const zoneSelect = document.getElementById("zoneFilter");
            const statusSelect = document.getElementById("statusFilter");
            zoneSelect.value = "ALL";
            statusSelect.value = "ALL";
            zoneSelect.dataset.filterActive = "false";
            jeTags = [...jeAllTags];

            jeCurrentIndex = idx;
            renderCurrentTag();

            // Scroll to the detail card
            document.querySelector(".tag-detail-wrapper").scrollIntoView({ behavior: "smooth" });
        });
    });
}

function truncate(str, max) {
    if (!str) return "—";
    return str.length > max ? str.slice(0, max) + "…" : str;
}

function getStatusLabel(status) {
    if (!status || status === "NOT_STARTED" || status === "PENDING") return "Not Started";
    if (status === "SAVED") return "Saved";
    if (status === "SUBMITTED") return "Submitted";
    if (status === "APPROVED") return "Approved";
    if (status === "REJECTED") return "Rejected";
    return status;
}

function getStatusColor(status) {
    if (!status || status === "NOT_STARTED" || status === "PENDING") return "#94a3b8";
    if (status === "SAVED") return "#facc15";
    if (status === "SUBMITTED") return "#60a5fa";
    if (status === "APPROVED") return "#4ade80";
    if (status === "REJECTED") return "#f87171";
    return "#94a3b8";
}

