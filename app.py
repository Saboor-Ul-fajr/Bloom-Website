from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from database.db import db, User, AdminUser, AuditLog, Prayer, Thought, Task, PushSubscription, Habit, HabitLog, MoneyLog, MoneyState, CustomExpense, Book, BookLog, Announcement
from datetime import datetime, date, timedelta
import os
import json
import re
import threading
import time
from pywebpush import webpush, WebPushException
from sqlalchemy import or_

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "local-development-secret-change-me")
database_url = os.environ.get("DATABASE_URL", "sqlite:///bloom.db")
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
app.config["SQLALCHEMY_DATABASE_URI"] = database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}

db.init_app(app)

with app.app_context():
    db.create_all()
    # Keep existing SQLite installs usable when the five-box workflow is introduced.
    inspector = db.inspect(db.engine)
    columns = {column["name"] for column in inspector.get_columns("money_logs")}
    with db.engine.begin() as connection:
        for name in ("snacks", "others"):
            if name not in columns:
                connection.exec_driver_sql(f"ALTER TABLE money_logs ADD COLUMN {name} FLOAT DEFAULT 0")
        if "is_saved" not in columns:
            connection.exec_driver_sql("ALTER TABLE money_logs ADD COLUMN is_saved BOOLEAN DEFAULT 0")
    state_columns = {column["name"] for column in inspector.get_columns("money_states")}
    with db.engine.begin() as connection:
        if "today_saved" not in state_columns:
            connection.exec_driver_sql("ALTER TABLE money_states ADD COLUMN today_saved BOOLEAN DEFAULT 0")
        if "other_items" not in state_columns:
            connection.exec_driver_sql("ALTER TABLE money_states ADD COLUMN other_items TEXT DEFAULT '[]'")
    task_columns = {column["name"] for column in inspector.get_columns("tasks")}
    with db.engine.begin() as connection:
        if "reminder" not in task_columns:
                connection.exec_driver_sql("ALTER TABLE tasks ADD COLUMN reminder TIMESTAMP")
        if "reminder_sent_at" not in task_columns:
            connection.exec_driver_sql("ALTER TABLE tasks ADD COLUMN reminder_sent_at TIMESTAMP")
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "email" not in user_columns:
        with db.engine.begin() as connection:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN email VARCHAR(254)")
    with db.engine.begin() as connection:
        connection.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)")
        if "status" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active' NOT NULL")
        if "last_login" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN last_login TIMESTAMP")
    if not AdminUser.query.first():
        bootstrap_name = os.environ.get("BLOOM_ADMIN_USERNAME")
        bootstrap_password = os.environ.get("BLOOM_ADMIN_PASSWORD")
        if bootstrap_name and bootstrap_password:
            db.session.add(AdminUser(username=bootstrap_name,
                                     password_hash=generate_password_hash(bootstrap_password),
                                     role="super_admin"))
            db.session.commit()

# ─────────────────── helpers ───────────────────
def logged_in():
    user = db.session.get(User, session.get("user_id")) if session.get("user_id") else None
    return bool(user and user.status == "active")

def current_user():
    if not logged_in():
        return None
    return User.query.get(session["user_id"])

def is_admin():
    return "admin_id" in session

def current_admin():
    if not is_admin():
        return None
    return db.session.get(AdminUser, session["admin_id"])

def require_admin(role=None):
    admin = current_admin()
    if not admin or not admin.active:
        return None, (jsonify({"ok": False, "error": "Admin authentication required."}), 401)
    if role and admin.role != role:
        return None, (jsonify({"ok": False, "error": "Super Admin access required."}), 403)
    return admin, None

def audit(admin, action, record_type=None, record_id=None):
    db.session.add(AuditLog(admin_id=admin.id, admin_name=admin.username,
                             action=action, record_type=record_type, record_id=record_id))

# ─────────────────── auth ───────────────────
@app.route("/", methods=["GET"])
def index():
    if logged_in():
        return redirect(url_for("dashboard"))
    return render_template("auth.html")

