"""
Semantic alignment service — Strategy V2.1.

基于 V2，新增时间轴硬窗口约束：
- 搜索范围限定在 [current_page, current_page + 3]
- 窗口外的页面相似度直接屏蔽，不参与竞争
- current_page 单调递增，只能前进不能后退
- 其余逻辑与 V2 完全相同（K=3 debounce + off-slide upgrade）
"""

STRATEGY_DESCRIPTION = (
    "V2.1：V2 基础上加时间轴硬窗口约束。"
    "搜索范围限定在 [current_page, current_page+3]，"
    "窗口外页面直接屏蔽，current_page 单调递增。"
    "其余与 V2 相同（K=3 debounce + whole-PPT off-slide + upgrade）。"
)

import os
from typing import Optional

import numpy as np
from openai import OpenAI

from .alignment_utils import apply_time_mask

OFF_SLIDE_THRESHOLD = 0.30
LOW_CONFIDENCE_THRESHOLD = 0.60
PAGE_SWITCH_K = 3
OFF_SLIDE_UPGRADE_THRESHOLD = 0.60


def _get_client() -> tuple[OpenAI, str]:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("sk-xxx"):
        raise RuntimeError("OPENAI_API_KEY not set. Add a real key to backend/.env")
    base_url = os.environ.get("OPENAI_BASE_URL", "").strip() or None
    model = os.environ.get("OPENAI_EMBEDDING_MODEL", "").strip() or "text-embedding-3-small"
    client = OpenAI(api_key=api_key, **({"base_url": base_url} if base_url else {}))
    return client, model


def _embed_texts(texts: list[str], client: OpenAI, model: str) -> np.ndarray:
    response = client.embeddings.create(model=model, input=texts)
    return np.array([item.embedding for item in response.data], dtype=np.float32)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_norm = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)
    b_norm = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-8)
    return a_norm @ b_norm.T


