// Redirect if no login
if (!localStorage.getItem("token")) {
  window.location.href = "login.html";
}

// Populate user info
const fullName = localStorage.getItem("fullName");
const role = localStorage.getItem("role");
const department = localStorage.getItem("department");

const userInfoElement = document.getElementById("userInfo");

if (userInfoElement && fullName) {
  userInfoElement.innerHTML =
    `${fullName}<br>${role || "No assignment"}${department ? " - " + department.toUpperCase() : ""}`;
}

// JE (and no-assignment) restrictions — hide nav links (UI only; backend enforces actual access per job)
if (role === "JE" || !role) {
  ["leadengineer.html", "uploadandfinalization.html"].forEach(page => {
    document.querySelectorAll(`a[data-page="${page}"]`).forEach(el => {
      el.style.display = "none";
    });
  });
}

// Single sign-on check on every page: refreshes token / role / department live,
// and sends the user to login if they signed out here or in ePULSE.
(async function refreshSession() {
  try {
    const r = await fetch("/api/auth/sso");
    if (r.status === 401 || r.status === 403) {
      localStorage.clear();
      window.location.href = "login.html";
      return;
    }
    if (!r.ok) return; // server / PC-2 hiccup — keep the current page
    const d = await r.json();
    localStorage.setItem("token", d.token);
    localStorage.setItem("role", d.role || "");
    localStorage.setItem("fullName", d.fullName);
    localStorage.setItem("department", (d.department || "").toLowerCase());
  } catch { /* offline — API calls will report it */ }
})();

// Logout — signs out of MRCS and ePULSE (shared single sign-on cookie)
const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", async function () {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* still clear locally */ }
    localStorage.clear();
    window.location.href = "login.html";
  });
}