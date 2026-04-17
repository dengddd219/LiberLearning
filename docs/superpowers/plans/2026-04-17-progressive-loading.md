# 渐进式加载与沉浸式工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-page serial flow (Upload → Processing → Notes) with progressive loading inside NotesPage — upload modal overlay, SSE event stream, per-module incremental UI rendering.

**Architecture:** Backend pipeline parallelizes PPT parsing and audio processing, publishes SSE events per milestone. Frontend NotesPage gains a `pagePhase` state machine (`upload → processing → ready`), subscribes to SSE, and re-fetches session data on each event to incrementally render modules. Existing NotesPage rendering code is untouched.

**Tech Stack:** React + EventSource (frontend SSE), FastAPI + asyncio.Queue (backend SSE pub/sub), SQLite (existing DB, no schema change)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/services/events.py` | SSE pub/sub: `_event_queues`, `publish_event()`, `wait_for_event()` |
| Create | `frontend/src/components/UploadModal.tsx` | Upload form modal (extracted from UploadPage) |
| Create | `frontend/src/hooks/useSessionEvents.ts` | SSE subscription hook with fallback polling |
| Modify | `backend/db.py` | Add `replace_page()` helper |
| Modify | `backend/routers/process.py` | Parallelize pipeline, publish SSE events, per-page note generation |
| Modify | `backend/routers/sessions.py` | Add `GET /api/sessions/{id}/events` SSE endpoint |
| Modify | `frontend/src/App.tsx` | Add `/notes/new` route |
| Modify | `frontend/src/lib/api.ts` | Export `API_BASE` constant |
| Modify | `frontend/src/pages/LobbyPage.tsx:1324` | Change navigate target from `/upload` to `/notes/new` |
| Modify | `frontend/src/pages/NotesPage.tsx` | Add `pagePhase` state machine, upload modal rendering, SSE integration, tab spinners, skeleton fallback, AI sweep animation CSS |

---

## Task 1: Backend — SSE Event Pub/Sub Module

**Files:**
- Create: `backend/services/events.py`

- [ ] **Step 1: Create the events module**

```python
# backend/services/events.py
"""
In-process SSE event pub/sub using asyncio.Queue.
Single-process deployment only. Replace with Redis Pub/Sub if scaling to multiple workers.
"""
import asyncio
import json
from typing import Optional

_event_queues: dict[str, list[asyncio.Queue]] = {}


def publish_event(session_id: str, event_type: str, data: Optional[dict] = None):
    """Push an event to all subscribers for this session."""
    event = {"event": event_type, **(data or {})}
    for q in _event_queues.get(session_id, []):
        q.put_nowait(event)


async def wait_for_event(session_id: str, timeout: float = 300) -> Optional[dict]:
    """Block until an event arrives or timeout. Returns None on timeout."""
    q: asyncio.Queue = asyncio.Queue()
    _event_queues.setdefault(session_id, []).append(q)
    try:
        return await asyncio.wait_for(q.get(), timeout=timeout)
    except asyncio.TimeoutError:
        return None
    finally:
        _event_queues[session_id].remove(q)
        if not _event_queues[session_id]:
            del _event_queues[session_id]
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/events.py
git commit -m "feat(backend): add SSE event pub/sub module"
```

---

## Task 2: Backend — DB `replace_page` Helper

**Files:**
- Modify: `backend/db.py:116-137`

- [ ] **Step 1: Add `replace_page` function after `update_session`**

Add the following function at the end of the Session CRUD section in `backend/db.py`, after the `update_session` function (after line 137):

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/db.py
git commit -m "feat(backend): add replace_page helper for incremental page updates"
```

---

## Task 3: Backend — SSE Events Endpoint

**Files:**
- Modify: `backend/routers/sessions.py`

- [ ] **Step 1: Add the SSE endpoint**

Add the following import at the top of `backend/routers/sessions.py`:

```python
from services.events import wait_for_event
```

Add this route before the existing `@router.get("/sessions/{session_id}/slide/{page_num}.png")` route:

