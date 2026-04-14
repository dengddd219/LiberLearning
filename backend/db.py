"""
Database layer — SQLModel + SQLite.
All session and rate-limit persistence lives here.
"""

import json
import time
from pathlib import Path
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine, select

# ── SQLite engine ──────────────────────────────────────────────────────────────
DB_PATH = Path(__file__).parent / "database.db"
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    """Create all tables. Call once at application startup."""
    SQLModel.metadata.create_all(engine)


# ── Models ─────────────────────────────────────────────────────────────────────

class SessionRow(SQLModel, table=True):
    __tablename__ = "session"

    session_id: str = Field(primary_key=True)
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


# ── Custom exception ───────────────────────────────────────────────────────────

class RateLimitExceeded(Exception):
    pass


# ── Session CRUD ───────────────────────────────────────────────────────────────

def _row_to_dict(row: SessionRow) -> dict:
    return {
        "session_id": row.session_id,
        "status": row.status,
        "ppt_filename": row.ppt_filename,
        "audio_url": row.audio_url,
        "total_duration": row.total_duration,
        "pages": json.loads(row.pages_json),
        "progress": json.loads(row.progress_json) if row.progress_json else None,
        "error": row.error,
        "created_at": row.created_at,
    }


def save_session(session_id: str, data: dict) -> None:
    """Insert a new session row."""
    row = SessionRow(
        session_id=session_id,
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


def get_session(session_id: str) -> Optional[dict]:
    """Return session dict or None if not found."""
    with Session(engine) as s:
        row = s.get(SessionRow, session_id)
        if row is None:
            return None
        return _row_to_dict(row)


def list_sessions() -> list[dict]:
    """Return all sessions as summary dicts (no pages), newest first."""
    with Session(engine) as s:
        rows = s.exec(
            select(SessionRow).order_by(SessionRow.created_at.desc())  # type: ignore[attr-defined]
        ).all()
    return [
        {
            "session_id": r.session_id,
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
