const bcrypt = require("bcrypt");

async function hashPassword() {
    const hash = await bcrypt.hash("1234", 10);
    console.log(hash);
}

hashPassword();