"""
LLM note generation service.
Uses Claude API (claude-sonnet-4-6) to generate structured notes per PPT page.

Output format (bullet-level, with transcript anchoring):
  Each bullet = { ppt_bullet, ai_comment, timestamp_start, timestamp_end, transcript_excerpt }

Two learning modes:
  - Passive (all pages): PPT bullet + transcript → per-bullet annotation + timestamps
  - Active (pages with user notes): user note + transcript → AI expansion

Templates (from backend/prompts/):
  passive_ppt_notes       → Template ② 全PPT讲解笔记
  passive_outline_summary → Template ④ 大纲摘要
  active_expand           → Template ① 基于我的笔记扩写
  active_comprehensive    → Template ③ 完整综合笔记

Fault tolerance:
  - Per-page independent calls
  - Up to 3 retries per page
  - Concurrency capped at MAX_CONCURRENT (5)
"""

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

import anthropic
from anthropic.types import TextBlock
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

MAX_CONCURRENT = 5
MAX_RETRIES = 3
DEFAULT_MODEL = "claude-sonnet-4-6"

# Supported provider names shown in the UI
PROVIDER_ZHONGZHUAN = "中转站"
PROVIDER_ZHIZENGZENG = "智增增"
PROVIDERS = [PROVIDER_ZHONGZHUAN, PROVIDER_ZHIZENGZENG]

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# Template routing: which templates are passive vs active
PASSIVE_TEMPLATES = {"passive_ppt_notes", "passive_outline_summary"}
ACTIVE_TEMPLATES = {"active_expand", "active_comprehensive"}

OFF_SLIDE_PPT_TEXT = "（本段内容无对应 PPT）"
OFF_SLIDE_PROMPT_HEADER = "（本段内容无对应 PPT，以下为老师脱离 PPT 讲解的内容）"


# ---------------------------------------------------------------------------
# Phase 1: Pydantic Data Contracts
# ---------------------------------------------------------------------------

class AlignedSegment(BaseModel):
    text: str = ""
    start: float = 0.0
    end: float = 0.0

    model_config = {"extra": "allow"}


class ActiveNoteInput(BaseModel):
    user_note: Optional[str] = None

    model_config = {"extra": "allow"}


class PageData(BaseModel):
    """Normalised view of one aligned page coming into the note generator."""
    page_num: Any  # int or str like "3_off"
    ppt_text: str = ""
    aligned_segments: list[AlignedSegment] = Field(default_factory=list)
    page_supplement: Optional[Any] = None
    page_start_time: float = 0.0
    page_end_time: float = 0.0
    alignment_confidence: float = 0.0
    pdf_url: str = ""
    pdf_page_num: Any = None
    active_notes: Optional[ActiveNoteInput] = None
    # off-slide segments attached to this real page (triggers virtual page insertion)
    off_slide_segments: list[AlignedSegment] = Field(default_factory=list)
    is_off_slide: bool = False

    @field_validator("aligned_segments", "off_slide_segments", mode="before")
    @classmethod
    def _coerce_segments(cls, v):
        if v is None:
            return []
        return v

    @field_validator("active_notes", mode="before")
    @classmethod
    def _coerce_active_notes(cls, v):
        if v is None:
            return None
        if isinstance(v, dict):
            return ActiveNoteInput(**v)
        return v

    @property
    def user_note(self) -> Optional[str]:
        return self.active_notes.user_note if self.active_notes else None

    def as_virtual_off_slide(self) -> "PageData":
        """Create the virtual off-slide page that follows this real page."""
        segs = self.off_slide_segments
        start = min((s.start for s in segs), default=0.0)
        end = max((s.end for s in segs), default=0.0)
        return PageData(
            page_num=f"{self.page_num}_off",
            is_off_slide=True,
            ppt_text=OFF_SLIDE_PPT_TEXT,
            aligned_segments=segs,
            page_start_time=start,
            page_end_time=end,
            alignment_confidence=0.0,
            page_supplement=None,
            pdf_url=self.pdf_url,
            pdf_page_num=self.pdf_page_num if self.pdf_page_num is not None else self.page_num,
            active_notes=None,
        )


