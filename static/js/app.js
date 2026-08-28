// ══════════════════════════════════════════════
//  BLOOM — Main App JavaScript
// ══════════════════════════════════════════════

// ─── Utility ──────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const todayDT = () => new Date();
const api = async (url, method = 'GET', body = null) => {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  return r.json();
};

const STREAK_MILESTONES = [7, 10, 15, 30, 50, 100, 200, 300, 400, 500];
const celebratedStreaks = JSON.parse(localStorage.getItem('bloom-celebrated-streaks') || '{}');

function playWoohoo() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const now = context.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.1 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.1 + 0.35);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + index * 0.1);
    oscillator.stop(now + index * 0.1 + 0.35);
  });
}

function celebrateStreak(type, streak, itemId = 'all') {
  const milestone = [...STREAK_MILESTONES].reverse().find(value => streak >= value);
  if (!milestone) return;
  const key = `${type}:${itemId}:${milestone}`;
  if (celebratedStreaks[key]) return;
  celebratedStreaks[key] = true;
  localStorage.setItem('bloom-celebrated-streaks', JSON.stringify(celebratedStreaks));
  const overlay = $('#streak-celebration');
  const message = $('#streak-celebration-message');
  if (!overlay || !message) return;
  message.textContent = `${milestone}-day ${type} streak! You are doing amazing.`;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  playWoohoo();
}

function closeStreakCelebration() {
  const overlay = $('#streak-celebration');
  overlay?.classList.remove('show');
  overlay?.setAttribute('aria-hidden', 'true');
}

// ─── Toast ────────────────────────────────────
function showToast(title, msg, persistent = false) {
  const t = $('#toast');
  $('#toast-title').textContent = title;
  $('#toast-msg').textContent = msg;
  t.classList.add('show');
  t.classList.toggle('persistent', persistent);
  clearTimeout(t._timer);
  if (!persistent) t._timer = setTimeout(() => t.classList.remove('show'), 4500);
}

// ─── Navigation ───────────────────────────────
let pageTrail = [];
let pageTrailIndex = -1;

function showPage(name) {
  if (pageTrail[pageTrailIndex] !== name) {
    pageTrail = pageTrail.slice(0, pageTrailIndex + 1);
    pageTrail.push(name);
    pageTrailIndex++;
  }
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = $(`#page-${name}`);
  if (pg) pg.classList.add('active');
  const nav = $(`.nav-item[data-page="${name}"]`);
  if (nav) nav.classList.add('active');
  // close mobile sidebar
  closeMobileSidebar();
  // render
  const renders = {
    dashboard: renderDashboard,
    prayer: renderPrayer,
    thoughts: renderThoughts,
    tasks: renderTasks,
    habits: renderHabits,
    money: renderMoney,
    'money-details': renderMoneyDetails,
    books: renderBooks
  };
  if (renders[name]) renders[name]();
  updateMobileNavigation();
}

function moveMobilePage(direction) {
  const nextIndex = pageTrailIndex + direction;
  if (nextIndex < 0 || nextIndex >= pageTrail.length) return;
  pageTrailIndex = nextIndex;
  showPage(pageTrail[pageTrailIndex]);
}

function updateMobileNavigation() {
  const back = $('#mobile-back');
  const forward = $('#mobile-forward');
  if (back) back.disabled = pageTrailIndex <= 0;
  if (forward) forward.disabled = pageTrailIndex >= pageTrail.length - 1;
}

function closeMobileSidebar() {
  $('#sidebar')?.classList.remove('open');
  $('#sidebar-backdrop')?.classList.remove('visible');
}

function toggleMobileSidebar() {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  sidebar?.classList.toggle('open');
  backdrop?.classList.toggle('visible', sidebar?.classList.contains('open'));
}

// ─── Mobile Toggle ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const toggle = $('#mobile-toggle');
  if (toggle) toggle.addEventListener('click', toggleMobileSidebar);
  $('#sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);
  document.addEventListener('click', event => {
    const sidebar = $('#sidebar');
    if (!sidebar?.classList.contains('open')) return;
    if (sidebar.contains(event.target) || toggle?.contains(event.target)) return;
    closeMobileSidebar();
  });
  $('#mobile-back')?.addEventListener('click', () => moveMobilePage(-1));
  $('#mobile-forward')?.addEventListener('click', () => moveMobilePage(1));
  $('#toast-close')?.addEventListener('click', () => {
    $('#toast')?.classList.remove('show', 'persistent');
  });
  $('#streak-celebration-close')?.addEventListener('click', closeStreakCelebration);
  $('#streak-celebration')?.addEventListener('click', event => {
    if (event.target.id === 'streak-celebration') closeStreakCelebration();
  });
  registerPushWorker();
  $('#enable-notifications')?.addEventListener('click', enablePushNotifications);

  // initial page
  const current = document.body.dataset.page || 'dashboard';
  showPage(current);

  // check announcement
  loadAnnouncement();

  // 10pm reminder & task overdue check
  scheduleReminders();
  setInterval(check10pm, 60000);
});

// ─── Announcement ─────────────────────────────
async function loadAnnouncement() {
  const area = $('#announcement-area');
  if (!area) return;
  const a = await api('/api/admin/announcement');
  const dismissedId = localStorage.getItem('bloom-dismissed-announcement');
  if (a && String(a.id) !== dismissedId) {
    area.innerHTML = `<div class="announce-banner">
      <button class="announce-dismiss" type="button" aria-label="Dismiss announcement" onclick="dismissAnnouncement(${a.id})">×</button>
      <span class="a-badge">📢 NOTICE</span>
      <div class="a-text">${escHtml(a.text)}</div>
      <div class="a-date">${a.date}</div>
    </div>`;
  } else {
    area.innerHTML = '';
  }
}

function dismissAnnouncement(id) {
  localStorage.setItem('bloom-dismissed-announcement', String(id));
  $('#announcement-area').innerHTML = '';
}

