# Granola 复刻 Phase 1 执行计划——服务端 Transcript 数据面 + 完整产品功能

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通从"开始录音"到"读完整课 AI Notes"的完整产品主线，覆盖 L739–L981 的 9 个产品功能点：
1. transcript 持久化到服务端（SQLite）
2. 翻页时记录 page-snapshot（带页码 hint 的 segment 归属）
3. 结束课程按钮语义清晰（与"暂停"区分）
4. 结束课程后第一屏：完整 transcript（带页码）+ My Notes 长文（带页码索引跳转）+ Generate Notes 按钮
5. 点击 Generate Notes 后：AI Notes 流式生成（SSE，可见过程）+ 并行 alignment
6. AI Notes 两层结构：简洁主体 + hover 放大镜 → 悬浮侧栏详细解释
7. 无 PPT 模式：进入全屏笔记模式，生成主题式 notes
8. Transcript 带 PPT 页码 match
9. 课中/课后展示逻辑严格分开

**Architecture:**
- 后端：`live_store.py`（SQLite 4表）+ `live.py` 扩展（8个新HTTP接口 + WebSocket 改造 + SSE finalize 接口）+ `live_note_builder.py`（调 Claude 生成 AI Notes）
- 前端：`LivePage.tsx` 状态机（idle→live→stopped→finalizing→done）+ 课后视图 + AI Notes SSE 流式展示 + Detailed Notes 悬浮侧栏 + 无PPT模式

**Tech Stack:** FastAPI + SQLite（同步 sqlite3）、React + TypeScript、现有阿里云 NLS ASR（WebSocket）、现有 `alignment.py`、Claude API（SSE 流式）

**工作目录：** `.worktrees/livepage-phase1`（branch: `feature/livepage-phase1`）

---

## 文件地图

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/services/live_store.py` | **新建** | SQLite CRUD：4张表（live_sessions / live_segments / live_annotations / live_page_states） |
| `backend/services/live_note_builder.py` | **新建** | 调 Claude SSE 生成 AI Notes，输出事件流供 finalize 接口消费 |
| `backend/main.py` | **修改** | 启动时调 `live_store.init_db()` |
| `backend/routers/live.py` | **修改** | 8个新HTTP接口（session/start、page-snapshot、annotations、state、stop、finalize-stream、finalize/status、detailed-note）；WebSocket 接收 session_id query param，SentenceEnd 时持久化 segment |
| `frontend/src/pages/LivePage.tsx` | **修改** | 新增 liveSessionId / sessionStatus state；完整课后视图；SSE AI Notes 流式；Detailed Notes 侧栏；无PPT全屏笔记模式 |

---

## Task 1：新建 `backend/services/live_store.py`

**Files:**
- Create: `backend/services/live_store.py`

- [ ] **Step 1：写 live_store.py**

路径：`.worktrees/livepage-phase1/backend/services/live_store.py`

```python
import sqlite3
import time
import uuid
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "live_data.db"


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
            ended_at     INTEGER
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


# ── LiveSession ────────────────────────────────────────────────────────────────

def create_session(ppt_id: str | None = None, language: str = "zh") -> dict:
    sid = f"live_{uuid.uuid4().hex[:12]}"
    now = int(time.time() * 1000)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO live_sessions VALUES (?,?,?,?,?,?,?)",
            (sid, ppt_id, language, "live", 1, now, None),
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
```

- [ ] **Step 2：在 main.py 启动时调用 init_db**

打开 `.worktrees/livepage-phase1/backend/main.py`，在现有 import 区末尾追加：

```python
from services.live_store import init_db as _live_init_db
_live_init_db()
```

位置：放在 `app = FastAPI(...)` 之前。

- [ ] **Step 3：验证建表**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/backend
python -c "from services.live_store import init_db; init_db(); print('OK')"
ls live_data.db
```

期望：输出 `OK`，目录下出现 `live_data.db`。

- [ ] **Step 4：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add backend/services/live_store.py backend/main.py
git commit -m "feat: add live_store.py with SQLite 4-table schema and init_db"
```

---

## Task 2：新建 `backend/services/live_note_builder.py`

这是 AI Notes 流式生成的核心。finalize 接口调用它，通过 SSE 把内容推给前端。

**复用策略（对齐 NotesPage）：**
- system prompt **不复用** `passive_ppt_notes/prompt.md`（那个输出 JSON 结构），改用独立 inline prompt，要求输出**带时间戳的 markdown bullet**（格式：`- [MM:SS–MM:SS] 内容`）
- 无 PPT 时按主题段落组织，格式：`## 主题名` + `- [MM:SS–MM:SS] 内容`
- 时间戳来源：`_format_segments()` 输出的 `[MM:SS–MM:SS]` 前缀，Claude 直接从 transcript 提取到 bullet 里
- transcript 格式化复用 `_format_segments()` 逻辑（带 `[MM:SS–MM:SS]` 时间戳前缀）
- PPT 格式化复用 `_format_ppt_bullets()` 逻辑（编号列表）
- Anthropic 调用走 system/user 分离 + `cache_control: ephemeral`（prompt caching）
- `stream_notes` 失败最多重试 1 次（P1：finalize-stream 降级保护）
- `generate_detailed_note` 用 module-level `threading.Semaphore(3)` 限制并发，按时间范围精准过滤 segments（不截断）

**Files:**
- Create: `backend/services/live_note_builder.py`

- [ ] **Step 1：写 live_note_builder.py**

