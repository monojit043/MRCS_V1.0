// Redirect if no login
if (!localStorage.getItem("token")) {
  window.location.href = "login.html";
}

// Populate user info
const fullName = localStorage.getItem("fullName");
const role = localStorage.getItem("role");
const department = localStorage.getItem("department");

const userInfoElement = document.getElementById("userInfo");

if (userInfoElement && fullName && role && department) {
  userInfoElement.innerHTML =
    `${fullName}<br>${role} - ${department.toUpperCase()}`;
}

// JE restrictions — hide nav links (UI only; backend enforces actual access per job)
if (role === "JE") {
  ["leadengineer.html", "uploadandfinalization.html"].forEach(page => {
    document.querySelectorAll(`a[data-page="${page}"]`).forEach(el => {
      el.style.display = "none";
    });
  });
}

// Logout
const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", function () {
    localStorage.clear();
    window.location.href = "login.html";
  });
}