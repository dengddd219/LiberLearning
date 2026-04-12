"""
Semantic alignment service — Strategy V4.

两阶段有状态跟踪与分类（Two-Stage Stateful Tracking & Classification）：

Stage 1 — SlideTracker（状态机）：
  模拟人线性听课行为。维护 current_slide_index，对每条 ASR 句段，
  用 cosine + 惩罚矩阵 + K=2 防抖，决定当前句属于哪张幻灯片。

  惩罚矩阵：
    - 停留原页     : 0
    - 前进 1 页    : 0.1
    - 后退 1 页    : 0.3
    - 跳跃 (>1步)  : 0.8

Stage 2 — SentenceClassifier（语境分类）：
  在 Stage 1 锁定的目标页上，将句段分为：
    - belongs : cosine(seg, page) >= BELONGS_THRESHOLD
    - extends : cosine < BELONGS_THRESHOLD，但滑窗均值 >= CONTEXT_SIM_THRESHOLD
    - filler  : 其他
"""

import os
from typing import Optional

import numpy as np
from openai import OpenAI

# ── Module-level constants (可由测试平台覆盖) ────────────────────────────────

STRATEGY_DESCRIPTION = (
    "V4 — 两阶段有状态跟踪：惩罚矩阵状态机(Stay=0, +1=0.1, -1=0.3, Jump=0.8) "
    "+ K=2防抖锁页，再做三分类(belongs/extends/filler)。"
)

# Stage 1
ALPHA: float = 1.0           # cosine 权重（保留供未来调参）
DEBOUNCE_K: int = 2          # 连续 K 句票给下一页才切换

PENALTY_STAY: float = 0.0
PENALTY_NEXT: float = 0.1
PENALTY_PREV: float = 0.3
PENALTY_JUMP: float = 0.8

# Stage 2
BELONGS_THRESHOLD: float = 0.45
CONTEXT_SIM_THRESHOLD: float = 0.45   # 与 Stage1 候选页的滑窗均值阈值
CONTEXT_WINDOW: int = 2

# Off-slide（供测试平台 threshold 滑块覆盖）
OFF_SLIDE_THRESHOLD: float = 0.25


# ── OpenAI helpers ──────────────────────────────────────────────────────────

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
    """Compute cosine similarity matrix (S, P) where a:(S,D), b:(P,D)."""
    a_n = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)
    b_n = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-8)
    return a_n @ b_n.T


# ── Stage 1: SlideTracker ────────────────────────────────────────────────────

class SlideTracker:
    """
    State machine that tracks which slide the current ASR sentence belongs to.

    For each sentence, computes:
        score(i) = alpha * cosine(seg, slide_i) - penalty(current -> i)

    The tracked slide advances only when the same candidate wins for K consecutive
    sentences (debounce), preventing spurious jumps.
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

        self.current_idx: int = 0          # zero-based slide index
        self._debounce_candidate: int = -1  # candidate slide being accumulated
        self._debounce_count: int = 0

    def _penalty_for(self, target_idx: int) -> float:
        delta = target_idx - self.current_idx
        if delta == 0:
            return self.penalty["stay"]
        if delta == 1:
            return self.penalty["next"]
        if delta == -1:
            return self.penalty["prev"]
        return self.penalty["jump"]

    def step(self, seg_cosines: np.ndarray) -> int:
        """
        Process one ASR sentence.

        Parameters
        ----------
        seg_cosines : np.ndarray  shape (n_slides,)
            Cosine similarities between the current sentence and every slide.

        Returns
        -------
        int
            Zero-based index of the locked slide after this step.
        """
        scores = np.array([
            self.alpha * seg_cosines[i] - self._penalty_for(i)
            for i in range(self.n_slides)
        ])
        best_idx = int(np.argmax(scores))

        # Debounce: accumulate votes toward best_idx
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
            # Best is current slide: reset debounce
            self._debounce_candidate = -1
            self._debounce_count = 0

        return self.current_idx


# ── Stage 2: SentenceClassifier ─────────────────────────────────────────────

class SentenceClassifier:
    """
    Classify a sentence relative to its locked slide (from Stage 1).

    belongs : cosine(seg, slide) >= BELONGS_THRESHOLD
    extends : cosine < BELONGS_THRESHOLD, but sliding-window context mean >= CONTEXT_SIM_THRESHOLD
    filler  : neither
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
        """
        Mean cosine similarity of the current sentence + previous `context_window`
        sentences against the locked page vector.
        """
        start = max(0, seg_idx - self.context_window)
        window_vecs = seg_vecs[start: seg_idx + 1]   # includes current
        page_vec = locked_page_vec[np.newaxis, :]     # (1, D)
        sims = _cosine_sim_matrix(window_vecs, page_vec)  # (k, 1)
        return float(sims.mean())

    def classify(
        self,
        seg_idx: int,
        seg_cosine: float,
        seg_vecs: np.ndarray,
        locked_page_vec: np.ndarray,
    ) -> tuple[str, float]:
        """
        Returns
        -------
        (class_label, context_sim)
            class_label : 'belongs' | 'extends' | 'filler'
            context_sim : sliding-window similarity (0 if belongs)
        """
        if seg_cosine >= self.belongs_threshold:
            return "belongs", 0.0

        ctx_sim = self._sliding_window_sim(seg_idx, seg_vecs, locked_page_vec)
        if ctx_sim >= self.context_sim_threshold:
            return "extends", ctx_sim
        return "filler", ctx_sim


