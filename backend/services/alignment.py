"""
Semantic alignment service.
Aligns ASR transcript segments to PPT pages using:
  1. OpenAI text-embedding-3-small cosine similarity (primary signal)
  2. User note anchors (strong override)
  3. Time-axis ordering (soft prior)

Output: per-page timeline with page_start_time, page_end_time,
alignment_confidence, and page_supplement for off-slide segments.
"""

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# Similarity threshold below which a segment is considered "off-slide"
OFF_SLIDE_THRESHOLD = 0.30
# Minimum confidence to suppress the ⚠️ warning in the UI
LOW_CONFIDENCE_THRESHOLD = 0.60
# Number of consecutive segments required to trigger a page switch (forward or 1-page back)
PAGE_SWITCH_K = 3
# Cosine similarity threshold for upgrading an off-slide segment to the previous aligned page
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

    # Build whole-PPT text: concatenate all page texts for off-slide detection
    whole_ppt_text = " ".join(t for t in page_texts if t.strip())
    # Embed all at once to minimize API round-trips
    all_texts_to_embed = page_texts + seg_texts + [whole_ppt_text]
    all_embeddings = _embed_texts(all_texts_to_embed, client, embed_model)
    P = len(page_texts)
    S = len(seg_texts)
    page_embeddings = all_embeddings[:P]          # (P, D)
    seg_embeddings = all_embeddings[P : P + S]    # (S, D)
    whole_ppt_vec = all_embeddings[P + S]         # (D,)

    # Similarity matrix: (S, P)
    sim_matrix = _cosine_similarity(seg_embeddings, page_embeddings)

    # Cosine similarity of each segment vs the whole-PPT vector (for off-slide detection)
    whole_ppt_norm = whole_ppt_vec / (np.linalg.norm(whole_ppt_vec) + 1e-8)
    seg_norms = seg_embeddings / (np.linalg.norm(seg_embeddings, axis=1, keepdims=True) + 1e-8)
    whole_ppt_scores = seg_norms @ whole_ppt_norm  # (S,)

    # Assign each segment to its best-matching page
    best_page_idx = np.argmax(sim_matrix, axis=1)       # (S,)
    best_scores = sim_matrix[np.arange(len(segments)), best_page_idx]  # (S,)

    # Apply user anchors as hard constraints
    # Find the segment closest in time to each anchor and force its page
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

    # Track the last assigned page for off-slide fallback
    last_page_num = ppt_pages[0]["page_num"]

    # --- Mechanism 1: K=3 page-switch debounce state machine ---
    # current_page tracks the "confirmed" page; only switches after PAGE_SWITCH_K
    # consecutive segments agree on a new page (forward) or exactly 1-page back.
    current_page_num = ppt_pages[0]["page_num"]
    pending_page_num: Optional[int] = None   # candidate page being counted toward K
    pending_count: int = 0                   # how many consecutive segments voted for pending_page_num

    # --- Off-slide debounce state ---
    # A segment is truly off-slide only after PAGE_SWITCH_K consecutive segments
    # all have whole_ppt_score < OFF_SLIDE_THRESHOLD.
    # Segments in the "pending off-slide" window are held here; if the window
    # never fills to K, they are flushed as aligned.
    off_slide_pending: list[int] = []  # indices of segments in the pending window

    # --- Mechanism 2: off_slide upgrade bookkeeping ---
    # We need to defer processing of off-slide segments so we can look back at the
    # last confirmed aligned segment and compute continuity similarity.
    # We'll do two passes: first pass assigns raw labels; second pass upgrades.

    # raw_assignments: one entry per segment index
    #   {"label": "aligned"|"off_slide", "page_num": int, "score": float}
    raw_assignments: list[dict] = [None] * len(segments)  # type: ignore[list-item]

    def _flush_pending_as_aligned(pending: list[int]) -> None:
        """Commit pending off-slide candidates back as aligned to last_page_num."""
        for idx in pending:
            raw_assignments[idx] = {
                "label": "aligned",
                "page_num": last_page_num,
                "score": float(whole_ppt_scores[idx]),
            }

    for i, seg in enumerate(segments):
        score = float(best_scores[i])
        voted_page_idx = int(best_page_idx[i])
        voted_page_num = ppt_pages[voted_page_idx]["page_num"]
        wp_score = float(whole_ppt_scores[i])

        if wp_score < OFF_SLIDE_THRESHOLD:
            # Candidate for off-slide — accumulate in pending window
            off_slide_pending.append(i)
            if len(off_slide_pending) >= PAGE_SWITCH_K:
                # Confirmed off-slide: flush all pending as off_slide
                for idx in off_slide_pending:
                    raw_assignments[idx] = {
                        "label": "off_slide",
                        "page_num": last_page_num,
                        "score": float(whole_ppt_scores[idx]),
                    }
                off_slide_pending = []
            # Off-slide candidates do NOT update page-switch debounce
            continue
        else:
            # wp_score >= threshold: this segment is on-slide
            if off_slide_pending:
                # Previous pending window didn't reach K → flush as aligned
                _flush_pending_as_aligned(off_slide_pending)
                off_slide_pending = []
            # Aligned: run through state machine
            if voted_page_num == current_page_num:
                # Staying on the same page — reset any pending switch
                pending_page_num = None
                pending_count = 0
            elif voted_page_num > current_page_num:
                # Forward flip candidate
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
                # voted_page_num < current_page_num  (backward)
                delta = current_page_num - voted_page_num
                if delta == 1:
                    # Small 1-page back: allow with K debounce
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
                    # Jump back 2+ pages: forbidden — keep current_page_num
                    pending_page_num = None
                    pending_count = 0

            raw_assignments[i] = {"label": "aligned", "page_num": current_page_num, "score": score}
            last_page_num = current_page_num

    # Flush any trailing off_slide_pending that never reached K → treat as aligned
    if off_slide_pending:
        _flush_pending_as_aligned(off_slide_pending)
        off_slide_pending = []

    # --- Off-slide upgrade pass (Mechanism 2) ---
    # For each off-slide segment, find the previous aligned segment index,
    # compute cosine similarity of their embeddings, and upgrade if above threshold.
    for i, assignment in enumerate(raw_assignments):
        if assignment["label"] != "off_slide":
            continue

        # Find the nearest previous aligned segment (skip consecutive off-slides)
        prev_aligned_idx: Optional[int] = None
        for j in range(i - 1, -1, -1):
            if raw_assignments[j]["label"] == "aligned":
                prev_aligned_idx = j
                break

        if prev_aligned_idx is None:
            # No previous aligned segment found; keep as off-slide
            continue

        # Cosine similarity between this off-slide segment and the previous aligned segment
        # Both embeddings are already available in seg_embeddings (shape S x D, normalized later)
        vec_off = seg_embeddings[i]
        vec_prev = seg_embeddings[prev_aligned_idx]
        norm_off = np.linalg.norm(vec_off) + 1e-8
        norm_prev = np.linalg.norm(vec_prev) + 1e-8
        upgrade_sim = float(np.dot(vec_off / norm_off, vec_prev / norm_prev))

        if upgrade_sim > OFF_SLIDE_UPGRADE_THRESHOLD:
            # Upgrade: reclassify as aligned to the same page as the previous aligned segment
            assignment["label"] = "aligned_upgraded"
            assignment["page_num"] = raw_assignments[prev_aligned_idx]["page_num"]
            assignment["upgrade_similarity"] = upgrade_sim

    # --- Distribute segments into page_map using final assignments ---
    for i, seg in enumerate(segments):
        assignment = raw_assignments[i]
        label = assignment["label"]
        page_num = assignment["page_num"]
        score = assignment["score"]

        if label == "off_slide":
            page_map[page_num]["off_slide_segments"].append(
                {**seg, "similarity": score}
            )
        elif label == "aligned_upgraded":
            page_map[page_num]["aligned_segments"].append(
                {
                    **seg,
                    "similarity": score,
                    "upgraded_from_off_slide": True,
                    "upgrade_similarity": assignment["upgrade_similarity"],
                }
            )
        else:
            # Normal aligned segment
            page_map[page_num]["aligned_segments"].append(
                {**seg, "similarity": score}
            )

    # Compute timing + confidence per page
    results = []
    for page_num in sorted(page_map.keys()):
        entry = page_map[page_num]
        aligned = entry["aligned_segments"]
        off_slide = entry["off_slide_segments"]

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

        # Build page_supplement from off-slide segments
        if off_slide:
            supplement_text = " ".join(s["text"] for s in off_slide)
            entry["page_supplement"] = {
                "content": supplement_text,
                "timestamp_start": off_slide[0]["start"],
                "timestamp_end": off_slide[-1]["end"],
            }
        else:
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
            # Try to infer from neighbors
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
