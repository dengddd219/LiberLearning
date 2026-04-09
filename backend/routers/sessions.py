from fastapi import APIRouter, HTTPException

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
            "slide_image_url": "/slides/slide_001.png",
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
                        "timestamp": 45
                    },
                    {
                        "text": "成帧：将数据报文加帧头帧尾封装为帧（Frame）",
                        "ai_comment": "常见成帧方法：字节计数法、字节填充法（标志字节+转义字节）、比特填充法（01111110标志序列）",
                        "timestamp": 120
                    },
                    {
                        "text": "差错控制：CRC校验 + ARQ（自动重传请求）",
                        "ai_comment": "CRC只检错不纠错；ARQ负责重传。常见ARQ协议：Stop-and-Wait、Go-Back-N、Selective Repeat",
                        "timestamp": 380
                    },
                    {
                        "text": "流量控制：滑动窗口机制限制发送方速率",
                        "ai_comment": "窗口大小决定吞吐量上限：throughput = window_size / RTT",
                        "timestamp": 670
                    }
                ]
            },
            "page_supplement": None
        },
        {
            "page_num": 2,
            "slide_image_url": "/slides/slide_002.png",
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
                        "timestamp": 1250
                    },
                    {
                        "text": "信道利用率公式：U = T_f / (T_f + RTT + T_a)，T_f为帧传输时间",
                        "ai_comment": "当RTT >> T_f时，信道大部分时间处于等待状态，利用率趋近于0，这就是引入滑动窗口的动机",
                        "timestamp": 1580
                    },
                    {
                        "text": "超时重传（Timeout Retransmission）：计时器到期未收ACK则重发",
                        "ai_comment": "超时时间设置是工程难题：太短导致误重传，太长导致恢复慢。TCP中用SRTT+4*RTTVAR动态估算",
                        "timestamp": 1920
                    },
                    {
                        "text": "序号只需1bit（0/1交替），因为任意时刻最多只有1帧在途",
                        "ai_comment": "这是停止等待协议的特殊性质。滑动窗口协议需要更多位的序号",
                        "timestamp": 2400
                    }
                ]
            },
            "page_supplement": None
        },
        {
            "page_num": 3,
            "slide_image_url": "/slides/slide_003.png",
            "ppt_text": "Go-Back-N 协议\n• 发送窗口 ≤ 2^n - 1\n• 累积确认\n• 接收方丢弃失序帧",
            "page_start_time": 2800,
            "page_end_time": 3600,
            "alignment_confidence": 0.51,
            "active_notes": None,
            "passive_notes": {
                "bullets": [
                    {
                        "text": "GBN允许连续发送多帧，发送窗口大小W ≤ 2^n−1",
                        "ai_comment": "n为序号位数。窗口上限2^n−1而非2^n，是为了让接收方能区分新帧和重传帧",
                        "timestamp": 2850
                    },
                    {
                        "text": "接收方只接受按序到来的帧，失序帧直接丢弃",
                        "ai_comment": "这是GBN与SR（选择重传）的核心区别：GBN接收缓冲为1，SR接收缓冲=窗口大小",
                        "timestamp": 3100
                    }
                ]
            },
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


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    if session_id == "mock-session-001":
        return MOCK_SESSION
    raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")


@router.post("/sessions/{session_id}/page/{page_num}/retry")
def retry_page(session_id: str, page_num: int):
    """Stub for Phase B real API. Returns success for mock session."""
    if session_id == "mock-session-001":
        return {"status": "ok", "message": f"Page {page_num} retry queued (mock)"}
    raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