```python
@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str):
    """SSE endpoint: pushes processing progress events for a session."""
    async def event_stream():
        while True:
            event = await wait_for_event(session_id, timeout=300)
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("event") == "all_done" or event.get("event") == "error":
                break

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

Ensure `StreamingResponse` is imported (it should already be imported in this file from the existing SSE endpoints — verify and add if needed):

```python
from fastapi.responses import StreamingResponse
```

- [ ] **Step 2: Commit**

```bash
git add backend/routers/sessions.py
git commit -m "feat(backend): add GET /api/sessions/{id}/events SSE endpoint"
```

---

## Task 4: Backend — Parallelize Pipeline + SSE Events

**Files:**
- Modify: `backend/routers/process.py:150-369`

This is the largest backend task. We restructure `_run_pipeline` to:
1. Run PPT parsing and audio conversion in parallel
2. Write initial pages to DB after PPT completes (with ppt_text but no notes)
3. Run ASR → alignment serially (depends on both PPT + audio)
4. Generate notes per-page serially, writing each page to DB as it completes
5. Publish SSE events at each milestone

- [ ] **Step 1: Add imports at top of `process.py`**

Add after the existing imports (line 25):

```python
from services.events import publish_event
```

- [ ] **Step 2: Add `_build_initial_pages` helper**

Add this function before `_run_pipeline` (before line 150):

```python
def _build_initial_pages(ppt_pages: list[dict]) -> list[dict]:
    """Construct initial page data after PPT parsing — no notes, no alignment."""
    return [
        {
            "page_num": p["page_num"],
            "status": "processing",
            "pdf_url": p.get("pdf_url"),
            "pdf_page_num": p.get("pdf_page_num", p["page_num"]),
            "thumbnail_url": p.get("thumbnail_url"),
            "ppt_text": p.get("ppt_text", ""),
            "page_start_time": 0,
            "page_end_time": 0,
            "alignment_confidence": 0,
            "active_notes": None,
            "passive_notes": None,
            "page_supplement": None,
            "aligned_segments": [],
        }
        for p in ppt_pages
    ]
