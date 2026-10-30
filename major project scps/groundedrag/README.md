# GroundedRAG

Source-grounded question answering and mind map generation from PDFs, GitHub
repositories, and websites.

Answers come only from the source you provide. Every answer carries a citation
pointing at the exact page, file and line range, or webpage section it came
from, and the system refuses rather than guessing when the source does not
cover a question.

## Setup

```bash
pip install -r requirements.txt
sudo apt install graphviz          # needed for mind map rendering
cp .env.example .env               # then paste your Gemini API key into .env
streamlit run app.py
```

Get a free Gemini API key at https://aistudio.google.com/apikey

## Project structure

```
config.py               Settings + the shared Chunk type (citation logic lives here)
ingestion/
  pdf_loader.py         PyMuPDF parsing, keeps page numbers + headings
  github_loader.py      Shallow clone, chunks code by function, keeps line ranges
  web_loader.py         Fetch + strip boilerplate, chunks by heading section
  chunker.py            Paragraph-aware text splitting, definition-aware code splitting
core/
  vectorstore.py        Sentence-Transformers embeddings + ChromaDB (one collection per source)
  generator.py          Grounded prompt, refusal handling, citation resolution
  mindmap.py            LLM outline extraction (JSON) + Graphviz rendering
app.py                  Streamlit UI: ingestion, chat with history, mind map tab
evaluate.py             Metrics harness for the report
```

## Design notes

**One collection per source.** Sources are never mixed in the vector store, so
a question can only ever retrieve from the source the user supplied.

**Metadata is attached at ingestion.** Page numbers and line ranges cannot be
recovered after chunking, so they are recorded before embedding. This is what
makes the citation feature possible.

**Mind maps are structure-first.** The LLM returns JSON, and Graphviz renders
it. Nothing is generated as a picture, so PNG, PDF, and JSON exports all come
from the same object and the map stays traceable to retrieved content.

**Follow-ups are condensed before retrieval.** A question like "what about
section 3?" is rewritten into a standalone query first, otherwise retrieval has
nothing useful to match against.

## Evaluation

```bash
python evaluate.py --pdf sample.pdf --tests tests.json
```

Reports retrieval accuracy@k, citation rate, citation validity, false refusals,
and refusal accuracy; per-question detail is written to `eval_results.json`.
See `tests.example.json` for the test-set format. Include unanswerable
questions — correct refusals are the strongest evidence of grounding.
