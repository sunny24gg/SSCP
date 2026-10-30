"""CLI helper to clone and parse a public GitHub repository into JSON chunks."""
import sys
import json
import os

# Ensure groundedrag directory is on Python path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from ingestion.github_loader import load_github

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No GitHub URL provided"}))
        sys.exit(1)

    repo_url = sys.argv[1].strip()
    try:
        chunks = load_github(repo_url)
        if not chunks:
            print(json.dumps({"success": False, "error": "No parsable source files or documentation found in this repository."}))
            sys.exit(1)

        chunk_data = []
        full_text_parts = []
        files_seen = set()

        for c in chunks:
            chunk_data.append({
                "text": c.text,
                "meta": c.meta
            })
            fpath = c.meta.get("file_path", "source_file")
            if fpath != "REPOSITORY_STRUCTURE.md":
                files_seen.add(fpath)
            full_text_parts.append(c.text)

        clean_url = repo_url.rstrip("/")
        if clean_url.endswith(".git"):
            clean_url = clean_url[:-4]
        
        parts = [p for p in clean_url.split("/") if p]
        owner = parts[-2] if len(parts) >= 2 else "repo"
        repo_name = parts[-1]

        result = {
            "success": True,
            "title": f"{owner}/{repo_name} (Repository)",
            "repo": f"{owner}/{repo_name}",
            "filename": f"{repo_name} codebase ({len(files_seen)} files)",
            "fileCount": len(files_seen),
            "chunkCount": len(chunks),
            "content": "\n\n".join(full_text_parts)[:40000],
            "chunks": chunk_data
        }
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"success": False, "error": f"Git clone/parse error: {str(exc)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()

