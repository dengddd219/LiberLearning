"""Step 2 — ASR transcription."""
import time

import streamlit as st

from test_ui.helpers import (
    ALIYUN_COST_PER_MIN,
    _badge, _log_run,
    _wav_path, _asr_path, _asr_raw_path,
    _save_json, _load_json,
)


def render_step2(language):
    with st.expander("Step 2 — ASR transcription", expanded=False):
        wav = _wav_path()
        asr = _asr_path()
        asr_raw = _asr_raw_path()
        if asr.exists():
            segments = _load_json(asr)
            total_chars = sum(len(s["text"]) for s in segments)
            st.success(f"✅ Cached — {len(segments)} sentences, {total_chars:,} chars")

            with st.expander("🔍 Merge comparison — raw segments vs sentence-merged", expanded=False):
                col_raw, col_merged = st.columns(2)
                with col_raw:
                    st.markdown("**Raw Aliyun segments** (pre-merge)")
                    if asr_raw.exists():
                        raw_segs = _load_json(asr_raw)
                        st.caption(f"{len(raw_segs)} raw segments")
                        for seg in raw_segs[:20]:
                            ms, me = int(seg["start"]), int(seg["end"])
                            st.text(f"[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}] {seg['text']}")
                        if len(raw_segs) > 20:
                            st.caption(f"… and {len(raw_segs)-20} more")
                    else:
                        st.info("Raw segments not available (re-run ASR to generate).")
                with col_merged:
                    st.markdown("**Merged sentences** (used in Step 3+)")
                    st.caption(f"{len(segments)} sentences")
                    for seg in segments[:20]:
                        ms, me = int(seg["start"]), int(seg["end"])
                        st.text(f"[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}] {seg['text']}")
                    if len(segments) > 20:
                        st.caption(f"… and {len(segments)-20} more")
        elif wav.exists():
            if st.button("▶ Run ASR", key="btn_step2"):
                t0 = time.time()
                from services.audio import get_audio_duration
                dur = get_audio_duration(str(wav))
                prog = st.progress(0, text="Sending to Aliyun ASR…")
                from services.asr import transcribe
                sentences, raw_segments = transcribe(str(wav), language=language)
                _save_json(asr_raw, raw_segments)
                _save_json(asr, sentences)
                prog.progress(100, text="Done")
                elapsed = time.time() - t0
                cost = (dur / 60) * ALIYUN_COST_PER_MIN
                _log_run("asr", elapsed, cost=cost,
                         extra={"n_sentences": len(sentences), "n_raw": len(raw_segments), "duration_s": dur})
                st.success(f"✅ {_badge(elapsed, cost=cost)} — {len(raw_segments)} raw → {len(sentences)} sentences")
                st.rerun()
        else:
            st.info("Complete Step 0 first.")
