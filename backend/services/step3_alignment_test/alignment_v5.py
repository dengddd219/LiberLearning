"""
Semantic alignment service — Strategy V5 (Viterbi/HMM)

全局最优路径解码（Global Sequence Decoding via Viterbi）。

核心思想：
─────────────────────────────────────────────────────────────────────────────
V1.x 系列是"逐句打分 → 事后平滑"两步走，时间约束是补丁。
V4 是在线状态机，每句话做局部最优决策，无法回溯修正。
V5 用 Viterbi 算法一次性找到整条时间线上概率最高的页面序列，
把语义相似度信号和时序转移代价同时纳入全局优化目标。

HMM 三要素：
  1. 发射概率 (Emission) : P(sentence_i | slide_k) ∝ cosine(seg_i, slide_k)
     将 cosine sim 归一化为概率分布（softmax over slides）。

  2. 转移概率 (Transition) : P(slide_j | slide_i) — 编码"时间箭头"
     - 停留同页     : 高概率（TRANS_STAY）
     - 前进 1 页    : 中概率（TRANS_NEXT）
     - 前进 2 页    : 较低（TRANS_SKIP）
     - 倒退任意步   : 极低（TRANS_REGRESS）
     - 跳跃 >2 步   : 极低（TRANS_JUMP）

  3. 初始概率 (Initial) : 从第 1 页开始的概率最高，指数衰减。

Viterbi 解码：
  在对数概率空间（log-domain）计算，避免浮点下溢。
  输出全局最优页面序列，而非逐句贪心结果。

优势 vs V1.x/V4：
  - 单调性是内置约束，不是补丁：倒退转移概率极低，天然抑制"Slide 1 黑洞"
  - 全局最优：每句话的分配考虑了整条时间线的联合概率
  - 理论上限高于所有后处理方案

参数：
  EMISSION_TEMPERATURE : float = 0.1   — softmax 温度；越小越"确信"高分页
  TRANS_STAY           : float = 0.60  — 停留同页的转移概率
  TRANS_NEXT           : float = 0.25  — 前进 1 页
  TRANS_SKIP           : float = 0.08  — 前进 2 页
  TRANS_REGRESS        : float = 0.02  — 任意倒退（共享）
  TRANS_JUMP           : float = 0.05  — 跳跃 >2 页（剩余均分）
  INIT_DECAY           : float = 0.5   — 初始概率指数衰减因子（每页衰减到前页的 INIT_DECAY 倍）
─────────────────────────────────────────────────────────────────────────────
"""

STRATEGY_DESCRIPTION = (
    "V5 — Viterbi/HMM 全局解码：发射概率(cosine softmax) + 转移概率(倒退极低/前进正常) "
    "+ 初始概率(首页优先)，一次性找全局最优页面序列。时间单调性内置，无后处理补丁。"
)

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# ── Thresholds ─────────────────────────────────────────────────────────────────
OFF_SLIDE_THRESHOLD: float = 0.30

# ── Emission ───────────────────────────────────────────────────────────────────
EMISSION_TEMPERATURE: float = 0.1   # softmax 温度；越小分布越尖锐

# ── Transition probabilities ───────────────────────────────────────────────────
# 约束：每行加权和不超过 1（剩余概率按跳跃分配）
TRANS_STAY    : float = 0.60   # 停留同页
TRANS_NEXT    : float = 0.25   # 前进 1 页
TRANS_SKIP    : float = 0.08   # 前进 2 页
TRANS_REGRESS : float = 0.02   # 任意倒退（每步）
TRANS_JUMP    : float = 0.05   # 前进 >2 页（每步）

