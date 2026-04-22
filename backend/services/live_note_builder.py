"""
生成课后 AI Notes（markdown 格式，每条 bullet 带时间戳，便于 Detailed Notes 精准定位）。
输入：完整 transcript segments（带 assigned_page）+ 可选 PPT page texts
输出：SSE 文本流（每个 token 一个 data: 事件，最终内容为 markdown 字符串）

AI Notes 输出格式（有PPT）：
  ## 第1页
  - [03:12–04:45] 梯度消失问题的本质
  - [04:46–05:30] 解决方案：残差连接

AI Notes 输出格式（无PPT）：
  ## 深度学习基础
  - [00:10–02:30] 神经网络的基本结构
"""
import json
import os
import threading
from pathlib import Path
from typing import Generator

import anthropic

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
_detailed_note_semaphore = threading.Semaphore(3)  # 同时最多 3 个详细解释调用


# ---------------------------------------------------------------------------
# 格式化工具（复用 note_generator 的逻辑）
# ---------------------------------------------------------------------------

def _format_segments(segments: list[dict]) -> str:
    """带 [MM:SS–MM:SS] 时间戳的 transcript 块，与 note_generator._format_segments 一致。"""
    lines = []
    for seg in segments:
        start = int(seg.get("start_ms", 0) / 1000) if "start_ms" in seg else int(seg.get("start", 0))
        end = int(seg.get("end_ms", 0) / 1000) if "end_ms" in seg else int(seg.get("end", 0))
        mm_s, ss_s = divmod(start, 60)
        mm_e, ss_e = divmod(end, 60)
        lines.append(f"[{mm_s:02d}:{ss_s:02d}–{mm_e:02d}:{ss_e:02d}] {seg['text']}")
    return "\n".join(lines) or "(no transcript)"


def _format_ppt_bullets(ppt_text: str) -> str:
    """编号列表，与 note_generator._format_ppt_bullets 一致。"""
    lines = [l.strip() for l in ppt_text.splitlines() if l.strip()]
    if not lines:
        return "(no bullet points on this slide)"
    return "\n".join(f"{i+1}. {line}" for i, line in enumerate(lines))


def _load_system_prompt(has_ppt: bool) -> str:
    """根据是否有 PPT 返回内联 system prompt，要求输出带时间戳的 markdown bullet。"""
    if has_ppt:
        return (
            "You are a lecture note assistant. Given PPT bullet points and the teacher's transcript "
            "(with timestamps), generate concise AI notes in markdown.\n\n"
            "Output format (strictly follow):\n"
            "## 第{N}页\n"
            "- [MM:SS–MM:SS] key point from this page\n"
            "- [MM:SS–MM:SS] another key point\n\n"
            "Rules:\n"
            "- Each bullet MUST start with the timestamp range [MM:SS–MM:SS] copied from the transcript.\n"
            "- If a point spans multiple segments, use the first segment's start and last segment's end.\n"
            "- Write in the same language as the transcript.\n"
            "- Do NOT invent content not in the transcript.\n"
            "- Skip pages with no transcript (no bullet needed)."
        )
    else:
        return (
            "You are a lecture note assistant. Given the teacher's transcript (with timestamps), "
            "generate concise AI notes organized by topic in markdown.\n\n"
            "Output format (strictly follow):\n"
            "## Topic Name\n"
            "- [MM:SS–MM:SS] key point about this topic\n"
            "- [MM:SS–MM:SS] another key point\n\n"
            "Rules:\n"
            "- Each bullet MUST start with the timestamp range [MM:SS–MM:SS] copied from the transcript.\n"
            "- Group related points under the same ## topic heading.\n"
            "- Write in the same language as the transcript.\n"
            "- Do NOT invent content not in the transcript."
        )


# ---------------------------------------------------------------------------
# stream_notes：整课 AI Notes 流式生成
# ---------------------------------------------------------------------------

