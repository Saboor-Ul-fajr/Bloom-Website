// Account-scoped local storage for Bloom feature data.
window.BloomLocalStore = (() => {
  const DATABASE_NAME = 'bloom-local-data';
  const DATABASE_VERSION = 1;
  const PROFILE_STORE = 'profiles';
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(PROFILE_STORE)) {
          request.result.createObjectStore(PROFILE_STORE, { keyPath: 'userId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local Bloom storage.'));
      request.onblocked = () => reject(new Error('Close other Bloom tabs to upgrade local storage.'));
    });
    return databasePromise;
  }

  function emptyProfile(userId) {
    return {
      userId: String(userId),
      schemaVersion: 1,
      localEnabled: false,
      migrationComplete: false,
      tasks: [],
      prayers: [],
      thoughts: [],
      habits: [],
      books: [],
      moneyState: null,
      moneyHistory: []
    };
  }

  function nextId(records) {
    return records.reduce((largest, record) => Math.max(largest, Number(record.id) || 0), 0) + 1;
  }

  function recordDateLabel() {
    return new Date().toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
  }

  function moneyDayTotal(day) {
    const extras = (day.other_items || day.custom || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    return ['breakfast', 'lunch', 'dinner', 'snacks'].reduce((sum, box) => sum + (Number(day[box]) || 0), 0) + extras;
  }

  function moneyLogFromState(state, date) {
    const custom = (state.other_items || []).filter(item => item.name || Number(item.amount));
    return {
      date,
      breakfast: Number(state.breakfast) || 0,
      lunch: Number(state.lunch) || 0,
      dinner: Number(state.dinner) || 0,
      snacks: Number(state.snacks) || 0,
      others: custom.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
      other_items: custom,
      custom,
      is_saved: Boolean(state.today_saved),
      day_total: moneyDayTotal({ ...state, other_items: custom })
    };
  }

  function ensureMoneyDate(profile, date) {
    if (!profile.moneyState) {
      profile.moneyState = {
        total_entered: 0, old_spending: 0, today_date: date, today_saved: false,
        breakfast: 0, lunch: 0, dinner: 0, snacks: 0, others: 0, other_items: []
      };
    }
    let state = profile.moneyState;
    while (state.today_date < date) {
      const log = moneyLogFromState(state, state.today_date);
      profile.moneyHistory = [log, ...(profile.moneyHistory || []).filter(item => item.date !== log.date)];
      state.old_spending = (Number(state.old_spending) || 0) + moneyDayTotal(log);
      const next = new Date(`${state.today_date}T12:00:00`);
      next.setDate(next.getDate() + 1);
      state = {
        ...state, today_date: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
        today_saved: false, breakfast: 0, lunch: 0, dinner: 0, snacks: 0, others: 0, other_items: []
      };
      profile.moneyState = state;
    }
    return state;
  }

  async function handleApi(userId, path, method = 'GET', body = null) {
    const url = new URL(path, window.location.origin);
    const route = url.pathname;
    const parts = route.split('/').filter(Boolean);
    const query = url.searchParams;
    const verb = method.toUpperCase();
    const isLocalRoute = route === '/api/prayers' || route.startsWith('/api/prayers/') ||
      route === '/api/tasks' || route.startsWith('/api/tasks/') ||
      route === '/api/thoughts' || route.startsWith('/api/thoughts/') ||
      route === '/api/habits' || route.startsWith('/api/habits/') ||
      route === '/api/books' || route.startsWith('/api/books/') ||
      route === '/api/money' || route.startsWith('/api/money/');
    if (!isLocalRoute) return { handled: false };

    const value = await updateProfile(userId, profile => {
      if (route === '/api/prayers') {
        if (verb === 'GET') {
          const month = Number(query.get('month'));
          const year = Number(query.get('year'));
          return (profile.prayers || []).filter(item => query.has('all') ||
            (Number(item.date.slice(5, 7)) === month && Number(item.date.slice(0, 4)) === year));
        }
        if (verb === 'POST') {
          const record = { date: body.date, name: body.name, done: Boolean(body.done) };
          const index = profile.prayers.findIndex(item => item.date === record.date && item.name === record.name);
          if (index < 0) profile.prayers.push(record);
          else profile.prayers[index] = record;
          return { ok: true };
        }
      }

      if (route === '/api/tasks') {
        if (verb === 'GET') return [...profile.tasks].sort((a, b) => b.id - a.id);
        if (verb === 'POST') {
          const task = { id: nextId(profile.tasks), text: body.text, done: false, priority: body.priority || 'medium', deadline: body.deadline || null, reminder: body.reminder || null, created: recordDateLabel() };
          profile.tasks.unshift(task);
          return { ok: true, id: task.id };
        }
      }
      if (parts[1] === 'tasks' && parts[2]) {
        const id = Number(parts[2]);
        const task = profile.tasks.find(item => Number(item.id) === id);
        if (verb === 'POST' && parts[3] === 'toggle') {
          if (task) task.done = !task.done;
          return { ok: true, done: Boolean(task?.done) };
        }
        if (verb === 'DELETE') {
          profile.tasks = profile.tasks.filter(item => Number(item.id) !== id);
          return { ok: true };
        }
      }

      if (route === '/api/thoughts') {
        if (verb === 'GET') return [...profile.thoughts].sort((a, b) => b.id - a.id);
        if (verb === 'POST') {
          const thought = { id: nextId(profile.thoughts), text: body.text, fav: false, date: new Date().toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) };
          profile.thoughts.unshift(thought);
          return { ok: true, id: thought.id };
        }
      }
      if (parts[1] === 'thoughts' && parts[2]) {
        const id = Number(parts[2]);
        if (verb === 'POST' && parts[3] === 'fav') {
          const thought = profile.thoughts.find(item => Number(item.id) === id);
          if (thought) thought.fav = !thought.fav;
          return { ok: true, fav: Boolean(thought?.fav) };
        }
        if (verb === 'DELETE') {
          profile.thoughts = profile.thoughts.filter(item => Number(item.id) !== id);
          return { ok: true };
        }
      }

      if (route === '/api/habits') {
        if (verb === 'GET') return profile.habits;
        if (verb === 'POST') {
          const habit = { id: nextId(profile.habits), name: body.name, logs: [] };
          profile.habits.push(habit);
          return { ok: true, id: habit.id };
        }
      }
      if (parts[1] === 'habits' && parts[2]) {
        const id = Number(parts[2]);
        if (verb === 'POST' && parts[3] === 'toggle') {
          const habit = profile.habits.find(item => Number(item.id) === id);
          if (!habit) return { ok: true, done: false };
          const index = habit.logs.indexOf(body.date);
          if (index < 0) habit.logs.push(body.date);
          else habit.logs.splice(index, 1);
          return { ok: true, done: index < 0 };
        }
        if (verb === 'DELETE') {
          profile.habits = profile.habits.filter(item => Number(item.id) !== id);
          return { ok: true };
        }
      }

      if (route === '/api/books') {
        if (verb === 'GET') return profile.books.map(book => {
          const logs = book.daily_logs || {};
          return { ...book, pages_read: Object.values(logs).reduce((sum, count) => sum + Number(count || 0), 0), daily_logs: logs };
        });
        if (verb === 'POST') {
          const book = { id: nextId(profile.books), title: body.title, total_pages: Number(body.total_pages), daily_goal: Number(body.daily_goal) || 20, start_date: new Date().toISOString().slice(0, 10), daily_logs: {} };
          profile.books.push(book);
          return { ok: true, id: book.id };
        }
      }
      if (parts[1] === 'books' && parts[2]) {
        const id = Number(parts[2]);
        if (verb === 'POST' && parts[3] === 'log') {
          const book = profile.books.find(item => Number(item.id) === id);
          if (book) book.daily_logs[todayLocal()] = Number(body.pages) || 0;
          return { ok: true };
        }
        if (verb === 'DELETE') {
          profile.books = profile.books.filter(item => Number(item.id) !== id);
          return { ok: true };
        }
      }

      if (route === '/api/money' && verb === 'GET') {
        const state = ensureMoneyDate(profile, query.get('today_date') || todayLocal());
        if (query.has('state')) return { state: structuredCloneSafe(state), history: structuredCloneSafe(profile.moneyHistory || []) };
        return structuredCloneSafe(profile.moneyHistory || []);
      }
      if (route === '/api/money' && verb === 'POST') {
        const date = body.today_date || todayLocal();
        const state = ensureMoneyDate(profile, date);
        if (body.action === 'add-money') {
          state.total_entered = (Number(state.total_entered) || 0) + Math.max(Number(body.amount) || 0, 0);
        } else if (body.action === 'delete-total') {
          if (!state.today_saved) return { ok: false, error: 'Save today before deleting the total.' };
          state.total_entered = Math.max((Number(state.total_entered) || 0) - (Number(state.old_spending) || 0) - moneyDayTotal(state), 0);
          state.old_spending = 0;
          state.today_saved = false;
          ['breakfast', 'lunch', 'dinner', 'snacks', 'others'].forEach(box => { state[box] = 0; });
          state.other_items = [];
        } else {
          ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(box => {
            if (Object.hasOwn(body, box)) state[box] = Math.max(Number(body[box]) || 0, 0);
          });
          if (Object.hasOwn(body, 'other_items')) {
            state.other_items = body.other_items || [];
            state.others = state.other_items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
          }
          if (body.action === 'save-today') {
            state.today_saved = true;
            const log = moneyLogFromState(state, date);
            profile.moneyHistory = [log, ...(profile.moneyHistory || []).filter(item => item.date !== date)];
          }
        }
        return { ok: true };
      }
      if (route === '/api/money/clear-month' && verb === 'POST') {
        const month = String(body.month).padStart(2, '0');
        const prefix = `${body.year}-${month}`;
        const before = profile.moneyHistory.length;
        profile.moneyHistory = profile.moneyHistory.filter(item => !item.date.startsWith(prefix));
        return { ok: true, cleared: before - profile.moneyHistory.length };
      }

      return null;
    });
    return value === null ? { handled: false } : { handled: true, value };
  }

  function todayLocal() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function getProfile(userId) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PROFILE_STORE, 'readonly');
      const request = transaction.objectStore(PROFILE_STORE).get(String(userId));
      request.onsuccess = () => resolve(request.result || emptyProfile(userId));
      request.onerror = () => reject(request.error || new Error('Could not read local Bloom data.'));
    });
  }

  async function updateProfile(userId, update) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PROFILE_STORE, 'readwrite');
      const store = transaction.objectStore(PROFILE_STORE);
      const request = store.get(String(userId));
      let result;
      request.onsuccess = () => {
        const profile = request.result || emptyProfile(userId);
        result = update(profile);
        store.put(profile);
      };
      request.onerror = () => reject(request.error || new Error('Could not update local Bloom data.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Could not commit local Bloom data.'));
      transaction.onabort = () => reject(transaction.error || new Error('Local Bloom data update was cancelled.'));
    });
  }

  async function isLocalEnabled(userId) {
    const profile = await getProfile(userId);
    return Boolean(profile.localEnabled && profile.migrationComplete);
  }

  async function setLocalEnabled(userId, enabled) {
    return updateProfile(userId, profile => {
      profile.localEnabled = Boolean(enabled);
      return profile.localEnabled;
    });
  }

  async function replaceWithExport(userId, exported) {
    const profile = emptyProfile(userId);
    profile.localEnabled = true;
    profile.migrationComplete = true;
    profile.prayers = exported.prayers || [];
    profile.tasks = exported.tasks || [];
    profile.thoughts = exported.thoughts || [];
    profile.habits = exported.habits || [];
    profile.books = exported.books || [];
    profile.moneyState = exported.money?.state || null;
    profile.moneyHistory = exported.money?.history || [];

    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(PROFILE_STORE, 'readwrite');
      transaction.objectStore(PROFILE_STORE).put(profile);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not save local Bloom data.'));
      transaction.onabort = () => reject(transaction.error || new Error('Local Bloom data migration was cancelled.'));
    });
    return profile;
  }

  return { getProfile, updateProfile, emptyProfile, handleApi, isLocalEnabled, setLocalEnabled, replaceWithExport };
})();