```

- [ ] **Step 3: Rewrite `_run_pipeline`**

Replace the entire `_run_pipeline` function (lines 150-369) with:

```python
async def _run_pipeline(
    session_id: str,
    session_dir: str,
    audio_raw_path: str,
    ppt_path: Optional[str],
    language: str,
    user_anchors: list[dict],
):
    """Background task: full processing pipeline with progress updates and SSE events."""
    import asyncio

    runs_dir = Path("static") / "runs" / session_id
    runs_dir.mkdir(parents=True, exist_ok=True)
    run_data_path = runs_dir / "run_data.json"

    run_data: dict = {
        "session_id": session_id,
        "started_at": _time.strftime("%Y-%m-%d %H:%M:%S"),
        "config": {
            "alignment_version": _settings.ALIGNMENT_VERSION,
            "asr_engine": _settings.ASR_ENGINE,
            "note_provider": _settings.NOTE_PROVIDER,
            "note_model": _settings.NOTE_MODEL,
            "note_passive_template": _settings.NOTE_PASSIVE_TEMPLATE,
            "note_granularity": _settings.NOTE_GRANULARITY,
        },
        "steps": {},
    }

    def _save_run_data():
        with open(run_data_path, "w", encoding="utf-8") as f:
            _json.dump(run_data, f, ensure_ascii=False, indent=2, default=str)

    try:
        session_path = Path(session_dir)

        # ── Parallel: PPT parse + Audio convert ──────────────────────────────

        async def _task_audio():
            t_start = _time.time()
            db.update_session(session_id, {"progress": {"step": "converting", "percent": 15}})
            wav_path = str(session_path / "audio.wav")
            convert_to_wav(audio_raw_path, wav_path)
            duration = get_audio_duration(wav_path)
            if duration > MAX_AUDIO_SECONDS:
                raise ValueError(f"Audio exceeds 120-minute limit ({duration/60:.1f} min)")
            db.update_session(session_id, {"total_duration": int(duration)})
            audio_static_dir = Path("static") / "audio" / session_id
            audio_static_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(wav_path, str(audio_static_dir / "audio.wav"))
            t_end = _time.time()
            run_data["steps"]["step1_audio"] = {
                "status": "ok", "wav_path": wav_path,
                "duration_seconds": duration, "elapsed_s": round(t_end - t_start, 2),
            }
            _save_run_data()
            return wav_path, duration

        async def _task_ppt():
            t_start = _time.time()
            db.update_session(session_id, {"progress": {"step": "parsing_ppt", "percent": 30}})
            slides_dir = str(Path("static") / "slides" / session_id)
            ppt_pages: list[dict] = []
            if ppt_path:
                ppt_pages = parse_ppt(ppt_path, slides_dir, pdf_name=f"slides_{session_id}.pdf")
                for page in ppt_pages:
                    if page.get("pdf_url"):
                        pdf_name_only = page["pdf_url"].split("/")[-1]
                        page["pdf_url"] = f"/slides/{session_id}/{pdf_name_only}"
                    if page.get("thumbnail_url"):
                        png_name = page["thumbnail_url"].split("/")[-1]
                        page["thumbnail_url"] = f"/slides/{session_id}/{png_name}"
            t_end = _time.time()
            run_data["steps"]["step2_ppt"] = {
                "status": "ok", "ppt_path": str(ppt_path) if ppt_path else None,
                "num_pages": len(ppt_pages),
                "pages_summary": [
                    {"page_num": p.get("page_num"), "ppt_text_len": len(p.get("ppt_text", ""))}
                    for p in ppt_pages
                ],
                "elapsed_s": round(t_end - t_start, 2),
            }
            _save_run_data()
            return ppt_pages

        # Run both in parallel
        results = await asyncio.gather(
            _task_ppt(),
            _task_audio(),
            return_exceptions=True,
        )

        # Check for exceptions
        for r in results:
            if isinstance(r, Exception):
                raise r

        ppt_pages, (wav_path, duration) = results[0], results[1]

        # Write initial pages to DB and notify frontend
        if ppt_pages:
            initial_pages = _build_initial_pages(ppt_pages)
            db.update_session(session_id, {"pages": initial_pages})
        publish_event(session_id, "ppt_parsed", {"num_pages": len(ppt_pages)})

        # ── Serial: ASR → Alignment ──────────────────────────────────────────

        t3_start = _time.time()
        db.update_session(session_id, {"progress": {"step": "transcribing", "percent": 55}})
        segments, raw_segments = transcribe(wav_path, language=language)
        t3_end = _time.time()
        run_data["steps"]["step3_asr"] = {
            "status": "ok", "engine": _settings.ASR_ENGINE, "language": language,
            "num_sentences": len(segments), "num_raw_segments": len(raw_segments),
            "sentences": segments, "raw_segments": raw_segments,
            "elapsed_s": round(t3_end - t3_start, 2),
        }
        _save_run_data()

        t4_start = _time.time()
        db.update_session(session_id, {"progress": {"step": "aligning", "percent": 70}})
        if ppt_pages:
            align_module = _settings.get_alignment_module()
            aligned_pages = align_module.build_page_timeline(
                ppt_pages=ppt_pages, segments=segments,
                user_anchors=user_anchors, total_audio_duration=duration,
            )
        else:
            aligned_pages = [{
                "page_num": 1, "ppt_text": "", "pdf_url": None, "pdf_page_num": 1,
                "page_start_time": 0, "page_end_time": int(duration),
                "alignment_confidence": 1.0, "aligned_segments": segments,
                "page_supplement": None, "active_notes": None,
            }]
        t4_end = _time.time()

        def _serialize(obj):
            if hasattr(obj, "model_dump"):
                return obj.model_dump()
            return obj

        run_data["steps"]["step4_alignment"] = {
            "status": "ok", "version": _settings.ALIGNMENT_VERSION,
            "num_pages": len(aligned_pages),
            "pages_summary": [
                {
                    "page_num": p.get("page_num") if isinstance(p, dict) else getattr(p, "page_num", "?"),
                    "num_segments": len(p.get("aligned_segments", []) if isinstance(p, dict) else getattr(p, "aligned_segments", [])),
                }
                for p in aligned_pages
            ],
            "aligned_pages": [_serialize(p) for p in aligned_pages],
            "elapsed_s": round(t4_end - t4_start, 2),
        }
        _save_run_data()

        # Update pages with alignment data (transcript) + audio_url
        aligned_page_dicts = [_serialize(p) for p in aligned_pages]
        db.update_session(session_id, {
            "pages": aligned_page_dicts,
            "audio_url": f"/audio/{session_id}/audio.wav",
        })
        publish_event(session_id, "asr_done", {"num_segments": len(segments)})

        # ── Per-page note generation ─────────────────────────────────────────

        t5_start = _time.time()
        db.update_session(session_id, {"progress": {"step": "generating", "percent": 85}})

        generated_pages = []
        for page_dict in aligned_page_dicts:
            page_results = await generate_notes_for_all_pages(
                [page_dict], provider=_settings.NOTE_PROVIDER,
            )
            noted_page = page_results[0]
            generated_pages.append(noted_page)
            db.replace_page(session_id, noted_page)
            publish_event(session_id, "page_ready", {"page_num": noted_page["page_num"]})

        t5_end = _time.time()
        run_data["steps"]["step5_notes"] = {
            "status": "ok", "provider": _settings.NOTE_PROVIDER,
            "model": _settings.NOTE_MODEL,
            "template": _settings.NOTE_PASSIVE_TEMPLATE,
            "granularity": _settings.NOTE_GRANULARITY,
            "num_pages": len(generated_pages),
            "pages_summary": [
                {
                    "page_num": p.get("page_num"), "status": p.get("status"),
                    "num_bullets": len(p.get("passive_notes", {}).get("bullets", [])) if p.get("passive_notes") else 0,
                    "cost": p.get("_cost"),
                }
                for p in generated_pages
            ],
            "generated_pages": generated_pages,
            "elapsed_s": round(t5_end - t5_start, 2),
        }
        _save_run_data()

        any_partial = any(p.get("status") == "partial_ready" for p in generated_pages)
        overall_status = "partial_ready" if any_partial else "ready"

        db.update_session(session_id, {
            "status": overall_status,
            "progress": None,
        })

        publish_event(session_id, "all_done", {"status": overall_status})

        run_data["finished_at"] = _time.strftime("%Y-%m-%d %H:%M:%S")
        run_data["overall_status"] = overall_status
        _save_run_data()

    except Exception as exc:
        db.update_session(session_id, {
            "status": "error", "error": str(exc), "progress": None,
        })
        publish_event(session_id, "error", {"message": str(exc)})
        run_data["finished_at"] = _time.strftime("%Y-%m-%d %H:%M:%S")
        run_data["overall_status"] = "error"
        run_data["error"] = str(exc)
        _save_run_data()
