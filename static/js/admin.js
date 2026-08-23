// ══════════════════════════════════════════════
//  BLOOM — admin.js
//  Admin panel: users, stats, announcements,
//  password reset, user deletion
// ══════════════════════════════════════════════

(function () {
  "use strict";

  /* ── API helper ──────────────────────────── */
  async function api(url, method = "GET", body = null) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    try {
      const r = await fetch(url, opts);
      return await r.json();
    } catch (e) {
      console.error("Admin API error:", e);
      return null;
    }
  }

  /* ── Message helper ──────────────────────── */
  function showMsg(elId, text, isError = false) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "var(--straw-blush)" : "var(--matcha-light)";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ""), 4000);
  }

  /* ── Users ───────────────────────────────── */
  async function loadUsers() {
    const users = await api("/api/admin/users");
    const el = document.getElementById("admin-users");
    if (!el) return;

    if (!users || !users.length) {
      el.innerHTML =
        '<p style="color:rgba(255,255,255,0.4);font-size:0.85rem">No registered users yet.</p>';
      return;
    }

    el.innerHTML = users
      .map(
        (u) => `
      <div class="user-row-admin">
        <div class="u-avatar-sm">${u.username[0].toUpperCase()}</div>
        <div style="flex:1">
          <div class="u-name">${escHtml(u.username)}</div>
          <div class="u-date">Joined ${u.joined}</div>
        </div>
        <button class="btn-danger-sm" onclick="deleteUser(${u.id},'${escHtml(u.username)}')">Remove</button>
      </div>`
      )
      .join("");
  }

  window.deleteUser = async function (id, name) {
    if (
      !confirm(
        `Remove user "${name}"?\n\nThis will permanently delete ALL their data — prayers, tasks, thoughts, money logs, books, and habits.`
      )
    )
      return;
    const res = await api(`/api/admin/delete_user/${id}`, "DELETE");
    if (res && res.ok) {
      showMsg("users-msg", `✅ User "${name}" removed.`);
      loadUsers();
      loadStats();
    } else {
      showMsg("users-msg", "❌ Could not remove user.", true);
    }
  };

  /* ── Stats ───────────────────────────────── */
  async function loadStats() {
    const s = await api("/api/admin/stats");
    const el = document.getElementById("admin-stats");
    if (!el || !s) return;

    el.innerHTML = `
      <div class="admin-stat-row"><span>👥 Total Users</span><span class="asval">${s.users}</span></div>
      <div class="admin-stat-row"><span>✅ Tasks Created</span><span class="asval">${s.tasks}</span></div>
      <div class="admin-stat-row"><span>📓 Thoughts Written</span><span class="asval">${s.thoughts}</span></div>
      <div class="admin-stat-row"><span>🕌 Prayers Logged</span><span class="asval">${s.prayers}</span></div>
      <div class="admin-stat-row"><span>📚 Books Added</span><span class="asval">${s.books}</span></div>
      <div class="admin-stat-row" style="border:none"><span>🌙 Habits Created</span><span class="asval">${s.habits}</span></div>
    `;
  }

  /* ── Announcement ────────────────────────── */
  window.sendAnnouncement = async function () {
    const text = document.getElementById("announce-text").value.trim();
    if (!text) {
      showMsg("announce-msg", "⚠️ Please write a message first.", true);
      return;
    }
    const res = await api("/api/admin/announce", "POST", { text });
    if (res && res.ok) {
      document.getElementById("announce-text").value = "";
      showMsg("announce-msg", "✅ Announcement sent! Users will see it on their dashboard.");
      loadCurrentAnnouncement();
    } else {
      showMsg("announce-msg", "❌ Failed to send announcement.", true);
    }
  };

  window.clearAnnouncement = async function () {
    const res = await api("/api/admin/announce/clear", "POST");
    if (res && res.ok) {
      showMsg("announce-msg", "🗑️ Announcement cleared.");
      loadCurrentAnnouncement();
    }
  };

  async function loadCurrentAnnouncement() {
    const a = await api("/api/admin/announcement");
    const el = document.getElementById("current-announce");
    if (!el) return;
    if (a) {
      el.innerHTML = `
        <div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:10px 14px;border-left:3px solid var(--straw-blush)">
          <div style="color:rgba(255,255,255,0.55);font-size:0.72rem;margin-bottom:4px">${a.date}</div>
          <div style="color:var(--white-pure);font-size:0.88rem">${escHtml(a.text)}</div>
          <button class="btn-danger-sm" onclick="clearAnnouncement()" style="margin-top:8px">Clear</button>
        </div>`;
    } else {
      el.innerHTML =
        '<p style="color:rgba(255,255,255,0.3);font-size:0.82rem">No active announcement.</p>';
    }
  }

  /* ── Password Reset ──────────────────────── */
  window.resetPassword = async function () {
    const username = document.getElementById("reset-user").value.trim();
    const password = document.getElementById("reset-pass").value;

    if (!username) { showMsg("reset-msg", "! Enter a username.", true); return; }
    if (!password || password.length < 4) { showMsg("reset-msg", "! Password must be at least 4 characters.", true); return; }

    const res = await api("/api/admin/reset_password", "POST", { username, password });
    if (res && res.ok) {
      document.getElementById("reset-user").value = "";
      document.getElementById("reset-pass").value = "";
      showMsg("reset-msg", `✅ Password for "${username}" reset successfully.`);
    } else {
      showMsg("reset-msg", "❌ " + (res?.error || "User not found."), true);
    }
  };

  /* ── DB Export (download users list as JSON) ─ */
  window.exportUsers = async function () {
    const users = await api("/api/admin/users");
    if (!users) return;
    const blob = new Blob([JSON.stringify(users, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "bloom_users.json";
    a.click(); URL.revokeObjectURL(url);
  };

  /* ── Escape HTML ─────────────────────────── */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── Init ────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    loadUsers();
    loadStats();
    loadCurrentAnnouncement();

    // Auto-refresh stats every 30s
    setInterval(() => { loadStats(); loadUsers(); }, 30000);
  });
})();