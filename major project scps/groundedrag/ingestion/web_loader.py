"""Website ingestion: fetch a public page and chunk it by heading section."""

import requests
from bs4 import BeautifulSoup

from config import Chunk
from ingestion.chunker import split_text

HEADERS = {"User-Agent": "GroundedRAG/1.0 (academic project)"}
STRIP_TAGS = ["script", "style", "nav", "footer", "header", "aside", "form"]


def load_website(url: str, timeout: int = 20) -> list[Chunk]:
    """Extract readable text from a public URL, grouped under its headings.

    Raises RuntimeError on fetch failure so the UI can show a clear message
    (paywalls and JS-only pages are the common causes).
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(f"Could not fetch the page: {exc}") from exc

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(STRIP_TAGS):
        tag.decompose()

    body = soup.body or soup
    chunks: list[Chunk] = []
    current_section = soup.title.get_text(strip=True) if soup.title else "Introduction"
    buffer: list[str] = []

    def flush():
        """Emit the buffered paragraphs under the current heading."""
        if not buffer:
            return
        text = "\n\n".join(buffer)
        for piece in split_text(text):
            chunks.append(
                Chunk(
                    text=piece,
                    meta={
                        "source_type": "web",
                        "url": url,
                        "section": current_section,
                    },
                )
            )
        buffer.clear()

    for el in body.find_all(["h1", "h2", "h3", "p", "li", "pre"]):
        text = el.get_text(" ", strip=True)
        if not text:
            continue
        if el.name in ("h1", "h2", "h3"):
            flush()
            current_section = text
        elif len(text) > 40:  # drop nav-like scraps
            buffer.append(text)

    flush()

    if not chunks:
        raise RuntimeError(
            "No readable text found. The page may be JavaScript-rendered "
            "or behind a login/paywall."
        )
    return chunks
