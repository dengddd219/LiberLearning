"""
Semantic alignment service — Strategy V1.3.2

基于 V1.3.1（argmax + 单调性惩罚平滑），新增低相似度锁定（Low-Confidence Lock）。

改动说明（相对 V1.3.1）：
─────────────────────────────────────────────────────────────────────────────
唯一改动：在 argmax 分配之后、平滑之前，增加 _apply_lock() 后处理步骤。

逻辑：
  对每个句段 i，如果 argmax 得分低于 LOCK_THRESHOLD，
  说明该句与任何 PPT 页面都相似度极低（老师在跑题举例、闲聊、或切出 PPT）。
  此时放弃全局检索结果，直接继承上一个置信度正常句段的页码。
  若 i=0 没有前序句段，则保留原 argmax 结果。

目的：解决 V1.3.1 仍无法处理的场景——
  当老师连续多句脱离 PPT 内容（如 [01:52–02:25] 举例时），
  argmax 给出的全是 0.3 左右的噪声结果，邻居全错，平滑也救不了。
  此时正确的做法是"原地不动，等待老师回到 PPT"。

参数：
  SMOOTH_WINDOW     : int   = 2    — 平滑窗口（与 V1.3.1 相同）
  SMOOTH_TOLERANCE  : float = 0.08 — 正向平滑容忍损失（与 V1.3.1 相同）
  MONOTONE_PENALTY  : float = 0.06 — 倒退惩罚（与 V1.3.1 相同）
  LOCK_THRESHOLD    : float = 0.38 — 低于此分数时锁定到上一句页码

注意：LOCK_THRESHOLD 应略高于 OFF_SLIDE_THRESHOLD（0.30），
  区间 [0.30, 0.38) 表示"不是 off-slide，但相似度太低，不可信"。
─────────────────────────────────────────────────────────────────────────────
"""

STRATEGY_DESCRIPTION = (
    "V1.3.2 — 单遍扫描 + 单调性平滑 + 低分锁定：在 V1.3.1 基础上，"
    "对 argmax 得分低于 LOCK_THRESHOLD 的句段，直接继承上一句的页码，"
    "避免老师跑题举例时噪声结果污染平滑窗口。"
)

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# ── Thresholds ─────────────────────────────────────────────────────────────────
OFF_SLIDE_THRESHOLD     : float = 0.30
LOW_CONFIDENCE_THRESHOLD: float = 0.60

# ── 平滑参数（与 V1.3.1 相同）─────────────────────────────────────────────────
SMOOTH_WINDOW    : int   = 2
SMOOTH_TOLERANCE : float = 0.08
MONOTONE_PENALTY : float = 0.06

# ── V1.3.2 新增：低分锁定阈值 ─────────────────────────────────────────────────
LOCK_THRESHOLD   : float = 0.38  # 低于此分数，继承上一句页码


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


# ── V1.3.2 新增：低分锁定 ──────────────────────────────────────────────────────

def _apply_lock(
    best_page_idx: np.ndarray,
    best_scores: np.ndarray,
    threshold: float = LOCK_THRESHOLD,
) -> tuple[np.ndarray, np.ndarray]:
    """
    低分锁定：对 argmax 得分低于 threshold 的句段，继承上一个正常句段的页码。

    遍历所有句段：
    - 如果 best_scores[i] < threshold，且存在前序正常句段，
      则将 best_page_idx[i] 替换为最近一个正常句段的页码。
    - best_scores[i] 保持原值不变（用于后续调试和展示，不影响平滑逻辑）。
    - i=0 无前序时保留原 argmax 结果。

    返回修正后的 (best_page_idx, best_scores)，不修改原数组。
    """
    n = len(best_page_idx)
    new_idx = best_page_idx.copy()
    new_scores = best_scores.copy()

    last_reliable_page: Optional[int] = None

    for i in range(n):
        if float(best_scores[i]) >= threshold:
            last_reliable_page = int(best_page_idx[i])
        else:
            if last_reliable_page is not None:
                new_idx[i] = last_reliable_page
            # 若 i=0 就已经低分，保留原 argmax，不做修改

    return new_idx, new_scores


# ── 平滑（与 V1.3.1 相同）─────────────────────────────────────────────────────

