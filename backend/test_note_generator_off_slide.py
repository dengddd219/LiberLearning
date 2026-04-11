"""
Test: off_slide_segments virtual page injection in generate_notes_for_all_pages().

Run: cd backend && ..\.venv\Scripts\python -m pytest test_note_generator_off_slide.py -v
"""

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent))

import pytest
from services.note_generator import generate_notes_for_all_pages


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_page(page_num, ppt_text="Slide text", off_slide_segments=None):
    page = {
        "page_num": page_num,
        "ppt_text": ppt_text,
        "aligned_segments": [{"start": page_num * 10, "end": page_num * 10 + 8, "text": f"Slide {page_num} speech."}],
        "page_start_time": page_num * 10,
        "page_end_time": page_num * 10 + 9,
        "alignment_confidence": 0.9,
        "page_supplement": None,
    }
    if off_slide_segments is not None:
        page["off_slide_segments"] = off_slide_segments
    return page


FAKE_NOTES = {"bullets": [{"ppt_bullet": "x", "ai_comment": "y", "timestamp_start": 0, "timestamp_end": 1, "transcript_excerpt": "z"}]}

FAKE_API_RESULT = {**FAKE_NOTES, "_usage": {"input_tokens": 10, "output_tokens": 20}}


async def _fake_generate_page(client, model, system_prompt, user_msg, semaphore, page_num, template):
    result = {**FAKE_NOTES, "_usage": {"input_tokens": 10, "output_tokens": 20}}
    return result


# ── Tests ─────────────────────────────────────────────────────────────────────

@patch("services.note_generator._client")
@patch("services.note_generator._generate_page", side_effect=_fake_generate_page)
def test_off_slide_virtual_page_inserted_after_source_page(mock_gen, mock_client):
    """
    A page with off_slide_segments should produce a virtual page immediately after it.
    """
    mock_client.return_value = (MagicMock(), "fake-model")

    off_segs = [
        {"start": 15, "end": 20, "text": "Off-slide content."},
        {"start": 21, "end": 25, "text": "More off-slide."},
    ]
    pages = [
        _make_page(1, off_slide_segments=off_segs),
        _make_page(2),
    ]

    result = asyncio.run(generate_notes_for_all_pages(pages, template="passive_ppt_notes", granularity="simple"))

    # 2 real pages + 1 virtual = 3 total
    assert len(result) == 3

    # The virtual page appears right after page 1
    virtual = result[1]
    assert str(virtual["page_num"]).startswith("1_off") or virtual.get("is_off_slide") is True

    # Virtual page time range derived from off_slide_segments
    assert virtual["page_start_time"] == 15
    assert virtual["page_end_time"] == 25

    # Real page 2 is last
    assert result[2]["page_num"] == 2


@patch("services.note_generator._client")
@patch("services.note_generator._generate_page", side_effect=_fake_generate_page)
def test_virtual_page_ppt_text_is_placeholder(mock_gen, mock_client):
    """Virtual page ppt_text must be the off-slide placeholder string."""
    mock_client.return_value = (MagicMock(), "fake-model")

    off_segs = [{"start": 5, "end": 9, "text": "Teacher at whiteboard."}]
    pages = [_make_page(1, off_slide_segments=off_segs)]

    result = asyncio.run(generate_notes_for_all_pages(pages, template="passive_ppt_notes", granularity="simple"))

    virtual = result[1]
    assert "无对应 PPT" in virtual["ppt_text"]


@patch("services.note_generator._client")
@patch("services.note_generator._generate_page", side_effect=_fake_generate_page)
def test_virtual_page_prompt_contains_off_slide_marker(mock_gen, mock_client):
    """
    The user_msg sent to _generate_page for a virtual page must contain
    the off-slide notice, not normal PPT bullets.
    """
    mock_client.return_value = (MagicMock(), "fake-model")

    off_segs = [{"start": 5, "end": 9, "text": "Whiteboard derivation."}]
    pages = [_make_page(1, off_slide_segments=off_segs)]

    captured_msgs = []

    async def capture_generate(client, model, system_prompt, user_msg, semaphore, page_num, template):
        captured_msgs.append((page_num, user_msg))
        return {**FAKE_NOTES, "_usage": {"input_tokens": 1, "output_tokens": 1}}

    with patch("services.note_generator._generate_page", side_effect=capture_generate):
        asyncio.run(generate_notes_for_all_pages(pages, template="passive_ppt_notes", granularity="simple"))

    # Find the call for the virtual page
    virtual_calls = [(pn, msg) for pn, msg in captured_msgs if str(pn).endswith("_off") or "off" in str(pn)]
    assert len(virtual_calls) == 1
    _, virtual_msg = virtual_calls[0]
    assert "无对应 PPT" in virtual_msg


@patch("services.note_generator._client")
@patch("services.note_generator._generate_page", side_effect=_fake_generate_page)
def test_page_without_off_slide_not_affected(mock_gen, mock_client):
    """Pages without off_slide_segments produce exactly one output page."""
    mock_client.return_value = (MagicMock(), "fake-model")

    pages = [_make_page(1), _make_page(2), _make_page(3)]
    result = asyncio.run(generate_notes_for_all_pages(pages, template="passive_ppt_notes", granularity="simple"))

    assert len(result) == 3
    assert [r["page_num"] for r in result] == [1, 2, 3]


@patch("services.note_generator._client")
@patch("services.note_generator._generate_page", side_effect=_fake_generate_page)
def test_virtual_page_aligned_segments_are_off_slide_segments(mock_gen, mock_client):
    """Virtual page's aligned_segments must equal the source page's off_slide_segments."""
    mock_client.return_value = (MagicMock(), "fake-model")

    off_segs = [{"start": 5, "end": 9, "text": "Off-slide."}, {"start": 10, "end": 14, "text": "Still off."}]
    pages = [_make_page(1, off_slide_segments=off_segs)]

    result = asyncio.run(generate_notes_for_all_pages(pages, template="passive_ppt_notes", granularity="simple"))

    virtual = result[1]
    assert virtual["aligned_segments"] == off_segs


@patch("services.note_generator._client")
@patch("services.note_generator._generate_page", side_effect=_fake_generate_page)
def test_source_page_supplement_unchanged(mock_gen, mock_client):
    """page_supplement on the source page is untouched after virtual page injection."""
    mock_client.return_value = (MagicMock(), "fake-model")

    off_segs = [{"start": 5, "end": 9, "text": "Off-slide."}]
    pages = [_make_page(1, off_slide_segments=off_segs)]
    pages[0]["page_supplement"] = {"extra": "data"}

    result = asyncio.run(generate_notes_for_all_pages(pages, template="passive_ppt_notes", granularity="simple"))

    assert result[0]["page_supplement"] == {"extra": "data"}
