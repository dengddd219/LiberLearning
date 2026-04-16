"""Step 5 — Active learning test (canvas annotation + LLM expansion)."""
import time
from pathlib import Path

import streamlit as st

from test_ui.helpers import (
    CLAUDE_INPUT_PER_1M, CLAUDE_OUTPUT_PER_1M,
    _badge, _run_sync, _log_run, _build_noppt_pages,
    _asr_path, _aligned_path, _get_slides_dir,
    _load_json,
)

PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


def _render_ppt_page_image(page_num: int) -> bytes | None:
    """Render PPT page as PNG bytes using PyMuPDF. page_num is 1-indexed."""
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


def _format_segments_text(segs: list) -> str:
    lines = []
    for seg in segs:
        ts = int(seg.get("start", 0))
        te = int(seg.get("end", ts))
        lines.append(f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}] {seg['text']}")
    return "\n".join(lines) or "(no transcript for this page)"


def _format_ppt_bullets_text(ppt_text: str) -> str:
    lines = [l.strip() for l in ppt_text.splitlines() if l.strip()]
    if not lines:
        return "(no bullet points on this slide)"
    return "\n".join(f"{i+1}. {line}" for i, line in enumerate(lines))


def _load_prompt_section(template: str, granularity: str) -> str:
    """Load the SIMPLE or DETAILED section from prompt.md."""
    prompt_file = PROMPTS_DIR / template / "prompt.md"
    if not prompt_file.exists():
        return f"(prompt file not found: {prompt_file})"
    text = prompt_file.read_text(encoding="utf-8")
    tag = "## SIMPLE" if granularity == "simple" else "## DETAILED"
    idx = text.find(tag)
    if idx == -1:
        return f"(section '{tag}' not found)"
    content_start = idx + len(tag)
    next_heading = text.find("\n## ", content_start)
    section = text[content_start:next_heading] if next_heading != -1 else text[content_start:]
    return section.strip()


def _list_saved_prompts(template: str) -> list[str]:
    """List all saved .md files in the template dir (excluding prompt.md)."""
    d = PROMPTS_DIR / template
    files = sorted(p.name for p in d.glob("*.md") if p.name != "prompt.md")
    return files


def _save_prompt(template: str, filename: str, content: str):
    """Save prompt content to prompts/<template>/<filename>.md"""
    if not filename.endswith(".md"):
        filename = filename + ".md"
    out = PROMPTS_DIR / template / filename
    out.write_text(content, encoding="utf-8")
    return out