```

- [ ] **Step 4: Add the `replace_page` import**

At line 19 in `process.py`, the `db` module is already imported. The new `replace_page` function will be accessible via `db.replace_page()` automatically.

- [ ] **Step 5: Verify backend starts**

```bash
cd backend && python -c "from routers.process import router; from services.events import publish_event; print('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/routers/process.py
git commit -m "feat(backend): parallelize pipeline + per-page note generation + SSE events"
```

---

## Task 5: Frontend — Route + API Base Export

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add `/notes/new` route in App.tsx**

In `frontend/src/App.tsx`, add the new route before the existing `/notes/:sessionId` route:

```tsx
<Route path="/notes/new"              element={<NotesPage />} />
<Route path="/notes/:sessionId"       element={<NotesPage />} />
```

The full Routes block becomes:

```tsx
<Routes>
  <Route path="/"                        element={<LobbyPage />} />
  <Route path="/live" element={<LivePage />} />
  <Route path="/upload"                  element={<UploadPage />} />
  <Route path="/processing"              element={<ProcessingPage />} />
  <Route path="/notes/new"              element={<NotesPage />} />
  <Route path="/notes/:sessionId"        element={<NotesPage />} />
  <Route path="/notes/detail/:sessionId" element={<DetailedNotePage />} />
  <Route path="/diagnostics"             element={<DiagnosticsPage />} />
  <Route path="*"                        element={<Navigate to="/" replace />} />
</Routes>
```

- [ ] **Step 2: Export API_BASE from api.ts**

In `frontend/src/lib/api.ts`, change line 1 from:

```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
```

to:

```typescript
export const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/lib/api.ts
git commit -m "feat(frontend): add /notes/new route, export API_BASE"
```

---

## Task 6: Frontend — useSessionEvents Hook

**Files:**
- Create: `frontend/src/hooks/useSessionEvents.ts`

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useSessionEvents.ts
import { useEffect, useRef } from 'react'
import { API_BASE, getSession } from '../lib/api'

export interface SSEEvent {
  event: string
  [key: string]: unknown
}

export function useSessionEvents(
  sessionId: string | undefined,
  enabled: boolean,
  onEvent: (event: SSEEvent) => void,
) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!enabled || !sessionId) return

    let pollTimer: ReturnType<typeof setInterval> | null = null

    const es = new EventSource(`${API_BASE}/api/sessions/${sessionId}/events`)

    es.onmessage = (e) => {
      try {
        const data: SSEEvent = JSON.parse(e.data)
        onEventRef.current(data)
      } catch { /* ignore malformed */ }
    }

    es.onerror = () => {
      es.close()
      pollTimer = setInterval(async () => {
        try {
          const data = await getSession(sessionId) as { status?: string }
          onEventRef.current({ event: '_poll', ...(data as Record<string, unknown>) })
          if (data.status === 'ready' || data.status === 'partial_ready') {
            if (pollTimer) clearInterval(pollTimer)
            onEventRef.current({ event: 'all_done', status: data.status })
          }
        } catch { /* ignore fetch errors during polling */ }
      }, 3000)
    }

    return () => {
      es.close()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [sessionId, enabled])
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useSessionEvents.ts
git commit -m "feat(frontend): add useSessionEvents SSE hook with fallback polling"
```