@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    user = User.query.filter_by(username=username).first()
    if not user or user.status != "active" or not check_password_hash(user.password_hash, password):
        return jsonify({"ok": False, "error": "Invalid username or password."})

    session["user_id"] = user.id
    user.last_login = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True, "redirect": "/dashboard"})

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "GET":
        return render_template("admin_login.html")
    data = request.get_json() or {}
    admin = AdminUser.query.filter_by(username=data.get("username", "").strip()).first()
    if not admin or not admin.active or not check_password_hash(admin.password_hash, data.get("password", "")):
        return jsonify({"ok": False, "error": "Invalid admin credentials."}), 401
    session.clear()
    session["admin_id"] = admin.id
    admin.last_login = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True, "redirect": "/admin"})

@app.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("admin_login"))

@app.route("/signup", methods=["POST"])
def signup():
    data = request.get_json()
    username = data.get("username", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    confirm  = data.get("confirm", "")

    if len(username) < 3:
        return jsonify({"ok": False, "error": "Username must be at least 3 characters."})
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        return jsonify({"ok": False, "error": "Please enter a valid email address."})
    if len(password) < 4:
        return jsonify({"ok": False, "error": "Password must be at least 4 characters."})
    if password != confirm:
        return jsonify({"ok": False, "error": "Passwords do not match."})
    if User.query.filter_by(username=username).first():
        return jsonify({"ok": False, "error": "Username already taken."})
    if User.query.filter_by(email=email).first():
        return jsonify({"ok": False, "error": "Email already registered."})

    user = User(username=username, email=email, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()
    session["user_id"] = user.id
    return jsonify({"ok": True, "redirect": "/dashboard"})

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

# ─────────────────── pages ───────────────────
@app.route("/dashboard")
def dashboard():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="dashboard", user=current_user())

@app.route("/prayer")
def prayer():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="prayer", user=current_user())

@app.route("/thoughts")
def thoughts():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="thoughts", user=current_user())

@app.route("/tasks")
def tasks():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="tasks", user=current_user())

@app.route("/habits")
def habits():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="habits", user=current_user())

@app.route("/money")
def money():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="money", user=current_user())

@app.route("/books")
def books():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="books", user=current_user())

@app.route("/account")
def account():
    if not logged_in(): return redirect(url_for("index"))
    return render_template("app.html", page="account", user=current_user())

@app.route("/admin")
def admin():
    admin_user = current_admin()
    if not admin_user or not admin_user.active: return redirect(url_for("admin_login"))
    return render_template("admin.html", admin=admin_user)

# ─────────────────── API: prayers ───────────────────
@app.route("/api/prayers", methods=["GET"])
def api_prayers_get():
    if not logged_in(): return jsonify([])
    user = current_user()
    month = int(request.args.get("month", datetime.now().month))
    year  = int(request.args.get("year",  datetime.now().year))
    records = Prayer.query.filter_by(user_id=user.id).filter(
        db.extract("month", Prayer.date) == month,
        db.extract("year",  Prayer.date) == year
    ).all()
    return jsonify([{"date": str(r.date), "name": r.name, "done": r.done} for r in records])

@app.route("/api/prayers", methods=["POST"])
def api_prayers_post():
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json()
    user = current_user()
    d = datetime.strptime(data["date"], "%Y-%m-%d").date()
    name = data["name"]
    record = Prayer.query.filter_by(user_id=user.id, date=d, name=name).first()
    if record:
        record.done = data["done"]
    else:
        record = Prayer(user_id=user.id, date=d, name=name, done=data["done"])
        db.session.add(record)
    db.session.commit()
    return jsonify({"ok": True})

# ─────────────────── API: thoughts ───────────────────
@app.route("/api/thoughts", methods=["GET"])
def api_thoughts_get():
    if not logged_in(): return jsonify([])
    user = current_user()
    ts = Thought.query.filter_by(user_id=user.id).order_by(Thought.created_at.desc()).all()
    return jsonify([{"id": t.id, "text": t.text, "fav": t.fav, "date": t.created_at.strftime("%b %d, %Y")} for t in ts])

@app.route("/api/thoughts", methods=["POST"])
def api_thoughts_post():
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json()
    user = current_user()
    t = Thought(user_id=user.id, text=data["text"])
    db.session.add(t); db.session.commit()
    return jsonify({"ok": True, "id": t.id})

@app.route("/api/thoughts/<int:tid>/fav", methods=["POST"])
def api_thought_fav(tid):
    if not logged_in(): return jsonify({"ok": False})
    t = Thought.query.filter_by(id=tid, user_id=current_user().id).first()
    if t: t.fav = not t.fav; db.session.commit()
    return jsonify({"ok": True, "fav": t.fav if t else False})

