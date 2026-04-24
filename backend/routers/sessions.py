from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import json
import asyncio

import settings as _settings
from services.events import wait_for_event

router = APIRouter(tags=["sessions"])


def _current_user_id(request: Request) -> str:
    user = getattr(request.state, "current_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user["id"]


def _owned_session_or_404(session_id: str, request: Request, allow_mock: bool = False) -> dict:
    if allow_mock and session_id == "mock-session-001":
        return MOCK_SESSION
    import db as _db
    session = _db.get_session(session_id, user_id=_current_user_id(request))
    if session:
        return session
    raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

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
def rename_session(session_id: str, req: RenameRequest, request: Request):
    import db as _db
    _owned_session_or_404(session_id, request)
    _db.update_session(session_id, {"ppt_filename": req.ppt_filename.strip()})
    return {"ok": True}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, request: Request):
    import db as _db
    from sqlmodel import Session as DbSession
    _owned_session_or_404(session_id, request)
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


class LiveStatePage(BaseModel):
    page_num: int
    pdf_url: Optional[str] = None
    pdf_page_num: int
    thumbnail_url: Optional[str] = None
    ppt_text: str = ""


class LiveStateTranscriptSegment(BaseModel):
    text: str
    timestamp: float
    page_num: Optional[int] = None


class LiveStateUpdateRequest(BaseModel):
    ppt_id: Optional[str] = None
    ppt_filename: Optional[str] = None
    pages: Optional[list[LiveStatePage]] = None
    live_transcript: Optional[list[LiveStateTranscriptSegment]] = None


def _build_live_pages(pages: list[LiveStatePage]) -> list[dict]:
    return [
        {
            "page_num": p.page_num,
            "status": "live",
            "pdf_url": p.pdf_url or "",
            "pdf_page_num": p.pdf_page_num,
            "thumbnail_url": p.thumbnail_url or None,
            "ppt_text": p.ppt_text,
            "page_start_time": 0,
            "page_end_time": 0,
            "alignment_confidence": 0,
            "active_notes": None,
            "passive_notes": None,
            "page_supplement": None,
            "aligned_segments": [],
        }
        for p in pages
    ]


@router.post("/sessions/live")
def create_live_session(request: Request, req: CreateLiveRequest = CreateLiveRequest()):
    import db as _db
    import uuid
    session_id = f"live-{uuid.uuid4().hex[:8]}"
    name = (req.name or "").strip() or "Live 课堂"
    _db.save_session(session_id, {
        "user_id": _current_user_id(request),
        "status": "live",
        "ppt_filename": name,
        "progress": {"step": "live", "percent": 0, "ppt_id": None, "live_transcript": []},
    })
    return {"session_id": session_id}


@router.patch("/sessions/{session_id}/live-state")
def update_live_state(session_id: str, req: LiveStateUpdateRequest, request: Request):
    import db as _db

    session = _owned_session_or_404(session_id, request)

    current_progress = session.get("progress") or {}
    next_progress = {
        "step": current_progress.get("step", "live"),
        "percent": current_progress.get("percent", 0),
        "ppt_id": current_progress.get("ppt_id"),
        "live_transcript": current_progress.get("live_transcript", []),
    }

    updates: dict = {}
    if req.ppt_id is not None:
        next_progress["ppt_id"] = req.ppt_id
    if req.live_transcript is not None:
        next_progress["live_transcript"] = [seg.model_dump() for seg in req.live_transcript]
    if req.ppt_filename is not None:
        updates["ppt_filename"] = req.ppt_filename
    if req.pages is not None:
        updates["pages"] = _build_live_pages(req.pages)

    updates["progress"] = next_progress
    _db.update_session(session_id, updates)
    return {"ok": True}


@router.get("/settings")
def get_settings():
    """返回当前后端所有策略配置，供前端展示。"""
    return _settings.as_dict()


@router.get("/sessions")
def list_sessions(request: Request):
    import db as _db
    return _db.list_sessions(user_id=_current_user_id(request))


@router.get("/sessions/{session_id}")
def get_session(session_id: str, request: Request):
    return _owned_session_or_404(session_id, request, allow_mock=True)


