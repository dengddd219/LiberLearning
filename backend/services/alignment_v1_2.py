"""
Semantic alignment service — Strategy V1.2

基于 V1（单遍 argmax cosine），增加一步后处理平滑（Post-processing Smoothing）。

改动说明（相对 V1）：
─────────────────────────────────────────────────────────────────────────────
唯一改动：在 argmax 分配完成后，增加 `_smooth_assignments()` 后处理步骤。

逻辑：
  对每个句段 i，检查它的邻居窗口（前 SMOOTH_WINDOW 句 + 后 SMOOTH_WINDOW 句）。
  如果句段 i 分配的页码与所有邻居都不同（即"孤立点"），
  且 i 在邻居页面上的 cosine 相似度与自身 argmax 得分的差值
  在 SMOOTH_TOLERANCE 以内，
  则将 i 的分配修正为邻居中出现次数最多的页面。

目的：消除截图中观察到的"单句飞到远端页面"现象（如周围句子都在 Slide 6，
某句被误判为 Slide 14），而不引入时间约束或状态机。

参数：
  SMOOTH_WINDOW     : int   = 2   — 检查前后各 N 句
  SMOOTH_TOLERANCE  : float = 0.08 — 容忍的相似度损失上限

其余逻辑与 V1 完全一致：argmax cosine 分页，OFF_SLIDE_THRESHOLD 判 off-slide，
无时间约束，无防抖状态机。
─────────────────────────────────────────────────────────────────────────────
"""

STRATEGY_DESCRIPTION = (
    "V1.2 — 单遍扫描 + 后处理平滑：argmax cosine 分页后，对孤立的异常分配点"
    "（前后 SMOOTH_WINDOW 句邻居与其页码完全不同）在相似度损失 ≤ SMOOTH_TOLERANCE 时"
    "修正为邻居多数页。无时间约束，无状态机。"
)

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# ── Thresholds ─────────────────────────────────────────────────────────────────
OFF_SLIDE_THRESHOLD    : float = 0.30
LOW_CONFIDENCE_THRESHOLD: float = 0.60

# ── V1.2 新增：平滑参数 ────────────────────────────────────────────────────────
SMOOTH_WINDOW    : int   = 2     # 前后各看 N 句
SMOOTH_TOLERANCE : float = 0.08  # 允许的相似度损失：若邻居页得分 >= argmax - tolerance，则修正


# ── OpenAI helpers ─────────────────────────────────────────────────────────────

def _get_client() -> tuple[OpenAI, str]:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("sk-xxx"):
        raise RuntimeError("OPENAI_API_KEY not set. Add a real key to backend/.env")
    base_url = os.environ.get("OPENAI_BASE_URL", "").strip() or None
    model = os.environ.get("OPENAI_EMBEDDING_MODEL", "").strip() or "text-embedding-3-small"
    client = OpenAI(api_key=api_key, **({} if not base_url else {"base_url": base_url}))
    return client, model


def _embed_texts(texts: list[str], client: OpenAI, model: str) -> np.ndarray:
    response = client.embeddings.create(model=model, input=texts)
    return np.array([item.embedding for item in response.data], dtype=np.float32)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_norm = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)
    b_norm = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-8)
    return a_norm @ b_norm.T


# ── V1.2 核心改动：后处理平滑 ──────────────────────────────────────────────────

def _smooth_assignments(
    best_page_idx: np.ndarray,
    best_scores: np.ndarray,
    sim_matrix: np.ndarray,
    window: int = SMOOTH_WINDOW,
    tolerance: float = SMOOTH_TOLERANCE,
) -> tuple[np.ndarray, np.ndarray]:
    """
    后处理：修正孤立的异常分配点。

    对句段 i：
    1. 收集邻居窗口 [i-window, i+window] 内（不含 i）的页码分配。
    2. 如果 i 的分配页码不在邻居页码集合中（孤立点），
       取邻居中出现次数最多的页码 neighbor_page。
    3. 检查 i 在 neighbor_page 上的 cosine 得分是否 >= argmax 得分 - tolerance。
       如果是，则将 i 修正为 neighbor_page。

    返回修正后的 (best_page_idx, best_scores)，不修改原数组。
    """
    n = len(best_page_idx)
    new_idx = best_page_idx.copy()
    new_scores = best_scores.copy()

    for i in range(n):
        # 收集邻居（不含自身）
        neighbor_indices = [j for j in range(max(0, i - window), min(n, i + window + 1)) if j != i]
        if not neighbor_indices:
            continue

        neighbor_pages = [best_page_idx[j] for j in neighbor_indices]

        # 如果当前分配页码已经在邻居中出现，不需要修正
        if best_page_idx[i] in neighbor_pages:
            continue

        # 孤立点：取邻居中最多数的页码
        page_counts: dict[int, int] = {}
        for p in neighbor_pages:
            page_counts[p] = page_counts.get(p, 0) + 1
        neighbor_majority = max(page_counts, key=page_counts.__getitem__)

        # 检查相似度损失是否在容忍范围内
        neighbor_score = float(sim_matrix[i, neighbor_majority])
        if neighbor_score >= float(best_scores[i]) - tolerance:
            new_idx[i] = neighbor_majority
            new_scores[i] = neighbor_score

    return new_idx, new_scores


