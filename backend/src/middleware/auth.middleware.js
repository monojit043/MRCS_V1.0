const jwt = require("jsonwebtoken");

const JWT_SECRET = "mrcs_super_secret_key";

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token required" });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: "Invalid or expired token" });
        }

        req.user = decoded;
        next();
    });
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

module.exports = { authenticateToken, authorize, requirePEM };