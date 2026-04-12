"""Step 4 — Note generation."""
import json
import re
import shutil
import time
from pathlib import Path

import streamlit as st

from test_ui.helpers import (
    CLAUDE_INPUT_PER_1M, CLAUDE_OUTPUT_PER_1M,
    _badge, _run_sync, _log_run, _render_notes,
    _asr_path, _aligned_path, _notes_cache, _build_noppt_pages,
    _get_run_dir, _save_json, _load_json,
    ALIGNMENT_STRATEGIES,
)

# ---------------------------------------------------------------------------
# Prompt version helpers
# ---------------------------------------------------------------------------

PROMPTS_BASE = Path(__file__).parent.parent.parent / "prompts"


def _version_dir(template: str) -> Path:
    d = PROMPTS_BASE / template
    d.mkdir(exist_ok=True)
    return d


def _list_prompt_versions(template: str) -> list[str]:
    """Return sorted list of saved version names (v0.1, v0.2, …) for a template."""
    d = _version_dir(template)
    names = []
    for f in d.glob("v*.md"):
        names.append(f.stem)
    # Sort numerically: v0.1 < v0.2 < v0.10
    def _ver_key(name):
        m = re.match(r"v(\d+)\.(\d+)", name)
        return (int(m.group(1)), int(m.group(2))) if m else (999, 0)
    return sorted(names, key=_ver_key)


def _next_version_name(template: str) -> str:
    """Auto-increment: if latest is v0.3, return v0.4. Start at v0.1."""
    existing = _list_prompt_versions(template)
    if not existing:
        return "v0.1"
    last = existing[-1]
    m = re.match(r"v(\d+)\.(\d+)", last)
    if m:
        return f"v{m.group(1)}.{int(m.group(2)) + 1}"
    return "v0.1"


def _load_prompt_version(template: str, version: str) -> str:
    """Load prompt text from prompts/<template>/<version>.md (plain text, no header)."""
    path = _version_dir(template) / f"{version}.md"
    return path.read_text(encoding="utf-8")


def _save_prompt_version(template: str, version: str, text: str):
    path = _version_dir(template) / f"{version}.md"
    path.write_text(text, encoding="utf-8")


def _notes_cache_v(template, granularity, strategy_key, prompt_version):
    """Cache key includes prompt version so different versions don't collide."""
    run_dir = _get_run_dir()
    parts = [template, granularity]
    if strategy_key:
        parts.append(strategy_key)
    if prompt_version and prompt_version != "(production)":
        parts.append(prompt_version)
    return run_dir / f"notes_{'_'.join(parts)}.json"


# ---------------------------------------------------------------------------
# Strategy commit helper
# ---------------------------------------------------------------------------

def _commit_strategy(run_dir, strategy_key):
    src = run_dir / f"aligned_pages_{strategy_key}.json"
    dst = run_dir / "aligned_pages.json"
    if src.exists():
        shutil.copy2(str(src), str(dst))
    meta_path = run_dir / "meta.json"
    meta = {}
    if meta_path.exists():
        try:
            meta = _load_json(meta_path)
        except Exception:
            pass
    meta["committed_strategy"] = strategy_key
    _save_json(meta_path, meta)


# ---------------------------------------------------------------------------
# Main render
# ---------------------------------------------------------------------------