// ─── Dashboard ────────────────────────────────
async function renderDashboard() {
  const pg = $('#page-dashboard');
  if (!pg) return;
  const now = todayDT();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const greet = minutes >= 360 && minutes <= 780 ? 'Good morning'
    : minutes >= 781 && minutes <= 1010 ? 'Good afternoon'
    : minutes >= 1011 && minutes <= 1140 ? 'Good evening'
    : 'Good night';
  const greetEl = $('#dash-greeting');
  if (greetEl) greetEl.textContent = greet + '!';

  // stats
  const [prayers, tasks, thoughts, books, habits] = await Promise.all([
    api(`/api/prayers?month=${todayDT().getMonth()+1}&year=${todayDT().getFullYear()}`),
    api('/api/tasks'),
    api('/api/thoughts'),
    api('/api/books'),
    api('/api/habits')
  ]);

  const todayStr = today();
  const todayPrayed = prayers.filter(p => p.date === todayStr && p.done).length;
  const pending = tasks.filter(t => !t.done).length;

  const sg = $('#dash-stats');
  if (sg) sg.innerHTML = `
    <div class="stat-card pink"><div class="stat-icon">🕌</div><div class="stat-val">${todayPrayed}/5</div><div class="stat-label">Prayers Today</div></div>
    <div class="stat-card green"><div class="stat-icon">✅</div><div class="stat-val">${pending}</div><div class="stat-label">Pending Tasks</div></div>
    <div class="stat-card rose"><div class="stat-icon">📓</div><div class="stat-val">${thoughts.length}</div><div class="stat-label">Thoughts</div></div>
    <div class="stat-card sage"><div class="stat-icon">📚</div><div class="stat-val">${books.length}</div><div class="stat-label">Books</div></div>
    <div class="stat-card pink"><div class="stat-icon">🌙</div><div class="stat-val">${habits.length}</div><div class="stat-label">Habits</div></div>
  `;

  // quick prayer strip
  const pnames = ['Fajr','Zuhr','Asr','Maghrib','Isha'];
  const dp = $('#dash-prayers');
  if (dp) {
    dp.innerHTML = pnames.map(p => {
      const done = prayers.find(r => r.date === todayStr && r.name === p && r.done);
      return `<div style="text-align:center">
        <div class="prayer-dot ${done ? 'done' : ''}" onclick="quickTogglePrayer('${p}')" title="${p}"></div>
        <div style="font-size:0.68rem;margin-top:4px;color:var(--text-muted);font-weight:700">${p}</div>
      </div>`;
    }).join('');
  }

  // today's tasks
  const dt = $('#dash-tasks');
  if (dt) {
    const upcoming = tasks.filter(t => !t.done).slice(0, 5);
    dt.innerHTML = upcoming.length
      ? upcoming.map(t => `<div class="task-item ${t.done ? 'done' : ''}">
          <div class="task-check-box ${t.done?'done':''}" onclick="toggleTask(${t.id})">${t.done?'✓':''}</div>
          <div style="flex:1"><div class="task-text-main ${t.done ? 'done' : ''}">${escHtml(t.text)}</div>${t.deadline?`<div class="task-deadline ${isOverdue(t.deadline)?'task-overdue':''}">${fmtDeadline(t.deadline)}</div>`:''}${t.reminder?`<div class="task-reminder">🔔 ${fmtReminder(t.reminder)}</div>`:''}</div>
          <span class="priority-pill p-${t.priority}">${t.priority}</span>
        </div>`).join('')
      : '<div class="empty-state"><span class="empty-icon">😊</span><p>All clear! No pending tasks.</p></div>';
  }
}

async function quickTogglePrayer(name) {
  const todayStr = today();
  const existing = await api(`/api/prayers?month=${todayDT().getMonth()+1}&year=${todayDT().getFullYear()}`);
  const rec = existing.find(p => p.date === todayStr && p.name === name);
  await api('/api/prayers', 'POST', { date: todayStr, name, done: rec ? !rec.done : true });
  renderDashboard();
}

// ─── Prayer ───────────────────────────────────
let pMonth = todayDT().getMonth() + 1;
let pYear  = todayDT().getFullYear();

// Prayer rendering is handled entirely by prayer.js (PrayerModule)
// app.js just delegates to it

function renderPrayer() {
  if (typeof PrayerModule !== 'undefined') {
    PrayerModule.render();
  }
}

function togglePrayer(dateStr, name) {
  // only today allowed — prayer.js enforces this
  if (typeof PrayerModule !== 'undefined') {
    PrayerModule.toggle(dateStr, name);
  }
}

function changePrayerMonth(dir) {
  if (typeof PrayerModule !== 'undefined') {
    PrayerModule.changeMonth(dir);
  }
}

// ─── Thoughts ─────────────────────────────────
let thoughtFilter = 'all';

async function renderThoughts() {
  const data = await api('/api/thoughts');
  const list = $('#thought-list');
  let items = data;
  if (thoughtFilter === 'fav') items = items.filter(t => t.fav);
  list.innerHTML = items.length
    ? items.map(t => `<div class="thought-item ${t.fav?'fav':''}">
        <div style="flex:1">
          <div class="thought-text">${escHtml(t.text)}</div>
          <div class="thought-meta">${t.date}</div>
        </div>
        <div class="thought-actions">
          <button class="btn-icon" onclick="toggleFav(${t.id})" title="Favourite">${t.fav?'⭐':'☆'}</button>
          <button class="btn-icon" onclick="deleteThought(${t.id})" title="Delete">🗑️</button>
        </div>
      </div>`).join('')
    : '<div class="empty-state"><span class="empty-icon">📓</span><p>Nothing here yet. Write something!</p></div>';
}

async function addThought() {
  const inp = $('#thought-input');
  const text = inp.value.trim();
  if (!text) return;
  await api('/api/thoughts', 'POST', { text });
  inp.value = '';
  renderThoughts();
}

async function toggleFav(id) {
  await api(`/api/thoughts/${id}/fav`, 'POST');
  renderThoughts();
}

async function deleteThought(id) {
  await api(`/api/thoughts/${id}`, 'DELETE');
  renderThoughts();
}

