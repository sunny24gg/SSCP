"""CLI helper to parse a PDF using PyMuPDF and output JSON chunks."""
import sys
import json
import os
from ingestion.pdf_loader import load_pdf

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No PDF path provided"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(json.dumps({"success": False, "error": f"File not found: {pdf_path}"}))
        sys.exit(1)

    try:
        chunks = load_pdf(pdf_path)
        chunk_data = []
        full_text_parts = []
        max_page = 1

        for c in chunks:
            chunk_data.append({
                "text": c.text,
                "meta": c.meta
            })
            full_text_parts.append(c.text)
            page = c.meta.get("page", 1)
            if page > max_page:
                max_page = page

        result = {
            "success": True,
            "filename": os.path.basename(pdf_path),
            "pageCount": max_page,
            "chunkCount": len(chunks),
            "fullText": "\n\n".join(full_text_parts),
            "chunks": chunk_data
        }
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