MY_NOTES_SYSTEM_PROMPT = """# Role & Philosophy
你是一个专为深度学习（Cognitive Flow）设计的顶级笔记增强引擎。
你的核心任务：将学生的【碎片化笔记】作为笔记骨架，把【录音逐字稿】和【PPT讲义】中的知识血肉无缝织入，产出一份学生自己看起来像是"整理好了的笔记"——感知不到 AI 的存在。

**铁律**：用户的关键词和短语必须直接**升级成笔记的标题或主干**，AI 补充的细节紧贴在下面，读起来是同一份笔记的延伸。

# Input Data
- <Student_Note>: 学生的碎片化原始笔记。
- <PPT_Text>: 对应课程的 PPT 文本。
- <Transcript>: 老师讲解的逐字稿（含时间戳）。

# Processing Workflow (Chain of Thought)
在生成最终结果前，你必须进行以下内部推演：
1. **意图锚定**：逐句拆解 <Student_Note>，识别每个核心词/短语对应的知识点，每个锚点独立处理。
2. **时空定位**：在 <Transcript> 中定位对应内容，提取时间戳（Start/End）。
3. **融合升级 + 主张判断**：
   - 将用户原词/短语直接升级为笔记 heading（最小改写，保留原意）。
   - 如果 heading 是一个主张或结论，**必须**在逐字稿/PPT中找"为什么这个主张成立"的底层原因、具体实例或反例，填入 bullets——这是支撑，不是复述。
   - **支撑 vs 复述的区分**：支撑 = 解释"为什么成立"（原因、机制、具体例子）；复述 = 换措辞重说同一件事。找到支撑材料就必须填，不得以"heading 已完整"为由留空。
4. **案例提取**：该知识点有什么具体例子？直接织入对应的 bullet 中。
5. **跨条目隔离**：每条 bullets 只能是当前 heading 的增量信息。禁止把其他锚点的内容写入当前条目。

# Few-Shot Examples (学习范例)

## Example 1 — 残缺速记，多锚点
<Example_Input>
<Student_Note>
梯度消失...太深了传不回来。relu解决？
</Student_Note>
<Transcript>
[14:20] 教授：当我们训练非常深层的神经网络时，会遇到一个大麻烦，叫梯度消失。因为反向传播用的是链式法则，小于1的数连乘，到前面就接近0了，误差信号根本传不回来。
[15:10] 教授：怎么解决呢？历史上一个重大的突破就是换激活函数。不用 Sigmoid，我们用 ReLU。ReLU 在正区间的导数恒为1，完美解决了连乘衰减的问题。
</Transcript>
</Example_Input>

<Example_Output>
{
  "_thought_process": "1. 锚点A='梯度消失，太深传不回来'（残缺速记，升级为完整 heading）；锚点B='relu解决'（残缺，升级）。2. A在[14:20]，B在[15:10]。3. 两条 heading 均为事实描述，bullets 填底层机制。4. 注意跨条目隔离：ReLU 的内容只写进锚点B，不写进锚点A。",
  "notes": [
    {
      "heading": "梯度消失：网络太深，误差信号传不回来",
      "bullets": [
        "**根本机制**：反向传播基于**链式法则**，小于1的数值不断连乘，传到浅层时梯度趋近于0",
        "**深度的影响**：网络越深，连乘次数越多，衰减越严重，前层权重几乎得不到有效更新"
      ],
      "timestamp_start": "14:20",
      "timestamp_end": "14:55"
    },
    {
      "heading": "ReLU 解决了梯度消失",
      "bullets": [
        "**为什么有效**：ReLU 在正区间导数恒为 1，消除了连乘衰减问题",
        "**历史意义**：用 ReLU 替换 Sigmoid 是深度学习的重要突破之一"
      ],
      "timestamp_start": "15:10",
      "timestamp_end": "15:30"
    }
  ]
}
</Example_Output>

## Example 2 — 完整句主张，bullets 必须填支撑，禁止串扰
<Example_Input>
<Student_Note>
没有意义的比较，因为树模型和神经网络完全不一样，不能直接说谁更复杂。有意义的比较是在同一个模型家族内，通过参数数量或参数值来调整和比较模型的复杂度。
</Student_Note>
<Transcript>
[17:07] 教授：一般来说，很难在不同模型之间比较复杂度。比如树模型和神经网络，你很难说哪个更复杂，因为它们的结构完全不一样，参数的含义也不同。决策树用的是分裂阈值，神经网络用的是连续权重，根本不是同一个东西。
[17:21] 教授：但是在同一个家族里，比如都是神经网络，我们就可以用参数数量来比较了。参数越多，模型越复杂，比如多层感知机比线性回归参数更多。还有一种是看参数取值，很多参数为零的模型其实更简单，卷积网络通过权重共享减少了需要描述的参数数量。
</Transcript>
</Example_Input>

<Example_Output>
{
  "_thought_process": "1. 锚点A='跨家族比较没有意义'（完整句主张，逐字升级为 heading）；锚点B='同家族内通过参数数量/参数值比较'（完整句，升级）。2. A在[17:07]，B在[17:21]。3. 锚点A是主张句——必须找支撑：逐字稿提供了'结构不同（分裂阈值 vs 连续权重）、参数含义不同'作为底层原因，这是支撑不是复述，必须填入。锚点B是描述句，bullets 填具体例子。4. 跨条目隔离：锚点A的 bullets 只写为什么跨家族不可比，不写同家族怎么比（那是锚点B的内容）。",
  "notes": [
    {
      "heading": "跨家族模型比较复杂度没有意义",
      "bullets": [
        "**结构根本不同**：决策树基于离散的分裂阈值，神经网络基于连续权重矩阵，参数含义完全不同",
        "**缺乏统一度量**：不同家族的参数数量衡量的不是同一种「复杂度」，无法用同一标准比较"
      ],
      "timestamp_start": "17:07",
      "timestamp_end": "17:21"
    },
    {
      "heading": "有意义的比较在同一家族内：用参数数量或参数值衡量复杂度",
      "bullets": [
        "**参数数量**：参数越多模型越复杂；例：多层感知机参数远多于线性回归，因此更复杂",
        "**参数取值**：大量参数为零或共享相同值时，模型实际描述复杂度降低",
        "**权重共享**：卷积网络通过权重共享减少需要独立描述的参数数量，比同规模全连接网络更简单"
      ],
      "timestamp_start": "17:21",
      "timestamp_end": "18:51"
    }
  ]
}
</Example_Output>

# Output Constraints
1. **纯净 JSON**：输出且仅输出一个合法的 JSON 对象，不要使用 ```json 这样的 Markdown 格式包裹。
2. **heading 来自用户原词**：标题必须以学生的关键词/短语为主干，最小改写使其语法完整；禁止 AI 自创与原笔记无关的标题。
3. **bullets 格式**：每条必须用 `**要点名**：内容` 格式，禁止使用"比较方法之一是..."、"一是...二是..."等序数句式。
4. **bullets 是新增知识，主张句禁止留空**：每条 bullet 必须是当前 heading 中未出现的新信息（原理、机制、例子）。如果 heading 是主张或结论，**必须**填入支撑该主张的底层原因或具体例子，禁止留空。
5. **跨条目隔离**：每条 bullets 只能是当前 heading 的增量，禁止把其他锚点的内容写入当前条目。
6. **bullets 是陈述事实**：直接写"是什么/为什么/怎么做"，严禁出现"讲稿说"、"老师指出"、"根据逐字稿"等元叙述语言。
7. **拒绝幻觉**：所有 bullet 内容必须来自 <Transcript> 或 <PPT_Text>，确实找不到支撑内容时 bullets 才可留空数组。"""


