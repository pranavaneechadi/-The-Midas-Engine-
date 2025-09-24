const base = window.location.origin;

// ------------------- LOGIN -------------------
async function login() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    if (!username || !password) {
        alert("Enter both username and password");
        return;
    }
    try {
        const res = await fetch(`${base}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.token) {
            localStorage.setItem("token", data.token);
            localStorage.setItem("username", username);
            window.location.href = "choose.html";
        } else {
            alert(data.msg || "Login failed");
        }
    } catch (err) {
        console.error("Login error:", err);
        alert("Error during login: " + err.message);
    }
}

// ------------------- SIGNUP -------------------
async function signup() {
    const username = document.getElementById("signup-username").value.trim();
    const password = document.getElementById("signup-password").value.trim();
    if (!username || !password) {
        alert("Enter both username and password");
        return;
    }
    try {
        const res = await fetch(`${base}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            alert("Signup successful! Redirecting to login...");
            window.location.href = "login.html";
        } else {
            alert(data.message || "Signup failed");
        }
    } catch (err) {
        console.error("Signup error:", err);
        alert("Error during signup: " + err.message);
    }
}

// ------------------- Event Listeners -------------------
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("btn_login")) {
        document.getElementById("btn_login").addEventListener("click", login);
    }
    if (document.getElementById("btn_signup")) {
        document.getElementById("btn_signup").addEventListener("click", signup);
    }
});