# ── Public entry point ─────────────────────────────────────────────────────────

def build_page_timeline(
    ppt_pages: list[dict],
    segments: list[dict],
    user_anchors: Optional[list[dict]] = None,
    total_audio_duration: float = 0.0,
) -> list[dict]:
    """
    Build per-page timeline — V1.2 (argmax + post-processing smoothing).

    Pipeline:
      1. Embed pages + segments (same as V1)
      2. Argmax cosine assignment (same as V1)
      3. [NEW] Smooth isolated outlier assignments
      4. Apply user anchors as hard overrides (same as V1)
      5. OFF_SLIDE_THRESHOLD filter + assemble output (same as V1)
    """
    if not ppt_pages or not segments:
        return _empty_timeline(ppt_pages, total_audio_duration)

    client, embed_model = _get_client()

    page_texts = [p.get("ppt_text", "") or f"Page {p['page_num']}" for p in ppt_pages]
    seg_texts  = [s["text"] for s in segments]

    page_embeddings = _embed_texts(page_texts, client, embed_model)  # (P, D)
    seg_embeddings  = _embed_texts(seg_texts,  client, embed_model)  # (S, D)

    sim_matrix = _cosine_similarity(seg_embeddings, page_embeddings)  # (S, P)

    # Step 2: argmax（与 V1 相同）
    best_page_idx = np.argmax(sim_matrix, axis=1)                         # (S,)
    best_scores   = sim_matrix[np.arange(len(segments)), best_page_idx]   # (S,)

    # Step 3: [V1.2 新增] 后处理平滑
    best_page_idx, best_scores = _smooth_assignments(
        best_page_idx, best_scores, sim_matrix,
        window=SMOOTH_WINDOW, tolerance=SMOOTH_TOLERANCE,
    )

    # Step 4: user anchors 硬覆盖（与 V1 相同）
    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            anchor_time    = anchor["timestamp"]
            anchor_page_idx = anchor["page_num"] - 1
            if 0 <= anchor_page_idx < len(ppt_pages):
                closest = int(np.argmin(np.abs(seg_starts - anchor_time)))
                best_page_idx[closest] = anchor_page_idx
                best_scores[closest]   = 1.0

    # Step 5: 组装输出（与 V1 相同）
    page_map: dict[int, dict] = {
        p["page_num"]: {
            **p,
            "aligned_segments":  [],
            "off_slide_segments": [],
            "page_start_time":   None,
            "page_end_time":     None,
            "alignment_confidence": 0.0,
        }
        for p in ppt_pages
    }
    last_page_num = ppt_pages[0]["page_num"]

    for i, seg in enumerate(segments):
        score    = float(best_scores[i])
        page_idx = int(best_page_idx[i])
        page_num = ppt_pages[page_idx]["page_num"]

        if score < OFF_SLIDE_THRESHOLD:
            page_map[last_page_num]["off_slide_segments"].append({**seg, "similarity": score})
        else:
            page_map[page_num]["aligned_segments"].append({**seg, "similarity": score})
            last_page_num = page_num

    results = []
    for page_num in sorted(page_map.keys()):
        entry    = page_map[page_num]
        aligned  = entry["aligned_segments"]
        off_slide = entry["off_slide_segments"]

        if aligned:
            entry["page_start_time"]      = aligned[0]["start"]
            entry["page_end_time"]        = aligned[-1]["end"]
            entry["alignment_confidence"] = float(np.mean([s["similarity"] for s in aligned]))
        else:
            entry["page_start_time"]      = 0.0
            entry["page_end_time"]        = 0.0
            entry["alignment_confidence"] = 0.0

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


# ── Utilities (identical to V1) ────────────────────────────────────────────────

def _fill_time_gaps(pages: list[dict], total_duration: float) -> None:
    n = len(pages)
    for i, page in enumerate(pages):
        if page["page_start_time"] is None or page["page_start_time"] == 0.0:
            prev_end   = pages[i - 1]["page_end_time"] if i > 0 else 0.0
            next_start = pages[i + 1]["page_start_time"] if i < n - 1 else total_duration
            page["page_start_time"] = prev_end or 0.0
            page["page_end_time"]   = next_start or total_duration
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