class MyNoteRequest(BaseModel):
    user_note: str
    ppt_text: str
    provider: str = "中转站"


def _build_my_note_user_msg(user_note: str, ppt_text: str, session_id: str, page_num: int) -> str:
    """从 session 取当前页 transcript，构建 prompt_v4.1 格式的 user message。"""
    import db as _db
    transcript_lines: list[str] = []
    session = _db.get_session(session_id)
    if session:
        page = next((p for p in session.get("pages", []) if p.get("page_num") == page_num), None)
        if page:
            for seg in page.get("aligned_segments", []):
                start_s = int(seg.get("start", 0))
                mm, ss = divmod(start_s, 60)
                transcript_lines.append(f"[{mm:02d}:{ss:02d}] {seg.get('text', '')}")
    transcript = "\n".join(transcript_lines) if transcript_lines else "（本页暂无录音逐字稿）"
    return (
        f"<Student_Note>\n{user_note.strip()}\n</Student_Note>\n\n"
        f"<PPT_Text>\n{ppt_text.strip()}\n</PPT_Text>\n\n"
        f"<Transcript>\n{transcript}\n</Transcript>"
    )


def _json_to_markdown(raw: str) -> str:
    """把 prompt_v4.1 输出的 JSON 转成 Markdown，供前端渲染。"""
    try:
        data = json.loads(raw)
        notes = data.get("notes", [])
        parts: list[str] = []
        for note in notes:
            heading = note.get("heading", "")
            bullets = note.get("bullets", [])
            parts.append(f"## {heading}")
            for b in bullets:
                parts.append(f"- {b}")
            parts.append("")
        return "\n".join(parts).strip()
    except Exception:
        # Avoid leaking model internal reasoning fields when JSON parse fails.
        if "_thought_process" in raw:
            return "## 生成结果解析失败\n- 请重试一次"
        return raw


