"""PDF ingestion: extract text page-by-page, keeping page numbers intact.

Page numbers are captured here because they cannot be reconstructed after
chunking -- this is what makes the citation feature possible.
"""

import re
import pymupdf as fitz

from config import Chunk
from ingestion.chunker import split_text


def _clean(text: str) -> str:
    """Remove hyphenation across line breaks and collapse whitespace."""
    text = re.sub(r"-\n(\w)", r"\1", text)      # re-join hyphenated words
    text = re.sub(r"\n{2,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _detect_section(page) -> str | None:
    """Best-effort heading detection: the largest-font line on the page.

    Falls back to None when the page has no clear heading, which is common
    for body-text-only pages.
    """
    try:
        blocks = page.get_text("dict")["blocks"]
    except Exception:
        return None

    best_text, best_size = None, 0.0
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                size = span.get("size", 0)
                txt = span.get("text", "").strip()
                if size > best_size and 3 < len(txt) < 90:
                    best_size, best_text = size, txt
    return best_text


def load_pdf(path: str) -> list[Chunk]:
    """Parse a PDF into chunks carrying page number + section metadata."""
    doc = fitz.open(path)
    chunks: list[Chunk] = []

    for page_no, page in enumerate(doc, start=1):
        raw = _clean(page.get_text())
        if not raw:
            continue  # image-only page; OCR would go here

        section = _detect_section(page)
        for piece in split_text(raw):
            chunks.append(
                Chunk(
                    text=piece,
                    meta={
                        "source_type": "pdf",
                        "page": page_no,
                        "section": section,
                        "file_name": path.split("/")[-1],
                    },
                )
            )

    doc.close()
    return chunks
