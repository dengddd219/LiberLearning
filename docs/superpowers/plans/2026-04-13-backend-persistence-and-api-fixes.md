# Backend Persistence & API Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将后端 session 存储从内存 dict 迁移到 SQLite（SQLModel），同时修复 API 层的所有阻塞联调问题（进度字段、请求校验、rate limiter 持久化）。

**Architecture:** 新增 `backend/db.py` 作为唯一的数据层，使用 SQLModel 定义两张表（`Session` + `RateLimit`），所有路由通过该模块读写数据库；`process.py` 和 `sessions.py` 中对内存 dict 的直接操作全部替换为 db 函数调用；SQLite 文件位于 `backend/database.db`（加入 `.gitignore`）。

**Tech Stack:** SQLModel 0.0.21, SQLite (内置), FastAPI 0.115.5, Python 3.11+

---

## 文件地图

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `backend/db.py` | SQLModel 表定义 + engine + 所有 CRUD 函数 |
| 新建 | `backend/tests/test_db.py` | db.py 单元测试 |
| 新建 | `backend/tests/test_process_validation.py` | 请求参数校验测试 |
| 修改 | `backend/routers/process.py` | 替换内存 dict、加 progress 更新、加参数校验、rate limiter 走 db |
| 修改 | `backend/routers/sessions.py` | 替换 `from routers.process import _SESSIONS` |
| 修改 | `backend/main.py` | 启动时初始化数据库 |
| 修改 | `backend/requirements.txt` | 添加 sqlmodel |
| 修改 | `.gitignore` | 忽略 database.db |

---

## Task 1: 安装 SQLModel，配置 .gitignore

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `.gitignore`

- [ ] **Step 1: 添加 sqlmodel 到 requirements.txt**

在 `backend/requirements.txt` 末尾添加：
```
sqlmodel==0.0.21
```

- [ ] **Step 2: 安装依赖**

```bash
cd backend && pip install sqlmodel==0.0.21
```

Expected output: `Successfully installed sqlmodel-0.0.21`（或 already satisfied）

- [ ] **Step 3: 在 .gitignore 中忽略数据库文件**

在项目根 `.gitignore` 末尾添加：
```
# SQLite database
backend/database.db
```

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt .gitignore
git commit -m "chore: add sqlmodel dependency, ignore database.db"
```

---

## Task 2: 创建 db.py — 数据层

**Files:**
- Create: `backend/db.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_db.py`

- [ ] **Step 1: 先写测试（TDD）**

新建 `backend/tests/__init__.py`（空文件）。

新建 `backend/tests/test_db.py`：

```python
"""Unit tests for db.py — use in-memory SQLite so no file is created."""
import pytest
from sqlmodel import create_engine, SQLModel
from unittest.mock import patch

# 使用内存数据库隔离测试
TEST_DB_URL = "sqlite://"


@pytest.fixture(autouse=True)
def use_test_db(tmp_path):
    """Override engine to use in-memory SQLite for all tests."""
    import db
    test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(test_engine)
    with patch.object(db, "engine", test_engine):
        yield test_engine


def test_save_and_get_session():
    import db
    db.save_session("s1", {
        "session_id": "s1",
        "status": "processing",
        "ppt_filename": "test.pptx",
        "audio_url": None,
        "total_duration": 0,
        "pages": [],
        "progress": {"step": "uploading", "percent": 5},
        "error": None,
    })
    result = db.get_session("s1")
    assert result is not None
    assert result["session_id"] == "s1"
    assert result["status"] == "processing"
    assert result["pages"] == []
    assert result["progress"]["step"] == "uploading"


def test_update_session():
    import db
    db.save_session("s2", {
        "session_id": "s2",
        "status": "processing",
        "ppt_filename": None,
        "audio_url": None,
        "total_duration": 0,
        "pages": [],
        "progress": {"step": "uploading", "percent": 5},
        "error": None,
    })
    db.update_session("s2", {"status": "ready", "total_duration": 3600})
    result = db.get_session("s2")
    assert result["status"] == "ready"
    assert result["total_duration"] == 3600


def test_get_session_not_found():
    import db
    result = db.get_session("nonexistent")
    assert result is None


def test_rate_limit_check_allows_under_limit():
    import db
    # 第1次调用不应抛出异常
    db.check_and_record_rate_limit("1.2.3.4", max_calls=2, window_seconds=86400)


