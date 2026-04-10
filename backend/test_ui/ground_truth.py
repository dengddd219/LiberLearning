"""
Ground Truth tab — bullet alignment labeling + accuracy metrics.
"""
import streamlit as st

from test_ui.helpers import (
    _asr_path, _ppt_path, _gt_path, _aligned_path,
    _load_json, _save_json, _render_accuracy_table,
)


def render_ground_truth():
    st.title("Ground Truth — Bullet Alignment Labeling")
    st.caption("Label which transcript segment matches each PPT bullet. "
               "Used to compute accuracy metrics for the three alignment methods.")

    asr = _asr_path()
    ppt = _ppt_path()
    gt  = _gt_path()

    if not asr.exists() or not ppt.exists():
        st.warning("Complete Steps 1 and 2 in the Pipeline tab first.")
        return

    segments  = _load_json(asr)
    ppt_pages = _load_json(ppt)
    gt_data   = _load_json(gt) if gt.exists() else {}

    seg_labels = [
        f"[{int(s['start'])//60:02d}:{int(s['start'])%60:02d}] {s['text'][:60]}…"
        for s in segments
    ]
    seg_idx = st.selectbox("Select transcript segment to label",
                           range(len(segments)),
                           format_func=lambda i: seg_labels[i])
    seg = segments[seg_idx]

    ts, te = int(seg["start"]), int(seg["end"])
    st.info(f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}] {seg['text']}")

    page_labels = [f"Slide {p['page_num']}" for p in ppt_pages]
    page_idx = st.selectbox("Which slide?", range(len(ppt_pages)),
                            format_func=lambda i: page_labels[i])
    page = ppt_pages[page_idx]

    bullet_lines   = [l.strip() for l in page["ppt_text"].splitlines() if l.strip()]
    bullet_options = ["(off-slide — not on PPT)"] + bullet_lines
    bullet_idx = st.radio("Which bullet point?", range(len(bullet_options)),
                          format_func=lambda i: bullet_options[i])

    if st.button("💾 Save label", key="btn_gt_save"):
        gt_data[f"seg_{seg_idx}"] = {
            "segment_idx":   seg_idx,
            "segment_text":  seg["text"],
            "segment_start": seg["start"],
            "page_num":      page["page_num"],
            "bullet_idx":    bullet_idx - 1,
            "bullet_text":   bullet_options[bullet_idx],
        }
        _save_json(gt, gt_data)
        st.success(f"Saved: seg {seg_idx} → Slide {page['page_num']}, bullet {bullet_idx}")

    st.divider()
    st.subheader(f"Labeled: {len(gt_data)} / {len(segments)} segments")

    if _aligned_path().exists() and len(gt_data) >= 5:
        st.subheader("Alignment Method Accuracy")
        aligned = _load_json(_aligned_path())
        _render_accuracy_table(segments, ppt_pages, aligned, gt_data)
