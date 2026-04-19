from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import json
import asyncio

import settings as _settings
from services.events import wait_for_event

router = APIRouter(tags=["sessions"])

# ---------------------------------------------------------------------------
# Mock data — 3-page session covering all note scenarios:
#   Page 1: user has annotations → active_notes rendered
#   Page 2: pure lecture, no annotations → passive_notes only
#   Page 3: teacher left PPT → page_supplement populated
# ---------------------------------------------------------------------------
MOCK_SESSION = {
    "session_id": "mock-session-001",
    "status": "ready",
    "ppt_filename": "计算机网络第三章.pptx",
    "audio_url": "/audio/sample.mp3",
    "total_duration": 5400,  # 90 minutes in seconds
    "pages": [
        {
            "page_num": 1,
            "status": "ready",
            "pdf_url": "/slides/slides.pdf",
            "pdf_page_num": 1,
            "ppt_text": "第三章 数据链路层\n• 功能与服务\n• 成帧（Framing）\n• 差错控制\n• 流量控制",
            "page_start_time": 0,
            "page_end_time": 1200,
            "alignment_confidence": 0.92,
            "active_notes": {
                "user_note": "老师说这章是重点，期末必考",
                "ai_expansion": "数据链路层是OSI七层模型的第二层，负责在相邻节点之间的链路上传送以帧为单位的数据。其核心功能包括：\n\n**成帧**：将网络层传来的数据报文封装成帧，加上帧头和帧尾标识边界。\n\n**差错控制**：通过CRC循环冗余校验检测传输错误，常见方案包括停止等待协议（Stop-and-Wait）和滑动窗口协议。\n\n**流量控制**：防止发送方速率超过接收方处理能力，避免缓冲区溢出。"
            },
            "passive_notes": {
                "bullets": [
                    {
                        "ppt_text": "第三章 数据链路层",
                        "level": 0,
                        "ai_comment": "本章是OSI七层模型的第二层。核心职责是在相邻节点之间以帧为单位可靠传输数据。注意它只管一跳（hop）之内的传输，跨节点的端到端可靠性由传输层负责。",
                        "timestamp_start": 45,
                        "timestamp_end": 98
                    },
                    {
                        "ppt_text": "功能与服务",
                        "level": 1,
                        "ai_comment": "数据链路层提供三大核心服务：成帧、差错控制、流量控制。成帧负责封装数据报；差错控制用CRC检错、ARQ纠错；流量控制用滑动窗口限速。三者协同保证一跳内的可靠传输。",
                        "timestamp_start": 100,
                        "timestamp_end": 170
                    },
                    {
                        "ppt_text": "成帧（Framing）",
                        "level": 1,
                        "ai_comment": "将网络层数据报封装成帧，加帧头帧尾标识边界。常见方法有三种：字节计数法（帧头写长度）、字节填充法（FLAG字节转义）、比特填充法（5个1后插0）。帧头还包含源/目MAC地址和帧类型字段。",
                        "timestamp_start": 120,
                        "timestamp_end": 210
                    },
                    {
                        "ppt_text": "差错控制",
                        "level": 1,
                        "ai_comment": "CRC只检错不纠错；ARQ负责重传。常见ARQ协议：Stop-and-Wait、Go-Back-N、Selective Repeat。",
                        "timestamp_start": 380,
                        "timestamp_end": 490
                    },
                    {
                        "ppt_text": "流量控制",
                        "level": 1,
                        "ai_comment": "滑动窗口机制限制发送方速率，防止接收方缓冲区溢出。吞吐量上限 = window_size / RTT。",
                        "timestamp_start": 670,
                        "timestamp_end": 740
                    }
                ]
            },
            "aligned_segments": [
                {"start": 45,  "end": 98,  "text": "数据链路层是OSI七层模型的第二层，负责在相邻节点之间以帧为单位传送数据。"},
                {"start": 120, "end": 210, "text": "成帧就是把数据报文加上帧头帧尾，常见方法有字节计数法和比特填充法。"},
                {"start": 380, "end": 490, "text": "差错控制用CRC来检测错误，ARQ负责重传，Stop-and-Wait是最基础的ARQ协议。"},
                {"start": 670, "end": 740, "text": "流量控制用滑动窗口限制发送方速率，窗口大小除以RTT就是吞吐量上限。"}
            ],
            "page_supplement": None
        },
        {
            "page_num": 2,
            "status": "ready",
            "pdf_url": "/slides/slides.pdf",
            "pdf_page_num": 2,
            "ppt_text": "停止等待协议（Stop-and-Wait ARQ）\n• 发送一帧，等待ACK\n• 超时重传\n• 信道利用率 = T1 / (T1 + RTT + T2)",
            "page_start_time": 1200,
            "page_end_time": 2800,
            "alignment_confidence": 0.88,
            "active_notes": None,
            "passive_notes": {
                "bullets": [
                    {
                        "ppt_text": "停止等待协议（Stop-and-Wait ARQ）",
                        "level": 0,
                        "ai_comment": "最简单的ARQ协议，每次只发一帧，等ACK后才发下一帧。实现极简，但信道利用率极低。当RTT很大时，发送方大部分时间在空等，这是滑动窗口协议被提出的根本动机。",
                        "timestamp_start": 1250,
                        "timestamp_end": 1360
                    },
                    {
                        "ppt_text": "发送一帧，等待ACK",
                        "level": 1,
                        "ai_comment": None,
                        "timestamp_start": -1,
                        "timestamp_end": -1
                    },
                    {
                        "ppt_text": "超时重传",
                        "level": 1,
                        "ai_comment": "计时器到期未收ACK则重发。超时时间设置是工程难题：太短误重传，太长恢复慢。TCP用SRTT+4×RTTVAR动态估算。",
                        "timestamp_start": 1920,
                        "timestamp_end": 2050
                    },
                    {
                        "ppt_text": "信道利用率 = T1 / (T1 + RTT + T2)",
                        "level": 1,
                        "ai_comment": "当RTT >> T_f时信道大部分时间在等待，利用率趋近于0，这是引入滑动窗口的核心动机。",
                        "timestamp_start": 1580,
                        "timestamp_end": 1720
                    }
                ]
            },
            "aligned_segments": [
                {"start": 1250, "end": 1360, "text": "停止等待协议最简单，每次只发一帧，等ACK回来才发下一帧。"},
                {"start": 1580, "end": 1720, "text": "信道利用率公式是 U = T_f 除以 T_f 加 RTT 加 T_a，RTT 越大利用率越低。"},
                {"start": 1920, "end": 2050, "text": "超时重传：计时器到期还没收到ACK就重发，超时时间的设置是工程难题。"},
                {"start": 2400, "end": 2480, "text": "停止等待协议序号只需要1位，因为任意时刻最多只有1帧在飞。"}
            ],
            "page_supplement": None
        },
        {
            "page_num": 3,
            "status": "partial_ready",
            "pdf_url": "/slides/slides.pdf",
            "pdf_page_num": 3,
            "ppt_text": "Go-Back-N 协议\n• 发送窗口 ≤ 2^n - 1\n• 累积确认\n• 接收方丢弃失序帧",
            "page_start_time": 2800,
            "page_end_time": 3600,
            "alignment_confidence": 0.51,
            "active_notes": None,
            "passive_notes": {
                "error": "LLM generation failed after 3 retries: connection timeout",
                "bullets": []
            },
            "aligned_segments": [
                {"start": 2810, "end": 2950, "text": "Go-Back-N 协议的发送窗口大小最大是 2 的 n 次方减 1。"},
                {"start": 3050, "end": 3180, "text": "累积确认的意思是，ACK n 表示 n 之前的帧都已经收到了。"},
                {"start": 3200, "end": 3350, "text": "接收方会丢弃所有失序帧，这是和选择重传协议最大的区别。"}
            ],
            "page_supplement": {
                "content": "老师在讲GBN时打开了Wireshark演示TCP重传过程，展示了一个丢包场景：发送方在第3帧丢失后，从第3帧开始重传了第3、4、5帧（回退N帧）。重传率约为18%，老师强调实际网络中GBN的回退重传会造成大量冗余流量，这是SR协议被提出的原因。",
                "timestamp_start": 3200,
                "timestamp_end": 3550
            }
        }
    ]
}


