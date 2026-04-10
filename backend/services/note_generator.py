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
import os
import re
from pathlib import Path
from typing import Optional

import anthropic

MAX_CONCURRENT = 5
MAX_RETRIES = 3
DEFAULT_MODEL = "claude-sonnet-4-6"

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# Template routing: which templates are passive vs active
PASSIVE_TEMPLATES = {"passive_ppt_notes", "passive_outline_summary"}
ACTIVE_TEMPLATES = {"active_expand", "active_comprehensive"}


def _load_prompt(template: str, granularity: str) -> str:
    """
    Load system prompt from prompts/<template>.md.
    Extracts the ## SIMPLE or ## DETAILED section.
    """
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

    # Extract from tag to next ## heading or end of file
    content_start = idx + len(tag)
    next_heading = text.find("\n## ", content_start)
    if next_heading != -1:
        section = text[content_start:next_heading]
    else:
        section = text[content_start:]

    return section.strip()


def _client() -> tuple[anthropic.Anthropic, str]:
    """Return (client, model_name) using env-configured key, base URL, and model."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or api_key.startswith("sk-ant-xxx"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set or is placeholder. "
            "Add a real key to backend/.env"
        )
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    model = os.environ.get("ANTHROPIC_MODEL", "").strip() or DEFAULT_MODEL

    client = anthropic.Anthropic(
        api_key=api_key,
        **({"base_url": base_url} if base_url else {}),
    )
    return client, model


def _format_segments(segments: list[dict]) -> str:
    """Format aligned segments into a readable transcript block."""
    lines = []
    for seg in segments:
        ts_start = int(seg.get("start", 0))
        ts_end = int(seg.get("end", ts_start))
        mm_s, ss_s = divmod(ts_start, 60)
        mm_e, ss_e = divmod(ts_end, 60)
        lines.append(f"[{mm_s:02d}:{ss_s:02d}–{mm_e:02d}:{ss_e:02d}] {seg['text']}")
    return "\n".join(lines) or "(no transcript for this page)"


def _format_ppt_bullets(ppt_text: str) -> str:
    """Format PPT text as numbered bullet list for the prompt."""
    lines = [l.strip() for l in ppt_text.splitlines() if l.strip()]
    if not lines:
        return "(no bullet points on this slide)"
    return "\n".join(f"{i+1}. {line}" for i, line in enumerate(lines))


def _extract_json(text: str) -> dict:
    """Extract first JSON object from model output."""
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError(f"No JSON found in model output:\n{text[:300]}")
    return json.loads(match.group())


async def _generate_page(
    client: anthropic.Anthropic,
    model: str,
    system_prompt: str,
    user_msg: str,
    semaphore: asyncio.Semaphore,
    page_num: int,
    template: str,
) -> dict:
    """Call Claude for one page with retries. Returns parsed JSON dict."""
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            async with semaphore:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: client.messages.create(
                        model=model,
                        max_tokens=2048,
                        system=system_prompt,
                        messages=[{"role": "user", "content": user_msg}],
                    ),
                )
            text = response.content[0].text
            result = _extract_json(text)
            # Attach token usage for cost tracking
            result["_usage"] = {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            }
            return result
        except Exception as e:
            last_err = e
            await asyncio.sleep(2 ** attempt)

    raise RuntimeError(
        f"Note generation failed after {MAX_RETRIES} retries "
        f"for page {page_num} (template={template}): {last_err}"
    )


async def generate_notes_for_all_pages(
    pages: list[dict],
    template: str = "passive_ppt_notes",
    granularity: str = "simple",
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

    Returns:
        Augmented page list. Each page dict gains:
          - passive_notes: {bullets: [...], page_summary?: str}  (passive templates)
          - active_notes:  {user_note, ai_expansion, timestamp_start, timestamp_end}
                           (active templates, only if user_note present)
          - status: "ready" | "partial_ready"
          - _cost: {input_tokens, output_tokens}
    """
    system_prompt = _load_prompt(template, granularity)
    client, model = _client()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    is_passive = template in PASSIVE_TEMPLATES

    async def process_page(page: dict) -> dict:
        page_num = page["page_num"]
        ppt_text = page.get("ppt_text", "") or "(no slide text)"
        transcript = _format_segments(page.get("aligned_segments", []))
        ppt_bullets = _format_ppt_bullets(ppt_text)

        result = {
            "page_num": page_num,
            "slide_image_url": page.get("slide_image_url", ""),
            "ppt_text": ppt_text,
            "page_start_time": page.get("page_start_time", 0),
            "page_end_time": page.get("page_end_time", 0),
            "alignment_confidence": page.get("alignment_confidence", 0.0),
            "page_supplement": page.get("page_supplement"),
            "passive_notes": None,
            "active_notes": None,
            "status": "ready",
            "_cost": {"input_tokens": 0, "output_tokens": 0},
        }

        if is_passive:
            user_msg = (
                f"## PPT Bullet Points\n{ppt_bullets}\n\n"
                f"## Transcript\n{transcript}"
            )
            try:
                data = await _generate_page(
                    client, model, system_prompt, user_msg,
                    semaphore, page_num, template,
                )
                usage = data.pop("_usage", {})
                result["passive_notes"] = data
                result["_cost"] = usage
            except Exception as e:
                result["status"] = "partial_ready"
                result["passive_notes"] = {"error": str(e), "bullets": []}

        else:
            # Active template — only run if user wrote a note
            user_note: Optional[str] = (
                (page.get("active_notes") or {}).get("user_note")
            )
            if user_note:
                user_msg = (
                    f"## PPT Bullet Points\n{ppt_bullets}\n\n"
                    f"## Student's Note\n{user_note}\n\n"
                    f"## Transcript\n{transcript}"
                )
                try:
                    data = await _generate_page(
                        client, model, system_prompt, user_msg,
                        semaphore, page_num, template,
                    )
                    usage = data.pop("_usage", {})
                    result["active_notes"] = {
                        "user_note": user_note,
                        **data,
                    }
                    result["_cost"] = usage
                except Exception as e:
                    result["status"] = "partial_ready"
                    result["active_notes"] = {
                        "user_note": user_note,
                        "ai_expansion": "",
                        "error": str(e),
                    }

        return result

    tasks = [process_page(p) for p in pages]
    return await asyncio.gather(*tasks)
