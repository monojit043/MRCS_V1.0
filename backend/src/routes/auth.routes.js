const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { authenticateToken } = require("../middleware/auth.middleware");

const JWT_SECRET = "mrcs_super_secret_key"; // later move to .env

router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: "Employee ID and password required" });
        }

        // 1️⃣ Authenticate from master_employees
        const result = await pool.query(
            `
            SELECT employee_id, employee_name, password_hash, department
            FROM master_employees
            WHERE UPPER(employee_id) = UPPER($1)
            `,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // 2️⃣ Fetch assignments
        const assignments = await pool.query(
            `
            SELECT role 
            FROM user_assignments
            WHERE employee_id = $1
            `,
            [user.employee_id]
        );

        if (assignments.rows.length === 0) {
            return res.status(403).json({ message: "No project assignment found" });
        }

        // 3️⃣ Determine highest role
        let highestRole = "JE";

        assignments.rows.forEach(a => {
            if (a.role === "GL") highestRole = "GL";
            else if (a.role === "LE" && highestRole !== "GL") highestRole = "LE";
        });

        // 4️⃣ Issue token
        const token = jwt.sign(
            {
                employeeId: user.employee_id,
                role: highestRole,
                department: user.department   // good to include
            },
            process.env.JWT_SECRET,
            { expiresIn: "8h" }
        );

        res.json({
            message: "Login successful",
            token,
            role: highestRole,
            fullName: user.employee_name,
            department: user.department
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Login failed" });
    }
});

router.post("/change-password", authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const employeeId = req.user.employeeId;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: "Current and new passwords are required" });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: "New password must be at least 6 characters" });
        }

        const result = await pool.query(
            "SELECT password_hash FROM master_employees WHERE employee_id = $1",
            [employeeId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);

        if (!match) {
            return res.status(401).json({ message: "Current password is incorrect" });
        }

        const newHash = await bcrypt.hash(newPassword, 10);

        await pool.query(
            "UPDATE master_employees SET password_hash = $1 WHERE employee_id = $2",
            [newHash, employeeId]
        );

        res.json({ message: "Password changed successfully" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to change password" });
    }
});

module.exports = router;