def _load_saved_prompt(template: str, filename: str) -> str:
    f = PROMPTS_DIR / template / filename
    return f.read_text(encoding="utf-8") if f.exists() else ""


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

        col_tmpl, col_gran, col_prov = st.columns(3)
        with col_tmpl:
            active_tmpl = st.selectbox(
                "模板",
                ["active_expand", "active_comprehensive"],
                format_func=lambda x: {
                    "active_expand": "① 基于我的笔记扩写",
                    "active_comprehensive": "③ 完整综合笔记",
                }.get(x, x),
                key="s5_tmpl",
            )
        with col_gran:
            granularity_s5 = st.radio(
                "粒度", ["simple", "detailed"],
                horizontal=True, key="s5_gran",
            )
        with col_prov:
            from services.note_generator import PROVIDERS as _NOTE_PROVIDERS
            s5_provider = st.radio(
                "AI 模型", _NOTE_PROVIDERS, horizontal=True, key="s5_provider",
                help="中转站：走 ANTHROPIC_API_KEY；智增增：走 OPENAI_API_KEY（OpenAI 兼容接口）",
            )

        st.divider()

        # ── 区域 A：System Prompt 编辑器 ────────────────────────────
        st.markdown("### A — System Prompt")

        # 初始化：当模板/粒度切换时重置编辑内容
        prompt_cache_key = f"s5_prompt_cache_{active_tmpl}_{granularity_s5}"
        if prompt_cache_key not in st.session_state:
            st.session_state[prompt_cache_key] = _load_prompt_section(active_tmpl, granularity_s5)

        # 比较模式开关
        compare_mode = st.toggle("左右对比模式", key="s5_compare_mode")

        if compare_mode:
            saved_files = _list_saved_prompts(active_tmpl)
            col_a_left, col_a_right = st.columns(2)

            with col_a_left:
                st.markdown("**✏️ 当前编辑**")
                edited_prompt = st.text_area(
                    "edit_prompt",
                    value=st.session_state[prompt_cache_key],
                    height=400,
                    label_visibility="collapsed",
                    key="s5_prompt_editor",
                )
                st.session_state[prompt_cache_key] = edited_prompt

            with col_a_right:
                st.markdown("**📄 对比版本**")
                if saved_files:
                    compare_file = st.selectbox(
                        "选择对比文件",
                        saved_files,
                        key="s5_compare_file",
                        label_visibility="collapsed",
                    )
                    compare_content = _load_saved_prompt(active_tmpl, compare_file)
                    st.text_area(
                        "compare_view",
                        value=compare_content,
                        height=400,
                        disabled=True,
                        label_visibility="collapsed",
                        key="s5_compare_display",
                    )
                    # 一键加载到左侧
                    if st.button("⬅ 加载到编辑区", key="btn_s5_load_compare"):
                        st.session_state[prompt_cache_key] = compare_content
                        st.rerun()
                else:
                    st.caption("暂无已保存的版本，保存后可在此对比。")
        else:
            # 单栏编辑
            edited_prompt = st.text_area(
                "edit_prompt",
                value=st.session_state[prompt_cache_key],
                height=350,
                label_visibility="collapsed",
                key="s5_prompt_editor",
            )
            st.session_state[prompt_cache_key] = edited_prompt

        # 保存栏
        save_col1, save_col2, save_col3 = st.columns([3, 2, 2])
        with save_col1:
            save_name = st.text_input(
                "保存文件名（不含 .md）",
                placeholder="例如：v2_more_concise",
                key="s5_save_name",
                label_visibility="collapsed",
            )
        with save_col2:
            if st.button("💾 保存当前 Prompt", key="btn_s5_save"):
                name = save_name.strip()
                if not name:
                    st.warning("请先输入文件名")
                else:
                    saved_path = _save_prompt(active_tmpl, name, edited_prompt)
                    st.success(f"已保存：{saved_path.name}")
        with save_col3:
            saved_files_now = _list_saved_prompts(active_tmpl)
            if saved_files_now:
                st.caption("已保存：" + "、".join(saved_files_now))

        # 与磁盘版本的 diff 提示
        original = _load_prompt_section(active_tmpl, granularity_s5)
        if edited_prompt != original:
            st.info("当前编辑内容与 prompt.md 原始内容不同，生成时将使用编辑版本。")

        st.divider()

        # ── 区域 B：两个输入文本 ─────────────────────────────────────
        st.markdown("### B — 输入文本")

        if has_ppt:
            img_bytes = _render_ppt_page_image(active_page.get("pdf_page_num", page_num))
            if img_bytes:
                with st.expander(f"PPT Slide {page_num} 预览", expanded=False):
                    st.image(img_bytes, caption=f"Slide {page_num}", use_container_width=True)

        col_b1, col_b2 = st.columns(2)

        with col_b1:
            st.markdown("**① 用户笔记（Student's Note）**")
            ann_text = st.text_area(
                "输入你的笔记",
                key="s5_ann_text",
                placeholder="输入你的笔记...",
                height=120,
                label_visibility="collapsed",
            )
            if st.button("➕ 添加", key="btn_s5_add"):
                if ann_text.strip():
                    if "s5_annotations" not in st.session_state:
                        st.session_state["s5_annotations"] = {}
                    akey = str(page_num)
                    if akey not in st.session_state["s5_annotations"]:
                        st.session_state["s5_annotations"][akey] = []
                    st.session_state["s5_annotations"][akey].append({
                        "text": ann_text.strip(), "x": 0.5, "y": 0.5,
                    })
                    st.rerun()

            annotations_key = str(page_num)
            current_annotations = st.session_state.get("s5_annotations", {}).get(annotations_key, [])

            if current_annotations:
                st.markdown("**已添加标注：**")
                for i, ann in enumerate(current_annotations):
                    c1, c2 = st.columns([5, 1])
                    with c1:
                        st.markdown(f"**#{i+1}** {ann['text']}")
                    with c2:
                        if st.button("🗑", key=f"s5_del_{page_num}_{i}"):
                            st.session_state["s5_annotations"][annotations_key].pop(i)
                            st.rerun()
            else:
                st.caption("暂无标注，请在上方输入后点击「添加」")

        with col_b2:
            st.markdown("**② 老师文本（Transcript）**")
            segs = active_page.get("aligned_segments", [])
            transcript_text = _format_segments_text(segs)
            st.text_area(
                "transcript",
                value=transcript_text,
                height=220,
                disabled=True,
                label_visibility="collapsed",
                key="s5_transcript_display",
            )

        st.divider()

        # ── 区域 C：发给 LLM 的完整消息预览 ──────────────────────────
        annotations_key = str(page_num)
        current_annotations = st.session_state.get("s5_annotations", {}).get(annotations_key, [])

        st.markdown("### C — 发给 LLM 的消息（预览）")
        if current_annotations:
            ppt_bullets = _format_ppt_bullets_text(active_page.get("ppt_text", ""))
            first_ann = current_annotations[0]["text"]
            preview_user_msg = (
                f"## PPT Bullet Points\n{ppt_bullets}\n\n"
                f"## Student's Note\n{first_ann}\n\n"
                f"## Transcript\n{transcript_text}"
            )
            with st.expander("System Prompt（区域 A 当前编辑内容）", expanded=False):
                st.text_area(
                    "c_system_prompt",
                    value=edited_prompt,
                    height=250,
                    disabled=True,
                    label_visibility="collapsed",
                    key="s5_c_prompt_display",
                )
            st.markdown("**User Message**（以第一条标注为例）：")
            st.text_area(
                "c_user_msg",
                value=preview_user_msg,
                height=300,
                disabled=True,
                label_visibility="collapsed",
                key="s5_c_usermsg_display",
            )
            if len(current_annotations) > 1:
                st.caption(f"共 {len(current_annotations)} 条标注，每条独立发一次请求，格式相同。")
        else:
            st.caption("添加标注后可在此预览完整消息体。")

        st.divider()

        # ── 区域 D：生成 & 输出 ─────────────────────────────────────
        st.markdown("### D — LLM 输出")

        if st.button("▶ 生成笔记", key="btn_step5", disabled=not current_annotations):
            t0 = time.time()
            prog = st.progress(0, text="Calling LLM…")

            # 用编辑后的 prompt 覆盖 note_generator 的默认加载
            from services import note_generator as _ng
            _orig_load = _ng._load_prompt

            def _patched_load(template, granularity):
                if template == active_tmpl and granularity == granularity_s5:
                    return edited_prompt
                return _orig_load(template, granularity)

            _ng._load_prompt = _patched_load
            try:
                result = _run_sync(_ng.generate_annotations(
                    active_page,
                    current_annotations,
                    template=active_tmpl,
                    granularity=granularity_s5,
                    provider=s5_provider,
                ))
            finally:
                _ng._load_prompt = _orig_load

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

        s5_result = st.session_state.get("s5_result")
        if s5_result and s5_result.get("page_num") == page_num:
            cost_info = s5_result.get("_cost", {})
            tok  = cost_info.get("input_tokens", 0) + cost_info.get("output_tokens", 0)
            cost = (cost_info.get("input_tokens", 0) / 1e6 * CLAUDE_INPUT_PER_1M
                    + cost_info.get("output_tokens", 0) / 1e6 * CLAUDE_OUTPUT_PER_1M)
            st.caption(_badge(0, tok, cost))

            for ann in s5_result.get("annotations", []):
                with st.container(border=True):
                    st.markdown(f"**用户原始输入：** {ann['text']}")
                    st.markdown("**AI 扩写：**")
                    st.markdown(ann.get("ai_expansion", "（无输出）"))