```python
"""
生成课后 AI Notes（markdown 格式，每条 bullet 带时间戳，便于 Detailed Notes 精准定位）。
输入：完整 transcript segments（带 assigned_page）+ 可选 PPT page texts
输出：SSE 文本流（每个 token 一个 data: 事件，最终内容为 markdown 字符串）

AI Notes 输出格式（有PPT）：
  ## 第1页
  - [03:12–04:45] 梯度消失问题的本质
  - [04:46–05:30] 解决方案：残差连接

AI Notes 输出格式（无PPT）：
  ## 深度学习基础
  - [00:10–02:30] 神经网络的基本结构
"""
import json
import os
import threading
from pathlib import Path
from typing import Generator

import anthropic

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
_detailed_note_semaphore = threading.Semaphore(3)  # 同时最多 3 个详细解释调用


# ---------------------------------------------------------------------------
# 格式化工具（复用 note_generator 的逻辑）
# ---------------------------------------------------------------------------

def _format_segments(segments: list[dict]) -> str:
    """带 [MM:SS–MM:SS] 时间戳的 transcript 块，与 note_generator._format_segments 一致。"""
    lines = []
    for seg in segments:
        start = int(seg.get("start_ms", 0) / 1000) if "start_ms" in seg else int(seg.get("start", 0))
        end = int(seg.get("end_ms", 0) / 1000) if "end_ms" in seg else int(seg.get("end", 0))
        mm_s, ss_s = divmod(start, 60)
        mm_e, ss_e = divmod(end, 60)
        lines.append(f"[{mm_s:02d}:{ss_s:02d}–{mm_e:02d}:{ss_e:02d}] {seg['text']}")
    return "\n".join(lines) or "(no transcript)"


def _format_ppt_bullets(ppt_text: str) -> str:
    """编号列表，与 note_generator._format_ppt_bullets 一致。"""
    lines = [l.strip() for l in ppt_text.splitlines() if l.strip()]
    if not lines:
        return "(no bullet points on this slide)"
    return "\n".join(f"{i+1}. {line}" for i, line in enumerate(lines))


def _load_system_prompt(has_ppt: bool) -> str:
    """根据是否有 PPT 返回内联 system prompt，要求输出带时间戳的 markdown bullet。"""
    if has_ppt:
        return (
            "You are a lecture note assistant. Given PPT bullet points and the teacher's transcript "
            "(with timestamps), generate concise AI notes in markdown.\n\n"
            "Output format (strictly follow):\n"
            "## 第{N}页\n"
            "- [MM:SS–MM:SS] key point from this page\n"
            "- [MM:SS–MM:SS] another key point\n\n"
            "Rules:\n"
            "- Each bullet MUST start with the timestamp range [MM:SS–MM:SS] copied from the transcript.\n"
            "- If a point spans multiple segments, use the first segment's start and last segment's end.\n"
            "- Write in the same language as the transcript.\n"
            "- Do NOT invent content not in the transcript.\n"
            "- Skip pages with no transcript (no bullet needed)."
        )
    else:
        return (
            "You are a lecture note assistant. Given the teacher's transcript (with timestamps), "
            "generate concise AI notes organized by topic in markdown.\n\n"
            "Output format (strictly follow):\n"
            "## Topic Name\n"
            "- [MM:SS–MM:SS] key point about this topic\n"
            "- [MM:SS–MM:SS] another key point\n\n"
            "Rules:\n"
            "- Each bullet MUST start with the timestamp range [MM:SS–MM:SS] copied from the transcript.\n"
            "- Group related points under the same ## topic heading.\n"
            "- Write in the same language as the transcript.\n"
            "- Do NOT invent content not in the transcript."
        )


# ---------------------------------------------------------------------------
# stream_notes：整课 AI Notes 流式生成
# ---------------------------------------------------------------------------

def _build_notes_user_msg(
    segments: list[dict],
    ppt_pages: list[dict] | None,
    my_notes: list[dict] | None,
) -> str:
    """构建 user_msg（transcript + PPT + my_notes），格式与 note_generator 对齐。"""
    transcript_block = _format_segments(segments) if segments else "(no transcript)"

    my_notes_block = ""
    if my_notes:
        parts = [f"第{n['page']}页：{n['text'].strip()}" for n in my_notes if n.get("text", "").strip()]
        my_notes_block = "\n".join(parts)

    if ppt_pages:
        # 按页拼接 PPT bullets + 该页 transcript
        page_seg_map: dict[int, list[dict]] = {}
        for seg in segments:
            p = seg.get("assigned_page") or seg.get("current_page_hint") or 0
            page_seg_map.setdefault(p, []).append(seg)

        parts = []
        for p in ppt_pages:
            page_num = p["page_num"]
            bullets = _format_ppt_bullets(p.get("ppt_text", ""))
            page_segs = page_seg_map.get(page_num, [])
            transcript = _format_segments(page_segs) if page_segs else "(no transcript for this page)"
            parts.append(
                f"=== 第{page_num}页 ===\n"
                f"## PPT Bullet Points\n{bullets}\n\n"
                f"## Transcript\n{transcript}"
            )
        user_msg = "\n\n".join(parts)
        if my_notes_block:
            user_msg += f"\n\n## Student Notes (for reference)\n{my_notes_block}"
        return user_msg
    else:
        user_msg = f"## Transcript\n{transcript_block}"
        if my_notes_block:
            user_msg += f"\n\n## Student Notes (for reference)\n{my_notes_block}"
        return user_msg


def stream_notes(
    segments: list[dict],
    ppt_pages: list[dict] | None,
    my_notes: list[dict] | None,
    max_retries: int = 1,
) -> Generator[str, None, None]:
    """
    生成器：每次 yield 一个 SSE data 行。
    system prompt 要求输出带时间戳的 markdown bullet（- [MM:SS–MM:SS] 内容）。
    失败最多重试 max_retries 次。
    """
    system_prompt = _load_system_prompt(has_ppt=bool(ppt_pages))
    user_msg = _build_notes_user_msg(segments, ppt_pages, my_notes)

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    kwargs = {"base_url": base_url} if base_url else {}
    client = anthropic.Anthropic(api_key=api_key, **kwargs)

    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
            return
        except Exception as e:
            last_exc = e
            if attempt < max_retries:
                yield f"data: {json.dumps({'retry': attempt + 1})}\n\n"

    yield f"data: {json.dumps({'error': str(last_exc)})}\n\n"
    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# generate_detailed_note：逐行详细解释（SSE 流式，并发限制 3）
# ---------------------------------------------------------------------------

_DETAILED_NOTE_SYSTEM = """You are a study assistant. Explain the given lecture note bullet in detail, grounded in the teacher's actual transcript. Write 2-4 paragraphs, 2-3 sentences each. Do NOT invent content not present in the transcript. Write in the same language as the transcript."""


def generate_detailed_note(
    line_text: str,
    page_num: int | None,
    segments: list[dict],
    start_sec: float | None = None,
    end_sec: float | None = None,
) -> Generator[str, None, None]:
    """
    针对某条 AI Note bullet，基于 transcript 做 line-level explain（SSE 流式）。
    优先按时间范围（start_sec/end_sec ± 30s 上下文窗口）过滤 segments，
    时间范围缺失时降级为同页过滤。不截断条数。
    用 _detailed_note_semaphore 限制同时最多 3 个并发调用。
    """
    if start_sec is not None and end_sec is not None:
        # 时间范围精准过滤：取 bullet 时间段内及前后 30s 上下文
        window_start = max(0, start_sec - 30)
        window_end = end_sec + 30
        relevant = [
            s for s in segments
            if (s.get("end_ms", 0) / 1000) >= window_start
            and (s.get("start_ms", 0) / 1000) <= window_end
        ]
    elif page_num is not None:
        relevant = [s for s in segments if s.get("assigned_page") == page_num]
    else:
        relevant = segments
    transcript_excerpt = _format_segments(relevant) if relevant else "(no relevant transcript)"

    page_label = f"第{page_num}页" if page_num is not None else "全课"
    user_msg = (
        f"## Note to Explain\n{line_text}\n\n"
        f"## {page_label} Transcript\n{transcript_excerpt}"
    )

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    kwargs = {"base_url": base_url} if base_url else {}
    client = anthropic.Anthropic(api_key=api_key, **kwargs)

    with _detailed_note_semaphore:
        try:
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=512,
                system=[{"type": "text", "text": _DETAILED_NOTE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    yield "data: [DONE]\n\n"
```

> **注意**：`_detailed_note_semaphore` 的 `acquire` 改为在路由层 `live_detailed_note` 做 non-blocking acquire（429 快速失败），`release` 在生成器的 `finally` 里做。因此这里的 `with _detailed_note_semaphore:` 实际上**不再负责 acquire**——路由层已经 acquire 过了，这里的 `with` 会立刻成功（因为已持有）。若担心混淆，可以把这里的 `with _detailed_note_semaphore:` 整层去掉，直接写：

```python
    try:
        with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=[{"type": "text", "text": _DETAILED_NOTE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'text': text})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

    yield "data: [DONE]\n\n"
```

- [ ] **Step 2：验证 import**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/backend
python -c "from services.live_note_builder import stream_notes, generate_detailed_note; print('OK')"
```

期望：`OK`

- [ ] **Step 3：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add backend/services/live_note_builder.py
git commit -m "feat: live_note_builder — inline markdown prompt, system/user split, cache_control, retry, semaphore"
```

---

## Task 3：扩展 `live.py`——8 个新 HTTP 接口

**Files:**
- Modify: `backend/routers/live.py`

- [ ] **Step 1：顶部补充 import 和 Pydantic 模型**

在 `live.py` 中，将：
```python
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
```
改为：
```python
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import StreamingResponse
```

在现有 `class ExplainRequest(BaseModel):` **之前**，追加：

