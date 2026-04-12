"""
Semantic alignment service — Strategy V4.1 (Two-Stage Stateful · Forward-Sensitive)

基于 V4 的迭代版本，专项修复 Gemini 分析报告中的"Drag-Back"效应：

问题 — Smoothing Overcorrection（过度平滑 / 拖拽回退）
  根因分析：
    1. DEBOUNCE_K=2：连续 2 句都指向新页才切换，导致合理的换页被强制延迟 2 句，
       即使信号清晰（如"One is called parameter"这种明确句）也会被吸收到旧页。
    2. PENALTY_NEXT=0.1 相对于 PENALTY_STAY=0.0 的差距太小，不足以阻止倒退：
       从新页面偶发倒退的成本（PENALTY_PREV=0.3）远低于"跳跃"(PENALTY_JUMP=0.8)，
       使得 tracker 在过渡期间会在 prev/current 之间震荡，而非坚持前进。
    3. CONTEXT_WINDOW=2 的滑窗分类把前 2 句旧页内容纳入均值，
       拉低了新页真实句子的 context_sim，使其被错误分类为 filler（而非 extends）。

  修复策略：
    A. DEBOUNCE_K: 2 → 1（前向触发更灵敏：单句明确信号即可换页）
       仅对"前进"方向降低阈值；后退/跳跃仍保持原有 penalty。
    B. PENALTY_NEXT: 0.1 → 0.05（降低前进 1 页的代价，鼓励跟随有力信号）
    C. PENALTY_PREV: 0.3 → 0.5（提高后退成本，防止换页后被拉回）
    D. CONTEXT_WINDOW: 2 → 1（缩小滑窗，避免旧页内容污染新页过渡句的均值）

  保持不变：PENALTY_JUMP(0.8)、BELONGS_THRESHOLD(0.45)、CONTEXT_SIM_THRESHOLD(0.45)。

参数对比：
  参数                    V4      V4.1
  ────────────────────────────────────────
  DEBOUNCE_K              2       1       ← 前向触发更灵敏
  PENALTY_NEXT            0.1     0.05    ← 降低前进代价
  PENALTY_PREV            0.3     0.5     ← 提高后退成本
  PENALTY_JUMP            0.8     0.8     (不变)
  CONTEXT_WINDOW          2       1       ← 缩小分类滑窗
  BELONGS_THRESHOLD       0.45    0.45    (不变)
  CONTEXT_SIM_THRESHOLD   0.45    0.45    (不变)
"""

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# ── Module-level constants ────────────────────────────────────────────────────

STRATEGY_DESCRIPTION = (
    "V4.1 — 两阶段有状态跟踪（前向敏感修复）："
    "DEBOUNCE_K↓(2→1)前向单句触发 + PENALTY_NEXT↓(0.10→0.05)降低前进代价 "
    "+ PENALTY_PREV↑(0.30→0.50)提高回退成本 + CONTEXT_WINDOW↓(2→1)缩小分类滑窗。"
    "修复 V4 的 Drag-Back 效应。"
)

# Stage 1 — SlideTracker
ALPHA: float = 1.0
DEBOUNCE_K: int = 1           # V4: 2 → 1，前向触发更灵敏

PENALTY_STAY: float = 0.0
PENALTY_NEXT: float = 0.05    # V4: 0.10 → 0.05，降低前进代价
PENALTY_PREV: float = 0.50    # V4: 0.30 → 0.50，提高后退成本
PENALTY_JUMP: float = 0.8     # 不变

# Stage 2 — SentenceClassifier
BELONGS_THRESHOLD: float = 0.45
CONTEXT_SIM_THRESHOLD: float = 0.45
CONTEXT_WINDOW: int = 1       # V4: 2 → 1，缩小滑窗防止旧页污染

# Off-slide
OFF_SLIDE_THRESHOLD: float = 0.25


# ── OpenAI helpers ────────────────────────────────────────────────────────────

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


def _cosine_sim_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_n = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)
    b_n = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-8)
    return a_n @ b_n.T


# ── Stage 1: SlideTracker ─────────────────────────────────────────────────────

class SlideTracker:
    """
    State machine tracking current slide.

    V4.1 变化：
    - DEBOUNCE_K=1：前进方向只需 1 句连续投票即切换（更灵敏）
    - PENALTY_NEXT 降低，PENALTY_PREV 提高：非对称惩罚，鼓励前进、抑制后退
    """

    def __init__(
        self,
        n_slides: int,
        alpha: float = ALPHA,
        debounce_k: int = DEBOUNCE_K,
        penalty_stay: float = PENALTY_STAY,
        penalty_next: float = PENALTY_NEXT,
        penalty_prev: float = PENALTY_PREV,
        penalty_jump: float = PENALTY_JUMP,
    ) -> None:
        self.n_slides = n_slides
        self.alpha = alpha
        self.debounce_k = debounce_k
        self.penalty = {
            "stay": penalty_stay,
            "next": penalty_next,
            "prev": penalty_prev,
            "jump": penalty_jump,
        }

        self.current_idx: int = 0
        self._debounce_candidate: int = -1
        self._debounce_count: int = 0

    def _penalty_for(self, target_idx: int) -> float:
        delta = target_idx - self.current_idx
        if delta == 0:
            return self.penalty["stay"]
        if delta == 1:
            return self.penalty["next"]
        if delta == -1:
            return self.penalty["prev"]
        # 后退多步：每步叠加 prev 惩罚
        if delta < -1:
            return self.penalty["prev"] * abs(delta)
        # 前进 >1 步：jump 惩罚
        return self.penalty["jump"]

    def step(self, seg_cosines: np.ndarray) -> int:
        scores = np.array([
            self.alpha * seg_cosines[i] - self._penalty_for(i)
            for i in range(self.n_slides)
        ])
        best_idx = int(np.argmax(scores))

        if best_idx != self.current_idx:
            if best_idx == self._debounce_candidate:
                self._debounce_count += 1
            else:
                self._debounce_candidate = best_idx
                self._debounce_count = 1

            if self._debounce_count >= self.debounce_k:
                self.current_idx = best_idx
                self._debounce_candidate = -1
                self._debounce_count = 0
        else:
            self._debounce_candidate = -1
            self._debounce_count = 0

        return self.current_idx


