const params = new URLSearchParams(window.location.search);
const token = params.get("token");

function showMessage(text, type) {
    const el = document.getElementById("message");
    el.innerText = text;
    el.className = `visible ${type}`;
}

if (!token) {
    showMessage("Invalid or expired QR code.", "error");
}

async function submitAttendance() {

    const name        = document.getElementById("name").value.trim();
    const phone       = document.getElementById("phone").value.trim();
    const company     = document.getElementById("company").value.trim();
    const designation = document.getElementById("designation").value.trim();

    if (!name || !phone) {
        showMessage("Name and phone number are required.", "error");
        return;
    }

    if (phone.length !== 10) {
        showMessage("Please enter a valid 10-digit phone number.", "error");
        return;
    }

    const btn = document.querySelector(".btn-submit");
    btn.disabled = true;
    btn.innerText = "Submitting…";

    try {
        const res = await fetch("/api/attendance/mark-attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                qr_token: token,
                name,
                phone_number: phone,
                company_name: company,
                designation
            })
        });

        const data = await res.json();

        if (data.success) {
            showMessage("✓ Attendance marked successfully!", "success");
        } else {
            showMessage(data.message || "Could not mark attendance.", "error");
            btn.disabled = false;
            btn.innerText = "Mark Attendance";
        }

    } catch (err) {
        console.error(err);
        showMessage("Server error. Please try again.", "error");
        btn.disabled = false;
        btn.innerText = "Mark Attendance";
    }
}
