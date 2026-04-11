"""
LiberStudy — Visual Testing Platform
Run: cd backend && ../.venv/Scripts/streamlit run test_app.py
"""
import time
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

from test_ui.helpers import (
    _list_runs, _list_runs_for_doc, _get_run_dir, _save_json, _load_json,
    _wav_path, _asr_path, _aligned_path, _ppt_path,
    _list_docs, _get_doc_dir, _save_doc_meta,
    ALIGNMENT_STRATEGIES,
)


@st.dialog("Create New Document")
def _create_doc_dialog():
    doc_id = st.text_input("Document ID", placeholder="e.g. lec01")
    display_name = st.text_input("Display name", placeholder="e.g. CS101 Lecture 01")
    notes = st.text_area("Notes (optional)", height=80)
    col_ok, col_cancel = st.columns(2)
    with col_ok:
        if st.button("Create", use_container_width=True, type="primary"):
            clean = doc_id.strip().replace(" ", "_")
            if not clean:
                st.error("Please enter a document ID.")
            else:
                _save_doc_meta(clean, {
                    "doc_id": clean,
                    "display_name": display_name.strip() or clean,
                    "notes": notes.strip(),
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                })
                st.session_state["doc_id"] = clean
                st.session_state.pop("run_id", None)
                st.rerun()
    with col_cancel:
        if st.button("Cancel", use_container_width=True):
            st.rerun()


@st.dialog("New Strategy Run")
def _create_run_dialog(doc_id: str):
    strat_keys = list(ALIGNMENT_STRATEGIES.keys())
    strat_labels = [ALIGNMENT_STRATEGIES[k]["label"] for k in strat_keys]
    sel_idx = st.selectbox("Alignment strategy", range(len(strat_keys)),
                           format_func=lambda i: strat_labels[i])
    strategy_key = strat_keys[sel_idx]
    note = st.text_area("Run note (optional)", height=60,
                        placeholder="e.g. threshold=0.3 test")
    col_ok, col_cancel = st.columns(2)
    with col_ok:
        if st.button("Create", use_container_width=True, type="primary"):
            ts = time.strftime("%Y%m%d_%H%M%S")
            run_id = f"{ts}_{strategy_key}"
            _get_run_dir(run_id)
            _save_json(_get_run_dir(run_id) / "meta.json", {
                "doc_id": doc_id,
                "strategy": strategy_key,
                "note": note.strip(),
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            })
            st.session_state["run_id"] = run_id
            st.session_state["tl_current_page"] = 0
            st.rerun()
    with col_cancel:
        if st.button("Cancel", use_container_width=True):
            st.rerun()


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("⚙️ Config")

    # ── Document selector ─────────────────────────────────────────────────────
    st.subheader("📁 Test Documents")
    docs = _list_docs()
    doc_ids = [d["doc_id"] for d in docs]

    if "doc_id" not in st.session_state or st.session_state["doc_id"] not in doc_ids:
        if docs:
            st.session_state["doc_id"] = docs[0]["doc_id"]
        else:
            st.session_state["doc_id"] = ""

    current_doc_id = st.session_state.get("doc_id", "")

    def _doc_label(d):
        name = d.get("display_name") or d["doc_id"]
        return f"{name} [{d['doc_id']}]"

    if docs:
        doc_labels = [_doc_label(d) for d in docs]
        current_doc_idx = doc_ids.index(current_doc_id) if current_doc_id in doc_ids else 0
        selected_doc_label = st.selectbox("Switch test document", doc_labels, index=current_doc_idx)
        selected_doc_id = doc_ids[doc_labels.index(selected_doc_label)]
        if selected_doc_id != st.session_state.get("doc_id"):
            st.session_state["doc_id"] = selected_doc_id
            st.session_state.pop("run_id", None)
            st.session_state["tl_current_page"] = 0
            st.rerun()
    else:
        st.info("No documents yet. Create one below.")

    if st.button("➕ Create New Document", use_container_width=True):
        _create_doc_dialog()

    st.divider()

    # ── Run selector within document ──────────────────────────────────────────
    st.subheader("🧪 Strategy Runs")

    current_doc_id = st.session_state.get("doc_id", "")
    if current_doc_id:
        doc_runs = _list_runs_for_doc(current_doc_id)
        run_ids = [r["run_id"] for r in doc_runs]

        if "run_id" not in st.session_state or st.session_state["run_id"] not in run_ids:
            if doc_runs:
                st.session_state["run_id"] = doc_runs[0]["run_id"]
            else:
                st.session_state["run_id"] = ""

        def _run_label(r):
            strat_info = ALIGNMENT_STRATEGIES.get(r.get("strategy", ""), {})
            strat_label = strat_info.get("label", r.get("strategy", ""))
            date_part = r["ts"][:10] if r["ts"] != "unknown" else "?"
            note_part = f" — {r['note']}" if r.get("note") else ""
            return f"{r['run_id'][:16]}  ({date_part} | {strat_label}){note_part}"

        if doc_runs:
            run_labels = [_run_label(r) for r in doc_runs]
            current_run_id = st.session_state.get("run_id", "")
            current_run_idx = run_ids.index(current_run_id) if current_run_id in run_ids else 0
            selected_run_label = st.selectbox("Switch run", run_labels, index=current_run_idx)
            selected_run_id = run_ids[run_labels.index(selected_run_label)]
            if selected_run_id != st.session_state.get("run_id"):
                st.session_state["run_id"] = selected_run_id
                st.session_state["tl_current_page"] = 0
                st.rerun()
        else:
            st.info("No runs for this document yet.")

        if st.button("➕ New Strategy Run", use_container_width=True):
            _create_run_dialog(current_doc_id)
    else:
        st.info("Select or create a document first.")

    st.divider()

    # ── Pipeline config ───────────────────────────────────────────────────────
    language  = st.selectbox("Language", ["en", "zh"], index=0)
    threshold = st.slider("Alignment threshold", 0.1, 0.9, 0.30, 0.05)
    st.divider()

    col1, col2 = st.columns(2)
    with col1:
        realign_btn = st.button("↺ Re-align", use_container_width=True)
    with col2:
        if st.button("🗑 Clear cache", use_container_width=True):
            # Only clear run-level outputs (alignment + notes).
            # Doc-level data (wav, asr, ppt, slides) is shared and NOT cleared here.
            for f in _get_run_dir().glob("aligned_pages*.json"):
                f.unlink(missing_ok=True)
            for g in _get_run_dir().glob("notes_*.json"):
                g.unlink(missing_ok=True)
            st.success("Alignment & note cache cleared for this run")
            st.rerun()

    current_run_id = st.session_state.get("run_id", "")
    if current_run_id:
        st.caption(f"📁 {_get_run_dir()}")

# ── Tab layout ────────────────────────────────────────────────────────────────
tab_main, tab_dashboard, tab_gt, tab_batch = st.tabs([
    "🔬 Pipeline", "📊 Dashboard", "🎯 Ground Truth", "📦 Batch"
])

from test_ui.pipeline     import render_pipeline
from test_ui.dashboard    import render_dashboard
from test_ui.ground_truth import render_ground_truth
from test_ui.batch        import render_batch

with tab_main:
    render_pipeline(language, threshold, realign_btn)

with tab_dashboard:
    render_dashboard()

with tab_gt:
    render_ground_truth()

with tab_batch:
    render_batch()
