# Live ASR 实时转录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将后端 `/api/ws/live-asr` 从 mock 模式替换为真实阿里云 NLS 流式 ASR，前端零改动。

**Architecture:** 每个客户端 WebSocket 连接独立启动一个 ffmpeg 子进程（stdin 收 webm → stdout 出 PCM 16kHz），同时建一条到阿里云 NLS 的 WebSocket 连接，三个 asyncio 协程并行：① 收前端音频写 ffmpeg stdin；② 读 ffmpeg stdout PCM 发 NLS；③ 收 NLS 识别结果推回前端。任意一方断开时统一清理。

**Tech Stack:** Python asyncio, `websockets` 16.0, ffmpeg subprocess pipe, 阿里云 NLS wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1

---

## 文件变动清单

| 操作 | 文件 | 说明 |
|------|------|------|
| Modify | `backend/routers/live.py` | 替换 mock 实现为真实 NLS 集成 |
| Modify | `backend/requirements.txt` | 添加 `websockets>=13.0` |
| Create | `backend/test_live_asr.py` | 手动集成测试脚本 |

---

## Task 1: 添加 websockets 依赖

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: 在 requirements.txt 添加 websockets**

打开 `backend/requirements.txt`，在 `# Async HTTP` 区块后添加一行：

```
# WebSocket client (NLS streaming ASR)
websockets>=13.0
```

最终该区块：

```
# Async HTTP
httpx==0.28.1

# WebSocket client (NLS streaming ASR)
websockets>=13.0
```

- [ ] **Step 2: 安装依赖**

```bash
cd backend
pip install "websockets>=13.0"
```

Expected output: `Successfully installed websockets-16.0` 或 `Requirement already satisfied`

- [ ] **Step 3: 验证**

```bash
python -c "import websockets; print(websockets.__version__)"
```

Expected: 打印版本号（>= 13.0）

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add websockets dependency for NLS streaming ASR"
```

---

## Task 2: 实现 NLS Token 管理

**Files:**
- Modify: `backend/routers/live.py`（在文件顶部添加 token 缓存逻辑）

- [ ] **Step 1: 替换 live.py 顶部 import 区块**

将 `backend/routers/live.py` 文件开头替换为：

```python
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
_nls_token_expire: float = 0.0  # Unix timestamp


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
```

- [ ] **Step 2: 验证 token 函数可单独运行**

```bash
cd backend
python -c "
from dotenv import load_dotenv; load_dotenv('.env')
from routers.live import _get_nls_token
tok = _get_nls_token()
print('token OK:', tok[:8], '...')
tok2 = _get_nls_token()
print('cache hit:', tok == tok2)
"
```

Expected:
```
token OK: a36c3454 ...
cache hit: True
```

---

## Task 3: 实现真实 WebSocket 处理器

**Files:**
- Modify: `backend/routers/live.py`（替换 mock `live_asr` 函数 + 保留 `live_explain`）

- [ ] **Step 1: 替换 live_asr 函数**

找到 `backend/routers/live.py` 中 `# ── POST /api/live/explain` 之前的所有内容（即 Task 2 已写的 import + token 部分），在其后添加 `live_explain` 函数，然后用以下代码完整替换 `live_asr` 函数：

完整的 `backend/routers/live.py` 文件内容如下（完整覆盖）：

```python
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
NLS_APPKEY = os.environ.get("ALIYUN_ASR_APP_KEY", "")
PCM_FRAME_SIZE = 3200  # 100ms @ 16kHz mono s16le


@router.websocket("/ws/live-asr")
async def live_asr(websocket: WebSocket):
    """
    接收前端音频 chunk（audio/webm），经 ffmpeg 转码为 PCM 16kHz，
    转发给阿里云 NLS 流式 ASR，将识别结果推回前端。
    """
    await websocket.accept()

    # 获取 NLS token
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
    import subprocess
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

        elapsed = 0.0  # 用于 timestamp 字段

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
                    elapsed += PCM_FRAME_SIZE / (16000 * 2)  # samples * bytes_per_sample
            except asyncio.TimeoutError:
                pass
            except Exception:
                pass
            finally:
                # 发 StopTranscription
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
                        # 中间结果（非 final）
                        text = payload.get("result", "")
                        if text:
                            await websocket.send_text(json.dumps({
                                "text": text,
                                "is_final": False,
                                "timestamp": elapsed,
                            }))
                    elif name == "SentenceEnd":
                        # 句子结束（final）
                        text = payload.get("result", "")
                        if text:
                            await websocket.send_text(json.dumps({
                                "text": text,
                                "is_final": True,
                                "timestamp": elapsed,
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
        # 清理
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
```

- [ ] **Step 2: 验证语法**

```bash
cd backend
python -c "import routers.live; print('syntax OK')"
```

Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add backend/routers/live.py
git commit -m "feat: implement real-time ASR via Aliyun NLS WebSocket + ffmpeg pipe"
```

---

## Task 4: 写集成测试脚本

**Files:**
- Create: `backend/test_live_asr.py`

这是一个**手动集成测试**，用纯 Python 模拟前端行为：读取一段 WAV 文件（或录音设备），通过 WebSocket 发给后端，打印识别结果。无需真实浏览器。

- [ ] **Step 1: 创建测试脚本**

创建 `backend/test_live_asr.py`：

```python
"""
手动集成测试：模拟前端向 /api/ws/live-asr 发送音频，打印实时转录结果。

用法：
  python test_live_asr.py [音频文件路径]

若不提供文件路径，使用 backend/test_documents/lec01/ 下第一个 WAV 文件。
音频文件会先用 ffmpeg 转为 webm 格式，模拟浏览器 MediaRecorder 输出。
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile

import websockets

API_WS = "ws://localhost:8000/api/ws/live-asr"
CHUNK_MS = 250  # 与前端 MediaRecorder timeslice 一致


def find_test_audio() -> str:
    base = os.path.join(os.path.dirname(__file__), "test_documents", "lec01")
    for f in os.listdir(base):
        if f.endswith(".wav"):
            return os.path.join(base, f)
    raise FileNotFoundError(f"No WAV file found in {base}")


def wav_to_webm(wav_path: str, out_path: str):
    """Convert WAV to WebM/Opus, simulating browser MediaRecorder output."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-c:a", "libopus", "-f", "webm", out_path],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed:\n{result.stderr}")


