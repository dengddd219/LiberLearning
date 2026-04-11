"""
Pipeline tab entry point.

读这个 package 时，先看 MAP.md 了解各文件职责，再去对应文件看细节。
"""
import streamlit as st

from test_ui.helpers import _ppt_path, _wav_path
from test_ui.pipeline.step0_audio import render_step0
from test_ui.pipeline.step1_ppt import render_step1
from test_ui.pipeline.step2_asr import render_step2
from test_ui.pipeline.step3_alignment import render_step3
from test_ui.pipeline.step4_notes import render_step4
from test_ui.pipeline.step5_active import render_step5
from test_ui.pipeline.step6_export import render_step6
from test_ui.pipeline.issues import render_issues


def render_pipeline(language: str, threshold: float, realign_btn: bool):
    st.title("LiberStudy — Backend Pipeline Tester")

    col_audio, col_ppt = st.columns(2)
    with col_audio:
        audio_file = st.file_uploader("Audio (m4a / mp3 / wav)", type=["m4a", "mp3", "wav"])
    with col_ppt:
        ppt_file = st.file_uploader("Slides (pdf / pptx / ppt) — optional", type=["pdf", "pptx", "ppt"])

    has_ppt = ppt_file is not None or _ppt_path().exists()

    render_step0(audio_file)
    render_step1(ppt_file, has_ppt)
    render_step2(language)
    render_step3(has_ppt, threshold, realign_btn)
    render_step4(has_ppt)
    render_step5(has_ppt)
    render_step6(has_ppt)
    render_issues()

    st.divider()
    from test_ui.helpers import _get_run_dir
    st.caption(f"Run folder: `{_get_run_dir()}`")
