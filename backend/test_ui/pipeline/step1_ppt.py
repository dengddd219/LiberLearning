"""Step 1 — PPT parsing."""
import tempfile
import time
from pathlib import Path

import streamlit as st

from test_ui.helpers import (
    _badge, _log_run,
    _ppt_path, _slides_dir, _get_slides_dir,
    _save_json, _load_json,
)


def _render_slide_strip(pages_meta, pdf_path):
    """Horizontal scrollable strip + click-to-preview."""
    import fitz
    import base64

    doc = fitz.open(str(pdf_path))
    mat_thumb = fitz.Matrix(0.4, 0.4)   # strip thumbnails
    mat_prev  = fitz.Matrix(1.2, 1.2)   # preview (not too large)

    n = len(pages_meta)
    if "s1_selected_slide" not in st.session_state:
        st.session_state["s1_selected_slide"] = pages_meta[0]["page_num"]

    # ── Render all thumbnails as base64 ─────────────────────────────────
    thumb_b64 = {}
    for pg in pages_meta:
        idx = pg["pdf_page_num"] - 1
        if idx < len(doc):
            pix = doc[idx].get_pixmap(matrix=mat_thumb)
            thumb_b64[pg["page_num"]] = base64.b64encode(pix.tobytes("png")).decode()

    # ── Scrollable HTML strip ────────────────────────────────────────────
    selected = st.session_state["s1_selected_slide"]
    items = []
    for pg in pages_meta:
        sn = pg["page_num"]
        b64 = thumb_b64.get(sn)
        if not b64:
            continue
        border = "3px solid #4F8EF7" if sn == selected else "2px solid #e0e0e0"
        items.append(
            f'<div style="flex:0 0 auto;text-align:center;padding:3px;">'
            f'<img src="data:image/png;base64,{b64}" '
            f'style="height:80px;border:{border};border-radius:4px;display:block;"/>'
            f'<span style="font-size:10px;color:#888;">Slide {sn}</span>'
            f'</div>'
        )

    strip_html = (
        '<div style="display:flex;flex-direction:row;gap:4px;overflow-x:auto;'
        'padding:6px 4px 8px 4px;background:#f5f5f5;border-radius:6px;">'
        + "".join(items)
        + "</div>"
    )
    st.markdown(strip_html, unsafe_allow_html=True)

    # ── Click buttons (one per slide, in a scrollable row of columns) ────
    # 每行最多显示 N 个按钮，超出部分换行 — 这样所有 slide 都可以点到
    cols = st.columns(min(n, 20))
    for i, pg in enumerate(pages_meta):
        sn = pg["page_num"]
        with cols[i % 20]:
            label = f"{'▶' if sn == selected else ''}{sn}"
            if st.button(label, key=f"s1_btn_{sn}", use_container_width=True):
                st.session_state["s1_selected_slide"] = sn
                st.rerun()

    # ── Large preview for selected slide ────────────────────────────────
    sel_pg = next((p for p in pages_meta if p["page_num"] == selected), pages_meta[0])
    idx = sel_pg["pdf_page_num"] - 1
    if idx < len(doc):
        pix = doc[idx].get_pixmap(matrix=mat_prev)
        st.image(pix.tobytes("png"), caption=f"Slide {selected}", use_container_width=False,
                 width=600)

    doc.close()


def render_step1(ppt_file, has_ppt):
    with st.expander("Step 1 — PPT parsing", expanded=has_ppt):
        ppt_cache  = _ppt_path()
        slides_dir = _slides_dir()
        if ppt_cache.exists():
            pages_meta = _load_json(ppt_cache)
            st.success(f"✅ Cached — {len(pages_meta)} slides")

            pdf_path = slides_dir / "slides.pdf"
            if pdf_path.exists():
                _render_slide_strip(pages_meta, pdf_path)
            else:
                st.caption("slides.pdf not found — cannot render thumbnails.")

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
                import os
                os.unlink(tmp_path)
                _save_json(ppt_cache, pages_meta)
                prog.progress(100, text="Done")
                elapsed = time.time() - t0
                _log_run("ppt_parse", elapsed, extra={"n_pages": len(pages_meta)})
                st.success(f"✅ {_badge(elapsed)} — {len(pages_meta)} slides")
                st.rerun()
        else:
            st.info("No PPT uploaded — no-PPT mode. Step 1 skipped.")