# ── Pipeline orchestrator ────────────────────────────────────────────────────

class LiberStudyAlignmentPipeline:
    """
    Orchestrates SlideTracker + SentenceClassifier for full alignment.

    Inputs  : pre-computed embedding matrices (page_vecs, seg_vecs)
    Outputs : per-segment dicts with page_num, segment_class, similarity, etc.
    """

    def __init__(
        self,
        page_vecs: np.ndarray,
        seg_vecs: np.ndarray,
    ) -> None:
        self.page_vecs = page_vecs   # (P, D)
        self.seg_vecs = seg_vecs     # (S, D)
        self.sim_matrix = _cosine_sim_matrix(seg_vecs, page_vecs)  # (S, P)

        n_slides = page_vecs.shape[0]
        self.tracker = SlideTracker(n_slides=n_slides)
        self.classifier = SentenceClassifier()

    def run(self, segments: list[dict], ppt_pages: list[dict]) -> list[dict]:
        """
        Run the two-stage pipeline on all segments.

        Returns a flat list of segment result dicts (one per input segment).
        """
        results = []
        for i, seg in enumerate(segments):
            seg_cosines = self.sim_matrix[i]                     # (P,)
            locked_idx = self.tracker.step(seg_cosines)          # Stage 1
            locked_cosine = float(seg_cosines[locked_idx])
            locked_page_vec = self.page_vecs[locked_idx]
            cls, ctx_sim = self.classifier.classify(             # Stage 2
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


# ── Public entry point (matches strategy interface) ─────────────────────────

def build_page_timeline(
    ppt_pages: list[dict],
    segments: list[dict],
    user_anchors: Optional[list[dict]] = None,
    total_audio_duration: float = 0.0,
) -> list[dict]:
    """
    Build a per-page timeline using the V4 two-stage alignment pipeline.
    Interface identical to other strategy modules.
    """
    if not ppt_pages or not segments:
        return _empty_timeline(ppt_pages, total_audio_duration)

    client, embed_model = _get_client()
    page_texts = [p.get("ppt_text", "") or f"Page {p['page_num']}" for p in ppt_pages]
    seg_texts = [s["text"] for s in segments]

    all_vecs = _embed_texts(page_texts + seg_texts, client, embed_model)
    page_vecs = all_vecs[: len(page_texts)]   # (P, D)
    seg_vecs = all_vecs[len(page_texts):]      # (S, D)

    # Optional: apply user anchors as hard overrides after Stage 1
    pipeline = LiberStudyAlignmentPipeline(page_vecs, seg_vecs)
    seg_results = pipeline.run(segments, ppt_pages)

    # User anchor hard overrides (override locked slide)
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

    # Assemble per-page output
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
    last_page_num = ppt_pages[0]["page_num"]

    for r in seg_results:
        page_num = r["page_num"]
        cls = r["segment_class"]
        seg_dict = {k: v for k, v in r.items() if k != "locked_slide_idx"}

        if cls == "filler":
            page_map[last_page_num]["off_slide_segments"].append(seg_dict)
        else:
            page_map[page_num]["aligned_segments"].append(seg_dict)
            last_page_num = page_num

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

        entry["page_supplement"] = (
            {
                "content": " ".join(s["text"] for s in off_slide),
                "timestamp_start": off_slide[0]["start"],
                "timestamp_end": off_slide[-1]["end"],
            }
            if off_slide
            else None
        )
        results.append(entry)

    _fill_time_gaps(results, total_audio_duration)
    return results


# ── Utility helpers ──────────────────────────────────────────────────────────

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


# ── Demo / unit test ─────────────────────────────────────────────────────────

def main() -> None:
    """
    Mock demo: 5 slides × 10 segments.

    Segment 0-3 are clearly Slide 0.
    Segment 4 is ambiguous (low similarity, tests debounce).
    Segments 5-6 both vote for Slide 1 → debounce fires, tracker advances.
    Segments 7-9 are Slide 2.
    """
    import textwrap

    rng = np.random.default_rng(42)
    D = 16   # small embedding dim for demo

    # Slide embeddings: each slide is a unit vector in a random direction
    raw_page = rng.standard_normal((5, D)).astype(np.float32)
    page_vecs = raw_page / np.linalg.norm(raw_page, axis=1, keepdims=True)

    # Build segment embeddings
    # Segs 0-3: close to slide 0
    # Seg  4  : noisy (tests debounce — single vote for slide 1, should NOT advance)
    # Segs 5-6: close to slide 1 (two consecutive votes → debounce fires)
    # Segs 7-9: close to slide 2
    def _noisy(vec, noise=0.05):
        v = vec + rng.standard_normal(D).astype(np.float32) * noise
        return v / np.linalg.norm(v)

    seg_vecs = np.stack([
        _noisy(page_vecs[0]),     # 0 → slide 0
        _noisy(page_vecs[0]),     # 1 → slide 0
        _noisy(page_vecs[0]),     # 2 → slide 0
        _noisy(page_vecs[0]),     # 3 → slide 0
        _noisy(page_vecs[1], noise=0.9),  # 4 → ambiguous (noisy slide 1)
        _noisy(page_vecs[1]),     # 5 → slide 1  (1st vote)
        _noisy(page_vecs[1]),     # 6 → slide 1  (2nd vote → debounce trips)
        _noisy(page_vecs[2]),     # 7 → slide 2
        _noisy(page_vecs[2]),     # 8 → slide 2
        _noisy(page_vecs[2]),     # 9 → slide 2
    ])

    sim_matrix = _cosine_sim_matrix(seg_vecs, page_vecs)

    tracker = SlideTracker(n_slides=5)
    classifier = SentenceClassifier()

    print("=" * 60)
    print("V4 Two-Stage Alignment Demo")
    print("=" * 60)
    print(f"{'Seg':>3}  {'cos→slide':>10}  {'tracked':>7}  {'class':>7}  note")
    print("-" * 60)

    for i in range(len(seg_vecs)):
        locked_idx = tracker.step(sim_matrix[i])
        cosine = float(sim_matrix[i, locked_idx])
        cls, ctx = classifier.classify(i, cosine, seg_vecs, page_vecs[locked_idx])
        best_raw = int(np.argmax(sim_matrix[i]))
        note = ""
        if i == 4:
            note = "← ambiguous: debounce should HOLD"
        if i == 6:
            note = "← 2nd vote: tracker ADVANCES to slide 1"
        print(
            f"{i:>3}  raw_best={best_raw}  locked={locked_idx}  {cls:>7}"
            + (f"  ctx={ctx:.3f}" if ctx > 0 else "")
            + (f"  {note}" if note else "")
        )

    print("=" * 60)
    print(textwrap.dedent("""
    Expected:
      Segs 0-3  → locked=0 (slide 0, belongs)
      Seg  4    → locked=0 (debounce holds, ambiguous → extends/filler)
      Segs 5-6  → seg5 locked=0 (1st vote, not yet), seg6 locked=1 (tracker advances)
      Segs 7-9  → locked=2 (slide 2)
    """))


if __name__ == "__main__":
    main()