@app.route("/api/thoughts/<int:tid>", methods=["DELETE"])
def api_thought_delete(tid):
    if not logged_in(): return jsonify({"ok": False})
    t = Thought.query.filter_by(id=tid, user_id=current_user().id).first()
    if t: db.session.delete(t); db.session.commit()
    return jsonify({"ok": True})

# ─────────────────── API: tasks ───────────────────
@app.route("/api/tasks", methods=["GET"])
def api_tasks_get():
    if not logged_in(): return jsonify([])
    user = current_user()
    ts = Task.query.filter_by(user_id=user.id).order_by(Task.created_at.desc()).all()
    return jsonify([{
        "id": t.id, "text": t.text, "done": t.done,
        "priority": t.priority,
        "deadline": t.deadline.strftime("%Y-%m-%dT%H:%M") if t.deadline else None,
        "reminder": t.reminder.strftime("%Y-%m-%dT%H:%M") if t.reminder else None,
        "created": t.created_at.strftime("%b %d")
    } for t in ts])

@app.route("/api/tasks", methods=["POST"])
def api_tasks_post():
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json()
    user = current_user()
    dl = datetime.strptime(data["deadline"], "%Y-%m-%dT%H:%M") if data.get("deadline") else None
    reminder = datetime.strptime(data["reminder"], "%Y-%m-%dT%H:%M") if data.get("reminder") else None
    t = Task(user_id=user.id, text=data["text"], priority=data.get("priority","medium"), deadline=dl, reminder=reminder, reminder_sent_at=None)
    db.session.add(t); db.session.commit()
    return jsonify({"ok": True, "id": t.id})

@app.route("/api/tasks/<int:tid>/toggle", methods=["POST"])
def api_task_toggle(tid):
    if not logged_in(): return jsonify({"ok": False})
    t = Task.query.filter_by(id=tid, user_id=current_user().id).first()
    if t: t.done = not t.done; db.session.commit()
    return jsonify({"ok": True, "done": t.done if t else False})

@app.route("/api/tasks/<int:tid>", methods=["DELETE"])
def api_task_delete(tid):
    if not logged_in(): return jsonify({"ok": False})
    t = Task.query.filter_by(id=tid, user_id=current_user().id).first()
    if t: db.session.delete(t); db.session.commit()
    return jsonify({"ok": True})

# ─────────────────── API: push notifications ───────────────────
@app.route("/api/push/public-key")
def push_public_key():
    if not logged_in(): return jsonify({"ok": False}), 401
    key = os.environ.get("VAPID_PUBLIC_KEY", "")
    return jsonify({"ok": bool(key), "public_key": key})

@app.route("/api/push/subscribe", methods=["POST"])
def push_subscribe():
    if not logged_in(): return jsonify({"ok": False}), 401
    data = request.get_json() or {}
    endpoint = data.get("endpoint")
    if not endpoint or not data.get("keys"):
        return jsonify({"ok": False, "error": "Invalid push subscription."}), 400
    subscription = json.dumps({"endpoint": endpoint, "keys": data["keys"]})
    existing = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if existing:
        existing.user_id = current_user().id
        existing.subscription = subscription
    else:
        db.session.add(PushSubscription(user_id=current_user().id, endpoint=endpoint, subscription=subscription))
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/push/subscribe", methods=["DELETE"])
def push_unsubscribe():
    if not logged_in(): return jsonify({"ok": False}), 401
    data = request.get_json() or {}
    subscription = PushSubscription.query.filter_by(endpoint=data.get("endpoint"), user_id=current_user().id).first()
    if subscription:
        db.session.delete(subscription); db.session.commit()
    return jsonify({"ok": True})

# ─────────────────── API: habits ───────────────────
@app.route("/api/habits", methods=["GET"])
def api_habits_get():
    if not logged_in(): return jsonify([])
    user = current_user()
    hs = Habit.query.filter_by(user_id=user.id).all()
    result = []
    for h in hs:
        logs = HabitLog.query.filter_by(habit_id=h.id).all()
        result.append({"id": h.id, "name": h.name, "logs": [str(l.date) for l in logs]})
    return jsonify(result)