def _build_notes_user_msg(
    segments: list[dict],
    ppt_pages: list[dict] | None,
    my_notes: list[dict] | None,
) -> str:
    """构建 user_msg（transcript + PPT + my_notes），格式与 note_generator 对齐。"""
    transcript_block = _format_segments(segments) if segments else "(no transcript)"

    my_notes_block = ""
    if my_notes:
        parts = [f"第{n['page']}页：{n['text'].strip()}" for n in my_notes if n.get("text", "").strip()]
        my_notes_block = "\n".join(parts)

    if ppt_pages:
        # 按页拼接 PPT bullets + 该页 transcript
        page_seg_map: dict[int, list[dict]] = {}
        for seg in segments:
            p = seg.get("assigned_page") or seg.get("current_page_hint") or 0
            page_seg_map.setdefault(p, []).append(seg)

        parts = []
        for p in ppt_pages:
            page_num = p["page_num"]
            bullets = _format_ppt_bullets(p.get("ppt_text", ""))
            page_segs = page_seg_map.get(page_num, [])
            transcript = _format_segments(page_segs) if page_segs else "(no transcript for this page)"
            parts.append(
                f"=== 第{page_num}页 ===\n"
                f"## PPT Bullet Points\n{bullets}\n\n"
                f"## Transcript\n{transcript}"
            )
        user_msg = "\n\n".join(parts)
        if my_notes_block:
            user_msg += f"\n\n## Student Notes (for reference)\n{my_notes_block}"
        return user_msg
    else:
        user_msg = f"## Transcript\n{transcript_block}"
        if my_notes_block:
            user_msg += f"\n\n## Student Notes (for reference)\n{my_notes_block}"
        return user_msg


def stream_notes(
    segments: list[dict],
    ppt_pages: list[dict] | None,
    my_notes: list[dict] | None,
    max_retries: int = 1,
) -> Generator[str, None, None]:
    """
    生成器：每次 yield 一个 SSE data 行。
    system prompt 要求输出带时间戳的 markdown bullet（- [MM:SS–MM:SS] 内容）。
    失败最多重试 max_retries 次。
    """
    system_prompt = _load_system_prompt(has_ppt=bool(ppt_pages))
    user_msg = _build_notes_user_msg(segments, ppt_pages, my_notes)

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    kwargs = {"base_url": base_url} if base_url else {}
    client = anthropic.Anthropic(api_key=api_key, **kwargs)

    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
            return
        except Exception as e:
            last_exc = e
            if attempt < max_retries:
                yield f"data: {json.dumps({'retry': attempt + 1})}\n\n"

    yield f"data: {json.dumps({'error': str(last_exc)})}\n\n"
    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# generate_detailed_note：逐行详细解释（SSE 流式，并发限制 3）
# ---------------------------------------------------------------------------

_DETAILED_NOTE_SYSTEM = """You are a study assistant. Explain the given lecture note bullet in detail, grounded in the teacher's actual transcript. Write 2-4 paragraphs, 2-3 sentences each. Do NOT invent content not present in the transcript. Write in the same language as the transcript."""


def generate_detailed_note(
    line_text: str,
    page_num: int | None,
    segments: list[dict],
    start_sec: float | None = None,
    end_sec: float | None = None,
) -> Generator[str, None, None]:
    """
    针对某条 AI Note bullet，基于 transcript 做 line-level explain（SSE 流式）。
    优先按时间范围（start_sec/end_sec ± 30s 上下文窗口）过滤 segments，
    时间范围缺失时降级为同页过滤。不截断条数。
    并发限制由路由层 live_detailed_note 通过 non-blocking acquire 管理，
    release 在路由层的 gen_and_release() finally 里执行。
    """
    if start_sec is not None and end_sec is not None:
        # 时间范围精准过滤：取 bullet 时间段内及前后 30s 上下文
        window_start = max(0, start_sec - 30)
        window_end = end_sec + 30
        relevant = [
            s for s in segments
            if (s.get("end_ms", 0) / 1000) >= window_start
            and (s.get("start_ms", 0) / 1000) <= window_end
        ]
    elif page_num is not None:
        relevant = [s for s in segments if s.get("assigned_page") == page_num]
    else:
        relevant = segments
    transcript_excerpt = _format_segments(relevant) if relevant else "(no relevant transcript)"

    page_label = f"第{page_num}页" if page_num is not None else "全课"
    user_msg = (
        f"## Note to Explain\n{line_text}\n\n"
        f"## {page_label} Transcript\n{transcript_excerpt}"
    )

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    kwargs = {"base_url": base_url} if base_url else {}
    client = anthropic.Anthropic(api_key=api_key, **kwargs)

    try:
        with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=[{"type": "text", "text": _DETAILED_NOTE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'text': text})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

    yield "data: [DONE]\n\n"
