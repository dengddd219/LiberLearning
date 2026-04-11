"""Issues & Findings panel — post-pipeline diagnostics."""
import streamlit as st

from test_ui.helpers import (
    _aligned_path, _notes_cache,
    _get_run_dir, _load_json,
)


def render_issues():
    st.divider()
    st.subheader("🔍 Issues & Findings")

    issues = []
    aligned_path = _aligned_path()
    template_iss = st.session_state.get("s4_template", "passive_ppt_notes")
    gran_iss     = st.session_state.get("s4_granularity", "simple")

    _iss_run_dir = _get_run_dir()
    _iss_committed = ""
    _iss_meta_path = _iss_run_dir / "meta.json"
    if _iss_meta_path.exists():
        try:
            _iss_committed = _load_json(_iss_meta_path).get("committed_strategy", "")
        except Exception:
            pass

    notes_path = _notes_cache(template_iss, gran_iss, _iss_committed)

    if aligned_path.exists():
        aligned = _load_json(aligned_path)

        low_conf = [p for p in aligned if p.get("alignment_confidence", 0) < 0.3]
        if low_conf:
            low_conf_names = ", ".join(f"Slide {p['page_num']}" for p in low_conf[:5])
            issues.append({
                "severity": "🔴 Low confidence",
                "count": len(low_conf),
                "detail": f"Slides with conf < 0.3: {low_conf_names}" + (" …" if len(low_conf) > 5 else ""),
                "suggestion": "Try lowering the alignment threshold in the sidebar.",
            })

        empty = [p for p in aligned if not p.get("aligned_segments") and p.get("page_supplement")]
        if empty:
            empty_names = ", ".join(f"Slide {p['page_num']}" for p in empty[:5])
            issues.append({
                "severity": "🟡 No transcript match",
                "count": len(empty),
                "detail": f"Slides with no aligned transcript: {empty_names}",
                "suggestion": "These slides likely contain content the teacher didn't discuss or discussed off-mic.",
            })

        silent = [p for p in aligned if not p.get("aligned_segments") and not p.get("page_supplement")]
        if silent:
            silent_names = ", ".join(f"Slide {p['page_num']}" for p in silent[:5])
            issues.append({
                "severity": "🟡 Silent slides",
                "count": len(silent),
                "detail": f"Slides with zero audio coverage: {silent_names}",
                "suggestion": "Either the teacher skipped these slides, or the audio recording missed this section.",
            })

        if notes_path.exists():
            notes = _load_json(notes_path)
            noisy_bullets = []
            for pg in notes:
                passive = pg.get("passive_notes", {})
                for b in passive.get("bullets", []):
                    text = b.get("ppt_bullet", "")
                    if text and (text.strip().replace(".", "").isdigit()
                                 or len(text.strip().split()) == 1
                                 or text.strip() in ("Xiao Lei", "XiaoLei", "作者", "页码")):
                        noisy_bullets.append(f"Slide {pg['page_num']}: '{text}'")
            if noisy_bullets:
                issues.append({
                    "severity": "🟡 Noisy bullet extractions",
                    "count": len(noisy_bullets),
                    "detail": " | ".join(noisy_bullets[:4]),
                    "suggestion": "Filter out page numbers and author names in ppt_parser.py (post-processing).",
                })

        avg_conf = sum(p.get("alignment_confidence", 0) for p in aligned) / max(len(aligned), 1)
        if avg_conf < 0.25:
            issues.append({
                "severity": "🔴 Very low overall confidence",
                "count": 0,
                "detail": f"Run average confidence: {avg_conf:.2f} — well below 0.3",
                "suggestion": "This often happens when the 10-min audio covers only a small portion of the slide deck.",
            })

    if issues:
        for issue in issues:
            with st.container():
                col_sev, col_txt = st.columns([1, 4])
                with col_sev:
                    st.markdown(f"**{issue['severity']}**")
                with col_txt:
                    st.markdown(f"**{issue['detail']}**")
                    st.caption(f"💡 {issue['suggestion']}")
            st.divider()
    else:
        st.success("No issues detected — pipeline ran cleanly.")