@app.route("/api/habits", methods=["POST"])
def api_habits_post():
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json()
    h = Habit(user_id=current_user().id, name=data["name"])
    db.session.add(h); db.session.commit()
    return jsonify({"ok": True, "id": h.id})

@app.route("/api/habits/<int:hid>/toggle", methods=["POST"])
def api_habit_toggle(hid):
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json()
    d = datetime.strptime(data["date"], "%Y-%m-%d").date()
    log = HabitLog.query.filter_by(habit_id=hid, date=d).first()
    if log: db.session.delete(log); db.session.commit(); return jsonify({"ok": True, "done": False})
    log = HabitLog(habit_id=hid, date=d); db.session.add(log); db.session.commit()
    return jsonify({"ok": True, "done": True})

@app.route("/api/habits/<int:hid>", methods=["DELETE"])
def api_habit_delete(hid):
    if not logged_in(): return jsonify({"ok": False})
    h = Habit.query.filter_by(id=hid, user_id=current_user().id).first()
    if h:
        HabitLog.query.filter_by(habit_id=hid).delete()
        db.session.delete(h); db.session.commit()
    return jsonify({"ok": True})

# ─────────────────── API: money ───────────────────
MONEY_BOXES = ("breakfast", "lunch", "dinner", "snacks", "others")

def local_money_date(data=None):
    value = (data or {}).get("today_date") or request.args.get("today_date")
    return datetime.strptime(value, "%Y-%m-%d").date() if value else date.today()

def money_total(values):
    return sum(float(values.get(box, 0) or 0) for box in MONEY_BOXES)

def get_money_state(user, current_date):
    state = MoneyState.query.filter_by(user_id=user.id).first()
    if not state:
        state = MoneyState(user_id=user.id, today_date=str(current_date))
        db.session.add(state)
        db.session.flush()
    stored_date = datetime.strptime(state.today_date, "%Y-%m-%d").date()
    # A previous manual test may leave a future date in the saved state.
    if stored_date > current_date:
        stored_date = current_date
        state.today_date = str(current_date)
        for box in MONEY_BOXES:
            setattr(state, box, 0)
    while stored_date < current_date:
        boxes = {box: getattr(state, box) or 0 for box in MONEY_BOXES}
        log = MoneyLog.query.filter_by(user_id=user.id, date=stored_date).first()
        if not log:
            log = MoneyLog(user_id=user.id, date=stored_date)
            db.session.add(log)
        for box, value in boxes.items():
            setattr(log, box, value)
        log.cheez = boxes["snacks"]
        log.is_saved = bool(state.today_saved)
        try:
            items = json.loads(state.other_items or "[]")
        except (TypeError, ValueError):
            items = []
        CustomExpense.query.filter_by(money_log_id=log.id).delete()
        for item in items:
            if item.get("name"):
                db.session.add(CustomExpense(money_log_id=log.id, name=item["name"], amount=float(item.get("amount", 0) or 0)))
        state.old_spending = (state.old_spending or 0) + money_total(boxes)
        stored_date += timedelta(days=1)
        state.today_date = str(stored_date)
        for box in MONEY_BOXES:
            setattr(state, box, 0)
        state.other_items = "[]"
    db.session.commit()
    return state

@app.route("/api/money", methods=["GET"])
def api_money_get():
    if not logged_in(): return jsonify([])
    user = current_user()
    current_date = local_money_date()
    state = get_money_state(user, current_date)
    show_all = str(request.args.get("all", "")).lower() in {"1", "true", "yes"}
    month = int(request.args.get("month", datetime.now().month))
    year  = int(request.args.get("year",  datetime.now().year))
    query = MoneyLog.query.filter_by(user_id=user.id).order_by(MoneyLog.date.desc())
    if not show_all:
        query = query.filter(
            db.extract("month", MoneyLog.date) == month,
            db.extract("year",  MoneyLog.date) == year
        )
    logs = query.all()
    result = []
    for log in logs:
        customs = CustomExpense.query.filter_by(money_log_id=log.id).all()
        snacks = log.snacks or log.cheez or 0
        values = {"breakfast": log.breakfast, "lunch": log.lunch, "dinner": log.dinner,
                  "snacks": snacks, "others": log.others}
        if not log.is_saved and money_total(values) <= 0:
            continue
        result.append({
            "id": log.id, "date": str(log.date), "amount": log.amount,
            "breakfast": log.breakfast, "lunch": log.lunch,
            "dinner": log.dinner, "snacks": snacks,
            "others": log.others,
            "day_total": money_total(values),
            "is_saved": bool(log.is_saved),
            "custom": [{"name": c.name, "amount": c.amount} for c in customs]
        })
    if request.args.get("state") is not None:
        try:
            other_items = json.loads(state.other_items or "[]")
        except (TypeError, ValueError):
            other_items = []
        return jsonify({"state": {"total_entered": state.total_entered or 0, "old_spending": state.old_spending or 0,
                       "today_date": state.today_date, "today_saved": bool(state.today_saved),
                                   "other_items": other_items,
                       **{box: getattr(state, box) or 0 for box in MONEY_BOXES}},
                        "history": result})
    return jsonify(result)