def build_page_timeline(
    ppt_pages: list[dict],
    segments: list[dict],
    user_anchors: Optional[list[dict]] = None,
    total_audio_duration: float = 0.0,
) -> list[dict]:
    if not ppt_pages or not segments:
        return _empty_timeline(ppt_pages, total_audio_duration)

    client, embed_model = _get_client()

    page_texts = [p.get("ppt_text", "") or f"Page {p['page_num']}" for p in ppt_pages]
    seg_texts = [s["text"] for s in segments]
    page_nums = [p["page_num"] for p in ppt_pages]

    whole_ppt_text = " ".join(t for t in page_texts if t.strip())
    all_texts = page_texts + seg_texts + [whole_ppt_text]
    all_embeddings = _embed_texts(all_texts, client, embed_model)
    P = len(page_texts)
    S = len(seg_texts)
    page_embeddings = all_embeddings[:P]
    seg_embeddings = all_embeddings[P: P + S]
    whole_ppt_vec = all_embeddings[P + S]

    sim_matrix = _cosine_similarity(seg_embeddings, page_embeddings)  # (S, P)

    whole_ppt_norm = whole_ppt_vec / (np.linalg.norm(whole_ppt_vec) + 1e-8)
    seg_norms = seg_embeddings / (np.linalg.norm(seg_embeddings, axis=1, keepdims=True) + 1e-8)
    whole_ppt_scores = seg_norms @ whole_ppt_norm  # (S,)

    # User anchors as hard constraints
    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            aidx = anchor["page_num"] - 1
            if 0 <= aidx < len(ppt_pages):
                closest = int(np.argmin(np.abs(seg_starts - anchor["timestamp"])))
                sim_matrix[closest] = -np.inf
                sim_matrix[closest, aidx] = 1.0

    page_map = {
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

    current_page = ppt_pages[0]["page_num"]
    last_page_num = current_page

    # K=3 debounce state
    pending_page_num: Optional[int] = None
    pending_count: int = 0
    off_slide_pending: list[int] = []

    raw_assignments: list[dict] = [None] * len(segments)  # type: ignore[list-item]

    def _flush_pending_as_aligned(pending: list[int]) -> None:
        for idx in pending:
            raw_assignments[idx] = {
                "label": "aligned",
                "page_num": last_page_num,
                "score": float(whole_ppt_scores[idx]),
            }

    for i, seg in enumerate(segments):
        wp_score = float(whole_ppt_scores[i])

        if wp_score < OFF_SLIDE_THRESHOLD:
            off_slide_pending.append(i)
            if len(off_slide_pending) >= PAGE_SWITCH_K:
                for idx in off_slide_pending:
                    raw_assignments[idx] = {
                        "label": "off_slide",
                        "page_num": last_page_num,
                        "score": float(whole_ppt_scores[idx]),
                    }
                off_slide_pending = []
            continue
        else:
            if off_slide_pending:
                _flush_pending_as_aligned(off_slide_pending)
                off_slide_pending = []

            # Time-constrained argmax
            masked_row = apply_time_mask(sim_matrix[i], current_page, page_nums)
            best_idx = int(np.argmax(masked_row))
            score = float(sim_matrix[i, best_idx])
            voted_page_num = page_nums[best_idx]

            # K=3 debounce state machine (forward only within window)
            if voted_page_num == current_page:
                pending_page_num = None
                pending_count = 0
            elif voted_page_num > current_page:
                if voted_page_num == pending_page_num:
                    pending_count += 1
                else:
                    pending_page_num = voted_page_num
                    pending_count = 1
                if pending_count >= PAGE_SWITCH_K:
                    current_page = pending_page_num  # type: ignore[assignment]
                    pending_page_num = None
                    pending_count = 0

            raw_assignments[i] = {"label": "aligned", "page_num": current_page, "score": score}
            last_page_num = current_page

    if off_slide_pending:
        _flush_pending_as_aligned(off_slide_pending)

    # Off-slide upgrade pass
    for i, assignment in enumerate(raw_assignments):
        if assignment["label"] != "off_slide":
            continue
        prev_aligned_idx: Optional[int] = None
        for j in range(i - 1, -1, -1):
            if raw_assignments[j]["label"] == "aligned":
                prev_aligned_idx = j
                break
        if prev_aligned_idx is None:
            continue
        vec_off = seg_embeddings[i]
        vec_prev = seg_embeddings[prev_aligned_idx]
        upgrade_sim = float(
            np.dot(vec_off / (np.linalg.norm(vec_off) + 1e-8),
                   vec_prev / (np.linalg.norm(vec_prev) + 1e-8))
        )
        if upgrade_sim > OFF_SLIDE_UPGRADE_THRESHOLD:
            assignment["label"] = "aligned_upgraded"
            assignment["page_num"] = raw_assignments[prev_aligned_idx]["page_num"]
            assignment["upgrade_similarity"] = upgrade_sim

    # Distribute into page_map
    for i, seg in enumerate(segments):
        assignment = raw_assignments[i]
        label = assignment["label"]
        page_num = assignment["page_num"]
        score = assignment["score"]

        if label == "off_slide":
            page_map[page_num]["off_slide_segments"].append(
                {**seg, "similarity": score, "segment_class": "filler"}
            )
        elif label == "aligned_upgraded":
            page_map[page_num]["aligned_segments"].append(
                {**seg, "similarity": score, "segment_class": "belongs",
                 "upgraded_from_off_slide": True,
                 "upgrade_similarity": assignment["upgrade_similarity"]}
            )
        else:
            page_map[page_num]["aligned_segments"].append(
                {**seg, "similarity": score, "segment_class": "belongs"}
            )

    results = []
    for page_num in sorted(page_map.keys()):
        entry = page_map[page_num]
        aligned = entry["aligned_segments"]
        off_slide = entry["off_slide_segments"]

        if aligned:
            entry["page_start_time"] = aligned[0]["start"]
            entry["page_end_time"] = aligned[-1]["end"]
            entry["alignment_confidence"] = float(np.mean([s["similarity"] for s in aligned]))
        else:
            entry["page_start_time"] = None
            entry["page_end_time"] = None
            entry["alignment_confidence"] = 0.0

        entry["page_supplement"] = (
            {
                "content": " ".join(s["text"] for s in off_slide),
                "timestamp_start": off_slide[0]["start"],
                "timestamp_end": off_slide[-1]["end"],
            }
            if off_slide else None
        )
        results.append(entry)

    _fill_time_gaps(results, total_audio_duration)
    return results


def _fill_time_gaps(pages: list[dict], total_duration: float) -> None:
    n = len(pages)
    for i, page in enumerate(pages):
        if page["page_start_time"] is None:
            prev_end = pages[i - 1]["page_end_time"] if i > 0 else 0.0
            next_start = pages[i + 1]["page_start_time"] if i < n - 1 else total_duration
            page["page_start_time"] = prev_end or 0.0
            page["page_end_time"] = next_start or total_duration
            page["alignment_confidence"] = 0.0
    if pages and total_duration > 0:
        pages[-1]["page_end_time"] = max(pages[-1]["page_end_time"] or 0.0, total_duration)


def _empty_timeline(ppt_pages: list[dict], total_duration: float) -> list[dict]:
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
