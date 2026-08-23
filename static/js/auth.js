// ══════════════════════════════════════════════
//  BLOOM — auth.js
//  Handles login / signup page interactions
// ══════════════════════════════════════════════

(function () {
  "use strict";

  /* ── Tab switching ───────────────────────── */
  window.switchTab = function (tab) {
    const tabs = { login: "tab-login", signup: "tab-signup" };
    const sections = { login: "section-login", signup: "section-signup" };

    Object.keys(tabs).forEach((k) => {
      document.getElementById(tabs[k]).classList.toggle("active", k === tab);
      document.getElementById(sections[k]).classList.toggle("active", k === tab);
    });

    clearErrors();

    const hint = document.getElementById("auth-switch-hint");
    if (tab === "login") {
      hint.innerHTML =
        'No account? <span onclick="switchTab(\'signup\')">Sign up free</span>';
    } else {
      hint.innerHTML =
        'Have an account? <span onclick="switchTab(\'login\')">Sign in</span>';
    }
  };

  /* ── Error helpers ───────────────────────── */
  function clearErrors() {
    document.getElementById("login-err").textContent = "";
    document.getElementById("signup-err").textContent = "";
  }

  function setError(id, msg) {
    document.getElementById(id).textContent = msg;
  }

  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? "Please wait…" : btn.dataset.label;
  }

  /* ── Validation helpers ──────────────────── */
  function validateLogin(username, password) {
    if (!username) return "Please enter your username.";
    if (!password) return "Please enter your password.";
    return null;
  }

  function validateSignup(username, password, confirm) {
    if (!username || username.length < 3)
      return "Username must be at least 3 characters.";
    if (/\s/.test(username)) return "Username cannot contain spaces.";
    if (username === "admin") return "That username is not available.";
    if (!password || password.length < 4)
      return "Password must be at least 4 characters.";
    if (password !== confirm) return "Passwords do not match.";
    return null;
  }

  /* ── Login ───────────────────────────────── */
  window.doLogin = async function () {
    const username = document.getElementById("login-user").value.trim();
    const password = document.getElementById("login-pass").value;

    const err = validateLogin(username, password);
    if (err) { setError("login-err", err); return; }

    setLoading("btn-login", true);

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then((r) => r.json());

      if (res.ok) {
        window.location.href = res.redirect;
      } else {
        setError("login-err", res.error || "Login failed. Please try again.");
      }
    } catch (_) {
      setError("login-err", "Network error. Is the server running?");
    } finally {
      setLoading("btn-login", false);
    }
  };

  /* ── Signup ──────────────────────────────── */
  window.doSignup = async function () {
    const username = document.getElementById("signup-user").value.trim();
    const password = document.getElementById("signup-pass").value;
    const confirm  = document.getElementById("signup-pass2").value;

    const err = validateSignup(username, password, confirm);
    if (err) { setError("signup-err", err); return; }

    setLoading("btn-signup", true);

    try {
      const res = await fetch("/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, confirm }),
      }).then((r) => r.json());

      if (res.ok) {
        window.location.href = res.redirect;
      } else {
        setError("signup-err", res.error || "Signup failed. Please try again.");
      }
    } catch (_) {
      setError("signup-err", "Network error. Is the server running?");
    } finally {
      setLoading("btn-signup", false);
    }
  };

  /* ── Enter-key shortcut ──────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    // Store button labels for restore after loading state
    ["btn-login", "btn-signup"].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.dataset.label = btn.textContent;
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const loginActive = document
        .getElementById("section-login")
        .classList.contains("active");
      if (loginActive) doLogin();
      else doSignup();
    });

    // Auto-focus first input
    const firstInput = document.querySelector(".form-section.active input");
    if (firstInput) firstInput.focus();
  });
  
})();