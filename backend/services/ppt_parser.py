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

import re

import fitz  # PyMuPDF

# Bullet-start patterns: lines beginning with these are standalone bullets
_BULLET_START = re.compile(
    r"^(\s*[•\-\*\u2022\u2023\u25E6\u2043]\s+"    # bullet chars: •, -, *, etc.
    r"|^\s*\d+[\.\)]\s+"                             # numbered: "1. " or "1) "
    r"|^\s*[A-Z][a-z].*[:\.]$"                       # Title-like: starts uppercase, ends : or .
    r")"
)


def _clean_ppt_text(raw_text: str) -> str:
    """
    Post-process PyMuPDF extracted text:
    1. Remove page-number lines (pure digits)
    2. Remove very short standalone lines (<=2 chars)
    3. Remove footer-like lines (1-2 words, no punctuation, e.g. "Xiao Lei")
    4. Merge continuation lines (wrapped bullets) back together
    """
    lines = raw_text.splitlines()
    cleaned: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Skip pure-digit lines (page numbers like "63")
        if stripped.replace(".", "").isdigit():
            continue
        # Skip very short lines (<=2 chars, likely artifacts)
        if len(stripped) <= 2:
            continue
        # Skip footer-like lines: 1-2 words, no sentence-ending punctuation
        words = stripped.split()
        if (len(words) <= 2
                and not any(c in stripped for c in ".,:;!?()[]{}–—")):
            continue
        cleaned.append(stripped)

    # Merge continuation lines: if a line doesn't look like a new bullet
    # and the previous line doesn't end with sentence-ending punctuation,
    # join it to the previous line.
    merged: list[str] = []
    for line in cleaned:
        is_new_bullet = bool(re.match(
            r"^[•\-\*\u2022\u2023\u25E6\u2043]\s+|^\d+[\.\)]\s+",
            line
        ))
        # Also treat lines starting with an uppercase word followed by more text as new items
        is_title_like = bool(re.match(r"^[A-Z][A-Za-z]+(\s+[A-Z]|\s*:|\s*$)", line))

        if (merged
                and not is_new_bullet
                and not is_title_like
                and not merged[-1].rstrip().endswith((".", ":", ";", "!", "?"))):
            # Continuation of previous line
            merged[-1] = merged[-1].rstrip() + " " + line
        else:
            merged.append(line)

    return "\n".join(merged)


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


def extract_domain_terms(pages: list[dict], max_terms: int = 50) -> str:
    """
    Extract domain-specific terms from parsed PPT pages for Whisper prompt injection.

    Strategy: collect all words that are likely domain terms —
      - CamelCase words (e.g. BackPropagation, ResNet)
      - ALL_CAPS abbreviations (e.g. CNN, LSTM, API)
      - Words appearing in title-like positions (first word of a bullet)
      - Deduplicated, limited to max_terms

    Returns a comma-separated string suitable for Whisper's `prompt` parameter.
    """
    import re as _re

    camel_or_upper = _re.compile(r"\b([A-Z][a-z]+[A-Z]\w*|[A-Z]{2,}\w*)\b")
    seen: dict[str, int] = {}  # term -> frequency

    for page in pages:
        text = page.get("ppt_text", "") or ""
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            # CamelCase / ALLCAPS terms anywhere on the line
            for match in camel_or_upper.finditer(line):
                term = match.group(1)
                seen[term] = seen.get(term, 0) + 1
            # First "word" of each bullet (often a key concept)
            first_word_match = _re.match(r"^[•\-\*\d\.\)]*\s*([A-Za-z][A-Za-z\-]{2,})", line)
            if first_word_match:
                term = first_word_match.group(1)
                if term[0].isupper():
                    seen[term] = seen.get(term, 0) + 1

    # Sort by frequency descending, take top max_terms
    top_terms = sorted(seen, key=lambda t: seen[t], reverse=True)[:max_terms]
    return ", ".join(top_terms)


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
            ppt_text = _clean_ppt_text(page.get_text("text"))

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
