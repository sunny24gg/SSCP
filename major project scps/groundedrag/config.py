"""Central configuration and shared data structures."""

import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()

# --- Models -----------------------------------------------------------------
EMBED_MODEL = "all-MiniLM-L6-v2"      # local, free, 384-dim
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-3.5-flash-lite")         # free tier via Google AI Studio
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# --- Retrieval --------------------------------------------------------------
CHUNK_SIZE = 1200          # characters (~300 tokens)
CHUNK_OVERLAP = 200
TOP_K = 5

# --- Storage ----------------------------------------------------------------
CHROMA_DIR = "./chroma_store"

# Files skipped when ingesting a GitHub repository
SKIP_DIRS = {".git", "node_modules", "__pycache__", "venv", ".venv", "env", "dist", "build", "target", ".next", ".nuxt", "coverage"}
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
    ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".kt", ".scala", ".r", ".lua",
    ".md", ".rst", ".txt", ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".json", ".xml", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".sh", ".bash", ".sql"
}


@dataclass
class Chunk:
    """A single retrievable unit of source content.

    `meta` carries everything needed to build a human-readable citation
    later, so it must be populated at ingestion time.
    """
    text: str
    meta: dict = field(default_factory=dict)

    def citation(self) -> str:
        """Render this chunk's origin as a human-readable citation string."""
        m = self.meta
        kind = m.get("source_type")
        if kind == "pdf":
            page = m.get("page")
            section = m.get("section")
            base = f"Page {page}"
            return f"{base}, {section}" if section else base
        if kind == "github":
            return f"{m.get('file_path')}:{m.get('start_line')}-{m.get('end_line')}"
        if kind == "web":
            section = m.get("section")
            url = m.get("url", "")
            return f"{url} — {section}" if section else url
        return "Unknown source"
