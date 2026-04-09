"""
Process router.
  POST /api/process-mock  — Phase A: ignore uploads, return mock session_id
  POST /api/process       — Phase B: full real processing pipeline
  POST /api/sessions/{id}/page/{page_num}/retry  — per-page retry
"""

import asyncio
import os
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, UploadFile, File
from slowapi import Limiter
from slowapi.util import get_remote_address

from services.audio import convert_to_wav, merge_chunks, get_audio_duration
from services.ppt_parser import parse_ppt
from services.asr import transcribe
from services.alignment import build_page_timeline
from services.note_generator import generate_notes_for_all_pages

router = APIRouter(tags=["process"])

# ── Rate limiting ──────────────────────────────────────────────────────────────
# 2 real process calls per user per day; mock endpoint is unlimited.
limiter = Limiter(key_func=get_remote_address)

# In-memory session store (replace with DB in production)
_SESSIONS: dict[str, dict] = {}

# Max audio duration: 120 minutes
MAX_AUDIO_SECONDS = 120 * 60


# ── Health check ───────────────────────────────────────────────────────────────

@router.get("/process/health")
def process_health():
    return {"status": "ok", "router": "process"}


# ── Phase A: Mock endpoint ─────────────────────────────────────────────────────

@router.post("/process-mock")
async def process_mock(
    ppt: Optional[UploadFile] = File(None),
    audio: Optional[UploadFile] = File(None),
):
    """
    Phase A mock endpoint: ignores uploaded files, returns a fixed session_id.
    The actual mock data is served by GET /api/sessions/{id}.
    """
    return {"session_id": "mock-session-001"}


# ── Phase B: Real processing pipeline ─────────────────────────────────────────

@router.post("/process")
@limiter.limit("2/day")
async def process_real(
    request: Request,
    background_tasks: BackgroundTasks,
    ppt: Optional[UploadFile] = File(None),
    audio: UploadFile = File(...),
    language: str = "en",
    user_anchors: str = "[]",  # JSON string: [{"page_num": int, "timestamp": float}]
):
    """
    Real processing pipeline:
      1. Save uploaded files to a temp session dir
      2. Convert audio to WAV
      3. Parse PPT (if provided)
      4. ASR transcription
      5. Semantic alignment
      6. LLM note generation (async background)

    Returns session_id immediately; poll GET /api/sessions/{id} for status.
    """
    import json as _json

    session_id = str(uuid.uuid4())
    session_dir = Path(tempfile.gettempdir()) / "liberstudy" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded audio
    audio_raw_path = session_dir / f"audio_raw{Path(audio.filename or '.webm').suffix}"
    with open(audio_raw_path, "wb") as f:
        f.write(await audio.read())

    # Save uploaded PPT (optional)
    ppt_path = None
    if ppt and ppt.filename:
        ppt_path = session_dir / ppt.filename
        with open(ppt_path, "wb") as f:
            f.write(await ppt.read())

    # Parse user anchors
    try:
        anchors = _json.loads(user_anchors) if user_anchors else []
    except Exception:
        anchors = []

    # Register session as "processing"
    _SESSIONS[session_id] = {
        "session_id": session_id,
        "status": "processing",
        "ppt_filename": ppt.filename if ppt else None,
        "audio_url": None,
        "total_duration": 0,
        "pages": [],
    }

    # Run heavy processing in background
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
    """Background task: full processing pipeline."""
    try:
        session_path = Path(session_dir)

        # Step 1: Convert audio to WAV
        wav_path = str(session_path / "audio.wav")
        convert_to_wav(audio_raw_path, wav_path)

        # Check duration limit
        duration = get_audio_duration(wav_path)
        if duration > MAX_AUDIO_SECONDS:
            _SESSIONS[session_id]["status"] = "error"
            _SESSIONS[session_id]["error"] = (
                f"Audio exceeds 120-minute limit ({duration/60:.1f} min)"
            )
            return

        _SESSIONS[session_id]["total_duration"] = int(duration)

        # Step 2: Parse PPT (if provided)
        slides_dir = str(Path("static") / "slides" / session_id)
        ppt_pages: list[dict] = []
        if ppt_path:
            ppt_pages = parse_ppt(ppt_path, slides_dir, png_prefix=f"slide_{session_id}")
            # Prefix session_id into URLs so multiple sessions don't collide

        # Step 3: ASR transcription
        segments = transcribe(wav_path, language=language)

        # Step 4: Semantic alignment
        if ppt_pages:
            aligned_pages = build_page_timeline(
                ppt_pages=ppt_pages,
                segments=segments,
                user_anchors=user_anchors,
                total_audio_duration=duration,
            )
        else:
            # No PPT: single virtual "page" for all content
            aligned_pages = [
                {
                    "page_num": 1,
                    "ppt_text": "",
                    "slide_image_url": None,
                    "page_start_time": 0,
                    "page_end_time": int(duration),
                    "alignment_confidence": 1.0,
                    "aligned_segments": segments,
                    "page_supplement": None,
                    "active_notes": None,
                }
            ]

        # Step 5: LLM note generation
        generated_pages = await generate_notes_for_all_pages(aligned_pages)

        # Determine overall status
        any_partial = any(p.get("status") == "partial_ready" for p in generated_pages)
        overall_status = "partial_ready" if any_partial else "ready"

        _SESSIONS[session_id].update(
            {
                "status": overall_status,
                "audio_url": f"/audio/{session_id}/audio.wav",
                "pages": generated_pages,
            }
        )

    except Exception as exc:
        _SESSIONS[session_id]["status"] = "error"
        _SESSIONS[session_id]["error"] = str(exc)


# ── Per-page retry ─────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/page/{page_num}/retry")
async def retry_page(session_id: str, page_num: int):
    """Re-run LLM note generation for a single failed page."""
    from services.note_generator import generate_notes_for_all_pages

    # Allow mock session passthrough
    if session_id == "mock-session-001":
        return {"status": "ok", "message": f"Page {page_num} retry queued (mock)"}

    session = _SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    pages = session.get("pages", [])
    target = next((p for p in pages if p["page_num"] == page_num), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Page {page_num} not found")

    # Re-generate just this page
    results = await generate_notes_for_all_pages([target])
    updated = results[0]

    # Replace in session
    for i, p in enumerate(pages):
        if p["page_num"] == page_num:
            pages[i] = updated
            break

    # Recalculate overall session status
    any_partial = any(p.get("status") == "partial_ready" for p in pages)
    session["status"] = "partial_ready" if any_partial else "ready"

    return {"status": "ok", "page": updated}