class RenameRequest(BaseModel):
    ppt_filename: str


@router.patch("/sessions/{session_id}")
def rename_session(session_id: str, req: RenameRequest):
    import db as _db
    session = _db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    _db.update_session(session_id, {"ppt_filename": req.ppt_filename.strip()})
    return {"ok": True}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    import db as _db
    from sqlmodel import Session as DbSession
    session = _db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    with DbSession(_db.engine) as s:
        row = s.get(_db.SessionRow, session_id)
        if row:
            s.delete(row)
            s.commit()
    return {"ok": True}


@router.get("/sessions/health")
def sessions_health():
    return {"status": "ok", "router": "sessions"}


class CreateLiveRequest(BaseModel):
    name: Optional[str] = None


@router.post("/sessions/live")
def create_live_session(req: CreateLiveRequest = CreateLiveRequest()):
    import db as _db
    import uuid
    session_id = f"live-{uuid.uuid4().hex[:8]}"
    name = (req.name or "").strip() or "Live 课堂"
    _db.save_session(session_id, {
        "status": "live",
        "ppt_filename": name,
    })
    return {"session_id": session_id}


@router.get("/settings")
def get_settings():
    """返回当前后端所有策略配置，供前端展示。"""
    return _settings.as_dict()


@router.get("/sessions")
def list_sessions():
    import db as _db
    return _db.list_sessions()


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    if session_id == "mock-session-001":
        return MOCK_SESSION

    import db as _db
    session = _db.get_session(session_id)
    if session:
        return session

    raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")


