"""Step 6 — Export (Markdown + PDF download)."""
import streamlit as st

from test_ui.helpers import (
    _notes_cache, _build_markdown, _build_pdf,
    _get_run_dir, _load_json,
)


def render_step6(has_ppt):
    with st.expander("Step 6 — Export", expanded=False):
        template_exp = st.session_state.get("s4_template", "passive_ppt_notes")
        gran_exp     = st.session_state.get("s4_granularity", "simple")

        _exp_run_dir = _get_run_dir()
        _exp_committed = ""
        _exp_meta_path = _exp_run_dir / "meta.json"
        if _exp_meta_path.exists():
            try:
                _exp_committed = _load_json(_exp_meta_path).get("committed_strategy", "")
            except Exception:
                pass

        note_cache = _notes_cache(template_exp, gran_exp, _exp_committed)
        if not note_cache.exists():
            st.info("Generate notes (Step 4) first.")
            return

        notes = _load_json(note_cache)
        col_md, col_pdf = st.columns(2)
        with col_md:
            md_content = _build_markdown(notes, template_exp, has_ppt)
            st.download_button("⬇ Download Markdown", data=md_content,
                               file_name=f"liberstudy_{template_exp}_{gran_exp}.md",
                               mime="text/markdown", use_container_width=True)
        with col_pdf:
            if st.button("⬇ Generate PDF", use_container_width=True, key="btn_pdf"):
                pdf_bytes = _build_pdf(notes, template_exp, has_ppt)
                st.download_button("Click to save PDF", data=pdf_bytes,
                                   file_name=f"liberstudy_{template_exp}_{gran_exp}.pdf",
                                   mime="application/pdf", use_container_width=True)
        st.markdown("**Preview (first 3000 chars):**")
        st.markdown(md_content[:3000] + ("\n\n…" if len(md_content) > 3000 else ""))
