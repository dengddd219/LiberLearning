"""
Live router.
  WebSocket /ws/live-asr  — 接收音频 chunk，转发阿里云 NLS 流式 ASR，推回识别结果
  POST /api/live/explain  — 接收页码+转录文本，SSE 流式返回 Claude 解释
"""
import os
import json
import asyncio
import time
import uuid
import hmac
import hashlib
import base64
import urllib.request
import urllib.parse
from datetime import datetime, timezone

import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import anthropic

router = APIRouter(tags=["live"])

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


# ── POST /api/live/explain ─────────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    page_num: int
    ppt_text: str
    transcript: str


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
async def live_asr(websocket: WebSocket):
    """
    接收前端音频 chunk（audio/webm），经 ffmpeg 转码为 PCM 16kHz，
    转发给阿里云 NLS 流式 ASR，将识别结果推回前端。
    消息格式：{text: str, is_final: bool, timestamp: float}
    """
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
    ffmpeg_cmd = [
        "ffmpeg", "-loglevel", "quiet",
        "-f", "webm", "-i", "pipe:0",
        "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1",
    ]
    try:
        ffmpeg = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except Exception as e:
        await websocket.send_text(json.dumps({"error": f"ffmpeg start failed: {e}"}))
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
                    ffmpeg.stdin.write(data)
                    await ffmpeg.stdin.drain()
            except (WebSocketDisconnect, asyncio.TimeoutError):
                pass
            finally:
                try:
                    ffmpeg.stdin.close()
                except Exception:
                    pass

        async def read_ffmpeg_send_nls():
            """读 ffmpeg stdout PCM → 分帧发 NLS"""
            nonlocal elapsed
            try:
                while True:
                    frame = await asyncio.wait_for(
                        ffmpeg.stdout.read(PCM_FRAME_SIZE), timeout=5.0
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
            await ffmpeg.wait()
        except Exception:
            pass
        if nls_ws:
            try:
                await nls_ws.close()
            except Exception:
                pass