def render_step4(has_ppt):
    with st.expander("Step 4 — Note generation", expanded=False):
        asr     = _asr_path()
        aligned = _aligned_path()
        run_dir = _get_run_dir()

        from services.note_generator import PROVIDERS as _NOTE_PROVIDERS

        avail_strat_keys = [k for k in ALIGNMENT_STRATEGIES.keys()
                            if (run_dir / f"aligned_pages_{k}.json").exists()]
        strat_labels = [ALIGNMENT_STRATEGIES[k]["label"] for k in avail_strat_keys]

        # ── Row 1: 4 core params ────────────────────────────────────────
        col_tmpl, col_gran, col_strat, col_model = st.columns(4)
        with col_tmpl:
            template = st.selectbox("Note template", [
                "passive_ppt_notes", "passive_outline_summary",
                "active_expand", "active_comprehensive",
            ], format_func=lambda x: {
                "passive_ppt_notes":       "② 全PPT讲解笔记",
                "passive_outline_summary": "④ 大纲摘要",
                "active_expand":           "① 基于我的笔记扩写",
                "active_comprehensive":    "③ 完整综合笔记",
            }[x], key="s4_template")
        with col_gran:
            granularity = st.selectbox("Granularity", ["simple", "detailed"],
                                       key="s4_granularity")
        with col_strat:
            if avail_strat_keys:
                strat_idx = st.selectbox(
                    "Strategy commitment",
                    range(len(avail_strat_keys)),
                    format_func=lambda i: strat_labels[i],
                    key="s4_strategy_idx",
                )
                strategy_key = avail_strat_keys[strat_idx]
            else:
                st.selectbox("Strategy commitment", ["（无可用策略）"],
                             key="s4_strategy_idx_empty")
                strategy_key = ""
        with col_model:
            provider = st.selectbox("AI 模型", _NOTE_PROVIDERS, key="s4_provider",
                                    help="中转站：走 ANTHROPIC_API_KEY；智增增：走 OPENAI_API_KEY")

        # ── Row 2: Prompt version ────────────────────────────────────────
        saved_versions = _list_prompt_versions(template)
        version_options = ["(production)"] + saved_versions
        prompt_version = st.selectbox(
            "Prompt version",
            version_options,
            format_func=lambda v: f"{v}  （磁盘 .md 文件）" if v == "(production)" else v,
            key="s4_prompt_version",
        )

        # Config dict passed to both sections
        config = {
            "template":       template,
            "granularity":    granularity,
            "strategy":       strategy_key,
            "provider":       provider,
            "prompt_version": prompt_version,
        }

        with st.expander("当前配置 JSON", expanded=False):
            st.json(config)

        # Auto-commit strategy
        if strategy_key and avail_strat_keys:
            _commit_strategy(run_dir, strategy_key)

        st.divider()

        ready = (has_ppt and aligned.exists()) or (not has_ppt and asr.exists())
        note_cache = _notes_cache_v(template, granularity, strategy_key, prompt_version)

        # ── Section A: Prompt Playground ────────────────────────────────
        with st.expander("🔬 Section A — Prompt Playground（单页调试）",
                         expanded=False):
            if not ready:
                st.info("Complete Step 3 (or Step 2 for no-PPT mode) first.")
            else:
                _render_section_a(has_ppt, aligned, asr, config)

        # ── Section B: Batch generation ─────────────────────────────────
        with st.expander("▶ Section B — 批量笔记生产", expanded=True):
            if not ready:
                if has_ppt and not aligned.exists():
                    st.warning("请先在 Step 3 中运行至少一个对齐策略。")
                else:
                    st.info("Complete Step 3 (or Step 2 for no-PPT mode) first.")
            elif note_cache.exists():
                notes = _load_json(note_cache)
                col_cache, col_regen = st.columns([4, 1])
                with col_cache:
                    st.success(
                        f"✅ Cached — {len(notes)} pages "
                        f"({template} / {granularity} / {prompt_version})"
                    )
                with col_regen:
                    if st.button("🔄 重新生成", key="btn_regen_notes"):
                        note_cache.unlink()
                        st.rerun()
                _render_notes(notes, template)
            else:
                _render_section_b(has_ppt, aligned, asr, config, note_cache)


# ---------------------------------------------------------------------------
# Section A: Prompt Playground
# ---------------------------------------------------------------------------

