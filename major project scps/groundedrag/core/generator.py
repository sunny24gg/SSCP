"""Grounded answer generation.

Two layers enforce the project's central claim:
  1. A prompt that forbids outside knowledge and demands refusal when the
     retrieved context does not contain the answer.
  2. Inline [S1]-style tags that are mapped back to chunk metadata, so every
     citation shown to the user is traceable to a real retrieved chunk.
"""

import re
import functools

from google import genai

from config import Chunk, GEMINI_API_KEY, LLM_MODEL
from core.retry import with_retry

REFUSAL = "This isn't covered in the provided source."

SYSTEM_RULES = """You answer strictly from the CONTEXT below.

Rules:
1. Use ONLY the context below. Never use outside or prior knowledge.
2. If the user asks for a summary, explanation, key points, or overview, synthesize your answer directly from the facts present across the context blocks.
3. If the user asks about the files, folders, directory tree, or codebase content, provide a clear, comprehensive list of the filenames and folders from the context, including file descriptions or code functions if present.
4. After each sentence that uses the context, cite its source id in square
   brackets, e.g. [S1] or [S2][S3].
5. Never invent a source id that is not listed below.
6. Only reply with "This isn't covered in the provided source." if the context has absolutely no relevance or mention of the subject requested.
7. Be concise and factual."""


@functools.lru_cache(maxsize=1)
def _client() -> genai.Client:
    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to a .env file in the project root."
        )
    return genai.Client(api_key=GEMINI_API_KEY)


def build_prompt(question: str, chunks: list[Chunk],
                 history: list[dict] | None = None) -> str:
    """Assemble the grounded prompt with numbered, citable context blocks."""
    blocks = []
    for i, ch in enumerate(chunks, start=1):
        blocks.append(f"[S{i}] (from {ch.citation()})\n{ch.text}")
    context = "\n\n---\n\n".join(blocks)

    convo = ""
    if history:
        recent = history[-4:]  # keep the prompt small
        convo = "\n".join(
            f"{t['role'].upper()}: {t['content']}" for t in recent
        )
        convo = f"\nEARLIER CONVERSATION (for pronoun/reference resolution only):\n{convo}\n"

    return f"{SYSTEM_RULES}\n{convo}\nCONTEXT:\n{context}\n\nQUESTION: {question}\n\nANSWER:"


def condense_question(question: str, history: list[dict]) -> str:
    """Rewrite a follow-up into a standalone query before retrieval.

    Without this, a question like "what about section 3?" retrieves nothing
    useful, because the referenced topic is missing from the query itself.
    """
    if not history:
        return question

    recent = "\n".join(
        f"{t['role']}: {t['content']}" for t in history[-4:]
    )
    prompt = (
        "Rewrite the follow-up question as a standalone question using the "
        "conversation for context. Output only the rewritten question.\n\n"
        f"Conversation:\n{recent}\n\nFollow-up: {question}\n\nStandalone question:"
    )
    models_to_try = [LLM_MODEL, "gemini-3.5-flash-lite", "gemini-3.8-flash"]
    seen = set()
    unique_models = [m for m in models_to_try if not (m in seen or seen.add(m))]
    for m in unique_models:
        try:
            resp = with_retry(
                _client().models.generate_content, model=m, contents=prompt
            )
            return (resp.text or "").strip() or question
        except Exception:
            continue
    return question  # degrade gracefully rather than blocking the answer


def answer(question: str, chunks: list[Chunk],
           history: list[dict] | None = None) -> dict:
    """Generate a grounded answer and resolve its citations.

    Returns {answer, citations, refused} where `citations` lists only the
    sources the model actually cited.
    """
    if not chunks:
        return {"answer": REFUSAL, "citations": [], "refused": True}

    prompt = build_prompt(question, chunks, history)
    resp = None
    last_exc = None
    models_to_try = [LLM_MODEL, "gemini-3.5-flash-lite", "gemini-3.8-flash"]
    seen = set()
    unique_models = [m for m in models_to_try if not (m in seen or seen.add(m))]
    for m in unique_models:
        try:
            resp = with_retry(
                _client().models.generate_content, model=m, contents=prompt
            )
            if resp:
                break
        except Exception as exc:
            last_exc = exc
            continue

    if resp is None:
        busy = any(m in str(last_exc) for m in ("503", "UNAVAILABLE", "429"))
        message = (
            "The AI model is currently overloaded. Please try again in a moment."
            if busy else f"The model call failed: {last_exc}"
        )
        return {"answer": message, "citations": [], "refused": False, "error": True}
    text = (resp.text or "").strip()

    used_ids = sorted({int(n) for n in re.findall(r"\[S(\d+)\]", text)})
    citations = [
        {
            "id": f"S{i}",
            "reference": chunks[i - 1].citation(),
            "snippet": chunks[i - 1].text[:300],
            "score": chunks[i - 1].meta.get("score"),
            "source_type": chunks[i - 1].meta.get("source_type"),
        }
        for i in used_ids
        if 1 <= i <= len(chunks)  # guard against hallucinated ids
    ]

    return {
        "answer": text,
        "citations": citations,
        "refused": REFUSAL.lower() in text.lower(),
        "error": False,
    }