---

## Task 7: Frontend — UploadModal Component

**Files:**
- Create: `frontend/src/components/UploadModal.tsx`

- [ ] **Step 1: Create UploadModal**

Extract upload logic from `UploadPage.tsx`. The modal shows only the "Upload Recording" card content (no Live Class card, no background shells):

```tsx
// frontend/src/components/UploadModal.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { uploadFiles } from '../lib/api'

const MAX_AUDIO_MB = 500

function validateFile(file: File, accept: string[], maxMb?: number): string | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!accept.includes(ext)) return `不支持的格式，请上传 ${accept.join(' / ')}`
  if (maxMb && file.size > maxMb * 1024 * 1024) return `文件过大，最大支持 ${maxMb}MB`
  return null
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconPPT() {
  return (
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none">
      <rect x="1" y="1" width="22" height="30" rx="3" stroke="#AFB3B0" strokeWidth="1.5" />
      <path d="M7 9h12M7 14h12M7 19h8" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14" y="22" width="17" height="17" rx="3" fill="#F3F4F1" stroke="#AFB3B0" strokeWidth="1.5" />
      <path d="M18 30h5M18 33h3" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconAudio() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <rect x="12" y="4" width="12" height="18" rx="6" stroke="#AFB3B0" strokeWidth="1.5" />
      <path d="M6 18c0 6.627 5.373 12 12 12s12-5.373 12-12" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M18 30v4" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 34h8" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

interface UploadZoneProps {
  label: string; hint: string; accept: string; icon: React.ReactNode
  file: File | null; error: string | null; onFile: (f: File) => void; onClear: () => void
}

function UploadZone({ label, hint, accept, icon, file, error, onFile, onClear }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const isSuccess = !!file && !error

  return (
    <div
      role="button" tabIndex={0}
      aria-label={file ? `已选择：${file.name}，点击替换` : `点击或拖拽上传${label}文件`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      className="relative flex flex-col items-center justify-center cursor-pointer transition-all duration-150"
      style={{
        borderRadius: '32px',
        border: error ? '2px dashed rgba(224, 92, 64, 0.5)' : isSuccess ? '2px dashed rgba(95, 94, 94, 0.4)' : dragging ? '2px dashed rgba(95, 94, 94, 0.5)' : '2px dashed rgba(175, 179, 176, 0.2)',
        padding: '32px', flex: 1,
      }}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      <div style={{ paddingBottom: '16px' }}>{icon}</div>
      <div style={{ paddingBottom: '4px' }}>
        <span style={{ fontWeight: 700, fontSize: '14px', color: '#2F3331' }}>{isSuccess ? file!.name : label}</span>
      </div>
      <div>
        <span style={{ fontWeight: 400, fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: error ? 'rgba(224,92,64,0.8)' : '#556071' }}>
          {error ? error : isSuccess ? '点击替换' : hint}
        </span>
      </div>
      {isSuccess && (
        <button type="button" aria-label="移除已选文件" onClick={(e) => { e.stopPropagation(); onClear() }}
          className="absolute top-3 right-3 flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
          style={{ width: '44px', height: '44px', borderRadius: '9999px', backgroundColor: 'transparent', color: '#5F5E5E', border: 'none', margin: '-10px' }}
        >
          <IconClose />
        </button>
      )}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface UploadModalProps {
  onSuccess: (sessionId: string) => void
  onClose: () => void
}

export default function UploadModal({ onSuccess, onClose }: UploadModalProps) {
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [pptError, setPptError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handlePpt = useCallback((file: File) => {
    const err = validateFile(file, ['.ppt', '.pptx', '.pdf'])
    setPptError(err)
    if (!err) setPptFile(file)
  }, [])

  const handleAudio = useCallback((file: File) => {
    const err = validateFile(file, ['.mp3', '.wav', '.m4a', '.aac'], MAX_AUDIO_MB)
    setAudioError(err)
    if (!err) setAudioFile(file)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!audioFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const result = await uploadFiles(pptFile ?? undefined, audioFile)
      onSuccess(result.session_id)
    } catch (err) {
      console.error('Upload failed:', err)
      setUploadError('上传失败，请检查网络后重试')
      setUploading(false)
    }
  }, [pptFile, audioFile, onSuccess])

  const canSubmit = !!audioFile && !pptError && !audioError && !uploading

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="relative w-full flex flex-col" style={{
      maxWidth: '768px', backgroundColor: '#FFFFFF', borderRadius: '48px',
      border: '1px solid rgba(175, 179, 176, 0.1)',
      boxShadow: '0px 25px 50px -12px rgba(0, 0, 0, 0.25)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '48px', padding: '48px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontWeight: 700, fontSize: '16px', lineHeight: '1.5', letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: 'rgba(95, 94, 94, 0.6)' }}>
              ACTION CENTER
            </span>
            <h1 style={{ fontWeight: 700, fontSize: '36px', lineHeight: '1.11', letterSpacing: '-0.025em', color: '#2F3331', margin: 0 }}>
              Upload Recording
            </h1>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}
            className="flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
            style={{ width: '40px', height: '40px', borderRadius: '9999px', backgroundColor: '#F3F4F1', color: '#5F5E5E', border: 'none' }}>
            <IconClose />
          </button>
        </div>

        {/* Upload areas */}
        {!uploading ? (
          <div style={{ display: 'flex', gap: '12px' }}>
            <UploadZone label="PPT/PDF Materials" hint="Drag or click to upload" accept=".ppt,.pptx,.pdf" icon={<IconPPT />}
              file={pptFile} error={pptError} onFile={handlePpt} onClear={() => { setPptFile(null); setPptError(null) }} />
            <UploadZone label="Audio Recording" hint="Upload MP3, WAV or AAC" accept=".mp3,.wav,.m4a,.aac" icon={<IconAudio />}
              file={audioFile} error={audioError} onFile={handleAudio} onClear={() => { setAudioFile(null); setAudioError(null) }} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '48px 0', color: '#5F5E5E', fontSize: '14px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            <span>上传中，请稍候...</span>
          </div>
        )}

        {/* Submit button */}
        {!uploading && (
          <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={{
            backgroundColor: canSubmit ? '#798C00' : '#AFB3B0', color: '#fff', border: 'none',
            borderRadius: '9999px', padding: '12px 24px', fontWeight: 600, fontSize: '14px',
            cursor: canSubmit ? 'pointer' : 'not-allowed', width: '100%', transition: 'background-color 0.25s ease',
          }}>
            Start Review →
          </button>
        )}

        {/* Error */}
        {uploadError && (
          <p role="alert" style={{ color: 'rgba(224,92,64,0.8)', fontSize: '14px', margin: 0, textAlign: 'center' }}>
            {uploadError}
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/UploadModal.tsx
git commit -m "feat(frontend): create UploadModal component extracted from UploadPage"
```