```python
import time
from services.live_store import (
    create_session, get_session, update_session_status,
    update_session_page, save_segment, get_segments,
    save_annotation,
)
from services.live_note_builder import stream_notes, generate_detailed_note


class SessionStartRequest(BaseModel):
    ppt_id: str | None = None
    language: str = "zh"


class PageSnapshotRequest(BaseModel):
    session_id: str
    current_page: int
    timestamp_ms: int = 0


class AnnotationRequest(BaseModel):
    session_id: str
    page_num: int
    text: str
    x: float = 0.0
    y: float = 0.0


class SessionStopRequest(BaseModel):
    session_id: str
    ppt_pages: list[dict] | None = None  # [{page_num, ppt_text}]，有 PPT 时传入触发后台 alignment


class FinalizeRequest(BaseModel):
    session_id: str
    ppt_pages: list[dict] | None = None   # [{page_num, ppt_text}]
    my_notes: list[dict] | None = None    # [{page, text}]


class DetailedNoteRequest(BaseModel):
    session_id: str
    line_text: str
    page_num: int | None = None
    start_sec: float | None = None  # bullet 时间戳起点（秒），从 AI Notes markdown 解析
    end_sec: float | None = None    # bullet 时间戳终点（秒）
```

- [ ] **Step 2：新增 POST /api/live/session/start**

在 `@router.post("/live/explain")` 之前插入：

```python
@router.post("/live/session/start")
def live_session_start(req: SessionStartRequest):
    session = create_session(ppt_id=req.ppt_id, language=req.language)
    return {"session_id": session["session_id"], "status": session["status"]}
```

- [ ] **Step 3：新增 POST /api/live/page-snapshot**

```python
@router.post("/live/page-snapshot")
def live_page_snapshot(req: PageSnapshotRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    update_session_page(req.session_id, req.current_page)
    return {"ok": True, "current_page": req.current_page}
```

- [ ] **Step 4：新增 POST /api/live/annotations**

```python
@router.post("/live/annotations")
def live_save_annotation(req: AnnotationRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    ann = save_annotation(req.session_id, req.page_num, req.text, req.x, req.y)
    return ann
```

- [ ] **Step 5：新增 GET /api/live/state/{session_id}**

返回完整 transcript（带 page 信息），供课后展示用：

```python
@router.get("/live/state/{session_id}")
def live_get_state(session_id: str, page_num: int | None = None):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    segments = get_segments(session_id)
    if page_num is not None:
        filtered = [
            s for s in segments
            if s.get("current_page_hint") == page_num
            or s.get("assigned_page") == page_num
        ]
    else:
        filtered = segments
    # 返回带 page 信息的 transcript（供前端课后展示页码 match）
    transcript_with_page = [
        {
            "text": s["text"],
            "page": s.get("assigned_page") or s.get("current_page_hint"),
            "seq": s["seq"],
        }
        for s in filtered
    ]
    return {
        "session_id": session_id,
        "status": session["status"],
        "current_page": session["current_page"],
        "transcript": transcript_with_page,
        "segment_count": len(segments),
    }
```

- [ ] **Step 6：新增 POST /api/live/stop**

课程结束时调用：状态 live → stopped，记录结束时间，**同时在后台异步触发 alignment**（方案 A：在 stop 时就把 embedding 算好写回 SQLite，用户点 Generate Notes 时 alignment 已就绪，AI Notes 立刻开始流式输出）。

在 `live.py` 顶部 import 区追加（与 Step 7 共用）：

```python
import threading
from services.alignment import build_page_timeline
from services.live_store import update_segment_assigned_pages
```

在 `live_store.py` 末尾新增 `update_segment_assigned_pages`（批量回写 assigned_page）：

```python
def update_segment_assigned_pages(session_id: str, assignments: list[tuple[str, int]]):
    """assignments: list of (seg_id, assigned_page)"""
    with _conn() as conn:
        conn.executemany(
            "UPDATE live_segments SET assigned_page=? WHERE id=? AND session_id=?",
            [(assigned_page, seg_id, session_id) for seg_id, assigned_page in assignments],
        )
```

`/live/stop` 接口实现：

> **实现说明**：`_run_alignment_background` 内部调用 `build_page_timeline`（同步 OpenAI embedding IO），不能在 FastAPI 的 BackgroundTasks（event loop 内）里跑，必须用 `threading.Thread` 在独立线程里执行，避免阻塞 async event loop。

```python
def _run_alignment_background(session_id: str, ppt_pages: list[dict]):
    """独立线程：跑 embedding alignment 并回写 assigned_page。
    用 threading.Thread 而非 BackgroundTasks，因为 build_page_timeline 是同步 IO，
    必须在线程里跑，不能阻塞 async event loop。
    """
    try:
        raw_segments = get_segments(session_id)
        if not raw_segments:
            return
        align_input = [
            {"text": s["text"], "start": s["start_ms"] / 1000.0, "end": s["end_ms"] / 1000.0}
            for s in raw_segments
        ]
        aligned = build_page_timeline(
            ppt_pages=ppt_pages,
            segments=align_input,
            user_anchors=None,
            total_audio_duration=raw_segments[-1]["end_ms"] / 1000.0,
        )
        assignments: list[tuple[str, int]] = []
        for page in aligned:
            page_num = page["page_num"]
            for seg in page.get("aligned_segments", []):
                start_ms = int(seg["start"] * 1000)
                for rs in raw_segments:
                    if rs["start_ms"] == start_ms and rs["text"] == seg["text"]:
                        assignments.append((rs["id"], page_num))
                        break
        if assignments:
            update_segment_assigned_pages(session_id, assignments)
    except Exception:
        pass  # alignment 失败不影响后续 Generate Notes，降级用 current_page_hint


@router.post("/live/stop")
def live_stop(req: SessionStopRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    update_session_status(req.session_id, "stopped", ended_at=int(time.time() * 1000))
    # 如果前端传了 ppt_pages，用独立线程异步跑 alignment（不阻塞 stop 响应，也不阻塞 event loop）
    if req.ppt_pages:
        t = threading.Thread(
            target=_run_alignment_background,
            args=(req.session_id, req.ppt_pages),
            daemon=True,
        )
        t.start()
    return {"session_id": req.session_id, "status": "stopped"}
```

- [ ] **Step 7：新增 POST /api/live/finalize-stream（SSE，AI Notes 流式生成）**

接收 session_id + ppt_pages + my_notes，直接用 SQLite 里 `/live/stop` 时已回写的 `assigned_page`，立刻开始 SSE 流式生成。**alignment 已在 stop 时后台完成，这里不再等待。**

> **Race condition 说明**：finalize-stream 只允许 `stopped` 状态进入（不允许 `live`）。原因：若 `live` 时直接 finalize，后台 alignment 线程（stop 时触发）可能还在运行，`assigned_page` 尚未写回，会导致 AI Notes 的页码归属全部降级为 `current_page_hint`。正确流程：先调 `/live/stop`（触发 alignment 线程）→ 再调 `/live/finalize-stream`（alignment 大概率已完成）。

```python
@router.post("/live/finalize-stream")
def live_finalize_stream(req: FinalizeRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    if session["status"] != "stopped":
        raise HTTPException(
            status_code=400, detail=f"cannot finalize in status {session['status']}; call /live/stop first"
        )
    update_session_status(req.session_id, "finalizing")

    raw_segments = get_segments(req.session_id)
    # assigned_page 已由 /live/stop 后台 alignment 写入；
    # 若 alignment 未完成或失败，current_page_hint 作为降级值（save_segment 时已设置）

    def generate():
        try:
            yield from stream_notes(raw_segments, req.ppt_pages, req.my_notes, max_retries=1)
            update_session_status(req.session_id, "done")
        except Exception as e:
            update_session_status(req.session_id, "stopped")  # stopped 允许用户重试
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"  # 确保客户端 SSE 循环能正常退出

    return StreamingResponse(generate(), media_type="text/event-stream")
```

- [ ] **Step 8：新增 GET /api/live/finalize/status/{session_id}**

```python
@router.get("/live/finalize/status/{session_id}")
def live_finalize_status(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return {"session_id": session_id, "status": session["status"]}
```

- [ ] **Step 9：新增 POST /api/live/detailed-note（SSE，逐行详细解释）**

