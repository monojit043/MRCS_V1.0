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

        localStorage.setItem("token", data.token);
        localStorage.setItem("role", data.role);
        localStorage.setItem("fullName", data.fullName);
        localStorage.setItem("department", data.department?.toLowerCase());
        
        // Redirect based on department first, then role
        const dept = (data.department || "").toLowerCase();
        if (dept === "pem") {
            window.location.href = "model-review-initiation.html";
        } else if (data.role === "JE") {
            window.location.href = "jobengineer.html";
        } else if (data.role === "LE") {
            window.location.href = "leadengineer.html";
        } else if (data.role === "GL") {
            window.location.href = "admin.html";
        }

    } catch (err) {
        console.error(err);
        errorDiv.innerText = "Server error. Try again.";
    }
});