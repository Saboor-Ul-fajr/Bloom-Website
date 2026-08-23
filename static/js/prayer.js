// ══════════════════════════════════════════════
//  BLOOM — prayer.js
//  Prayer tracker
//
//  STREAK LOGIC:
//  - Only TODAY's row is clickable/checkable
//  - Past days shown as read-only (greyed)
//  - Streak = how many consecutive days going
//    backwards from today where ALL 5 were done
//  - Streak only increases when you complete
//    all 5 prayers on that actual day
// ══════════════════════════════════════════════

window.PrayerModule = (function () {
  "use strict";

  const PRAYERS = ["Fajr", "Zuhr", "Asr", "Maghrib", "Isha"];
  // Set a date such as "2026-09-07" to test streak milestones; leave empty for today.
  const prayer_test_date = "2026-08-24";

  function referenceDate() {
    return prayer_test_date ? new Date(`${prayer_test_date}T12:00:00`) : new Date();
  }

  let month = referenceDate().getMonth() + 1;
  let year  = referenceDate().getFullYear();

  /* ── Helpers ─────────────────────────────── */
  function daysInMonth(m, y) { return new Date(y, m, 0).getDate(); }
  function pad(n) { return String(n).padStart(2, "0"); }

  function todayStr() {
    const n = referenceDate();
    return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`;
  }

  function makeDateStr(y, m, d) {
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function monthLabel(m, y) {
    return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
  }

  /* ── Fetch ALL prayers for streak calculation ─
     Streak needs to look back across months,
     so we fetch current + previous months       */
  async function fetchAllPrayers() {
    const now = referenceDate();
    const nowM = now.getMonth() + 1;
    const nowY = now.getFullYear();

    // fetch this month
    const r1 = await fetch(`/api/prayers?month=${nowM}&year=${nowY}`);
    const d1 = await r1.json();

    // fetch previous month too (for streaks crossing month boundary)
    let prevM = nowM - 1, prevY = nowY;
    if (prevM < 1) { prevM = 12; prevY--; }
    const r2 = await fetch(`/api/prayers?month=${prevM}&year=${prevY}`);
    const d2 = await r2.json();

    return [...d1, ...d2];
  }

  async function fetchMonthPrayers() {
    const r = await fetch(`/api/prayers?month=${month}&year=${year}`);
    return r.json();
  }

  /* ── Streak Calculators ─────────────────────
     currentStreak : consecutive days backwards
       from today. Today is optional (skip if
       not done yet). First missing past day stops.
     bestStreak    : scans ALL data and finds the
       longest ever consecutive run of full-5 days */

  function buildDayCount(allPrayers) {
    const dayCount = {};
    allPrayers.forEach(p => {
      if (!p.done) return;
      dayCount[p.date] = (dayCount[p.date] || 0) + 1;
    });
    return dayCount;
  }

  function calcCurrentStreak(dayCount) {
    const now = referenceDate();
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d  = new Date(now);
      d.setDate(now.getDate() - i);
      const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      if (i === 0) {
        if (dayCount[ds] === 5) streak++;
        continue;
      }
      if (dayCount[ds] === 5) streak++;
      else break;
    }
    return streak;
  }

  function calcBestStreak(dayCount) {
    const fullDays = Object.keys(dayCount)
      .filter(ds => dayCount[ds] === 5)
      .sort();
    if (!fullDays.length) return 0;
    let best = 1, current = 1;
    for (let i = 1; i < fullDays.length; i++) {
      const prev = new Date(fullDays[i - 1]);
      const curr = new Date(fullDays[i]);
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) { current++; if (current > best) best = current; }
      else current = 1;
    }
    return best;
  }

  /* ── Render ──────────────────────────────── */
  async function render() {
    const lbl = document.getElementById("prayer-month-label");
    if (lbl) lbl.textContent = monthLabel(month, year);

    const [monthData, allData] = await Promise.all([
      fetchMonthPrayers(),
      fetchAllPrayers()
    ]);

    // Build lookup for this month's display
    const map = {};
    monthData.forEach(p => { map[`${p.date}_${p.name}`] = p.done; });

    const days    = daysInMonth(month, year);
    const today   = todayStr();
    const now     = referenceDate();

    // Count stats for this month
    let totalPrayed = 0, totalSlots = 0;

    // Build the monthly grid table
    let html = `<table class="prayer-table">
      <thead><tr>
        <th style="width:44px;text-align:left;padding-left:8px">Day</th>
        ${PRAYERS.map(p => `<th>${p}</th>`).join("")}
        <th style="width:50px">Done</th>
      </tr></thead><tbody>`;

    for (let d = 1; d <= days; d++) {
      const ds       = makeDateStr(year, month, d);
      const isToday  = ds === today;
      const isFuture = new Date(year, month - 1, d) > now;
      const isPast   = !isToday && !isFuture;

      // count for stats (past + today only)
      if (!isFuture) {
        PRAYERS.forEach(p => {
          totalSlots++;
          if (map[`${ds}_${p}`]) totalPrayed++;
        });
      }

      const dayDone  = PRAYERS.filter(p => map[`${ds}_${p}`]).length;
      const allDone  = dayDone === 5;

      // row styling
      let rowStyle = "";
      if (isToday)  rowStyle = "background:rgba(232,54,93,0.07);";
      if (isPast && allDone) rowStyle = "background:rgba(61,122,68,0.06);";
      if (isFuture) rowStyle = "opacity:0.35;";

      html += `<tr style="${rowStyle}">
        <td class="day-cell" style="font-size:0.8rem;font-weight:${isToday?'800':'600'};color:${isToday?'var(--straw-core)':'var(--text-muted)'}">
          ${d}${isToday ? ' <span style="font-size:0.6rem;background:var(--straw-core);color:white;border-radius:4px;padding:1px 4px;vertical-align:middle">TODAY</span>' : ""}
        </td>`;

      PRAYERS.forEach(p => {
        const done = !!map[`${ds}_${p}`];

        if (isToday) {
          // TODAY ONLY — clickable
          html += `<td>
            <div class="prayer-dot ${done ? "done" : ""}"
                 onclick="PrayerModule.toggle('${ds}','${p}')"
                 title="Tap to mark ${p}"
                 style="cursor:pointer;transition:transform 0.15s;"
                 onmouseover="this.style.transform='scale(1.15)'"
                 onmouseout="this.style.transform='scale(1)'">
            </div></td>`;
        } else if (isPast) {
          // PAST — completely locked, no click, no hover
          html += `<td>
            <div class="prayer-dot ${done ? "done" : ""}"
                 style="cursor:not-allowed;pointer-events:none;
                        ${done
                          ? "opacity:0.75;"
                          : "opacity:0.35;background:rgba(0,0,0,0.05);border-color:rgba(0,0,0,0.12);"}"
                 title="${done ? p + " — prayed ✓" : p + " — not prayed"}">
            </div></td>`;
        } else {
          // FUTURE — locked, greyed out
          html += `<td>
            <div class="prayer-dot"
                 style="cursor:not-allowed;pointer-events:none;
                        opacity:0.2;border-style:dashed;border-color:rgba(0,0,0,0.15);"
                 title="Not available yet">
            </div></td>`;
        }
      });

      // daily summary badge
      html += `<td style="text-align:center;font-size:0.78rem;font-weight:700;color:${allDone?'var(--matcha-core)':isPast?'var(--straw-soft)':'var(--text-muted)'}">
        ${isFuture ? "—" : `${dayDone}/5`}
      </td>`;

      html += "</tr>";
    }

    html += "</tbody></table>";
    document.getElementById("prayer-grid").innerHTML = html;

    // Calculate both streaks from ALL prayer data
    const dayCount     = buildDayCount(allData);
    const curStreak    = calcCurrentStreak(dayCount);
    const bestStreak   = calcBestStreak(dayCount);
    const pct          = totalSlots ? Math.round((totalPrayed / totalSlots) * 100) : 0;

    setText("p-prayed",  totalPrayed);
    setText("p-pct",     pct + "%");
    setText("p-streak",  curStreak);
    setText("p-best",    bestStreak);
    if (typeof celebrateStreak === "function") celebrateStreak("prayer", curStreak);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ── Toggle (TODAY only) ─────────────────── */
  async function toggle(ds, name) {
    // Safety: only allow toggling today
    if (ds !== todayStr()) return;

    const r    = await fetch(`/api/prayers?month=${month}&year=${year}`);
    const data = await r.json();
    const rec  = data.find(p => p.date === ds && p.name === name);

    await fetch("/api/prayers", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date: ds, name, done: rec ? !rec.done : true }),
    });

    render();
  }

  /* ── Quick toggle for dashboard ──────────── */
  async function quickToggle(name) {
    const today = todayStr();
    const now = referenceDate();
    const nowM  = now.getMonth() + 1;
    const nowY  = now.getFullYear();
    const r     = await fetch(`/api/prayers?month=${nowM}&year=${nowY}`);
    const data  = await r.json();
    const rec   = data.find(p => p.date === today && p.name === name);

    await fetch("/api/prayers", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date: today, name, done: rec ? !rec.done : true }),
    });
  }

  /* ── Month navigation ────────────────────── */
  function changeMonth(dir) {
    month += dir;
    if (month > 12) { month = 1;  year++; }
    if (month < 1)  { month = 12; year--; }
    render();
  }

  return { render, toggle, quickToggle, changeMonth };
})();

// Expose for inline onclick attributes
function changePrayerMonth(dir) { PrayerModule.changeMonth(dir); }
function togglePrayer(ds, name) { PrayerModule.toggle(ds, name); }