def _render_section_a(has_ppt, aligned, asr, config):
    from services.note_generator import (
        PageData, PASSIVE_TEMPLATES,
        _load_prompt, _extract_json, _get_async_call_fn,
        _format_ppt_bullets, _format_segments,
    )

    template       = config["template"]
    granularity    = config["granularity"]
    provider       = config["provider"]
    prompt_version = config["prompt_version"]

    pages_in = (_load_json(aligned) if has_ppt else _build_noppt_pages(_load_json(asr)))
    n = len(pages_in)

    # ── 1. Page selector + raw input viewer ────────────────────────────
    st.markdown("#### 1. 选择调试页面")
    page_idx = st.selectbox(
        "选择单页",
        range(n),
        format_func=lambda i: f"Slide {pages_in[i].get('page_num', i+1)}",
        key="s4_dbg_page_idx",
    )
    typed_page = PageData.model_validate(pages_in[page_idx])
    ppt_bullets_text = _format_ppt_bullets(typed_page.ppt_text or "")
    transcript_text  = _format_segments(typed_page.aligned_segments)

    col_ppt, col_asr = st.columns(2)
    with col_ppt:
        st.markdown("**PPT Bullets**")
        with st.container(height=200, border=True):
            st.text(ppt_bullets_text)
    with col_asr:
        st.markdown("**Transcript**")
        with st.container(height=200, border=True):
            st.text(transcript_text)

    is_passive = template in PASSIVE_TEMPLATES
    if not is_passive and not typed_page.user_note:
        st.warning("此页没有 user note，active 模板不会调用 LLM。")
        return

    # ── 2. Prompt editor ────────────────────────────────────────────────
    st.markdown("#### 2. Prompt 编辑器")

    # State key: resets when template/granularity change OR when user loads a version
    prompt_state_key = f"s4_dbg_prompt_{template}_{granularity}"
    load_trigger_key = f"s4_dbg_loaded_ver_{template}_{granularity}"

    # Load initial content
    if prompt_state_key not in st.session_state:
        try:
            if prompt_version == "(production)":
                st.session_state[prompt_state_key] = _load_prompt(template, granularity)
            else:
                st.session_state[prompt_state_key] = _load_prompt_version(template, prompt_version)
            st.session_state[load_trigger_key] = prompt_version
        except Exception as e:
            st.error(f"加载 prompt 失败: {e}")
            return

    # Quick-load buttons row
    saved_versions = _list_prompt_versions(template)
    col_load_label, *col_ver_btns, col_reset_btn = st.columns(
        [1.2] + [1] * min(len(saved_versions), 8) + [1.2]
    )
    with col_load_label:
        st.caption("快速加载：")
    for i, ver in enumerate(saved_versions[:8]):
        with col_ver_btns[i]:
            if st.button(ver, key=f"s4_load_ver_{ver}_{template}"):
                try:
                    st.session_state[prompt_state_key] = _load_prompt_version(template, ver)
                    st.session_state[load_trigger_key] = ver
                    st.rerun()
                except Exception as e:
                    st.error(str(e))
    with col_reset_btn:
        if st.button("↺ 生产版本", key="s4_dbg_reset_prompt"):
            try:
                st.session_state[prompt_state_key] = _load_prompt(template, granularity)
                st.session_state[load_trigger_key] = "(production)"
                st.rerun()
            except Exception as e:
                st.error(str(e))

    if saved_versions:
        st.caption(f"当前编辑器已加载：**{st.session_state.get(load_trigger_key, '?')}**")

    edited_prompt = st.text_area(
        "System Prompt（直接编辑，Run 时以此为准）",
        value=st.session_state[prompt_state_key],
        height=380,
        key=f"s4_dbg_prompt_area_{template}_{granularity}",
    )
    st.session_state[prompt_state_key] = edited_prompt

    # user_msg preview
    if is_passive:
        user_msg = (
            f"## PPT Bullet Points\n{ppt_bullets_text}\n\n"
            f"## Transcript\n{transcript_text}"
        )
    else:
        user_msg = (
            f"## PPT Bullet Points\n{ppt_bullets_text}\n\n"
            f"## Student's Note\n{typed_page.user_note}\n\n"
            f"## Transcript\n{transcript_text}"
        )
    with st.expander("查看完整 user_msg", expanded=False):
        with st.container(height=250, border=True):
            st.text(user_msg)

    # ── 3. Run ───────────────────────────────────────────────────────────
    st.markdown("#### 3. 运行")
    col_run, col_save_area = st.columns([1, 2])
    with col_run:
        run_clicked = st.button("▶ Run on Current Page", key="btn_s4_dbg_run",
                                use_container_width=True)

    if not run_clicked:
        st.info("修改完 prompt 后点击 Run。")
        _render_save_section(template, granularity, edited_prompt)
        return

    async def _call_once():
        call_fn, _ = _get_async_call_fn(provider)
        return await call_fn(edited_prompt, user_msg)

    with st.spinner("调用 LLM…"):
        try:
            raw_text, in_tok, out_tok = _run_sync(_call_once())
        except Exception as e:
            st.error(f"❌ LLM 调用失败: {e}")
            _render_save_section(template, granularity, edited_prompt)
            return

    # ── 4. Results ───────────────────────────────────────────────────────
    st.markdown("#### 4. 输出结果")
    tab_raw, tab_json, tab_cost = st.tabs(["Raw Output", "Parsed JSON", "Token Usage"])
    with tab_raw:
        st.caption("LLM 原始返回 — 检查格式问题、markdown 幻觉、缺 bullet 等")
        with st.container(height=350, border=True):
            st.text(raw_text)
    with tab_json:
        try:
            st.json(_extract_json(raw_text))
        except Exception as e:
            st.error(f"JSON 解析失败: {e}")
    with tab_cost:
        cost = in_tok / 1e6 * 3.0 + out_tok / 1e6 * 15.0
        c1, c2, c3 = st.columns(3)
        c1.metric("Input tokens", in_tok)
        c2.metric("Output tokens", out_tok)
        c3.metric("成本 (USD)", f"${cost:.5f}")

    st.divider()
    _render_save_section(template, granularity, edited_prompt)


