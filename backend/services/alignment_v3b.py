"""
Semantic alignment service — Strategy V3b.

三分类方案（滑窗 embedding 判拓展）：
- 属于 (belongs)：cosine(seg, best_page) >= BELONGS_THRESHOLD
- 拓展 (extends)：相似度介于 OFF_SLIDE_THRESHOLD ~ BELONGS_THRESHOLD，
                  且当前句与前 CONTEXT_WINDOW 句的均值余弦 >= CONTEXT_SIM_THRESHOLD
- 废话 (filler)：其他
"""
import os
from typing import Optional

import numpy as np
from openai import OpenAI

STRATEGY_DESCRIPTION = (
    "V3b — 三分类（滑窗embedding）：cosine≥0.45→属于，"
    "与前3句均值相似度≥0.55→拓展，其余→废话。"
)

BELONGS_THRESHOLD = 0.45
OFF_SLIDE_THRESHOLD = 0.25
CONTEXT_SIM_THRESHOLD = 0.55
CONTEXT_WINDOW = 3


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


def _context_sim(seg_idx: int, seg_vecs: np.ndarray, window: int) -> float:
    """当前句与前 window 句的均值余弦相似度，不足时用所有前序句。"""
    if seg_idx == 0:
        return 0.0
    start    = max(0, seg_idx - window)
    ctx_vecs = seg_vecs[start:seg_idx]        # (k, D)
    cur_vec  = seg_vecs[seg_idx:seg_idx + 1]  # (1, D)
    sims     = _cosine_similarity(cur_vec, ctx_vecs)  # (1, k)
    return float(sims.mean())


def _classify(score: float, seg_idx: int, seg_vecs: np.ndarray) -> tuple[str, float]:
    """返回 ('belongs'|'extends'|'filler', context_sim)"""
    if score >= BELONGS_THRESHOLD:
        return "belongs", 0.0
    ctx_sim = _context_sim(seg_idx, seg_vecs, CONTEXT_WINDOW)
    if score >= OFF_SLIDE_THRESHOLD and ctx_sim >= CONTEXT_SIM_THRESHOLD:
        return "extends", ctx_sim
    return "filler", ctx_sim


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
    seg_texts  = [s["text"] for s in segments]

    # 单次 batch 调用
    all_vecs  = _embed_texts(page_texts + seg_texts, client, embed_model)
    page_vecs = all_vecs[:len(page_texts)]
    seg_vecs  = all_vecs[len(page_texts):]

    sim_matrix    = _cosine_similarity(seg_vecs, page_vecs)  # (S, P)
    best_page_idx = np.argmax(sim_matrix, axis=1)
    best_scores   = sim_matrix[np.arange(len(segments)), best_page_idx]

    # User anchors 作为硬约束
    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            aidx = anchor["page_num"] - 1
            if 0 <= aidx < len(ppt_pages):
                closest = int(np.argmin(np.abs(seg_starts - anchor["timestamp"])))
                best_page_idx[closest] = aidx
                best_scores[closest]   = 1.0

    page_map = {
        p["page_num"]: {
            **p,
            "aligned_segments":   [],
            "off_slide_segments": [],
            "page_start_time":    None,
            "page_end_time":      None,
            "alignment_confidence": 0.0,
        }
        for p in ppt_pages
    }
    last_page_num = ppt_pages[0]["page_num"]

    for i, seg in enumerate(segments):
        score    = float(best_scores[i])
        page_num = ppt_pages[int(best_page_idx[i])]["page_num"]
        cls, ctx_sim = _classify(score, i, seg_vecs)

        seg_dict = {**seg, "similarity": score, "segment_class": cls}
        if ctx_sim > 0.0:
            seg_dict["context_similarity"] = round(ctx_sim, 4)

        if cls == "filler":
            page_map[last_page_num]["off_slide_segments"].append(seg_dict)
        else:
            page_map[page_num]["aligned_segments"].append(seg_dict)
            last_page_num = page_num

    results = []
    for page_num in sorted(page_map.keys()):
        entry     = page_map[page_num]
        aligned   = entry["aligned_segments"]
        off_slide = entry["off_slide_segments"]

        if aligned:
            entry["page_start_time"]      = aligned[0]["start"]
            entry["page_end_time"]        = aligned[-1]["end"]
            entry["alignment_confidence"] = float(np.mean([s["similarity"] for s in aligned]))
        # else: leave page_start_time as None — _fill_time_gaps will interpolate

        entry["page_supplement"] = (
            {
                "content":         " ".join(s["text"] for s in off_slide),
                "timestamp_start": off_slide[0]["start"],
                "timestamp_end":   off_slide[-1]["end"],
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
            prev_end   = pages[i - 1]["page_end_time"] if i > 0 else 0.0
            next_start = pages[i + 1]["page_start_time"] if i < n - 1 else total_duration
            page["page_start_time"]      = prev_end or 0.0
            page["page_end_time"]        = next_start or total_duration
            page["alignment_confidence"] = 0.0
    if pages and total_duration > 0:
        pages[-1]["page_end_time"] = max(pages[-1]["page_end_time"] or 0.0, total_duration)


def _empty_timeline(ppt_pages: list[dict], total_duration: float) -> list[dict]:
    n = len(ppt_pages)
    step = total_duration / n if n > 0 else 0.0
    return [
        {
            **p,
            "aligned_segments":   [],
            "off_slide_segments": [],
            "page_start_time":    i * step,
            "page_end_time":      (i + 1) * step,
            "alignment_confidence": 0.0,
            "page_supplement":    None,
        }
        for i, p in enumerate(ppt_pages)
    ]
