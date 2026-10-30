"""Mind map generation.

The LLM produces *structure* (JSON), not a picture. Rendering happens
deterministically with Graphviz, which means PNG/PDF/JSON export all fall
out of the same object and the map stays traceable to retrieved content.
"""

import json
import re

from google import genai
from graphviz import Digraph

from config import Chunk, GEMINI_API_KEY, LLM_MODEL
from core.retry import with_retry

OUTLINE_PROMPT = """From the CONTENT below, build a revision mind map.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{"topic": "central topic",
 "branches": [
   {"name": "main branch", "children": ["sub point", "sub point"]}
 ]}

Rules:
- Use only information present in the content.
- 3 to 6 branches, each with 2 to 5 short children.
- Keep every label under 8 words.

CONTENT:
"""

PALETTE = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"]


def extract_outline(chunks: list[Chunk]) -> dict:
    """Ask the LLM for a hierarchical outline of the retrieved content."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    if not chunks:
        raise ValueError("No content available to build a mind map from.")

    client = genai.Client(api_key=GEMINI_API_KEY)
    content = "\n\n".join(c.text for c in chunks)[:12000]

    try:
        resp = with_retry(
            client.models.generate_content,
            model=LLM_MODEL, contents=OUTLINE_PROMPT + content,
        )
    except Exception as exc:
        busy = any(m in str(exc) for m in ("503", "UNAVAILABLE", "429"))
        if busy:
            raise RuntimeError(
                "The AI model is currently overloaded. Please try again in a moment."
            ) from exc
        raise RuntimeError(f"The model call failed: {exc}") from exc
    raw = (resp.text or "").strip()

    # Models often wrap JSON in fences despite instructions -- strip them.
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()

    try:
        outline = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise ValueError("The model did not return usable JSON.")
        outline = json.loads(match.group(0))

    if "topic" not in outline or "branches" not in outline:
        raise ValueError("Outline JSON is missing required keys.")
    return outline


def render(outline: dict, out_path: str = "mindmap", fmt: str = "png") -> str:
    """Render an outline dict to an image file. Returns the written path."""
    g = Digraph("mindmap", format=fmt)
    g.attr(rankdir="LR", bgcolor="white", splines="curved")
    g.attr("node", fontname="Helvetica", style="filled", shape="box")

    g.node("root", outline["topic"], shape="ellipse",
           fillcolor="#1e293b", fontcolor="white", fontsize="16")

    for b_idx, branch in enumerate(outline["branches"]):
        color = PALETTE[b_idx % len(PALETTE)]
        b_id = f"b{b_idx}"
        g.node(b_id, branch.get("name", ""), fillcolor=color,
               fontcolor="white", fontsize="13")
        g.edge("root", b_id, color=color, penwidth="2")

        for c_idx, child in enumerate(branch.get("children", [])):
            c_id = f"{b_id}_{c_idx}"
            g.node(c_id, str(child), fillcolor="#f1f5f9",
                   fontcolor="#0f172a", fontsize="11")
            g.edge(b_id, c_id, color=color)

    return g.render(filename=out_path, cleanup=True)


def export_json(outline: dict, out_path: str = "mindmap.json") -> str:
    """Write the outline as JSON so other mind-map tools can import it."""
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(outline, f, indent=2, ensure_ascii=False)
    return out_path
