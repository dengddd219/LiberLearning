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
import time as _time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Request, UploadFile, File

import db
import settings as _settings
from db import check_and_record_rate_limit, get_rate_limit_status, RateLimitExceeded
from services.audio import convert_to_wav, get_audio_duration
from services.ppt_parser import parse_ppt
from services.asr import transcribe
from services.note_generator import generate_notes_for_all_pages, PROVIDER_ZHONGZHUAN
from services.events import publish_event

router = APIRouter(tags=["process"])

MAX_CALLS_PER_DAY = _settings.RATE_LIMIT_MAX_CALLS_PER_DAY

# In-memory cache: ppt_id → {ppt_path, slides_dir, ppt_pages}
# Entries are consumed on /api/process and cleared.
_ppt_cache: dict[str, dict] = {}
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


# ── Upload PPT ahead of processing ────────────────────────────────────────────

@router.post("/upload-ppt")
async def upload_ppt(ppt: UploadFile = File(...)):
    """
    Pre-upload and parse PPT before the audio is ready.
    Returns ppt_id that can be passed to /api/process to skip re-parsing.
    """
    ppt_id = str(uuid.uuid4())
    tmp_dir = Path(tempfile.gettempdir()) / "liberstudy" / f"ppt_{ppt_id}"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    ppt_path = tmp_dir / (ppt.filename or "slides.pptx")
    with open(ppt_path, "wb") as f:
        f.write(await ppt.read())

    slides_dir = str(Path("static") / "slides" / ppt_id)
    ppt_pages = parse_ppt(str(ppt_path), slides_dir, pdf_name=f"slides_{ppt_id}.pdf")

    # Fix pdf_url to include the ppt_id subdir
    for page in ppt_pages:
        if page.get("pdf_url"):
            pdf_name_only = page["pdf_url"].split("/")[-1]
            page["pdf_url"] = f"/slides/{ppt_id}/{pdf_name_only}"

    _ppt_cache[ppt_id] = {
        "ppt_path": str(ppt_path),
        "slides_dir": slides_dir,
        "ppt_pages": ppt_pages,
    }

    return {
        "ppt_id": ppt_id,
        "num_pages": len(ppt_pages),
        "pages": [
            {
                "page_num": p["page_num"],
                "pdf_url": p.get("pdf_url"),
                "pdf_page_num": p.get("pdf_page_num"),
                "thumbnail_url": p.get("thumbnail_url"),
                "ppt_text": p.get("ppt_text", ""),
            }
            for p in ppt_pages
        ],
    }


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
    ppt_id: Optional[str] = Form(None),
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

    # 2. Rate limit（本地开发 IP 跳过限制）
    ip = request.client.host
    is_localhost = ip in ("127.0.0.1", "::1", "localhost")
    if not is_localhost:
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
        ppt_id=ppt_id,
    )

    return {"session_id": session_id}



def _extract_ppt_bullets(ppt_text: str) -> list[str]:
    """Split PPT text into individual bullet lines."""
    return [l.strip() for l in ppt_text.splitlines() if l.strip()] or ["(no slide text)"]


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


async def _run_pipeline(
    session_id: str,
    session_dir: str,
    audio_raw_path: str,
    ppt_path: Optional[str],
    language: str,
    user_anchors: list[dict],
    ppt_id: Optional[str] = None,
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
            if ppt_id and ppt_id in _ppt_cache:
                # Reuse pre-parsed result; move slides to session-specific subdir
                cached = _ppt_cache.pop(ppt_id)
                src_slides = Path(cached["slides_dir"])
                dst_slides = Path(slides_dir)
                if src_slides != dst_slides:
                    if dst_slides.exists():
                        shutil.rmtree(dst_slides)
                    shutil.move(str(src_slides), str(dst_slides))
                ppt_pages = cached["ppt_pages"]
                # Fix pdf_url / thumbnail_url to use new session_id path
                for page in ppt_pages:
                    if page.get("pdf_url"):
                        pdf_name_only = page["pdf_url"].split("/")[-1]
                        page["pdf_url"] = f"/slides/{session_id}/{pdf_name_only}"
                    if page.get("thumbnail_url"):
                        png_name = page["thumbnail_url"].split("/")[-1]
                        page["thumbnail_url"] = f"/slides/{session_id}/{png_name}"
            elif ppt_path:
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

        # Split pages: those with audio coverage go to LLM concurrently; empty pages get placeholders.
        pages_with_audio = [p for p in aligned_page_dicts if p.get("aligned_segments")]
        pages_without_audio = [p for p in aligned_page_dicts if not p.get("aligned_segments")]

        def _make_placeholder(page_dict: dict) -> dict:
            return {
                **page_dict,
                "status": "ready",
                "passive_notes": {
                    "bullets": [
                        {
                            "ppt_text": b,
                            "level": 0,
                            "ai_comment": "本页无对应课堂讲解录音，以下内容仅基于 PPT 文本整理。",
                            "timestamp_start": -1,
                            "timestamp_end": -1,
                        }
                        for b in _extract_ppt_bullets(page_dict.get("ppt_text", ""))
                    ]
                },
                "active_notes": None,
                "_cost": {"input_tokens": 0, "output_tokens": 0},
            }

        placeholders = [_make_placeholder(p) for p in pages_without_audio]

        # 无音频页面无需 LLM，立即写 DB + 推送
        for ph in placeholders:
            db.replace_page(session_id, ph)
            publish_event(session_id, "page_ready", {"page_num": ph["page_num"]})

        async def _on_page_done(noted_page: dict):
            db.replace_page(session_id, noted_page)
            publish_event(session_id, "page_ready", {"page_num": noted_page["page_num"]})

        llm_results = await generate_notes_for_all_pages(
            pages_with_audio, provider=_settings.NOTE_PROVIDER,
            on_page_done=_on_page_done,
        ) if pages_with_audio else []

        # Merge and sort by page_num to preserve original order (for run_data stats)
        all_noted = {p["page_num"]: p for p in placeholders}
        all_noted.update({p["page_num"]: p for p in llm_results})
        generated_pages = [all_noted[p["page_num"]] for p in aligned_page_dicts]

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
