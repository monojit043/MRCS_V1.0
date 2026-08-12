if (!localStorage.getItem("token")) {
    window.location.href = "login.html";
}

const LE_HASH_MAP = { "#approval": "approvalSection", "#review": "reviewSection" };

function showLeSection(hash) {
    const sectionId = LE_HASH_MAP[hash] || "approvalSection";
    ["approvalSection", "reviewSection"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("active-section", id === sectionId);
    });

    const loadBtn = document.getElementById("loadLeadTagsBtn");
    if (loadBtn) loadBtn.style.display = sectionId === "reviewSection" ? "none" : "";
}

showLeSection(window.location.hash);
window.addEventListener("hashchange", () => showLeSection(window.location.hash));

function collectPrerequisites() {

    const prerequisites = [];
    const items = document.querySelectorAll("#prereqContainer .prereq-item");

    for (let item of items) {

        const checkbox = item.querySelector(".prereq-check");
        const textarea = item.querySelector(".explanation");
        const explanationValue = textarea.value.trim();
        const text = item.querySelector(".prereq-text").innerText.trim();
        const department = item.dataset.department || "";

        if (!checkbox.checked && explanationValue === "") {
            throw new Error(`Please provide exception reason for: "${text}"`);
        }

        prerequisites.push({
            text,
            department,
            isFulfilled: checkbox.checked,
            explanation: explanationValue
        });
    }

    return prerequisites;
}

