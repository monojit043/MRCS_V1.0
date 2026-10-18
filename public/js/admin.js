document.addEventListener("DOMContentLoaded", () => {

    // ── MOM ────────────────────────────────────────────────────
    let momRowCount = 0;
    const momTableBody = document.getElementById('momTableBody');
    const momEmptyMsg  = document.getElementById('momEmptyMsg');

    function momClearTable() {
        momTableBody.innerHTML = '';
        momRowCount = 0;
        momEmptyMsg.style.display = '';
    }

    function momAddRow(desc, close) {
        momRowCount++;
        momEmptyMsg.style.display = 'none';
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td class="mom-sl">' + momRowCount + '</td>' +
            '<td contenteditable="true" class="mom-cell mom-desc"></td>' +
            '<td contenteditable="true" class="mom-cell mom-close"></td>' +
            '<td class="mom-action-col"><button class="mom-del-btn" title="Delete">&#10005;</button></td>';
        momTableBody.appendChild(tr);
        if (desc  !== undefined) tr.querySelector('.mom-desc').innerText  = desc;
        if (close !== undefined) tr.querySelector('.mom-close').innerText = close;
        return tr;
    }

    document.getElementById('momAddRowBtn').addEventListener('click', function () {
        const jobNo = document.getElementById('momJobNo').value;
        if (!jobNo) { alert('Please select a review first.'); return; }
        const tr = momAddRow('', '');
        tr.querySelector('.mom-desc').focus();
    });

    momTableBody.addEventListener('click', function (e) {
        const btn = e.target.closest('.mom-del-btn');
        if (!btn) return;
        btn.closest('tr').remove();
        momTableBody.querySelectorAll('tr').forEach(function (row, i) {
            row.querySelector('.mom-sl').textContent = i + 1;
        });
        momRowCount = momTableBody.children.length;
        if (momRowCount === 0) momEmptyMsg.style.display = '';
    });

    document.getElementById('momSaveBtn').addEventListener('click', async function () {
        const jobNo = document.getElementById('momJobNo').value;
        const unitNo = document.getElementById('momUnitNo').value;
        const stage  = document.getElementById('momStage').value;
        if (!jobNo || !unitNo || !stage) { alert('Please select a review first.'); return; }

        const points = [];
        momTableBody.querySelectorAll('tr').forEach(function (row) {
            points.push({
                description:     row.querySelector('.mom-desc').innerText.trim(),
                to_be_closed_by: row.querySelector('.mom-close').innerText.trim()
            });
        });

        try {
            const res = await apiFetch('/api/mom/save', {
                method: 'POST',
                body: JSON.stringify({ jobNo, unitNo, stage, points })
            });
            if (res.success) {
                alert('MOM saved successfully.');
            } else {
                alert(res.message || 'Save failed.');
            }
        } catch (err) {
            console.error(err);
            alert('Server error while saving.');
        }
    });

    document.getElementById('momPrintBtn').addEventListener('click', function () {
        const rows = momTableBody.querySelectorAll('tr');
        if (rows.length === 0) { alert('No items to print.'); return; }

        const jobNo = document.getElementById('momJobNo').value || '';
        const unitNo = document.getElementById('momUnitNo').value || '';
        const stage  = document.getElementById('momStage').value || '';
        const header = jobNo ? (jobNo + ' / ' + unitNo + ' — ' + stage) : '';

        let rowsHTML = '';
        rows.forEach(function (row, i) {
            const desc  = row.querySelector('.mom-desc').innerText.trim();
            const close = row.querySelector('.mom-close').innerText.trim();
            rowsHTML +=
                '<tr><td style="width:60px;text-align:center;">' + (i + 1) + '</td>' +
                '<td>' + desc + '</td>' +
                '<td style="width:200px;">' + close + '</td></tr>';
        });

        const html =
            '<!DOCTYPE html><html><head><title>MOM</title><style>' +
            'body{font-family:Arial,sans-serif;padding:36px;color:#000;}' +
            'h2{font-size:17px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}' +
            '.sub{font-size:12px;color:#555;margin-bottom:20px;}' +
            'table{width:100%;border-collapse:collapse;}' +
            'th,td{border:1px solid #aaa;padding:10px 14px;font-size:13px;text-align:left;}' +
            'th{background:#f0f4f8;font-weight:700;}' +
            '</style></head><body>' +
            '<h2>Minutes of Meeting</h2>' +
            (header ? '<div class="sub">' + header + '</div>' : '') +
            '<table><thead><tr><th>Sl No</th><th>Description of Point</th><th>To be closed by</th></tr></thead>' +
            '<tbody>' + rowsHTML + '</tbody></table>' +
            '<scr' + 'ipt>window.onload=function(){window.print();window.close();}<\/script>' +
            '</body></html>';

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
    });

    // Load MOM when review is selected
    async function loadMOM(jobNo, unitNo, stage) {
        momClearTable();
        if (!jobNo || !unitNo || !stage) return;
        try {
            const data = await apiFetch(
                '/api/mom?jobNo=' + encodeURIComponent(jobNo) +
                '&unitNo=' + encodeURIComponent(unitNo) +
                '&stage='  + encodeURIComponent(stage)
            );
            (data.points || []).forEach(function (p) {
                momAddRow(p.description, p.to_be_closed_by);
            });
            if ((data.points || []).length === 0) momEmptyMsg.style.display = '';
        } catch (err) {
            console.error('MOM load error:', err);
        }
    }

    initReviewPicker('momReviewPicker', function (jobNo, unitNo, stage) {
        document.getElementById('momJobNo').value  = jobNo;
        document.getElementById('momUnitNo').value = unitNo;
        document.getElementById('momStage').value  = stage;
        loadMOM(jobNo, unitNo, stage);
    });

    // ── Hash-based panel switching ──────────────────────────────
    const ADMIN_PANELS = ['panelMOM', 'panelPrereq', 'panelTags', 'panelUsers'];
    const HASH_TO_PANEL = {
        '#mom':    'panelMOM',
        '#prereq': 'panelPrereq',
        '#tags':   'panelTags',
        '#users':  'panelUsers',
    };

    function getAdminPanel() {
        const dept  = (localStorage.getItem('department') || '').toLowerCase();
        const isPEM = dept === 'pem';
        const panelId = HASH_TO_PANEL[window.location.hash] || 'panelMOM';
        if (!isPEM && panelId === 'panelPrereq') return 'panelMOM';
        if (isPEM  && panelId === 'panelUsers')  return 'panelMOM';
        return panelId;
    }

    function showAdminPanel(panelId) {
        ADMIN_PANELS.forEach(id => {
            document.getElementById(id).style.display = (id === panelId) ? '' : 'none';
        });
        if (panelId === 'panelUsers') loadUsers();
    }

    showAdminPanel(getAdminPanel());
    window.addEventListener('hashchange', () => showAdminPanel(getAdminPanel()));

    // ── Attendance modal ────────────────────────────────────────
    const attendanceModal = document.getElementById('attendanceModal');
    const generateBtn     = document.getElementById("generateQRBtn");
    const qrContainer     = document.getElementById("qrContainer");
    const qrTimer         = document.getElementById("qrTimer");
    const attendanceList  = document.getElementById("attendanceList");
    const attendanceCount = document.getElementById("attendanceCount");

    let liveInterval = null;
    let currentJob   = null;
    let currentUnit  = null;
    let renewInterval = null;
    let qrInterval   = null;

    document.getElementById('openAttendanceBtn').addEventListener('click', async () => {
        attendanceModal.classList.add('active');
        await loadValidSessions();
    });

    attendanceModal.addEventListener('click', (e) => {
        if (e.target === attendanceModal) {
            attendanceModal.classList.remove('active');
            if (liveInterval)  clearInterval(liveInterval);
            if (qrInterval)    clearInterval(qrInterval);
            if (renewInterval) clearTimeout(renewInterval);
        }
    });


    // Generate QR
    generateBtn.addEventListener("click", async () => {

        const job_no = document.getElementById("attendanceJob").value.trim();
        const unit_no = document.getElementById("attendanceUnit").value.trim();

        if (!job_no || !unit_no) {
            alert("Enter job and unit");
            return;
        }

        try {
            const res = await fetch("/api/attendance/generate-qr", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job_no, unit_no })
            });

            const data = await res.json();

            if (!data.success) {
                alert(data.message);
                return;
            }

            renderQR(data.qr_token);
            startTimer(data.expires_at);
            currentJob = job_no;
            currentUnit = unit_no;

            startLiveAttendance();


        } catch (err) {
            console.error(err);
            alert("Server error");
        }
    });

    async function renderQR(token) {
        qrContainer.innerHTML = "";
        let baseURL = window.location.origin;
        try {
            const info = await fetch("/api/server-info").then(r => r.json());
            baseURL = `http://${info.ip}:${info.port}`;
        } catch (_) {}
        const scanURL = `${baseURL}/scan.html?token=${token}`;

        QRCode.toCanvas(scanURL, { width: 220 }, function (error, canvas) {
            if (error) console.error(error);
            qrContainer.appendChild(canvas);
        });
    }

    function startTimer(expiryTime) {

        if (qrInterval) clearInterval(qrInterval);
        if (renewInterval) clearInterval(renewInterval);

        function updateTimer() {
            const now = new Date().getTime();
            const expiry = new Date(expiryTime).getTime();
            const diff = expiry - now;

            if (diff <= 0) {
                qrTimer.innerText = "Renewing QR...";
                return;
            }

            const seconds = Math.floor(diff / 1000);
            qrTimer.innerText = "Expires in: " + seconds + " seconds";
        }

        updateTimer();
        qrInterval = setInterval(updateTimer, 1000);

        // Auto renew at 2.5 minutes
        renewInterval = setTimeout(async () => {

            if (!currentJob || !currentUnit) return;

            try {
                const res = await fetch("/api/attendance/generate-qr", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        job_no: currentJob,
                        unit_no: currentUnit
                    })
                });

                const data = await res.json();

                if (data.success) {
                    renderQR(data.qr_token);
                    startTimer(data.expires_at);
                }

            } catch (err) {
                console.error("Auto renew error:", err);
            }

        }, 150000); // 2.5 minutes
    }

    function startLiveAttendance() {

        if (liveInterval) clearInterval(liveInterval);

        async function fetchLive() {

            if (!currentJob || !currentUnit) return;

            try {
                const res = await fetch(`/api/attendance/live-attendance?job_no=${currentJob}&unit_no=${currentUnit}`);
                const data = await res.json();

                if (!data.success) return;

                attendanceCount.innerText = data.count;

                attendanceList.innerHTML = "";

                data.records.forEach(rec => {
                    const row = document.createElement("div");
                    row.classList.add("attendance-row");

                    const time = new Date(rec.scan_time).toLocaleTimeString();

                    const fields = [
                        rec.name,
                        rec.phone_number,
                        rec.designation || "",
                        rec.company_name || "",
                        time
                    ];

                    fields.forEach(value => {
                        const cell = document.createElement("div");
                        cell.textContent = value;
                        row.appendChild(cell);
                    });

                    attendanceList.appendChild(row);
                });



            } catch (err) {
                console.error("Live fetch error:", err);
            }
        }

        fetchLive();
        liveInterval = setInterval(fetchLive, 5000);
    }

    document.getElementById("addEmployeeBtn").addEventListener("click", async () => {

        const loggedDept = (localStorage.getItem("department") || "").toLowerCase();
        const isPEM = loggedDept === "pem";

        document.getElementById("addEmployeeForm").style.display = "block";

        const employees = await apiFetch("/api/admin/employees");

        const select = document.getElementById("employeeSelect");
        select.innerHTML = `<option value="">Select Employee</option>`;

        employees.forEach(emp => {
            select.innerHTML += `
                <option value="${emp.employee_id}">
                    ${emp.name} (${emp.employee_id})
                </option>
            `;
        });

        // Every department staffs itself (PEM included): own department only.
        // GL is never assigned here — it comes from PIMS or employee level.
        // GL on the review may assign LE or JE; LE may assign JE (server enforces).
        document.getElementById("departmentField").value = loggedDept;
        document.getElementById("roleSelect").innerHTML = `
            <option value="JE">Job Engineer (JE)</option>
            <option value="LE">Lead Engineer (LE) — GL only</option>`;

        // Load review picker
        initReviewPicker("addUserReviewPicker", (jobNo, unitNo, stage) => {
            document.getElementById("jobNoInput").value = jobNo;
            document.getElementById("unitNoInput").value = unitNo;
            document.getElementById("addUserStage").value = stage;
        });
    });

    document.getElementById("saveUserBtn").addEventListener("click", async function () {

        const employeeId = document.getElementById("employeeSelect").value;
        const role = document.getElementById("roleSelect").value;
        const department = document.getElementById("departmentField").value;
        const jobNo = document.getElementById("jobNoInput").value;
        const unitNo = document.getElementById("unitNoInput").value;
        const stage = document.getElementById("addUserStage").value;

        if (!employeeId || !role || !jobNo || !unitNo || !stage) {
            alert("Please select an employee, role and model review");
            return;
        }

        const result = await apiFetch("/api/admin/add-user", {
            method: "POST",
            body: JSON.stringify({
                employeeId,
                role,
                department,
                jobNo,
                unitNo,
                stage
            })
        });


        alert(result.message);

        loadUsers();

        document.getElementById("addEmployeeForm").style.display = "none";
    });

    document.getElementById("cancelAddBtn").addEventListener("click", function () {
        document.getElementById("addEmployeeForm").style.display = "none";
    });

    document.getElementById("employeeSelect").addEventListener("change", async function () {

        const empId = this.value;

        if (!empId) return;

        const data = await apiFetch(`/api/admin/employee/${empId}`);

        document.getElementById("departmentField").value = data.department;
    });

    // Prerequisites — load review summary button
    const reviewLoadBtn = document.getElementById("glLoadReviewSummaryBtn");
    if (reviewLoadBtn) reviewLoadBtn.addEventListener("click", loadReviewSummary);

    async function loadUsers() {
        const users = await apiFetch("/api/admin/list-users");

        const table = document.getElementById("employeeTable");

        table.querySelectorAll(".employee-data-row").forEach(row => row.remove());

        users.forEach((user, index) => {

            const row = document.createElement("div");
            row.classList.add("employee-row", "employee-data-row");

            row.innerHTML = `
                <div>${index + 1}</div>
                <div>${user.employee_id}</div>
                <div>${user.full_name || ""}</div>
                <div>${user.role}</div>
                <div>${user.department}</div>
                <div>${user.job_no || ""}</div>
                <div>${user.unit_no || ""}</div>
            `;

            table.appendChild(row);
        });
    }

    async function loadValidSessions() {

        try {
            const res = await fetch("/api/attendance/valid-sessions");
            const data = await res.json();

            if (!data.success) return;

            console.log("Sessions:", data.sessions);

            const jobSelect = document.getElementById("attendanceJob");
            const unitSelect = document.getElementById("attendanceUnit");

            // Clear dropdowns and add default option
            jobSelect.innerHTML = "<option value=''>Select Job</option>";
            unitSelect.innerHTML = "<option value=''>Select Unit</option>";

            if (!data.sessions || data.sessions.length === 0) {
                console.warn("No valid sessions found");
                return;
            }

            // Unique job numbers
            const jobs = [...new Set(data.sessions.map(s => s.job_no))];

            jobs.forEach(job => {
                const option = document.createElement("option");
                option.value = job;
                option.textContent = job;
                jobSelect.appendChild(option);
            });

            // Remove old change listeners (important if modal opens multiple times)
            jobSelect.onchange = null;

            jobSelect.addEventListener("change", () => {

                const selectedJob = jobSelect.value;

                unitSelect.innerHTML = "<option value=''>Select Unit</option>";

                if (!selectedJob) return;

                const units = data.sessions
                    .filter(s => s.job_no === selectedJob)
                    .map(s => s.unit_no);

                units.forEach(unit => {
                    const option = document.createElement("option");
                    option.value = unit;
                    option.textContent = unit;
                    unitSelect.appendChild(option);
                });
            });
            if (jobs.length > 0) {
                jobSelect.value = jobs[0];
                jobSelect.dispatchEvent(new Event("change"));
            }


        } catch (err) {
            console.error("Load sessions error:", err);
        }
    }

    // Report Modal////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////


    const modal = document.getElementById("reportModal");
    const openBtn = document.getElementById("openReportModalBtn");
    const closeBtn = document.getElementById("closeReportModalBtn");
    const downloadBtn = document.getElementById("downloadReportBtn");

    openBtn.addEventListener("click", () => {
        modal.style.display = "flex";
        loadJobs();
    });

    closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
    });

    downloadBtn.addEventListener("click", () => {
        generateReport();
    });

    async function loadJobs() {

        const response = await fetch("/api/report/report-options");
        const data = await response.json();

        const jobSelect = document.getElementById("jobSelect");
        const unitSelect = document.getElementById("unitSelect");
        const stageSelect = document.getElementById("stageSelect");

        jobSelect.innerHTML = "";
        unitSelect.innerHTML = "";
        stageSelect.innerHTML = "";

        const jobs = [...new Set(data.map(d => d.job_no))];

        jobs.forEach(job => {
            const option = document.createElement("option");
            option.value = job;
            option.textContent = job;
            jobSelect.appendChild(option);
        });

        // 🔥 IMPORTANT: Immediately load units for first job
        if (jobs.length > 0) {
            loadUnits(data, jobs[0]);
        }

        jobSelect.addEventListener("change", () => {
            loadUnits(data, jobSelect.value);
        });
    }

    function loadUnits(data, selectedJob) {

        const unitSelect = document.getElementById("unitSelect");
        const stageSelect = document.getElementById("stageSelect");

        unitSelect.innerHTML = "";
        stageSelect.innerHTML = "";

        const units = [...new Set(
            data.filter(d => d.job_no === selectedJob)
                .map(d => d.unit_no)
        )];

        units.forEach(unit => {
            const option = document.createElement("option");
            option.value = unit;
            option.textContent = unit;
            unitSelect.appendChild(option);
        });

        // 🔥 Immediately load stages for first unit
        if (units.length > 0) {
            loadStages(data, selectedJob, units[0]);
        }

        unitSelect.addEventListener("change", () => {
            loadStages(data, selectedJob, unitSelect.value);
        });
    }

    function loadStages(data, job, unit) {

        const stageSelect = document.getElementById("stageSelect");
        stageSelect.innerHTML = "";

        const stages = data
            .filter(d => d.job_no === job && d.unit_no === unit)
            .map(d => d.review_stage);

        stages.forEach(stage => {
            const option = document.createElement("option");
            option.value = stage;
            option.textContent = stage;
            stageSelect.appendChild(option);
        });
    }

    function generateReport() {

        const job = document.getElementById("jobSelect").value;
        const unit = document.getElementById("unitSelect").value;
        const stage = document.getElementById("stageSelect").value;

        if (!job || !unit || !stage) {
            alert("Please select all fields.");
            return;
        }

        window.open(
            `/api/report/generate-pdf?job=${job}&unit=${unit}&stage=${encodeURIComponent(stage)}`,
            "_blank"
        );
    }

    const glBtn = document.getElementById("glLoadSummaryBtn");

    if (glBtn) {
        glBtn.addEventListener("click", loadGLSummary);
    }

    async function loadGLSummary() {

        const jobNo = document.getElementById("glJobNo").value.trim().toUpperCase();
        const unitNo = document.getElementById("glUnitNo").value.trim().toUpperCase();
        const stage = document.getElementById("glStage").value;

        if (!jobNo || !unitNo || !stage) {
            alert("Please fill all fields.");
            return;
        }

        try {

            const data = await apiFetch(
                `/api/admin/tags-summary?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
            );

            populateGLSummary(data.summary || []);

            if (data.allocation) {
                document.getElementById("glAllocatedTags").innerText = data.allocation.allocated_tags || 0;
                document.getElementById("glNotAllocatedTags").innerText = data.allocation.not_allocated_tags || 0;
            }

            // 🔥 NEW → show overall tag status summary
            if (data.overall) {
                document.getElementById("glTotalTags").innerText = data.overall.total_tags || 0;
                document.getElementById("glCompletedTags").innerText = data.overall.completed_tags || 0;
                document.getElementById("glInProgressTags").innerText = data.overall.in_progress_tags || 0;
                document.getElementById("glNotStartedTags").innerText = data.overall.not_started_tags || 0;
            }

            // 🔥 PROGRESS CALCULATION
            const total = data.overall.total_tags || 0;
            const completed = data.overall.completed_tags || 0;

            let percent = 0;

            if (total > 0) {
                percent = Math.round((completed / total) * 100);
            }

            // Update UI
            const percentEl = document.getElementById("glProgressPercent");
            const fillEl = document.getElementById("glProgressFill");

            if (percentEl) percentEl.innerText = percent + "%";
            if (fillEl) fillEl.style.width = percent + "%";

            if (fillEl) {
                if (percent < 40) fillEl.style.background = "#ef4444"; // red
                else if (percent < 80) fillEl.style.background = "#facc15"; // yellow
                else fillEl.style.background = "#22c55e"; // green
            }

        } catch (err) {
            console.error(err);
            alert("Failed to load summary.");
        }
    }

    function populateGLSummary(summary) {

        const tbody = document.getElementById("glSummaryBody");
        tbody.innerHTML = "";

        if (summary.length === 0) {
            tbody.innerHTML =
                `<tr><td colspan="10">No data found.</td></tr>`;
            return;
        }

        summary.forEach(row => {

            const tr = document.createElement("tr");

            tr.innerHTML = `
            <td>${row.department}</td>
            <td>${row.total}</td>
            <td class="status-gray">${row.not_started}</td>
            <td class="status-yellow">${row.draft}</td>
            <td class="status-blue">${row.pending_approval}</td>
            <td class="status-green">${row.approved}</td>
            <td class="status-red">${row.rejected}</td>
        `;

            tbody.appendChild(tr);
        });
    }

    async function loadTagsSummary() {

        const jobNo = document.getElementById("adminJobNo").value.trim().toUpperCase();
        const unitNo = document.getElementById("adminUnitNo").value.trim().toUpperCase();
        const stage = document.getElementById("adminStage").value;

        if (!jobNo || !unitNo || !stage) {
            alert("Please fill all fields");
            return;
        }

        try {

            const data = await apiFetch(
                `/api/admin/tags-summary?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
            );

            const tbody = document.getElementById("tagsSummaryBody");
            tbody.innerHTML = "";

            if (!data.summary.length) {
                tbody.innerHTML = `
            <tr>
              <td colspan="7">No tags found.</td>
            </tr>
          `;
                return;
            }

            data.summary.forEach(row => {

                const tr = document.createElement("tr");

                tr.innerHTML = `
            <td>${row.department}</td>
            <td>${row.total}</td>
            <td>${row.not_started}</td>
            <td>${row.draft}</td>
            <td>${row.pending_approval}</td>
            <td>${row.approved}</td>
            <td>${row.rejected}</td>
          `;

                tbody.appendChild(tr);
            });

        } catch (err) {
            console.error(err);
            alert("Failed to load summary.");
        }
    }

    async function loadReviewSummary() {

        const jobNo = document.getElementById("reviewJobNoInput").value.trim().toUpperCase();
        const unitNo = document.getElementById("reviewUnitNoInput").value.trim().toUpperCase();
        const stage = document.getElementById("reviewStageSelect").value;

        if (!jobNo || !unitNo || !stage) {
            alert("Please enter Job No, Unit No and Stage");
            return;
        }

        // 1. Existing department review status summary
        const summaryData = await apiFetch(
            `/api/admin/review-summary?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
        );
        populateReviewSummary(summaryData.departments);

        // 2. Initiation details + full prerequisite list
        try {
            const detailData = await apiFetch(
                `/api/admin/prerequisite-detail?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`
            );
            renderInitiationDetail(detailData.initiation);
            renderPrereqDetail(detailData.prerequisites);
        } catch (err) {
            console.error("Failed to load prerequisite detail:", err);
        }
    }

    function renderInitiationDetail(initiation) {
        const card = document.getElementById("initiationDetailCard");
        if (!initiation) {
            card.style.display = "none";
            return;
        }

        const from = initiation.review_date_from ? initiation.review_date_from.split("T")[0] : "—";
        const to   = initiation.review_date_to   ? initiation.review_date_to.split("T")[0]   : "—";

        document.getElementById("initiationPeriod").textContent = `${from}  →  ${to}`;
        document.getElementById("initiationDesc").textContent    = initiation.description || "—";
        card.style.display = "block";
    }

    function renderPrereqDetail(prerequisites) {
        const section = document.getElementById("prereqDetailSection");
        const tbody   = document.getElementById("prereqDetailBody");
        tbody.innerHTML = "";

        if (!prerequisites || prerequisites.length === 0) {
            section.style.display = "none";
            return;
        }

        prerequisites.forEach(p => {
            const tr = document.createElement("tr");

            let statusHtml;
            if (p.is_accepted === null || p.is_accepted === undefined) {
                statusHtml = `<span style="color:var(--col-muted);">Pending</span>`;
            } else if (p.is_accepted) {
                statusHtml = `<span style="color:#4ade80;font-weight:600;">Accepted</span>`;
            } else {
                statusHtml = `<span style="color:#f87171;font-weight:600;">Not Accepted</span>`;
            }

            tr.innerHTML = `
                <td>${p.department}</td>
                <td>${p.prerequisite_text}</td>
                <td>${statusHtml}</td>
                <td style="color:var(--col-muted);font-size:13px;">${p.exception_reason || "—"}</td>
            `;
            tbody.appendChild(tr);
        });

        section.style.display = "block";
    }

    document
        .getElementById("glLoadReviewSummaryBtn")
        .addEventListener("click", loadReviewSummary);

    function populateReviewSummary(departments) {

        const tbody = document.getElementById("reviewSummaryBody");
        tbody.innerHTML = "";

        if (!departments || departments.length === 0) {
            tbody.innerHTML = `<div class="employee-row review-summary-row" style="opacity:0.6;padding:10px 0;">
                <div>No review preparation started.</div>
            </div>`;
            return;
        }

        departments.forEach(dep => {

            const row = document.createElement("div");
            row.classList.add("employee-row", "review-summary-row");

            const notAccepted = dep.prereq_not_accepted || 0;
            const pending     = dep.prereq_pending      || 0;

            const submittedAt = dep.submitted_at
                ? new Date(dep.submitted_at).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
                : "-";

            row.innerHTML = `
                <div>${dep.department}</div>
                <div>${dep.status || "-"}</div>
                <div>${submittedAt}</div>
                <div style="color:${pending > 0 ? "#facc15" : "inherit"}">${pending}</div>
                <div>${dep.prereq_total || 0}</div>
                <div style="color:#4ade80">${dep.prereq_accepted || 0}</div>
                <div style="color:${notAccepted > 0 ? "#f87171" : "inherit"}">${notAccepted}</div>
            `;

            tbody.appendChild(row);
        });
    }

    document.querySelector('[data-module="review-status"]')
        .addEventListener("click", () => {
            dashboardView.style.display = "none";
            reviewSummarySection.style.display = "block";
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

    document
        .getElementById("backToDashboardFromReview")
        .addEventListener("click", () => {
            reviewSummarySection.style.display = "none";
            dashboardView.style.display = "grid";
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

    // Review picker for Tags Status section
    initReviewPicker("glReviewPicker", (jobNo, unitNo, stage) => {
        document.getElementById("glJobNo").value = jobNo;
        document.getElementById("glUnitNo").value = unitNo;
        document.getElementById("glStage").value = stage;
    });

    // Review picker for Prerequisites section
    initReviewPicker("reviewReviewPicker", (jobNo, unitNo, stage) => {
        document.getElementById("reviewJobNoInput").value = jobNo;
        document.getElementById("reviewUnitNoInput").value = unitNo;
        document.getElementById("reviewStageSelect").value = stage;
    });

});

