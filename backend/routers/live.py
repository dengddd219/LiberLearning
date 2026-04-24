"""
Live router.
  WebSocket /ws/live-asr  — 接收音频 chunk，转发阿里云 NLS 流式 ASR，推回识别结果
  POST /api/live/explain  — 接收页码+转录文本，SSE 流式返回 Claude 解释
  POST /api/live/session/start  — 创建 live session
  POST /api/live/page-snapshot  — 翻页时记录 current_page
  POST /api/live/annotations    — 保存课中批注
  GET  /api/live/state/{id}     — 获取 session 状态 + transcript
  POST /api/live/stop           — 结束录音（后台触发 alignment）
  POST /api/live/finalize-stream — SSE 流式生成 AI Notes
  GET  /api/live/finalize/status/{id} — 查询 finalize 状态
  POST /api/live/detailed-note  — SSE 逐行详细解释
"""
import os
import json
import asyncio
import time
import uuid
import shutil
import subprocess
import hmac
import hashlib
import base64
import urllib.request
import urllib.parse
import threading
from datetime import datetime, timezone

import websockets
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import anthropic

import auth as _auth
from services.live_store import (
    create_session, get_session, update_session_status,
    update_session_page, save_segment, get_segments,
    save_annotation, update_segment_assigned_pages,
)
from services.live_note_builder import stream_notes, generate_detailed_note
import db as _db

router = APIRouter(tags=["live"])


def _current_user_id(request: Request) -> str:
    user = getattr(request.state, "current_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user["id"]


def _owned_live_session_or_404(session_id: str, user_id: str) -> dict:
    session = get_session(session_id)
    if not session or session.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    return session

# ── NLS Token 缓存 ─────────────────────────────────────────────────────────────
_nls_token: str = ""
_nls_token_expire: float = 0.0


def _get_nls_token() -> str:
    """获取阿里云 NLS token，10分钟内复用缓存。"""
    global _nls_token, _nls_token_expire
    if _nls_token and time.time() < _nls_token_expire - 30:
        return _nls_token

    ak_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "")
    ak_secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "")
    if not ak_id or not ak_secret:
        raise RuntimeError("ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET not set")

    params = {
        "AccessKeyId": ak_id,
        "Action": "CreateToken",
        "Format": "JSON",
        "RegionId": "cn-shanghai",
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid.uuid4()),
        "SignatureVersion": "1.0",
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2019-02-28",
    }
    keys = sorted(params.keys())
    query = "&".join([f"{k}={urllib.parse.quote(str(params[k]), safe='')}" for k in keys])
    string_to_sign = "GET&%2F&" + urllib.parse.quote(query, safe="")
    sig = base64.b64encode(
        hmac.new((ak_secret + "&").encode(), string_to_sign.encode(), hashlib.sha1).digest()
    ).decode()
    query += "&Signature=" + urllib.parse.quote(sig, safe="")

    req = urllib.request.Request("https://nls-meta.cn-shanghai.aliyuncs.com/?" + query)
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read())

    token_obj = data.get("Token", {})
    _nls_token = token_obj.get("Id", "")
    _nls_token_expire = float(token_obj.get("ExpireTime", 0))
    if not _nls_token:
        raise RuntimeError(f"NLS token empty, response: {data}")
    return _nls_token


# ── Pydantic 模型 ──────────────────────────────────────────────────────────────

class SessionStartRequest(BaseModel):
    ppt_id: str | None = None
    language: str = "zh"
    session_id: str | None = None


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


class ExplainRequest(BaseModel):
    page_num: int
    ppt_text: str
    transcript: str


# ── POST /api/live/session/start ───────────────────────────────────────────────

@router.post("/live/session/start")
def live_session_start(req: SessionStartRequest, request: Request):
    user_id = _current_user_id(request)
    if req.session_id and _db.get_session(req.session_id, user_id=user_id) is None:
        raise HTTPException(status_code=404, detail="main session not found")
    session = create_session(
        ppt_id=req.ppt_id,
        language=req.language,
        session_id=req.session_id,
        user_id=user_id,
    )
    return {"session_id": session["session_id"], "status": session["status"]}


# ── POST /api/live/page-snapshot ───────────────────────────────────────────────

@router.post("/live/page-snapshot")
def live_page_snapshot(req: PageSnapshotRequest, request: Request):
    _owned_live_session_or_404(req.session_id, _current_user_id(request))
    update_session_page(req.session_id, req.current_page)
    return {"ok": True, "current_page": req.current_page}


# ── POST /api/live/annotations ─────────────────────────────────────────────────

@router.post("/live/annotations")
def live_save_annotation(req: AnnotationRequest, request: Request):
    _owned_live_session_or_404(req.session_id, _current_user_id(request))
    ann = save_annotation(req.session_id, req.page_num, req.text, req.x, req.y)
    return ann


# ── GET /api/live/state/{session_id} ──────────────────────────────────────────

