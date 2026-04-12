"""
Semantic alignment service — Strategy V3a.1.

基于 V3a，新增时间轴硬窗口约束：
- 搜索范围限定在 [current_page, current_page + 3]
- 窗口外的页面相似度直接屏蔽，不参与竞争
- current_page 单调递增，只能前进不能后退
- 其余逻辑与 V3a 完全相同（三分类：正则关键词判 extends）
"""

STRATEGY_DESCRIPTION = (
    "V3a.1：V3a 基础上加时间轴硬窗口约束。"
    "搜索范围限定在 [current_page, current_page+3]，"
    "窗口外页面直接屏蔽，current_page 单调递增。"
    "其余与 V3a 相同（三分类，正则关键词判 extends）。"
)

import os
import re
from typing import Optional

import numpy as np
from openai import OpenAI

from .alignment_utils import apply_time_mask

BELONGS_THRESHOLD = 0.45
OFF_SLIDE_THRESHOLD = 0.25

EXTEND_PATTERNS = re.compile(
    r"\b(so|therefore|thus|hence|because|since|this|it|that|which|where|"
    r"as a result|in other words|for example|for instance)\b"
    r"|因此|所以|由此|因而|因为|这说明|这意味|这表明|这就是|它说明|换句话说|举个例子|比如说",
    re.IGNORECASE,
)


def _get_client() -> tuple[OpenAI, str]:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("sk-xxx"):
        raise RuntimeError("OPENAI_API_KEY not set. Add a real key to backend/.env")
    base_url = os.environ.get("OPENAI_BASE_URL", "").strip() or None
    model = os.environ.get("OPENAI_EMBEDDING_MODEL", "").strip() or "text-embedding-3-small"
    client = OpenAI(api_key=api_key, **({} if not base_url else {"base_url": base_url}))
    return client, model


def _embed_texts(texts: list[str], client: OpenAI, model: str) -> np.ndarray:
    resp = client.embeddings.create(model=model, input=texts)
    return np.array([item.embedding for item in resp.data], dtype=np.float32)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_n = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)
    b_n = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-8)
    return a_n @ b_n.T


def _classify(text: str, score: float) -> str:
    if score >= BELONGS_THRESHOLD:
        return "belongs"
    if score >= OFF_SLIDE_THRESHOLD and EXTEND_PATTERNS.search(text):
        return "extends"
    return "filler"


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

    all_vecs = _embed_texts(page_texts + seg_texts, client, embed_model)
    page_vecs = all_vecs[:len(page_texts)]
    seg_vecs = all_vecs[len(page_texts):]

    sim_matrix = _cosine_similarity(seg_vecs, page_vecs)  # (S, P)

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

    for i, seg in enumerate(segments):
        masked_row = apply_time_mask(sim_matrix[i], current_page, page_nums)
        best_idx = int(np.argmax(masked_row))
        score = float(sim_matrix[i, best_idx])
        page_num = page_nums[best_idx]
        cls = _classify(seg["text"], score)

        seg_dict = {**seg, "similarity": score, "segment_class": cls}

        if cls == "filler":
            page_map[last_page_num]["off_slide_segments"].append(seg_dict)
        else:
            page_map[page_num]["aligned_segments"].append(seg_dict)
            current_page = max(current_page, page_num)
            last_page_num = page_num

    results = []
    for page_num in sorted(page_map.keys()):
        entry = page_map[page_num]
        aligned = entry["aligned_segments"]
        off_slide = entry["off_slide_segments"]

        if aligned:
            entry["page_start_time"] = aligned[0]["start"]
            entry["page_end_time"] = aligned[-1]["end"]
            entry["alignment_confidence"] = float(np.mean([s["similarity"] for s in aligned]))

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