class LLMTask(BaseModel):
    """One prepared LLM call ready for execution."""
    page: PageData
    system_prompt: str
    user_msg: str
    template: str


# ---------------------------------------------------------------------------
# Phase 2: Native Async Clients
# ---------------------------------------------------------------------------

def _get_async_call_fn(provider: str):
    """Return (async_call_fn, model).

    async_call_fn(system, user_msg) -> (text, input_tokens, output_tokens)
    """
    model = os.environ.get("ANTHROPIC_MODEL", "").strip() or DEFAULT_MODEL

    if provider == PROVIDER_ZHIZENGZENG:
        import openai as _openai
        api_key = os.environ.get("OPENAI_API_KEY", "")
        base_url = os.environ.get("OPENAI_BASE_URL", "").strip() or None
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set. Add it to backend/.env")
        client = _openai.AsyncOpenAI(api_key=api_key, base_url=base_url)

        async def call_fn(system: str, user_msg: str):
            resp = await client.chat.completions.create(
                model=model,
                max_tokens=2048,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_msg},
                ],
            )
            text = resp.choices[0].message.content or ""
            usage = resp.usage
            return text, usage.prompt_tokens, usage.completion_tokens

        return call_fn, model

    else:  # 中转站 (default)
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key or api_key.startswith("sk-ant-xxx"):
            raise RuntimeError(
                "ANTHROPIC_API_KEY not set or is placeholder. "
                "Add a real key to backend/.env"
            )
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
        kwargs = {"base_url": base_url} if base_url else {}
        client = anthropic.AsyncAnthropic(api_key=api_key, **kwargs)

        async def call_fn(system: str, user_msg: str):
            resp = await client.messages.create(
                model=model,
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
            text_blocks = [b for b in resp.content if isinstance(b, TextBlock)]
            text = text_blocks[0].text if text_blocks else ""
            return text, resp.usage.input_tokens, resp.usage.output_tokens

        return call_fn, model


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_prompt(template: str, granularity: str) -> str:
    """Load system prompt from prompts/<template>.md, extract SIMPLE or DETAILED section."""
    prompt_file = PROMPTS_DIR / f"{template}.md"
    if not prompt_file.exists():
        raise FileNotFoundError(
            f"Prompt file not found: {prompt_file}. "
            f"Valid templates: passive_ppt_notes, passive_outline_summary, "
            f"active_expand, active_comprehensive"
        )
    text = prompt_file.read_text(encoding="utf-8")

    tag = "## SIMPLE" if granularity == "simple" else "## DETAILED"
    idx = text.find(tag)
    if idx == -1:
        raise ValueError(f"Section '{tag}' not found in {prompt_file}")

    content_start = idx + len(tag)
    next_heading = text.find("\n## ", content_start)
    section = text[content_start:next_heading] if next_heading != -1 else text[content_start:]
    return section.strip()


def _format_segments(segments: list[AlignedSegment]) -> str:
    """Format aligned segments into a readable transcript block."""
    lines = []
    for seg in segments:
        ts_start = int(seg.start)
        ts_end = int(seg.end)
        mm_s, ss_s = divmod(ts_start, 60)
        mm_e, ss_e = divmod(ts_end, 60)
        lines.append(f"[{mm_s:02d}:{ss_s:02d}–{mm_e:02d}:{ss_e:02d}] {seg.text}")
    return "\n".join(lines) or "(no transcript for this page)"


def _format_ppt_bullets(ppt_text: str) -> str:
    """Format PPT text as numbered bullet list for the prompt."""
    lines = [l.strip() for l in ppt_text.splitlines() if l.strip()]
    if not lines:
        return "(no bullet points on this slide)"
    return "\n".join(f"{i+1}. {line}" for i, line in enumerate(lines))


# ---------------------------------------------------------------------------
# Phase 4: Robust JSON extraction
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> dict:
    """
    Extract first JSON object from model output.
    Handles raw JSON and Markdown code fences (```json ... ``` or ``` ... ```).
    Returns a dict; raises ValueError if parsing fails entirely.
    """
    # Strip Markdown code fences first
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    candidate = fence_match.group(1).strip() if fence_match else text

    # Find the outermost JSON object
    obj_match = re.search(r"\{[\s\S]*\}", candidate)
    if not obj_match:
        # Fallback: try raw text
        obj_match = re.search(r"\{[\s\S]*\}", text)
    if not obj_match:
        raise ValueError(f"No JSON object found in model output:\n{text[:300]}")

    return json.loads(obj_match.group())


def _safe_extract_json(text: str, page_num: Any, template: str) -> dict:
    """Wrapper that returns a degraded-but-safe dict on parse failure."""
    try:
        return _extract_json(text)
    except Exception as e:
        logger.error("JSON parse failed for page %s (template=%s): %s", page_num, template, e)
        return {
            "status": "failed",
            "error": str(e),
            "bullets": [],
            "ai_expansion": "",
        }


# ---------------------------------------------------------------------------
# Phase 3: Pipeline stages
# ---------------------------------------------------------------------------

def _prepare_tasks(
    pages: list[PageData],
    system_prompt: str,
    template: str,
    is_passive: bool,
) -> tuple[list[LLMTask], list[PageData]]:
    """
    Stage 1: Expand off-slide virtual pages and build the list of LLM tasks.
    No network calls here — pure data transformation.

    Returns:
        (tasks, expanded_pages) — expanded_pages is the authoritative flat list
        that _parse_and_merge must receive; never rebuild it separately.
    """
    tasks: list[LLMTask] = []
    expanded_pages: list[PageData] = []

    for page in pages:
        expanded_pages.append(page)
        pages_to_process: list[PageData] = [page]
        if page.off_slide_segments:
            virtual = page.as_virtual_off_slide()
            expanded_pages.append(virtual)
            pages_to_process.append(virtual)

        for p in pages_to_process:
            if p.is_off_slide:
                ppt_bullets = OFF_SLIDE_PROMPT_HEADER
            else:
                ppt_bullets = _format_ppt_bullets(p.ppt_text or "(no slide text)")

            transcript = _format_segments(p.aligned_segments)

            if is_passive:
                user_msg = (
                    f"## PPT Bullet Points\n{ppt_bullets}\n\n"
                    f"## Transcript\n{transcript}"
                )
                tasks.append(LLMTask(
                    page=p,
                    system_prompt=system_prompt,
                    user_msg=user_msg,
                    template=template,
                ))
            else:
                # Active: only emit a task if the page has a user note
                user_note = p.user_note
                if user_note:
                    user_msg = (
                        f"## PPT Bullet Points\n{ppt_bullets}\n\n"
                        f"## Student's Note\n{user_note}\n\n"
                        f"## Transcript\n{transcript}"
                    )
                    tasks.append(LLMTask(
                        page=p,
                        system_prompt=system_prompt,
                        user_msg=user_msg,
                        template=template,
                    ))

    return tasks, expanded_pages


async def _execute_llm_batch(
    tasks: list[LLMTask],
    call_fn,
    semaphore: asyncio.Semaphore,
) -> list[tuple[LLMTask, dict, dict]]:
    """
    Stage 2: Pure concurrent network layer.
    Returns list of (task, parsed_data, usage) tuples.
    No business logic — only retry + concurrency control.
    """
    async def _call_one(task: LLMTask) -> tuple[LLMTask, dict, dict]:
        last_err = None
        for attempt in range(MAX_RETRIES):
            try:
                async with semaphore:
                    text, in_tok, out_tok = await call_fn(
                        task.system_prompt, task.user_msg
                    )
                data = _safe_extract_json(text, task.page.page_num, task.template)
                usage = {"input_tokens": in_tok, "output_tokens": out_tok}
                return task, data, usage
            except Exception as e:
                last_err = e
                logger.warning(
                    "LLM call failed (attempt %d/%d) for page %s: %s",
                    attempt + 1, MAX_RETRIES, task.page.page_num, e,
                )
                await asyncio.sleep(2 ** attempt)

        # All retries exhausted — return a failed sentinel instead of raising
        logger.error(
            "All %d retries exhausted for page %s (template=%s): %s",
            MAX_RETRIES, task.page.page_num, task.template, last_err,
        )
        failed_data = {
            "status": "failed",
            "error": str(last_err),
            "bullets": [],
            "ai_expansion": "",
        }
        return task, failed_data, {"input_tokens": 0, "output_tokens": 0}

    return list(await asyncio.gather(*[_call_one(t) for t in tasks]))


def _parse_and_merge(
    all_pages: list[PageData],
    results: list[tuple[LLMTask, dict, dict]],
    is_passive: bool,
) -> list[dict]:
    """
    Stage 3: Stitch LLM results back onto the page list.
    Pages without an LLM result (no user note for active, etc.) get defaults.
    """
    # Index results by page_num for O(1) lookup
    result_by_page: dict[Any, tuple[dict, dict]] = {}
    for task, data, usage in results:
        result_by_page[task.page.page_num] = (data, usage)

    output: list[dict] = []
    for page in all_pages:
        data, usage = result_by_page.get(page.page_num, ({}, {}))
        is_failed = data.get("status") == "failed"

        pdf_page_num = page.pdf_page_num if page.pdf_page_num is not None else page.page_num
        ppt_text = page.ppt_text if not page.is_off_slide else OFF_SLIDE_PPT_TEXT

        record: dict = {
            "page_num": page.page_num,
            "is_off_slide": page.is_off_slide,
            "pdf_url": page.pdf_url,
            "pdf_page_num": pdf_page_num,
            "ppt_text": ppt_text,
            "aligned_segments": [s.model_dump() for s in page.aligned_segments],
            "page_start_time": page.page_start_time,
            "page_end_time": page.page_end_time,
            "alignment_confidence": page.alignment_confidence,
            "page_supplement": page.page_supplement,
            "passive_notes": None,
            "active_notes": None,
            "status": "partial_ready" if is_failed else "ready",
            "_cost": usage or {"input_tokens": 0, "output_tokens": 0},
        }

        if is_passive:
            if data:
                clean = {k: v for k, v in data.items() if k not in ("status",)}
                record["passive_notes"] = clean if not is_failed else {"error": data.get("error"), "bullets": []}
            else:
                record["passive_notes"] = {"bullets": []}
        else:
            user_note = page.user_note
            if data and user_note:
                if is_failed:
                    record["active_notes"] = {
                        "user_note": user_note,
                        "ai_expansion": "",
                        "error": data.get("error"),
                    }
                    record["status"] = "partial_ready"
                else:
                    record["active_notes"] = {"user_note": user_note, **data}

        output.append(record)

    return output


# ---------------------------------------------------------------------------
# Public API (backward-compatible signatures)
# ---------------------------------------------------------------------------

async def generate_notes_for_all_pages(
    pages: list[dict],
    template: str = "passive_ppt_notes",
    granularity: str = "simple",
    provider: str = PROVIDER_ZHONGZHUAN,
) -> list[dict]:
    """
    Generate notes for every page concurrently using the specified template.

    Args:
        pages: list of page dicts with keys:
               page_num, ppt_text, aligned_segments, page_supplement,
               (optional) active_notes.user_note
        template: one of passive_ppt_notes | passive_outline_summary |
                  active_expand | active_comprehensive
        granularity: "simple" | "detailed"
        provider: "中转站" (Anthropic SDK) | "智增增" (OpenAI-compat SDK)

    Returns:
        Augmented page list. Each page dict gains:
          - passive_notes: {bullets: [...], page_summary?: str}  (passive templates)
          - active_notes:  {user_note, ai_expansion, timestamp_start, timestamp_end}
                           (active templates, only if user_note present)
          - status: "ready" | "partial_ready"
          - _cost: {input_tokens, output_tokens}
    """
    system_prompt = _load_prompt(template, granularity)
    call_fn, _model = _get_async_call_fn(provider)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    is_passive = template in PASSIVE_TEMPLATES

    # Parse raw dicts into typed models
    typed_pages = [PageData.model_validate(p) for p in pages]

    # Stage 1: expand virtual off-slide pages + build task list
    # expanded_pages is the single authoritative flat list; no second expansion needed.
    tasks, expanded_pages = _prepare_tasks(typed_pages, system_prompt, template, is_passive)

    # Stage 2: concurrent LLM calls
    results = await _execute_llm_batch(tasks, call_fn, semaphore)

    # Stage 3: stitch results back
    return _parse_and_merge(expanded_pages, results, is_passive)


async def generate_annotations(
    page: dict,
    annotations: list[dict],
    template: str = "active_expand",
    granularity: str = "simple",
    provider: str = PROVIDER_ZHONGZHUAN,
) -> dict:
    """
    For each annotation on a page, call Claude to generate ai_expansion.

    Args:
        page: page dict with page_num, ppt_text, aligned_segments
        annotations: list of {"text": str, "x": float, "y": float}
        template: active template name
        granularity: "simple" | "detailed"
        provider: "中转站" (Anthropic SDK) | "智增增" (OpenAI-compat SDK)

    Returns:
        {
            "page_num": <int>,
            "annotations": [{"text", "x", "y", "ai_expansion"}, ...],
            "_cost": {"input_tokens": int, "output_tokens": int}
        }
    """
    system_prompt = _load_prompt(template, granularity)
    call_fn, _model = _get_async_call_fn(provider)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    typed_page = PageData.model_validate(page)
    page_num = typed_page.page_num
    ppt_bullets = _format_ppt_bullets(typed_page.ppt_text or "(no slide text)")
    transcript = _format_segments(typed_page.aligned_segments)

    total_input = 0
    total_output = 0
    results = []

    # Build one LLMTask per annotation (skip empty ones)
    ann_tasks: list[tuple[dict, LLMTask | None]] = []
    for ann in annotations:
        user_note = (ann.get("text") or "").strip()
        if not user_note:
            ann_tasks.append((ann, None))
            continue
        user_msg = (
            f"## PPT Bullet Points\n{ppt_bullets}\n\n"
            f"## Student's Note\n{user_note}\n\n"
            f"## Transcript\n{transcript}"
        )
        task = LLMTask(
            page=typed_page,
            system_prompt=system_prompt,
            user_msg=user_msg,
            template=template,
        )
        ann_tasks.append((ann, task))

    # Run non-None tasks through the shared batch layer (gets MAX_RETRIES for free)
    non_empty_tasks = [t for _, t in ann_tasks if t is not None]
    batch_results: dict[int, tuple[dict, dict]] = {}
    if non_empty_tasks:
        raw = await _execute_llm_batch(non_empty_tasks, call_fn, semaphore)
        # Index by task object id so we can match back
        task_to_result = {id(task): (data, usage) for task, data, usage in raw}
        for ann, task in ann_tasks:
            if task is None:
                continue
            data, usage = task_to_result[id(task)]
            batch_results[id(task)] = (data, usage)

    for ann, task in ann_tasks:
        if task is None:
            results.append({**ann, "ai_expansion": ""})
            continue
        data, usage = batch_results[id(task)]
        total_input += usage.get("input_tokens", 0)
        total_output += usage.get("output_tokens", 0)
        if data.get("status") == "failed":
            ai_expansion = f"[Error: {data.get('error', 'unknown')}]"
        else:
            ai_expansion = data.get("ai_expansion") or data.get("content") or str(data)
        results.append({**ann, "ai_expansion": ai_expansion})

    return {
        "page_num": page_num,
        "annotations": results,
        "_cost": {"input_tokens": total_input, "output_tokens": total_output},
    }
