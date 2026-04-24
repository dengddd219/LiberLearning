import sqlite3
import time
import uuid
import os
from pathlib import Path

DB_PATH = Path(
    os.getenv("LIBERSTUDY_LIVE_DB_PATH", str(Path(__file__).parent.parent / "live_data.db"))
).expanduser()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS live_sessions (
            session_id   TEXT PRIMARY KEY,
            ppt_id       TEXT,
            language     TEXT NOT NULL DEFAULT 'zh',
            status       TEXT NOT NULL DEFAULT 'live',
            current_page INTEGER NOT NULL DEFAULT 1,
            started_at   INTEGER NOT NULL,
            ended_at     INTEGER,
            user_id      TEXT
        );
        CREATE TABLE IF NOT EXISTS live_segments (
            id                TEXT PRIMARY KEY,
            session_id        TEXT NOT NULL,
            seq               INTEGER NOT NULL,
            start_ms          INTEGER NOT NULL DEFAULT 0,
            end_ms            INTEGER NOT NULL DEFAULT 0,
            text              TEXT NOT NULL,
            source            TEXT NOT NULL DEFAULT 'mic',
            current_page_hint INTEGER,
            assigned_page     INTEGER,
            assign_confidence REAL NOT NULL DEFAULT 0,
            revision          INTEGER NOT NULL DEFAULT 1,
            created_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_live_segments_session_seq
            ON live_segments(session_id, seq);
        CREATE INDEX IF NOT EXISTS idx_live_segments_session_page
            ON live_segments(session_id, assigned_page, seq);
        CREATE TABLE IF NOT EXISTS live_annotations (
            id         TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            page_num   INTEGER NOT NULL,
            text       TEXT NOT NULL,
            x          REAL NOT NULL DEFAULT 0,
            y          REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS live_page_states (
            session_id        TEXT NOT NULL,
            page_num          INTEGER NOT NULL,
            transcript_text   TEXT NOT NULL DEFAULT '',
            live_facts_json   TEXT NOT NULL DEFAULT '{}',
            rendered_note_md  TEXT NOT NULL DEFAULT '',
            citations_json    TEXT NOT NULL DEFAULT '[]',
            last_compiled_at  INTEGER,
            PRIMARY KEY (session_id, page_num)
        );
        """)
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(live_sessions)").fetchall()
        }
        if "user_id" not in columns:
            conn.execute("ALTER TABLE live_sessions ADD COLUMN user_id TEXT")


# ── LiveSession ────────────────────────────────────────────────────────────────

def create_session(
    ppt_id: str | None = None,
    language: str = "zh",
    session_id: str | None = None,
    user_id: str | None = None,
) -> dict:
    sid = session_id or f"live_{uuid.uuid4().hex[:12]}"
    now = int(time.time() * 1000)
    with _conn() as conn:
        existing = conn.execute(
            "SELECT * FROM live_sessions WHERE session_id=?",
            (sid,),
        ).fetchone()
        if existing:
            return dict(existing)
        conn.execute(
            """
            INSERT INTO live_sessions
            (session_id, ppt_id, language, status, current_page, started_at, ended_at, user_id)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (sid, ppt_id, language, "live", 1, now, None, user_id),
        )
    return get_session(sid)  # type: ignore[return-value]


def get_session(session_id: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM live_sessions WHERE session_id=?", (session_id,)
        ).fetchone()
    return dict(row) if row else None


def update_session_status(session_id: str, status: str, ended_at: int | None = None):
    with _conn() as conn:
        if ended_at is not None:
            conn.execute(
                "UPDATE live_sessions SET status=?, ended_at=? WHERE session_id=?",
                (status, ended_at, session_id),
            )
        else:
            conn.execute(
                "UPDATE live_sessions SET status=? WHERE session_id=?",
                (status, session_id),
            )


def update_session_page(session_id: str, page: int):
    with _conn() as conn:
        conn.execute(
            "UPDATE live_sessions SET current_page=? WHERE session_id=?",
            (page, session_id),
        )


# ── LiveSegment ────────────────────────────────────────────────────────────────

def save_segment(
    session_id: str,
    text: str,
    current_page_hint: int | None,
    start_ms: int = 0,
    end_ms: int = 0,
) -> dict:
    with _conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(seq),0)+1 FROM live_segments WHERE session_id=?",
            (session_id,),
        ).fetchone()
        seq = row[0]
        seg_id = f"seg_{uuid.uuid4().hex[:10]}"
        now = int(time.time() * 1000)
        conn.execute(
            """INSERT INTO live_segments
               (id,session_id,seq,start_ms,end_ms,text,source,
                current_page_hint,assigned_page,assign_confidence,revision,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (seg_id, session_id, seq, start_ms, end_ms, text, "mic",
             current_page_hint, current_page_hint, 0.5, 1, now),
        )
    return {"id": seg_id, "seq": seq, "text": text}


def get_segments(session_id: str) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM live_segments WHERE session_id=? ORDER BY seq",
            (session_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# ── LiveAnnotation ─────────────────────────────────────────────────────────────

def save_annotation(
    session_id: str, page_num: int, text: str, x: float, y: float
) -> dict:
    ann_id = f"ann_{uuid.uuid4().hex[:10]}"
    now = int(time.time() * 1000)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO live_annotations VALUES (?,?,?,?,?,?,?)",
            (ann_id, session_id, page_num, text, x, y, now),
        )
    return {"id": ann_id, "page_num": page_num, "text": text}


def update_segment_assigned_pages(session_id: str, assignments: list[tuple[str, int]]):
    """assignments: list of (seg_id, assigned_page)"""
    with _conn() as conn:
        conn.executemany(
            "UPDATE live_segments SET assigned_page=? WHERE id=? AND session_id=?",
            [(assigned_page, seg_id, session_id) for seg_id, assigned_page in assignments],
        )
