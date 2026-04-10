"""
LLM-as-a-Judge note quality scoring.
Rates AI-generated notes on 3 dimensions (1-5):
  completeness, accuracy, readability
Uses Claude (haiku for cost, or sonnet for quality).
"""

import asyncio
import json
import os
import re
import time
from typing import Optional

import anthropic

MAX_CONCURRENT = 5
MAX_RETRIES = 2

JUDGE_SYSTEM = """You are a study-notes quality assessor. Rate the AI-generated notes on 3 dimensions (1-5 scale):

1. **Completeness**: Does the note cover the teacher's key points from the transcript? Are important topics missing?
2. **Accuracy**: Is the note grounded in the transcript? Any hallucination or fabricated content?
3. **Readability**: Is the note well-structured, concise, and easy to follow?

Output ONLY valid JSON:
{"completeness": <1-5>, "accuracy": <1-5>, "readability": <1-5>, "reason": "<brief explanation, under 50 words>"}
"""


def _client() -> tuple[anthropic.Anthropic, str]:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or api_key.startswith("sk-ant-xxx"):
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    # Use the configured model (same as note gen)
    model = os.environ.get("ANTHROPIC_MODEL", "").strip() or "claude-sonnet-4-6"
    client = anthropic.Anthropic(
        api_key=api_key,
        **({"base_url": base_url} if base_url else {}),
    )
    return client, model


def _format_notes_for_judge(notes_data: dict) -> str:
    """Format the generated notes into a readable string for the judge."""
    parts = []
    passive = notes_data.get("passive_notes")
    if passive and not passive.get("error"):
        for b in passive.get("bullets", []):
            ppt_b = b.get("ppt_bullet", "")
            comment = b.get("ai_comment", "")
            parts.append(f"- {ppt_b}: {comment}")
        if passive.get("page_summary"):
            parts.append(f"Summary: {passive['page_summary']}")

    active = notes_data.get("active_notes")
    if active and active.get("ai_expansion"):
        parts.append(f"Expansion: {active['ai_expansion']}")

    return "\n".join(parts) or "(empty notes)"


def _format_transcript(segments: list[dict]) -> str:
    lines = []
    for seg in segments:
        ts = int(seg.get("start", 0))
        lines.append(f"[{ts//60:02d}:{ts%60:02d}] {seg['text']}")
    return "\n".join(lines) or "(no transcript)"


async def judge_page(
    page: dict,
    client: anthropic.Anthropic,
    model: str,
    semaphore: asyncio.Semaphore,
) -> dict:
    """Score one page's notes. Returns {completeness, accuracy, readability, reason, _usage}."""
    ppt_text = page.get("ppt_text", "") or "(no slide text)"
    transcript = _format_transcript(page.get("aligned_segments", []))
    notes_str = _format_notes_for_judge(page)

    user_msg = (
        f"## PPT Slide Text\n{ppt_text}\n\n"
        f"## Teacher's Transcript\n{transcript}\n\n"
        f"## AI-Generated Notes\n{notes_str}"
    )

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            async with semaphore:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: client.messages.create(
                        model=model,
                        max_tokens=256,
                        system=JUDGE_SYSTEM,
                        messages=[{"role": "user", "content": user_msg}],
                    ),
                )
            text = response.content[0].text
            match = re.search(r"\{[\s\S]*\}", text)
            if not match:
                raise ValueError(f"No JSON in judge response: {text[:200]}")
            result = json.loads(match.group())
            result["_usage"] = {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            }
            return result
        except Exception as e:
            last_err = e
            await asyncio.sleep(2 ** attempt)

    return {
        "completeness": 0, "accuracy": 0, "readability": 0,
        "reason": f"Judge failed: {last_err}",
        "_usage": {"input_tokens": 0, "output_tokens": 0},
    }


async def judge_all_pages(pages_with_notes: list[dict]) -> list[dict]:
    """
    Score all pages concurrently.
    Each page dict should have: ppt_text, aligned_segments, passive_notes/active_notes.
    Returns list of score dicts (same order as input).
    """
    client, model = _client()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    tasks = [judge_page(p, client, model, semaphore) for p in pages_with_notes]
    return await asyncio.gather(*tasks)
