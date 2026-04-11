"""
Pipeline tab — Steps 0–6 + Issues & Findings.
"""
import os
import shutil
import tempfile
import time
from pathlib import Path

import streamlit as st

from test_ui.helpers import (
    WHISPER_COST_PER_MIN, EMBED_COST_PER_1M_TOK,
    CLAUDE_INPUT_PER_1M, CLAUDE_OUTPUT_PER_1M,
    _badge, _confidence_color, _run_sync, _log_run,
    _render_bullets, _render_notes, _build_noppt_pages, _build_markdown, _build_pdf,
    _get_run_dir, _get_slides_dir,
    _wav_path, _asr_path, _aligned_path, _ppt_path,
    _notes_cache, _slides_dir, _log_path,
    _save_json, _load_json,
    _aligned_path_for_strategy, _load_strategy_module,
    ALIGNMENT_STRATEGIES, PROMPT_REGISTRY,
)


def _render_ppt_page_image(page_num: int) -> bytes | None:
    """Render PPT page as PNG bytes using PyMuPDF. page_num is 1-indexed."""
    import fitz
    slides_dir = _get_slides_dir()
    pdf_path = slides_dir / "slides.pdf"
    if not pdf_path.exists():
        return None
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


def render_pipeline(language: str, threshold: float, realign_btn: bool):
    st.title("LiberStudy — Backend Pipeline Tester")

    col_audio, col_ppt = st.columns(2)
    with col_audio:
        audio_file = st.file_uploader("Audio (m4a / mp3 / wav)", type=["m4a", "mp3", "wav"])
    with col_ppt:
        ppt_file = st.file_uploader("Slides (pdf / pptx / ppt) — optional", type=["pdf", "pptx", "ppt"])

    has_ppt = ppt_file is not None or _ppt_path().exists()

    # ── Step 0 ────────────────────────────────────────────────────────────────
    with st.expander("Step 0 — Audio upload & conversion", expanded=True):
        wav = _wav_path()
        if wav.exists():
            from services.audio import get_audio_duration
            dur = get_audio_duration(str(wav))
            st.success(f"✅ Cached WAV — {dur:.1f}s ({wav.stat().st_size/1e6:.1f} MB)")
        elif audio_file is not None:
            if st.button("▶ Convert to WAV", key="btn_step0"):
                t0 = time.time()
                prog = st.progress(0, text="Saving uploaded file…")
                suffix = Path(audio_file.name).suffix
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp.write(audio_file.read())
                    tmp_path = tmp.name
                prog.progress(30, text="Converting to WAV…")
                from services.audio import convert_to_wav, get_audio_duration, _ffmpeg_path
                import subprocess
                full_wav = _get_run_dir() / "test_audio_full.wav"
                convert_to_wav(tmp_path, str(full_wav))
                os.unlink(tmp_path)
                prog.progress(70, text="Trimming to 10 minutes…")
                ffmpeg = _ffmpeg_path()
                subprocess.run([
                    ffmpeg, "-y", "-i", str(full_wav),
                    "-t", "600", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                    str(wav)
                ], capture_output=True, check=True)
                full_wav.unlink(missing_ok=True)
                prog.progress(100, text="Done")
                elapsed = time.time() - t0
                dur = get_audio_duration(str(wav))
                _log_run("audio", elapsed, extra={"duration_s": dur})
                st.success(f"✅ {_badge(elapsed)} — {dur:.1f}s (trimmed to 10 min)")
        else:
            st.info("Upload an audio file above to begin.")

    # ── Step 1 ────────────────────────────────────────────────────────────────
    with st.expander("Step 1 — PPT parsing", expanded=has_ppt):
        ppt_cache  = _ppt_path()
        slides_dir = _slides_dir()
        if ppt_cache.exists():
            pages_meta = _load_json(ppt_cache)
            st.success(f"✅ Cached — {len(pages_meta)} slides")
            cols = st.columns(min(len(pages_meta), 5))
            import fitz
            pdf_path = slides_dir / "slides.pdf"
            if pdf_path.exists():
                doc = fitz.open(str(pdf_path))
                mat = fitz.Matrix(1.5, 1.5)
                for i, pg in enumerate(pages_meta[:5]):
                    page_idx = pg["pdf_page_num"] - 1
                    if page_idx < len(doc):
                        pix = doc[page_idx].get_pixmap(matrix=mat)
                        img_bytes = pix.tobytes("png")
                        with cols[i % 5]:
                            st.image(img_bytes, caption=f"Slide {pg['page_num']}",
                                     use_container_width=True)
                doc.close()
        elif ppt_file is not None:
            if st.button("▶ Parse PPT", key="btn_step1"):
                t0 = time.time()
                prog = st.progress(0, text="Saving PPT file…")
                suffix = Path(ppt_file.name).suffix
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp.write(ppt_file.read())
                    tmp_path = tmp.name
                prog.progress(30, text="Converting PPT → PDF → PNG…")
                from services.ppt_parser import parse_ppt
                pages_meta = parse_ppt(tmp_path, str(slides_dir))
                os.unlink(tmp_path)
                _save_json(ppt_cache, pages_meta)
                prog.progress(100, text="Done")
                elapsed = time.time() - t0
                _log_run("ppt_parse", elapsed, extra={"n_pages": len(pages_meta)})
                st.success(f"✅ {_badge(elapsed)} — {len(pages_meta)} slides")
                st.rerun()
        else:
            st.info("No PPT uploaded — no-PPT mode. Step 1 skipped.")

    # ── Step 2 ────────────────────────────────────────────────────────────────
    with st.expander("Step 2 — ASR transcription", expanded=False):
        wav = _wav_path()
        asr = _asr_path()
        if asr.exists():
            segments = _load_json(asr)
            total_chars = sum(len(s["text"]) for s in segments)
            st.success(f"✅ Cached — {len(segments)} segments, {total_chars:,} chars")
            for seg in segments[:10]:
                ms, me = int(seg["start"]), int(seg["end"])
                st.text(f"[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}] {seg['text']}")
            if len(segments) > 10:
                st.caption(f"… and {len(segments)-10} more")
        elif wav.exists():
            if st.button("▶ Run ASR", key="btn_step2"):
                t0 = time.time()
                from services.audio import get_audio_duration
                dur = get_audio_duration(str(wav))
                prog = st.progress(0, text="Sending to Whisper API…")
                from services.asr import transcribe_openai
                segments = transcribe_openai(str(wav), language=language)
                _save_json(asr, segments)
                prog.progress(100, text="Done")
                elapsed = time.time() - t0
                cost = (dur / 60) * WHISPER_COST_PER_MIN
                _log_run("asr", elapsed, cost=cost,
                         extra={"n_segments": len(segments), "duration_s": dur})
                st.success(f"✅ {_badge(elapsed, cost=cost)} — {len(segments)} segments")
                st.rerun()
        else:
            st.info("Complete Step 0 first.")

    # ── Step 3 ────────────────────────────────────────────────────────────────
    with st.expander("Step 3 — Semantic alignment", expanded=False):
        if not has_ppt:
            st.info("No PPT — alignment skipped.")
        else:
            ppt_cache = _ppt_path()
            asr       = _asr_path()
            if not asr.exists() or not ppt_cache.exists():
                st.info("Complete Steps 1 & 2 first.")
            else:
                segments_data  = _load_json(asr)
                ppt_pages_data = _load_json(ppt_cache)

                # ── Strategy selection row ────────────────────────────────────
                strat_keys   = list(ALIGNMENT_STRATEGIES.keys())
                strat_labels = [ALIGNMENT_STRATEGIES[k]["label"] for k in strat_keys]

                col_left_sel, col_right_sel = st.columns(2)
                with col_left_sel:
                    left_strat_idx = st.selectbox(
                        "Strategy (Left Pane)", range(len(strat_keys)),
                        format_func=lambda i: strat_labels[i],
                        key="left_strategy"
                    )
                    left_key = strat_keys[left_strat_idx]
                    left_mod = _load_strategy_module(left_key)
                    st.text_area("Strategy description",
                                 value=getattr(left_mod, "STRATEGY_DESCRIPTION", ""),
                                 disabled=True, height=80, key="left_strat_desc")

                with col_right_sel:
                    right_strat_idx = st.selectbox(
                        "Strategy (Right Pane)", range(len(strat_keys)),
                        format_func=lambda i: strat_labels[i],
                        index=min(1, len(strat_keys) - 1),
                        key="right_strategy"
                    )
                    right_key = strat_keys[right_strat_idx]
                    right_mod = _load_strategy_module(right_key)
                    st.text_area("Strategy description",
                                 value=getattr(right_mod, "STRATEGY_DESCRIPTION", ""),
                                 disabled=True, height=80, key="right_strat_desc")

                # ── Per-strategy run buttons ──────────────────────────────────
                def _ensure_alignment(strategy_key, label):
                    path = _aligned_path_for_strategy(strategy_key)
                    if path.exists() and not realign_btn:
                        return _load_json(path)
                    if st.button(f"▶ Run {label}", key=f"btn_align_{strategy_key}"):
                        t0 = time.time()
                        from services.audio import get_audio_duration
                        dur = get_audio_duration(str(_wav_path()))
                        mod = _load_strategy_module(strategy_key)
                        mod.OFF_SLIDE_THRESHOLD = threshold
                        aligned = mod.build_page_timeline(
                            ppt_pages_data, segments_data, total_audio_duration=dur
                        )
                        _save_json(path, aligned)
                        elapsed = time.time() - t0
                        total_chars = (sum(len(p.get("ppt_text", "")) for p in ppt_pages_data)
                                       + sum(len(s["text"]) for s in segments_data))
                        est_tokens = total_chars // 4
                        cost = est_tokens / 1e6 * EMBED_COST_PER_1M_TOK
                        _log_run(f"alignment_{strategy_key}", elapsed, est_tokens, cost,
                                 extra={"strategy": strategy_key, "threshold": threshold})
                        st.rerun()
                    return None

                col_run_l, col_run_r = st.columns(2)
                with col_run_l:
                    left_aligned = _ensure_alignment(left_key, strat_labels[left_strat_idx])
                with col_run_r:
                    right_aligned = _ensure_alignment(right_key, strat_labels[right_strat_idx])

                # ── Section A — Overall View ──────────────────────────────────
                st.subheader("Section A — Overall Confidence View")
                col_a_l, col_a_r = st.columns(2)

                def _render_confidence_badges(aligned_data, label):
                    if aligned_data is None:
                        st.caption(f"({label} not run yet)")
                        return None, None
                    covered = sum(1 for p in aligned_data if p.get("aligned_segments"))
                    avg_conf = sum(p.get("alignment_confidence", 0) for p in aligned_data) / max(len(aligned_data), 1)
                    high_conf_count = sum(1 for p in aligned_data if p.get("alignment_confidence", 0) >= 0.6)
                    off_slide_count = sum(len(p.get("off_slide_segments", [])) for p in aligned_data)
                    for pg in aligned_data:
                        conf = pg.get("alignment_confidence", 0)
                        icon = _confidence_color(conf)
                        segs = pg.get("aligned_segments", [])
                        ts   = int(pg.get("page_start_time", 0))
                        te   = int(pg.get("page_end_time", 0))
                        st.markdown(
                            f"{icon} Slide {pg['page_num']} — "
                            f"conf={conf:.2f}, {len(segs)} segs "
                            f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}]"
                        )
                    st.caption(f"Covered: {covered}/{len(aligned_data)} | Avg conf: {avg_conf:.2f}")
                    return avg_conf, high_conf_count, off_slide_count

                with col_a_l:
                    st.markdown(f"**{strat_labels[left_strat_idx]}**")
                    left_stats = _render_confidence_badges(left_aligned, strat_labels[left_strat_idx])

                with col_a_r:
                    st.markdown(f"**{strat_labels[right_strat_idx]}**")
                    right_stats = _render_confidence_badges(right_aligned, strat_labels[right_strat_idx])

                # Delta row
                if (left_aligned is not None and right_aligned is not None
                        and left_stats is not None and right_stats is not None
                        and len(left_stats) == 3 and len(right_stats) == 3):
                    l_avg, l_high, l_off = left_stats
                    r_avg, r_high, r_off = right_stats
                    avg_delta = r_avg - l_avg
                    high_delta = r_high - l_high
                    n_pages = max(len(left_aligned), len(right_aligned), 1)
                    high_pct = f"{high_delta/n_pages*100:+.0f}%"
                    off_delta = r_off - l_off
                    l_off_safe = max(l_off, 1)
                    off_pct = f"{off_delta/l_off_safe*100:+.0f}%"
                    st.info(
                        f"📊 Delta (V2 vs V1): Avg conf {avg_delta:+.2f} | "
                        f"高置信度页面 (≥0.6) {high_delta:+d} ({high_pct}) | "
                        f"Off-slide 段 {off_delta:+d} ({off_pct})"
                    )

                # ── Section B — Transcript Timeline ───────────────────────────
                st.subheader("Section B — Transcript Timeline")

                page_size = st.number_input(
                    "Segments per page", min_value=5, max_value=100, value=15, step=5,
                    key="tl_page_size"
                )

                # Pagination state
                if "tl_current_page" not in st.session_state:
                    st.session_state["tl_current_page"] = 0

                asr_segs = segments_data
                total_segs  = len(asr_segs)
                total_pages = max(1, (total_segs + page_size - 1) // page_size)
                cur_tl = min(st.session_state["tl_current_page"], total_pages - 1)

                nav1, nav2, nav3 = st.columns([1, 3, 1])
                with nav1:
                    if st.button("← Prev", key="tl_prev", disabled=cur_tl == 0):
                        st.session_state["tl_current_page"] = cur_tl - 1
                        st.rerun()
                with nav2:
                    st.caption(f"Page {cur_tl + 1} / {total_pages}  ({total_segs} segments total)")
                with nav3:
                    if st.button("Next →", key="tl_next", disabled=cur_tl >= total_pages - 1):
                        st.session_state["tl_current_page"] = cur_tl + 1
                        st.rerun()

                def _build_seg_lookup(aligned):
                    lookup = {}
                    if aligned is None:
                        return lookup
                    for pg in aligned:
                        for s in pg.get("aligned_segments", []):
                            lookup[s["start"]] = {
                                "page_num": pg["page_num"],
                                "is_off_slide": False,
                                "similarity": s.get("similarity", 0),
                                "conf": pg.get("alignment_confidence", 0),
                            }
                        for s in pg.get("off_slide_segments", []):
                            lookup[s["start"]] = {
                                "page_num": pg["page_num"],
                                "is_off_slide": True,
                                "similarity": s.get("similarity", 0),
                                "conf": pg.get("alignment_confidence", 0),
                            }
                    return lookup

                left_lookup  = _build_seg_lookup(left_aligned)
                right_lookup = _build_seg_lookup(right_aligned)

                s_start = cur_tl * page_size
                for seg in asr_segs[s_start: s_start + page_size]:
                    ms = int(seg["start"])
                    me = int(seg["end"])
                    st.markdown(f"`[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}]` {seg['text']}")
                    sub_l, sub_r = st.columns(2)

                    def _fmt_info(info, label):
                        if info is None:
                            return f"({label} — not run)"
                        if info["is_off_slide"]:
                            return f"off-slide (near Slide {info['page_num']}), sim={info['similarity']:.3f}"
                        return f"Slide {info['page_num']}, sim={info['similarity']:.3f}, conf={info['conf']:.2f}"

                    with sub_l:
                        li = left_lookup.get(seg["start"])
                        st.caption(f"  L: {_fmt_info(li, strat_labels[left_strat_idx])}")
                    with sub_r:
                        ri = right_lookup.get(seg["start"])
                        st.caption(f"  R: {_fmt_info(ri, strat_labels[right_strat_idx])}")

                # ── Legacy: bullet-level alignment (collapsed) ────────────────
                aligned_path = _aligned_path()
                with st.expander("Bullet-Level Alignment (A / B / C) — Legacy", expanded=False):
                    if not aligned_path.exists():
                        st.info("Run alignment first to enable bullet-level analysis.")
                    else:
                        aligned_data = _load_json(aligned_path)
                        page_opts_ba = [f"Slide {p['page_num']} ({len(p.get('aligned_segments',[]))} segs)"
                                        for p in aligned_data if p.get("aligned_segments")]
                        pages_with_segs = [p for p in aligned_data if p.get("aligned_segments")]

                        if not pages_with_segs:
                            st.warning("No slides have aligned segments — cannot run bullet alignment.")
                        else:
                            ba_page_idx = st.selectbox("Select slide for bullet alignment",
                                                       range(len(page_opts_ba)),
                                                       format_func=lambda i: page_opts_ba[i],
                                                       key="ba_page_sel")
                            ba_page     = pages_with_segs[ba_page_idx]
                            ba_segments = ba_page.get("aligned_segments", [])
                            ba_ppt_text = ba_page.get("ppt_text", "")
                            bullet_lines = [l.strip() for l in ba_ppt_text.splitlines() if l.strip()]
                            st.caption(f"{len(bullet_lines)} bullets, {len(ba_segments)} segments on this slide")

                            if st.button("▶ Run Bullet Alignment (all 3 methods)", key="btn_bullet_align"):
                                from services.bullet_alignment import (
                                    align_bullets_embedding,
                                    align_bullets_llm,
                                    align_bullets_hybrid,
                                )
                                results = {}
                                prog = st.progress(0, text="Method A (Embedding)…")
                                t0 = time.time()
                                results["A"] = align_bullets_embedding(ba_ppt_text, ba_segments)
                                elapsed_a = time.time() - t0

                                prog.progress(33, text="Method B (LLM)…")
                                t1 = time.time()
                                results["B"] = align_bullets_llm(ba_ppt_text, ba_segments)
                                elapsed_b = time.time() - t1

                                prog.progress(66, text="Method C (Hybrid)…")
                                t2 = time.time()
                                results["C"] = align_bullets_hybrid(ba_ppt_text, ba_segments)
                                elapsed_c = time.time() - t2

                                prog.progress(100, text="Done")
                                ba_out = {
                                    "page_num": ba_page["page_num"],
                                    "bullets": bullet_lines,
                                    "n_segments": len(ba_segments),
                                    "A": {"results": results["A"], "elapsed_s": round(elapsed_a, 2)},
                                    "B": {"results": results["B"], "elapsed_s": round(elapsed_b, 2)},
                                    "C": {"results": results["C"], "elapsed_s": round(elapsed_c, 2)},
                                }
                                _save_json(_get_run_dir() / "bullet_alignment.json", ba_out)
                                _log_run("bullet_align", elapsed_a + elapsed_b + elapsed_c,
                                         extra={"page_num": ba_page["page_num"]})
                                st.rerun()

                            ba_cache = _get_run_dir() / "bullet_alignment.json"
                            if ba_cache.exists():
                                ba_out = _load_json(ba_cache)
                                col_a, col_b, col_c = st.columns(3)
                                for col, method, label in [
                                    (col_a, "A", "A — Embedding"),
                                    (col_b, "B", "B — LLM"),
                                    (col_c, "C", "C — Hybrid"),
                                ]:
                                    with col:
                                        st.markdown(f"**{label}** ({ba_out[method]['elapsed_s']:.1f}s)")
                                        for r in ba_out[method]["results"][:10]:
                                            bidx = r["bullet_idx"]
                                            conf = r["confidence"]
                                            icon = "🟢" if conf >= 0.6 else ("🟡" if conf >= 0.3 else "🔴")
                                            bullet_text = (ba_out["bullets"][bidx][:30] + "…"
                                                           if 0 <= bidx < len(ba_out["bullets"])
                                                           else "(off-slide)")
                                            st.caption(f"{icon} seg{r['segment_idx']} → {bullet_text} ({conf:.2f})")

                with st.expander("Legacy Run Diff", expanded=False):
                    from test_ui.align_compare import render_align_compare
                    render_align_compare()

    # ── Step 4 ────────────────────────────────────────────────────────────────
    with st.expander("Step 4 — Note generation", expanded=False):
        asr     = _asr_path()
        aligned = _aligned_path()

        # ── Template + granularity selector (moved from sidebar) ──────────────
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

        # ── Prompt version selector ───────────────────────────────────────────
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
                    st.text_area("Description", value=pv["description"], disabled=True, height=60,
                                 key=f"pvdesc_{template}_{pv['version_label']}")
        else:
            st.caption("No prompt versions found for this template.")

        # ── Strategy commitment section ───────────────────────────────────────
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

        # ── Note generation ───────────────────────────────────────────────────
        ready = (has_ppt and aligned.exists()) or (not has_ppt and asr.exists())
        note_cache = _notes_cache(template, granularity)

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
                        pages_in, template=template, granularity=granularity))
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

    # ── Step 5 ────────────────────────────────────────────────────────────────
    with st.expander("Step 5 — Active learning test", expanded=False):
        asr     = _asr_path()
        aligned = _aligned_path()
        if not asr.exists():
            st.info("Complete Step 2 (ASR) first.")
        else:
            # ── 页码 + 模板 + 粒度选择 ──────────────────────────────────────
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

            # ── PPT 画面展示 ─────────────────────────────────────────────────
            if has_ppt:
                img_bytes = _render_ppt_page_image(
                    active_page.get("pdf_page_num", page_num)
                )
                if img_bytes:
                    st.image(img_bytes, caption=f"Slide {page_num}",
                             use_container_width=True)
                else:
                    st.info("PPT image not available for this page.")

            # ── 标注输入区 ────────────────────────────────────────────────────
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

            # ── 标注列表 + 老师文本 ───────────────────────────────────────────
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

            # ── 生成笔记 ──────────────────────────────────────────────────────
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

            # ── LLM 输出展示 ──────────────────────────────────────────────────
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

    # ── Step 6 ────────────────────────────────────────────────────────────────
    with st.expander("Step 6 — Export", expanded=False):
        # Use s4_template / s4_granularity if available, else defaults
        template_exp  = st.session_state.get("s4_template", "passive_ppt_notes")
        gran_exp      = st.session_state.get("s4_granularity", "simple")
        note_cache = _notes_cache(template_exp, gran_exp)
        if not note_cache.exists():
            st.info("Generate notes (Step 4) first.")
        else:
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

    # ── Issues & Findings ──────────────────────────────────────────────────────
    st.divider()
    st.subheader("🔍 Issues & Findings")

    issues = []
    aligned_path = _aligned_path()
    template_iss  = st.session_state.get("s4_template", "passive_ppt_notes")
    gran_iss      = st.session_state.get("s4_granularity", "simple")
    notes_path   = _notes_cache(template_iss, gran_iss)

    if aligned_path.exists():
        aligned = _load_json(aligned_path)

        low_conf = [p for p in aligned if p.get("alignment_confidence", 0) < 0.3]
        if low_conf:
            low_conf_names = ", ".join(f"Slide {p['page_num']}" for p in low_conf[:5])
            issues.append({
                "severity": "🔴 Low confidence",
                "count": len(low_conf),
                "detail": f"Slides with conf < 0.3: {low_conf_names}" + (" …" if len(low_conf) > 5 else ""),
                "suggestion": "Try lowering the alignment threshold in the sidebar.",
            })

        empty = [p for p in aligned if not p.get("aligned_segments") and p.get("page_supplement")]
        if empty:
            empty_names = ", ".join(f"Slide {p['page_num']}" for p in empty[:5])
            issues.append({
                "severity": "🟡 No transcript match",
                "count": len(empty),
                "detail": f"Slides with no aligned transcript: {empty_names}",
                "suggestion": "These slides likely contain content the teacher didn't discuss or discussed off-mic.",
            })

        silent = [p for p in aligned if not p.get("aligned_segments") and not p.get("page_supplement")]
        if silent:
            silent_names = ", ".join(f"Slide {p['page_num']}" for p in silent[:5])
            issues.append({
                "severity": "🟡 Silent slides",
                "count": len(silent),
                "detail": f"Slides with zero audio coverage: {silent_names}",
                "suggestion": "Either the teacher skipped these slides, or the audio recording missed this section.",
            })

        if notes_path.exists():
            notes = _load_json(notes_path)
            noisy_bullets = []
            for pg in notes:
                passive = pg.get("passive_notes", {})
                for b in passive.get("bullets", []):
                    text = b.get("ppt_bullet", "")
                    if text and (text.strip().replace(".", "").isdigit()
                                 or len(text.strip().split()) == 1
                                 or text.strip() in ("Xiao Lei", "XiaoLei", "作者", "页码")):
                        noisy_bullets.append(f"Slide {pg['page_num']}: '{text}'")
            if noisy_bullets:
                issues.append({
                    "severity": "🟡 Noisy bullet extractions",
                    "count": len(noisy_bullets),
                    "detail": " | ".join(noisy_bullets[:4]),
                    "suggestion": "Filter out page numbers and author names in ppt_parser.py (post-processing).",
                })

        avg_conf = sum(p.get("alignment_confidence", 0) for p in aligned) / max(len(aligned), 1)
        if avg_conf < 0.25:
            issues.append({
                "severity": "🔴 Very low overall confidence",
                "count": 0,
                "detail": f"Run average confidence: {avg_conf:.2f} — well below 0.3",
                "suggestion": "This often happens when the 10-min audio covers only a small portion of the slide deck.",
            })

    if issues:
        for issue in issues:
            with st.container():
                col_sev, col_txt = st.columns([1, 4])
                with col_sev:
                    st.markdown(f"**{issue['severity']}**")
                with col_txt:
                    st.markdown(f"**{issue['detail']}**")
                    st.caption(f"💡 {issue['suggestion']}")
                st.divider()
    else:
        st.success("No issues detected — pipeline ran cleanly.")

    st.divider()
    st.caption(f"Run folder: `{_get_run_dir()}`")