```python
@router.post("/live/detailed-note")
def live_detailed_note(req: DetailedNoteRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    # non-blocking acquire：超过 3 个并发时立刻返回 429，而不是阻塞线程池
    from services.live_note_builder import _detailed_note_semaphore
    if not _detailed_note_semaphore.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="too many concurrent detailed-note requests, try again")
    segments = get_segments(req.session_id)

    def gen_and_release():
        try:
            yield from generate_detailed_note(req.line_text, req.page_num, segments, req.start_sec, req.end_sec)
        finally:
            _detailed_note_semaphore.release()

    return StreamingResponse(gen_and_release(), media_type="text/event-stream")
```

- [ ] **Step 10：验证路由 import 不报错**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/backend
python -c "from routers.live import router; print('live router OK')"
```

期望：`live router OK`

- [ ] **Step 11：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add backend/routers/live.py
git commit -m "feat: add 8 live HTTP endpoints including finalize-stream SSE and detailed-note"
```

---

## Task 4：WebSocket 接收 session_id，SentenceEnd 时持久化 segment

**Files:**
- Modify: `backend/routers/live.py`（WebSocket 函数）

- [ ] **Step 1：函数签名接收 session_id query param**

找到 `@router.websocket("/ws/live-asr")`，将：

```python
async def live_asr(websocket: WebSocket):
```

改为：

```python
async def live_asr(websocket: WebSocket, session_id: str | None = None):
```

- [ ] **Step 2：SentenceEnd 时写入 segment**

找到 `elif name == "SentenceEnd":` 分支内的 `await websocket.send_text(...)` 调用，在其**之后**追加：

```python
                            # 持久化 final segment
                            if session_id:
                                try:
                                    sess = get_session(session_id)
                                    page_hint = sess["current_page"] if sess else None
                                    save_segment(
                                        session_id=session_id,
                                        text=text,
                                        current_page_hint=page_hint,
                                        start_ms=int(payload.get("begin_time", 0)),
                                        end_ms=int(payload.get("time", 0)),
                                    )
                                except Exception:
                                    pass  # 持久化失败不中断 ASR
```

- [ ] **Step 3：验证 import 无误**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/backend
python -c "import routers.live; print('WS import OK')"
```

- [ ] **Step 4：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add backend/routers/live.py
git commit -m "feat: persist final ASR segments to SQLite on SentenceEnd via session_id"
```

---

## Task 5：LivePage——录音启动调 session/start + WebSocket 携带 session_id

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

当前代码中，`startRecording` 函数在 L714 附近，WebSocket 连接在 L721：
```tsx
const ws = new WebSocket(`${WS_BASE}/api/ws/live-asr`)
```

- [ ] **Step 1：新增两个 state**

在现有 `useState` 声明区（L118 附近）追加：

```tsx
const [liveBackendSessionId, setLiveBackendSessionId] = useState<string | null>(null)
const [sessionStatus, setSessionStatus] = useState<
  'idle' | 'live' | 'stopped' | 'finalizing' | 'done'
>('idle')
```

> 注意：这里用 `liveBackendSessionId` 区别于已有的 `draftSessionId`（前者是 SQLite 里的 live_xxx，后者是现有 session 系统的 id）。

- [ ] **Step 2：在 startRecording 的 WebSocket 连接之前插入 session/start 调用**

找到 `startRecording` 函数（L714），在 `const ws = new WebSocket(...)` 这行**之前**插入：

```tsx
// 创建服务端 live session（如果尚未创建）
let backendSid = liveBackendSessionId
if (!backendSid) {
  try {
    const startRes = await fetch(`${API_BASE}/api/live/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ppt_id: pptId ?? null, language: 'zh' }),
    })
    const startData = await startRes.json() as { session_id: string; status: string }
    backendSid = startData.session_id
    setLiveBackendSessionId(backendSid)
  } catch {
    // session/start 失败不影响录音继续
  }
}
setSessionStatus('live')
```

- [ ] **Step 3：把 session_id 带入 WebSocket URL**

将：
```tsx
const ws = new WebSocket(`${WS_BASE}/api/ws/live-asr`)
```
改为：
```tsx
const ws = new WebSocket(
  backendSid
    ? `${WS_BASE}/api/ws/live-asr?session_id=${backendSid}`
    : `${WS_BASE}/api/ws/live-asr`
)
```

- [ ] **Step 4：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

期望：0 errors，或只有与本次无关的已有错误。

- [ ] **Step 5：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: LivePage calls session/start on record start, passes session_id to WebSocket"
```

---

## Task 6：LivePage——翻页时调 page-snapshot

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

翻页通过 `setCurrentPage` 触发，分散在多处（键盘、滚轮、导航栏点击、工具栏按钮）。最干净的做法是在 `useEffect` 里监听 `currentPage` 变化时 fire-and-forget。

- [ ] **Step 1：在 currentPage useEffect 区追加 page-snapshot 调用**

找到 L875 附近的 `useEffect(() => { currentPageRef.current = currentPage }, [currentPage])`，在其**之后**新增一个独立 effect：

```tsx
useEffect(() => {
  if (!liveBackendSessionId || sessionStatus !== 'live') return
  fetch(`${API_BASE}/api/live/page-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: liveBackendSessionId,
      current_page: currentPage,
      timestamp_ms: Date.now(),
    }),
  }).catch(() => {})
}, [currentPage, liveBackendSessionId, sessionStatus])
```

- [ ] **Step 2：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: LivePage sends page-snapshot on each page turn during live"
```

---

## Task 7：LivePage——结束课程按钮语义明确 + 课后第一屏

当前 `stopRecording`（L803）调用后直接进入 `processing` 状态并上传音频走完整流水线，这与新产品主线不同。新主线：结束课程 → `stopped` 态（展示 transcript + My Notes 长文 + Generate Notes 按钮），完全不自动触发处理。

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

- [ ] **Step 1：新增课后用 state**

在 state 声明区追加：

```tsx
const [postClassTranscript, setPostClassTranscript] = useState<
  Array<{ text: string; page: number | null; seq: number }>
>([])
const [allMyNotesList, setAllMyNotesList] = useState<{ page: number; text: string }[]>([])
const [aiNotesText, setAiNotesText] = useState('')
const [aiNotesStreaming, setAiNotesStreaming] = useState(false)
// Detailed Notes 悬浮侧栏
const [detailedNoteOpen, setDetailedNoteOpen] = useState(false)
const [detailedNoteText, setDetailedNoteText] = useState('')
const [detailedNoteStreaming, setDetailedNoteStreaming] = useState(false)
const [detailedNoteSource, setDetailedNoteSource] = useState('')  // 触发该侧栏的 bullet 原文
const [detailedNotePageNum, setDetailedNotePageNum] = useState<number | null>(null)
```

- [ ] **Step 2：新建 handleEndClass 函数（替代直接调 stopRecording 的语义）**

在 `stopRecording` 函数之后新增：

