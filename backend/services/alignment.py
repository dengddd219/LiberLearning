"""
Semantic alignment service — Production (based on V2 / D-004).
K=3 debounce state machine + user anchor constraints.

Maps ASR transcript segments to PPT pages using embedding cosine similarity,
producing a per-page timeline with confidence scores.
"""

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# Similarity threshold below which a segment is considered "off-slide"
OFF_SLIDE_THRESHOLD = 0.30
# Minimum confidence to suppress the warning in the UI
LOW_CONFIDENCE_THRESHOLD = 0.60
# Number of consecutive segments required to trigger a page switch
PAGE_SWITCH_K = 3
# Cosine similarity threshold for upgrading an off-slide segment
OFF_SLIDE_UPGRADE_THRESHOLD = 0.60


def _get_client() -> tuple[OpenAI, str]:
    """Return (client, embedding_model) using env-configured key, base URL, and model."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("sk-xxx"):
        raise RuntimeError(
            "OPENAI_API_KEY not set. Add a real key to backend/.env"
        )
    base_url = os.environ.get("OPENAI_BASE_URL", "").strip() or None
    model = os.environ.get("OPENAI_EMBEDDING_MODEL", "").strip() or "text-embedding-3-small"
    client = OpenAI(
        api_key=api_key,
        **({"base_url": base_url} if base_url else {}),
    )
    return client, model


def _embed_texts(texts: list[str], client: OpenAI, model: str) -> np.ndarray:
    """
    Batch-embed a list of texts.
    Returns an (N, D) float32 numpy array.
    """
    response = client.embeddings.create(
        model=model,
        input=texts,
    )
    vectors = [item.embedding for item in response.data]
    return np.array(vectors, dtype=np.float32)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """
    Compute cosine similarity between each row of a and each row of b.
    Returns an (len(a), len(b)) matrix.
    """
    a_norm = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)
    b_norm = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-8)
    return a_norm @ b_norm.T


def build_page_timeline(
    ppt_pages: list[dict],
    segments: list[dict],
    user_anchors: Optional[list[dict]] = None,
    total_audio_duration: float = 0.0,
) -> list[dict]:
    """
    Build per-page timeline by aligning ASR segments to PPT pages.

    Args:
        ppt_pages: list of {"page_num": int, "ppt_text": str, ...}
        segments:  list of {"text": str, "start": float, "end": float}
        user_anchors: list of {"page_num": int, "timestamp": float}
                      — user note anchors, strongest signal
        total_audio_duration: total length of the audio in seconds

    Returns:
        list of page dicts augmented with:
          - page_start_time: float
          - page_end_time: float
          - alignment_confidence: float  (0–1)
          - aligned_segments: list[dict]  (segments assigned to this page)
          - page_supplement: dict | None  (off-slide segments)
    """
    if not ppt_pages or not segments:
        return _empty_timeline(ppt_pages, total_audio_duration)

    client, embed_model = _get_client()

    # Embed PPT page texts and segment texts
    page_texts = [p.get("ppt_text", "") or f"Page {p['page_num']}" for p in ppt_pages]
    seg_texts = [s["text"] for s in segments]

    page_embeddings = _embed_texts(page_texts, client, embed_model)   # (P, D)
    seg_embeddings = _embed_texts(seg_texts, client, embed_model)     # (S, D)

    # Similarity matrix: (S, P)
    sim_matrix = _cosine_similarity(seg_embeddings, page_embeddings)

    # Assign each segment to its best-matching page
    best_page_idx = np.argmax(sim_matrix, axis=1)       # (S,)
    best_scores = sim_matrix[np.arange(len(segments)), best_page_idx]  # (S,)

    # Apply user anchors as hard constraints
    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            anchor_time = anchor["timestamp"]
            anchor_page_idx = anchor["page_num"] - 1  # 0-based
            if 0 <= anchor_page_idx < len(ppt_pages):
                closest_seg = int(np.argmin(np.abs(seg_starts - anchor_time)))
                best_page_idx[closest_seg] = anchor_page_idx
                best_scores[closest_seg] = 1.0  # anchor = full confidence

    # Build per-page result
    page_map: dict[int, dict] = {
        p["page_num"]: {
            **p,
            "aligned_segments": [],
            "off_slide_segments": [],
            "page_start_time": None,
            "page_end_time": None,
            "alignment_confidence": 0.0,
        }
        for p in ppt_pages
    }

    # --- K=3 page-switch debounce state machine ---
    current_page_num = ppt_pages[0]["page_num"]
    pending_page_num: Optional[int] = None
    pending_count: int = 0

    for i, seg in enumerate(segments):
        score = float(best_scores[i])
        voted_page_idx = int(best_page_idx[i])
        voted_page_num = ppt_pages[voted_page_idx]["page_num"]

        if voted_page_num == current_page_num:
            pending_page_num = None
            pending_count = 0
        elif voted_page_num > current_page_num:
            if voted_page_num == pending_page_num:
                pending_count += 1
            else:
                pending_page_num = voted_page_num
                pending_count = 1
            if pending_count >= PAGE_SWITCH_K:
                current_page_num = pending_page_num  # type: ignore[assignment]
                pending_page_num = None
                pending_count = 0
        else:
            delta = current_page_num - voted_page_num
            if delta == 1:
                if voted_page_num == pending_page_num:
                    pending_count += 1
                else:
                    pending_page_num = voted_page_num
                    pending_count = 1
                if pending_count >= PAGE_SWITCH_K:
                    current_page_num = pending_page_num  # type: ignore[assignment]
                    pending_page_num = None
                    pending_count = 0
            else:
                pending_page_num = None
                pending_count = 0

        page_map[current_page_num]["aligned_segments"].append(
            {**seg, "similarity": score}
        )

    # Compute timing + confidence per page
    results = []
    for page_num in sorted(page_map.keys()):
        entry = page_map[page_num]
        aligned = entry["aligned_segments"]

        if aligned:
            entry["page_start_time"] = aligned[0]["start"]
            entry["page_end_time"] = aligned[-1]["end"]
            entry["alignment_confidence"] = float(
                np.mean([s["similarity"] for s in aligned])
            )
        else:
            entry["page_start_time"] = 0.0
            entry["page_end_time"] = 0.0
            entry["alignment_confidence"] = 0.0

        entry["page_supplement"] = None
        results.append(entry)

    # Fill gaps: pages with no alignment use adjacent page boundaries
    _fill_time_gaps(results, total_audio_duration)

    return results


def _fill_time_gaps(
    pages: list[dict],
    total_duration: float,
) -> None:
    """
    Fill in missing page_start_time / page_end_time by interpolating
    from neighboring pages. Mutates in place.
    """
    n = len(pages)
    for i, page in enumerate(pages):
        if page["page_start_time"] is None or page["page_start_time"] == 0.0:
            prev_end = pages[i - 1]["page_end_time"] if i > 0 else 0.0
            next_start = pages[i + 1]["page_start_time"] if i < n - 1 else total_duration
            page["page_start_time"] = prev_end or 0.0
            page["page_end_time"] = next_start or total_duration

    # Ensure last page ends at total_duration
    if pages and total_duration > 0:
        pages[-1]["page_end_time"] = max(
            pages[-1]["page_end_time"] or 0.0, total_duration
        )


def _empty_timeline(ppt_pages: list[dict], total_duration: float) -> list[dict]:
    """Return pages with zeroed timing when there are no segments."""
    n = len(ppt_pages)
    step = total_duration / n if n > 0 else 0.0
    return [
        {
            **p,
            "aligned_segments": [],
            "off_slide_segments": [],
            "page_start_time": i * step,
            "page_end_time": (i + 1) * step,
            "alignment_confidence": 0.0,
            "page_supplement": None,
        }
        for i, p in enumerate(ppt_pages)
    ]