def test_rate_limit_check_blocks_over_limit():
    import db
    db.check_and_record_rate_limit("5.6.7.8", max_calls=2, window_seconds=86400)
    db.check_and_record_rate_limit("5.6.7.8", max_calls=2, window_seconds=86400)
    with pytest.raises(db.RateLimitExceeded):
        db.check_and_record_rate_limit("5.6.7.8", max_calls=2, window_seconds=86400)


def test_get_rate_limit_status():
    import db
    db.check_and_record_rate_limit("9.9.9.9", max_calls=2, window_seconds=86400)
    status = db.get_rate_limit_status("9.9.9.9", max_calls=2, window_seconds=86400)
    assert status["used"] == 1
    assert status["limit"] == 2
    assert status["remaining"] == 1
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && python -m pytest tests/test_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'db'`

- [ ] **Step 3: 创建 backend/db.py**

```python
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
    pages_json: str = Field(default="[]")       # JSON-encoded list
    progress_json: Optional[str] = None          # JSON-encoded dict or None
    error: Optional[str] = None


class RateLimitRow(SQLModel, table=True):
    __tablename__ = "rate_limit"

    id: Optional[int] = Field(default=None, primary_key=True)
    ip: str = Field(index=True)
    called_at: float  # Unix timestamp


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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend && python -m pytest tests/test_db.py -v
```

Expected: 所有 7 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/tests/__init__.py backend/tests/test_db.py
git commit -m "feat: add SQLModel db layer with session persistence and rate limit"
```

---

## Task 3: 初始化数据库 — main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: 在 main.py 启动时调用 init_db()**

在 `backend/main.py` 中，在现有 import 块末尾添加 `from db import init_db`，并在 `app = FastAPI(...)` 之后调用 `init_db()`：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from dotenv import load_dotenv
import os

from routers import process, sessions
from db import init_db  # 新增

load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(title="LiberStudy API", version="0.1.0")

# 初始化数据库（创建表）
init_db()  # 新增

# CORS
frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/slides", StaticFiles(directory="static/slides"), name="slides")
app.mount("/audio", StaticFiles(directory="static/audio"), name="audio")