```tsx
const handleEndClass = useCallback(async () => {
  // 停止录音资源
  await flushPendingMyNotes()
  clearProcessingPoll()

  const recorder = mediaRecorderRef.current
  const stream = recorder?.stream
  if (recorder && recorder.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })
  }
  stream?.getTracks().forEach((track) => track.stop())
  mediaStreamRef.current = null
  wsRef.current?.close()

  // 通知服务端 stop
  if (liveBackendSessionId) {
    try {
      // 把 ppt_pages 传给 stop，后端在后台异步跑 alignment，不阻塞 stop 响应
      await fetch(`${API_BASE}/api/live/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: liveBackendSessionId,
          ppt_pages: pptPages.length > 0
            ? pptPages.map(p => ({ page_num: p.page_num, ppt_text: p.ppt_text ?? '' }))
            : null,
        }),
      })
    } catch { /* ignore */ }
  }

  setWsStatus('stopped')
  setSessionStatus('stopped')
  setNoteMode('transcript')

  // 从服务端拉取完整 transcript（带页码）
  if (liveBackendSessionId) {
    try {
      const res = await fetch(`${API_BASE}/api/live/state/${liveBackendSessionId}`)
      const data = await res.json() as {
        transcript: Array<{ text: string; page: number | null; seq: number }>
      }
      setPostClassTranscript(data.transcript ?? [])
    } catch { /* ignore */ }
  }

  // 收集所有页的 My Notes
  // 有 PPT：按页 load；无 PPT：直接从内存 myNoteTexts Map 取，不走 IndexedDB 异步
  if (pptPages.length > 0) {
    const sid = notesSessionId ?? liveBackendSessionId ?? 'live-unbound'
    const collected = await Promise.all(
      pptPages.map(async (p) => ({
        page: p.page_num,
        text: await loadMyNote(sid, p.page_num).catch(() => ''),
      }))
    )
    setAllMyNotesList(collected)
  } else {
    // 无 PPT 模式：myNoteTexts 已在内存中，直接取所有非空条目
    const collected = Array.from(myNoteTexts.entries())
      .map(([pageNum, text]) => ({ page: pageNum, text }))
      .filter(item => item.text.trim())
    setAllMyNotesList(collected)
  }
}, [
  clearProcessingPoll, flushPendingMyNotes, liveBackendSessionId,
  myNoteTexts, notesSessionId, pptPages,
])
```

> `loadMyNote` 已在 L22 导入。

- [ ] **Step 3：把顶部"结束课堂"按钮改为调 handleEndClass**

找到 L1296–L1313 的 `结束课堂` 按钮：

```tsx
onClick={() => { void stopRecording() }}
```

改为：

```tsx
onClick={() => { void handleEndClass() }}
```

同时把按钮文字从 `结束课堂` 改为 `结束课程`（与产品规范一致）。

- [ ] **Step 4：课后态禁用课中编辑行为**

课后（`sessionStatus` 为 `stopped / finalizing / done`）时，PPT 角色从「编辑容器」变为「定位索引」，课中编辑功能应被关闭。

**4a：NotesPanel My Notes 设只读**

找到 `<NotesPanel>` 的调用处（L1687 附近），新增 prop：

```tsx
readOnly={sessionStatus !== 'idle' && sessionStatus !== 'live'}
```

> 如果 NotesPanel 尚无 `readOnly` prop，在 `NotesPanel.tsx` 里为 My Notes 的 `<textarea>` 加上 `readOnly={props.readOnly}` 即可。

**4b：CanvasToolbar 工具按钮课后 disable**

找到 `<CanvasToolbar>` 调用处，新增：

```tsx
disabled={sessionStatus !== 'idle' && sessionStatus !== 'live'}
```

> CanvasToolbar 把 `disabled` prop 透传给各工具按钮（高亮、文字标注等）。如果当前无此 prop，在 CanvasToolbar.tsx 根元素加 `pointer-events: none; opacity: 0.4` 即可。

- [ ] **Step 5：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: handleEndClass — stops recording, calls /live/stop with ppt_pages for async alignment, post-class read-only mode"
```

---

## Task 8：LivePage——课后 Transcript tab 带页码展示

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

当前 Transcript tab 的渲染逻辑在 NotesPanel 组件里，通过 `liveTranscriptSegments` prop 传入。课后模式下，需要展示 `postClassTranscript`（带 page 信息，从服务端拉取）。

- [ ] **Step 1：找到 NotesPanel 组件调用，传入课后 transcript**

搜索 `<NotesPanel`，找到组件调用处。新增 prop（如组件不支持则直接在调用处覆盖 transcript prop）：

检查 `NotesPanel` 组件接受的 props（读 `frontend/src/components/notes/NotesPanel.tsx` 或搜索其接口定义），确认是否有 `liveTranscriptSegments` prop。

- [ ] **Step 2：课后 Transcript 展示**

如果 NotesPanel 有 `liveTranscriptSegments` prop，则在调用处：

```tsx
liveTranscriptSegments={
  sessionStatus === 'stopped' || sessionStatus === 'finalizing' || sessionStatus === 'done'
    ? postClassTranscript.map((item, i) => ({
        text: item.text,
        timestamp: i,
        pageNum: item.page ?? 0,
      }))
    : liveTranscriptSegments
}
```

如果 NotesPanel 没有独立的 transcript prop 而是内部管理，则在 LivePage 的 NotesPanel 外面直接渲染课后 Transcript 覆盖层：

在 NotesPanel 外层的课后态（`sessionStatus === 'stopped' || ...`）增加一段 JSX，覆盖 Transcript tab 内容：

```tsx
{(sessionStatus === 'stopped' || sessionStatus === 'finalizing' || sessionStatus === 'done') && noteMode === 'transcript' && (
  <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: C.white, padding: '20px', zIndex: 10 }}>
    <p style={{ fontSize: 11, color: C.secondary, marginBottom: 16 }}>
      课程已结束 · 完整转录
    </p>
    {postClassTranscript.length === 0 ? (
      <p style={{ color: C.muted }}>暂无转录内容</p>
    ) : (
      postClassTranscript.map((item, i) => (
        <div key={i} style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {item.page != null && (
            <button
              type="button"
              onClick={() => setCurrentPage(item.page!)}
              style={{
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 700,
                background: C.divider,
                color: C.fg,
                border: 'none',
                borderRadius: 3,
                padding: '2px 6px',
                cursor: 'pointer',
              }}
            >
              P{item.page}
            </button>
          )}
          <p style={{ color: C.fg, lineHeight: 1.7, margin: 0 }}>{item.text}</p>
        </div>
      ))
    )}
  </div>
)}
```

> 页码标签做成可点击按钮，点击后 `setCurrentPage(item.page)` ——满足"课后 PPT 作为定位索引"的需求。

- [ ] **Step 3：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: post-class Transcript view with clickable page index badges"
```

---

## Task 9：LivePage——课后 My Notes 长文（带页码跳转）

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

- [ ] **Step 1：在右侧笔记面板区域，课后 My Notes 覆盖层**

仿照 Task 8 Step 2 的模式，当 `sessionStatus` 为课后态 且 `noteMode === 'my'` 时，渲染长文视图：

```tsx
{(sessionStatus === 'stopped' || sessionStatus === 'finalizing' || sessionStatus === 'done') && noteMode === 'my' && (
  <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: C.white, padding: '20px', zIndex: 10 }}>
    <p style={{ fontSize: 11, color: C.secondary, marginBottom: 16 }}>
      课程已结束 · 整课笔记
    </p>
    {allMyNotesList.filter(n => n.text.trim()).length === 0 ? (
      <p style={{ color: C.muted }}>本节课未写笔记</p>
    ) : (
      allMyNotesList.filter(n => n.text.trim()).map((note) => (
        <div key={note.page} style={{ marginBottom: 24 }}>
          <button
            type="button"
            onClick={() => setCurrentPage(note.page)}
            style={{
              fontSize: 11,
              fontWeight: 700,
              background: 'transparent',
              color: C.secondary,
              border: `1px solid ${C.divider}`,
              borderRadius: 4,
              padding: '2px 8px',
              marginBottom: 8,
              cursor: 'pointer',
              display: 'block',
            }}
          >
            第 {note.page} 页
          </button>
          <div style={{ color: C.fg, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontSize: 14 }}>
            {note.text}
          </div>
        </div>
      ))
    )}
  </div>
)}
```

> "第 X 页"按钮点击后 `setCurrentPage(note.page)` 实现 PPT 索引跳转。

- [ ] **Step 2：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: post-class My Notes long-form view with clickable page index"
```

---

## Task 10：LivePage——Generate Notes 按钮 + AI Notes SSE 流式展示

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

