/* ============================================================
   MRCS — Navbar / Sidebar  |  Injected synchronously at end of <body>
   so logoutBtn / userInfo exist when header.js fires.
   ============================================================ */
(function () {

  /* ── SVG icons ── */
  var I = {
    plus:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    history:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 106 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>',
    menu:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    workflow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1"/><line x1="5.5" y1="8" x2="5.5" y2="12"/><line x1="18.5" y1="8" x2="18.5" y2="12"/><line x1="5.5" y1="12" x2="12" y2="12"/><line x1="18.5" y1="12" x2="12" y2="12"/><line x1="12" y1="12" x2="12" y2="16"/></svg>',
    feedback: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    dashboard:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    je:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    le:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    upload:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>',
    initiation:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    users:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
    bell:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
    search:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    logout:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    chevron:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    lock:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  };

  /* ── Current page ── */
  var page = window.location.pathname.replace(/^.*\//, '') || '';

  /* Page → topbar tab key */
  var TAB_MAP = {
    'model-review-initiation.html': 'dashboard',
    'jobengineer.html':             'je',
    'leadengineer.html':            'le',
    'uploadandfinalization.html':   'upload',
    'admin.html':                   'admin',
  };

  /* Page → sidebar active key (can match multiple) */
  var SB_ACTIVE_KEYS = (function () {
    var m = {
      'model-review-initiation.html': ['dashboard', 'initiation'],
      'jobengineer.html':             ['je'],
      'leadengineer.html':            ['le'],
      'uploadandfinalization.html':   ['upload'],
      'admin.html':                   ['admin'],
    };
    return m[page] || [];
  })();

  function sbActive(key) {
    return SB_ACTIVE_KEYS.indexOf(key) >= 0 ? ' sb-nav-item--active' : '';
  }

  var activeTab = TAB_MAP[page] || null;

  /* ── User info from localStorage ── */
  var fullName = localStorage.getItem('fullName') || '';
  var role     = localStorage.getItem('role')     || '';
  var dept     = localStorage.getItem('department') || '';
  var isPEM    = dept.toLowerCase() === 'pem';
  var mode     = localStorage.getItem('mode') || 'external';

  var initials = fullName.trim()
    .split(/\s+/)
    .map(function (w) { return w.charAt(0).toUpperCase(); })
    .join('')
    .slice(0, 2) || '?';

  var displayName = fullName || 'User';
  var displayRole = role ? (role + (dept ? ' · ' + dept.toUpperCase() : '')) : '';

  /* ── Topbar tabs ── */
  var tabsHtml;

  if (isPEM) {
    var pemHash        = window.location.hash || '';
    var pemBasePage, pemDefaultHash, pemTabDefs;

    if (page === 'uploadandfinalization.html') {
      pemBasePage    = 'uploadandfinalization.html';
      pemDefaultHash = '#upload';
      pemTabDefs = [
        { key: 'upload',       hash: '#upload',       icon: I.upload,     label: 'Upload'           },
        { key: 'finalization', hash: '#finalization', icon: I.initiation, label: 'Tag Finalization' },
      ];
    } else if (page === 'admin.html') {
      pemBasePage    = 'admin.html';
      pemDefaultHash = '#mom';
      pemTabDefs = [
        { key: 'mom',   hash: '#mom',   icon: I.initiation, label: 'MOM'                       },
        { key: 'prereq',hash: '#prereq',icon: I.dashboard,  label: 'Prerequisites & Attendance' },
        { key: 'tags',  hash: '#tags',  icon: I.le,         label: 'Tag Status & CRS Report'   },
      ];
    } else {
      pemBasePage    = 'model-review-initiation.html';
      pemDefaultHash = '#dashboard';
      pemTabDefs = [
        { key: 'dashboard', hash: '#dashboard', icon: I.dashboard,  label: 'Review Dashboard' },
        { key: 'initiate',  hash: '#initiate',  icon: I.initiation, label: 'Initiate Reviews' },
        { key: 'assign',    hash: '#assign',    icon: I.users,      label: 'Assign Leads'     },
      ];
    }

    tabsHtml = pemTabDefs.map(function (t) {
      var isActive = pemHash === t.hash || (pemHash === '' && t.hash === pemDefaultHash);
      var cls = 'tb-tab' + (isActive ? ' tb-tab--active' : '');
      return '<a href="' + pemBasePage + t.hash + '" class="' + cls
        + '" data-tab="' + t.key + '" data-hash="' + t.hash + '">'
        + t.icon + '<span>' + t.label + '</span></a>';
    }).join('');

    if (page === 'uploadandfinalization.html') {
      var exportHash   = '#export';
      var isExportActive = pemHash === exportHash;
      tabsHtml += '<a href="uploadandfinalization.html' + exportHash + '" class="tb-tab tb-tab-export'
        + (isExportActive ? ' tb-tab--active' : '') + '" data-tab="export" data-hash="' + exportHash + '">'
        + I.download + '<span>Export All Tags</span></a>';
    }
  } else if (page === 'leadengineer.html') {
    var leHash    = window.location.hash || '#approval';
    var leTabDefs = [
      { key: 'approval', hash: '#approval', icon: I.le,         label: 'Approve Submitted Tags'  },
      { key: 'review',   hash: '#review',   icon: I.initiation, label: 'Model Review Preparation' },
    ];
    tabsHtml = leTabDefs.map(function (t) {
      var isActive = leHash === t.hash;
      var cls = 'tb-tab' + (isActive ? ' tb-tab--active' : '');
      return '<a href="leadengineer.html' + t.hash + '" class="' + cls
        + '" data-tab="' + t.key + '" data-hash="' + t.hash + '">'
        + t.icon + '<span>' + t.label + '</span></a>';
    }).join('');
  } else if (page === 'admin.html') {
    var adminHash    = window.location.hash || '#mom';
    var adminTabDefs = [
      { key: 'mom',   hash: '#mom',   icon: I.initiation, label: 'MOM'                    },
      { key: 'tags',  hash: '#tags',  icon: I.le,         label: 'Tag Status & CRS Report' },
      { key: 'users', hash: '#users', icon: I.users,      label: 'Add JE'                 },
    ];
    tabsHtml = adminTabDefs.map(function (t) {
      var isActive = adminHash === t.hash || (adminHash === '' && t.hash === '#mom');
      var cls = 'tb-tab' + (isActive ? ' tb-tab--active' : '');
      return '<a href="admin.html' + t.hash + '" class="' + cls
        + '" data-tab="' + t.key + '" data-hash="' + t.hash + '">'
        + t.icon + '<span>' + t.label + '</span></a>';
    }).join('');
  } else {
    var nonPemTabMap = {
      'model-review-initiation.html': { key: 'dashboard', label: 'Dashboard',   icon: I.dashboard },
      'jobengineer.html':             { key: 'je',        label: 'Job Engineer', icon: I.je        },
    };
    var nonPemTab = nonPemTabMap[page];
    tabsHtml = nonPemTab
      ? '<a href="' + page + '" class="tb-tab tb-tab--active" data-tab="' + nonPemTab.key + '">'
          + nonPemTab.icon + '<span>' + nonPemTab.label + '</span></a>'
      : '';
  }

  /* ── Build TOPBAR ── */
  var topbar =
    '<header class="mrcs-topbar" id="mrcs-topbar">'

    /* brand */
    + '<div class="tb-brand">'
    +   '<div class="tb-logo"><img src="assets/eilround.gif" alt="MRCS"></div>'
    +   '<div class="tb-brand-text">'
    +     '<span class="tb-brand-name">MRCS</span>'
    +     '<span class="tb-mode-label" id="tbModeLabel">' + (mode === 'internal' ? 'Internal Operations' : 'External Operations') + '</span>'
    +   '</div>'
    + '</div>'

    /* tabs */
    + '<nav class="tb-tabs">' + tabsHtml + '</nav>'

    /* right controls */
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
    /* hidden span — header.js writes to this; JE role restriction reads data-page attrs below */
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
    +       '<button class="tb-dropdown-item tb-dropdown-item--cpwd" id="changePasswordBtn" type="button">'
    +         I.lock + '<span>Change Password</span>'
    +       '</button>'
    +       '<button class="tb-dropdown-item" id="logoutBtn" type="button">'
    +         I.logout + '<span>Sign Out</span>'
    +       '</button>'
    +     '</div>'
    +   '</div>'
    + '</div>'
    + '</header>';

  /* ── Build SIDEBAR ── */
  var coreNav = '';
  var mgmtNav = '';
  var coreNavSection = '';

  if (isPEM) {
    /* PEM: Upload & Finalize in Navigation, Model Initiation + User Management in Management */
    coreNavSection =
      '<span class="sb-section-label">Navigation</span>'
      + '<nav>'
      + '<a href="uploadandfinalization.html" class="sb-nav-item' + sbActive('upload') + '" data-page="uploadandfinalization.html" data-label="Upload & Finalize">'
      + I.upload + '<span>Upload &amp; Finalize</span></a>'
      + '</nav>';
    mgmtNav =
      '<a href="model-review-initiation.html" class="sb-nav-item'
      + (page === 'model-review-initiation.html' ? ' sb-nav-item--active' : '')
      + '" data-page="model-review-initiation.html" data-label="Model Initiation">'
      + I.initiation + '<span>Model Initiation</span></a>'
      + '<a href="admin.html" class="sb-nav-item'
      + (page === 'admin.html' ? ' sb-nav-item--active' : '')
      + '" data-page="admin.html" data-label="Administration">'
      + I.users + '<span>Administration</span></a>';
  } else {
    var navItems = [
      { key: 'dashboard', href: 'model-review-initiation.html', icon: I.dashboard, label: 'Dashboard',    pg: 'model-review-initiation.html' },
      { key: 'je',        href: 'jobengineer.html',             icon: I.je,        label: 'Job Engineer', pg: 'jobengineer.html'             },
      { key: 'le',        href: 'leadengineer.html',            icon: I.le,        label: 'Lead Engineer', pg: 'leadengineer.html'            },
    ];
    coreNav = navItems.map(function (n) {
      return '<a href="' + n.href + '" class="sb-nav-item' + sbActive(n.key) + '" data-page="' + n.pg + '" data-label="' + n.label + '">'
        + n.icon + '<span>' + n.label + '</span></a>';
    }).join('');
    coreNavSection = '<span class="sb-section-label">Navigation</span><nav>' + coreNav + '</nav>';
    mgmtNav =
      '<a href="admin.html" class="sb-nav-item' + sbActive('admin') + '" data-page="admin.html" data-label="Administration">'
      + I.users + '<span>Administration</span></a>';
  }

  var sidebar =
    '<aside class="mrcs-sidebar" id="mrcs-sidebar">'
    + '<button class="sb-hamburger" id="sbHamburger" type="button" title="Menu">' + I.menu + '</button>'
    + '<div class="sb-body">'

    /* mode toggle */
    +   '<div class="sb-mode-section">'
    +     '<span class="sb-section-label">Operations Mode</span>'
    +     '<div class="sb-mode-toggle" id="sbModeToggle">'
    +       '<button class="sb-mode-btn sb-mode-ext' + (mode !== 'internal' ? ' active-mode' : '') + '" data-mode="external">External</button>'
    +       '<button class="sb-mode-btn sb-mode-int' + (mode === 'internal' ? ' active-mode' : '') + '" data-mode="internal">Internal</button>'
    +     '</div>'
    +   '</div>'

    /* core navigation (hidden for PEM) */
    +   coreNavSection

    /* management */
    +   '<span class="sb-section-label">Management</span>'
    +   '<nav>' + mgmtNav + '</nav>'

    + '</div>'

    /* tools section pinned at bottom */
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

  /* ── Change Password modal ── */
  document.body.insertAdjacentHTML('beforeend',
    '<div id="changePwdOverlay" class="cpwd-overlay">'
    + '<div class="cpwd-modal">'
    +   '<div class="cpwd-header">'
    +     '<span class="cpwd-title">Change Password</span>'
    +     '<button id="cpwdCloseBtn" class="cpwd-close" type="button">&times;</button>'
    +   '</div>'
    +   '<div class="cpwd-body">'
    +     '<div id="cpwdAlert" class="cpwd-alert" style="display:none"></div>'
    +     '<div class="cpwd-field"><label>Current Password</label>'
    +       '<input type="password" id="cpwdCurrent" placeholder="Enter current password" autocomplete="current-password"/></div>'
    +     '<div class="cpwd-field"><label>New Password</label>'
    +       '<input type="password" id="cpwdNew" placeholder="Enter new password (min 6 chars)" autocomplete="new-password"/></div>'
    +     '<div class="cpwd-field"><label>Confirm New Password</label>'
    +       '<input type="password" id="cpwdConfirm" placeholder="Re-enter new password" autocomplete="new-password"/></div>'
    +   '</div>'
    +   '<div class="cpwd-actions">'
    +     '<button id="cpwdSubmitBtn" class="cpwd-btn-submit" type="button">Update Password</button>'
    +     '<button id="cpwdCancelBtn" class="cpwd-btn-cancel" type="button">Cancel</button>'
    +   '</div>'
    + '</div>'
    + '</div>'
  );

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

    /* Submit panel */
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

    /* My Feedback panel */
    +   '<div class="fb-panel fb-panel--hidden" id="fbPanelMy">'
    +     '<div class="fb-my-list" id="fbMyList">'
    +       '<div class="fb-my-loading">Loading…</div>'
    +     '</div>'
    +   '</div>'

    + '</div>'
    + '</div>'
  );

  /* ── Restore collapsed state before first paint ── */
  if (localStorage.getItem('sb-collapsed') === '1') {
    document.body.classList.add('sb-collapsed');
  }

  /* ── Hamburger collapse toggle ── */
  var hamburger = document.getElementById('sbHamburger');
  if (hamburger) {
    hamburger.addEventListener('click', function () {
      var isNowCollapsed = document.body.classList.toggle('sb-collapsed');
      localStorage.setItem('sb-collapsed', isNowCollapsed ? '1' : '0');
    });
  }

  /* ── Keep topbar tab active state in sync with hash (PEM + LE + non-PEM admin) ── */
  if (isPEM || page === 'leadengineer.html' || page === 'admin.html') {
    window.addEventListener('hashchange', function () {
      var defaultHash = isPEM ? '#dashboard' : (page === 'leadengineer.html' ? '#approval' : '#mom');
      var hash = window.location.hash || defaultHash;
      document.querySelectorAll('.tb-tab[data-hash]').forEach(function (tab) {
        tab.classList.toggle('tb-tab--active', tab.dataset.hash === hash);
      });
    });
  }

  /* ── Disable Internal mode for PEM department ── */
  if (dept.toLowerCase() === 'pem') {
    var intBtn = document.querySelector('.sb-mode-int');
    if (intBtn) {
      intBtn.disabled = true;
      intBtn.classList.add('sb-mode-disabled');
      intBtn.title = 'Internal mode is not available for PEM';
    }
  }

  /* ── Mode toggle ── */
  var modeToggle = document.getElementById('sbModeToggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.sb-mode-btn') : null;
      if (!btn || btn.classList.contains('active-mode')) return;
      var newMode = btn.dataset.mode;
      localStorage.setItem('mode', newMode);
      if (newMode === 'internal') {
        window.location.href = 'internal-dashboard.html';
      } else {
        window.location.href = 'model-review-initiation.html';
      }
    });
  }

  /* ── User dropdown toggle ── */
  var userDropdown = document.getElementById('tbUserDropdown');
  if (userDropdown) {
    userDropdown.addEventListener('click', function (e) {
      userDropdown.classList.toggle('open');
      e.stopPropagation();
    });
    document.addEventListener('click', function () {
      if (userDropdown) userDropdown.classList.remove('open');
    });
  }

  /* ── Sync name/role after header.js runs (DOMContentLoaded) ── */
  document.addEventListener('DOMContentLoaded', function () {
    var raw = document.getElementById('userInfo');
    if (raw && raw.innerHTML) {
      /* header.js sets: fullName<br>role - DEPT */
      var html  = raw.innerHTML;
      var brIdx = html.toLowerCase().indexOf('<br>');
      var name  = brIdx >= 0 ? html.slice(0, brIdx).trim()  : html.trim();
      var rl    = brIdx >= 0 ? html.slice(brIdx + 4).trim() : '';

      var nameEl = document.getElementById('tbUserName');
      var roleEl = document.getElementById('tbUserRole');
      var avatEl = document.getElementById('tbAvatar');

      if (nameEl && name) nameEl.textContent = name;
      if (roleEl && rl)   roleEl.textContent = rl;

      /* refresh avatar initials from actual name */
      if (avatEl && name) {
        var ini = name.split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase(); }).join('').slice(0, 2);
        avatEl.textContent = ini || avatEl.textContent;
        var dropAvat = document.getElementById('tbDropdownAvatar');
        if (dropAvat) dropAvat.textContent = ini || dropAvat.textContent;
      }

      /* sync dropdown header */
      var dropName = document.getElementById('tbDropdownName');
      var dropRole = document.getElementById('tbDropdownRole');
      if (dropName && name) dropName.textContent = name;
      if (dropRole && rl)   dropRole.textContent = rl;
    }
  });

  /* ── Change Password event wiring ── */
  var cpwdOverlay   = document.getElementById('changePwdOverlay');
  var cpwdChangeBtn = document.getElementById('changePasswordBtn');

  function cpwdOpen() {
    if (userDropdown) userDropdown.classList.remove('open');
    document.getElementById('cpwdCurrent').value = '';
    document.getElementById('cpwdNew').value     = '';
    document.getElementById('cpwdConfirm').value = '';
    var al = document.getElementById('cpwdAlert');
    al.style.display = 'none';
    al.className = 'cpwd-alert';
    al.textContent = '';
    cpwdOverlay.style.display = 'flex';
  }

  function cpwdClose() {
    cpwdOverlay.style.display = 'none';
  }

  function cpwdShowAlert(msg, isError) {
    var al = document.getElementById('cpwdAlert');
    al.textContent = msg;
    al.className = 'cpwd-alert ' + (isError ? 'cpwd-alert--error' : 'cpwd-alert--ok');
    al.style.display = 'block';
  }

  if (cpwdChangeBtn) cpwdChangeBtn.addEventListener('click', function (e) { e.stopPropagation(); cpwdOpen(); });
  document.getElementById('cpwdCloseBtn').addEventListener('click', cpwdClose);
  document.getElementById('cpwdCancelBtn').addEventListener('click', cpwdClose);
  cpwdOverlay.addEventListener('click', function (e) { if (e.target === cpwdOverlay) cpwdClose(); });

  document.getElementById('cpwdSubmitBtn').addEventListener('click', async function () {
    var current   = document.getElementById('cpwdCurrent').value;
    var newPwd    = document.getElementById('cpwdNew').value;
    var confirm   = document.getElementById('cpwdConfirm').value;
    var submitBtn = document.getElementById('cpwdSubmitBtn');

    if (!current || !newPwd || !confirm) { cpwdShowAlert('All fields are required.', true); return; }
    if (newPwd.length < 6)               { cpwdShowAlert('New password must be at least 6 characters.', true); return; }
    if (newPwd !== confirm)              { cpwdShowAlert('New passwords do not match.', true); return; }

    submitBtn.disabled    = true;
    submitBtn.textContent = 'Updating…';

    try {
      var r    = await fetch('/api/auth/change-password', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
        },
        body: JSON.stringify({ currentPassword: current, newPassword: newPwd })
      });
      var data = await r.json();
      if (!r.ok) {
        cpwdShowAlert(data.message || 'Failed to change password.', true);
      } else {
        cpwdShowAlert('Password changed successfully!', false);
        setTimeout(cpwdClose, 1800);
      }
    } catch (_) {
      cpwdShowAlert('Network error. Please try again.', true);
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Update Password';
    }
  });

  /* ── Workflow button ── */
  var sbWorkflowBtn = document.getElementById('sbWorkflowBtn');
  if (sbWorkflowBtn) {
    sbWorkflowBtn.addEventListener('click', function () {
      window.location.href = 'workflow.html';
    });
  }

  /* ── Feedback modal wiring ── */
  var fbOverlay   = document.getElementById('fbOverlay');
  var fbSubmitBtn = document.getElementById('fbSubmitBtn');
  var fbCancelBtn = document.getElementById('fbCancelBtn');
  var fbCloseBtn  = document.getElementById('fbCloseBtn');

  var FB_CAT_COLORS = {
    'Bug Report':    { bg: 'rgba(255,69,96,0.15)',  border: 'rgba(255,69,96,0.40)',  color: '#ff7a8a' },
    'Feature Request':{ bg: 'rgba(0,200,255,0.12)', border: 'rgba(0,200,255,0.38)', color: '#00c8ff' },
    'Improvement':   { bg: 'rgba(255,180,0,0.12)',  border: 'rgba(255,180,0,0.38)', color: '#ffb800' },
    'General':       { bg: 'rgba(160,160,180,0.12)',border: 'rgba(160,160,180,0.30)',color: '#aaaacc' },
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

  function fbClose() {
    fbOverlay.style.display = 'none';
  }

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

  /* Tab switching */
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
