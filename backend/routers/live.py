"""
Live router.
  WebSocket /ws/live-asr  — 接收音频 chunk，转发阿里云流式 ASR，推回识别结果
  POST /api/live/explain  — 接收页码+转录文本，SSE 流式返回 Claude 解释
"""
import os
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import anthropic

router = APIRouter(tags=["live"])

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

@router.websocket("/ws/live-asr")
async def live_asr(websocket: WebSocket):
    """
    接收前端音频 chunk（binary），转发给阿里云 NLS 流式 ASR，
    将识别结果推回前端。

    当前实现：mock 模式（每收到 chunk 返回占位文字），
    阿里云 NLS 集成作为 TODO 在此函数内标记。
    """
    await websocket.accept()

    # 累积 chunk 计数（用于 mock 输出）
    chunk_count = 0

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_bytes(), timeout=30.0)
            except asyncio.TimeoutError:
                # 心跳超时，关闭连接
                break

            chunk_count += 1

            # TODO: 集成阿里云 NLS 流式 ASR
            # 参考文档：https://nls-portal.console.aliyun.com/
            # SDK：nls-python-sdk or websockets 直接连接
            # wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1
            # 认证：token 通过 POST https://nls-meta.cn-shanghai.aliyuncs.com 获取
            #
            # 当前 mock：每 20 个 chunk（约 5 秒）返回一条占位识别结果
            if chunk_count % 20 == 0:
                result = {
                    "text": f"（模拟转录第 {chunk_count // 20} 句）",
                    "is_final": True,
                    "timestamp": chunk_count * 0.25,
                }
                await websocket.send_text(json.dumps(result))
            else:
                # 非 final 的实时预览（mock）
                result = {
                    "text": "…",
                    "is_final": False,
                    "timestamp": chunk_count * 0.25,
                }
                await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        pass
