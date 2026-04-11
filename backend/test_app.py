"""
LiberStudy — Visual Testing Platform
Run: cd backend && ..\.venv\Scripts\streamlit run test_app.py
"""
import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

st.set_page_config(
    page_title="LiberStudy — Test Platform",
    page_icon="📚",
    layout="wide",
    initial_sidebar_state="expanded",
)

from test_ui.helpers import _list_runs, _get_run_dir, _save_json
from test_ui.helpers import _wav_path, _asr_path, _aligned_path, _ppt_path
from test_ui.helpers import _get_slides_dir


@st.dialog("Create New Test")
def _create_test_dialog():
    name = st.text_input("Test name", placeholder="e.g. lecture_01")
    note = st.text_area("Note (optional)", placeholder="e.g. CS101 week3, threshold=0.3 experiment", height=80)
    col_ok, col_cancel = st.columns(2)
    with col_ok:
        if st.button("Create", use_container_width=True, type="primary"):
            clean = name.strip().replace(" ", "_")
            if not clean:
                st.error("Please enter a test name.")
            else:
                _get_run_dir(clean)
                _save_json(_get_run_dir(clean) / "meta.json", {"note": note.strip()})
                st.session_state["run_id"] = clean
                st.rerun()
    with col_cancel:
        if st.button("Cancel", use_container_width=True):
            st.rerun()


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("⚙️ Config")

    st.subheader("📁 Test Runs")

    runs = _list_runs()
    run_ids = [r["run_id"] for r in runs]

    if "run_id" not in st.session_state or st.session_state["run_id"] not in run_ids:
        if runs:
            st.session_state["run_id"] = runs[0]["run_id"]
        else:
            _get_run_dir("default")
            st.session_state["run_id"] = "default"
            runs = _list_runs()
            run_ids = [r["run_id"] for r in runs]

    def _run_label(r):
        note_part = f" — {r['note']}" if r.get("note") else ""
        return f"{r['run_id']}  ({r['ts'][:10]}  |  ${r['cost']:.4f}){note_part}"

    if runs:
        run_labels = [_run_label(r) for r in runs]
        current_id = st.session_state["run_id"]
        current_idx = run_ids.index(current_id) if current_id in run_ids else 0
        selected_label = st.selectbox("Switch test", run_labels, index=current_idx)
        selected_run = run_ids[run_labels.index(selected_label)]
        if selected_run != st.session_state.get("run_id"):
            st.session_state["run_id"] = selected_run
            st.rerun()

    if st.button("➕ Create New Test", use_container_width=True):
        _create_test_dialog()

    current_run_meta = next((r for r in runs if r["run_id"] == st.session_state.get("run_id")), None)
    if current_run_meta and current_run_meta.get("note"):
        st.caption(f"📝 {current_run_meta['note']}")
    st.caption(f"📁 {_get_run_dir()}")
    st.divider()

    language    = st.selectbox("Language", ["en", "zh"], index=0)
    template    = st.selectbox("Note Template", [
        "passive_ppt_notes", "passive_outline_summary",
        "active_expand", "active_comprehensive",
    ], format_func=lambda x: {
        "passive_ppt_notes":       "② 全PPT讲解笔记",
        "passive_outline_summary": "④ 大纲摘要",
        "active_expand":           "① 基于我的笔记扩写",
        "active_comprehensive":    "③ 完整综合笔记",
    }[x])
    granularity = st.radio("Granularity", ["simple", "detailed"], horizontal=True)
    threshold   = st.slider("Alignment threshold", 0.1, 0.9, 0.30, 0.05)
    st.divider()

    import shutil
    col1, col2 = st.columns(2)
    with col1:
        realign_btn = st.button("↺ Re-align", use_container_width=True)
    with col2:
        if st.button("🗑 Clear cache", use_container_width=True):
            slides_dir = _get_slides_dir()
            for f in [_wav_path(), _asr_path(), _aligned_path(), _ppt_path()]:
                f.unlink(missing_ok=True)
            shutil.rmtree(slides_dir, ignore_errors=True)
            slides_dir.mkdir(exist_ok=True)
            for g in _get_run_dir().glob("notes_*.json"):
                g.unlink(missing_ok=True)
            st.success("Cache cleared for this run")
            st.rerun()

# ── Tab layout ────────────────────────────────────────────────────────────────
tab_main, tab_dashboard, tab_gt, tab_batch = st.tabs([
    "🔬 Pipeline", "📊 Dashboard", "🎯 Ground Truth", "📦 Batch"
])

from test_ui.pipeline     import render_pipeline
from test_ui.dashboard    import render_dashboard
from test_ui.ground_truth import render_ground_truth
from test_ui.batch        import render_batch

with tab_main:
    render_pipeline(language, template, granularity, threshold, realign_btn)

with tab_dashboard:
    render_dashboard()

with tab_gt:
    render_ground_truth()

with tab_batch:
    render_batch()