@router.get("/live/state/{session_id}")
def live_get_state(session_id: str, request: Request, page_num: int | None = None):
    session = _owned_live_session_or_404(session_id, _current_user_id(request))
    segments = get_segments(session_id)
    if page_num is not None:
        filtered = [
            s for s in segments
            if s.get("current_page_hint") == page_num
            or s.get("assigned_page") == page_num
        ]
    else:
        filtered = segments
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


# ── alignment 后台线程 ──────────────────────────────────────────────────────────

def _run_alignment_background(session_id: str, ppt_pages: list[dict]):
    """独立线程：跑 embedding alignment 并回写 assigned_page。
    用 threading.Thread 而非 BackgroundTasks，因为 build_page_timeline 是同步 IO，
    必须在线程里跑，不能阻塞 async event loop。
    """
    try:
        from services.alignment import build_page_timeline
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


# ── POST /api/live/stop ────────────────────────────────────────────────────────

@router.post("/live/stop")
def live_stop(req: SessionStopRequest, request: Request):
    _owned_live_session_or_404(req.session_id, _current_user_id(request))
    update_session_status(req.session_id, "stopped", ended_at=int(time.time() * 1000))
    try:
        _db.update_session(req.session_id, {"status": "stopped"})
    except Exception:
        pass
    if req.ppt_pages:
        t = threading.Thread(
            target=_run_alignment_background,
            args=(req.session_id, req.ppt_pages),
            daemon=True,
        )
        t.start()
    return {"session_id": req.session_id, "status": "stopped"}


# ── POST /api/live/finalize-stream ────────────────────────────────────────────

@router.post("/live/finalize-stream")
def live_finalize_stream(req: FinalizeRequest, request: Request):
    session = _owned_live_session_or_404(req.session_id, _current_user_id(request))
    if session["status"] != "stopped":
        raise HTTPException(
            status_code=400, detail=f"cannot finalize in status {session['status']}; call /live/stop first"
        )
    update_session_status(req.session_id, "finalizing")

    raw_segments = get_segments(req.session_id)

    def generate():
        try:
            yield from stream_notes(raw_segments, req.ppt_pages, req.my_notes, max_retries=1)
            update_session_status(req.session_id, "done")
            try:
                _db.update_session(req.session_id, {"status": "done"})
            except Exception:
                pass
        except Exception as e:
            update_session_status(req.session_id, "stopped")
            try:
                _db.update_session(req.session_id, {"status": "stopped"})
            except Exception:
                pass
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── GET /api/live/finalize/status/{session_id} ────────────────────────────────

@router.get("/live/finalize/status/{session_id}")
def live_finalize_status(session_id: str, request: Request):
    session = _owned_live_session_or_404(session_id, _current_user_id(request))
    return {"session_id": session_id, "status": session["status"]}


# ── POST /api/live/detailed-note ──────────────────────────────────────────────

@router.post("/live/detailed-note")
def live_detailed_note(req: DetailedNoteRequest, request: Request):
    _owned_live_session_or_404(req.session_id, _current_user_id(request))
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


# ── POST /api/live/explain ─────────────────────────────────────────────────────

@router.post("/live/explain")
async def live_explain(req: ExplainRequest):
    """
    接收当前页的 PPT 文本 + 转录文本，调用 Claude，SSE 流式返回解释。
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    prompt = f"""你是一个课堂学习助手。请根据以下内容，用简洁的中文解释老师在这张幻灯片上讲解的核心内容。

幻灯片文字：
{req.ppt_text or "（无幻灯片文字）"}

老师录音转录：
{req.transcript or "（暂无转录内容）"}