MY_NOTES_SYSTEM_PROMPT = """你是一个学习助手。用户正在看一页 PPT，他写下了自己的理解或困惑。
你的任务：根据用户的笔记和 PPT 内容，生成结构化的学习笔记。

输出格式（Markdown）：
## [简洁的标题，概括这页的核心概念]

• [bullet point 1，具体解释或补充]
• [bullet point 2]
• [bullet point 3]
...

要求：
- 标题一行，bullet 3-6 条
- 重点回应用户笔记中提到的困惑或关键词
- 结合 PPT 文本补充用户没有写到的重要内容
- 语言简洁，适合复习时快速阅读
- 直接输出 Markdown，不要加任何前缀或解释"""


class MyNoteRequest(BaseModel):
    user_note: str
    ppt_text: str
    provider: str = "中转站"


@router.post("/sessions/{session_id}/page/{page_num}/my-notes")
async def generate_my_note(session_id: str, page_num: int, req: MyNoteRequest):
    """流式生成 My Notes AI 扩写。返回 text/event-stream，每个 SSE event 是一个文本 chunk。"""
    from services.note_generator import _get_async_call_fn, PROVIDERS

    if req.provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")

    user_msg = f"## 我的笔记\n{req.user_note.strip()}\n\n## PPT 内容\n{req.ppt_text.strip()}"

    # 对 Anthropic provider 用原生 streaming；OpenAI 兼容 provider 用 openai streaming
    async def stream_anthropic():
        import anthropic as _anthropic
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
        kwargs = {"base_url": base_url} if base_url else {}
        if base_url:
            kwargs["default_headers"] = {"Authorization": f"Bearer {api_key}"}
        client = _anthropic.AsyncAnthropic(api_key=api_key, **kwargs)
        model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
        async with client.messages.stream(
            model=model,
            max_tokens=1024,
            system=MY_NOTES_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'chunk': text})}\n\n"
        yield "data: [DONE]\n\n"

    async def stream_openai_compat(base_url: str, api_key: str, model: str):
        import openai as _openai
        client = _openai.AsyncOpenAI(api_key=api_key, base_url=base_url)
        stream = await client.chat.completions.create(
            model=model,
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": MY_NOTES_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield f"data: {json.dumps({'chunk': delta})}\n\n"
        yield "data: [DONE]\n\n"

    import os
    from services.note_generator import (
        PROVIDER_ZHONGZHUAN,
        PROVIDER_QWEN, PROVIDER_DEEPSEEK, PROVIDER_DOUBAO,
    )

    provider = req.provider

    if provider == PROVIDER_ZHONGZHUAN:
        gen = stream_anthropic()
    elif provider == PROVIDER_QWEN:
        gen = stream_openai_compat(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key=os.environ.get("DASHSCOPE_API_KEY", ""),
            model=os.environ.get("QWEN_MODEL", "qwen-plus"),
        )
    elif provider == PROVIDER_DEEPSEEK:
        gen = stream_openai_compat(
            base_url="https://api.deepseek.com",
            api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
            model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        )
    elif provider == PROVIDER_DOUBAO:
        gen = stream_openai_compat(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=os.environ.get("VOLC_API_KEY", ""),
            model=os.environ.get("DOUBAO_MODEL", "doubao-pro-4k"),
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    return StreamingResponse(gen, media_type="text/event-stream")


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


@router.get("/sessions/{session_id}/slide/{page_num}.png")
def get_slide_png(session_id: str, page_num: int):
    """Render a single PDF page to PNG on demand (for sessions that predate thumbnail generation)."""
    slides_dir = Path("static") / "slides" / session_id
    png_path = slides_dir / f"slide_{page_num:03d}.png"

    # Serve cached PNG if already rendered
    if png_path.exists():
        return Response(content=png_path.read_bytes(), media_type="image/png")

    # Find the PDF for this session
    pdf_files = list(slides_dir.glob("*.pdf"))
    if not pdf_files:
        raise HTTPException(status_code=404, detail="No PDF found for this session")

    import fitz
    doc = fitz.open(str(pdf_files[0]))
    if page_num < 1 or page_num > len(doc):
        doc.close()
        raise HTTPException(status_code=404, detail=f"Page {page_num} out of range")

    page = doc[page_num - 1]
    mat = fitz.Matrix(1.5, 1.5)
    pix = page.get_pixmap(matrix=mat)
    png_bytes = pix.tobytes("png")
    doc.close()

    # Cache to disk
    slides_dir.mkdir(parents=True, exist_ok=True)
    png_path.write_bytes(png_bytes)


class AskRequest(BaseModel):
    question: str
    page_num: int
    bullet_index: int
    bullet_text: str
    bullet_ai_comment: str = ""
    model: str = "中转站"


@router.post("/sessions/{session_id}/ask")
async def ask_bullet(session_id: str, req: AskRequest):
    """针对单条 bullet 的流式问答。返回 text/event-stream (SSE)。"""
    from services.note_generator import (
        PROVIDER_ZHONGZHUAN,
        PROVIDERS,
    )

    PROVIDER_QWEN = "通义千问"
    PROVIDER_DEEPSEEK = "DeepSeek"
    PROVIDER_DOUBAO = "豆包"
    ALL_PROVIDERS = PROVIDERS + [PROVIDER_QWEN, PROVIDER_DEEPSEEK, PROVIDER_DOUBAO]

    if req.model not in ALL_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model}")

    # 读取 prompt 模板
    prompt_path = Path("prompts/ai_frontpage_ask/prompt.md")
    system_prompt = prompt_path.read_text(encoding="utf-8")
    system_prompt = (
        system_prompt
        .replace("{{ppt_text}}", req.bullet_text.strip())
        .replace("{{ai_comment}}", req.bullet_ai_comment.strip() or "（无）")
    )

    user_msg = req.question.strip()

    import os

    async def stream_anthropic():
        import anthropic as _anthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
        kwargs = {"base_url": base_url} if base_url else {}
        if base_url:
            kwargs["default_headers"] = {"Authorization": f"Bearer {api_key}"}
        client = _anthropic.AsyncAnthropic(api_key=api_key, **kwargs)
        model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
        async with client.messages.stream(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'type': 'chunk', 'content': text})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    async def stream_openai_compat(base_url: str, api_key: str, model: str):
        import openai as _openai
        client = _openai.AsyncOpenAI(api_key=api_key, base_url=base_url)
        stream = await client.chat.completions.create(
            model=model,
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    if req.model == PROVIDER_ZHONGZHUAN:
        gen = stream_anthropic()
    elif req.model == PROVIDER_QWEN:
        gen = stream_openai_compat(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key=os.environ.get("DASHSCOPE_API_KEY", ""),
            model=os.environ.get("QWEN_MODEL", "qwen-plus"),
        )
    elif req.model == PROVIDER_DEEPSEEK:
        gen = stream_openai_compat(
            base_url="https://api.deepseek.com",
            api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
            model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        )
    elif req.model == PROVIDER_DOUBAO:
        gen = stream_openai_compat(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=os.environ.get("VOLC_API_KEY", ""),
            model=os.environ.get("DOUBAO_MODEL", "doubao-pro-4k"),
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model}")

    return StreamingResponse(gen, media_type="text/event-stream")

    return Response(content=png_bytes, media_type="image/png")


@router.get("/sessions/{session_id}/run-log")
async def get_run_log(session_id: str):
    run_log_path = Path("static") / "runs" / session_id / "run_data.json"
    if not run_log_path.exists():
        raise HTTPException(status_code=404, detail="run log not found")
    with open(run_log_path, encoding="utf-8") as f:
        return json.load(f)