- [ ] **Step 1：Generate Notes 按钮 + finalizing 状态提示**

在 LivePage JSX 的底部控制栏区域（L1330 之后，`</div>` 闭合前），追加：

```tsx
{sessionStatus === 'stopped' && (
  <div
    style={{
      position: 'fixed',
      bottom: 28,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 200,
    }}
  >
    <button
      type="button"
      onClick={() => { void handleGenerateNotes() }}
      style={{
        background: C.dark,
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '11px 32px',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
      }}
    >
      Generate Notes
    </button>
  </div>
)}

{sessionStatus === 'finalizing' && (
  <div
    style={{
      position: 'fixed',
      bottom: 28,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 200,
    }}
  >
    <div style={{ color: C.secondary, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
        style={{ borderColor: C.secondary, borderTopColor: 'transparent' }}
      />
      正在生成笔记...
    </div>
  </div>
)}
```

- [ ] **Step 2：handleGenerateNotes 函数**

在组件内其他 handler 附近添加：

```tsx
const handleGenerateNotes = useCallback(async () => {
  if (!liveBackendSessionId || sessionStatus !== 'stopped') return
  setSessionStatus('finalizing')
  setAiNotesText('')
  setAiNotesStreaming(true)
  setNoteMode('ai')

  // 收集 ppt_pages 和 my_notes 传给后端
  const pptPagesPayload = pptPages.map(p => ({
    page_num: p.page_num,
    ppt_text: p.ppt_text ?? '',
  }))
  const myNotesPayload = allMyNotesList.filter(n => n.text.trim())

  try {
    const res = await fetch(`${API_BASE}/api/live/finalize-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: liveBackendSessionId,
        ppt_pages: pptPagesPayload.length > 0 ? pptPagesPayload : null,
        my_notes: myNotesPayload.length > 0 ? myNotesPayload : null,
      }),
    })

    if (!res.ok || !res.body) {
      throw new Error('finalize-stream failed')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let outerDone = false
    while (!outerDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') { outerDone = true; break }
        let parsed: { text?: string; error?: string }
        try {
          parsed = JSON.parse(payload)
        } catch { continue }  // 只跳过非法 JSON
        if (parsed.error) throw new Error(parsed.error)  // 向外层 catch 传播，触发 setSessionStatus('stopped')
        if (parsed.text) {
          setAiNotesText(prev => prev + parsed.text)
        }
      }
    }

    setSessionStatus('done')
  } catch {
    setSessionStatus('stopped')
  } finally {
    setAiNotesStreaming(false)
  }
}, [liveBackendSessionId, sessionStatus, pptPages, allMyNotesList])
```

- [ ] **Step 3：AI Notes 课后视图渲染**

当 `sessionStatus` 为 finalizing/done 且 `noteMode === 'ai'` 时，展示 AI Notes（流式 + 最终态）。在 Task 8 Step 2 的覆盖层旁边添加：

```tsx
{(sessionStatus === 'finalizing' || sessionStatus === 'done') && noteMode === 'ai' && (
  <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: C.white, padding: '20px', zIndex: 10 }}>
    <p style={{ fontSize: 11, color: C.secondary, marginBottom: 16 }}>
      {aiNotesStreaming ? '正在生成 AI 笔记...' : 'AI 笔记'}
    </p>
    {aiNotesText ? (
      <AiNotesRenderer
        text={aiNotesText}
        sessionId={liveBackendSessionId}
        onDetailedNote={handleOpenDetailedNote}
      />
    ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted }}>
        <div
          className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
          style={{ borderColor: C.muted, borderTopColor: 'transparent' }}
        />
        等待生成...
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4：实现 AiNotesRenderer 内联组件**

在 LivePage 组件定义的**外部**（文件顶部区域），新增内联组件：

```tsx
// 把 "MM:SS" 时间字符串转为秒数
function parseTimeSec(t: string): number {
  const [mm, ss] = t.split(':').map(Number)
  return (mm ?? 0) * 60 + (ss ?? 0)
}

// 解析 bullet 行里的时间戳：`- [MM:SS–MM:SS] 内容` → { bulletText, startSec, endSec }
// 正则同时兼容 en-dash（U+2013, –）和普通 hyphen（-），因为 Claude 输出可能用任意一种
function parseBulletLine(line: string): { bulletText: string; startSec: number | null; endSec: number | null } {
  const tsMatch = line.slice(2).match(/^\[(\d{2}:\d{2})[–\-](\d{2}:\d{2})\]\s*(.+)/)
  if (tsMatch) {
    return {
      startSec: parseTimeSec(tsMatch[1]),
      endSec: parseTimeSec(tsMatch[2]),
      bulletText: tsMatch[3].trim(),
    }
  }
  return { bulletText: line.slice(2), startSec: null, endSec: null }
}

// 预处理每行，提前标注其所属 page（解决 React 严格模式下 let 在 .map() 里可变的问题）
type RenderedLine =
  | { kind: 'h3'; text: string; key: number }
  | { kind: 'bullet'; bulletText: string; startSec: number | null; endSec: number | null; page: number | null; key: number }
  | { kind: 'blank'; key: number }
  | { kind: 'p'; text: string; key: number }

function preprocessLines(text: string): RenderedLine[] {
  const lines = text.split('\n')
  const result: RenderedLine[] = []
  let currentPage: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const pageMatch = line.match(/^##\s*第(\d+)页/)
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10)
      result.push({ kind: 'h3', text: line.replace(/^##\s*/, ''), key: i })
    } else if (line.startsWith('## ')) {
      result.push({ kind: 'h3', text: line.replace(/^##\s*/, ''), key: i })
    } else if (line.startsWith('- ')) {
      const { bulletText, startSec, endSec } = parseBulletLine(line)
      result.push({ kind: 'bullet', bulletText, startSec, endSec, page: currentPage, key: i })
    } else if (!line.trim()) {
      result.push({ kind: 'blank', key: i })
    } else {
      result.push({ kind: 'p', text: line, key: i })
    }
  }
  return result
}

function AiNotesRenderer({
  text,
  sessionId,
  onDetailedNote,
}: {
  text: string
  sessionId: string | null
  onDetailedNote: (line: string, pageNum: number | null, startSec: number | null, endSec: number | null) => void
}) {
  const renderedLines = preprocessLines(text)

  return (
    <div style={{ lineHeight: 1.8 }}>
      {renderedLines.map((item) => {
        if (item.kind === 'h3') {
          return (
            <h3 key={item.key} style={{ fontSize: 15, fontWeight: 700, marginTop: 20, marginBottom: 8, color: '#2F3331' }}>
              {item.text}
            </h3>
          )
        }
        if (item.kind === 'bullet') {
          return (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginBottom: 6,
                padding: '4px 6px',
                borderRadius: 4,
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.04)'
                const icon = e.currentTarget.querySelector<HTMLElement>('.detail-icon')
                if (icon) icon.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                const icon = e.currentTarget.querySelector<HTMLElement>('.detail-icon')
                if (icon) icon.style.opacity = '0'
              }}
            >
              <span style={{ color: '#798C00', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>•</span>
              <span style={{ flex: 1, color: '#2F3331', fontSize: 14 }}>
                {item.startSec !== null && (
                  <span style={{ fontSize: 10, color: '#AFB3B0', marginRight: 6 }}>
                    {/* 时间戳标签从 bullet 文本头部提取 */}
                    {item.startSec !== null ? `[${Math.floor(item.startSec/60).toString().padStart(2,'0')}:${(item.startSec%60).toString().padStart(2,'0')}–${Math.floor((item.endSec??0)/60).toString().padStart(2,'0')}:${((item.endSec??0)%60).toString().padStart(2,'0')}]` : ''}
                  </span>
                )}
                {item.bulletText}
              </span>
              {sessionId && (
                <button
                  type="button"
                  className="detail-icon"
                  onClick={() => onDetailedNote(item.bulletText, item.page, item.startSec, item.endSec)}
                  style={{
                    opacity: 0,
                    transition: 'opacity 0.15s',
                    flexShrink: 0,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    borderRadius: 4,
                    color: '#798C00',
                    fontSize: 14,
                  }}
                  title="查看详细解释"
                >
                  🔍
                </button>
              )}
            </div>
          )
        }
        if (item.kind === 'blank') return <div key={item.key} style={{ height: 8 }} />
        return <p key={item.kind === 'p' ? item.key : item.key} style={{ color: '#2F3331', fontSize: 14, marginBottom: 4 }}>{(item as { text: string }).text}</p>
      })}
    </div>
  )
}
```

