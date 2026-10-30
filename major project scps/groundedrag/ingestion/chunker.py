"""Chunking helpers.

Splitting happens on paragraph boundaries where possible so a chunk rarely
cuts a sentence in half -- mid-sentence cuts noticeably hurt retrieval.
"""

from config import CHUNK_SIZE, CHUNK_OVERLAP


def split_text(text: str, size: int = CHUNK_SIZE,
               overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks, preferring paragraph breaks."""
    text = text.strip()
    if len(text) <= size:
        return [text] if text else []

    chunks, start = [], 0
    while start < len(text):
        end = start + size

        if end < len(text):
            # Prefer a paragraph break, then a sentence break, near the end.
            window = text[start:end]
            cut = window.rfind("\n\n")
            if cut < size * 0.5:
                cut = max(window.rfind(". "), window.rfind(".\n"))
            if cut > size * 0.5:
                end = start + cut + 1

        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)

        start = max(end - overlap, end) if end <= start else end - overlap

    return chunks


def split_code(text: str, max_lines: int = 60) -> list[tuple[str, int, int]]:
    """Split source code into blocks, returning (text, start_line, end_line).

    Splits on top-level definitions so functions stay intact; falls back to
    fixed line windows for files with no detectable definitions.
    """
    lines = text.split("\n")
    boundaries = [
        i for i, ln in enumerate(lines)
        if ln and not ln[0].isspace()
        and any(ln.lstrip().startswith(k) for k in
                ("def ", "class ", "function ", "public ", "private ",
                 "const ", "export ", "func ", "fn "))
    ]

    if not boundaries:
        boundaries = list(range(0, len(lines), max_lines))
    if boundaries and boundaries[0] != 0:
        boundaries.insert(0, 0)

    blocks = []
    for idx, start in enumerate(boundaries):
        end = boundaries[idx + 1] if idx + 1 < len(boundaries) else len(lines)
        body = "\n".join(lines[start:end]).strip()
        if body:
            # +1 so line numbers are 1-indexed, matching what editors show.
            blocks.append((body, start + 1, end))
    return blocks