app.include_router(process.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 2: 验证启动不报错**

```bash
cd backend && uvicorn main:app --reload --port 8000
```

Expected: `Application startup complete.` 且 `backend/database.db` 文件被创建

按 Ctrl+C 停止。

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: initialize SQLite database on app startup"
```

---

## Task 4: 迁移 process.py — 替换内存 dict + 加 progress

**Files:**
- Modify: `backend/routers/process.py`

完整替换 `backend/routers/process.py` 内容如下：

- [ ] **Step 1: 替换 process.py**

```python
"""
Process router.
  POST /api/process-mock  — Phase A: ignore uploads, return mock session_id
  POST /api/process       — Phase B: full real processing pipeline
  POST /api/sessions/{id}/page/{page_num}/retry  — per-page retry
  GET  /api/rate-limit/status  — remaining calls for current IP
"""

import asyncio
import json as _json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, UploadFile, File

import db
from db import check_and_record_rate_limit, get_rate_limit_status, RateLimitExceeded
from services.audio import convert_to_wav, get_audio_duration
from services.ppt_parser import parse_ppt, extract_domain_terms
from services.asr import transcribe
from services.alignment import build_page_timeline
from services.note_generator import generate_notes_for_all_pages

router = APIRouter(tags=["process"])

MAX_CALLS_PER_DAY = 2
DAY_SECONDS = 86400.0
MAX_AUDIO_SECONDS = 120 * 60

ALLOWED_LANGUAGES = {"zh", "en"}


# ── Health check ───────────────────────────────────────────────────────────────

@router.get("/process/health")
def process_health():
    return {"status": "ok", "router": "process"}


# ── Rate limit status ──────────────────────────────────────────────────────────

@router.get("/rate-limit/status")
def rate_limit_status(request: Request):
    ip = request.client.host
    return get_rate_limit_status(ip, max_calls=MAX_CALLS_PER_DAY, window_seconds=DAY_SECONDS)


# ── Phase A: Mock endpoint ─────────────────────────────────────────────────────

@router.post("/process-mock")
async def process_mock(
    ppt: Optional[UploadFile] = File(default=None),
    audio: Optional[UploadFile] = File(default=None),
):
    return {"session_id": "mock-session-001"}


# ── Phase B: Real processing pipeline ─────────────────────────────────────────

@router.post("/process")
async def process_real(
    request: Request,
    background_tasks: BackgroundTasks,
    ppt: Optional[UploadFile] = File(None),
    audio: UploadFile = File(...),
    language: str = "en",
    user_anchors: str = "[]",
):
    # 1. 参数校验
    if language not in ALLOWED_LANGUAGES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid language '{language}'. Must be one of: {sorted(ALLOWED_LANGUAGES)}",
        )

    try:
        anchors = _json.loads(user_anchors)
        if not isinstance(anchors, list):
            raise ValueError("user_anchors must be a JSON array")
    except (ValueError, _json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid user_anchors: {exc}",
        )

    audio_content_type = audio.content_type or ""
    allowed_audio_types = {
        "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3",
        "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a",
        "application/octet-stream",  # 部分浏览器 WebM 录音用这个
    }
    if audio_content_type and audio_content_type not in allowed_audio_types:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported audio type '{audio_content_type}'. Supported: webm, mp3, wav, m4a",
        )

    # 2. Rate limit（持久化到 SQLite）
    ip = request.client.host
    try:
        check_and_record_rate_limit(ip, max_calls=MAX_CALLS_PER_DAY, window_seconds=DAY_SECONDS)
    except RateLimitExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    # 3. 保存上传文件
    session_id = str(uuid.uuid4())
    session_dir = Path(tempfile.gettempdir()) / "liberstudy" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    audio_raw_path = session_dir / f"audio_raw{Path(audio.filename or '.webm').suffix}"
    with open(audio_raw_path, "wb") as f:
        f.write(await audio.read())

    ppt_path = None
    if ppt and ppt.filename:
        ppt_path = session_dir / ppt.filename
        with open(ppt_path, "wb") as f:
            f.write(await ppt.read())

    # 4. 注册 session（写入 SQLite）
    db.save_session(session_id, {
        "session_id": session_id,
        "status": "processing",
        "ppt_filename": ppt.filename if ppt else None,
        "audio_url": None,
        "total_duration": 0,
        "pages": [],
        "progress": {"step": "uploading", "percent": 5},
        "error": None,
    })

    background_tasks.add_task(
        _run_pipeline,
        session_id=session_id,
        session_dir=str(session_dir),
        audio_raw_path=str(audio_raw_path),
        ppt_path=str(ppt_path) if ppt_path else None,
        language=language,
        user_anchors=anchors,
    )

    return {"session_id": session_id}


async def _run_pipeline(
    session_id: str,
    session_dir: str,
    audio_raw_path: str,
    ppt_path: Optional[str],
    language: str,
    user_anchors: list[dict],
):
    """Background task: full processing pipeline with progress updates."""
    try:
        session_path = Path(session_dir)

        # Step 1: 音频转 WAV
        db.update_session(session_id, {"progress": {"step": "converting", "percent": 15}})
        wav_path = str(session_path / "audio.wav")
        convert_to_wav(audio_raw_path, wav_path)

        duration = get_audio_duration(wav_path)
        if duration > MAX_AUDIO_SECONDS:
            db.update_session(session_id, {
                "status": "error",
                "error": f"Audio exceeds 120-minute limit ({duration/60:.1f} min)",
                "progress": None,
            })
            return

        db.update_session(session_id, {"total_duration": int(duration)})

        # Step 2: PPT 解析
        db.update_session(session_id, {"progress": {"step": "parsing_ppt", "percent": 30}})
        slides_dir = str(Path("static") / "slides" / session_id)
        ppt_pages: list[dict] = []
        if ppt_path:
            ppt_pages = parse_ppt(ppt_path, slides_dir, pdf_name=f"slides_{session_id}.pdf")

        # Step 3: ASR 转录
        db.update_session(session_id, {"progress": {"step": "transcribing", "percent": 55}})
        asr_prompt = extract_domain_terms(ppt_pages) if ppt_pages else None
        segments = transcribe(wav_path, language=language, prompt=asr_prompt)

        # Step 4: 语义对齐
        db.update_session(session_id, {"progress": {"step": "aligning", "percent": 70}})
        if ppt_pages:
            aligned_pages = build_page_timeline(
                ppt_pages=ppt_pages,
                segments=segments,
                user_anchors=user_anchors,
                total_audio_duration=duration,
            )
        else:
            aligned_pages = [{
                "page_num": 1,
                "ppt_text": "",
                "pdf_url": None,
                "pdf_page_num": 1,
                "page_start_time": 0,
                "page_end_time": int(duration),
                "alignment_confidence": 1.0,
                "aligned_segments": segments,
                "page_supplement": None,
                "active_notes": None,
            }]

        # Step 5: LLM 笔记生成
        db.update_session(session_id, {"progress": {"step": "generating", "percent": 85}})
        generated_pages = await generate_notes_for_all_pages(aligned_pages)

        any_partial = any(p.get("status") == "partial_ready" for p in generated_pages)
        overall_status = "partial_ready" if any_partial else "ready"

        db.update_session(session_id, {
            "status": overall_status,
            "audio_url": f"/audio/{session_id}/audio.wav",
            "pages": generated_pages,
            "progress": None,
        })

    except Exception as exc:
        db.update_session(session_id, {
            "status": "error",
            "error": str(exc),
            "progress": None,
        })