@app.route("/api/money", methods=["POST"])
def api_money_post():
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json() or {}
    user = current_user()
    d = local_money_date(data)
    state = get_money_state(user, d)
    if data.get("action") == "add-money":
        state.total_entered = (state.total_entered or 0) + max(float(data.get("amount", 0) or 0), 0)
    elif data.get("action") == "delete-total":
        if not state.today_saved:
            return jsonify({"ok": False, "error": "Save today before deleting the total."}), 400
        after_spending = (state.total_entered or 0) - (state.old_spending or 0) - money_total({box: getattr(state, box) or 0 for box in MONEY_BOXES})
        log = MoneyLog.query.filter_by(user_id=user.id, date=d).first()
        if not log:
            log = MoneyLog(user_id=user.id, date=d)
            db.session.add(log)
        for box in MONEY_BOXES:
            value = getattr(state, box) or 0
            setattr(log, box, value)
        log.cheez = state.snacks or 0
        log.is_saved = True
        try:
            items = json.loads(state.other_items or "[]")
        except (TypeError, ValueError):
            items = []
        CustomExpense.query.filter_by(money_log_id=log.id).delete()
        for item in items:
            if item.get("name"):
                db.session.add(CustomExpense(money_log_id=log.id, name=item["name"], amount=float(item.get("amount", 0) or 0)))
        state.total_entered = after_spending
        state.old_spending = 0
        state.today_saved = False
        for box in MONEY_BOXES:
            setattr(state, box, 0)
    else:
        if str(d) != state.today_date: return jsonify({"ok": False, "error": "Only today can be edited."}), 400
        for box in MONEY_BOXES:
            if box in data:
                setattr(state, box, max(float(data.get(box, 0) or 0), 0))
        if "other_items" in data:
            state.other_items = json.dumps(data["other_items"])
        state.today_saved = data.get("action") == "save-today"
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/money/clear-month", methods=["POST"])
def api_money_clear_month():
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json() or {}
    user = current_user()
    month = int(data.get("month", datetime.now().month))
    year  = int(data.get("year",  datetime.now().year))

    if data.get("mode") == "all-previous":
        logs = MoneyLog.query.filter_by(user_id=user.id).filter(
            db.or_(
                db.extract("year", MoneyLog.date) < year,
                db.and_(db.extract("year", MoneyLog.date) == year, db.extract("month", MoneyLog.date) < month)
            )
        ).all()
    else:
        logs = MoneyLog.query.filter_by(user_id=user.id).filter(
            db.extract("month", MoneyLog.date) == month,
            db.extract("year",  MoneyLog.date) == year
        ).all()

    for log in logs:
        CustomExpense.query.filter_by(money_log_id=log.id).delete()
        db.session.delete(log)
    db.session.commit()
    return jsonify({"ok": True, "month": month, "year": year, "cleared": len(logs)})

# ─────────────────── API: books ───────────────────
@app.route("/api/books", methods=["GET"])
def api_books_get():
    if not logged_in(): return jsonify([])
    user = current_user()
    bs = Book.query.filter_by(user_id=user.id).order_by(Book.id.desc()).all()
    result = []
    for b in bs:
        logs = BookLog.query.filter_by(book_id=b.id).all()
        total_read = sum(l.pages_read for l in logs)
        result.append({
            "id": b.id, "title": b.title, "total_pages": b.total_pages,
            "daily_goal": b.daily_goal, "pages_read": total_read,
            "start_date": str(b.start_date),
            "daily_logs": {str(l.date): l.pages_read for l in logs}
        })
    return jsonify(result)

