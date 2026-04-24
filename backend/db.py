"""
Database layer — SQLModel + SQLite.
All session and rate-limit persistence lives here.
"""

import json
import os
import secrets
import time
from pathlib import Path
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine, select

# ── SQLite engine ──────────────────────────────────────────────────────────────
DB_PATH = Path(
    os.getenv("LIBERSTUDY_DB_PATH", str(Path(__file__).parent / "database.db"))
).expanduser()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    """Create all tables. Call once at application startup."""
    SQLModel.metadata.create_all(engine)
    _run_migrations()


# ── Models ─────────────────────────────────────────────────────────────────────

class SessionRow(SQLModel, table=True):
    __tablename__ = "session"

    session_id: str = Field(primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    status: str
    ppt_filename: Optional[str] = None
    audio_url: Optional[str] = None
    total_duration: int = 0
    pages_json: str = Field(default="[]")
    progress_json: Optional[str] = None
    error: Optional[str] = None
    created_at: float = Field(default_factory=time.time)


class RateLimitRow(SQLModel, table=True):
    __tablename__ = "rate_limit"

    id: Optional[int] = Field(default=None, primary_key=True)
    ip: str = Field(index=True)
    called_at: float


class UserRow(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(primary_key=True)
    google_id: str = Field(index=True, unique=True)
    email: str = Field(index=True, unique=True)
    name: str
    avatar_url: Optional[str] = None
    created_at: float = Field(default_factory=time.time)


class AuthSessionRow(SQLModel, table=True):
    __tablename__ = "auth_session"

    session_token: str = Field(primary_key=True)
    user_id: str = Field(index=True)
    expires_at: float
    created_at: float = Field(default_factory=time.time)


# ── Custom exception ───────────────────────────────────────────────────────────

class RateLimitExceeded(Exception):
    pass


# ── Session CRUD ───────────────────────────────────────────────────────────────

def _row_to_dict(row: SessionRow) -> dict:
    return {
        "session_id": row.session_id,
        "user_id": row.user_id,
        "status": row.status,
        "ppt_filename": row.ppt_filename,
        "audio_url": row.audio_url,
        "total_duration": row.total_duration,
        "pages": json.loads(row.pages_json),
        "progress": json.loads(row.progress_json) if row.progress_json else None,
        "error": row.error,
        "created_at": row.created_at,
    }


def _run_migrations() -> None:
    with engine.begin() as conn:
        session_columns = {
            row[1] for row in conn.exec_driver_sql("PRAGMA table_info('session')").fetchall()
        }
        if "user_id" not in session_columns:
            conn.exec_driver_sql("ALTER TABLE session ADD COLUMN user_id TEXT")


def save_session(session_id: str, data: dict, user_id: Optional[str] = None) -> None:
    """Insert a new session row."""
    row = SessionRow(
        session_id=session_id,
        user_id=data.get("user_id", user_id),
        status=data.get("status", "processing"),
        ppt_filename=data.get("ppt_filename"),
        audio_url=data.get("audio_url"),
        total_duration=data.get("total_duration", 0),
        pages_json=json.dumps(data.get("pages", [])),
        progress_json=json.dumps(data["progress"]) if data.get("progress") else None,
        error=data.get("error"),
    )
    with Session(engine) as s:
        s.add(row)
        s.commit()


def get_session(session_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Return session dict or None if not found."""
    with Session(engine) as s:
        row = s.get(SessionRow, session_id)
        if row is None:
            return None
        if user_id is not None and row.user_id != user_id:
            return None
        return _row_to_dict(row)


def list_sessions(user_id: Optional[str] = None) -> list[dict]:
    """Return all sessions as summary dicts (no pages), newest first."""
    with Session(engine) as s:
        stmt = select(SessionRow).order_by(SessionRow.created_at.desc())  # type: ignore[attr-defined]
        if user_id is not None:
            stmt = stmt.where(SessionRow.user_id == user_id)
        rows = s.exec(stmt).all()
    return [
        {
            "session_id": r.session_id,
            "user_id": r.user_id,
            "status": r.status,
            "ppt_filename": r.ppt_filename,
            "total_duration": r.total_duration,
            "created_at": r.created_at,
        }
        for r in rows
    ]


def update_session(session_id: str, updates: dict) -> None:
    """Partial update — only keys present in `updates` are changed."""
    with Session(engine) as s:
        row = s.get(SessionRow, session_id)
        if row is None:
            return
        if "status" in updates:
            row.status = updates["status"]
        if "user_id" in updates:
            row.user_id = updates["user_id"]
        if "ppt_filename" in updates:
            row.ppt_filename = updates["ppt_filename"]
        if "audio_url" in updates:
            row.audio_url = updates["audio_url"]
        if "total_duration" in updates:
            row.total_duration = updates["total_duration"]
        if "pages" in updates:
            row.pages_json = json.dumps(updates["pages"])
        if "progress" in updates:
            row.progress_json = json.dumps(updates["progress"]) if updates["progress"] else None
        if "error" in updates:
            row.error = updates["error"]
        s.add(row)
        s.commit()


def replace_page(session_id: str, updated_page: dict) -> None:
    """Replace a single page in session.pages by page_num (read-modify-write)."""
    with Session(engine) as s:
        row = s.get(SessionRow, session_id)
        if row is None:
            return
        pages = json.loads(row.pages_json)
        page_num = updated_page["page_num"]
        for i, p in enumerate(pages):
            if p["page_num"] == page_num:
                pages[i] = updated_page
                break
        row.pages_json = json.dumps(pages)
        s.add(row)
        s.commit()


# ── Rate limit ─────────────────────────────────────────────────────────────────

def check_and_record_rate_limit(
    ip: str,
    max_calls: int = 2,
    window_seconds: float = 86400,
) -> None:
    """
    Check if `ip` has exceeded the rate limit within the rolling window.
    If not, record this call. Raises RateLimitExceeded if over the limit.
    """
    now = time.time()
    cutoff = now - window_seconds
    with Session(engine) as s:
        recent = s.exec(
            select(RateLimitRow)
            .where(RateLimitRow.ip == ip)
            .where(RateLimitRow.called_at >= cutoff)
        ).all()
        if len(recent) >= max_calls:
            raise RateLimitExceeded(
                f"Rate limit: max {max_calls} calls per {window_seconds/3600:.0f}h."
            )
        s.add(RateLimitRow(ip=ip, called_at=now))
        s.commit()


def get_rate_limit_status(
    ip: str,
    max_calls: int = 2,
    window_seconds: float = 86400,
) -> dict:
    """Return {used, limit, remaining} for the given IP."""
    now = time.time()
    cutoff = now - window_seconds
    with Session(engine) as s:
        recent = s.exec(
            select(RateLimitRow)
            .where(RateLimitRow.ip == ip)
            .where(RateLimitRow.called_at >= cutoff)
        ).all()
    used = len(recent)
    return {"used": used, "limit": max_calls, "remaining": max(0, max_calls - used)}


def upsert_google_user(google_id: str, email: str, name: str, avatar_url: Optional[str]) -> dict:
    with Session(engine) as s:
        row = s.exec(
            select(UserRow).where(
                (UserRow.google_id == google_id) | (UserRow.email == email)
            )
        ).first()
        if row is None:
            row = UserRow(
                id=f"user_{secrets.token_hex(12)}",
                google_id=google_id,
                email=email,
                name=name,
                avatar_url=avatar_url,
            )
        else:
            row.google_id = google_id
            row.email = email
            row.name = name
            row.avatar_url = avatar_url
        s.add(row)
        s.commit()
        s.refresh(row)
        return {
            "id": row.id,
            "google_id": row.google_id,
            "email": row.email,
            "name": row.name,
            "avatar_url": row.avatar_url,
        }


def get_user(user_id: str) -> Optional[dict]:
    with Session(engine) as s:
        row = s.get(UserRow, user_id)
        if row is None:
            return None
        return {
            "id": row.id,
            "google_id": row.google_id,
            "email": row.email,
            "name": row.name,
            "avatar_url": row.avatar_url,
        }


def create_auth_session(user_id: str, expire_days: int = 7) -> str:
    now = time.time()
    token = secrets.token_urlsafe(32)
    with Session(engine) as s:
        expired_rows = s.exec(
            select(AuthSessionRow).where(AuthSessionRow.expires_at < now)
        ).all()
        for row in expired_rows:
            s.delete(row)
        s.add(
            AuthSessionRow(
                session_token=token,
                user_id=user_id,
                expires_at=now + expire_days * 86400,
            )
        )
        s.commit()
    return token


def get_user_by_auth_session(session_token: str) -> Optional[dict]:
    if not session_token:
        return None
    now = time.time()
    with Session(engine) as s:
        auth_row = s.get(AuthSessionRow, session_token)
        if auth_row is None:
            return None
        if auth_row.expires_at < now:
            s.delete(auth_row)
            s.commit()
            return None
        user_row = s.get(UserRow, auth_row.user_id)
        if user_row is None:
            s.delete(auth_row)
            s.commit()
            return None
        return {
            "id": user_row.id,
            "google_id": user_row.google_id,
            "email": user_row.email,
            "name": user_row.name,
            "avatar_url": user_row.avatar_url,
        }


def delete_auth_session(session_token: str) -> None:
    if not session_token:
        return
    with Session(engine) as s:
        row = s.get(AuthSessionRow, session_token)
        if row is None:
            return
        s.delete(row)
        s.commit()