# ── Initial probability ────────────────────────────────────────────────────────
INIT_DECAY: float = 0.5   # 每页衰减因子；Slide 1 概率最高


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

    对每句话，用 softmax(sim / temperature) 将相似度归一化为概率分布，
    再取对数。temperature 越小，高分页的概率越集中。

    返回 shape (S, P) 的 log-emission 矩阵。
    """
    scaled = sim_matrix / temperature                         # (S, P)
    scaled -= scaled.max(axis=1, keepdims=True)              # 数值稳定
    exp_scaled = np.exp(scaled)
    probs = exp_scaled / exp_scaled.sum(axis=1, keepdims=True)
    return np.log(probs + 1e-12)                             # (S, P)


def _build_log_transition(n_pages: int) -> np.ndarray:
    """
    构建对数转移概率矩阵 (P, P)，其中 log_trans[i, j] = log P(j | i)。

    转移规则（从页 i 到页 j）：
      delta = j - i
      delta == 0  : TRANS_STAY
      delta == 1  : TRANS_NEXT
      delta == 2  : TRANS_SKIP
      delta < 0   : TRANS_REGRESS（每步，绝对值越大越低）
      delta > 2   : TRANS_JUMP（每步，线性衰减）

    每行归一化确保为合法概率分布。
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
                # 倒退：距离越远惩罚越重
                row[j] = TRANS_REGRESS ** abs(delta)
            else:
                # 跳跃 >2：距离越远惩罚越重
                row[j] = TRANS_JUMP ** (delta - 2)

        # 归一化
        total = row.sum()
        if total > 0:
            row /= total
        trans[i] = row

    return np.log(trans + 1e-12)   # (P, P)


def _build_log_initial(n_pages: int) -> np.ndarray:
    """
    构建对数初始概率向量 (P,)。

    Slide 1 最可能是起点，按指数衰减：
      init[0] ∝ 1, init[1] ∝ INIT_DECAY, init[2] ∝ INIT_DECAY^2, ...

    归一化后取对数。
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
    标准 Viterbi 算法，在对数概率空间计算。

    返回最优页面序列 best_path，shape (S,)，值为 0-based page index。
    """
    S, P = log_emission.shape

    # viterbi[t, j] = 到时刻 t、状态为 j 的最大 log 概率
    viterbi = np.full((S, P), -np.inf, dtype=np.float64)
    backptr = np.zeros((S, P), dtype=np.int32)

    # 初始化 t=0
    viterbi[0] = log_initial + log_emission[0]

    # 递推
    for t in range(1, S):
        # (P_prev, 1) + (P_prev, P_next) → 对每个 next 状态，找最优 prev
        trans_scores = viterbi[t - 1, :, np.newaxis] + log_transition  # (P, P)
        backptr[t] = np.argmax(trans_scores, axis=0)                    # (P,)
        viterbi[t] = trans_scores[backptr[t], np.arange(P)] + log_emission[t]  # (P,)

    # 回溯
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
    Build per-page timeline — V5 (Viterbi/HMM global sequence decoding).

    Pipeline:
      1. Embed pages + segments
      2. Build log-emission matrix (cosine softmax)
      3. Build log-transition matrix (monotonic prior)
      4. Build log-initial vector (first slide preferred)
      5. Viterbi decode → global optimal page sequence
      6. Apply user anchors as hard overrides
      7. Assemble output
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

    # Step 2-4: 构建 HMM 矩阵
    log_emission   = _build_log_emission(sim_matrix, temperature=EMISSION_TEMPERATURE)
    log_transition = _build_log_transition(n_pages)
    log_initial    = _build_log_initial(n_pages)

    # Step 5: Viterbi 全局解码
    best_path = _viterbi(log_emission, log_transition, log_initial)  # (S,) 0-based idx

    # 从 sim_matrix 取出每句对应的 cosine 得分（用于置信度显示）
    best_scores = sim_matrix[np.arange(len(segments)), best_path]    # (S,)

    # Step 6: user anchors 硬覆盖
    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            anchor_page_idx = anchor["page_num"] - 1
            if 0 <= anchor_page_idx < n_pages:
                closest = int(np.argmin(np.abs(seg_starts - anchor["timestamp"])))
                best_path[closest]   = anchor_page_idx
                best_scores[closest] = 1.0

    # Step 7: 组装输出
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