---

## Task 8: Frontend — NotesPage Integration

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

This is the core frontend task. We add the `pagePhase` state machine, upload modal rendering, SSE subscription, tab spinners, skeleton fallback, and AI sweep animation — all without changing existing rendering code.

- [ ] **Step 1: Add imports**

At the top of `NotesPage.tsx` (after line 13), add:

```typescript
import { useNavigate } from 'react-router-dom'
import NotesBgShell from '../components/bg/NotesBgShell'
import UploadModal from '../components/UploadModal'
import { useSessionEvents, SSEEvent } from '../hooks/useSessionEvents'
```

- [ ] **Step 2: Add AI sweep animation CSS**

After the `pdfjs.GlobalWorkerOptions` setup (after line 18), add an inline style tag injection:

```typescript
const SWEEP_STYLE_ID = 'ai-sweep-animation'
if (typeof document !== 'undefined' && !document.getElementById(SWEEP_STYLE_ID)) {
  const style = document.createElement('style')
  style.id = SWEEP_STYLE_ID
  style.textContent = `
    @keyframes ai-shimmer-sweep {
      0% { background-position: 200% 50%; }
      100% { background-position: -100% 50%; }
    }
    .ai-bullet-reveal {
      color: transparent;
      background: linear-gradient(110deg, #333333 40%, #ffffff 50%, #333333 60%);
      background-size: 250% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: ai-shimmer-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    .ai-bullet-placeholder {
      color: #999999;
      transition: opacity 0.3s ease;
    }
  `
  document.head.appendChild(style)
}
```

- [ ] **Step 3: Add `pagePhase` state and related states**

Inside the `NotesPage` component function (after line 781, after `noteMode` state), add:

```typescript
type PagePhase = 'upload' | 'processing' | 'ready'
const [pagePhase, setPagePhase] = useState<PagePhase>(sessionId ? 'ready' : 'upload')
const [processingSessionId, setProcessingSessionId] = useState<string | undefined>(sessionId)
const navigate = useNavigate()

// Tab loading completion flash states
const [transcriptJustDone, setTranscriptJustDone] = useState(false)
const [aiNotesJustDone, setAiNotesJustDone] = useState(false)

// Track which pages had AI notes revealed (for sweep animation)
const [revealedPages, setRevealedPages] = useState<Set<number>>(new Set())
```

- [ ] **Step 4: Add SSE event handler**

After the states added in Step 3, add:

```typescript
// SSE event handler
const handleSSEEvent = useCallback(async (event: SSEEvent) => {
  const sid = processingSessionId
  if (!sid) return

  if (event.event === 'error') {
    setError(typeof event.message === 'string' ? event.message : '处理失败')
    setPagePhase('ready')
    return
  }

  // Re-fetch session data on any progress event
  try {
    const data = await getSession(sid)
    setSession(data as SessionData)
    if (!loading) setLoading(false)
  } catch { /* ignore fetch errors */ }

  if (event.event === 'ppt_parsed') {
    setLoading(false)
  }

  if (event.event === 'asr_done') {
    setTranscriptJustDone(true)
    setTimeout(() => setTranscriptJustDone(false), 1500)
  }

  if (event.event === 'page_ready' && typeof event.page_num === 'number') {
    setRevealedPages(prev => new Set(prev).add(event.page_num as number))
  }

  if (event.event === 'all_done') {
    setPagePhase('ready')
    setAiNotesJustDone(true)
    setTimeout(() => setAiNotesJustDone(false), 1500)
  }
}, [processingSessionId, loading])

// SSE subscription
useSessionEvents(processingSessionId, pagePhase === 'processing', handleSSEEvent)
```

- [ ] **Step 5: Add upload success handler**

After the SSE handler, add:

```typescript
const handleUploadSuccess = useCallback((newSessionId: string) => {
  setProcessingSessionId(newSessionId)
  setPagePhase('processing')
  setLoading(true)
  window.history.replaceState(null, '', `/notes/${newSessionId}`)
}, [])
```

- [ ] **Step 6: Modify the existing `useEffect` data loading (lines 1011-1020)**

Change the existing `useEffect` to also handle the `processing` recovery case. Replace lines 1011-1020:

```typescript
useEffect(() => {
  if (!sessionId) return
  getSession(sessionId)
    .then((data) => {
      setSession(data as SessionData)
      openTab({ sessionId: sessionId!, label: (data as SessionData).ppt_filename ?? sessionId! })
      setLoading(false)
      // If session is still processing, enter processing phase and subscribe to SSE
      if ((data as SessionData).status === 'processing') {
        setPagePhase('processing')
        setProcessingSessionId(sessionId)
      }
    })
    .catch(() => { setError('无法加载笔记数据'); setLoading(false) })
}, [sessionId])
```

- [ ] **Step 7: Add upload phase rendering**

Replace the existing loading guard (lines 1287-1296) with:

```typescript
// Upload phase: show NotesBgShell + scrim + UploadModal
if (pagePhase === 'upload') {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 50 }}>
      <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
        <NotesBgShell />
      </div>
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(20, 24, 22, 0.6)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 2 }}>
        <UploadModal onSuccess={handleUploadSuccess} onClose={() => navigate('/')} />
      </div>
    </div>
  )
}

if (loading) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
      <div className="text-center">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
          style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: C.muted }}>{t('notes_loading')}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Add tab spinner indicators**

In the tab bar rendering (around line 1528-1555), modify the tab `map` to add spinners. Find the `{label}` render inside the button and replace with:

```tsx
{label}
{mode === 'transcript' && pagePhase === 'processing' && !session?.pages?.some(p => (p.aligned_segments?.length ?? 0) > 0) && (
  <span className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin" style={{ borderWidth: '1.5px', borderColor: '#D0CFC5', borderTopColor: '#EC4899', verticalAlign: 'middle' }} />
)}
{mode === 'transcript' && transcriptJustDone && (
  <span style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}>✓</span>
)}
{mode === 'ai' && pagePhase === 'processing' && session?.pages?.some(p => !p.passive_notes?.bullets?.length) && (
  <span className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin" style={{ borderWidth: '1.5px', borderColor: '#D0CFC5', borderTopColor: '#8B5CF6', verticalAlign: 'middle' }} />
)}
{mode === 'ai' && aiNotesJustDone && (
  <span style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}>✓</span>
)}
```

- [ ] **Step 9: Add AI Notes placeholder for processing phase**

Find the "No data at all" section (line 1804-1808). Add a new branch BEFORE it:

```tsx
{/* Processing placeholder: show ppt_text as grey text */}
{pagePhase === 'processing' && !currentPageData?.passive_notes && currentPageData?.ppt_text && (
  <div className="ai-bullet-placeholder" style={{ padding: '8px 0' }}>
    {currentPageData.ppt_text.split('\n').filter(Boolean).map((line, i) => (
      <div key={`draft-${i}`} style={{ fontSize: '13px', lineHeight: '1.8', color: C.muted }}>
        • {line}
      </div>
    ))}
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
      <span className="inline-block w-3 h-3 border-2 border-transparent rounded-full animate-spin" style={{ borderColor: '#D0CFC5', borderTopColor: '#8B5CF6' }} />
      <span style={{ fontSize: '11px', color: C.muted }}>AI 正在生成笔记...</span>
    </div>
  </div>
)}
```

- [ ] **Step 10: Add AI sweep animation wrapper**

Find the section where `AiBulletRow` components are rendered in a `.map()` (around line 1753-1798). Wrap the existing `<div>` container of the bullet list. Find this line:

```tsx
<div style={{ display: 'flex', flexDirection: 'column' }}>
```

that wraps the `.map((bullet, i) => ...)` for passive_notes.bullets, and add a conditional className:

After the `<div style={{ display: 'flex', flexDirection: 'column' }}>` line, the change is to wrap the entire bullet list output. When the page was just revealed (exists in `revealedPages` set), apply the sweep animation class:

```tsx
<div
  className={revealedPages.has(currentPage) ? 'ai-bullet-reveal' : ''}
  style={{ display: 'flex', flexDirection: 'column' }}
