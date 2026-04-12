"""
Semantic alignment service — Strategy V5.1 (Viterbi/HMM · Boundary-Tuned)

基于 V5 的参数调优版本，专项修复 Gemini 分析报告中的两类错误：

问题 1 — Transition Lag（换页滞后）
  根因：TRANS_STAY(0.60) 是 TRANS_NEXT(0.25) 的 2.4 倍，
        Viterbi 路径在发射证据不够压倒性时倾向于"继续等待"，
        导致在换页过渡句上滞留旧页 2–4 秒。
  修复：TRANS_STAY 0.60 → 0.50，TRANS_NEXT 0.25 → 0.32，
        前进 1 页的相对优势从 0.25/0.60≈0.42 提升至 0.32/0.50=0.64。

问题 2 — Premature Jump（过早跳页）
  根因：EMISSION_TEMPERATURE=0.10 时 softmax 极度尖锐，
        当 seg 与下一页有任何词汇重叠时，概率质量会被过度集中，
        拉动 Viterbi 路径提前翻页。
  修复：EMISSION_TEMPERATURE 0.10 → 0.15，分布稍软，
        高分页仍占优，但不会因微小的 cosine 优势就全量翻转概率。

其余参数（TRANS_SKIP, TRANS_REGRESS, TRANS_JUMP, INIT_DECAY）保持不变，
不引入额外变量，便于与 V5 做 A/B 对比。

参数对比：
  参数                  V5      V5.1
  ─────────────────────────────────────
  EMISSION_TEMPERATURE  0.10    0.15    ← 稍软，减少 premature jump
  TRANS_STAY            0.60    0.50    ← 降低停留惯性
  TRANS_NEXT            0.25    0.32    ← 增强前进 1 页倾向
  TRANS_SKIP            0.08    0.08    (不变)
  TRANS_REGRESS         0.02    0.02    (不变)
  TRANS_JUMP            0.05    0.05    (不变)
  INIT_DECAY            0.50    0.50    (不变)
"""

STRATEGY_DESCRIPTION = (
    "V5.1 — Viterbi/HMM 边界调优：EMISSION_TEMPERATURE↑(0.10→0.15)减少过早跳页，"
    "TRANS_STAY↓(0.60→0.50)+TRANS_NEXT↑(0.25→0.32)缩短换页滞后。"
    "其余参数同 V5。"
)

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# ── Thresholds ─────────────────────────────────────────────────────────────────
OFF_SLIDE_THRESHOLD: float = 0.30

# ── Emission ───────────────────────────────────────────────────────────────────
EMISSION_TEMPERATURE: float = 0.15   # V5: 0.10 → 0.15，稍软，减少 premature jump

# ── Transition probabilities ───────────────────────────────────────────────────
TRANS_STAY    : float = 0.50   # V5: 0.60 → 0.50，降低停留惯性
TRANS_NEXT    : float = 0.32   # V5: 0.25 → 0.32，增强前进 1 页倾向
TRANS_SKIP    : float = 0.08   # 不变
TRANS_REGRESS : float = 0.02   # 不变
TRANS_JUMP    : float = 0.05   # 不变

# ── Initial probability ────────────────────────────────────────────────────────
INIT_DECAY: float = 0.5        # 不变


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


# ── HMM 矩阵构建 ───────────────────────────────────────────────────────────────

def _build_log_emission(sim_matrix: np.ndarray, temperature: float) -> np.ndarray:
    """
    将 cosine 相似度矩阵转为对数发射概率。
    softmax(sim / temperature) 归一化后取对数。shape (S, P)。
    """
    scaled = sim_matrix / temperature                         # (S, P)
    scaled -= scaled.max(axis=1, keepdims=True)              # 数值稳定
    exp_scaled = np.exp(scaled)
    probs = exp_scaled / exp_scaled.sum(axis=1, keepdims=True)
    return np.log(probs + 1e-12)                             # (S, P)


