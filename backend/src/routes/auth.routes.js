const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const sso = require("../utils/sso");
const { loadLiveUser, checkCredentials } = require("../services/liveUser");

// Credentials, name, department come live from eil_employees on PC-2 (one password
// for every module). MRCS roles (JE / LE / GL) stay in MRCS's own user_assignments.
// Sign-in is shared with ePULSE through the single sign-on cookie (utils/sso.js).

// Builds the same response for a password login and a single sign-on login
async function issueSession(res, employeeId) {
    const user = await loadLiveUser(employeeId);
    if (!user) {
        return res.status(403).json({ message: "Your account is inactive in the employee master. Please contact ITS." });
    }
    // Anyone active may sign in — with no assignment, role is null and pages
    // simply show nothing to work on (every route scopes by assignment).

    // role / department in the token are informational only —
    // auth.middleware re-reads both live on every request
    const token = jwt.sign(
        { employeeId: user.employeeId, role: user.role, department: user.department },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
    );
    sso.setCookie(res, user.employeeId);

    res.json({
        message: "Login successful",
        token,
        role: user.role,
        fullName: user.fullName,
        department: user.department
    });
}

router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ message: "Employee ID and password required" });
    }
    try {
        const employeeId = await checkCredentials(String(username).trim(), password);
        if (!employeeId) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
        await issueSession(res, employeeId);
    } catch (err) {
        console.error("Login: PC-2 unreachable:", err.message);
        res.status(503).json({ message: "Login server (employee database) is unreachable. Please try again later." });
    }
});

// Single sign-on: already signed in to ePULSE (or MRCS) in this browser →
// MRCS token without asking for the password again
router.get("/sso", async (req, res) => {
    const employeeId = sso.currentUserId(req);
    if (!employeeId) return res.status(401).json({ message: "Not signed in" });
    try {
        await issueSession(res, employeeId);
    } catch (err) {
        console.error("SSO: PC-2 unreachable:", err.message);
        res.status(503).json({ message: "Login server (employee database) is unreachable. Please try again later." });
    }
});

// Signs out of MRCS and, via the shared cookie, ePULSE and every other module
router.post("/logout", (req, res) => {
    sso.clearCookie(res);
    res.json({ message: "Signed out" });
});

// Passwords are owned by the employee master (eil_employees on PC-2), not MRCS
router.post("/change-password", (req, res) => {
    res.status(403).json({ message: "Passwords are managed centrally. Please change your password in PIMS." });
});

module.exports = router;