>
```

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat(frontend): integrate progressive loading into NotesPage

- pagePhase state machine (upload/processing/ready)
- Upload modal overlay with NotesBgShell background
- SSE subscription for incremental data loading
- Tab loading spinners with completion flash
- AI sweep animation for note reveal
- PPT text placeholder during processing"
```

---

## Task 9: Frontend — LobbyPage Navigate Change

**Files:**
- Modify: `frontend/src/pages/LobbyPage.tsx:1324`

- [ ] **Step 1: Change navigate target**

In `frontend/src/pages/LobbyPage.tsx`, find line 1324:

```tsx
onClick={() => navigate('/upload')}
```

Change to:

```tsx
onClick={() => navigate('/notes/new')}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/LobbyPage.tsx
git commit -m "feat(frontend): LobbyPage New Recording navigates to /notes/new"
```

---

## Task 10: Integration Test

- [ ] **Step 1: Start backend**

```bash
cd backend && python -m uvicorn main:app --reload --port 8000
```

- [ ] **Step 2: Start frontend**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Test the full flow**

1. Open browser → LobbyPage
2. Click "+ New Recording" → should navigate to `/notes/new`
3. See NotesPage empty layout (NotesBgShell) with dark scrim + Upload modal
4. Upload a PPT + audio file → click "Start Review"
5. Modal disappears, URL changes to `/notes/{session_id}`
6. See skeleton/loading state in all three panels
7. Left panel fills with slide thumbnails (PPT parsed)
8. AI Notes tab shows grey PPT text
9. Transcript tab spinner disappears when ASR completes
10. AI Notes bullets light up page by page with sweep animation
11. All spinners disappear when done → normal NotesPage

- [ ] **Step 4: Test refresh recovery**

1. During processing, refresh the page
2. Page should re-enter `processing` phase, reconnect SSE, continue loading

- [ ] **Step 5: Test backward compatibility**

1. From Lobby, click an existing completed session → should open normally (no upload modal, no processing UI)
2. Navigate to `/upload` directly → UploadPage still works
3. Navigate to `/processing?session_id=xxx` → ProcessingPage still works

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration test fixes for progressive loading"
```
