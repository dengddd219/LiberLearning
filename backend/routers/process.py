"""
Process router.
  POST /api/process-mock  — Phase A: ignore uploads, return mock session_id
  POST /api/process       — Phase B: full real processing pipeline
  POST /api/sessions/{id}/page/{page_num}/retry  — per-page retry
  GET  /api/rate-limit/status  — remaining calls for current IP
"""

import json as _json
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Request, UploadFile, File

import db
import settings as _settings
from db import check_and_record_rate_limit, get_rate_limit_status, RateLimitExceeded
from services.audio import convert_to_wav, get_audio_duration
from services.ppt_parser import parse_ppt, extract_domain_terms
from services.asr import transcribe
from services.note_generator import generate_notes_for_all_pages, PROVIDER_ZHONGZHUAN

router = APIRouter(tags=["process"])

MAX_CALLS_PER_DAY = _settings.RATE_LIMIT_MAX_CALLS_PER_DAY
DAY_SECONDS = 86400.0
MAX_AUDIO_SECONDS = _settings.MAX_AUDIO_SECONDS

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
    language: str = Form("en"),
    user_anchors: str = Form("[]"),
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
        "application/octet-stream",
    }
    if audio_content_type and audio_content_type not in allowed_audio_types:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported audio type '{audio_content_type}'. Supported: webm, mp3, wav, m4a",
        )

    # 2. Rate limit
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

        # Copy WAV to static/audio/{session_id}/ for frontend playback
        audio_static_dir = Path("static") / "audio" / session_id
        audio_static_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(wav_path, str(audio_static_dir / "audio.wav"))

        # Step 2: PPT 解析
        db.update_session(session_id, {"progress": {"step": "parsing_ppt", "percent": 30}})
        slides_dir = str(Path("static") / "slides" / session_id)
        ppt_pages: list[dict] = []
        if ppt_path:
            ppt_pages = parse_ppt(ppt_path, slides_dir, pdf_name=f"slides_{session_id}.pdf")
            # Fix pdf_url and thumbnail_url: parse_ppt returns paths without session_id subdir
            # but files are in static/slides/{session_id}/, so prepend session_id
            for page in ppt_pages:
                if page.get("pdf_url"):
                    pdf_name_only = page["pdf_url"].split("/")[-1]
                    page["pdf_url"] = f"/slides/{session_id}/{pdf_name_only}"
                if page.get("thumbnail_url"):
                    png_name = page["thumbnail_url"].split("/")[-1]
                    page["thumbnail_url"] = f"/slides/{session_id}/{png_name}"

        # Step 3: ASR 转录
        db.update_session(session_id, {"progress": {"step": "transcribing", "percent": 55}})
        asr_prompt = extract_domain_terms(ppt_pages) if ppt_pages else None
        segments, _raw = transcribe(wav_path, language=language, prompt=asr_prompt)

        # Step 4: 语义对齐（版本由 settings.ALIGNMENT_VERSION 控制）
        db.update_session(session_id, {"progress": {"step": "aligning", "percent": 70}})
        if ppt_pages:
            align_module = _settings.get_alignment_module()
            aligned_pages = align_module.build_page_timeline(
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

        # Step 5: LLM 笔记生成（模板和 provider 由 settings 控制）
        db.update_session(session_id, {"progress": {"step": "generating", "percent": 85}})
        generated_pages = await generate_notes_for_all_pages(
            aligned_pages,
            provider=_settings.NOTE_PROVIDER,
        )

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

    results = await generate_notes_for_all_pages([target], provider=PROVIDER_ZHONGZHUAN)
    updated = results[0]

    for i, p in enumerate(pages):
        if p["page_num"] == page_num:
            pages[i] = updated
            break

    any_partial = any(p.get("status") == "partial_ready" for p in pages)
    new_status = "partial_ready" if any_partial else "ready"

    db.update_session(session_id, {"pages": pages, "status": new_status})

    return {"status": "ok", "page": updated}