async def run_test(audio_path: str):
    print(f"Audio: {audio_path}")

    # Convert to webm first
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        webm_path = tmp.name
    wav_to_webm(audio_path, webm_path)
    print(f"Converted to webm: {webm_path}")

    # Read webm and split into ~250ms chunks by byte size
    with open(webm_path, "rb") as f:
        webm_data = f.read()
    os.unlink(webm_path)

    # Estimate chunk size: webm opus ~16kbps → 250ms ≈ 500 bytes
    chunk_size = 500
    chunks = [webm_data[i:i+chunk_size] for i in range(0, len(webm_data), chunk_size)]
    print(f"Total chunks: {len(chunks)}, sending at 250ms intervals")

    async with websockets.connect(API_WS) as ws:
        print("WebSocket connected\n")

        async def send_chunks():
            for chunk in chunks:
                await ws.send(chunk)
                await asyncio.sleep(CHUNK_MS / 1000)
            # Signal end by closing send side
            await ws.close()

        async def recv_results():
            try:
                async for raw in ws:
                    msg = json.loads(raw)
                    if "error" in msg:
                        print(f"[ERROR] {msg['error']}")
                    elif msg.get("is_final"):
                        print(f"[FINAL] {msg['text']}")
                    else:
                        print(f"[inter] {msg['text']}", end="\r")
            except websockets.exceptions.ConnectionClosedOK:
                pass

        await asyncio.gather(send_chunks(), recv_results())

    print("\nDone.")


if __name__ == "__main__":
    audio = sys.argv[1] if len(sys.argv) > 1 else find_test_audio()
    asyncio.run(run_test(audio))
```

- [ ] **Step 2: 启动后端（另一个终端）**

```bash
cd backend
uvicorn main:app --reload
```

Expected: `Application startup complete`

- [ ] **Step 3: 运行测试**

```bash
cd backend
python test_live_asr.py
```

Expected output（示例）：
```
Audio: backend/test_documents/lec01/recording.wav
Converted to webm: /tmp/tmpXXXXXX.webm
Total chunks: 240, sending at 250ms intervals
WebSocket connected

[inter] 同学们好
[FINAL] 同学们好，今天我们来讲
[inter] 第一章
[FINAL] 第一章的内容是...
Done.
```

- [ ] **Step 4: Commit**

```bash
git add backend/test_live_asr.py
git commit -m "test: add manual integration test for live ASR WebSocket"
```

---

## Task 5: 错误场景验证

**Files:**
- 无新文件，手动验证

- [ ] **Step 1: 验证 ALIYUN_ASR_APP_KEY 缺失时的行为**

临时注释掉 `.env` 中的 `ALIYUN_ASR_APP_KEY`，重启后端后运行：

```bash
python test_live_asr.py
```

Expected: `[ERROR] ALIYUN_ASR_APP_KEY not set`，WebSocket 正常关闭（不崩溃）

恢复 `.env` 后重启后端。

- [ ] **Step 2: 验证前端中途断开**

在测试脚本发送过程中（约 3 秒后）按 Ctrl+C，观察后端日志。

Expected: 后端正常清理 ffmpeg 进程，无 `Exception` 堆栈，进程数不泄漏（可用 `tasklist | grep ffmpeg` 确认）

- [ ] **Step 3: 验证浏览器端真实录音**

启动前端：

```bash
cd frontend
npm run dev
```

打开 `http://localhost:5173`，进入 LivePage，点击开始录音，说几句话，观察页面字幕区是否出现真实转录文字（不再是"模拟转录第 N 句"）。

- [ ] **Step 4: Commit（如有任何修复）**

```bash
git add -p
git commit -m "fix: live ASR edge case handling"
```

---

## Self-Review Checklist

### Spec 覆盖

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 后端 ffmpeg 子进程转码 webm → PCM | Task 3 |
| 阿里云 NLS WebSocket 握手（StartTranscription） | Task 3 |
| 三协程并行（feed/read/recv） | Task 3 |
| NLS token 获取 + 模块级缓存 | Task 2 |
| 前端零改动，消息格式不变 | Task 3（消息结构与原 mock 一致）|
| 错误处理（token 失败 / ffmpeg 失败 / 断开清理） | Task 3 + Task 5 |
| `websockets` 依赖 | Task 1 |

### 类型一致性

- `_get_nls_token()` → `str`，Task 3 中直接使用 ✓
- `PCM_FRAME_SIZE = 3200` 在 Task 3 定义并使用 ✓
- `task_id` 在 `feed_ffmpeg` 外定义，`read_ffmpeg_send_nls` 和 `recv_nls_push_client` 通过闭包引用 ✓

### 无占位符

无 TBD / TODO / "similar to" ✓
