from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = "users"
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80), unique=True, nullable=False)
    email         = db.Column(db.String(254), unique=True, nullable=True)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    last_login    = db.Column(db.DateTime, nullable=True)
    status        = db.Column(db.String(20), default="active", nullable=False)

class AdminUser(db.Model):
    __tablename__ = "admin_users"
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role          = db.Column(db.String(20), default="moderator", nullable=False)
    active        = db.Column(db.Boolean, default=True, nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    last_login    = db.Column(db.DateTime, nullable=True)

class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id          = db.Column(db.Integer, primary_key=True)
    admin_id    = db.Column(db.Integer, nullable=False)
    admin_name  = db.Column(db.String(80), nullable=False)
    action      = db.Column(db.String(80), nullable=False)
    record_type = db.Column(db.String(80), nullable=True)
    record_id   = db.Column(db.Integer, nullable=True)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

class Prayer(db.Model):
    __tablename__ = "prayers"
    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    date    = db.Column(db.Date, nullable=False)
    name    = db.Column(db.String(20), nullable=False)
    done    = db.Column(db.Boolean, default=False)

class Thought(db.Model):
    __tablename__ = "thoughts"
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    text       = db.Column(db.Text, nullable=False)
    fav        = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Task(db.Model):
    __tablename__ = "tasks"
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    text       = db.Column(db.String(500), nullable=False)
    done       = db.Column(db.Boolean, default=False)
    priority   = db.Column(db.String(10), default="medium")
    deadline   = db.Column(db.DateTime, nullable=True)
    reminder   = db.Column(db.DateTime, nullable=True)
    reminder_sent_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class PushSubscription(db.Model):
    __tablename__ = "push_subscriptions"
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    endpoint   = db.Column(db.Text, unique=True, nullable=False)
    subscription = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Habit(db.Model):
    __tablename__ = "habits"
    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name    = db.Column(db.String(200), nullable=False)

class HabitLog(db.Model):
    __tablename__ = "habit_logs"
    id       = db.Column(db.Integer, primary_key=True)
    habit_id = db.Column(db.Integer, db.ForeignKey("habits.id"), nullable=False)
    date     = db.Column(db.Date, nullable=False)

class MoneyLog(db.Model):
    __tablename__ = "money_logs"
    id        = db.Column(db.Integer, primary_key=True)
    user_id   = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    date      = db.Column(db.Date, nullable=False)
    amount    = db.Column(db.Float, default=0)
    breakfast = db.Column(db.Float, default=0)
    lunch     = db.Column(db.Float, default=0)
    dinner    = db.Column(db.Float, default=0)
    cheez     = db.Column(db.Float, default=0)
    snacks    = db.Column(db.Float, default=0)
    others    = db.Column(db.Float, default=0)
    is_saved  = db.Column(db.Boolean, default=False)

class MoneyState(db.Model):
    __tablename__ = "money_states"
    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True, nullable=False)
    total_entered = db.Column(db.Float, default=0)
    old_spending  = db.Column(db.Float, default=0)
    today_date    = db.Column(db.String(10), nullable=False)
    breakfast     = db.Column(db.Float, default=0)
    lunch         = db.Column(db.Float, default=0)
    dinner        = db.Column(db.Float, default=0)
    snacks        = db.Column(db.Float, default=0)
    others        = db.Column(db.Float, default=0)
    today_saved   = db.Column(db.Boolean, default=False)
    other_items   = db.Column(db.Text, default="[]")

class CustomExpense(db.Model):
    __tablename__ = "custom_expenses"
    id           = db.Column(db.Integer, primary_key=True)
    money_log_id = db.Column(db.Integer, db.ForeignKey("money_logs.id"), nullable=False)
    name         = db.Column(db.String(200), nullable=False)
    amount       = db.Column(db.Float, default=0)

class Book(db.Model):
    __tablename__ = "books"
    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    title       = db.Column(db.String(300), nullable=False)
    total_pages = db.Column(db.Integer, nullable=False)
    daily_goal  = db.Column(db.Integer, default=20)
    start_date  = db.Column(db.Date)

class BookLog(db.Model):
    __tablename__ = "book_logs"
    id         = db.Column(db.Integer, primary_key=True)
    book_id    = db.Column(db.Integer, db.ForeignKey("books.id"), nullable=False)
    date       = db.Column(db.Date, nullable=False)
    pages_read = db.Column(db.Integer, default=0)

class Announcement(db.Model):
    __tablename__ = "announcements"
    id         = db.Column(db.Integer, primary_key=True)
    text       = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)