def _smooth_assignments(
    best_page_idx: np.ndarray,
    best_scores: np.ndarray,
    sim_matrix: np.ndarray,
    window: int = SMOOTH_WINDOW,
    tolerance: float = SMOOTH_TOLERANCE,
    monotone_penalty: float = MONOTONE_PENALTY,
) -> tuple[np.ndarray, np.ndarray]:
    n = len(best_page_idx)
    new_idx = best_page_idx.copy()
    new_scores = best_scores.copy()

    for i in range(n):
        neighbor_indices = [j for j in range(max(0, i - window), min(n, i + window + 1)) if j != i]
        if not neighbor_indices:
            continue

        neighbor_pages = [best_page_idx[j] for j in neighbor_indices]

        if best_page_idx[i] in neighbor_pages:
            continue

        page_counts: dict[int, int] = {}
        for p in neighbor_pages:
            page_counts[p] = page_counts.get(p, 0) + 1
        neighbor_majority = max(page_counts, key=page_counts.__getitem__)

        is_regression = int(neighbor_majority) < int(best_page_idx[i])
        effective_tolerance = tolerance - monotone_penalty if is_regression else tolerance

        neighbor_score = float(sim_matrix[i, neighbor_majority])
        if neighbor_score >= float(best_scores[i]) - effective_tolerance:
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
    Build per-page timeline — V1.3.2 (argmax + lock + monotonicity smoothing).

    Pipeline:
      1. Embed pages + segments
      2. Argmax cosine assignment
      3. [V1.3.2 新增] 低分锁定：继承上一句页码
      4. [V1.3.1] 单调性惩罚平滑
      5. Apply user anchors as hard overrides
      6. Assemble output
    """
    if not ppt_pages or not segments:
        return _empty_timeline(ppt_pages, total_audio_duration)

    client, embed_model = _get_client()

    page_texts = [p.get("ppt_text", "") or f"Page {p['page_num']}" for p in ppt_pages]
    seg_texts  = [s["text"] for s in segments]

    page_embeddings = _embed_texts(page_texts, client, embed_model)  # (P, D)
    seg_embeddings  = _embed_texts(seg_texts,  client, embed_model)  # (S, D)

    sim_matrix = _cosine_similarity(seg_embeddings, page_embeddings)  # (S, P)

    # Step 2: argmax
    best_page_idx = np.argmax(sim_matrix, axis=1)
    best_scores   = sim_matrix[np.arange(len(segments)), best_page_idx]

    # Step 3: [V1.3.2] 低分锁定
    best_page_idx, best_scores = _apply_lock(
        best_page_idx, best_scores, threshold=LOCK_THRESHOLD,
    )

    # Step 4: [V1.3.1] 单调性惩罚平滑
    best_page_idx, best_scores = _smooth_assignments(
        best_page_idx, best_scores, sim_matrix,
        window=SMOOTH_WINDOW, tolerance=SMOOTH_TOLERANCE,
        monotone_penalty=MONOTONE_PENALTY,
    )

    # Step 5: user anchors 硬覆盖
    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            anchor_time     = anchor["timestamp"]
            anchor_page_idx = anchor["page_num"] - 1
            if 0 <= anchor_page_idx < len(ppt_pages):
                closest = int(np.argmin(np.abs(seg_starts - anchor_time)))
                best_page_idx[closest] = anchor_page_idx
                best_scores[closest]   = 1.0

    # Step 6: 组装输出
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

    for i, seg in enumerate(segments):
        score    = float(best_scores[i])
        page_idx = int(best_page_idx[i])
        page_num = ppt_pages[page_idx]["page_num"]
        page_map[page_num]["aligned_segments"].append({**seg, "similarity": score})

    results = []
    for page_num in sorted(page_map.keys()):
        entry   = page_map[page_num]
        aligned = entry["aligned_segments"]

        if aligned:
            entry["page_start_time"]      = aligned[0]["start"]
            entry["page_end_time"]        = aligned[-1]["end"]
            entry["alignment_confidence"] = float(np.mean([s["similarity"] for s in aligned]))
        else:
            entry["page_start_time"]      = 0.0
            entry["page_end_time"]        = 0.0
            entry["alignment_confidence"] = 0.0

        entry["page_supplement"] = None
        results.append(entry)

    _fill_time_gaps(results, total_audio_duration)
    return results


# ── Utilities ──────────────────────────────────────────────────────────────────

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
