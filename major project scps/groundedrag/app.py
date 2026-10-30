"""GroundedRAG -- Streamlit interface.

Run with:  streamlit run app.py
"""

import os
import html
import tempfile
from pathlib import Path

import streamlit as st

from config import TOP_K
from ingestion.pdf_loader import load_pdf
from ingestion.github_loader import load_github
from ingestion.web_loader import load_website
from core.vectorstore import index_source, retrieve
from core import generator, mindmap

st.set_page_config(page_title="GroundedRAG", page_icon="🔎", layout="wide")

for key, default in [
    ("collection_id", None), ("label", None), ("kind", None),
    ("history", []), ("last_chunks", []),
]:
    st.session_state.setdefault(key, default)


# --- Design system -----------------------------------------------------------
# Ink navy carries structure and controls; paper carries content the person
# reads; gold is reserved for the one thing this tool exists to make visible
# -- a citation that proves an answer traces back to the source.
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

:root {
  --ink: #16213E;
  --ink-soft: #2A3A63;
  --paper: #F6F5F1;
  --paper-line: #DEDBD1;
  --gold: #C9922B;
  --gold-soft: #F1E3C8;
  --teal: #2F6F62;
  --muted: #6B7280;
}

html, body, [class*="css"] { font-family: 'IBM Plex Sans', sans-serif; }
.stApp { background: var(--paper); }
h1, h2, h3 { font-family: 'Source Serif 4', serif; color: var(--ink); }