> 时间戳以小字灰色展示在 bullet 文字前，不影响阅读，但帮助用户定位原始录音位置。

- [ ] **Step 5：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: Generate Notes SSE streaming, AiNotesRenderer with hover magnifier"
```

---

## Task 11：LivePage——Detailed Notes 悬浮侧栏

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

- [ ] **Step 1：handleOpenDetailedNote 函数**

```tsx
const handleOpenDetailedNote = useCallback(async (
  lineText: string,
  pageNum: number | null,
  startSec: number | null,
  endSec: number | null,
) => {
  if (!liveBackendSessionId) return
  setDetailedNoteSource(lineText)
  setDetailedNotePageNum(pageNum)
  setDetailedNoteText('')
  setDetailedNoteStreaming(true)
  setDetailedNoteOpen(true)

  try {
    const res = await fetch(`${API_BASE}/api/live/detailed-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: liveBackendSessionId,
        line_text: lineText,
        page_num: pageNum,
        start_sec: startSec,   // 精准时间过滤，后端用这两个值做 ±30s 窗口
        end_sec: endSec,
      }),
    })

    if (!res.ok || !res.body) throw new Error('detailed-note failed')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let outerDone = false
    while (!outerDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') { outerDone = true; break }
        let parsed: { text?: string; error?: string }
        try {
          parsed = JSON.parse(payload)
        } catch { continue }  // 只跳过非法 JSON
        if (parsed.error) break  // 服务端报错，静默退出（详细解释失败不影响主流程）
        if (parsed.text) setDetailedNoteText(prev => prev + parsed.text)
      }
    }
  } catch { /* ignore */ } finally {
    setDetailedNoteStreaming(false)
  }
}, [liveBackendSessionId])
```

- [ ] **Step 2：悬浮侧栏 JSX**

在 LivePage return 的最外层 `<div>` 内，紧贴结束处（`</div>` 之前）追加：

```tsx
{/* Detailed Notes 悬浮侧栏 */}
{detailedNoteOpen && (
  <div
    style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width: 360,
      height: '100vh',
      background: C.white,
      borderLeft: `1px solid ${C.divider}`,
      zIndex: 300,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
    }}
  >
    {/* 侧栏顶部 */}
    <div
      style={{
        flexShrink: 0,
        padding: '14px 16px',
        borderBottom: `1px solid ${C.divider}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: C.secondary }}>详细解释</span>
      <button
        type="button"
        onClick={() => setDetailedNoteOpen(false)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 18 }}
      >
        ×
      </button>
    </div>

    {/* 触发源 bullet */}
    <div style={{ flexShrink: 0, padding: '10px 16px', background: C.bg, borderBottom: `1px solid ${C.divider}` }}>
      <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
        {detailedNotePageNum != null ? `第 ${detailedNotePageNum} 页 · ` : ''}原文
      </p>
      <p style={{ fontSize: 13, color: C.fg, margin: '4px 0 0', fontWeight: 500, lineHeight: 1.6 }}>
        {detailedNoteSource}
      </p>
    </div>

    {/* 解释内容 */}
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
      {detailedNoteText ? (
        <p style={{ fontSize: 14, color: C.fg, lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>
          {detailedNoteText}
          {detailedNoteStreaming && (
            <span style={{ display: 'inline-block', width: 2, height: 14, background: C.fg, marginLeft: 2, animation: 'blink 1s infinite' }} />
          )}
        </p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted }}>
          <div
            className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
            style={{ borderColor: C.muted, borderTopColor: 'transparent' }}
          />
          生成中...
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 3：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: Detailed Notes floating sidebar with SSE explanation"
```

---

## Task 12：LivePage——无 PPT 全屏笔记模式

无 PPT 时，整个 canvas 区域（main + resizer）完全不渲染，NotesPanel 自然占满全宽——像 Granola 一样，界面中只有笔记区。

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

- [ ] **Step 1：计算 `hasPpt`**

在 state 计算区（L198 附近，`pageSource` 定义之后）追加：

```tsx
const hasPpt = pageSource.length > 0 || !!localPdfUrl
```

- [ ] **Step 2：无 PPT 时完全隐藏 main + resizer，并在 aside 内显示提示**

找到 L1408 的 `<main className="flex-1 flex flex-col overflow-hidden" ...>`，在其**外层**加条件渲染（连同 resizer 一起隐藏）。同时，找到左侧 `<aside>` 内部最顶层的 div，在 `!hasPpt` 时渲染明确提示（满足需求 L753-756）：

```tsx
{/* 左侧 aside 内，无 PPT 时替换整个 canvas 区域 */}
{!hasPpt && (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: C.muted,
    gap: 12,
    padding: 24,
    textAlign: 'center',
  }}>
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 13h4" />
    </svg>
    <p style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
      未上传 PPT<br />
      <span style={{ fontSize: 12, color: C.muted }}>笔记已全屏展开</span>
    </p>
  </div>
)}
```

找到 L1408 的 `<main ...>`，在其**外层**加条件渲染（连同 resizer 一起隐藏）：

```tsx
{hasPpt && (
  <>
    {/* resizer 分隔条 */}
    <div
      onMouseDown={handleResizerMouseDown}
      className="flex-shrink-0 flex items-center justify-center"
      style={{
        width: '8px',
        cursor: 'col-resize',
        background: 'transparent',
        position: 'relative',
        zIndex: 10,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.06)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <div style={{ width: '1px', height: '100%', background: 'rgba(175,179,176,0.2)' }} />
    </div>

    <main className="flex-1 flex flex-col overflow-hidden" style={{ background: C.bg }}>
      {/* ...原有 CanvasToolbar + canvas 内容，全部保留不变... */}
    </main>
  </>
)}
```

> **注意**：LivePage.tsx 的实际 DOM 顺序是 `aside → resizer → main → NotesPanel`（NotesPanel 在最右）。`resizer` 分隔条和 `<main>`（canvas 区域）挨在一起，两者都需要包进 `{hasPpt && (...)}` 里。无 PPT 时两者都不渲染，`<NotesPanel>` 的 `flex-1` 自然撑满全宽。`notesPanelWidth` prop 传 `undefined` 时确认 NotesPanel 内部用 `notesPanelWidth ?? '100%'` 即可。实际行号以当时文件为准，不要硬编码 L1408/L1671 等行号——直接搜索 `onMouseDown={handleResizerMouseDown}` 定位 resizer，搜索 `<main className` 定位 main。

- [ ] **Step 3：验证 NotesPanel 全宽**

打开 `frontend/src/components/notes/NotesPanel.tsx`，找到根元素的宽度设置，确认 `notesPanelWidth` 为 undefined/null 时是 `'100%'` 或 `flex-1`。如果不是，加一行：

```tsx
style={{ width: notesPanelWidth ?? '100%', ... }}
```

- [ ] **Step 4：无 PPT 时 Generate Notes 用主题式 prompt（无需修改）**

后端 `live_note_builder.py` 的 `_load_system_prompt(has_ppt=False)` 已经用主题式段落格式（`## 主题名` + `- [MM:SS–MM:SS] 内容`）。前端 `handleGenerateNotes` 在 `pptPagesPayload.length === 0` 时传 `null`，后端自动走无 PPT 分支。不需要额外修改。

- [ ] **Step 5：TypeScript 类型检查**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6：commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: no-PPT fullscreen notes mode with thematic AI Notes generation"
```

---

## Task 13：端到端验证

**Files:** 无代码改动

- [ ] **Step 1：启动后端**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/backend
python -m uvicorn main:app --reload --port 8000
```

- [ ] **Step 2：启动前端**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1/frontend
npm run dev
```

- [ ] **Step 3：验证 session/start**

```bash
curl -s -X POST http://localhost:8000/api/live/session/start \
  -H "Content-Type: application/json" \
  -d '{"language": "zh"}' | python -m json.tool
```

期望：`{"session_id": "live_xxxxxxxxxxxx", "status": "live"}`

- [ ] **Step 4：验证 finalize-stream（无音频）**

```bash
# 先用上一步的 session_id
SID=live_xxxxxxxxxxxx
# 先 stop
curl -s -X POST http://localhost:8000/api/live/stop \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"$SID\"}" | python -m json.tool
# 再 finalize-stream（没有 segments，但应该能生成基于空转录的笔记）
curl -s -X POST http://localhost:8000/api/live/finalize-stream \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"$SID\"}"
```

期望：SSE 流输出 `data: {"text": ...}` 行，最后 `data: [DONE]`

- [ ] **Step 5：浏览器完整流程（有 PPT）**

1. 打开 `http://localhost:5173/live`
2. 上传 PPT → 等待解析完成，左侧出现页面导航
3. 点击"开始录音" → Network 面板有 `POST /api/live/session/start` 200
4. 翻页 → Network 面板有 `POST /api/live/page-snapshot` 200
5. 说几句话 → Transcript tab 有字幕出现
6. 点击"结束课程" → My Notes 切长文，Transcript tab 展示完整内容（带 P1/P2 页码标签），底部出现 **Generate Notes** 按钮
7. 点击 Generate Notes → 切到 AI Notes，内容从上往下流式出现
8. hover 某条 bullet → 出现 🔍 图标
9. 点击 🔍 → 右侧悬浮侧栏弹出，流式生成详细解释
10. 点击 × 关闭侧栏

- [ ] **Step 6：浏览器完整流程（无 PPT）**

1. 打开 `http://localhost:5173/live`（不上传 PPT）
2. 左侧 canvas 区域显示"无 PPT 模式 · 笔记已全屏展开"提示
3. 点击"开始录音"，右侧 My Notes 可以连续写
4. 说几句话，Transcript tab 有字幕
5. 点击"结束课程" → My Notes 切长文，底部出现 Generate Notes
6. 点击 Generate Notes → AI Notes 按主题段落（## 主题名）生成

- [ ] **Step 7：核心验收——transcript 持久化**

```bash
# 在说了几句话后：
curl -s http://localhost:8000/api/live/state/$SID | python -m json.tool
```

期望：`transcript` 列表不为空，每条有 `text` 和 `page` 字段。

- [ ] **Step 8：最终 commit**

```bash
cd /c/Users/19841/Desktop/github/LiberLearning/LiberLearning/.worktrees/livepage-phase1
git add .
git commit -m "feat: Phase 1 complete — full live session lifecycle with AI Notes SSE, Detailed Notes, no-PPT mode"
```

---

## 验收标准

| 验收项 | 检查方式 |
|--------|----------|
| 录音时每条 final segment 写入 SQLite | `curl /api/live/state/{id}` 返回非空 transcript（带 page 字段） |
| 断开页面后 transcript 不丢 | 刷新后再查 state 接口，内容保持 |
| 结束课程/暂停严格分开 | 浏览器确认两个按钮独立存在，stopRecording 不再被"结束课程"触发 |
| 结束课程后 Transcript 展示带页码标签 | 每条 transcript 旁有 P1/P2 等可点击徽章，点击跳 PPT |
| 结束课程后 My Notes 切长文 + 页码跳转 | 浏览器视觉确认，点击"第 X 页"跳转左侧 PPT |
| Generate Notes 按钮课后出现 | sessionStatus === 'stopped' 时固定底部显示 |
| AI Notes 流式生成（可见过程） | 文字从上到下逐字出现，非黑盒等待 |
| AI Notes hover 出现放大镜 | hover bullet 行右侧出现 🔍 图标 |
| 点击放大镜打开悬浮侧栏 | 右侧 360px 侧栏弹出，流式生成详细解释 |
| 无 PPT 时 canvas 区域显示提示 | 不上传 PPT 时左侧 canvas 显示无 PPT 提示 |
| 无 PPT 时 AI Notes 按主题段落组织 | 生成的笔记标题格式为 ## 主题名 而非 ## 第n页 |
| 全程无 console error | 浏览器开发者工具确认 |

---

## 产品功能覆盖矩阵（对照 项目难点.md L739–L981）

| 产品主线 | 行号 | 本 plan 覆盖 |
|---|---|---|
| transcript 持久化到服务端 | L747–752 | ✅ Task 1/4 |
| 翻页时记录 page-snapshot | L767–768 | ✅ Task 6 |
| 结束课程/暂停严格区分 | L786–803 | ✅ Task 7（handleEndClass 独立函数） |
| 结束课程后 Transcript 完整展示（带页码 match） | L817–819 | ✅ Task 8 |
| 结束课程后 My Notes 切长文（PPT 索引可跳转） | L820–824 | ✅ Task 9 |
| Generate Notes 按钮出现 | L826–827 | ✅ Task 10 |
| AI Notes 流式生成（可见过程） | L833–839 | ✅ Task 10（SSE StreamingResponse） |
| AI Notes + PPT alignment 并行 | L851–862 | ✅ finalize-stream 内调 build_page_timeline 做语义对齐，失败时降级为 current_page_hint |
| AI Notes 简洁版 | L865–872 | ✅ Task 10/2 |
| Detailed Notes 悬浮侧栏（hover 放大镜） | L873–887 | ✅ Task 11 |
| 无 PPT 全屏笔记模式 | L753–756, L777–784 | ✅ Task 12 |
| 无 PPT AI Notes 主题式 | L783 | ✅ Task 2（build_notes_prompt 无 PPT 分支） |
| Transcript 带 PPT 页码 match | L819 | ✅ Task 5/8（current_page_hint 驱动） |

> **与 NotesPage 的策略对齐说明：**
> - **alignment**：finalize-stream 调用 `build_page_timeline()`（embedding cosine + K=3 debounce），结果回写 SQLite 的 `assigned_page`。失败时降级为 `current_page_hint`，不中断生成。
> - **笔记生成 prompt（P0）**：`stream_notes` 使用独立 inline prompt（`_load_system_prompt()`），**不复用** `passive_ppt_notes/prompt.md`（后者输出 JSON 结构，不适合前端 `AiNotesRenderer` 直接渲染）。输出格式为带时间戳的 markdown bullet（`- [MM:SS–MM:SS] 内容`），有PPT 时按 `## 第N页` 分组，无PPT 时按 `## 主题名` 分组。
> - **transcript 格式化（P0）**：`_format_segments()` 带 `[MM:SS–MM:SS]` 时间戳前缀，`_format_ppt_bullets()` 编号列表，与 note_generator 对齐。
> - **prompt caching（P0）**：Anthropic 调用走 system/user 分离，system 加 `cache_control: ephemeral`，整节课长 transcript 可节省约 70-90% input token 成本。
> - **重试机制（P1）**：`stream_notes` 内置 `max_retries=1`，`finalize-stream` 失败后 session 状态回 `stopped` 而非 `error`，允许用户重新点 Generate Notes。
> - **并发限制（P1）**：`generate_detailed_note` 用 `threading.Semaphore(3)` 防止用户快速点多条 bullet 造成并发爆炸。
