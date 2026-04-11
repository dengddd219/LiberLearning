"""
Sandbox test: verify parse_ppt now produces pdf_url + pdf_page_num
instead of slide_image_url + PNG files.

Run:
    cd backend && ../.venv/Scripts/python test_ppt_parser_pdf.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import fitz  # PyMuPDF


def _make_test_pdf(path: str, n_pages: int = 3):
    """Create a minimal multi-page PDF with text on each page."""
    doc = fitz.open()
    for i in range(n_pages):
        page = doc.new_page()
        page.insert_text((72, 100), f"Slide {i + 1}: Test Content ABC\nBullet point one\nBullet point two")
    doc.save(path)
    doc.close()


def run_tests():
    errors = []

    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = str(Path(tmp) / "test_slides.pdf")
        slides_dir = str(Path(tmp) / "slides_out")
        _make_test_pdf(pdf_path, n_pages=3)

        from services.ppt_parser import parse_ppt
        pages = parse_ppt(pdf_path, slides_dir, pdf_name="slides.pdf")

        # 1. Returns correct number of pages
        if len(pages) != 3:
            errors.append(f"[FAIL] expected 3 pages, got {len(pages)}")
        else:
            print("[PASS] page count = 3")

        # 2. Each page has pdf_url and pdf_page_num
        for pg in pages:
            if "pdf_url" not in pg:
                errors.append(f"[FAIL] page {pg.get('page_num')} missing pdf_url")
            if "pdf_page_num" not in pg:
                errors.append(f"[FAIL] page {pg.get('page_num')} missing pdf_page_num")
            if "slide_image_url" in pg:
                errors.append(f"[FAIL] page {pg.get('page_num')} still has old slide_image_url key")
        if not errors:
            print("[PASS] all pages have pdf_url and pdf_page_num, no slide_image_url")

        # 3. pdf_url points to the correct filename
        for pg in pages:
            if pg.get("pdf_url") != "/slides/slides.pdf":
                errors.append(f"[FAIL] page {pg['page_num']} pdf_url={pg.get('pdf_url')!r}, expected '/slides/slides.pdf'")
                break
        else:
            print("[PASS] pdf_url = /slides/slides.pdf")

        # 4. pdf_page_num matches page_num (1-based)
        for pg in pages:
            if pg["pdf_page_num"] != pg["page_num"]:
                errors.append(f"[FAIL] pdf_page_num {pg['pdf_page_num']} != page_num {pg['page_num']}")
                break
        else:
            print("[PASS] pdf_page_num matches page_num")

        # 5. PDF file actually copied to slides_out/slides.pdf
        dest_pdf = Path(slides_dir) / "slides.pdf"
        if not dest_pdf.exists():
            errors.append(f"[FAIL] slides.pdf not found at {dest_pdf}")
        else:
            print(f"[PASS] slides.pdf copied to slides_out/")

        # 6. NO PNG files produced
        pngs = list(Path(slides_dir).glob("*.png"))
        if pngs:
            errors.append(f"[FAIL] PNG files found (should be none): {pngs}")
        else:
            print("[PASS] no PNG files produced")

        # 7. ppt_text extracted (non-empty for pages with text)
        for pg in pages:
            if not pg.get("ppt_text"):
                errors.append(f"[FAIL] page {pg['page_num']} ppt_text is empty")
                break
        else:
            print("[PASS] ppt_text extracted on all pages")

    print()
    if errors:
        print("=== FAILURES ===")
        for e in errors:
            print(e)
        sys.exit(1)
    else:
        print("All tests passed.")


if __name__ == "__main__":
    run_tests()