# ── Stage 2: SentenceClassifier ──────────────────────────────────────────────

class SentenceClassifier:
    """
    Classify a sentence relative to its locked slide (from Stage 1).

    V4.1 变化：CONTEXT_WINDOW=1，避免旧页内容污染新页过渡句的滑窗均值。
    """

    def __init__(
        self,
        belongs_threshold: float = BELONGS_THRESHOLD,
        context_sim_threshold: float = CONTEXT_SIM_THRESHOLD,
        context_window: int = CONTEXT_WINDOW,
    ) -> None:
        self.belongs_threshold = belongs_threshold
        self.context_sim_threshold = context_sim_threshold
        self.context_window = context_window

    def _sliding_window_sim(
        self,
        seg_idx: int,
        seg_vecs: np.ndarray,
        locked_page_vec: np.ndarray,
    ) -> float:
        start = max(0, seg_idx - self.context_window)
        window_vecs = seg_vecs[start: seg_idx + 1]
        page_vec = locked_page_vec[np.newaxis, :]
        sims = _cosine_sim_matrix(window_vecs, page_vec)
        return float(sims.mean())

    def classify(
        self,
        seg_idx: int,
        seg_cosine: float,
        seg_vecs: np.ndarray,
        locked_page_vec: np.ndarray,
    ) -> tuple[str, float]:
        if seg_cosine >= self.belongs_threshold:
            return "belongs", 0.0

        ctx_sim = self._sliding_window_sim(seg_idx, seg_vecs, locked_page_vec)
        if ctx_sim >= self.context_sim_threshold:
            return "extends", ctx_sim
        return "filler", ctx_sim


# ── Pipeline orchestrator ─────────────────────────────────────────────────────

class LiberStudyAlignmentPipeline:
    def __init__(
        self,
        page_vecs: np.ndarray,
        seg_vecs: np.ndarray,
    ) -> None:
        self.page_vecs = page_vecs
        self.seg_vecs = seg_vecs
        self.sim_matrix = _cosine_sim_matrix(seg_vecs, page_vecs)

        n_slides = page_vecs.shape[0]
        self.tracker = SlideTracker(n_slides=n_slides)
        self.classifier = SentenceClassifier()

    def run(self, segments: list[dict], ppt_pages: list[dict]) -> list[dict]:
        results = []
        for i, seg in enumerate(segments):
            seg_cosines = self.sim_matrix[i]
            locked_idx = self.tracker.step(seg_cosines)
            locked_cosine = float(seg_cosines[locked_idx])
            locked_page_vec = self.page_vecs[locked_idx]
            cls, ctx_sim = self.classifier.classify(
                i, locked_cosine, self.seg_vecs, locked_page_vec
            )
            result = {
                **seg,
                "locked_slide_idx": locked_idx,
                "page_num": ppt_pages[locked_idx]["page_num"],
                "similarity": round(locked_cosine, 4),
                "segment_class": cls,
            }
            if ctx_sim > 0.0:
                result["context_similarity"] = round(ctx_sim, 4)
            results.append(result)
        return results


# ── Public entry point ────────────────────────────────────────────────────────

def build_page_timeline(
    ppt_pages: list[dict],
    segments: list[dict],
    user_anchors: Optional[list[dict]] = None,
    total_audio_duration: float = 0.0,
) -> list[dict]:
    """
    Build a per-page timeline using the V4.1 two-stage alignment pipeline.
    Interface identical to V4 / other strategy modules.
    """
    if not ppt_pages or not segments:
        return _empty_timeline(ppt_pages, total_audio_duration)

    client, embed_model = _get_client()
    page_texts = [p.get("ppt_text", "") or f"Page {p['page_num']}" for p in ppt_pages]
    seg_texts = [s["text"] for s in segments]

    all_vecs = _embed_texts(page_texts + seg_texts, client, embed_model)
    page_vecs = all_vecs[: len(page_texts)]
    seg_vecs = all_vecs[len(page_texts):]

    pipeline = LiberStudyAlignmentPipeline(page_vecs, seg_vecs)
    seg_results = pipeline.run(segments, ppt_pages)

    if user_anchors:
        seg_starts = np.array([s["start"] for s in segments])
        for anchor in user_anchors:
            aidx = anchor["page_num"] - 1
            if 0 <= aidx < len(ppt_pages):
                closest = int(np.argmin(np.abs(seg_starts - anchor["timestamp"])))
                seg_results[closest]["locked_slide_idx"] = aidx
                seg_results[closest]["page_num"] = ppt_pages[aidx]["page_num"]
                seg_results[closest]["similarity"] = 1.0
                seg_results[closest]["segment_class"] = "belongs"

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

    for r in seg_results:
        page_num = r["page_num"]
        seg_dict = {k: v for k, v in r.items() if k != "locked_slide_idx"}
        page_map[page_num]["aligned_segments"].append(seg_dict)

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

        entry["page_supplement"] = None
        results.append(entry)

    _fill_time_gaps(results, total_audio_duration)
    return results


# ── Utility helpers ───────────────────────────────────────────────────────────

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