def _build_log_transition(n_pages: int) -> np.ndarray:
    """
    构建对数转移概率矩阵 (P, P)。
    规则同 V5，但 TRANS_STAY / TRANS_NEXT 使用 V5.1 调优值。
    """
    trans = np.zeros((n_pages, n_pages), dtype=np.float64)

    for i in range(n_pages):
        row = np.zeros(n_pages, dtype=np.float64)
        for j in range(n_pages):
            delta = j - i
            if delta == 0:
                row[j] = TRANS_STAY
            elif delta == 1:
                row[j] = TRANS_NEXT
            elif delta == 2:
                row[j] = TRANS_SKIP
            elif delta < 0:
                row[j] = TRANS_REGRESS ** abs(delta)
            else:
                row[j] = TRANS_JUMP ** (delta - 2)

        total = row.sum()
        if total > 0:
            row /= total
        trans[i] = row

    return np.log(trans + 1e-12)   # (P, P)


def _build_log_initial(n_pages: int) -> np.ndarray:
    """
    构建对数初始概率向量 (P,)。Slide 1 最可能，指数衰减。
    """
    init = np.array([INIT_DECAY ** i for i in range(n_pages)], dtype=np.float64)
    init /= init.sum()
    return np.log(init + 1e-12)


# ── Viterbi 解码 ───────────────────────────────────────────────────────────────

def _viterbi(
    log_emission: np.ndarray,   # (S, P)
    log_transition: np.ndarray, # (P, P)
    log_initial: np.ndarray,    # (P,)
) -> np.ndarray:
    """
    标准 Viterbi 算法（对数概率空间）。返回最优页面序列 (S,)，0-based。
    """
    S, P = log_emission.shape

    viterbi = np.full((S, P), -np.inf, dtype=np.float64)
    backptr = np.zeros((S, P), dtype=np.int32)

    viterbi[0] = log_initial + log_emission[0]

    for t in range(1, S):
        trans_scores = viterbi[t - 1, :, np.newaxis] + log_transition  # (P, P)
        backptr[t] = np.argmax(trans_scores, axis=0)                    # (P,)
        viterbi[t] = trans_scores[backptr[t], np.arange(P)] + log_emission[t]

    best_path = np.zeros(S, dtype=np.int32)
    best_path[-1] = int(np.argmax(viterbi[-1]))
    for t in range(S - 2, -1, -1):
        best_path[t] = backptr[t + 1, best_path[t + 1]]

    return best_path


# ── Public entry point ─────────────────────────────────────────────────────────

def build_page_timeline(
    ppt_pages: list[dict],
    segments: list[dict],
    user_anchors: Optional[list[dict]] = None,
    total_audio_duration: float = 0.0,
) -> list[dict]:
    """
    Build per-page timeline — V5.1 (Viterbi/HMM boundary-tuned).
    Interface identical to V5 / other strategy modules.
    """
    if not ppt_pages or not segments:
        return _empty_timeline(ppt_pages, total_audio_duration)

    client, embed_model = _get_client()

    page_texts = [p.get("ppt_text", "") or f"Page {p['page_num']}" for p in ppt_pages]
    seg_texts  = [s["text"] for s in segments]

    page_embeddings = _embed_texts(page_texts, client, embed_model)  # (P, D)
    seg_embeddings  = _embed_texts(seg_texts,  client, embed_model)  # (S, D)

    sim_matrix = _cosine_similarity(seg_embeddings, page_embeddings)  # (S, P)

    n_pages = len(ppt_pages)

    log_emission   = _build_log_emission(sim_matrix, temperature=EMISSION_TEMPERATURE)
    log_transition = _build_log_transition(n_pages)
    log_initial    = _build_log_initial(n_pages)

    best_path = _viterbi(log_emission, log_transition, log_initial)  # (S,) 0-based

    best_scores = sim_matrix[np.arange(len(segments)), best_path]    # (S,)

    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            anchor_page_idx = anchor["page_num"] - 1
            if 0 <= anchor_page_idx < n_pages:
                closest = int(np.argmin(np.abs(seg_starts - anchor["timestamp"])))
                best_path[closest]   = anchor_page_idx
                best_scores[closest] = 1.0

    page_map: dict[int, dict] = {
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

    for i, seg in enumerate(segments):
        score    = float(best_scores[i])
        page_idx = int(best_path[i])
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