def _render_save_section(template: str, granularity: str, edited_prompt: str):
    """Save the current editor content as a new auto-numbered version."""
    st.markdown("#### 5. 保存版本")
    next_ver = _next_version_name(template)
    existing = _list_prompt_versions(template)

    col_info, col_btn = st.columns([3, 1])
    with col_info:
        st.caption(
            f"将保存为 **{next_ver}**（`prompts/{template}/{next_ver}.md`）  "
            f"  ·  已有版本：{', '.join(existing) if existing else '无'}"
        )
    with col_btn:
        if st.button(f"💾 保存为 {next_ver}", key="btn_s4_dbg_save",
                     use_container_width=True):
            _save_prompt_version(template, next_ver, edited_prompt)
            st.success(f"✅ 已保存 `{next_ver}`（共 {len(edited_prompt)} 字符）")
            st.rerun()  # refresh version list in main selector

    # Version history viewer
    if existing:
        with st.expander("查看已保存版本", expanded=False):
            sel = st.selectbox("选择版本预览", existing,
                               key="s4_dbg_hist_ver")
            try:
                hist_text = _load_prompt_version(template, sel)
                with st.container(height=250, border=True):
                    st.text(hist_text)
            except Exception as e:
                st.error(str(e))


# ---------------------------------------------------------------------------
# Section B: Batch generation
# ---------------------------------------------------------------------------

def _resolve_prompt_for_batch(template: str, granularity: str,
                               prompt_version: str) -> str:
    """Return the prompt text to use for batch generation."""
    from services.note_generator import _load_prompt
    if prompt_version == "(production)":
        return _load_prompt(template, granularity)
    return _load_prompt_version(template, prompt_version)


def _render_section_b(has_ppt, aligned, asr, config, note_cache):
    from services.note_generator import generate_notes_for_all_pages, _load_prompt

    template       = config["template"]
    granularity    = config["granularity"]
    provider       = config["provider"]
    prompt_version = config["prompt_version"]

    # Show which prompt version will be used
    if prompt_version == "(production)":
        st.caption("使用生产版本 prompt（`prompts/<template>/prompt.md`）")
    else:
        st.caption(f"使用保存版本 prompt：**{prompt_version}**")

    pages_in = (_load_json(aligned) if has_ppt else _build_noppt_pages(_load_json(asr)))
    total_pages = len(pages_in)

    col_r1, col_r2 = st.columns(2)
    with col_r1:
        range_start = st.number_input("从第几页开始", min_value=1, max_value=total_pages,
                                      value=1, step=1, key="s4_range_start")
    with col_r2:
        range_end = st.number_input("到第几页结束", min_value=1, max_value=total_pages,
                                    value=total_pages, step=1, key="s4_range_end")
    selected_pages = pages_in[range_start - 1:range_end]
    st.caption(
        f"生成第 {range_start}–{range_end} 页，共 {len(selected_pages)} 页 "
        f"| {template} / {granularity} / {prompt_version}"
    )

    if st.button(f"▶ Generate notes", key="btn_step4"):
        # Resolve prompt (may be a saved version)
        try:
            system_prompt = _resolve_prompt_for_batch(template, granularity, prompt_version)
        except Exception as e:
            st.error(f"加载 prompt 失败: {e}")
            return

        t0 = time.time()
        prog = st.progress(0, text=f"Generating {len(selected_pages)} pages…")

        # Patch: pass custom system_prompt into generate_notes_for_all_pages
        # by temporarily monkeypatching _load_prompt, or use the lower-level API.
        # We use the lower-level path to avoid touching the production function.
        import asyncio
        from services.note_generator import (
            PageData, PASSIVE_TEMPLATES, _prepare_tasks,
            _execute_llm_batch, _parse_and_merge, _get_async_call_fn,
        )

        async def _run_batch():
            call_fn, _ = _get_async_call_fn(provider)
            sem = asyncio.Semaphore(5)
            is_passive = template in PASSIVE_TEMPLATES
            typed = [PageData.model_validate(p) for p in selected_pages]
            tasks, expanded = _prepare_tasks(typed, system_prompt, template, is_passive)
            results = await _execute_llm_batch(tasks, call_fn, sem)
            return _parse_and_merge(expanded, results, is_passive)

        notes = _run_sync(_run_batch())
        _save_json(note_cache, notes)
        prog.progress(100, text="Done")

        total_in  = sum(p.get("_cost", {}).get("input_tokens", 0) for p in notes)
        total_out = sum(p.get("_cost", {}).get("output_tokens", 0) for p in notes)
        cost = total_in/1e6*CLAUDE_INPUT_PER_1M + total_out/1e6*CLAUDE_OUTPUT_PER_1M
        elapsed = time.time() - t0
        _log_run("note_gen", elapsed, total_in + total_out, cost,
                 extra={"template": template, "granularity": granularity,
                        "prompt_version": prompt_version, "n_pages": len(notes)})
        st.success(f"✅ {_badge(elapsed, total_in+total_out, cost)}")
        st.rerun()
