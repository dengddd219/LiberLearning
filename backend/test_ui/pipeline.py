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
)


def render_pipeline(language: str, template: str, granularity: str,
                    threshold: float, realign_btn: bool):
    st.title("LiberStudy — Backend Pipeline Tester")

    col_audio, col_ppt = st.columns(2)
    with col_audio:
        audio_file = st.file_uploader("Audio (m4a / mp3 / wav)", type=["m4a", "mp3", "wav"])
    with col_ppt:
        ppt_file = st.file_uploader("Slides (pdf / pptx / ppt) — optional", type=["pdf", "pptx", "ppt"])

    has_ppt = ppt_file is not None

    # ── Step 0 ────────────────────────────────────────────────────────────────
    with st.expander("Step 0 — Audio upload & conversion", expanded=True):
        wav = _wav_path()
        if audio_file is None:
            st.info("Upload an audio file above to begin.")
        elif wav.exists():
            from services.audio import get_audio_duration
            dur = get_audio_duration(str(wav))
            st.success(f"✅ Cached WAV — {dur:.1f}s ({wav.stat().st_size/1e6:.1f} MB)")
        else:
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

    # ── Step 1 ────────────────────────────────────────────────────────────────
    with st.expander("Step 1 — PPT parsing", expanded=has_ppt):
        ppt_cache  = _ppt_path()
        slides_dir = _slides_dir()
        if not has_ppt:
            st.info("No PPT uploaded — no-PPT mode. Step 1 skipped.")
        elif ppt_cache.exists():
            pages_meta = _load_json(ppt_cache)
            st.success(f"✅ Cached — {len(pages_meta)} slides")
            cols = st.columns(min(len(pages_meta), 5))
            for i, pg in enumerate(pages_meta[:5]):
                img_path = _get_run_dir() / pg["slide_image_url"].lstrip("/")
                if img_path.exists():
                    with cols[i % 5]:
                        st.image(str(img_path), caption=f"Slide {pg['page_num']}",
                                 use_container_width=True)
        else:
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

    # ── Step 2 ────────────────────────────────────────────────────────────────
    with st.expander("Step 2 — ASR transcription", expanded=False):
        wav = _wav_path()
        asr = _asr_path()
        if not wav.exists():
            st.info("Complete Step 0 first.")
        elif asr.exists():
            segments = _load_json(asr)
            total_chars = sum(len(s["text"]) for s in segments)
            st.success(f"✅ Cached — {len(segments)} segments, {total_chars:,} chars")
            for seg in segments[:10]:
                ms, me = int(seg["start"]), int(seg["end"])
                st.text(f"[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}] {seg['text']}")
            if len(segments) > 10:
                st.caption(f"… and {len(segments)-10} more")
        else:
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

    # ── Step 3 ────────────────────────────────────────────────────────────────
    with st.expander("Step 3 — Semantic alignment", expanded=False):
        if not has_ppt:
            st.info("No PPT — alignment skipped.")
        else:
            aligned_path = _aligned_path()
            ppt_cache   = _ppt_path()
            asr         = _asr_path()
            if not asr.exists() or not ppt_cache.exists():
                st.info("Complete Steps 1 & 2 first.")
            else:
                aligned_exists   = aligned_path.exists()
                cached_threshold = st.session_state.get("last_threshold")
                need_realign     = realign_btn or not aligned_exists or cached_threshold != threshold

                if need_realign:
                    t0 = time.time()
                    prog = st.progress(0, text="Embedding PPT pages…")
                    import services.alignment as _align_mod
                    _align_mod.OFF_SLIDE_THRESHOLD = threshold
                    from services.alignment import build_page_timeline
                    from services.audio import get_audio_duration
                    pages_meta = _load_json(ppt_cache)
                    segments   = _load_json(asr)
                    dur        = get_audio_duration(str(_wav_path()))
                    prog.progress(50, text="Computing similarity…")
                    aligned = build_page_timeline(pages_meta, segments, total_audio_duration=dur)
                    _save_json(aligned_path, aligned)
                    st.session_state["last_threshold"] = threshold
                    elapsed = time.time() - t0
                    total_chars = (sum(len(p.get("ppt_text","")) for p in pages_meta)
                                   + sum(len(s["text"]) for s in segments))
                    est_tokens = total_chars // 4
                    cost = est_tokens / 1e6 * EMBED_COST_PER_1M_TOK
                    _log_run("alignment", elapsed, est_tokens, cost,
                             extra={"threshold": threshold,
                                    "avg_confidence": sum(p.get("alignment_confidence",0)
                                                          for p in aligned) / max(len(aligned),1)})
                    prog.progress(100, text="Done")
                    st.success(f"✅ {_badge(elapsed, est_tokens, cost)}")

                if aligned_path.exists():
                    aligned = _load_json(aligned_path)
                    covered  = sum(1 for p in aligned if p.get("aligned_segments"))
                    avg_conf = sum(p.get("alignment_confidence",0) for p in aligned) / max(len(aligned),1)
                    c1, c2, c3 = st.columns(3)
                    c1.metric("Slides covered", f"{covered}/{len(aligned)}")
                    c2.metric("Avg confidence", f"{avg_conf:.2f}")
                    c3.metric("Threshold", threshold)

                    for pg in aligned:
                        conf = pg.get("alignment_confidence", 0)
                        icon = _confidence_color(conf)
                        segs = pg.get("aligned_segments", [])
                        ts   = int(pg.get("page_start_time", 0))
                        te   = int(pg.get("page_end_time", 0))
                        st.markdown(
                            f"{icon} **Slide {pg['page_num']}** — "
                            f"conf={conf:.2f}, {len(segs)} segs "
                            f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}]"
                        )
                        for s in segs[:2]:
                            t = int(s["start"])
                            st.caption(f"  [{t//60:02d}:{t%60:02d}] {s['text'][:80]}")
                        if pg.get("page_supplement"):
                            st.caption(f"  📎 {pg['page_supplement']['content'][:60]}…")

                # ── Bullet-level alignment (3 methods) ─────────────────────
                st.divider()
                st.subheader("Bullet-Level Alignment (A / B / C)")

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

    # ── Step 4 ────────────────────────────────────────────────────────────────
    with st.expander("Step 4 — Note generation", expanded=False):
        note_cache = _notes_cache(template, granularity)
        asr        = _asr_path()
        aligned    = _aligned_path()
        ready = (has_ppt and aligned.exists()) or (not has_ppt and asr.exists())

        if not ready:
            st.info("Complete Step 3 (or Step 2 for no-PPT mode) first.")
        elif note_cache.exists():
            notes = _load_json(note_cache)
            st.success(f"✅ Cached — {len(notes)} pages ({template} / {granularity})")
            _render_notes(notes, template)
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
                total_in  = sum(p.get("_cost",{}).get("input_tokens",0) for p in notes)
                total_out = sum(p.get("_cost",{}).get("output_tokens",0) for p in notes)
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
            if has_ppt and aligned.exists():
                aligned_data = _load_json(aligned)
                page_opts = [f"Slide {p['page_num']}" for p in aligned_data]
                idx = st.selectbox("Page", range(len(page_opts)),
                                   format_func=lambda i: page_opts[i])
                active_page = aligned_data[idx]
            else:
                pages_in  = _build_noppt_pages(_load_json(asr))
                page_opts = [f"Topic {p['page_num']}" for p in pages_in]
                idx = st.selectbox("Topic segment", range(len(page_opts)),
                                   format_func=lambda i: page_opts[i])
                active_page = pages_in[idx]

            active_tmpl = st.selectbox("Active template",
                                       ["active_expand", "active_comprehensive"],
                                       format_func=lambda x: {
                                           "active_expand": "① 基于我的笔记扩写",
                                           "active_comprehensive": "③ 完整综合笔记"}[x])
            user_note = st.text_area("Your annotation", height=100,
                                     placeholder="Type what you wrote during the lecture…")

            if st.button("▶ Generate expansion", key="btn_step5") and user_note.strip():
                t0 = time.time()
                page_with_note = {**active_page, "active_notes": {"user_note": user_note}}
                prog = st.progress(0, text="Calling Claude…")
                from services.note_generator import generate_notes_for_all_pages
                result = _run_sync(generate_notes_for_all_pages(
                    [page_with_note], template=active_tmpl, granularity=granularity))
                prog.progress(100, text="Done")
                r = result[0]
                elapsed = time.time() - t0
                ci   = r.get("_cost", {})
                tok  = ci.get("input_tokens",0) + ci.get("output_tokens",0)
                cost = (ci.get("input_tokens",0)/1e6*CLAUDE_INPUT_PER_1M
                        + ci.get("output_tokens",0)/1e6*CLAUDE_OUTPUT_PER_1M)
                _log_run("active_learn", elapsed, tok, cost,
                         extra={"template": active_tmpl})
                st.caption(_badge(elapsed, tok, cost))
                an = r.get("active_notes", {})
                if "ai_expansion" in an:
                    st.markdown("**AI Expansion:**")
                    st.markdown(an["ai_expansion"])
                    if an.get("timestamp_start", -1) >= 0:
                        ts = int(an["timestamp_start"]); te = int(an["timestamp_end"])
                        st.caption(f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}]")
                elif an.get("bullets"):
                    _render_bullets(an["bullets"])
                else:
                    st.error(an.get("error", "Unknown error"))

    # ── Step 6 ────────────────────────────────────────────────────────────────
    with st.expander("Step 6 — Export", expanded=False):
        note_cache = _notes_cache(template, granularity)
        if not note_cache.exists():
            st.info("Generate notes (Step 4) first.")
        else:
            notes = _load_json(note_cache)
            col_md, col_pdf = st.columns(2)
            with col_md:
                md_content = _build_markdown(notes, template, has_ppt)
                st.download_button("⬇ Download Markdown", data=md_content,
                                   file_name=f"liberstudy_{template}_{granularity}.md",
                                   mime="text/markdown", use_container_width=True)
            with col_pdf:
                if st.button("⬇ Generate PDF", use_container_width=True, key="btn_pdf"):
                    pdf_bytes = _build_pdf(notes, template, has_ppt)
                    st.download_button("Click to save PDF", data=pdf_bytes,
                                       file_name=f"liberstudy_{template}_{granularity}.pdf",
                                       mime="application/pdf", use_container_width=True)
            st.markdown("**Preview (first 3000 chars):**")
            st.markdown(md_content[:3000] + ("\n\n…" if len(md_content) > 3000 else ""))

    # ── Issues & Findings ──────────────────────────────────────────────────────
    st.divider()
    st.subheader("🔍 Issues & Findings")

    issues = []
    aligned_path = _aligned_path()
    notes_path   = _notes_cache(template, granularity)

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
