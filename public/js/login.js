// Stores the session and lands on the page for the user's role
function onSignedIn(data) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("role", data.role || "");               // "" = no MRCS assignment yet
    localStorage.setItem("fullName", data.fullName);
    localStorage.setItem("department", (data.department || "").toLowerCase());

    const dept = (data.department || "").toLowerCase();
    if (dept === "pem") {
        window.location.href = "model-review-initiation.html";
    } else if (data.role === "GL") {
        window.location.href = "admin.html";
    } else if (data.role === "LE") {
        window.location.href = "leadengineer.html";
    } else {
        // JE, or anyone without an assignment — the page lists only what is assigned to them
        window.location.href = "jobengineer.html";
    }
}

// Single sign-on: already signed in to ePULSE (or MRCS) in this browser → skip the form.
// A 403 (e.g. "No project assignment found") is shown instead of staying silent.
(async function trySingleSignOn() {
    try {
        const response = await fetch("/api/auth/sso");
        const data = await response.json();
        if (response.ok) return onSignedIn(data);
        if (response.status === 403) document.getElementById("loginError").innerText = data.message || "";
    } catch { /* not signed in — show the form */ }
})();

document.getElementById("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    const errorDiv = document.getElementById("loginError");

    errorDiv.innerText = "";

    if (!username || !password) {
        errorDiv.innerText = "Please enter username and password.";
        return;
    }

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok) {
            errorDiv.innerText = data.message || "Login failed";
            return;
        }

        onSignedIn(data);

    } catch (err) {
        console.error(err);
        errorDiv.innerText = "Server error. Try again.";
    }
});