@app.route("/api/books", methods=["POST"])
def api_books_post():
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json()
    total_pages = int(data["total_pages"])
    daily_goal = int(data.get("daily_goal", 20))
    if total_pages <= 0 or daily_goal <= 0 or daily_goal > total_pages:
        return jsonify({"ok": False, "error": "Daily goal cannot be more than total pages."}), 400
    b = Book(user_id=current_user().id, title=data["title"],
             total_pages=total_pages, daily_goal=daily_goal,
             start_date=date.today())
    db.session.add(b); db.session.commit()
    return jsonify({"ok": True, "id": b.id})

@app.route("/api/books/<int:bid>/log", methods=["POST"])
def api_book_log(bid):
    if not logged_in(): return jsonify({"ok": False})
    data = request.get_json()
    d = date.today()
    log = BookLog.query.filter_by(book_id=bid, date=d).first()
    if log: log.pages_read = data["pages"]
    else: db.session.add(BookLog(book_id=bid, date=d, pages_read=data["pages"]))
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/books/<int:bid>", methods=["DELETE"])
def api_book_delete(bid):
    if not logged_in(): return jsonify({"ok": False})
    b = Book.query.filter_by(id=bid, user_id=current_user().id).first()
    if b:
        BookLog.query.filter_by(book_id=bid).delete()
        db.session.delete(b); db.session.commit()
    return jsonify({"ok": True})

# ─────────────────── API: admin ───────────────────
@app.route("/api/admin/users")
def api_admin_users():
    admin, error = require_admin()
    if error: return error
    query = User.query
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()
    if search:
        query = query.filter(or_(User.username.ilike(f"%{search}%"), User.email.ilike(f"%{search}%")))
    if status in ("active", "suspended"):
        query = query.filter_by(status=status)
    users = query.order_by(User.created_at.desc()).all()
    return jsonify([{"id": u.id, "username": u.username, "email": u.email or "",
                    "joined": u.created_at.strftime("%b %d, %Y"),
                    "last_login": u.last_login.strftime("%b %d, %Y %H:%M") if u.last_login else "Never",
                    "status": u.status} for u in users])

@app.route("/api/admin/stats")
def api_admin_stats():
    admin, error = require_admin()
    if error: return error
    today = date.today()
    return jsonify({
        "users": User.query.count(),
        "active_users": User.query.filter_by(status="active").count(),
        "money_users_today": db.session.query(MoneyLog.user_id).filter(MoneyLog.date == today).distinct().count(),
        "money_entries_today": MoneyLog.query.filter_by(date=today).count(),
        "journal_entries": Thought.query.count(),
        "task_items": Task.query.count(),
        "prayer_logs": Prayer.query.count(),
        "books": Book.query.count(),
        "habits": Habit.query.count()
    })

@app.route("/api/admin/announce", methods=["POST"])
def api_admin_announce():
    admin, error = require_admin()
    if error: return error
    data = request.get_json() or {}
    text = data.get("text", "").strip()
    if not text or len(text) > 1000:
        return jsonify({"ok": False, "error": "Announcement must be 1-1000 characters."}), 400
    Announcement.query.delete()
    a = Announcement(text=text, created_at=datetime.now())
    db.session.add(a)
    db.session.flush()
    audit(admin, "create_announcement", "announcement", a.id)
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/admin/announcement")
def api_admin_announcement():
    a = Announcement.query.order_by(Announcement.id.desc()).first()
    if not a: return jsonify(None)
    return jsonify({"id": a.id, "text": a.text, "date": a.created_at.strftime("%b %d, %Y %H:%M")})

