"""
LiberStudy — Visual Testing Platform
Run: cd backend && ..\.venv\Scripts\streamlit run test_app.py
"""
import sys
import time
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

from test_ui.helpers import _list_runs, _get_run_dir, _slides_dir
from test_ui.helpers import _wav_path, _asr_path, _aligned_path, _ppt_path
from test_ui.helpers import _get_slides_dir

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("⚙️ Config")

    runs = _list_runs()
    run_options = [r["run_id"] for r in runs]

    if "run_id" not in st.session_state:
        # First launch: use "default" run, create it if needed
        st.session_state["run_id"] = "default"
        from test_ui.helpers import _get_run_dir as _init_run
        _init_run("default")  # ensure the directory exists so _list_runs picks it up
        runs = _list_runs()
        run_options = [r["run_id"] for r in runs]

    all_options = run_options + ["+ New run"]
    current_id = st.session_state["run_id"]
    current_idx = run_options.index(current_id) if current_id in run_options else len(run_options)

    selected_run = st.selectbox(
        "Run folder", all_options,
        index=current_idx,
        format_func=lambda i: f"➕ New run ({time.strftime('%Y%m%d_%H%M%S')})"
                              if i == "+ New run"
                              else next((f"{r['run_id']}  ({r['ts']}  |  ${r['cost']:.4f})"
                                         for r in runs if r["run_id"] == i), i)
    )

    if selected_run == "+ New run":
        new_id = time.strftime("%Y%m%d_%H%M%S")
        st.session_state["run_id"] = new_id
        from test_ui.helpers import _get_run_dir as _init_new
        _init_new(new_id)  # create dir before rerun so _list_runs finds it
        st.rerun()
    else:
        st.session_state["run_id"] = selected_run

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
