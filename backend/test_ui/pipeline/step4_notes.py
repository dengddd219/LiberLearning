"""Step 4 — Note generation."""
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

        if not ready:
            if has_ppt and not aligned.exists():
                st.warning("请先在上方的「Commit to this strategy」完成策略锁定，再生成笔记。")
            else:
                st.info("Complete Step 3 (or Step 2 for no-PPT mode) first.")
        elif note_cache.exists():
            notes = _load_json(note_cache)
            st.success(f"✅ Cached — {len(notes)} pages ({template} / {granularity})")
            _render_notes(notes, template)
        else:
            if has_ppt and not aligned.exists():
                st.warning("请先在上方的「Commit to this strategy」完成策略锁定，再生成笔记。")
            else:
                if st.button(f"▶ Generate notes [{template} / {granularity}]", key="btn_step4"):
                    t0 = time.time()
                    pages_in = (_load_json(aligned) if has_ppt
                                else _build_noppt_pages(_load_json(asr)))
                    prog = st.progress(0, text=f"Generating notes for {len(pages_in)} pages…")
                    from services.note_generator import generate_notes_for_all_pages
                    notes = _run_sync(generate_notes_for_all_pages(
                        pages_in, template=template, granularity=granularity,
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