要求：
- 3-5 句话，重点突出
- 如果转录内容充足，优先从转录中提炼
- 如果转录内容少，基于幻灯片文字补充
"""

    def generate():
        with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'text': text})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── WebSocket /ws/live-asr ─────────────────────────────────────────────────────

NLS_URL = "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1"
PCM_FRAME_SIZE = 3200  # 100ms @ 16kHz mono s16le


@router.websocket("/ws/live-asr")
async def live_asr(websocket: WebSocket, session_id: str | None = None):
    """
    接收前端音频 chunk（audio/webm），经 ffmpeg 转码为 PCM 16kHz，
    转发给阿里云 NLS 流式 ASR，将识别结果推回前端。
    消息格式：{text: str, is_final: bool, timestamp: float}
    """
    user = _auth.get_user_from_session_token(websocket.cookies.get(_auth.SESSION_COOKIE_NAME))
    if user is None or not session_id:
        await websocket.close(code=1008)
        return
    session = get_session(session_id)
    if not session or session.get("user_id") != user["id"]:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    # 获取 NLS token 和 AppKey
    try:
        token = _get_nls_token()
        app_key = os.environ.get("ALIYUN_ASR_APP_KEY", "")
        if not app_key:
            raise RuntimeError("ALIYUN_ASR_APP_KEY not set")
    except Exception as e:
        await websocket.send_text(json.dumps({"error": str(e)}))
        await websocket.close()
        return

    # 启动 ffmpeg 子进程：stdin=webm, stdout=PCM s16le 16kHz mono
    ffmpeg_bin = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
    if not ffmpeg_bin:
        await websocket.send_text(json.dumps({"error": "ffmpeg not found in PATH"}))
        await websocket.close()
        return

    ffmpeg_cmd = [
        ffmpeg_bin, "-loglevel", "quiet",
        "-f", "webm", "-i", "pipe:0",
        "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1",
    ]
    try:
        ffmpeg = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        detail = repr(e) if repr(e) else type(e).__name__
        await websocket.send_text(json.dumps({"error": f"ffmpeg start failed: {detail}"}))
        await websocket.close()
        return

    nls_ws = None
    try:
        # 连接阿里云 NLS
        nls_ws = await websockets.connect(f"{NLS_URL}?token={token}")

        # 发送 StartTranscription 指令
        task_id = str(uuid.uuid4()).replace("-", "")
        start_msg = {
            "header": {
                "message_id": str(uuid.uuid4()).replace("-", ""),
                "task_id": task_id,
                "namespace": "SpeechTranscriber",
                "name": "StartTranscription",
                "appkey": app_key,
            },
            "payload": {
                "format": "pcm",
                "sample_rate": 16000,
                "enable_intermediate_result": True,
                "enable_punctuation_prediction": True,
                "enable_inverse_text_normalization": True,
            },
        }
        await nls_ws.send(json.dumps(start_msg))

        # 等待 TranscriptionStarted
        started = False
        for _ in range(10):
            raw = await asyncio.wait_for(nls_ws.recv(), timeout=5.0)
            msg = json.loads(raw)
            if msg.get("header", {}).get("name") == "TranscriptionStarted":
                started = True
                break
        if not started:
            raise RuntimeError("NLS did not respond with TranscriptionStarted")

        elapsed = 0.0  # 用于 timestamp 字段（秒）

        async def feed_ffmpeg():
            """从前端收 webm bytes → 写 ffmpeg stdin"""
            try:
                while True:
                    data = await asyncio.wait_for(websocket.receive_bytes(), timeout=30.0)
                    if not ffmpeg.stdin:
                        break
                    await asyncio.to_thread(ffmpeg.stdin.write, data)
                    await asyncio.to_thread(ffmpeg.stdin.flush)
            except (WebSocketDisconnect, asyncio.TimeoutError):
                pass
            finally:
                try:
                    if ffmpeg.stdin:
                        await asyncio.to_thread(ffmpeg.stdin.close)
                except Exception:
                    pass

        async def read_ffmpeg_send_nls():
            """读 ffmpeg stdout PCM → 分帧发 NLS"""
            nonlocal elapsed
            try:
                while True:
                    if not ffmpeg.stdout:
                        break
                    frame = await asyncio.wait_for(
                        asyncio.to_thread(ffmpeg.stdout.read, PCM_FRAME_SIZE), timeout=5.0
                    )
                    if not frame:
                        break
                    await nls_ws.send(frame)
                    elapsed += PCM_FRAME_SIZE / (16000 * 2)  # bytes / (samples/s * bytes/sample)
            except asyncio.TimeoutError:
                pass
            except Exception:
                pass
            finally:
                # 发 StopTranscription，让 NLS 刷出最后结果
                try:
                    stop_msg = {
                        "header": {
                            "message_id": str(uuid.uuid4()).replace("-", ""),
                            "task_id": task_id,
                            "namespace": "SpeechTranscriber",
                            "name": "StopTranscription",
                            "appkey": app_key,
                        },
                    }
                    await nls_ws.send(json.dumps(stop_msg))
                except Exception:
                    pass

        async def recv_nls_push_client():
            """收 NLS 消息 → 推回前端"""
            try:
                async for raw in nls_ws:
                    msg = json.loads(raw)
                    name = msg.get("header", {}).get("name", "")
                    payload = msg.get("payload", {})

                    if name == "TranscriptionResultChanged":
                        text = payload.get("result", "")
                        if text:
                            await websocket.send_text(json.dumps({
                                "text": text,
                                "is_final": False,
                                "timestamp": round(elapsed, 2),
                            }))
                    elif name == "SentenceEnd":
                        text = payload.get("result", "")
                        if text:
                            await websocket.send_text(json.dumps({
                                "text": text,
                                "is_final": True,
                                "timestamp": round(elapsed, 2),
                            }))
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
                    elif name == "TranscriptionCompleted":
                        break
            except Exception:
                pass

        await asyncio.gather(
            feed_ffmpeg(),
            read_ffmpeg_send_nls(),
            recv_nls_push_client(),
        )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        try:
            ffmpeg.terminate()
            await asyncio.to_thread(ffmpeg.wait)
        except Exception:
            pass
        if nls_ws:
            try:
                await nls_ws.close()
            except Exception:
                pass