document.addEventListener("DOMContentLoaded", () => {

    const stageSelect = document.getElementById("reviewStage");
    const prereqContainer = document.getElementById("prereqContainer");

    if (!stageSelect || !prereqContainer) return;

    stageSelect.addEventListener("change", async () => {

        const stage = stageSelect.value;
        const jobNo = document.getElementById("jobNo").value.trim().toUpperCase();
        const unitNo = document.getElementById("unitNo").value.trim().toUpperCase();

        if (!stage) return;

        try {

            // 1️⃣ Load master prerequisites (all departments)
            const masterData = await apiFetch(`/api/review/prerequisites/${encodeURIComponent(stage)}`);

            prereqContainer.innerHTML = "";

            // Group by department
            const grouped = {};
            masterData.forEach(item => {
                const key = (item.department || "general").toLowerCase();
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(item);
            });

            Object.keys(grouped).sort().forEach(dept => {

                const header = document.createElement("div");
                header.classList.add("prereq-dept-header");
                header.textContent = dept.charAt(0).toUpperCase() + dept.slice(1);
                prereqContainer.appendChild(header);

                grouped[dept].forEach(item => {
                    const div = document.createElement("div");
                    div.classList.add("prereq-item");
                    div.dataset.department = dept;

                    div.innerHTML = `
                        <div class="prereq-left">
                            <input type="checkbox" class="prereq-check">
                            <span class="prereq-text">${item.prerequisite_text}</span>
                        </div>
                        <div class="prereq-right">
                            <textarea class="explanation"
                                placeholder="Exception reason required if not accepted"></textarea>
                        </div>
                    `;
                    prereqContainer.appendChild(div);
                });
            });

            // 2️⃣ If job + unit exists → load saved review + verifications
            if (jobNo && unitNo) {

                const reviewData = await apiFetch(
                    `/api/review?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
                );

                // Always show initiation data (PEM is authority on dates/description)
                populateInitiationDisplay(reviewData.initiation);

                const qrLocked = reviewData.initiation?.qr_generated === true;

                if (reviewData.exists) {

                    document.getElementById("reviewStatus").innerText =
                        reviewData.review.status || "Draft";

                    resetFormState();

                    if (reviewData.review.is_locked) {
                        lockForm();
                    }

                    // QR generated — permanently hide Edit button
                    if (qrLocked) {
                        const editBtn = document.getElementById("editReviewBtn");
                        const saveBtn = document.getElementById("saveReviewBtn");
                        const submitBtn = document.getElementById("submitReviewBtn");
                        if (editBtn)   editBtn.style.display   = "none";
                        if (saveBtn)   saveBtn.style.display   = "none";
                        if (submitBtn) submitBtn.style.display = "none";
                        document.getElementById("reviewStatus").innerText = "QR GENERATED — LOCKED";
                        lockForm();
                    }

                    applySavedData(reviewData);

                } else {

                    resetFormState();
                    document.getElementById("reviewStatus").innerText = "Draft";

                    applyNewReviewDefaults();

                    if (reviewData.prerequisites && reviewData.prerequisites.length) {
                        applyPrereqVerifications(reviewData.prerequisites);
                    }
                }

            } else {
                applyNewReviewDefaults();
            }

        } catch (err) {
            console.error("Error loading review:", err);
        }

    });

    function populateInitiationDisplay(initiation) {
        const periodEl = document.getElementById("reviewPeriodDisplay");
        const descEl   = document.getElementById("reviewDescriptionDisplay");
        if (!initiation) {
            if (periodEl) periodEl.textContent = "—";
            if (descEl)   descEl.textContent   = "—";
            return;
        }
        const from = initiation.review_date_from ? initiation.review_date_from.split("T")[0] : "—";
        const to   = initiation.review_date_to   ? initiation.review_date_to.split("T")[0]   : "—";
        if (periodEl) periodEl.textContent = `${from}  →  ${to}`;
        if (descEl)   descEl.textContent   = initiation.description || "—";
    }

    function applySavedData(reviewData) {
        applyPrereqVerifications(reviewData.prerequisites || []);
    }

    function applyPrereqVerifications(prerequisites) {

        const items = document.querySelectorAll("#prereqContainer .prereq-item");

        items.forEach(item => {

            const text     = item.querySelector(".prereq-text").innerText.trim();
            const checkbox = item.querySelector(".prereq-check");
            const textarea = item.querySelector(".explanation");
            const dept     = item.dataset.department;

            const saved = prerequisites.find(p =>
                p.prerequisite_text === text && p.department === dept
            );

            if (saved) {
                checkbox.checked = saved.is_accepted;
                textarea.value   = saved.exception_reason || "";
                if (saved.is_accepted) item.classList.add("fulfilled");
            }

            checkbox.addEventListener("change", () => {
                item.classList.toggle("fulfilled", checkbox.checked);
                if (checkbox.checked) textarea.value = "";
            });
        });
    }

    function applyNewReviewDefaults() {

        const items = document.querySelectorAll("#prereqContainer .prereq-item");

        items.forEach(item => {

            const checkbox = item.querySelector(".prereq-check");

            checkbox.addEventListener("change", () => {
                item.classList.toggle("fulfilled", checkbox.checked);
            });
        });
    }

});

const saveBtn = document.getElementById("saveReviewBtn");
if (saveBtn) {
    saveBtn.addEventListener("click", async () => {

        const jobNo = document.getElementById("jobNo").value.trim().toUpperCase();
        const unitNo = document.getElementById("unitNo").value.trim().toUpperCase();
        const stage = document.getElementById("reviewStage").value;

        if (!jobNo || !unitNo || !stage) {
            alert("Please select a model review first");
            return;
        }

        let prerequisites;

        try {
            prerequisites = collectPrerequisites();
        } catch (err) {
            alert(err.message);
            return;
        }

        try {
            const data = await apiFetch("/api/review/save", {
                method: "POST",
                body: JSON.stringify({ jobNo, unitNo, stage, prerequisites })
            });

            if (data.success) {
                alert("Review saved successfully");
            } else {
                alert("Failed to save review");
            }

        } catch (err) {
            console.error(err);
            alert("Error saving review");
        }

    });
}
const submitBtn = document.getElementById("submitReviewBtn");
if (submitBtn) {

    submitBtn.addEventListener("click", async () => {

        const jobNo = document.getElementById("jobNo").value.trim().toUpperCase();
        const unitNo = document.getElementById("unitNo").value.trim().toUpperCase();
        const stage = document.getElementById("reviewStage").value;

        try {

            // STEP 1 — Save first
            const saveData = await apiFetch("/api/review/save", {
                method: "POST",
                body: JSON.stringify({
                    jobNo,
                    unitNo,
                    stage,
                    prerequisites: collectPrerequisites()
                })
            });

            if (!saveData.success) {
                alert("Save failed. Cannot submit.");
                return;
            }

            // STEP 2 — Then Submit (Lock)
            const submitData = await apiFetch("/api/review/submit", {
                method: "POST",
                body: JSON.stringify({ jobNo, unitNo, stage })
            });

            if (submitData.success) {
                alert("Review submitted successfully");
                location.reload();
            } else {
                alert(submitData.error || "Submission failed");
            }

        } catch (err) {
            console.error(err);
            alert("Error during submission");
        }
    });

}
function lockForm() {

    document.querySelectorAll(".prereq-check, .explanation").forEach(el => {
        el.disabled = true;
    });

    // Hide Save and Submit
    const saveBtn = document.getElementById("saveReviewBtn");
    const submitBtn = document.getElementById("submitReviewBtn");

    if (saveBtn) saveBtn.style.display = "none";
    if (submitBtn) submitBtn.style.display = "none";

    // Show Edit button
    const editBtn = document.getElementById("editReviewBtn");
    if (editBtn) editBtn.style.display = "inline-block";
}
const editBtn = document.getElementById("editReviewBtn");
if (editBtn) {
    editBtn.addEventListener("click", async () => {

        const jobNo = document.getElementById("jobNo").value.trim().toUpperCase();
        const unitNo = document.getElementById("unitNo").value.trim().toUpperCase();
        const stage = document.getElementById("reviewStage").value;

        try {

            const data = await apiFetch("/api/review/edit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    jobNo,
                    unitNo,
                    stage
                })
            });

            if (data.success) {
                alert("Review unlocked for editing");
                location.reload();
            } else {
                alert(data.error || "Unable to edit");
            }

        } catch (err) {
            console.error(err);
            alert("Error unlocking review");
        }

    });
}
function resetFormState() {

    // Enable all editing fields
    document.querySelectorAll(
        "#fromDate, #toDate, #reviewDescription, .prereq-check, .explanation"
    ).forEach(el => {
        el.disabled = false;
    });

    // Show Save & Submit
    const saveBtn = document.getElementById("saveReviewBtn");
    const submitBtn = document.getElementById("submitReviewBtn");
    const editBtn = document.getElementById("editReviewBtn");

    if (saveBtn) saveBtn.style.display = "inline-block";
    if (submitBtn) submitBtn.style.display = "inline-block";
    if (editBtn) editBtn.style.display = "none";
}


// Model review preparation front end js ends here ////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
// ===============================
// APPROVAL SECTION STATE
// ===============================

let leadAllTags = [];
let leadTags = [];
let leadCurrentIndex = 0;
let leadIsDirty = false;
let leadLastRenderedTagId = null;

document.getElementById("leadResolution")
    .addEventListener("input", () => {
        leadIsDirty = true;
    });

document.getElementById("leadResolvedSnapInput")
    .addEventListener("change", () => {
        leadIsDirty = true;
    });

// async function loadLeadTags() {

//     const jobNo = document.getElementById("leadJobNo").value;
//     const unitNo = document.getElementById("leadUnitNo").value;
//     const stage = document.getElementById("leadStage").value;

//     if (!jobNo || !unitNo || !stage) {
//         alert("Please enter Job No, Unit No and Stage");
//         return;
//     }

//     loadSummary();

//     try {

//         const data = await apiFetch(
//             `/api/lead-review-tags?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
//         );

//         leadAllTags = data.tags || [];
//         leadTags = [...leadAllTags];
//         leadCurrentIndex = 0;

//         populateLeadZoneFilter();
//         applyLeadFilters();

//         if (leadAllTags.length === 0) {
//             clearLeadCard();
//             alert("No tags found.");
//             return;
//         }

//         renderCurrentLeadTag();

//     } catch (err) {
//         console.error(err);
//         alert("Failed to load submitted tags.");
//     }
// }

async function loadLeadTags() {

    const jobNo = document.getElementById("leadJobNo").value.trim().toUpperCase();
    const unitNo = document.getElementById("leadUnitNo").value.trim().toUpperCase();
    const stage = document.getElementById("leadStage").value;

    if (!jobNo || !unitNo || !stage) {
        alert("Please enter Job No, Unit No and Stage");
        return;
    }

    loadSummary();

    try {

        const data = await apiFetch(
            `/api/lead-review-tags?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
        );

        leadAllTags = data.tags || [];
        leadCurrentIndex = 0;

        populateLeadZoneFilter();

        if (leadAllTags.length === 0) {
            clearLeadCard();
            alert("No tags found.");
            return;
        }

        // 🔥 ONLY THIS (handles filtering + rendering)
        applyLeadFilters();

    } catch (err) {
        console.error(err);
        alert("Failed to load submitted tags.");
    }
}

function populateLeadZoneFilter() {

    const zoneSelect = document.getElementById("leadZoneFilter");

    const zones = [...new Set(
        leadAllTags.map(t => t.zone || "Unassigned")
    )];

    zoneSelect.innerHTML = `<option value="ALL">All</option>`;

    zones.forEach(z => {
        zoneSelect.innerHTML += `<option value="${z}">${z}</option>`;
    });
}

function normalizeStatus(status) {
    if (!status || status === "PENDING") return "NOT_STARTED";
    return status;
}

// function applyLeadFilters() {

//     const selectedZone = document.getElementById("leadZoneFilter").value;
//     const selectedStatus = document.getElementById("leadStatusFilter").value;

//     leadTags = leadAllTags.filter(t => {

//         const zoneMatch =
//             selectedZone === "ALL" ||
//             (t.zone || "Unassigned") === selectedZone;

//         const s = t.resolution_status;

//         const statusMatch =
//             selectedStatus === "ALL" ||
//             (selectedStatus === "NOT_STARTED"
//                 ? (!s || s === "NOT_STARTED")
//                 : s === selectedStatus);

//         return zoneMatch && statusMatch;
//     });

//     leadCurrentIndex = 0;

//     if (leadTags.length === 0) {
//         clearLeadCard(true);
//         return;
//     }

//     renderCurrentLeadTag();
// }

function buildFilteredTags() {
    const selectedZone = document.getElementById("leadZoneFilter").value;
    const selectedStatus = document.getElementById("leadStatusFilter").value;

    return leadAllTags.filter(t => {
        const zoneMatch =
            selectedZone === "ALL" ||
            (t.zone || "Unassigned") === selectedZone;

        const normalizedStatus = normalizeStatus(t.resolution_status);

        const statusMatch =
            selectedStatus === "ALL" ||
            normalizedStatus === selectedStatus;

        return zoneMatch && statusMatch;
    });
}

// Called when user changes a filter — always resets to first tag
function applyLeadFilters() {
    leadTags = buildFilteredTags();
    leadCurrentIndex = 0;

    if (leadTags.length === 0) {
        clearLeadCard(true);
        return;
    }

    renderCurrentLeadTag();
}

// Called after approve/reject — preserves position so next tag in sequence is shown
function advanceAfterAction(prevIndex) {
    leadTags = buildFilteredTags();

    if (leadTags.length === 0) {
        clearLeadCard(true);
        return;
    }

    // Stay at the same index; if the acted tag was removed the next one slides into place
    leadCurrentIndex = Math.min(prevIndex, leadTags.length - 1);
    renderCurrentLeadTag();
}

document.getElementById("leadZoneFilter")
    .addEventListener("change", applyLeadFilters);

document.getElementById("leadStatusFilter")
    .addEventListener("change", applyLeadFilters);

function renderCurrentLeadTag() {

    if (leadTags.length === 0) {
        clearLeadCard();
        return;
    }

    // ✅ Clamp index safely
    if (leadCurrentIndex < 0) leadCurrentIndex = 0;
    if (leadCurrentIndex >= leadTags.length) leadCurrentIndex = leadTags.length - 1;

    const tag = leadTags[leadCurrentIndex];

    const isSameTag = (leadLastRenderedTagId === tag.id);
    leadLastRenderedTagId = tag.id;

    document.getElementById("leadTagNo").value = tag.tag_no || "";
    document.getElementById("leadModelName").value = tag.model_file || "";
    document.getElementById("leadViewName").value = tag.view_name || "";


    if (tag.tag_date) {
        const dateObj = new Date(tag.tag_date);
        const formatted =
            dateObj.getFullYear() + "-" +
            String(dateObj.getMonth() + 1).padStart(2, "0") + "-" +
            String(dateObj.getDate()).padStart(2, "0");

        document.getElementById("leadReviewDate").value = formatted;
    } else {
        document.getElementById("leadReviewDate").value = "";
    }

    document.getElementById("leadDescription").value = tag.description || "";
    document.getElementById("leadResolution").value = tag.resolution || "";

    const status = normalizeStatus(tag.resolution_status);
    const statusEl = document.getElementById("leadResolutionStatus");

    if (!status || status === "NOT_STARTED") {
        statusEl.innerText = "NOT STARTED";
        statusEl.style.color = "#94a3b8";
    }
    else if (status === "SAVED") {
        statusEl.innerText = "SAVED";
        statusEl.style.color = "#facc15";
    }
    else if (status === "SUBMITTED") {
        statusEl.innerText = "SUBMITTED";
        statusEl.style.color = "#60a5fa";
    }
    else if (status === "APPROVED") {
        statusEl.innerText = "APPROVED";
        statusEl.style.color = "#4ade80";
    }
    else if (status === "REJECTED") {
        statusEl.innerText = "REJECTED";
        statusEl.style.color = "#f87171";
    }

    const approveBtn = document.getElementById("leadApproveBtn");
    const rejectBtn = document.getElementById("leadRejectBtn");
    const saveBtn = document.getElementById("leadSaveBtn");
    const uploadBtn = document.getElementById("leadUploadBtn");

    const resolutionBox = document.getElementById("leadResolution");
    const fileInput = document.getElementById("leadResolvedSnapInput");

    const rejectionBox = document.getElementById("leadRejectionContainer");

    // Reset everything
    approveBtn.style.display = "none";
    rejectBtn.style.display = "none";
    saveBtn.style.display = "none";
    if (uploadBtn) uploadBtn.style.display = "none";

    // Hide by default
    rejectionBox.style.display = "none";

    // Default → readonly
    resolutionBox.readOnly = true;
    if (fileInput) fileInput.disabled = true;

    // 🔵 ONLY SUBMITTED → FULL CONTROL
    if (status === "SUBMITTED") {

        approveBtn.style.display = "inline-block";
        rejectBtn.style.display = "inline-block";
        saveBtn.style.display = "inline-block";

        // Show only for SUBMITTED
        if (status === "SUBMITTED") {
            rejectionBox.style.display = "block";
        }

        if (uploadBtn) uploadBtn.style.display = "inline-block";

        resolutionBox.readOnly = false;
        if (fileInput) fileInput.disabled = false;
    }

    // Original snap
    const originalDiv = document.getElementById("leadOriginalSnap");
    if (tag.original_snap_path) {
        originalDiv.innerHTML = `
            <img src="${encodeURI("/" + tag.original_snap_path)}"
                 style="max-width:100%; max-height:100%; border-radius:8px;">
        `;
    } else {
        originalDiv.innerText = "No original snap";
    }

    // Resolved snap
    const resolvedDiv = document.getElementById("leadResolvedSnap");

    // 🔥 Only clear when switching tag
    if (!isSameTag) {
        if (fileInput) fileInput.value = "";
        resolvedDiv.innerHTML = "";
    }

    // 🔥 Priority 1: DB image
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
        // keep preview already rendered by FileReader
    }

    // 🔥 Priority 2: DB image
    else if (tag.resolved_snap_path) {
        resolvedDiv.innerHTML = `
            <img src="${encodeURI("/" + tag.resolved_snap_path)}"
                 style="max-width:100%; max-height:100%; border-radius:8px;">
        `;
    }

    // 🔥 Fallback
    else {
        resolvedDiv.innerHTML = "";
        resolvedDiv.innerText = "No resolved snap";
    }

    // Position indicator
    document.getElementById("leadPositionInfo").innerText =
        `Tag ${leadCurrentIndex + 1} of ${leadTags.length}`

    // Arrow control
    document.getElementById("leadPrevBtn").disabled = leadCurrentIndex === 0;
    document.getElementById("leadNextBtn").disabled =
        leadCurrentIndex === leadTags.length - 1;

    // Clear rejection box
    document.getElementById("leadRejectionComment").value = "";

    leadIsDirty = false;
}

function clearLeadCard(showMessage = false) {

    document.getElementById("leadTagNo").value = "";
    document.getElementById("leadModelName").value = "";
    document.getElementById("leadReviewDate").value = "";
    document.getElementById("leadDescription").value = "";
    document.getElementById("leadResolution").value = "";
    document.getElementById("leadOriginalSnap").innerText = "No original snap";
    document.getElementById("leadResolvedSnap").innerText = "No resolved snap";
    document.getElementById("leadPositionInfo").innerText = "Tag 0 of 0";
    document.getElementById("leadRejectionComment").value = "";

    if (showMessage) {
        document.getElementById("leadPositionInfo").innerText =
            "No pending submitted tags.";
    }
}

document.getElementById("leadUploadBtn")
    .addEventListener("click", () => {
        document.getElementById("leadResolvedSnapInput").click();
    });

document.getElementById("leadResolvedSnapInput")
    .addEventListener("change", function () {

        const file = this.files[0];
        if (!file) return;

        const preview = document.getElementById("leadResolvedSnap");

        const reader = new FileReader();

        reader.onload = function (e) {
            preview.innerHTML = `
                <img src="${e.target.result}" 
                     style="max-width:100%; max-height:100%; border-radius:8px;">
            `;
        };

        reader.readAsDataURL(file);
    });

document.getElementById("leadSaveBtn")
    .addEventListener("click", saveLeadEdit);

async function saveLeadEdit() {

    if (leadTags.length === 0) return;

    const currentTag = leadTags[leadCurrentIndex];

    const resolutionText = document.getElementById("leadResolution").value;
    const imageFile = document.getElementById("leadResolvedSnapInput").files[0];

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

        // 🔁 Update UI (no full reload)
        leadAllTags = leadAllTags.map(t =>
            t.id === currentTag.id
                ? { ...t, resolution: resolutionText }
                : t
        );
        leadIsDirty = false;
        await refreshLeadCurrentTag();

    } catch (err) {
        console.error(err);
        alert(err.message || "Save failed.");
    }
}

document.getElementById("leadPrevBtn").addEventListener("click", () => {
    if (leadCurrentIndex > 0) {
        leadCurrentIndex--;
        renderCurrentLeadTag();
    }
});

document.getElementById("leadNextBtn").addEventListener("click", () => {
    if (leadCurrentIndex < leadTags.length - 1) {
        leadCurrentIndex++;
        renderCurrentLeadTag();
    }
});

const historyBody = document.getElementById("historyBody");

async function approveCurrentTag() {

    if (leadIsDirty) {
        alert("You have unsaved changes. Please SAVE before approving.");
        return;
    }

    if (leadTags.length === 0) return;

    const tagId = leadTags[leadCurrentIndex].id;

    const approveBtn = document.getElementById("leadApproveBtn");
    const rejectBtn = document.getElementById("leadRejectBtn");

    try {

        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        document.getElementById("leadPrevBtn").disabled = true;
        document.getElementById("leadNextBtn").disabled = true;

        approveBtn.innerText = "Approving...";

        const department = leadTags[leadCurrentIndex].department;

        await apiFetch(`/api/tags/${tagId}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ department })
        });

        const prevIndex = leadCurrentIndex;

        leadAllTags = leadAllTags.map(t =>
            t.id === tagId
                ? { ...t, resolution_status: "APPROVED" }
                : t
        );

        advanceAfterAction(prevIndex);

        await loadSummary();

        if (historyBody.style.display === "block") {
            await loadHistory();
        }

    } catch (err) {
        console.error(err);
        alert(err.message || "Approval failed.");
    } finally {
        approveBtn.disabled = false;
        rejectBtn.disabled = false;

        approveBtn.innerText = "Approve";
    }
}

async function rejectCurrentTag() {

    if (leadTags.length === 0) return;

    const rejectionComment =
        document.getElementById("leadRejectionComment").value.trim();

    if (!rejectionComment) {
        alert("Rejection comment is mandatory.");
        return;
    }

    const tagId = leadTags[leadCurrentIndex].id;
    const department = leadTags[leadCurrentIndex].department;

    const rejectBtn = document.getElementById("leadRejectBtn");
    const approveBtn = document.getElementById("leadApproveBtn");

    try {

        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        document.getElementById("leadPrevBtn").disabled = true;
        document.getElementById("leadNextBtn").disabled = true;

        rejectBtn.innerText = "Rejecting...";

        await apiFetch(`/api/tags/${tagId}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rejectionComment, department })
        });

        const prevIndex = leadCurrentIndex;

        leadAllTags = leadAllTags.map(t =>
            t.id === tagId
                ? { ...t, resolution_status: "REJECTED" }
                : t
        );

        advanceAfterAction(prevIndex);

        await loadSummary();

        if (historyBody.style.display === "block") {
            await loadHistory();
        }

    } catch (err) {
        console.error(err);
        alert(err.message || "Rejection failed.");
    } finally {
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
        rejectBtn.innerText = "Reject";
    }
}

document.getElementById("loadLeadTagsBtn")
    .addEventListener("click", loadLeadTags);

document.getElementById("leadApproveBtn")
    .addEventListener("click", approveCurrentTag);

document.getElementById("leadRejectBtn")
    .addEventListener("click", rejectCurrentTag);

const historyToggle = document.getElementById("historyToggle");
const historyArrow = document.getElementById("historyArrow");

historyToggle.addEventListener("click", () => {

    const isHidden = historyBody.style.display === "none" || historyBody.style.display === "";

    if (isHidden) {
        historyBody.style.display = "block";
        historyArrow.style.transform = "rotate(180deg)";
        loadHistory();
    } else {
        historyBody.style.display = "none";
        historyArrow.style.transform = "rotate(0deg)";
    }

});

let leHistoryAll = [];

async function loadHistory() {

    const jobNo = document.getElementById("leadJobNo").value.trim().toUpperCase();
    const unitNo = document.getElementById("leadUnitNo").value.trim().toUpperCase();
    const stage = document.getElementById("leadStage").value;

    if (!jobNo || !unitNo || !stage) return;

    const tbody = document.getElementById("historyTableBody");

    // 🔄 Show loading row
    tbody.innerHTML = `
        <tr>
            <td colspan="9">Loading history...</td>
        </tr>
    `;

    try {

        const data = await apiFetch(
            `/api/lead-review-history?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
        );

        leHistoryAll = data.history || [];
        document.getElementById("leHistorySearch").value = "";
        populateHistoryTable(leHistoryAll);

    } catch (err) {
        console.error(err);

        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="color:#f87171;">
                    Failed to load history.
                </td>
            </tr>
        `;
    }
}

function populateHistoryTable(history) {

    const tbody = document.getElementById("historyTableBody");
    tbody.innerHTML = "";

    if (!history || history.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="opacity:0.7;">
                    No approved or rejected tags yet.
                </td>
            </tr>
        `;
        return;
    }

    history.forEach((item, index) => {

        const row = document.createElement("tr");

        const statusClass = item.resolution_status === "APPROVED"
            ? "color:#4ade80; font-weight:600;"
            : item.resolution_status === "REJECTED"
                ? "color:#f87171; font-weight:600;"
                : "";

        const tagDate = item.tag_date
            ? item.tag_date.toString().split("T")[0]
            : "-";

        const modelName = item.model_file || "-";
        const zone      = item.zone || "-";
        const desc      = item.description || "-";
        const resolution = item.resolution || "-";

        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${item.tag_no || ""}</td>
            <td style="max-width:200px;white-space:normal;">${desc}</td>
            <td>${zone}</td>
            <td>${modelName}</td>
            <td>${tagDate}</td>
            <td style="max-width:200px;white-space:normal;">${resolution}</td>
            <td style="${statusClass}">${item.resolution_status || ""}</td>
            <td>
                <button class="mrcs-btn hist-go-btn"
                    data-tagid="${item.id}"
                    style="padding:3px 10px;font-size:11px;">
                    Go
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });

    // Event delegation for Go buttons
    tbody.querySelectorAll(".hist-go-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const tagId = parseInt(btn.dataset.tagid, 10);
            const idx = leadTags.findIndex(t => t.id === tagId);
            if (idx !== -1) {
                leadCurrentIndex = idx;
                renderCurrentLeadTag();
                window.scrollTo({ top: 0, behavior: "smooth" });
            } else {
                alert("This tag is not in the current filtered list. Clear filters and try again.");
            }
        });
    });
}

document.getElementById("leHistorySearch").addEventListener("input", function () {
    const q = this.value.trim().toLowerCase();
    if (!q) {
        populateHistoryTable(leHistoryAll);
        return;
    }
    const filtered = leHistoryAll.filter(item =>
        (item.tag_no        || "").toLowerCase().includes(q) ||
        (item.description   || "").toLowerCase().includes(q) ||
        (item.zone          || "").toLowerCase().includes(q) ||
        (item.model_file    || "").toLowerCase().includes(q) ||
        (item.resolution    || "").toLowerCase().includes(q) ||
        (item.resolution_status || "").toLowerCase().includes(q)
    );
    populateHistoryTable(filtered);
});

async function loadSummary() {

    const jobNo = document.getElementById("leadJobNo").value.trim().toUpperCase();
    const unitNo = document.getElementById("leadUnitNo").value.trim().toUpperCase();
    const stage = document.getElementById("leadStage").value;

    if (!jobNo || !unitNo || !stage) return;

    try {

        const data = await apiFetch(
            `/api/lead-review-summary?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
        );

        document.getElementById("sumTotal").innerText = data.total || 0;
        document.getElementById("sumPending").innerText = data.pending_approval || 0;
        document.getElementById("sumApproved").innerText = data.approved || 0;
        document.getElementById("sumRejected").innerText = data.rejected || 0;
        document.getElementById("sumDraft").innerText = data.draft || 0;
        document.getElementById("sumNotStarted").innerText = data.not_started || 0;

    } catch (err) {
        console.error(err);
    }
}

function refreshLeadDashboard() {
    loadSummary();

    if (historyBody.style.display === "block") {
        loadHistory();
    }
}

document.getElementById("leadJobNo")
    .addEventListener("blur", refreshLeadDashboard);

document.getElementById("leadUnitNo")
    .addEventListener("blur", refreshLeadDashboard);

document.getElementById("leadStage")
    .addEventListener("change", refreshLeadDashboard);

document.addEventListener("DOMContentLoaded", () => {

    const jobNo = document.getElementById("leadJobNo").value.trim().toUpperCase();
    const unitNo = document.getElementById("leadUnitNo").value.trim().toUpperCase();
    const stage = document.getElementById("leadStage").value;

    if (jobNo && unitNo && stage) {
        loadSummary();
    }
});
async function refreshLeadCurrentTag() {

    if (leadTags.length === 0) return;

    const currentTagId = leadTags[leadCurrentIndex].id;

    const jobNo = document.getElementById("leadJobNo").value.trim().toUpperCase();
    const unitNo = document.getElementById("leadUnitNo").value.trim().toUpperCase();
    const stage = document.getElementById("leadStage").value;

    try {

        const data = await apiFetch(
            `/api/lead-review-tags?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
        );

        leadAllTags = data.tags || [];

        applyLeadFilters();

        

        const newIndex = leadTags.findIndex(t => t.id === currentTagId);
        leadCurrentIndex = newIndex !== -1 ? newIndex : 0;

        renderCurrentLeadTag();

    } catch (err) {
        console.error(err);
        alert("Failed to refresh tag.");
    }
}