@app.route("/api/admin/reset_password", methods=["POST"])
def api_admin_reset():
    admin, error = require_admin("super_admin")
    if error: return error
    data = request.get_json() or {}
    user = User.query.filter_by(username=data["username"]).first()
    if not user: return jsonify({"ok": False, "error": "User not found."})
    if len(data.get("password", "")) < 8:
        return jsonify({"ok": False, "error": "Password must be at least 8 characters."}), 400
    user.password_hash = generate_password_hash(data["password"])
    audit(admin, "reset_user_password", "user", user.id)
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/admin/delete_user/<int:uid>", methods=["DELETE"])
def api_admin_delete_user(uid):
    admin, error = require_admin("super_admin")
    if error: return error
    user = db.session.get(User, uid)
    if user:
        Prayer.query.filter_by(user_id=uid).delete()
        Thought.query.filter_by(user_id=uid).delete()
        Task.query.filter_by(user_id=uid).delete()
        for book in Book.query.filter_by(user_id=uid).all():
            BookLog.query.filter_by(book_id=book.id).delete()
        Book.query.filter_by(user_id=uid).delete()
        for h in Habit.query.filter_by(user_id=uid).all():
            HabitLog.query.filter_by(habit_id=h.id).delete()
        Habit.query.filter_by(user_id=uid).delete()
        for ml in MoneyLog.query.filter_by(user_id=uid).all():
            CustomExpense.query.filter_by(money_log_id=ml.id).delete()
        MoneyLog.query.filter_by(user_id=uid).delete()
        MoneyState.query.filter_by(user_id=uid).delete()
        PushSubscription.query.filter_by(user_id=uid).delete()
        audit(admin, "delete_user", "user", uid)
        db.session.delete(user); db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/admin/users/<int:uid>/status", methods=["POST"])
def api_admin_user_status(uid):
    admin, error = require_admin("super_admin")
    if error: return error
    user = db.session.get(User, uid)
    status = (request.get_json() or {}).get("status")
    if not user or status not in ("active", "suspended"):
        return jsonify({"ok": False, "error": "Invalid user or status."}), 400
    user.status = status
    audit(admin, f"{status}_user", "user", uid)
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/admin/audit")
def api_admin_audit():
    admin, error = require_admin("super_admin")
    if error: return error
    records = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(200).all()
    return jsonify([{"admin": log.admin_name, "action": log.action,
                     "record_type": log.record_type, "record_id": log.record_id,
                     "created_at": log.created_at.strftime("%b %d, %Y %H:%M")} for log in records])

@app.route("/api/admin/admins", methods=["GET", "POST"])
def api_admin_accounts():
    admin, error = require_admin("super_admin")
    if error: return error
    if request.method == "GET":
        return jsonify([{"id": a.id, "username": a.username, "role": a.role,
                         "active": a.active, "last_login": a.last_login.strftime("%b %d, %Y %H:%M") if a.last_login else "Never"}
                        for a in AdminUser.query.order_by(AdminUser.username).all()])
    data = request.get_json() or {}
    username, password, role = data.get("username", "").strip(), data.get("password", ""), data.get("role")
    if len(username) < 3 or len(password) < 8 or role not in ("super_admin", "moderator"):
        return jsonify({"ok": False, "error": "Username, role, and an 8-character password are required."}), 400
    if AdminUser.query.filter_by(username=username).first():
        return jsonify({"ok": False, "error": "Admin username already exists."}), 409
    new_admin = AdminUser(username=username, password_hash=generate_password_hash(password), role=role)
    db.session.add(new_admin)
    db.session.flush()
    audit(admin, "create_admin", "admin", new_admin.id)
    db.session.commit()
    return jsonify({"ok": True})

def send_due_reminders():
    private_key = os.environ.get("VAPID_PRIVATE_KEY")
    subject = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")
    if not private_key:
        return
    now = datetime.now()
    tasks = Task.query.filter(Task.done.is_(False), Task.reminder <= now, Task.reminder_sent_at.is_(None)).all()
    for task in tasks:
        payload = json.dumps({"title": "Bloom task reminder", "body": task.text, "url": "/tasks"})
        subscriptions = PushSubscription.query.filter_by(user_id=task.user_id).all()
        for subscription in subscriptions:
            try:
                webpush(
                    subscription_info=json.loads(subscription.subscription),
                    data=payload,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": subject}
                )
            except WebPushException as error:
                status = getattr(getattr(error, "response", None), "status_code", None)
                if status in (404, 410):
                    db.session.delete(subscription)
        task.reminder_sent_at = now
    db.session.commit()

def reminder_worker():
    while True:
        with app.app_context():
            send_due_reminders()
        time.sleep(30)

if __name__ == "__main__":
    threading.Thread(target=reminder_worker, daemon=True).start()
    app.run(debug=True, port=5137)