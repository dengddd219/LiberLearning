"""Step 5 — Active learning test (canvas annotation + LLM expansion)."""
import time

import streamlit as st

from test_ui.helpers import (
    CLAUDE_INPUT_PER_1M, CLAUDE_OUTPUT_PER_1M,
    _badge, _run_sync, _log_run, _build_noppt_pages,
    _asr_path, _aligned_path, _get_slides_dir,
    _load_json,
)


def _render_ppt_page_image(page_num: int) -> bytes | None:
    """Render PPT page as PNG bytes using PyMuPDF. page_num is 1-indexed.
    Tries slides.pdf first; falls back to slide_NNN.png for legacy runs."""
    import fitz
    slides_dir = _get_slides_dir()

    pdf_path = slides_dir / "slides.pdf"
    if pdf_path.exists():
        doc = fitz.open(str(pdf_path))
        page_idx = page_num - 1
        if page_idx < 0 or page_idx >= len(doc):
            doc.close()
            return None
        mat = fitz.Matrix(1.5, 1.5)
        pix = doc[page_idx].get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        doc.close()
        return img_bytes

    png_path = slides_dir / f"slide_{page_num:03d}.png"
    if png_path.exists():
        return png_path.read_bytes()

    return None


def render_step5(has_ppt):
    with st.expander("Step 5 — Active learning test", expanded=False):
        asr     = _asr_path()
        aligned = _aligned_path()
        if not asr.exists():
            st.info("Complete Step 2 (ASR) first.")
            return

        # ── 页码 + 模板 + 粒度选择 ──────────────────────────────────
        if has_ppt and aligned.exists():
            aligned_data = _load_json(aligned)
            page_opts = [f"Slide {p['page_num']}" for p in aligned_data]
            s5_idx = st.selectbox("Page", range(len(page_opts)),
                                  format_func=lambda i: page_opts[i],
                                  key="s5_page_idx")
            active_page = aligned_data[s5_idx]
        else:
            pages_in  = _build_noppt_pages(_load_json(asr))
            page_opts = [f"Topic {p['page_num']}" for p in pages_in]
            s5_idx = st.selectbox("Topic segment", range(len(page_opts)),
                                  format_func=lambda i: page_opts[i],
                                  key="s5_page_idx")
            active_page = pages_in[s5_idx]

        page_num = active_page["page_num"]

        active_tmpl = st.selectbox(
            "Active template",
            ["active_expand", "active_comprehensive"],
            format_func=lambda x: {
                "active_expand": "① 基于我的笔记扩写",
                "active_comprehensive": "③ 完整综合笔记",
            }.get(x, x),
            key="s5_tmpl",
        )
        granularity_s5 = st.radio(
            "Granularity (Step 5)", ["simple", "detailed"],
            horizontal=True, key="s5_gran",
        )
        from services.note_generator import PROVIDERS as _NOTE_PROVIDERS
        s5_provider = st.radio(
            "AI 模型", _NOTE_PROVIDERS, horizontal=True, key="s5_provider",
            help="中转站：走 ANTHROPIC_API_KEY；智增增：走 OPENAI_API_KEY（OpenAI 兼容接口）",
        )

        # ── PPT 画面展示 ─────────────────────────────────────────────
        if has_ppt:
            img_bytes = _render_ppt_page_image(
                active_page.get("pdf_page_num", page_num)
            )
            if img_bytes:
                st.image(img_bytes, caption=f"Slide {page_num}",
                         use_container_width=True)
            else:
                st.info("PPT image not available for this page.")

        # ── 标注输入区 ────────────────────────────────────────────────
        st.markdown("**添加标注**")
        ann_col1, ann_col2, ann_col3 = st.columns([2, 1, 1])
        with ann_col1:
            ann_text = st.text_input(
                "标注文字", key="s5_ann_text",
                placeholder="输入你的笔记...",
            )
        with ann_col2:
            ann_x = st.number_input(
                "X 位置 (%)", min_value=0, max_value=100, value=50,
                key="s5_ann_x",
            )
        with ann_col3:
            ann_y = st.number_input(
                "Y 位置 (%)", min_value=0, max_value=100, value=50,
                key="s5_ann_y",
            )

        if st.button("➕ 添加标注", key="btn_s5_add"):
            if ann_text.strip():
                if "s5_annotations" not in st.session_state:
                    st.session_state["s5_annotations"] = {}
                key = str(page_num)
                if key not in st.session_state["s5_annotations"]:
                    st.session_state["s5_annotations"][key] = []
                st.session_state["s5_annotations"][key].append({
                    "text": ann_text.strip(),
                    "x": round(ann_x / 100, 4),
                    "y": round(ann_y / 100, 4),
                })
                st.rerun()

        # ── 标注列表 + 老师文本 ───────────────────────────────────────
        col_ann, col_teacher = st.columns(2)

        annotations_key = str(page_num)
        current_annotations = (
            st.session_state.get("s5_annotations", {}).get(annotations_key, [])
        )

        with col_ann:
            st.markdown("**用户标注**")
            if not current_annotations:
                st.caption("暂无标注，请在上方输入后点击「添加标注」")
            else:
                for i, ann in enumerate(current_annotations):
                    c1, c2 = st.columns([4, 1])
                    with c1:
                        st.markdown(
                            f"**#{i+1}** {ann['text']}  "
                            f"`x:{ann['x']:.0%} y:{ann['y']:.0%}`"
                        )
                    with c2:
                        if st.button("🗑", key=f"s5_del_{page_num}_{i}"):
                            st.session_state["s5_annotations"][annotations_key].pop(i)
                            st.rerun()

        with col_teacher:
            st.markdown("**该页老师文本**")
            segs = active_page.get("aligned_segments", [])
            if segs:
                for seg in segs:
                    ts = int(seg.get("start", 0))
                    te = int(seg.get("end", ts))
                    st.caption(
                        f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}] "
                        f"{seg['text']}"
                    )
            else:
                st.caption("（本页无对齐文本）")

        st.divider()

        # ── 生成笔记 ──────────────────────────────────────────────────
        if st.button("▶ 生成笔记", key="btn_step5",
                     disabled=not current_annotations):
            t0 = time.time()
            prog = st.progress(0, text="Calling Claude…")
            from services.note_generator import generate_annotations as _gen_ann
            result = _run_sync(_gen_ann(
                active_page,
                current_annotations,
                template=active_tmpl,
                granularity=granularity_s5,
                provider=s5_provider,
            ))
            prog.progress(100, text="Done")
            elapsed = time.time() - t0
            cost_info = result.get("_cost", {})
            tok  = cost_info.get("input_tokens", 0) + cost_info.get("output_tokens", 0)
            cost = (cost_info.get("input_tokens", 0) / 1e6 * CLAUDE_INPUT_PER_1M
                    + cost_info.get("output_tokens", 0) / 1e6 * CLAUDE_OUTPUT_PER_1M)
            _log_run("active_learn_canvas", elapsed, tok, cost,
                     extra={"template": active_tmpl, "page_num": page_num,
                            "n_annotations": len(current_annotations)})
            st.session_state["s5_result"] = result
            st.rerun()

        # ── LLM 输出展示 ──────────────────────────────────────────────
        s5_result = st.session_state.get("s5_result")
        if s5_result and s5_result.get("page_num") == page_num:
            st.markdown("**生成笔记**")
            cost_info = s5_result.get("_cost", {})
            tok  = cost_info.get("input_tokens", 0) + cost_info.get("output_tokens", 0)
            cost = (cost_info.get("input_tokens", 0) / 1e6 * CLAUDE_INPUT_PER_1M
                    + cost_info.get("output_tokens", 0) / 1e6 * CLAUDE_OUTPUT_PER_1M)
            st.caption(_badge(0, tok, cost))
            st.caption(f"page_num: {s5_result['page_num']}")
            for ann in s5_result.get("annotations", []):
                with st.container():
                    left, right = st.columns(2)
                    with left:
                        st.markdown(
                            f"**原始输入** `x:{ann['x']:.0%} y:{ann['y']:.0%}`  \n"
                            f"{ann['text']}"
                        )
                    with right:
                        st.markdown("**AI 扩写**")
                        st.markdown(ann.get("ai_expansion", "（无输出）"))
                st.divider()
