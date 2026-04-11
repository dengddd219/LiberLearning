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


def render_step1(ppt_file, has_ppt):
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
