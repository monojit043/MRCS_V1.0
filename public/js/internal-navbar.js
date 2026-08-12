/* ============================================================
   MRCS — Internal Review Navbar / Sidebar
   Injected synchronously at end of <body> on all internal pages.
   ============================================================ */
(function () {

  /* ── SVG icons ── */
  var I = {
    menu:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    dashboard: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    je:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    le:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    upload:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>',
    initiation:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    users:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
    bell:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
    search:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    logout:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    chevron:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    admin:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>',
    workflow:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1"/><line x1="5.5" y1="8" x2="5.5" y2="12"/><line x1="18.5" y1="8" x2="18.5" y2="12"/><line x1="5.5" y1="12" x2="12" y2="12"/><line x1="18.5" y1="12" x2="12" y2="12"/><line x1="12" y1="12" x2="12" y2="16"/></svg>',
    feedback:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  };

  /* ── Current page ── */
  var page = window.location.pathname.replace(/^.*\//, '') || '';

  /* ── User info from localStorage ── */
  var fullName = localStorage.getItem('fullName')   || '';
  var role     = localStorage.getItem('role')       || '';
  var dept     = localStorage.getItem('department') || '';

  var isPiping = dept.toLowerCase() === 'piping';
  var isLE     = role === 'LE' || role === 'GL';
  var isPipingLE = isPiping && isLE;

  var initials = fullName.trim()
    .split(/\s+/)
    .map(function (w) { return w.charAt(0).toUpperCase(); })
    .join('')
    .slice(0, 2) || '?';

  var displayName = fullName || 'User';
  var displayRole = role ? (role + (dept ? ' · ' + dept.toUpperCase() : '')) : '';

  /* ── Sidebar active state ── */
  var PAGE_KEY = {
    'internal-dashboard.html':    'dashboard',
    'internal-jobengineer.html':  'je',
    'internal-leadengineer.html': 'le',
    'internal-upload.html':       'upload',
    'internal-initiation.html':   'initiation',
    'internal-admin.html':        'admin',
  };
  var activeKey = PAGE_KEY[page] || '';

  function sbActive(key) {
    return activeKey === key ? ' sb-nav-item--active' : '';
  }

  /* ── Topbar tabs (page-specific) ── */
  var tabsHtml = '';

  var TAB_DEFS = {
    'internal-dashboard.html':    [{ key: 'dashboard', label: 'Internal Dashboard', icon: I.dashboard }],
    'internal-jobengineer.html':  [{ key: 'je',        label: 'Job Engineer',       icon: I.je        }],
    'internal-leadengineer.html': [
      { key: 'approval', hash: '#approval', label: 'Approve Tags',    icon: I.le        },
    ],
    'internal-upload.html':       [
      { key: 'upload',      hash: '#upload',      label: 'Upload NWD',       icon: I.upload     },
      { key: 'finalization',hash: '#finalization', label: 'Tag Finalization', icon: I.initiation },
    ],
    'internal-initiation.html': [
      { key: 'initiate', hash: '#initiate', label: 'Initiate Review', icon: I.initiation },
    ],
    'internal-admin.html':        [{ key: 'tags',        label: 'Tag Status & CRS',         icon: I.admin      }],
  };

  var pageTabs = TAB_DEFS[page];
  if (pageTabs) {
    var curHash = window.location.hash || '';
    tabsHtml = pageTabs.map(function (t) {
      var isActive = pageTabs.length === 1 || (t.hash ? curHash === t.hash : true);
      var cls = 'tb-tab' + (isActive ? ' tb-tab--active' : '');
      var href = page + (t.hash || '');
      return '<a href="' + href + '" class="' + cls + '" data-tab="' + t.key + '"' + (t.hash ? ' data-hash="' + t.hash + '"' : '') + '>'
        + t.icon + '<span>' + t.label + '</span></a>';
    }).join('');
  }

  /* ── Build TOPBAR ── */
  var topbar =
    '<header class="mrcs-topbar" id="mrcs-topbar">'
    + '<div class="tb-brand">'
    +   '<div class="tb-logo"><img src="assets/eilround.gif" alt="MRCS"></div>'
    +   '<div class="tb-brand-text">'
    +     '<span class="tb-brand-name">MRCS</span>'
    +     '<span class="tb-mode-label" id="tbModeLabel">Internal Operations</span>'
    +   '</div>'
    + '</div>'
    + '<nav class="tb-tabs">' + tabsHtml + '</nav>'
    + '<div class="tb-right">'
    +   '<button class="tb-icon-btn" type="button" title="Search">' + I.search + '</button>'
    +   '<button class="tb-icon-btn" type="button" title="Notifications">' + I.bell + '</button>'
    +   '<div class="tb-user-sep"></div>'
    +   '<div class="tb-user-dropdown" id="tbUserDropdown">'
    +     '<div class="tb-avatar" id="tbAvatar">' + initials + '</div>'
    +     '<div class="tb-user-info">'
    +       '<span class="tb-user-name" id="tbUserName">' + displayName + '</span>'
    +       '<span class="tb-user-role" id="tbUserRole">' + displayRole + '</span>'
    +     '</div>'
    +     '<span class="tb-chevron">' + I.chevron + '</span>'
    +     '<span id="userInfo" style="display:none"></span>'
    +     '<div class="tb-dropdown-menu" id="tbDropdownMenu">'
    +       '<div class="tb-dropdown-user-header">'
    +         '<div class="tb-dropdown-avatar" id="tbDropdownAvatar">' + initials + '</div>'
    +         '<div>'
    +           '<div class="tb-dropdown-name" id="tbDropdownName">' + displayName + '</div>'
    +           '<div class="tb-dropdown-role" id="tbDropdownRole">' + displayRole + '</div>'
    +         '</div>'
    +       '</div>'
    +       '<div class="tb-dropdown-divider"></div>'
    +       '<button class="tb-dropdown-item" id="logoutBtn" type="button">'
    +         I.logout + '<span>Sign Out</span>'
    +       '</button>'
    +     '</div>'
    +   '</div>'
    + '</div>'
    + '</header>';

  /* ── Build SIDEBAR ── */
  var coreNavHtml = ''
    + '<a href="internal-dashboard.html" class="sb-nav-item' + sbActive('dashboard') + '">'
    + I.dashboard + '<span>Internal Dashboard</span></a>'
    + '<a href="internal-jobengineer.html" class="sb-nav-item' + sbActive('je') + '">'
    + I.je + '<span>Job Engineer</span></a>';

  if (isLE) {
    coreNavHtml +=
      '<a href="internal-leadengineer.html" class="sb-nav-item' + sbActive('le') + '">'
      + I.le + '<span>Lead Engineer</span></a>';
  }

  if (isPipingLE) {
    coreNavHtml +=
      '<a href="internal-upload.html" class="sb-nav-item' + sbActive('upload') + '">'
      + I.upload + '<span>Upload &amp; Finalize</span></a>'
      + '<a href="internal-initiation.html" class="sb-nav-item' + sbActive('initiation') + '">'
      + I.initiation + '<span>Initiate Review</span></a>';
  }

  var adminNavHtml =
    '<a href="internal-admin.html" class="sb-nav-item' + sbActive('admin') + '">'
    + I.admin + '<span>Administration</span></a>';

  var sidebar =
    '<aside class="mrcs-sidebar" id="mrcs-sidebar">'
    + '<button class="sb-hamburger" id="sbHamburger" type="button" title="Menu">' + I.menu + '</button>'
    + '<div class="sb-body">'

    +   '<div class="sb-mode-section">'
    +     '<span class="sb-section-label">Operations Mode</span>'
    +     '<div class="sb-mode-toggle" id="sbModeToggle">'
    +       '<button class="sb-mode-btn sb-mode-ext" data-mode="external">External</button>'
    +       '<button class="sb-mode-btn sb-mode-int active-mode" data-mode="internal">Internal</button>'
    +     '</div>'
    +   '</div>'

    +   '<span class="sb-section-label">Navigation</span>'
    +   '<nav>' + coreNavHtml + '</nav>'

    +   '<span class="sb-section-label">Management</span>'
    +   '<nav>' + adminNavHtml + '</nav>'

    + '</div>'

    + '<div class="sb-tools-section">'
    +   '<span class="sb-section-label">Tools</span>'
    +   '<button class="sb-tool-btn" id="sbWorkflowBtn" type="button" data-label="Site Workflow">'
    +     I.workflow + '<span>Site Workflow</span>'
    +   '</button>'
    +   '<button class="sb-tool-btn sb-tool-btn--feedback" id="sbFeedbackBtn" type="button" data-label="Feedback">'
    +     I.feedback + '<span>Feedback</span>'
    +   '</button>'
    + '</div>'

    + '<div class="sb-footer"><span class="sb-footer-text">MRCS v2.0 &nbsp;&middot;&nbsp; EIL</span></div>'
    + '</aside>';

  /* ── Inject ── */
  document.body.insertAdjacentHTML('afterbegin', topbar + sidebar);

  /* ── Feedback modal ── */
  document.body.insertAdjacentHTML('beforeend',
    '<div id="fbOverlay" class="fb-overlay">'
    + '<div class="fb-modal">'
    +   '<div class="fb-header">'
    +     '<div class="fb-header-left">' + I.feedback + '<span class="fb-title">Feedback</span></div>'
    +     '<button id="fbCloseBtn" class="fb-close" type="button">&times;</button>'
    +   '</div>'
    +   '<div class="fb-tabs">'
    +     '<button class="fb-tab fb-tab--active" id="fbTabSubmit" data-tab="submit">Submit</button>'
    +     '<button class="fb-tab" id="fbTabMy" data-tab="my">My Feedback</button>'
    +   '</div>'

    +   '<div class="fb-panel" id="fbPanelSubmit">'
    +     '<div class="fb-body">'
    +       '<div id="fbAlert" class="fb-alert" style="display:none"></div>'
    +       '<div class="fb-field">'
    +         '<label>Category</label>'
    +         '<select id="fbCategory">'
    +           '<option value="">— Select category —</option>'
    +           '<option value="Bug Report">Bug Report</option>'
    +           '<option value="Feature Request">Feature Request</option>'
    +           '<option value="Improvement">Improvement Suggestion</option>'
    +           '<option value="General">General Feedback</option>'
    +         '</select>'
    +       '</div>'
    +       '<div class="fb-field">'
    +         '<label>Message <span class="fb-required">*</span></label>'
    +         '<textarea id="fbMessage" rows="5" placeholder="Describe your feedback in detail…"></textarea>'
    +       '</div>'
    +     '</div>'
    +     '<div class="fb-actions">'
    +       '<button id="fbSubmitBtn" class="fb-btn-submit" type="button">Submit Feedback</button>'
    +       '<button id="fbCancelBtn" class="fb-btn-cancel" type="button">Cancel</button>'
    +     '</div>'
    +   '</div>'

    +   '<div class="fb-panel fb-panel--hidden" id="fbPanelMy">'
    +     '<div class="fb-my-list" id="fbMyList">'
    +       '<div class="fb-my-loading">Loading…</div>'
    +     '</div>'
    +   '</div>'

    + '</div>'
    + '</div>'
  );

  /* ── Restore collapsed state ── */
  if (localStorage.getItem('sb-collapsed') === '1') {
    document.body.classList.add('sb-collapsed');
  }

  /* ── Hamburger toggle ── */
  document.getElementById('sbHamburger').addEventListener('click', function () {
    var collapsed = document.body.classList.toggle('sb-collapsed');
    localStorage.setItem('sb-collapsed', collapsed ? '1' : '0');
  });

  /* ── Mode toggle — switch back to external ── */
  document.getElementById('sbModeToggle').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.sb-mode-btn') : null;
    if (!btn || btn.classList.contains('active-mode')) return;
    if (btn.dataset.mode === 'external') {
      localStorage.setItem('mode', 'external');
      window.location.href = 'model-review-initiation.html';
    }
  });

  /* ── User dropdown toggle ── */
  var userDropdown = document.getElementById('tbUserDropdown');
  if (userDropdown) {
    userDropdown.addEventListener('click', function (e) {
      userDropdown.classList.toggle('open');
      e.stopPropagation();
    });
    document.addEventListener('click', function () {
      userDropdown.classList.remove('open');
    });
  }

  /* ── Hash tab sync ── */
  window.addEventListener('hashchange', function () {
    var hash = window.location.hash || '';
    document.querySelectorAll('.tb-tab[data-hash]').forEach(function (tab) {
      tab.classList.toggle('tb-tab--active', tab.dataset.hash === hash);
    });
  });

  /* ── Workflow button ── */
  var sbWorkflowBtn = document.getElementById('sbWorkflowBtn');
  if (sbWorkflowBtn) {
    sbWorkflowBtn.addEventListener('click', function () {
      window.location.href = 'workflow.html';
    });
  }

  /* ── Feedback modal ── */
  var fbOverlay   = document.getElementById('fbOverlay');
  var fbSubmitBtn = document.getElementById('fbSubmitBtn');
  var fbCancelBtn = document.getElementById('fbCancelBtn');
  var fbCloseBtn  = document.getElementById('fbCloseBtn');

  var FB_CAT_COLORS = {
    'Bug Report':     { bg: 'rgba(255,69,96,0.15)',  border: 'rgba(255,69,96,0.40)',  color: '#ff7a8a' },
    'Feature Request':{ bg: 'rgba(0,200,255,0.12)',  border: 'rgba(0,200,255,0.38)', color: '#00c8ff' },
    'Improvement':    { bg: 'rgba(255,180,0,0.12)',  border: 'rgba(255,180,0,0.38)', color: '#ffb800' },
    'General':        { bg: 'rgba(160,160,180,0.12)',border: 'rgba(160,160,180,0.30)',color: '#aaaacc' },
  };

  function fbCatBadge(cat) {
    var s = FB_CAT_COLORS[cat] || FB_CAT_COLORS['General'];
    return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.04em;'
      + 'background:' + s.bg + ';border:1px solid ' + s.border + ';color:' + s.color + '">' + cat + '</span>';
  }

  function fbFormatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  }

  function fbSwitchTab(tab) {
    document.getElementById('fbPanelSubmit').classList.toggle('fb-panel--hidden', tab !== 'submit');
    document.getElementById('fbPanelMy').classList.toggle('fb-panel--hidden', tab !== 'my');
    document.querySelectorAll('.fb-tab').forEach(function (btn) {
      btn.classList.toggle('fb-tab--active', btn.dataset.tab === tab);
    });
    if (tab === 'my') fbLoadMy();
  }

  async function fbLoadMy() {
    var list = document.getElementById('fbMyList');
    list.innerHTML = '<div class="fb-my-loading">Loading…</div>';
    try {
      var r = await fetch('/api/feedback/my', {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
      });
      var rows = await r.json();
      if (!r.ok || !Array.isArray(rows) || rows.length === 0) {
        list.innerHTML = '<div class="fb-my-empty">You have not submitted any feedback yet.</div>';
        return;
      }
      list.innerHTML = rows.map(function (row) {
        return '<div class="fb-my-card">'
          + '<div class="fb-my-card-top">'
          +   fbCatBadge(row.category)
          +   '<span class="fb-my-date">' + fbFormatDate(row.created_at) + '</span>'
          + '</div>'
          + '<p class="fb-my-msg">' + row.message.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>'
          + '</div>';
      }).join('');
    } catch (_) {
      list.innerHTML = '<div class="fb-my-empty">Could not load feedback. Please try again.</div>';
    }
  }

  function fbOpen() {
    document.getElementById('fbCategory').value = '';
    document.getElementById('fbMessage').value  = '';
    var al = document.getElementById('fbAlert');
    al.style.display = 'none';
    al.className = 'fb-alert';
    al.textContent = '';
    fbSwitchTab('submit');
    fbOverlay.style.display = 'flex';
  }

  function fbClose() { fbOverlay.style.display = 'none'; }

  function fbShowAlert(msg, isError) {
    var al = document.getElementById('fbAlert');
    al.textContent = msg;
    al.className = 'fb-alert ' + (isError ? 'fb-alert--error' : 'fb-alert--ok');
    al.style.display = 'block';
  }

  var sbFeedbackBtnEl = document.getElementById('sbFeedbackBtn');
  if (sbFeedbackBtnEl) sbFeedbackBtnEl.addEventListener('click', fbOpen);
  if (fbCloseBtn)      fbCloseBtn.addEventListener('click', fbClose);
  if (fbCancelBtn)     fbCancelBtn.addEventListener('click', fbClose);
  if (fbOverlay)       fbOverlay.addEventListener('click', function (e) { if (e.target === fbOverlay) fbClose(); });

  document.querySelectorAll('.fb-tab').forEach(function (btn) {
    btn.addEventListener('click', function () { fbSwitchTab(btn.dataset.tab); });
  });

  if (fbSubmitBtn) {
    fbSubmitBtn.addEventListener('click', async function () {
      var category = document.getElementById('fbCategory').value;
      var message  = document.getElementById('fbMessage').value.trim();

      if (!category) { fbShowAlert('Please select a category.', true); return; }
      if (!message)  { fbShowAlert('Please enter your feedback message.', true); return; }

      fbSubmitBtn.disabled    = true;
      fbSubmitBtn.textContent = 'Submitting…';

      try {
        var r = await fetch('/api/feedback', {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
          },
          body: JSON.stringify({ category: category, message: message })
        });
        var data = await r.json();
        if (!r.ok) {
          fbShowAlert(data.error || 'Failed to submit feedback.', true);
        } else {
          fbShowAlert('Thank you! Your feedback has been submitted.', false);
          setTimeout(fbClose, 2000);
        }
      } catch (_) {
        fbShowAlert('Network error. Please try again.', true);
      } finally {
        fbSubmitBtn.disabled    = false;
        fbSubmitBtn.textContent = 'Submit Feedback';
      }
    });
  }

})();