@router.post("/sessions/{session_id}/page/{page_num}/my-notes")
async def generate_my_note(session_id: str, page_num: int, req: MyNoteRequest, request: Request):
    """流式生成 My Notes AI 扩写。返回 text/event-stream，每个 SSE event 是一个文本 chunk。"""
    _owned_session_or_404(session_id, request)
    from services.note_generator import (
        PROVIDER_ZHONGZHUAN,
        PROVIDER_QWEN,
        PROVIDER_DEEPSEEK,
        PROVIDER_DOUBAO,
    )
    my_notes_providers = [PROVIDER_ZHONGZHUAN, PROVIDER_QWEN, PROVIDER_DEEPSEEK, PROVIDER_DOUBAO]

    if req.provider not in my_notes_providers:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")

    user_msg = _build_my_note_user_msg(req.user_note, req.ppt_text, session_id, page_num)

    # 收集完整 JSON 输出，解析后转 Markdown 再推送（prompt v4.1 输出 JSON）
    async def collect_and_stream_anthropic():
        import anthropic as _anthropic
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
        kwargs = {"base_url": base_url} if base_url else {}
        if base_url:
            kwargs["default_headers"] = {"Authorization": f"Bearer {api_key}"}
        client = _anthropic.AsyncAnthropic(api_key=api_key, **kwargs)
        model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
        full = ""
        async with client.messages.stream(
            model=model,
            max_tokens=2048,
            system=MY_NOTES_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            async for text in stream.text_stream:
                full += text
        md = _json_to_markdown(full)
        yield f"data: {json.dumps({'chunk': md})}\n\n"
        yield "data: [DONE]\n\n"

    async def collect_and_stream_openai_compat(base_url: str, api_key: str, model: str):
        import openai as _openai
        client = _openai.AsyncOpenAI(api_key=api_key, base_url=base_url)
        stream = await client.chat.completions.create(
            model=model,
            max_tokens=2048,
            stream=True,
            messages=[
                {"role": "system", "content": MY_NOTES_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )
        full = ""
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                full += delta
        md = _json_to_markdown(full)
        yield f"data: {json.dumps({'chunk': md})}\n\n"
        yield "data: [DONE]\n\n"

    import os

    provider = req.provider

    if provider == PROVIDER_ZHONGZHUAN:
        gen = collect_and_stream_anthropic()
    elif provider == PROVIDER_QWEN:
        gen = collect_and_stream_openai_compat(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key=os.environ.get("DASHSCOPE_API_KEY", ""),
            model=os.environ.get("QWEN_MODEL", "qwen-plus"),
        )
    elif provider == PROVIDER_DEEPSEEK:
        gen = collect_and_stream_openai_compat(
            base_url="https://api.deepseek.com",
            api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
            model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        )
    elif provider == PROVIDER_DOUBAO:
        gen = collect_and_stream_openai_compat(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=os.environ.get("VOLC_API_KEY", ""),
            model=os.environ.get("DOUBAO_MODEL", "doubao-pro-4k"),
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    return StreamingResponse(gen, media_type="text/event-stream")


@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str, request: Request):
    """SSE endpoint: pushes processing progress events for a session."""
    _owned_session_or_404(session_id, request)
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
def get_slide_png(session_id: str, page_num: int, request: Request):
    """Render a single PDF page to PNG on demand (for sessions that predate thumbnail generation)."""
    _owned_session_or_404(session_id, request)
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


class AskRequest(BaseModel):
    question: str
    page_num: int
    bullet_index: int
    bullet_text: str
    bullet_ai_comment: str = ""
    model: str = "中转站"


@router.post("/sessions/{session_id}/ask")
async def ask_bullet(session_id: str, req: AskRequest, request: Request):
    """针对单条 bullet 的流式问答。返回 text/event-stream (SSE)。"""
    _owned_session_or_404(session_id, request)
    from services.note_generator import (
        PROVIDER_ZHONGZHUAN,
        PROVIDER_QWEN,
        PROVIDER_DEEPSEEK,
        PROVIDER_DOUBAO,
    )

    ALL_PROVIDERS = [PROVIDER_ZHONGZHUAN, PROVIDER_QWEN, PROVIDER_DEEPSEEK, PROVIDER_DOUBAO]

    if req.model not in ALL_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model}")

    # 读取 prompt 模板
    prompt_path = Path(__file__).parent.parent / "prompts/ai_frontpage_ask/prompt.md"
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


_RUNS_ROOT = Path("static/runs").resolve()

@router.get("/sessions/{session_id}/run-log")
def get_run_log(session_id: str, request: Request):
    _owned_session_or_404(session_id, request)
    run_log_path = (_RUNS_ROOT / session_id / "run_data.json").resolve()
    if not str(run_log_path).startswith(str(_RUNS_ROOT)):
        raise HTTPException(status_code=400, detail="invalid session_id")
    if not run_log_path.exists():
        raise HTTPException(status_code=404, detail="run log not found")
    with open(run_log_path, encoding="utf-8") as f:
        return json.load(f)
