const jwt = require("jsonwebtoken");
const sso = require("../utils/sso");
const { loadLiveUser } = require("../services/liveUser");

// Every request:
//  1. the JWT must be valid, AND the shared single sign-on cookie must name the
//     same user — signing out of ePULSE or MRCS signs out of both;
//  2. role and department are re-read LIVE (PC-2 employee master + MRCS
//     user_assignments) — the values frozen in the token are never trusted.
async function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token required" });
    }

    let decoded;
    try {
        decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ message: "Invalid or expired token" });
    }

    const ssoId = sso.currentUserId(req);
    if (!ssoId || ssoId.toUpperCase() !== String(decoded.employeeId).toUpperCase()) {
        return res.status(401).json({ message: "Signed out. Please sign in again." });
    }

    try {
        const live = await loadLiveUser(decoded.employeeId);
        if (!live) {
            sso.clearCookie(res);
            return res.status(401).json({ message: "Your account is no longer active. Please contact ITS." });
        }
        // role may be null (no MRCS assignment) — routes then show only what is assigned, i.e. nothing
        req.user = { employeeId: live.employeeId, role: live.role, department: live.department };
        next();
    } catch (err) {
        console.error("authenticateToken: PC-2 unreachable:", err.message);
        res.status(503).json({ message: "Employee server (PC-2) is unreachable. Please try again shortly." });
    }
}

// For pages that can't send the Bearer token — reports opened with window.open,
// attendance fetches: the shared single sign-on cookie identifies the user.
// Role and department are read live, exactly like authenticateToken.
async function authenticateCookie(req, res, next) {
    const employeeId = sso.currentUserId(req);
    if (!employeeId) {
        return res.status(401).json({ message: "Not signed in. Please sign in to MRCS and try again." });
    }
    try {
        const live = await loadLiveUser(employeeId);
        if (!live) {
            sso.clearCookie(res);
            return res.status(401).json({ message: "Your account is no longer active. Please contact ITS." });
        }
        req.user = { employeeId: live.employeeId, role: live.role, department: live.department };
        next();
    } catch (err) {
        console.error("authenticateCookie: PC-2 unreachable:", err.message);
        res.status(503).json({ message: "Employee server (PC-2) is unreachable. Please try again shortly." });
    }
}

function authorize(minRole) {
    const roleHierarchy = {
        JE: 1,
        LE: 2,
        GL: 3
    };

    return (req, res, next) => {

        if (!req.user || !req.user.role) {
            return res.status(403).json({ message: "Access denied" });
        }

        const userLevel = roleHierarchy[req.user.role];
        const requiredLevel = roleHierarchy[minRole];

        if (!userLevel || userLevel < requiredLevel) {
            return res.status(403).json({ message: "Access denied" });
        }

        next();
    };
}

function requirePEM(req, res, next) {
    const dept = (req.user?.department || "").toLowerCase();
    const role = req.user?.role;
    if (dept !== "pem" || !["GL", "LE"].includes(role)) {
        return res.status(403).json({ message: "Access denied: PEM GL or PEM LE only" });
    }
    next();
}

module.exports = { authenticateToken, authenticateCookie, authorize, requirePEM };