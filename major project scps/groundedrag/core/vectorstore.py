"""Embedding + ChromaDB storage.

Each ingested source gets its own collection. Keeping sources isolated is
what lets the system claim answers come from *that* source and nothing else.
"""

import uuid
import functools

import chromadb
from sentence_transformers import SentenceTransformer

from config import Chunk, EMBED_MODEL, CHROMA_DIR, TOP_K


@functools.lru_cache(maxsize=1)
def get_embedder() -> SentenceTransformer:
    """Load the embedding model once and reuse it (it is slow to load)."""
    return SentenceTransformer(EMBED_MODEL)


@functools.lru_cache(maxsize=1)
def get_client():
    return chromadb.PersistentClient(path=CHROMA_DIR)


def _flatten(meta: dict) -> dict:
    """Chroma only accepts scalar metadata values; drop or stringify others."""
    out = {}
    for k, v in meta.items():
        if v is None:
            continue
        out[k] = v if isinstance(v, (str, int, float, bool)) else str(v)
    return out


def index_source(chunks: list[Chunk], label: str) -> str:
    """Embed chunks and store them in a fresh collection.

    Returns the collection id, which the UI keeps in session state so
    follow-up questions query the same source.
    """
    if not chunks:
        raise ValueError("No content was extracted from this source.")

    collection_id = f"src_{uuid.uuid4().hex[:10]}"
    collection = get_client().create_collection(
        name=collection_id,
        metadata={"label": label, "hnsw:space": "cosine"},
    )

    texts = [c.text for c in chunks]
    embeddings = get_embedder().encode(
        texts, batch_size=32, show_progress_bar=False
    ).tolist()

    collection.add(
        ids=[f"c{i}" for i in range(len(chunks))],
        documents=texts,
        embeddings=embeddings,
        metadatas=[_flatten(c.meta) for c in chunks],
    )
    return collection_id


def retrieve(question: str, collection_id: str, k: int = TOP_K) -> list[Chunk]:
    """Return the k chunks most similar to the question, metadata intact."""
    collection = get_client().get_collection(collection_id)
    q_emb = get_embedder().encode([question]).tolist()

    res = collection.query(
        query_embeddings=q_emb,
        n_results=min(k, collection.count()),
        include=["documents", "metadatas", "distances"],
    )

    chunks = []
    for doc, meta, dist in zip(
        res["documents"][0], res["metadatas"][0], res["distances"][0]
    ):
        meta = dict(meta)
        meta["score"] = round(1 - dist, 3)  # cosine distance -> similarity
        chunks.append(Chunk(text=doc, meta=meta))
    return chunks