# ── Per-page retry ─────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/page/{page_num}/retry")
async def retry_page(session_id: str, page_num: int):
    if session_id == "mock-session-001":
        return {"status": "ok", "message": f"Page {page_num} retry queued (mock)"}

    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    pages = session.get("pages", [])
    target = next((p for p in pages if p["page_num"] == page_num), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Page {page_num} not found")

    results = await generate_notes_for_all_pages([target])
    updated = results[0]

    for i, p in enumerate(pages):
        if p["page_num"] == page_num:
            pages[i] = updated
            break

    any_partial = any(p.get("status") == "partial_ready" for p in pages)
    new_status = "partial_ready" if any_partial else "ready"

    db.update_session(session_id, {"pages": pages, "status": new_status})

    return {"status": "ok", "page": updated}
```

- [ ] **Step 2: 运行现有测试确认不破坏已有逻辑**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: 之前的 db 测试全 PASS，无新失败

- [ ] **Step 3: 手动验证服务启动**

```bash
cd backend && uvicorn main:app --reload --port 8000
```

访问 `http://localhost:8000/api/process/health`，Expected: `{"status":"ok","router":"process"}`

按 Ctrl+C 停止。

- [ ] **Step 4: Commit**

```bash
git add backend/routers/process.py
git commit -m "feat: migrate process.py to SQLite persistence, add progress field and request validation"
```

---

## Task 5: 迁移 sessions.py — 替换内存 dict 引用

**Files:**
- Modify: `backend/routers/sessions.py`

- [ ] **Step 1: 替换 get_session 路由中的内存 dict 引用**

将 `backend/routers/sessions.py` 中 `get_session` 函数替换为：

```python
@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    if session_id == "mock-session-001":
        return MOCK_SESSION

    import db as _db
    session = _db.get_session(session_id)
    if session:
        return session

    raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
```

（只改这一个函数，MOCK_SESSION 常量和其他代码不动）

- [ ] **Step 2: 验证 mock endpoint 仍然正常**

启动服务：
```bash
cd backend && uvicorn main:app --reload --port 8000
```

访问 `http://localhost:8000/api/sessions/mock-session-001`，Expected: 返回完整 mock JSON，含 3 个 page

按 Ctrl+C 停止。

- [ ] **Step 3: Commit**

```bash
git add backend/routers/sessions.py
git commit -m "feat: sessions.py reads from SQLite instead of in-memory dict"
```

---

## Task 6: 请求参数校验测试

**Files:**
- Create: `backend/tests/test_process_validation.py`

- [ ] **Step 1: 写校验测试**

新建 `backend/tests/test_process_validation.py`：

```python
"""Tests for POST /api/process parameter validation."""
import io
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

# 使用内存数据库隔离测试
import os
os.environ.setdefault("DATABASE_URL", "sqlite://")


@pytest.fixture
def client():
    from sqlmodel import create_engine, SQLModel
    import db

    test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(test_engine)

    with patch.object(db, "engine", test_engine):
        from main import app
        with TestClient(app) as c:
            yield c


def _audio_file():
    return ("audio", ("test.wav", io.BytesIO(b"RIFF" + b"\x00" * 100), "audio/wav"))


def test_invalid_language_returns_422(client):
    resp = client.post(
        "/api/process",
        files=[_audio_file()],
        data={"language": "fr"},
    )
    assert resp.status_code == 422
    assert "language" in resp.json()["detail"].lower()


def test_invalid_user_anchors_returns_422(client):
    resp = client.post(
        "/api/process",
        files=[_audio_file()],
        data={"user_anchors": "not-valid-json"},
    )
    assert resp.status_code == 422
    assert "user_anchors" in resp.json()["detail"].lower()


def test_valid_language_zh_passes_validation(client):
    """Valid language should not return 422 (may fail at processing stage, that's ok)."""
    with patch("routers.process._run_pipeline", new_callable=AsyncMock):
        resp = client.post(
            "/api/process",
            files=[_audio_file()],
            data={"language": "zh"},
        )
    # 422 は言語バリデーション失敗。それ以外は ok（429 rate limit など）
    assert resp.status_code != 422
```

- [ ] **Step 2: 运行测试**

```bash
cd backend && python -m pytest tests/test_process_validation.py -v
```

Expected: 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_process_validation.py
git commit -m "test: add request parameter validation tests for POST /api/process"
```

---

## Task 7: 更新 api-spec.md

**Files:**
- Modify: `docs/api-spec.md`

- [ ] **Step 1: 更新 api-spec.md 中的过时描述**

在 `docs/api-spec.md` 中做以下更新：

**1. 在 `GET /api/sessions/{session_id}` 的 Session 顶层字段表格中添加 `progress` 字段：**

```markdown
| `progress` | object | 是 | 仅当 `status = "processing"` 时存在；结构为 `{"step": string, "percent": number}` |
```

**2. 将 Bullet 结构中的 `timestamp` 字段替换为 `timestamp_start` + `timestamp_end`：**

```markdown
#### `Bullet` 结构

| 字段              | 类型         | Nullable | 说明                                                      |
|-------------------|--------------|----------|-----------------------------------------------------------|
| `text`            | string       | 否       | AI 提炼的笔记正文                                          |
| `ai_comment`      | string       | 是       | AI 对该条目的补充说明（可空）                              |
| `timestamp_start` | number (int) | 否       | 对应音频起始时间点，单位：秒，相对于整段音频开始的绝对时间 |
| `timestamp_end`   | number (int) | 否       | 对应音频结束时间点，单位：秒，相对于整段音频开始的绝对时间 |
```

**3. 新增 `GET /api/rate-limit/status` endpoint 文档：**

```markdown
### `GET /api/rate-limit/status`

返回当前 IP 的调用次数状态。

**Response**

​```json
{ "used": 1, "limit": 2, "remaining": 1 }
​```
```

**4. 删除"前端对接前后端问题清单"末尾的 P0 问题 1 条目**（bullet 字段名问题已修复）。

- [ ] **Step 2: Commit**

```bash
git add docs/api-spec.md
git commit -m "docs: update api-spec.md — progress field, bullet timestamps, rate-limit endpoint"
```

---

## 自检（Self-Review）

**Spec 覆盖：**
- ✅ SQLite 持久化（Task 2-5）
- ✅ progress 字段（Task 4 `_run_pipeline`）
- ✅ 请求参数校验（Task 4 `process_real`，Task 6 测试）
- ✅ rate limiter 持久化（Task 2 `db.py`，Task 4 使用）
- ✅ `GET /api/rate-limit/status`（Task 4）
- ✅ api-spec.md 更新（Task 7）

**未在此计划中处理（前端负责）：**
- `pdf_url` / `audio_url` 相对路径拼接 → 前端 `VITE_API_BASE_URL`
- processing 期间 pages 骨架（P2，推迟）
- rate limiter 次数显示 UI（前端读 `/api/rate-limit/status`）

**类型一致性：**
- `db.save_session` / `db.update_session` / `db.get_session` 签名在 Task 2 定义，Task 3-5 使用，名称一致
- `RateLimitExceeded` 在 Task 2 定义，Task 4 import 使用，一致
- `progress` 字段结构 `{"step": str, "percent": int}` 在 Task 2 测试和 Task 4 实现中一致