/* Sidebar: the cover of the notebook */
[data-testid="stSidebar"] {
  background: var(--ink);
  border-right: 1px solid var(--ink-soft);
}
[data-testid="stSidebar"] * { color: #EDEEF2; }
[data-testid="stSidebar"] .stRadio label { color: #EDEEF2 !important; }
[data-testid="stSidebar"] [data-testid="stFileUploaderDropzone"] {
  background: var(--ink-soft); border: 1px dashed #4A5A85; border-radius: 6px;
}
[data-testid="stSidebar"] input {
  background: var(--ink-soft) !important; color: #fff !important;
  border: 1px solid #4A5A85 !important; border-radius: 6px !important;
}
.sidebar-mark {
  display: flex; align-items: center; gap: 10px; margin-bottom: 4px;
}
.sidebar-mark .badge {
  width: 34px; height: 34px; border-radius: 6px; background: var(--gold);
  color: var(--ink); font-family: 'Source Serif 4', serif; font-weight: 700;
  font-size: 15px; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.sidebar-mark .name {
  font-family: 'Source Serif 4', serif; font-size: 21px; color: #fff; line-height: 1.1;
}
.sidebar-tagline {
  font-size: 12.5px; color: #A9B2C9; margin: 2px 0 18px 44px; line-height: 1.5;
}
.sidebar-rule { border: none; border-top: 1px solid var(--ink-soft); margin: 18px 0; }
.active-source {
  background: var(--ink-soft); border-radius: 6px; padding: 10px 12px;
  border-left: 3px solid var(--gold);
}
.active-source .kind {
  display: inline-block; font-size: 10.5px; font-weight: 600; color: var(--ink);
  background: var(--gold); border-radius: 3px; padding: 1px 6px; margin-bottom: 6px;
}
.active-source .name { font-size: 13.5px; color: #fff; word-break: break-word; }

/* Buttons */
.stButton > button {
  border-radius: 6px; font-weight: 500; border: 1px solid var(--paper-line);
}
.stButton > button[kind="primary"] {
  background: var(--gold); color: var(--ink); border: none;
}
.stButton > button[kind="primary"]:hover { background: #B98420; color: var(--ink); }
[data-testid="stSidebar"] .stButton > button:not([kind="primary"]) {
  background: transparent; color: #C9CEDC; border: 1px solid var(--ink-soft);
}

/* Source strip above the chat */
.source-strip {
  display: flex; align-items: center; gap: 10px; padding: 8px 14px;
  background: #fff; border: 1px solid var(--paper-line); border-radius: 6px;
  margin-bottom: 18px; font-size: 13px; color: var(--muted);
}
.source-strip b { color: var(--ink); font-weight: 600; }
.source-strip .pill {
  font-size: 10.5px; font-weight: 600; color: var(--ink); background: var(--gold-soft);
  border: 1px solid var(--gold); border-radius: 3px; padding: 1px 7px;
}

/* Tabs read like section headings, not app chrome */
[data-testid="stTabs"] button [data-testid="stMarkdownContainer"] p {
  font-family: 'Source Serif 4', serif; font-size: 16px;
}
[data-testid="stTabs"] [aria-selected="true"] { border-bottom-color: var(--gold) !important; }

/* Chat messages: assistant answers read like a printed page */
[data-testid="stChatMessage"] {
  background: #fff; border: 1px solid var(--paper-line); border-radius: 8px;
  padding: 4px 6px; margin-bottom: 10px;
}
[data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarUser"]) {
  background: var(--ink); border-color: var(--ink);
}
[data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarUser"]) p {
  color: #fff; font-family: 'IBM Plex Sans', sans-serif;
}
[data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarAssistant"]) p {
  font-family: 'Source Serif 4', serif; font-size: 16px; line-height: 1.65; color: #1C1C1E;
}

/* Citations: the proof, styled as verification tags */
.cite-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
.cite-tag {
  font-family: 'IBM Plex Sans', sans-serif; font-size: 11.5px; font-weight: 600;
  color: var(--ink); background: var(--gold-soft); border: 1px solid var(--gold);
  border-radius: 4px; padding: 2px 7px;
}
[data-testid="stExpander"] {
  border: 1px solid var(--paper-line) !important; border-radius: 6px !important;
  border-left: 3px solid var(--gold) !important; background: #fff;
}
.cite-snippet {
  font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; color: #4B4F58;
  line-height: 1.55; margin: 0; white-space: pre-wrap; word-break: break-word;
}

.empty-state {
  text-align: center; padding: 70px 20px; color: var(--muted);
}
.empty-state .title { font-family: 'Source Serif 4', serif; font-size: 22px; color: var(--ink); margin-bottom: 8px; }
</style>
""", unsafe_allow_html=True)


# --- Sidebar: source ingestion ---------------------------------------------
with st.sidebar:
    st.markdown("""
        <div class="sidebar-mark"><div class="badge">GR</div><div class="name">GroundedRAG</div></div>
        <div class="sidebar-tagline">Answers traced to the exact page, file, or section they came from.</div>
    """, unsafe_allow_html=True)

    kind = st.radio("Source type", ["PDF", "GitHub repo", "Website"], label_visibility="collapsed")
    chunks, label = None, None

    if kind == "PDF":
        upload = st.file_uploader("Upload a PDF", type=["pdf"])
        if upload and st.button("Ingest source", type="primary", use_container_width=True):
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(upload.read())
                tmp_path = tmp.name
            with st.spinner("Parsing PDF..."):
                chunks, label = load_pdf(tmp_path), upload.name
            os.unlink(tmp_path)

    elif kind == "GitHub repo":
        url = st.text_input("Public repo URL", placeholder="https://github.com/user/repo")
        if url and st.button("Ingest source", type="primary", use_container_width=True):
            with st.spinner("Cloning and parsing repository..."):
                chunks, label = load_github(url), url.rstrip("/").split("/")[-1]

    else:
        url = st.text_input("Public page URL", placeholder="https://example.com/article")
        if url and st.button("Ingest source", type="primary", use_container_width=True):
            with st.spinner("Fetching page..."):
                try:
                    chunks, label = load_website(url), url
                except RuntimeError as exc:
                    st.error(str(exc))

    if chunks:
        with st.spinner(f"Embedding {len(chunks)} chunks..."):
            st.session_state.collection_id = index_source(chunks, label)
        st.session_state.label = label
        st.session_state.kind = kind
        st.session_state.history = []
        st.success(f"Indexed {len(chunks)} chunks")

    if st.session_state.collection_id:
        st.markdown("<hr class='sidebar-rule'/>", unsafe_allow_html=True)
        st.markdown(f"""
            <div class="active-source">
              <div class="kind">{st.session_state.kind}</div>
              <div class="name">{st.session_state.label}</div>
            </div>
        """, unsafe_allow_html=True)
        st.write("")
        if st.button("Clear source", use_container_width=True):
            for k in ("collection_id", "label", "kind", "history", "last_chunks"):
                st.session_state[k] = [] if k in ("history", "last_chunks") else None
            st.rerun()


# --- Main panel -------------------------------------------------------------
if not st.session_state.collection_id:
    st.markdown("""
        <div class="empty-state">
          <div class="title">Add a source to begin</div>
          <div>Upload a PDF, or paste a GitHub repository or website URL in the sidebar.<br/>
          Every answer you get back will point to exactly where it came from.</div>
        </div>
    """, unsafe_allow_html=True)
    st.stop()

st.markdown(f"""
    <div class="source-strip">
      <span class="pill">{st.session_state.kind}</span>
      Grounded in <b>{st.session_state.label}</b>
    </div>
""", unsafe_allow_html=True)

def render_citations(citations: list[dict]) -> None:
    """Show which retrieved passages an answer actually cited.

    A tag row makes the citations visible at a glance; each tag expands into
    the exact snippet so the claim can be checked against its source. Code
    snippets use st.code so indentation is preserved and safe from HTML
    injection (source code often contains < and > characters).
    """
    if not citations:
        return
    tags = "".join(f'<span class="cite-tag">{c["id"]}</span>' for c in citations)
    st.markdown(f'<div class="cite-row">{tags}</div>', unsafe_allow_html=True)
    for cite in citations:
        with st.expander(f"{cite['id']}: {cite['reference']}"):
            st.caption(f"Similarity {cite.get('score')}")
            if cite.get("source_type") == "github":
                lang = Path(cite["reference"].split(":")[0]).suffix.lstrip(".") or "text"
                st.code(cite["snippet"] + " ...", language=lang)
            else:
                st.markdown(
                    f'<p class="cite-snippet">{html.escape(cite["snippet"])}…</p>',
                    unsafe_allow_html=True,
                )


tab_chat, tab_map = st.tabs(["Ask questions", "Mind map"])

with tab_chat:
    for turn in st.session_state.history:
        with st.chat_message(turn["role"]):
            st.markdown(turn["content"])
            render_citations(turn.get("citations", []))

    question = st.chat_input("Ask something about your source")
    if question:
        st.session_state.history.append({"role": "user", "content": question})
        with st.chat_message("user"):
            st.markdown(question)

        with st.chat_message("assistant"):
            with st.spinner("Retrieving and answering..."):
                # Follow-ups are rewritten first so retrieval sees a full query.
                standalone = generator.condense_question(
                    question, st.session_state.history[:-1]
                )
                hits = retrieve(standalone, st.session_state.collection_id, k=TOP_K)
                st.session_state.last_chunks = hits
                result = generator.answer(
                    standalone, hits, st.session_state.history[:-1]
                )

            st.markdown(result["answer"])
            if result.get("error"):
                st.error("The model call did not succeed — see message above.")
            elif result["refused"]:
                st.warning("The source does not appear to cover this question.")
            render_citations(result["citations"])

        st.session_state.history.append({
            "role": "assistant",
            "content": result["answer"],
            "citations": result["citations"],
        })

with tab_map:
    st.caption("Generates a mind map from the content retrieved for your last question.")
    topic = st.text_input("Topic to map", placeholder="Leave blank to use the last answer's context")

    if st.button("Generate mind map", type="primary"):
        source_chunks = st.session_state.last_chunks
        if topic:
            source_chunks = retrieve(topic, st.session_state.collection_id, k=6)

        if not source_chunks:
            st.warning("Ask a question first, or enter a topic above.")
        else:
            with st.spinner("Extracting structure and rendering..."):
                try:
                    outline = mindmap.extract_outline(source_chunks)
                    png = mindmap.render(outline, "mindmap", "png")
                    pdf = mindmap.render(outline, "mindmap", "pdf")
                    js = mindmap.export_json(outline)
                except (ValueError, RuntimeError) as exc:
                    st.error(str(exc))
                else:
                    st.image(png)
                    c1, c2, c3 = st.columns(3)
                    for col, path, mime, lbl in [
                        (c1, png, "image/png", "PNG"),
                        (c2, pdf, "application/pdf", "PDF"),
                        (c3, js, "application/json", "JSON"),
                    ]:
                        with open(path, "rb") as fh:
                            col.download_button(
                                f"Download {lbl}", fh.read(),
                                file_name=os.path.basename(path),
                                mime=mime, use_container_width=True,
                            )
