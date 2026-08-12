// Review Info Modal — merged initiation details + document library
// Works for both JE page (jobNoInput/unitNoInput/stageSelect) and LE page (leadJobNo/leadUnitNo/leadStage)

function getReviewModalIds() {
  const jobNo  = (document.getElementById('jobNoInput')  || document.getElementById('leadJobNo'))?.value.trim()  || '';
  const unitNo = (document.getElementById('unitNoInput') || document.getElementById('leadUnitNo'))?.value.trim() || '';
  const stage  = (document.getElementById('stageSelect') || document.getElementById('leadStage'))?.value          || '';
  return { jobNo, unitNo, stage };
}

function getLoadedTagsCount() {
  if (typeof leadAllTags !== 'undefined') return leadAllTags.length;
  if (typeof jeAllTags   !== 'undefined') return jeAllTags.length;
  return 0;
}

document.addEventListener('DOMContentLoaded', function () {
  const backdrop = document.getElementById('ri-backdrop');
  const closeBtn = document.getElementById('ri-close');

  if (!backdrop) return;

  // Support both JE button (showInfoBtn) and LE button (leShowInfoBtn)
  const openBtn = document.getElementById('showInfoBtn') || document.getElementById('leShowInfoBtn');

  function openModal() {
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    loadReviewInfo();
  }

  function closeModal() {
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    if (openBtn) openBtn.focus();
  }

  if (openBtn) openBtn.addEventListener('click', e => { e.preventDefault(); openModal(); });
  if (closeBtn) closeBtn.addEventListener('click', e => { e.preventDefault(); closeModal(); });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });
});

async function loadReviewInfo() {
  const { jobNo, unitNo, stage } = getReviewModalIds();
  loadInitiationDetail(jobNo, unitNo, stage);
  loadDocLibForModal(jobNo, unitNo, stage);
}

async function loadInitiationDetail(jobNo, unitNo, stage) {
  const fromEl  = document.getElementById('ri-date-from');
  const toEl    = document.getElementById('ri-date-to');
  const stageEl = document.getElementById('ri-stage');
  const descEl  = document.getElementById('ri-description');

  const typeEl  = document.getElementById('ri-type');

  fromEl.value  = '—';
  toEl.value    = '—';
  stageEl.value = stage || '—';
  descEl.value  = '';
  if (typeEl) typeEl.value = '—';

  if (!jobNo || !unitNo || !stage) return;

  try {
    const data = await apiFetch(
      `/api/initiation/detail?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}&stage=${encodeURIComponent(stage)}`
    );
    const r = data.initiation;
    fromEl.value  = r.review_date_from ? r.review_date_from.split('T')[0] : '—';
    toEl.value    = r.review_date_to   ? r.review_date_to.split('T')[0]   : '—';
    stageEl.value = r.stage || stage;
    descEl.value  = r.description || '';
    if (typeEl) typeEl.value = r.review_type || 'INTERNAL';
  } catch (err) {
    fromEl.value = '—';
    toEl.value   = '—';
  }
}

async function loadDocLibForModal(jobNo, unitNo, stage) {
  const body = document.getElementById('ri-dl-body');
  if (!body) return;

  if (getLoadedTagsCount() === 0) {
    body.innerHTML = '<div class="ri-empty">No tags loaded. Load tags first.</div>';
    return;
  }

  if (!jobNo || !unitNo || !stage) {
    body.innerHTML = '<div class="ri-empty">Select a review first.</div>';
    return;
  }

  body.innerHTML = '<div class="ri-empty">Loading...</div>';

  try {
    const data = await apiFetch(`/api/folders?jobNo=${jobNo}&unitNo=${unitNo}&stage=${encodeURIComponent(stage)}`);
    const folders = data.folders || [];

    if (folders.length === 0) {
      body.innerHTML = '<div class="ri-empty">No uploaded NWD files found.</div>';
      return;
    }

    body.innerHTML = '';
    folders.forEach((folder, i) => {
      const nwdFile    = folder.model_file || folder.folder_name || '—';
      const uploadDate = formatLibDate(folder.uploaded_at);
      const reviewDate = formatLibDate(folder.model_review_date);
      const tagCount   = folder.tag_count || 0;
      const uploadedBy = folder.uploaded_by_name || '—';

      let downloadHtml = `<span>${nwdFile}</span>`;
      if (folder.job_no && folder.unit_no && folder.review_stage && folder.model_file) {
        const url = encodeURI(`/uploads/permanent/${folder.job_no}/${folder.unit_no}/${folder.review_stage}/${folder.id}/${folder.model_file}`);
        downloadHtml = `<a class="ri-nwd-link" href="${url}" download="${folder.model_file}" title="Download ${folder.model_file}">${nwdFile}</a>`;
      }

      const row = document.createElement('div');
      row.className = 'ri-dl-row';
      row.innerHTML = `
        <div>${i + 1}</div>
        <div>${downloadHtml}</div>
        <div>${reviewDate}</div>
        <div>${uploadDate}</div>
        <div>${tagCount}</div>
        <div>${uploadedBy}</div>
      `;
      body.appendChild(row);
    });
  } catch (err) {
    body.innerHTML = `<div class="ri-empty">Failed to load: ${err.message}</div>`;
  }
}

function formatLibDate(raw) {
  if (!raw) return '—';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '—';
  return String(d.getDate()).padStart(2, '0') + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         d.getFullYear();
}


// ===== TAG POINTS TOGGLE =====
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('tagToggleBtn');
  const content   = document.getElementById('tagpointsContent');
  const card      = document.querySelector('.tagpoints-card');

  if (!toggleBtn || !content) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = content.classList.contains('open');
    if (isOpen) {
      content.classList.remove('open');
      content.classList.add('collapsed');
      card.classList.add('collapsed');
      toggleBtn.textContent = '+';
    } else {
      content.classList.add('open');
      content.classList.remove('collapsed');
      card.classList.remove('collapsed');
      toggleBtn.textContent = '−';
    }
  });
});

// ===== TAG POINTS SEARCH =====
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('tagSearchInput');
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    const rows  = document.querySelectorAll('.tagpoints-row:not(.tagpoints-header)');
    rows.forEach(row => {
      row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none';
    });
  });
});
