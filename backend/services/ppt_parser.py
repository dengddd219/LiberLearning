"""
PPT parsing service.
Converts .ppt/.pptx → PDF via LibreOffice headless,
then uses PyMuPDF to extract text and render PNG images per page.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF


def _libreoffice_path() -> str:
    """Find LibreOffice executable (soffice) on Windows or Linux."""
    candidates = [
        "soffice",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
    ]
    for c in candidates:
        if shutil.which(c) or Path(c).exists():
            return c
    raise RuntimeError(
        "LibreOffice (soffice) not found. "
        "Run install_deps.bat and restart your terminal."
    )


def pptx_to_pdf(input_path: str, output_dir: str) -> str:
    """
    Convert a .ppt/.pptx file to PDF using LibreOffice headless.
    Returns the path to the generated PDF file.
    """
    soffice = _libreoffice_path()
    result = subprocess.run(
        [
            soffice,
            "--headless",
            "--convert-to", "pdf",
            "--outdir", output_dir,
            input_path,
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"LibreOffice conversion failed:\n{result.stderr}"
        )

    # LibreOffice names the output file after the input stem
    stem = Path(input_path).stem
    pdf_path = str(Path(output_dir) / f"{stem}.pdf")
    if not Path(pdf_path).exists():
        raise RuntimeError(
            f"Expected PDF not found at {pdf_path}. "
            f"LibreOffice stdout: {result.stdout}"
        )
    return pdf_path


def parse_ppt(
    ppt_path: str,
    slides_output_dir: str,
    dpi: int = 150,
    png_prefix: str = "slide",
) -> list[dict]:
    """
    Full PPT parsing pipeline:
      1. Convert PPT/PPTX to PDF via LibreOffice
      2. For each PDF page: extract text + render PNG

    Returns a list of dicts:
      {
        "page_num": int,          # 1-based
        "ppt_text": str,          # extracted text
        "slide_image_url": str,   # relative URL, e.g. /slides/slide_001.png
      }
    """
    os.makedirs(slides_output_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        # Step 1: PPT → PDF
        suffix = Path(ppt_path).suffix.lower()
        if suffix == ".pdf":
            pdf_path = ppt_path
        else:
            pdf_path = pptx_to_pdf(ppt_path, tmp_dir)

        # Step 2: per-page extraction
        doc = fitz.open(pdf_path)
        pages = []
        mat = fitz.Matrix(dpi / 72, dpi / 72)

        for i, page in enumerate(doc):
            page_num = i + 1

            # Text extraction
            ppt_text = page.get_text("text").strip()

            # PNG rendering
            filename = f"{png_prefix}_{page_num:03d}.png"
            png_path = Path(slides_output_dir) / filename
            pix = page.get_pixmap(matrix=mat)
            pix.save(str(png_path))

            pages.append(
                {
                    "page_num": page_num,
                    "ppt_text": ppt_text,
                    "slide_image_url": f"/slides/{filename}",
                }
            )

        doc.close()

    return pages
