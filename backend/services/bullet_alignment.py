"""
Bullet-level alignment service.
Three methods to assign transcript segments to individual PPT bullet points:
  A — Embedding cosine similarity (fast, cheap, lower accuracy on similar bullets)
  B — LLM explicit attribution (slow, accurate)
  C — Embedding pre-filter + LLM refine (balanced)

All methods return: list[dict] where each dict is:
  {"segment_idx": int, "bullet_idx": int, "confidence": float}
  bullet_idx = -1 means off-slide (not matching any bullet)
"""

import json
import os
import re
from typing import Optional

import numpy as np


def _get_bullet_lines(ppt_text: str) -> list[str]:
    """Split PPT text into individual bullet lines."""
    return [l.strip() for l in ppt_text.splitlines() if l.strip()]


def _get_openai_client():
    from openai import OpenAI
    api_key = os.environ.get("OPENAI_API_KEY", "")
    base_url = os.environ.get("OPENAI_BASE_URL", "").strip() or None
    model = os.environ.get("OPENAI_EMBEDDING_MODEL", "").strip() or "text-embedding-3-small"
    client = OpenAI(
        api_key=api_key,
        **({"base_url": base_url} if base_url else {}),
    )
    return client, model


def _get_anthropic_client():
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    model = os.environ.get("ANTHROPIC_MODEL", "").strip() or "claude-sonnet-4-6"
    client = anthropic.Anthropic(
        api_key=api_key,
        **({"base_url": base_url} if base_url else {}),
    )
    return client, model


def _embed_texts(texts: list[str], client, model) -> np.ndarray:
    """Batch-embed texts. Returns (N, D) float32 array."""
    response = client.embeddings.create(model=model, input=texts)
    vectors = [item.embedding for item in response.data]
    return np.array(vectors, dtype=np.float32)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """(len(a), len(b)) cosine similarity matrix."""
    a_norm = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-8)
    b_norm = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-8)
    return a_norm @ b_norm.T


# ═══════════════════════════════════════════════════════════════════════════════
# Method A — Pure Embedding
# ═══════════════════════════════════════════════════════════════════════════════

def align_bullets_embedding(
    ppt_text: str,
    segments: list[dict],
    off_slide_threshold: float = 0.25,
) -> list[dict]:
    """
    Method A: embed each bullet and each segment, cosine sim → argmax.
    """
    bullets = _get_bullet_lines(ppt_text)
    if not bullets or not segments:
        return []

    client, model = _get_openai_client()
    bullet_emb = _embed_texts(bullets, client, model)     # (B, D)
    seg_texts = [s["text"] for s in segments]
    seg_emb = _embed_texts(seg_texts, client, model)      # (S, D)

    sim = _cosine_similarity(seg_emb, bullet_emb)         # (S, B)
    best_idx = np.argmax(sim, axis=1)                     # (S,)
    best_scores = sim[np.arange(len(segments)), best_idx]  # (S,)

    results = []
    for i in range(len(segments)):
        score = float(best_scores[i])
        results.append({
            "segment_idx": i,
            "bullet_idx": int(best_idx[i]) if score >= off_slide_threshold else -1,
            "confidence": round(score, 4),
        })
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# Method B — Pure LLM
# ═══════════════════════════════════════════════════════════════════════════════

_LLM_ALIGN_PROMPT = """You are given a list of PPT bullet points and a list of transcript segments from a lecture.
For each transcript segment, determine which bullet point the teacher is discussing.

PPT Bullets:
{bullets}

Transcript Segments:
{segments}

Output ONLY valid JSON — an array of objects, one per segment:
[
  {{"segment_idx": 0, "bullet_idx": <0-based index or -1 if off-slide>, "confidence": <0.0-1.0>}},
  ...
]

Rules:
- bullet_idx is 0-based. Use -1 if the segment doesn't match any bullet.
- confidence: 1.0 = certain match, 0.5 = partial, <0.3 = weak guess.
- Output ONLY the JSON array. No explanation.
"""


