"""
LLM note generation service.
Uses Claude API (claude-sonnet-4-6) to generate structured notes per PPT page.

Two learning modes:
  - Passive (all pages): PPT bullet + transcript → line-level comments + timestamps
  - Active (pages with user notes): user note + transcript → AI expansion

Fault tolerance:
  - Per-page independent calls
  - Up to 3 retries per page
  - Concurrency capped at MAX_CONCURRENT (5)
"""

import asyncio
import json
import os
import re
from typing import Optional

import anthropic

MAX_CONCURRENT = 5
MAX_RETRIES = 3

PASSIVE_SYSTEM = """You are a study assistant that helps students understand lecture content.
Given a PPT slide text and the teacher's spoken transcript for that slide, produce structured study notes.

Output ONLY valid JSON in this exact format:
{
  "bullets": [
    {
      "text": "concise key point extracted from the transcript (1-2 sentences)",
      "ai_comment": "clarification, analogy, or deeper explanation (1-3 sentences)",
      "timestamp": <seconds as integer, from the segment start>
    }
  ]
}

Rules:
- Extract 2-5 key points per page. Do not pad.
- Match each bullet to the closest transcript timestamp.
- Write in the same language as the transcript.
- If the transcript adds nothing to the PPT text, set bullets to [].
"""

ACTIVE_SYSTEM = """You are a study assistant that expands a student's handwritten notes using the lecture transcript.

Output ONLY valid JSON in this exact format:
{
  "ai_expansion": "multi-paragraph expansion of the student's note using the transcript. Use markdown bold for key terms."
}

Rules:
- Preserve the student's original phrasing/intent.
- Add context, examples, and explanations from the transcript.
- Write in the same language as the transcript.
- 150-400 words.
"""


def _client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or api_key.startswith("sk-ant-xxx"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set or is placeholder. "
            "Add a real key to backend/.env"
        )
    return anthropic.Anthropic(api_key=api_key)


def _format_segments(segments: list[dict]) -> str:
    """Format aligned segments into a readable transcript block."""
    lines = []
    for seg in segments:
        ts = int(seg.get("start", 0))
        mm, ss = divmod(ts, 60)
        lines.append(f"[{mm:02d}:{ss:02d}] {seg['text']}")
    return "\n".join(lines) or "(no transcript for this page)"


def _extract_json(text: str) -> dict:
    """Extract first JSON object from model output."""
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError(f"No JSON found in model output:\n{text[:300]}")
    return json.loads(match.group())


async def _generate_passive(
    client: anthropic.Anthropic,
    page: dict,
    semaphore: asyncio.Semaphore,
) -> dict:
    """Generate passive (all-page) notes for one page with retries."""
    ppt_text = page.get("ppt_text", "") or "(no slide text)"
    transcript = _format_segments(page.get("aligned_segments", []))

    user_msg = (
        f"## Slide Text\n{ppt_text}\n\n"
        f"## Transcript\n{transcript}"
    )

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            async with semaphore:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: client.messages.create(
                        model="claude-sonnet-4-6",
                        max_tokens=1024,
                        system=PASSIVE_SYSTEM,
                        messages=[{"role": "user", "content": user_msg}],
                    ),
                )
            text = response.content[0].text
            return _extract_json(text)
        except Exception as e:
            last_err = e
            await asyncio.sleep(2 ** attempt)  # exponential back-off

    raise RuntimeError(
        f"Passive note generation failed after {MAX_RETRIES} retries "
        f"for page {page.get('page_num')}: {last_err}"
    )


async def _generate_active(
    client: anthropic.Anthropic,
    page: dict,
    user_note: str,
    semaphore: asyncio.Semaphore,
) -> dict:
    """Generate active (user-note-based) expansion for one page with retries."""
    transcript = _format_segments(page.get("aligned_segments", []))

    user_msg = (
        f"## Student's Note\n{user_note}\n\n"
        f"## Transcript\n{transcript}"
    )

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            async with semaphore:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: client.messages.create(
                        model="claude-sonnet-4-6",
                        max_tokens=1024,
                        system=ACTIVE_SYSTEM,
                        messages=[{"role": "user", "content": user_msg}],
                    ),
                )
            text = response.content[0].text
            return _extract_json(text)
        except Exception as e:
            last_err = e
            await asyncio.sleep(2 ** attempt)

    raise RuntimeError(
        f"Active note generation failed after {MAX_RETRIES} retries "
        f"for page {page.get('page_num')}: {last_err}"
    )


async def generate_notes_for_all_pages(
    pages: list[dict],
) -> list[dict]:
    """
    Generate both passive and active notes for every page concurrently.
    Pages where generation fails are marked with status='partial_ready'.

    Each input page dict should have:
      - page_num, ppt_text, aligned_segments, page_supplement
      - (optional) active_notes.user_note if the user wrote a note

    Returns an augmented list matching the session API response format.
    """
    client = _client()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def process_page(page: dict) -> dict:
        result = {
            "page_num": page["page_num"],
            "slide_image_url": page.get("slide_image_url", ""),
            "ppt_text": page.get("ppt_text", ""),
            "page_start_time": page.get("page_start_time", 0),
            "page_end_time": page.get("page_end_time", 0),
            "alignment_confidence": page.get("alignment_confidence", 0.0),
            "page_supplement": page.get("page_supplement"),
            "active_notes": None,
            "passive_notes": None,
            "status": "ready",
        }

        # Passive notes (always)
        try:
            passive = await _generate_passive(client, page, semaphore)
            result["passive_notes"] = passive
        except Exception as e:
            result["status"] = "partial_ready"
            result["passive_notes"] = {"error": str(e), "bullets": []}

        # Active notes (only if user wrote a note for this page)
        user_note: Optional[str] = (
            (page.get("active_notes") or {}).get("user_note")
        )
        if user_note:
            try:
                active = await _generate_active(client, page, user_note, semaphore)
                result["active_notes"] = {
                    "user_note": user_note,
                    "ai_expansion": active.get("ai_expansion", ""),
                }
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
