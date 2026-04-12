"""Step 4 — Note generation."""
import asyncio
import json
import time

import streamlit as st

from test_ui.helpers import (
    CLAUDE_INPUT_PER_1M, CLAUDE_OUTPUT_PER_1M,
    _badge, _run_sync, _log_run, _render_notes,
    _asr_path, _aligned_path, _notes_cache, _build_noppt_pages,
    _get_run_dir, _save_json, _load_json,
    ALIGNMENT_STRATEGIES, PROMPT_REGISTRY,
)


def render_step4(has_ppt):
    with st.expander("Step 4 — Note generation", expanded=False):
        asr     = _asr_path()
        aligned = _aligned_path()

        # ── Template + granularity selector ──────────────────────────
        template = st.selectbox("Note template", [
            "passive_ppt_notes", "passive_outline_summary",
            "active_expand", "active_comprehensive",
        ], format_func=lambda x: {
            "passive_ppt_notes":       "② 全PPT讲解笔记",
            "passive_outline_summary": "④ 大纲摘要",
            "active_expand":           "① 基于我的笔记扩写",
            "active_comprehensive":    "③ 完整综合笔记",
        }[x], key="s4_template")
        granularity = st.radio("Granularity", ["simple", "detailed"], horizontal=True,
                               key="s4_granularity")

        # ── Prompt version selector ───────────────────────────────────
        template_prompts = PROMPT_REGISTRY.get(template, [])
        if template_prompts:
            st.markdown("**Prompt version**")
            for pv in template_prompts:
                col_pv, col_desc = st.columns([1, 3])
                with col_pv:
                    is_selected = st.session_state.get("s4_prompt_version") == pv["version_label"]
                    btn_label = f"{'✅ ' if is_selected else ''}{pv['version_label']}"
                    if st.button(btn_label, key=f"pvbtn_{template}_{pv['version_label']}"):
                        st.session_state["s4_prompt_version"] = pv["version_label"]
                        st.rerun()
                with col_desc:
                    prompt_key = "prompt_detailed" if granularity == "detailed" else "prompt_simple"
                    prompt_text = pv.get(prompt_key) or pv.get("description", "")
                    st.text_area("Prompt原文", value=prompt_text, disabled=True, height=200,
                                 key=f"pvdesc_{template}_{pv['version_label']}")
        else:
            st.caption("No prompt versions found for this template.")

        # ── Strategy commitment section ───────────────────────────────
        st.markdown("**Strategy commitment**")
        run_dir = _get_run_dir()
        avail_strat_keys = [k for k in ALIGNMENT_STRATEGIES.keys()
                            if (run_dir / f"aligned_pages_{k}.json").exists()]

        committed_meta = {}
        meta_path = run_dir / "meta.json"
        if meta_path.exists():
            try:
                committed_meta = _load_json(meta_path)
            except Exception:
                pass
        committed_strategy = committed_meta.get("committed_strategy", "")

        if committed_strategy:
            committed_label = ALIGNMENT_STRATEGIES.get(committed_strategy, {}).get("label", committed_strategy)
            st.info(f"当前使用策略：{committed_label}")

        if avail_strat_keys:
            avail_labels = [ALIGNMENT_STRATEGIES[k]["label"] for k in avail_strat_keys]
            commit_sel_idx = st.radio(
                "Commit alignment strategy", range(len(avail_strat_keys)),
                format_func=lambda i: avail_labels[i],
                key="s4_committed_strategy"
            )
            commit_key = avail_strat_keys[commit_sel_idx]
            if st.button("Commit to this strategy", key="btn_commit_strategy"):
                src = run_dir / f"aligned_pages_{commit_key}.json"
                dst = run_dir / "aligned_pages.json"
                import shutil as _shutil
                _shutil.copy2(str(src), str(dst))
                committed_meta["committed_strategy"] = commit_key
                _save_json(meta_path, committed_meta)
                st.success(f"✅ Committed: {ALIGNMENT_STRATEGIES[commit_key]['label']}")
                st.rerun()
        else:
            st.warning("请先在 Step 3 中运行至少一个对齐策略，再提交。")

        st.divider()

        # ── Note generation ───────────────────────────────────────────
        ready = (has_ppt and aligned.exists()) or (not has_ppt and asr.exists())
        note_cache = _notes_cache(template, granularity, committed_strategy)

        from services.note_generator import PROVIDERS as _NOTE_PROVIDERS
        s4_provider = st.radio(
            "AI 模型", _NOTE_PROVIDERS, horizontal=True, key="s4_provider",
            help="中转站：走 ANTHROPIC_API_KEY；智增增：走 OPENAI_API_KEY（OpenAI 兼容接口）",
        )

        # ── Debug mode toggle ─────────────────────────────────────────
        debug_mode = st.checkbox(
            "🔬 逐步调试模式（展示每个 Stage 的输入/输出）",
            key="s4_debug_mode",
        )

        if not ready:
            if has_ppt and not aligned.exists():
                st.warning("请先在上方的「Commit to this strategy」完成策略锁定，再生成笔记。")
            else:
                st.info("Complete Step 3 (or Step 2 for no-PPT mode) first.")
        elif note_cache.exists() and not debug_mode:
            notes = _load_json(note_cache)
            col_cache, col_regen = st.columns([4, 1])
            with col_cache:
                st.success(f"✅ Cached — {len(notes)} pages ({template} / {granularity})")
            with col_regen:
                if st.button("🔄 重新生成", key="btn_regen_notes"):
                    note_cache.unlink()
                    st.rerun()
            _render_notes(notes, template)
        else:
            if has_ppt and not aligned.exists():
                st.warning("请先在上方的「Commit to this strategy」完成策略锁定，再生成笔记。")
            elif debug_mode:
                _render_step4_debug(
                    has_ppt, aligned, asr, template, granularity, s4_provider,
                    note_cache,
                )
            else:
                # ── Slide range selector ──────────────────────────────
                pages_in = (_load_json(aligned) if has_ppt
                            else _build_noppt_pages(_load_json(asr)))
                total_pages = len(pages_in)

                col_range1, col_range2 = st.columns(2)
                with col_range1:
                    range_start = st.number_input(
                        "从第几页开始", min_value=1, max_value=total_pages,
                        value=1, step=1, key="s4_range_start",
                    )
                with col_range2:
                    range_end = st.number_input(
                        "到第几页结束", min_value=1, max_value=total_pages,
                        value=total_pages, step=1, key="s4_range_end",
                    )
                selected_pages = pages_in[range_start - 1:range_end]
                st.caption(f"将生成第 {range_start}–{range_end} 页共 {len(selected_pages)} 页笔记（共 {total_pages} 页）")

                if st.button(f"▶ Generate notes [{template} / {granularity}]", key="btn_step4"):
                    t0 = time.time()
                    prog = st.progress(0, text=f"Generating notes for {len(selected_pages)} pages…")
                    from services.note_generator import generate_notes_for_all_pages
                    notes = _run_sync(generate_notes_for_all_pages(
                        selected_pages, template=template, granularity=granularity,
                        provider=s4_provider))
                    _save_json(note_cache, notes)
                    prog.progress(100, text="Done")
                    total_in  = sum(p.get("_cost", {}).get("input_tokens", 0) for p in notes)
                    total_out = sum(p.get("_cost", {}).get("output_tokens", 0) for p in notes)
                    cost = total_in/1e6*CLAUDE_INPUT_PER_1M + total_out/1e6*CLAUDE_OUTPUT_PER_1M
                    elapsed = time.time() - t0
                    _log_run("note_gen", elapsed, total_in+total_out, cost,
                             extra={"template": template, "granularity": granularity,
                                    "n_pages": len(notes)})
                    st.success(f"✅ {_badge(elapsed, total_in+total_out, cost)}")
                    st.rerun()


