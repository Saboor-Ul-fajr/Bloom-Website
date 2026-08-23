// ══════════════════════════════════════════════
//  BLOOM — money.js
//  Daily spending tracker with monthly summary
// ══════════════════════════════════════════════

window.MoneyModule = (function () {
  "use strict";

  let mMonth = new Date().getMonth() + 1;
  let mYear  = new Date().getFullYear();
  let moneyData  = [];    // array of day records from server
  let customItems = [];   // custom expense rows for selected day

  /* ── Helpers ─────────────────────────────── */
  function daysInMonth(m, y) { return new Date(y, m, 0).getDate(); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function monthLabel(m, y) {
    return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
  }
  function selectedDateStr() {
    const d = document.getElementById("money-day-sel").value;
    return `${mYear}-${pad(mMonth)}-${pad(d)}`;
  }
  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function val(id) { return parseFloat(document.getElementById(id).value) || 0; }

  /* ── Render Page ─────────────────────────── */
  async function render() {
    document.getElementById("money-month-label").textContent = monthLabel(mMonth, mYear);

    const days   = daysInMonth(mMonth, mYear);
    const today  = new Date().getDate();
    const sel    = document.getElementById("money-day-sel");
    const curDay = sel.value || String(today);

    sel.innerHTML = Array.from({ length: days }, (_, i) => {
      const d = i + 1;
      return `<option value="${d}" ${d == curDay ? "selected" : ""}>${d}</option>`;
    }).join("");

    moneyData = await fetch(`/api/money?month=${mMonth}&year=${mYear}`).then((r) => r.json());
    loadDay();
    renderSummary();
  }

  /* ── Load single day ─────────────────────── */
  function loadDay() {
    const ds  = selectedDateStr();
    const day = moneyData.find((m) => m.date === ds) || {};

    document.getElementById("m-breakfast").value = day.breakfast || "";
    document.getElementById("m-lunch").value     = day.lunch     || "";
    document.getElementById("m-dinner").value    = day.dinner    || "";
    document.getElementById("m-cheez").value     = day.cheez     || "";

    customItems = day.custom ? JSON.parse(JSON.stringify(day.custom)) : [];
    renderCustomItems();
    calcTotal();
  }

  /* ── Custom Items ────────────────────────── */
  function renderCustomItems() {
    document.getElementById("custom-items").innerHTML = customItems
      .map(
        (c, i) => `
      <div class="custom-expense-row">
        <input type="text"   placeholder="Item name"
               value="${escHtml(c.name || "")}"
               oninput="MoneyModule.updateCustom(${i},'name',this.value)">
        <input type="number" placeholder="0"
               value="${c.amount || ""}"
               style="width:90px"
               oninput="MoneyModule.updateCustom(${i},'amount',this.value)">
        <button class="btn-icon" onclick="MoneyModule.removeCustom(${i})">✕</button>
      </div>`
      )
      .join("");
  }

  function addCustomExpense() {
    customItems.push({ name: "", amount: "" });
    renderCustomItems();
    calcTotal();
  }

  function removeCustom(i) {
    customItems.splice(i, 1);
    renderCustomItems();
    calcTotal();
  }

  function updateCustom(i, field, value) {
    if (!customItems[i]) return;
    customItems[i][field] = value;
    calcTotal();
  }

  /* ── Totals ──────────────────────────────── */
  function calcTotal() {
    const t =
      val("m-breakfast") +
      val("m-lunch")     +
      val("m-dinner")    +
      val("m-cheez")     +
      customItems.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);

    document.getElementById("day-total").textContent = "Rs " + t.toFixed(0);
  }

  /* ── Save ────────────────────────────────── */
  async function saveDay() {
    calcTotal();
    await fetch("/api/money", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date:      selectedDateStr(),
        breakfast: val("m-breakfast"),
        lunch:     val("m-lunch"),
        dinner:    val("m-dinner"),
        cheez:     val("m-cheez"),
        custom:    customItems.filter((c) => c.name),
      }),
    });
    moneyData = await fetch(`/api/money?month=${mMonth}&year=${mYear}`).then((r) => r.json());
    renderSummary();

    // brief feedback
    const btn = document.getElementById("save-day-btn");
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "✅ Saved!";
      setTimeout(() => (btn.textContent = orig), 1500);
    }
  }

  /* ── Monthly Summary ─────────────────────── */
  function dayTotal(day) {
    if (!day) return 0;
    return (
      (parseFloat(day.breakfast) || 0) +
      (parseFloat(day.lunch)     || 0) +
      (parseFloat(day.dinner)    || 0) +
      (parseFloat(day.cheez)     || 0) +
      (day.custom || []).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)
    );
  }

  function renderSummary() {
    const days  = daysInMonth(mMonth, mYear);
    let total   = 0, maxDay = 0, active = 0;
    let rows    = "";

    for (let d = 1; d <= days; d++) {
      const ds  = `${mYear}-${pad(mMonth)}-${pad(d)}`;
      const day = moneyData.find((m) => m.date === ds);
      const t   = dayTotal(day);
      if (t <= 0) continue;

      total += t; active++;
      if (t > maxDay) maxDay = t;

      const mealTotal  = (parseFloat(day.breakfast)||0)+(parseFloat(day.lunch)||0)+(parseFloat(day.dinner)||0);
      const extraTotal = (parseFloat(day.cheez)||0) + (day.custom||[]).reduce((s,c)=>s+(parseFloat(c.amount)||0),0);

      rows += `<tr>
        <td style="font-weight:700">Day ${d}</td>
        <td>Rs ${(parseFloat(day.breakfast)||0).toFixed(0)}</td>
        <td>Rs ${(parseFloat(day.lunch)||0).toFixed(0)}</td>
        <td>Rs ${(parseFloat(day.dinner)||0).toFixed(0)}</td>
        <td>Rs ${extraTotal.toFixed(0)}</td>
        <td style="font-weight:800;color:var(--straw-core)">Rs ${t.toFixed(0)}</td>
      </tr>`;
    }

    setText("m-month-total", total.toFixed(0));
    setText("m-daily-avg",   active ? (total / active).toFixed(0) : "0");
    setText("m-high-day",    maxDay.toFixed(0));
    setText("m-active-days", active);

    document.getElementById("monthly-table").innerHTML = rows
      ? `<div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr>
              <th>Day</th><th>Breakfast</th><th>Lunch</th>
              <th>Dinner</th><th>Extras</th><th>Total</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      : '<div class="empty-state" style="padding:1.2rem"><p>No spending logged yet this month.</p></div>';
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ── Month navigation ────────────────────── */
  function changeMonth(dir) {
    mMonth += dir;
    if (mMonth > 12) { mMonth = 1;  mYear++; }
    if (mMonth < 1)  { mMonth = 12; mYear--; }
    render();
  }

  return {
    render,
    loadDay,
    saveDay,
    calcTotal,
    addCustomExpense,
    removeCustom,
    updateCustom,
    changeMonth,
  };
})();

// Expose globals for inline onclick
function changeMoneyMonth(dir) { MoneyModule.changeMonth(dir); }
function saveMoneyDay()        { MoneyModule.saveDay(); }
function addCustomExpense()    { MoneyModule.addCustomExpense(); }
function calcDayTotal()        { MoneyModule.calcTotal(); }