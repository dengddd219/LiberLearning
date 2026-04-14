from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pathlib import Path

import settings as _settings

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
                        "text": "数据链路层位于OSI第二层，在相邻节点间提供可靠传输",
                        "ai_comment": "「相邻节点」是关键限定词——数据链路层只负责一跳（hop）之内的传输，跨多跳由网络层负责",
                        "timestamp_start": 45,
                        "timestamp_end": 98
                    },
                    {
                        "text": "成帧：将数据报文加帧头帧尾封装为帧（Frame）",
                        "ai_comment": "常见成帧方法：字节计数法、字节填充法（标志字节+转义字节）、比特填充法（01111110标志序列）",
                        "timestamp_start": 120,
                        "timestamp_end": 210
                    },
                    {
                        "text": "差错控制：CRC校验 + ARQ（自动重传请求）",
                        "ai_comment": "CRC只检错不纠错；ARQ负责重传。常见ARQ协议：Stop-and-Wait、Go-Back-N、Selective Repeat",
                        "timestamp_start": 380,
                        "timestamp_end": 490
                    },
                    {
                        "text": "流量控制：滑动窗口机制限制发送方速率",
                        "ai_comment": "窗口大小决定吞吐量上限：throughput = window_size / RTT",
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
                        "text": "停止等待协议：每次只发一帧，收到ACK后才发下一帧",
                        "ai_comment": "最简单的ARQ协议，实现简单但信道利用率极低，适合RTT小、帧大的场景",
                        "timestamp_start": 1250,
                        "timestamp_end": 1360
                    },
                    {
                        "text": "信道利用率公式：U = T_f / (T_f + RTT + T_a)，T_f为帧传输时间",
                        "ai_comment": "当RTT >> T_f时，信道大部分时间处于等待状态，利用率趋近于0，这就是引入滑动窗口的动机",
                        "timestamp_start": 1580,
                        "timestamp_end": 1720
                    },
                    {
                        "text": "超时重传（Timeout Retransmission）：计时器到期未收ACK则重发",
                        "ai_comment": "超时时间设置是工程难题：太短导致误重传，太长导致恢复慢。TCP中用SRTT+4*RTTVAR动态估算",
                        "timestamp_start": 1920,
                        "timestamp_end": 2050
                    },
                    {
                        "text": "序号只需1bit（0/1交替），因为任意时刻最多只有1帧在途",
                        "ai_comment": "这是停止等待协议的特殊性质。滑动窗口协议需要更多位的序号",
                        "timestamp_start": 2400,
                        "timestamp_end": 2480
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


@router.get("/sessions/health")
def sessions_health():
    return {"status": "ok", "router": "sessions"}


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

    return Response(content=png_bytes, media_type="image/png")
