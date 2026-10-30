"""Evaluation harness.

Produces the numbers that back the project's central claim. Run after
ingesting a source:

    python evaluate.py --pdf sample.pdf --tests tests.json

tests.json format:
[
  {"question": "...", "expected_page": 4, "answerable": true},
  {"question": "...", "answerable": false}
]

Metrics reported:
  Retrieval accuracy   -- was the expected page inside the top-k chunks?
  Citation rate        -- share of answerable questions that produced a citation
  Citation validity    -- share of citations pointing at the expected page
  Refusal accuracy     -- did it correctly refuse unanswerable questions?
"""

import argparse
import json

from config import TOP_K
from ingestion.pdf_loader import load_pdf
from core.vectorstore import index_source, retrieve
from core import generator


def run(pdf_path: str, tests_path: str, k: int = TOP_K):
    with open(tests_path, encoding="utf-8") as fh:
        tests = json.load(fh)

    print(f"Indexing {pdf_path} ...")
    collection_id = index_source(load_pdf(pdf_path), pdf_path)

    answerable = [t for t in tests if t.get("answerable", True)]
    unanswerable = [t for t in tests if not t.get("answerable", True)]

    retrieval_hits = 0
    cited = 0
    citation_valid = 0
    correct_refusals = 0
    false_refusals = 0
    rows = []

    for t in tests:
        chunks = retrieve(t["question"], collection_id, k=k)
        pages = [c.meta.get("page") for c in chunks]
        result = generator.answer(t["question"], chunks)

        expected = t.get("expected_page")
        hit = expected in pages if expected is not None else None
        if hit:
            retrieval_hits += 1

        if t.get("answerable", True):
            if result["refused"]:
                false_refusals += 1
            if result["citations"]:
                cited += 1
                cited_pages = [c["reference"] for c in result["citations"]]
                if expected is not None and any(
                    str(expected) in ref for ref in cited_pages
                ):
                    citation_valid += 1
        else:
            if result["refused"]:
                correct_refusals += 1

        rows.append({
            "question": t["question"],
            "expected_page": expected,
            "retrieved_pages": pages,
            "retrieval_hit": hit,
            "refused": result["refused"],
            "citations": [c["reference"] for c in result["citations"]],
        })

    n_expected = sum(1 for t in tests if t.get("expected_page") is not None)
    print("\n=== Results ===")
    if n_expected:
        print(f"Retrieval accuracy@{k}: {retrieval_hits}/{n_expected} "
              f"({retrieval_hits / n_expected:.1%})")
    if answerable:
        print(f"Citation rate:         {cited}/{len(answerable)} "
              f"({cited / len(answerable):.1%})")
        print(f"Citation validity:     {citation_valid}/{max(cited, 1)} "
              f"({citation_valid / max(cited, 1):.1%})")
        print(f"False refusals:        {false_refusals}/{len(answerable)}")
    if unanswerable:
        print(f"Refusal accuracy:      {correct_refusals}/{len(unanswerable)} "
              f"({correct_refusals / len(unanswerable):.1%})")

    with open("eval_results.json", "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2, ensure_ascii=False)
    print("\nPer-question detail written to eval_results.json")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--tests", required=True)
    ap.add_argument("--k", type=int, default=TOP_K)
    run(**{"pdf_path": ap.parse_args().pdf,
           "tests_path": ap.parse_args().tests,
           "k": ap.parse_args().k})