function filterThoughts(f, btn) {
  thoughtFilter = f;
  $$('#page-thoughts .ftab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderThoughts();
}

// ─── Tasks ────────────────────────────────────
let taskFilter = 'pending';

async function renderTasks() {
  const data = await api('/api/tasks');
  const list = $('#task-list');
  let items = data;
  if (taskFilter === 'pending') items = items.filter(t => !t.done);
  if (taskFilter === 'done') items = items.filter(t => t.done);
  list.innerHTML = items.length
    ? items.map(t => `<div class="task-item">
        <div class="task-check-box ${t.done?'done':''}" onclick="toggleTask(${t.id})">${t.done?'✓':''}</div>
        <div style="flex:1">
          <div class="task-text-main ${t.done?'done':''}">${escHtml(t.text)}</div>
          ${t.deadline ? `<div class="task-deadline ${isOverdue(t.deadline)&&!t.done?'task-overdue':''}">${fmtDeadline(t.deadline)}</div>` : ''}
          ${t.reminder ? `<div class="task-reminder">🔔 ${fmtReminder(t.reminder)}</div>` : ''}
        </div>
        <span class="priority-pill p-${t.priority}">${t.priority}</span>
        <button class="btn-icon" onclick="deleteTask(${t.id})">🗑️</button>
      </div>`).join('')
    : '<div class="empty-state"><span class="empty-icon">✅</span><p>No tasks here!</p></div>';
}

async function addTask() {
  const text = $('#task-input').value.trim();
  const deadline = $('#task-deadline').value || null;
  const reminder = $('#task-reminder').value || null;
  const priority = $('#task-priority').value;
  if (!text) return;
  await api('/api/tasks', 'POST', { text, deadline, reminder, priority });
  requestNotificationPermission();
  $('#task-input').value = '';
  $('#task-deadline').value = '';
  $('#task-reminder').value = '';
  $('#task-priority').value = 'medium';
  renderTasks();
}

async function toggleTask(id) {
  await api(`/api/tasks/${id}/toggle`, 'POST');
  renderDashboard();
  renderTasks();
}

async function deleteTask(id) {
  await api(`/api/tasks/${id}`, 'DELETE');
  renderTasks();
}

function filterTasks(f, btn) {
  taskFilter = f;
  $$('#page-tasks .ftab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTasks();
}

// ─── Habits ───────────────────────────────────
let habitMonth = todayDT().getMonth() + 1;
let habitYear  = todayDT().getFullYear();

async function renderHabits() {
  const data = await api('/api/habits');
  const list = $('#habit-list');
  const now = new Date();
  const days = daysInMonth(habitMonth, habitYear);
  const todayKey = today();

  if (!data.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">🌙</span><p>Add a habit to start tracking!</p></div>';
    return;
  }

  list.innerHTML = data.map(h => {
    const logSet = new Set(h.logs);
    const doneThisMonth = h.logs.filter(l => l.startsWith(`${habitYear}-${String(habitMonth).padStart(2,'0')}`)).length;
    const streak     = calcHabitStreak(h.logs, now);
    const bestStreak = calcHabitBestStreak(h.logs);
    const todayDone  = logSet.has(todayKey);
    celebrateStreak('habit', streak, h.id);

    // Build the monthly read-only view dots
    const dots = Array.from({length: days}, (_, i) => {
      const d = i + 1;
      const key = `${habitYear}-${String(habitMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = key === todayKey;
      const isFuture = new Date(habitYear, habitMonth - 1, d) > now;
      const checked = logSet.has(key);

      if (isToday) {
        // today: clickable
        return `<div class="habit-dot ${checked ? 'done' : ''}"
          onclick="toggleHabit(${h.id},'${key}')"
          title="Today — tap to toggle"
          style="cursor:pointer;border-width:2.5px;${checked ? '' : 'border-color:var(--matcha-core);'}">${d}</div>`;
      } else if (isFuture) {
        // future: locked, dashed
        return `<div class="habit-dot"
          style="cursor:not-allowed;opacity:0.25;border-style:dashed;"
          title="Future">${d}</div>`;
      } else {
        // past: read-only
        return `<div class="habit-dot ${checked ? 'done' : 'missed'}"
          style="cursor:default;${checked ? '' : 'background:rgba(232,54,93,0.07);border-color:rgba(232,54,93,0.2);color:rgba(232,54,93,0.4);'}"
          title="Day ${d} — ${checked ? 'done ✓' : 'missed'}">${d}</div>`;
      }
    }).join('');

    // Today's big checkbox at the top
    const todayCheckbox = `
      <div onclick="toggleHabit(${h.id},'${todayKey}')"
           style="display:flex;align-items:center;gap:10px;cursor:pointer;
                  padding:10px 14px;border-radius:12px;margin-bottom:10px;
                  background:${todayDone ? 'linear-gradient(135deg,var(--matcha-mist),var(--matcha-cream))' : 'linear-gradient(135deg,var(--straw-cream),var(--straw-mist))'};
                  border:2px solid ${todayDone ? 'var(--matcha-light)' : 'var(--straw-blush)'};">
        <div style="width:28px;height:28px;border-radius:8px;flex-shrink:0;
                    display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;
                    background:${todayDone ? 'var(--matcha-core)' : 'white'};
                    border:2.5px solid ${todayDone ? 'var(--matcha-rich)' : 'var(--straw-blush)'};
                    color:white;">
          ${todayDone ? '✓' : ''}
        </div>
        <span style="font-weight:700;font-size:0.9rem;color:${todayDone ? 'var(--matcha-deep)' : 'var(--text-mid)'}">
          ${todayDone ? 'Done today! Great job 🌿' : 'Mark today as done'}
        </span>
      </div>`;

    return `<div class="habit-block">
      <div class="habit-header">
        <span class="habit-name">${escHtml(h.name)}</span>
        <span class="habit-streak">🔥 ${streak} day${streak !== 1 ? 's' : ''}</span>
        <span style="font-size:0.82rem;font-weight:700;color:var(--straw-rich)">🏆 Best: ${bestStreak}</span>
        <span style="font-size:0.8rem;color:var(--matcha-rich);font-weight:700">${doneThisMonth}/${days} this month</span>
        <button class="btn-icon" onclick="deleteHabit(${h.id})">🗑️</button>
      </div>
      ${todayCheckbox}
      <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px">Monthly view</div>
      <div class="habit-dots">${dots}</div>
    </div>`;
  }).join('');
}

// ── Habit Streaks ───────────────────────────────
// currentStreak : backwards from today, today optional
// bestStreak    : longest ever consecutive run

function calcHabitStreak(logs, now) {
  const set = new Set(logs);
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d   = new Date(now);
    d.setDate(now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (i === 0) { if (set.has(key)) streak++; continue; }
    if (set.has(key)) streak++; else break;
  }
  return streak;
}

function calcHabitBestStreak(logs) {
  const sorted = [...logs].sort(); // "YYYY-MM-DD" sorts correctly
  if (!sorted.length) return 0;
  let best = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev     = new Date(sorted[i - 1]);
    const curr     = new Date(sorted[i]);
    const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) { current++; if (current > best) best = current; }
    else current = 1;
  }
  return best;
}

async function addHabit() {
  const name = $('#habit-input').value.trim();
  if (!name) return;
  await api('/api/habits', 'POST', { name });
  $('#habit-input').value = '';
  renderHabits();
}

async function toggleHabit(id, dateStr) {
  await api(`/api/habits/${id}/toggle`, 'POST', { date: dateStr });
  renderHabits();
}

async function deleteHabit(id) {
  await api(`/api/habits/${id}`, 'DELETE');
  renderHabits();
}

// ─── Money ────────────────────────────────────
let mMonth = todayDT().getMonth() + 1;
let mYear  = todayDT().getFullYear();
let moneyData = [];
let allMoneyHistory = [];
let customItems = [];
let moneyBalance = parseFloat(localStorage.getItem('bloom.money.balance')) || 0;
let daySpendTotal = 0;

function getMoneyCycleState() {
  try {
    const state = JSON.parse(localStorage.getItem('bloom.money.cycle') || '{}');
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function saveMoneyCycleState(state) {
  localStorage.setItem('bloom.money.cycle', JSON.stringify(state));
}

function getCycleStartDate() {
  return getMoneyCycleState().startDate || today();
}

function getCycleStartingAmount() {
  const state = getMoneyCycleState();
  if (state.startingAmount != null) return parseFloat(state.startingAmount);
  return moneyBalance;
}

function getCurrentCycleSpent() {
  const cycleStartDate = getCycleStartDate();
  const historyTotal = (allMoneyHistory || []).reduce((sum, day) => {
    const dayDate = day.date;
    if (!dayDate || dayDate < cycleStartDate) return sum;
    const dayTotal = (+day.breakfast || 0) + (+day.lunch || 0) + (+day.dinner || 0) + (+day.cheez || 0) + (day.custom || []).reduce((s, c) => s + (+c.amount || 0), 0);
    return sum + dayTotal;
  }, 0);
  return historyTotal + daySpendTotal;
}

function getTotalSpentSoFar() {
  return getCurrentCycleSpent();
}

async function renderMoney() {
  $('#money-month-label').textContent = monthLabel(mMonth, mYear);
  const days = daysInMonth(mMonth, mYear);
  const sel = $('#money-day-sel');
  const todayObj = todayDT();
  const isCurrentMonth = mYear === todayObj.getFullYear() && mMonth === todayObj.getMonth() + 1;
  const maxSelectableDay = isCurrentMonth ? todayObj.getDate() : days;
  const curDay = Math.min(parseInt(sel.value || String(todayObj.getDate()), 10), maxSelectableDay);

  sel.innerHTML = Array.from({ length: maxSelectableDay }, (_, i) => {
    const d = i + 1;
    return `<option value="${d}" ${d === curDay ? 'selected' : ''}>${d}</option>`;
  }).join('');

  const [monthData, historyData] = await Promise.all([
    api(`/api/money?month=${mMonth}&year=${mYear}`),
    api('/api/money?all=1')
  ]);

  moneyData = monthData;
  allMoneyHistory = historyData;
  loadMoneyDay();
  renderMoneyBalance();
  renderMonthlySummary();
  if (document.getElementById('page-money-details').classList.contains('active')) {
    renderMoneyDetails();
  }
}

function moneyDateStr() {
  const d = $('#money-day-sel').value;
  return `${mYear}-${String(mMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function getForwardAmountFor(dateStr) {
  const day = moneyData.find(m => m.date === dateStr);
  if (day && day.amount != null) return day.amount;

  let lastAmount = '';
  for (const entry of allMoneyHistory) {
    if (!entry.date || entry.date >= dateStr) break;
    if (entry.amount != null) lastAmount = entry.amount;
  }
  return lastAmount;
}

function loadMoneyDay() {
  const ds = moneyDateStr();
  const day = moneyData.find(m => m.date === ds) || {};
  const amount = day.amount != null && day.amount !== '' ? day.amount : getForwardAmountFor(ds);
  $('#m-amount').value = amount || '';
  $('#m-breakfast').value = day.breakfast || '';
  $('#m-lunch').value = day.lunch || '';
  $('#m-dinner').value = day.dinner || '';
  $('#m-cheez').value = day.cheez || '';
  customItems = day.custom ? [...day.custom] : [];
  renderCustomItems();
  calcDayTotal();
}

async function saveMoneyDay() {
  calcDayTotal();
  const ds = moneyDateStr();
  await api('/api/money', 'POST', {
    date: ds,
    breakfast: +$('#m-breakfast').value||0,
    lunch: +$('#m-lunch').value||0,
    dinner: +$('#m-dinner').value||0,
    cheez: +$('#m-cheez').value||0,
    amount: +$('#m-amount').value||0,
    custom: customItems.filter(c => c.name)
  });
  allMoneyHistory = await api('/api/money?all=1');
  moneyData = await api(`/api/money?month=${mMonth}&year=${mYear}`);
  renderMoneyBalance();
  renderMonthlySummary();
  if (document.getElementById('page-money-details').classList.contains('active')) {
    renderMoneyDetails();
  }
}

function getMoneyDayTotal() {
  const b = +$('#m-breakfast').value || 0;
  const l = +$('#m-lunch').value || 0;
  const d = +$('#m-dinner').value || 0;
  const c = +$('#m-cheez').value || 0;
  const ex = customItems.reduce((s, x) => s + (+x.amount || 0), 0);
  return b + l + d + c + ex;
}

function renderMoneyBalance() {
  $('#money-available').textContent = 'Rs ' + moneyBalance.toFixed(0);
  $('#money-after-food').textContent = 'Rs ' + Math.max(moneyBalance - getTotalSpentSoFar(), 0).toFixed(0);
}

function addMoneyToBalance() {
  const amount = +$('#money-add-amount').value || 0;
  if (amount <= 0) return;

  const previousStartingAmount = getCycleStartingAmount();
  const previousSpentAmount = getCurrentCycleSpent();
  const remainingBalance = previousStartingAmount - previousSpentAmount;
  const newStartingAmount = amount + remainingBalance;

  moneyBalance = newStartingAmount;
  localStorage.setItem('bloom.money.balance', moneyBalance.toFixed(0));
  saveMoneyCycleState({
    startDate: today(),
    startingAmount: moneyBalance.toFixed(0)
  });
  $('#money-add-amount').value = '';
  renderMoneyBalance();
  showToast('Cycle reset', `New cycle starts at Rs ${moneyBalance.toFixed(0)}.`);
}

function clearMoneyBalance() {
  moneyBalance = 0;
  localStorage.setItem('bloom.money.balance', '0');
  saveMoneyCycleState({
    startDate: today(),
    startingAmount: '0'
  });
  $('#money-add-amount').value = '';
  renderMoneyBalance();
  showToast('Cleared', 'This week\'s money was reset to Rs 0.');
}

function cancelTodaySpending() {
  daySpendTotal = 0;
  $('#m-breakfast').value = '';
  $('#m-lunch').value = '';
  $('#m-dinner').value = '';
  $('#m-cheez').value = '';
  customItems = [];
  renderCustomItems();
  renderMoneyBalance();
}

function renderCustomItems() {
  const el = $('#custom-items');
  el.innerHTML = customItems.map((c, i) => `
    <div class="custom-expense-row">
      <input type="text" placeholder="Item name" value="${escAttr(c.name||'')}" oninput="customItems[${i}].name=this.value;calcDayTotal()">
      <input type="number" placeholder="0" value="${c.amount||''}" style="width:90px" oninput="customItems[${i}].amount=this.value;calcDayTotal()">
      <button class="btn-icon" onclick="removeCustom(${i})">✕</button>
    </div>`).join('');
}

function addCustomExpense() {
  customItems.push({ name: '', amount: '' });
  renderCustomItems();
}

function removeCustom(i) {
  customItems.splice(i, 1);
  renderCustomItems();
  calcDayTotal();
}

function calcDayTotal() {
  const b = +$('#m-breakfast').value||0;
  const l = +$('#m-lunch').value||0;
  const d = +$('#m-dinner').value||0;
  const c = +$('#m-cheez').value||0;
  const ex = customItems.reduce((s, x) => s + (+x.amount||0), 0);
  daySpendTotal = b + l + d + c + ex;
  $('#day-total').textContent = 'Rs ' + daySpendTotal.toFixed(0);
  renderMoneyBalance();
}

function renderMonthlySummary() {
  const days = daysInMonth(mMonth, mYear);
  let total = 0, maxDay = 0, active = 0, rows = '';
  for (let d = 1; d <= days; d++) {
    const ds = `${mYear}-${String(mMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const day = moneyData.find(m => m.date === ds);
    if (!day) continue;
    const t = (+day.breakfast||0)+(+day.lunch||0)+(+day.dinner||0)+(+day.cheez||0)+(day.custom||[]).reduce((s,c)=>s+(+c.amount||0),0);
    if (t > 0) { total += t; active++; if (t > maxDay) maxDay = t; rows += `<tr><td>Day ${d}</td><td>Rs ${(+day.breakfast||0).toFixed(0)}</td><td>Rs ${(+day.lunch||0).toFixed(0)}</td><td>Rs ${(+day.dinner||0).toFixed(0)}</td><td style="font-weight:700;color:var(--straw-rich)">Rs ${t.toFixed(0)}</td></tr>`; }
  }
  $('#m-month-total').textContent = total.toFixed(0);
  $('#m-daily-avg').textContent   = active ? (total/active).toFixed(0) : '0';
  $('#m-high-day').textContent    = maxDay.toFixed(0);
  $('#monthly-table').innerHTML   = rows
    ? `<table class="data-table"><thead><tr><th>Day</th><th>Breakfast</th><th>Lunch</th><th>Dinner</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty-state" style="padding:1rem"><p>No spending logged yet.</p></div>';
}

async function renderMoneyDetails() {
  const list = $('#money-details-list');
  const label = $('#money-details-month-label');
  if (label) label.textContent = 'All spending history';
  if (!list) return;

  const history = await api('/api/money?all=1');
  if (!history.length) {
    list.innerHTML = '<div class="money-detail-empty">No spending notes yet. Your cozy little tracker is empty.</div>';
    return;
  }

  const details = history.map((day) => {
    const pieces = [];
    const totals = [];
    if ((+day.breakfast || 0) > 0) { pieces.push(`☀️ Breakfast • Rs ${(+day.breakfast || 0).toFixed(0)}`); totals.push(+day.breakfast || 0); }
    if ((+day.lunch || 0) > 0) { pieces.push(`🌤 Lunch • Rs ${(+day.lunch || 0).toFixed(0)}`); totals.push(+day.lunch || 0); }
    if ((+day.dinner || 0) > 0) { pieces.push(`🌙 Dinner • Rs ${(+day.dinner || 0).toFixed(0)}`); totals.push(+day.dinner || 0); }
    if ((+day.cheez || 0) > 0) { pieces.push(`🍫 Cheez • Rs ${(+day.cheez || 0).toFixed(0)}`); totals.push(+day.cheez || 0); }
    if ((+day.amount || 0) > 0) { pieces.push(`💰 Daily amount • Rs ${(+day.amount || 0).toFixed(0)}`); }
    (day.custom || []).filter(c => c.name).forEach(c => {
      pieces.push(`✨ ${c.name} • Rs ${(+(c.amount) || 0).toFixed(0)}`);
      totals.push(+(c.amount) || 0);
    });

    const total = totals.reduce((s, v) => s + v, 0);
    const dateParts = String(day.date).split('-');
    const labelText = dateParts.length === 3 ? `${new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2])).toLocaleString('default', { month: 'short', day: 'numeric', year: 'numeric' })}` : day.date;
    return `<div class="money-detail-item">
      <div class="money-detail-day">${labelText}</div>
      <div class="money-detail-text">${pieces.join('<br>')}</div>
      <div class="money-detail-pill">Rs ${total.toFixed(0)}</div>
    </div>`;
  });

  list.innerHTML = details.join('');
}

async function clearPreviousMonthDetails() {
  toggleMoneyDeleteMonths();
}

function changeMoneyMonth(dir) {
  mMonth += dir;
  if (mMonth > 12) { mMonth = 1; mYear++; }
  if (mMonth < 1)  { mMonth = 12; mYear--; }
  renderMoney();
}

function changeMoneyDetailsMonth(dir) {
  mMonth += dir;
  if (mMonth > 12) { mMonth = 1; mYear++; }
  if (mMonth < 1)  { mMonth = 12; mYear--; }
  renderMoneyDetails();
}

// ─── Books ────────────────────────────────────
// New money workflow: the server persists state; this date is always browser-local.
let moneyState = null;
let moneyHistory = [];
// Set a date such as '2026-08-24' for rollover testing; leave empty for the real local date.
const MONEY_LOG_TEST_DATE = ''; // Set to YYYY-MM-DD only while testing a past date
const moneyBoxes = ['breakfast', 'lunch', 'dinner', 'snacks', 'others'];

function moneyWorkingDate() { return MONEY_LOG_TEST_DATE || today(); }

async function loadMoneyState() {
  const result = await api(`/api/money?state=1&all=1&today_date=${moneyWorkingDate()}`);
  moneyState = result.state;
  moneyHistory = result.history || [];
  renderMoneyState();
  renderMoneyDetailsList();
}

function currentMoneyTotal() {
  return moneyBoxes.reduce((sum, box) => sum + (+moneyState?.[box] || 0), 0);
}

function renderMoneyState() {
  if (!moneyState) return;
  const todayTotal = currentMoneyTotal();
  const after = (+moneyState.total_entered || 0) - (+moneyState.old_spending || 0) - todayTotal;
  $('#money-total-entered').textContent = `Rs ${(+moneyState.total_entered || 0).toFixed(2)}`;
  $('#money-after-spending').textContent = `Rs ${after.toFixed(2)}`;
  $('#money-after-spending').classList.toggle('money-negative', after < 0);
  $('#money-today-total').textContent = `Rs ${todayTotal.toFixed(2)}`;
  const [year, month, day] = moneyState.today_date.split('-').map(Number);
  $('#money-today-date').textContent = new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  moneyBoxes.forEach(box => {
    const input = $(`#m-${box}`);
    if (input) input.value = moneyState[box] || '';
  });
  renderOtherItems();
  $('#save-day-btn')?.classList.toggle('saved', Boolean(moneyState.today_saved));
  renderWeeklySummary();
}

function renderOtherItems() {
  const list = $('#money-other-items');
  if (!list) return;
  const items = moneyState.other_items || [];
  list.innerHTML = items.map((item, index) => `<div class="money-other-item"><input type="text" placeholder="Item name" value="${escAttr(item.name || '')}" oninput="updateOtherItem(${index}, 'name', this.value)"><input type="number" min="0" placeholder="0" value="${item.amount || ''}" oninput="updateOtherItem(${index}, 'amount', this.value)"><button type="button" class="btn-icon" onclick="removeOtherItem(${index})">x</button></div>`).join('');
}

function addOtherItem() {
  moneyState.other_items = [...(moneyState.other_items || []), { name: '', amount: 0 }];
  renderOtherItems();
}

function updateOtherItem(index, field, value) {
  const item = moneyState?.other_items?.[index];
  if (!item) return;
  item[field] = field === 'amount' ? Math.max(+value || 0, 0) : value;
  moneyState.others = moneyState.other_items.reduce((sum, entry) => sum + (+entry.amount || 0), 0);
  renderMoneyState();
  saveOtherItemsLive();
}

function removeOtherItem(index) {
  moneyState.other_items.splice(index, 1);
  moneyState.others = moneyState.other_items.reduce((sum, entry) => sum + (+entry.amount || 0), 0);
  renderMoneyState();
  saveOtherItemsLive();
}

async function saveOtherItemsLive() {
  await api('/api/money', 'POST', { today_date: moneyWorkingDate(), others: moneyState.others, other_items: moneyState.other_items });
}

async function renderMoney() { await loadMoneyState(); }

async function updateMoneyBox(box, value) {
  if (!moneyState || moneyState.today_date !== moneyWorkingDate()) { await loadMoneyState(); return; }
  moneyState[box] = Math.max(+value || 0, 0);
  renderMoneyState();
  await api('/api/money', 'POST', { today_date: moneyWorkingDate(), [box]: moneyState[box] });
  await loadMoneyState();
}

async function addMoneyToBalance() {
  const amount = +$('#money-add-amount').value || 0;
  if (amount <= 0) return;
  await api('/api/money', 'POST', { action: 'add-money', amount, today_date: moneyWorkingDate() });
  $('#money-add-amount').value = '';
  await loadMoneyState();
}

async function clearMoneyBalance() {
  if (!confirm('Delete the total entered and running balance? History will remain.')) return;
  const result = await api('/api/money', 'POST', { action: 'delete-total', today_date: moneyWorkingDate() });
  if (!result.ok) { showToast('Save required', result.error || 'Save today before deleting the total.'); return; }
  await loadMoneyState();
}

function renderWeeklySummary() {
  // Spending summary shows the current day and six previous local calendar days.
  renderMoneySummary('weekly');
}

function moneyDayTotal(day) { return moneyBoxes.reduce((sum, box) => sum + (+day[box] || 0), 0); }

function formatMoneyDate(dateString) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  if (!year || !month || !day) return dateString;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function moneyHistoryWithToday() {
  if (!moneyState || (!moneyState.today_saved && moneyDayTotal(moneyState) <= 0)) return moneyHistory;
  return [{ ...moneyState, date: moneyWorkingDate(), isToday: true }, ...moneyHistory.filter(day => day.date !== moneyWorkingDate())];
}

function renderMoneySummary(mode) {
  const summaries = $$('.money-summary-content');
  if (!summaries.length) return;
  const [workingYear, workingMonth, workingDay] = moneyWorkingDate().split('-').map(Number);
  const now = new Date(workingYear, workingMonth - 1, workingDay);
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const sevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    const dateString = localDate(date);
    const liveToday = dateString === moneyWorkingDate() && moneyDayTotal(moneyState) > 0;
    const day = liveToday ? moneyState : moneyHistory.find(item => item.date === dateString);
    return { date: dateString, day: day || {}, isSaved: Boolean(day && (day.is_saved || day.isToday || (dateString === moneyWorkingDate() && moneyState?.today_saved))) };
  });
  summaries.forEach(summary => {
    if (summary.classList.contains('money-history-summary')) {
      const start = mode === 'weekly' ? sevenDays[6].date : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const rows = moneyHistory.filter(day => mode === 'monthly'
        ? day.date.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
        : day.date >= start);
      const totals = moneyBoxes.map(box => rows.reduce((sum, day) => sum + (+day[box] || 0), 0) + (+moneyState?.[box] || 0));
      summary.innerHTML = `<div class="money-summary-heading">${mode === 'weekly' ? 'This Week' : 'This Month'} Category Summary</div><div class="money-history-summary-values">${moneyBoxes.map((box, index) => `<span>${box}: Rs ${totals[index].toFixed(2)}</span>`).join('')}<strong>Total: Rs ${totals.reduce((sum, value) => sum + value, 0).toFixed(2)}</strong></div>`;
    } else {
      const savedDays = sevenDays.filter(item => item.isSaved && moneyDayTotal(item.day) > 0);
      summary.innerHTML = `<div class="money-summary-heading">Last 7 Days</div>${savedDays.length ? `<div class="money-summary-table"><div class="money-summary-table-row money-summary-table-head"><span>Date</span><span>Breakfast</span><span>Lunch</span><span>Dinner</span></div>${savedDays.map(item => `<div class="money-summary-table-row"><span>${formatMoneyDate(item.date)}</span><span>Rs ${(+item.day.breakfast || 0).toFixed(2)}</span><span>Rs ${(+item.day.lunch || 0).toFixed(2)}</span><span>Rs ${(+item.day.dinner || 0).toFixed(2)}</span></div>`).join('')}</div>` : '<div class="money-summary-empty">No spending in the last 7 days.</div>'}`;
    }
  });
}

async function renderMoneyDetails() { await loadMoneyState(); }

function getSavedMoneyMonths() {
  return [...new Set(moneyHistory
    .filter(day => moneyDayTotal(day) > 0)
    .map(day => day.date.slice(0, 7)))]
    .sort()
    .reverse();
}

function renderMoneyDeleteMonths() {
  const menu = $('#money-delete-months');
  if (!menu) return;
  const months = getSavedMoneyMonths();
  menu.innerHTML = months.length
    ? months.map(month => `<button type="button" class="money-delete-month" onclick="deleteMoneyMonth('${month}')">${monthLabel(Number(month.slice(5)), Number(month.slice(0, 4)))}</button>`).join('')
    : '<span class="money-delete-month">No saved months</span>';
}

function toggleMoneyDeleteMonths() {
  const menu = $('#money-delete-months');
  if (!menu) return;
  renderMoneyDeleteMonths();
  menu.hidden = !menu.hidden;
}

async function deleteMoneyMonth(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const label = monthLabel(month, year);
  if (!confirm(`Delete all money details from ${label}? This cannot be undone.`)) return;
  const result = await api('/api/money/clear-month', 'POST', { month, year });
  $('#money-delete-months').hidden = true;
  await loadMoneyState();
  showToast('Cleared', `${result.cleared || 0} entries removed from ${label}.`);
}

function renderMoneyDetailsList() {
  const list = $('#money-details-list');
  if (!list) return;
  const history = moneyHistoryWithToday().filter(day => moneyDayTotal(day) > 0);
  list.innerHTML = history.length ? history.map(day => {
    const label = formatMoneyDate(day.date);
    const items = (day.custom || []).filter(item => item.name).map(item => `<div class="money-history-item"><span>${escHtml(item.name)}</span><strong>Rs ${(+item.amount || 0).toFixed(2)}</strong></div>`).join('');
    return `<details class="money-history-row"${day.isToday ? ' open' : ''}><summary><span><small>${day.isToday ? 'CURRENT DAY' : ''}</small><b>${label}</b></span><strong class="money-history-total">Rs ${moneyDayTotal(day).toFixed(2)}</strong></summary><div class="money-history-values">${moneyBoxes.map(box => `<div class="money-history-category"><span>${box}</span><strong>Rs ${(+day[box] || 0).toFixed(2)}</strong></div>`).join('')}</div>${items ? `<div class="money-history-items"><small>Other items</small>${items}</div>` : ''}</details>`;
  }).join('') : '<div class="empty-state"><p>No spending recorded yet.</p></div>';
}

async function saveMoneyDay() {
  if (!moneyState) return;
  await api('/api/money', 'POST', {
    action: 'save-today',
    today_date: moneyWorkingDate(),
    ...Object.fromEntries(moneyBoxes.map(box => [box, +moneyState[box] || 0])),
    other_items: moneyState.other_items || []
  });
  await loadMoneyState();
  showToast('Saved', "Today's spending is saved on this page.");
}

function showMoneySummary(mode) {
  renderMoneySummary(mode);
  renderMoneyDetailsList();
}

function changeMoneyMonth() { return loadMoneyState(); }

async function renderBooks() {
  const data = await api('/api/books');
  const now = todayDT();
  const thisMonth = data.filter(b => { const d = new Date(b.start_date); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); }).length;
  const completed = data.filter(b => b.pages_read >= b.total_pages).length;
  const totalPages = data.reduce((s,b) => s+b.pages_read, 0);

  const bs = $('#book-stats');
  if (bs) bs.innerHTML = `
    <div style="text-align:center"><div class="stat-val pink-val" style="font-family:'Quicksand',sans-serif;font-size:2rem;font-weight:700">${data.length}</div><div style="font-size:0.78rem;color:var(--text-muted);font-weight:700">Total Books</div></div>
    <div style="text-align:center"><div class="stat-val green-val" style="font-family:'Quicksand',sans-serif;font-size:2rem;font-weight:700">${completed}</div><div style="font-size:0.78rem;color:var(--text-muted);font-weight:700">Completed</div></div>
    <div style="text-align:center"><div class="stat-val pink-val" style="font-family:'Quicksand',sans-serif;font-size:2rem;font-weight:700">${totalPages}</div><div style="font-size:0.78rem;color:var(--text-muted);font-weight:700">Pages Read</div></div>
  `;

  const todayStr = today();
  const list = $('#book-list');
  list.innerHTML = data.length ? data.map(b => {
    const pct = Math.min(100, Math.round(b.pages_read / b.total_pages * 100));
    const rem = Math.max(0, b.total_pages - b.pages_read);
    const daysLeft = b.daily_goal ? Math.ceil(rem / b.daily_goal) : '?';
    const todayRead = b.daily_logs[todayStr] || 0;
    return `<div class="book-card">
      <div class="book-title-row">
        <div class="book-title">📖 ${escHtml(b.title)}</div>
        <button class="btn-icon" onclick="deleteBook(${b.id})">🗑️</button>
      </div>
      <div class="book-meta">
        <span>${b.pages_read}/${b.total_pages} pages</span>
        <span>${pct}% complete</span>
        <span>~${daysLeft} days left</span>
        <span>Goal: ${b.daily_goal} pages/day</span>
      </div>
      <div class="book-progress-bar"><div class="book-progress-fill" style="width:${pct}%"></div></div>
      <div class="book-today-row">
        <span>Pages read today:</span>
        <input type="number" id="bt_${b.id}" value="${todayRead}" min="0" style="width:80px">
        <button class="btn btn-ghost-pink btn-sm" onclick="logBookToday(${b.id})">Save</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty-state"><span class="empty-icon">📚</span><p>Add your first book!</p></div>';
}

async function addBook() {
  const title = $('#book-title').value.trim().replace(/\b\w/g, char => char.toUpperCase());
  const pages = parseInt($('#book-pages').value);
  const goal  = parseInt($('#book-goal').value) || 20;
  if (!title || !pages) return;
  if (goal > pages) {
    showToast('Invalid reading goal', 'Pages per day cannot be more than total pages.');
    return;
  }
  await api('/api/books', 'POST', { title, total_pages: pages, daily_goal: goal });
  $('#book-title').value = '';
  $('#book-pages').value = '';
  $('#book-goal').value  = '';
  renderBooks();
}

async function logBookToday(id) {
  const val = parseInt($(`#bt_${id}`).value) || 0;
  await api(`/api/books/${id}/log`, 'POST', { pages: val });
  renderBooks();
  showToast('📚 Reading logged!', `Saved ${val} pages for today.`);
}

async function deleteBook(id) {
  await api(`/api/books/${id}`, 'DELETE');
  renderBooks();
}

// ─── Helpers ──────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escAttr(s) { return escHtml(s); }

function daysInMonth(m, y) { return new Date(y, m, 0).getDate(); }

function monthLabel(m, y) {
  return new Date(y, m-1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function fmtDeadline(dl) {
  if (!dl) return '';
  const d = new Date(dl);
  return '📅 ' + d.toLocaleString('default', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtReminder(dl) {
  if (!dl) return '';
  return new Date(dl).toLocaleString('default', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isOverdue(dl) {
  return dl && new Date(dl) < new Date();
}

// ─── Notifications ────────────────────────────
function scheduleReminders() {
  checkOverdueTasks();
  checkTaskReminders();
  setInterval(checkTaskReminders, 30000);
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

async function checkTaskReminders() {
  const tasks = await api('/api/tasks');
  const now = Date.now();
  const notified = JSON.parse(localStorage.getItem('bloom-reminders-notified') || '{}');
  let changed = false;
  tasks.filter(task => !task.done && task.reminder && new Date(task.reminder).getTime() <= now).forEach(task => {
    const reminderKey = `${task.id}:${task.reminder}`;
    if (notified[reminderKey]) return;
    const message = `Reminder: ${task.text}`;
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('🔔 Bloom task reminder', {
        body: message,
        requireInteraction: true,
        tag: reminderKey,
        renotify: true
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
    showToast('🔔 Task Reminder', task.text, true);
    notified[reminderKey] = true;
    changed = true;
  });
  if (changed) localStorage.setItem('bloom-reminders-notified', JSON.stringify(notified));
}

async function checkOverdueTasks() {
  const tasks = await api('/api/tasks');
  const overdue = tasks.filter(t => !t.done && isOverdue(t.deadline));
  if (overdue.length > 0) {
    setTimeout(() => showToast('⏰ Overdue Tasks!', `You have ${overdue.length} overdue task${overdue.length>1?'s':''}. Check your task list!`), 2000);
  }
}

let last10pmDate = '';
function check10pm() {
  const now = new Date();
  const h = now.getHours(), mi = now.getMinutes();
  const ds = today();
  if (h === 22 && mi < 5 && last10pmDate !== ds) {
    last10pmDate = ds;
    showToast('🌙 10 PM Check-in!', 'Time to log your prayers, thoughts, spending and reading for today!');
  }
}

let pushRegistration = null;

async function registerPushWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    pushRegistration = await navigator.serviceWorker.register('/static/sw.js');
    const subscription = await pushRegistration.pushManager.getSubscription();
    if (subscription) setNotificationStatus('Phone notifications are enabled.');
  } catch (error) {
    setNotificationStatus('Phone notifications are not available here.');
  }
}

function setNotificationStatus(message) {
  const status = $('#notification-status');
  if (status) status.textContent = message;
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

async function enablePushNotifications() {
  if (!pushRegistration) await registerPushWorker();
  if (!pushRegistration || !('PushManager' in window)) {
    setNotificationStatus('Use Bloom over HTTPS to enable phone notifications.');
    return;
  }
  const keyResponse = await api('/api/push/public-key');
  if (!keyResponse.ok || !keyResponse.public_key) {
    setNotificationStatus('Server push keys are not configured yet.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setNotificationStatus('Notification permission was not granted.');
    return;
  }
  const subscription = await pushRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyResponse.public_key)
  });
  await api('/api/push/subscribe', 'POST', subscription.toJSON());
  setNotificationStatus('Phone notifications are enabled.');
}