# ---------------------------------------------------------------------------
# Debug mode: step-by-step pipeline visibility
# Same code path as normal mode — just exposes intermediate state.
# ---------------------------------------------------------------------------

def _render_step4_debug(has_ppt, aligned, asr, template, granularity, provider, note_cache):
    """Show each pipeline stage's input/output using the exact same generate_notes_for_all_pages path."""
    from services.note_generator import (
        PageData, PASSIVE_TEMPLATES,
        _load_prompt, _prepare_tasks,
        generate_notes_for_all_pages,
    )

    st.markdown("### 🔬 逐步调试模式")
    st.caption("与正常模式**完全相同的代码路径**，只是把每步的输入/输出展示出来。")

    # Load raw pages
    pages_in = (_load_json(aligned) if has_ppt else _build_noppt_pages(_load_json(asr)))
    st.info(f"输入：{len(pages_in)} 个页面，模板={template}，粒度={granularity}，provider={provider}")

    # ── Stage 1: Prompt ──────────────────────────────────────────────────
    st.markdown("#### Stage 1 — Prompt 加载 `_load_prompt()`")
    try:
        system_prompt = _load_prompt(template, granularity)
        with st.expander(f"✅ System prompt（{len(system_prompt)} 字符）", expanded=False):
            st.text(system_prompt[:2000] + ("…（已截断）" if len(system_prompt) > 2000 else ""))
    except Exception as e:
        st.error(f"❌ _load_prompt 失败: {e}")
        return

    # ── Stage 2: Task preparation ────────────────────────────────────────
    st.markdown("#### Stage 2 — 任务准备 `_prepare_tasks()`")
    try:
        is_passive = template in PASSIVE_TEMPLATES
        typed_pages = [PageData.model_validate(p) for p in pages_in]
        tasks, _ = _prepare_tasks(typed_pages, system_prompt, template, is_passive)
        st.success(f"✅ 共生成 {len(tasks)} 个 LLM 任务")
        for i, task in enumerate(tasks[:3]):
            with st.expander(f"任务 {i+1}：Slide {task.page.page_num}", expanded=(i == 0)):
                st.markdown("**发给 LLM 的 user_msg:**")
                st.text(task.user_msg[:1500] + ("…（已截断）" if len(task.user_msg) > 1500 else ""))
        if len(tasks) > 3:
            st.caption(f"…还有 {len(tasks) - 3} 个任务未展示")
    except Exception as e:
        st.error(f"❌ _prepare_tasks 失败: {e}")
        return

    # ── Stage 3: Choose slide range ──────────────────────────────────────
    st.markdown("#### Stage 3 — 选择调试范围")
    col1, col2 = st.columns(2)
    with col1:
        debug_start = st.number_input(
            "从第几页", min_value=1, max_value=len(pages_in), value=1, step=1,
            key="s4_debug_start",
        )
    with col2:
        debug_end = st.number_input(
            "到第几页", min_value=1, max_value=len(pages_in),
            value=min(2, len(pages_in)), step=1,
            key="s4_debug_end",
        )
    debug_pages = pages_in[debug_start - 1:debug_end]
    st.caption(f"将调用第 {debug_start}–{debug_end} 页，共 {len(debug_pages)} 页")

    # ── Stage 4: Run via the exact same function as normal mode ──────────
    st.markdown("#### Stage 4 — 运行 `generate_notes_for_all_pages()`")
    st.caption("与正常模式完全相同的函数：retry、并发控制、JSON 解析均包含在内。")

    if not st.button("▶ 开始调用（与正常生成相同路径）", key="btn_s4_debug_run"):
        st.info("点击上方按钮开始调用 API。")
        return

    with st.spinner(f"正在为第 {debug_start}–{debug_end} 页调用 API…"):
        try:
            notes = _run_sync(generate_notes_for_all_pages(
                debug_pages, template=template, granularity=granularity,
                provider=provider,
            ))
        except Exception as e:
            st.error(f"❌ generate_notes_for_all_pages 抛出异常: {e}")
            return

    st.success(f"✅ 完成，共 {len(notes)} 页")

    # ── Stage 5: Show results page by page ───────────────────────────────
    st.markdown("#### Stage 5 — 各页输出（`_parse_and_merge` 结果）")
    for record in notes:
        page_num = record.get("page_num", "?")
        status = record.get("status", "?")
        cost_info = record.get("_cost", {})
        in_tok = cost_info.get("input_tokens", 0)
        out_tok = cost_info.get("output_tokens", 0)
        is_failed = status == "partial_ready"
        icon = "❌" if is_failed else "✅"

        with st.expander(f"{icon} Slide {page_num} — {status}，{in_tok}+{out_tok} tokens", expanded=True):
            if "passive_notes" in record:
                st.markdown("**passive_notes:**")
                st.json(record["passive_notes"])
            if "active_notes" in record:
                st.markdown("**active_notes:**")
                st.json(record["active_notes"])
            with st.expander("完整 record（排除 _cost）", expanded=False):
                st.json({k: v for k, v in record.items() if k != "_cost"})
