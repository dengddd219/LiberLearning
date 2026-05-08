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


def _owned_session_or_404(session_id: str, request: Request) -> dict:
    import db as _db
    import os
    # In public guest access mode, skip user_id check so anyone can view any session
    if os.environ.get("PUBLIC_GUEST_ACCESS", "").lower() == "true":
        session = _db.get_session(session_id)
    else:
        session = _db.get_session(session_id, user_id=_current_user_id(request))
    if session:
        return session
    raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")


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
    import os
    if os.environ.get("PUBLIC_GUEST_ACCESS", "").lower() == "true":
        return _db.list_sessions()
    return _db.list_sessions(user_id=_current_user_id(request))


@router.get("/sessions/{session_id}")
def get_session(session_id: str, request: Request):
    return _owned_session_or_404(session_id, request)


MY_NOTES_SYSTEM_PROMPT = """# Role & Philosophy
你是一个专为深度学习（Cognitive Flow）设计的顶级笔记增强引擎。
你的核心任务：将学生的【碎片化笔记】作为笔记骨架，把【录音逐字稿】和【PPT讲义】中的知识血肉无缝织入，产出一份学生自己看起来像是"整理好了的笔记"——感知不到 AI 的存在。

**铁律**：用户的关键词和短语必须直接**升级成笔记的标题或主干**，AI 补充的细节紧贴在下面，读起来是同一份笔记的延伸。

# Input Data
- <Student_Note>: 学生的碎片化原始笔记。
- <PPT_Text>: 对应课程的 PPT 文本。
- <Transcript>: 老师讲解的逐字稿（含时间戳）。

# Processing Workflow (Chain of Thought)
在生成最终结果前，先在脑中完成以下推演（不要输出推演过程）：
1. **意图锚定**：逐句拆解 <Student_Note>，识别每个核心词/短语对应的知识点，每个锚点独立处理。
2. **时空定位**：在 <Transcript> 中定位对应内容，提取时间戳。
3. **融合升级 + 主张判断**：
   - 将用户原词/短语直接升级为笔记 heading（最小改写，保留原意）。
   - 如果 heading 是一个主张或结论，**必须**在逐字稿/PPT中找"为什么这个主张成立"的底层原因、具体实例或反例，填入 bullets——这是支撑，不是复述。
4. **案例提取**：该知识点有什么具体例子？直接织入对应的 bullet 中。
5. **跨条目隔离**：每条 bullets 只能是当前 heading 的增量信息。禁止把其他锚点的内容写入当前条目。
6. **遗漏扫描**：处理完所有学生锚点后，找出学生笔记**完全未覆盖**的重要知识点，在末尾用"## 课堂补充"小节输出。**如果没有真正遗漏的知识点，绝对不要输出"课堂补充"小节。**

# Few-Shot Examples (学习范例)

## Example 1 — 残缺速记，多锚点
<Example_Input>
<Student_Note>
梯度消失...太深了传不回来。relu解决？
</Student_Note>
<Transcript>
[14:20] 教授：当我们训练非常深层的神经网络时，会遇到一个大麻烦，叫梯度消失。因为反向传播用的是链式法则，小于1的数连乘，到前面就接近0了，误差信号根本传不回来。
[15:10] 教授：怎么解决呢？历史上一个重大的突破就是换激活函数。不用 Sigmoid，我们用 ReLU。ReLU 在正区间的导数恒为1，完美解决了连乘衰减的问题。
[15:40] 教授：另外要注意，学习率的选择也很关键。学习率太大会导致训练不稳定，太小则收敛太慢。
</Transcript>
</Example_Input>

<Example_Output>
## 梯度消失：网络太深，误差信号传不回来
- **根本机制**：反向传播基于**链式法则**，小于1的数值不断连乘，传到浅层时梯度趋近于0
- **深度的影响**：网络越深，连乘次数越多，衰减越严重，前层权重几乎得不到有效更新

## ReLU 解决了梯度消失
- **为什么有效**：ReLU 在正区间导数恒为 1，消除了连乘衰减问题
- **历史意义**：用 ReLU 替换 Sigmoid 是深度学习的重要突破之一

## 课堂补充

### 学习率的选择影响训练稳定性
- **太大**：训练不稳定，参数更新幅度过大
- **太小**：收敛速度过慢，训练效率低
</Example_Output>

## Example 2 — 完整句主张，supplements 捡回遗漏知识点
<Example_Input>
<Student_Note>
没有意义的比较，因为树模型和神经网络完全不一样，不能直接说谁更复杂。有意义的比较是在同一个模型家族内，通过参数数量或参数值来调整和比较模型的复杂度。
</Student_Note>
<Transcript>
[17:07] 教授：一般来说，很难在不同模型之间比较复杂度。比如树模型和神经网络，你很难说哪个更复杂，因为它们的结构完全不一样，参数的含义也不同。决策树用的是分裂阈值，神经网络用的是连续权重，根本不是同一个东西。
[17:21] 教授：但是在同一个家族里，比如都是神经网络，我们就可以用参数数量来比较了。参数越多，模型越复杂，比如多层感知机比线性回归参数更多。还有一种是看参数取值，很多参数为零的模型其实更简单，卷积网络通过权重共享减少了需要描述的参数数量。
[18:51] 教授：这给了我们一个实践指引：想增加复杂度就增加层数或隐藏单元，想降低复杂度则相反。
[19:13] 教授：如果你想评估数据的复杂度，数据点的数量肯定是一个重要因素。
</Transcript>
</Example_Input>

<Example_Output>
## 跨家族模型比较复杂度没有意义
- **结构根本不同**：决策树基于离散的分裂阈值，神经网络基于连续权重矩阵，参数含义完全不同
- **缺乏统一度量**：不同家族的参数数量衡量的不是同一种「复杂度」，无法用同一标准比较

## 有意义的比较在同一家族内：用参数数量或参数值衡量复杂度
- **参数数量**：参数越多模型越复杂；例：多层感知机参数远多于线性回归，因此更复杂
- **参数取值**：大量参数为零或共享相同值时，模型实际描述复杂度降低
- **权重共享**：卷积网络通过权重共享减少需要独立描述的参数数量，比同规模全连接网络更简单

## 课堂补充

### 实践操作：如何调整模型复杂度
- **增加复杂度**：增加层数或隐藏单元数量
- **降低复杂度**：减少层数或隐藏单元数量

### 数据复杂度的评估
- **数据点数量**：样本数量是衡量数据复杂度的重要因素之一
</Example_Output>

## Example 3 — 学生笔记已覆盖全部内容，无课堂补充
<Example_Input>
<Student_Note>
过拟合问题严重
</Student_Note>
<Transcript>
[05:10] 教授：过拟合是指模型在训练集上表现很好，但在新数据上表现很差。比如训练数据里5个违约者都穿蓝衬衫，模型就把蓝衬衫当成违约的预测信号，但这只是随机巧合，不是真实规律。
[05:45] 教授：所以过拟合的本质是模型记住了训练集的噪声，而不是学到了真正的规律。
</Transcript>
</Example_Input>

<Example_Output>
## 过拟合问题严重
- **定义**：模型在训练集上表现好，但在新数据上表现差——记住了噪声而非规律
- **经典案例**：训练数据中5名违约者均穿蓝色衬衫，模型将「蓝色衬衫」识别为违约信号，实为随机巧合
- **根本原因**：训练集缺乏对照组，模型捕捉到的是虚假相关，而非因果关系
</Example_Output>

（注意：上例中 Transcript 的内容已被学生笔记完全覆盖，因此不输出"课堂补充"小节。）

# Output Constraints
1. **纯净 Markdown**：直接输出 Markdown 文本，不要输出 JSON，不要用代码块包裹，不要输出推演过程。
2. **heading 来自用户原词**：`##` 标题必须以学生的关键词/短语为主干，最小改写使其语法完整；禁止 AI 自创与原笔记无关的标题。"课堂补充"小节的 `###` 标题由 AI 自拟，需简洁准确。
3. **bullets 格式**：每条必须用 `- **要点名**：内容` 格式，禁止使用"比较方法之一是..."、"一是...二是..."等序数句式。
4. **bullets 是新增知识，主张句禁止留空**：每条 bullet 必须是当前 heading 中未出现的新信息（原理、机制、例子）。如果 heading 是主张或结论，**必须**填入支撑该主张的底层原因或具体例子，禁止留空。
5. **跨条目隔离**：每条 bullets 只能是当前 heading 的增量，禁止把其他锚点的内容写入当前条目。
6. **bullets 是陈述事实**：直接写"是什么/为什么/怎么做"，严禁出现"讲稿说"、"老师指出"、"根据逐字稿"等元叙述语言。
7. **拒绝幻觉**：所有 bullet 内容必须来自 <Transcript> 或 <PPT_Text>，确实找不到支撑内容时 bullets 才可留空。
8. **课堂补充只收真正遗漏的知识点**：每条必须满足——① 在正文任何 heading 或 bullets 中均未出现；② 在当前页的 <Transcript> 或 <PPT_Text> 中有**明确的文字依据**，可以逐字引用。**禁止从训练记忆、示例或其他来源编造内容**。没有遗漏则不输出"课堂补充"小节。"""


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

    # 直接流式推送 Markdown chunks（prompt 已改为 Markdown 输出）
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
            max_tokens=2048,
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
            max_tokens=2048,
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