def align_bullets_llm(
    ppt_text: str,
    segments: list[dict],
) -> list[dict]:
    """
    Method B: send all bullets + segments to LLM, ask for explicit assignment.
    """
    bullets = _get_bullet_lines(ppt_text)
    if not bullets or not segments:
        return []

    bullets_str = "\n".join(f"{i}. {b}" for i, b in enumerate(bullets))
    segs_str = "\n".join(
        f"[{i}] [{int(s['start'])//60:02d}:{int(s['start'])%60:02d}] {s['text']}"
        for i, s in enumerate(segments)
    )

    prompt = _LLM_ALIGN_PROMPT.format(bullets=bullets_str, segments=segs_str)

    client, model = _get_anthropic_client()
    response = client.messages.create(
        model=model,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text

    # Extract JSON array
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        raise ValueError(f"No JSON array in LLM response:\n{text[:300]}")

    results = json.loads(match.group())
    # Normalize
    for r in results:
        r["confidence"] = round(float(r.get("confidence", 0.5)), 4)
        r["segment_idx"] = int(r.get("segment_idx", 0))
        r["bullet_idx"] = int(r.get("bullet_idx", -1))

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# Method C — Embedding pre-filter + LLM refine
# ═══════════════════════════════════════════════════════════════════════════════

_LLM_REFINE_PROMPT = """A transcript segment from a lecture needs to be matched to one of these PPT bullet points.

Candidate bullets (ranked by embedding similarity):
{candidates}

Transcript segment:
[{ts}] {text}

Which bullet is the teacher discussing? Output ONLY valid JSON:
{{"bullet_idx": <0-based index or -1 if none match>, "confidence": <0.0-1.0>}}
"""


def align_bullets_hybrid(
    ppt_text: str,
    segments: list[dict],
    top_k: int = 3,
    off_slide_threshold: float = 0.20,
) -> list[dict]:
    """
    Method C: embedding narrows to top-K candidates, LLM picks final answer.
    """
    bullets = _get_bullet_lines(ppt_text)
    if not bullets or not segments:
        return []

    # Step 1: Embedding pre-filter
    oa_client, embed_model = _get_openai_client()
    bullet_emb = _embed_texts(bullets, oa_client, embed_model)
    seg_texts = [s["text"] for s in segments]
    seg_emb = _embed_texts(seg_texts, oa_client, embed_model)
    sim = _cosine_similarity(seg_emb, bullet_emb)  # (S, B)

    an_client, an_model = _get_anthropic_client()

    results = []
    for i, seg in enumerate(segments):
        row = sim[i]
        top_indices = np.argsort(row)[::-1][:top_k]
        top_scores = row[top_indices]

        # If best embedding score is very low, skip LLM call
        if float(top_scores[0]) < off_slide_threshold:
            results.append({
                "segment_idx": i,
                "bullet_idx": -1,
                "confidence": round(float(top_scores[0]), 4),
            })
            continue

        # Step 2: LLM refine among top-K
        candidates_str = "\n".join(
            f"{int(idx)}. {bullets[idx]} (sim={top_scores[j]:.2f})"
            for j, idx in enumerate(top_indices)
        )
        ts = int(seg["start"])
        prompt = _LLM_REFINE_PROMPT.format(
            candidates=candidates_str,
            ts=f"{ts//60:02d}:{ts%60:02d}",
            text=seg["text"],
        )

        try:
            resp = an_client.messages.create(
                model=an_model,
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}],
            )
            resp_text = resp.content[0].text
            match = re.search(r"\{[\s\S]*\}", resp_text)
            if match:
                data = json.loads(match.group())
                results.append({
                    "segment_idx": i,
                    "bullet_idx": int(data.get("bullet_idx", -1)),
                    "confidence": round(float(data.get("confidence", 0.5)), 4),
                })
            else:
                results.append({
                    "segment_idx": i,
                    "bullet_idx": int(top_indices[0]),
                    "confidence": round(float(top_scores[0]), 4),
                })
        except Exception:
            # Fallback to embedding top-1
            results.append({
                "segment_idx": i,
                "bullet_idx": int(top_indices[0]),
                "confidence": round(float(top_scores[0]), 4),
            })

    return results
