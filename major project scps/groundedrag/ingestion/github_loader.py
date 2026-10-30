"""GitHub repository ingestion.

Code is chunked along function/class boundaries rather than by character
count, and each chunk records file path + line range so a citation can point
a user to the exact lines.
"""

import os
import shutil
import stat
import tempfile
from pathlib import Path

from git import Repo

from config import Chunk, SKIP_DIRS, CODE_EXTENSIONS
from ingestion.chunker import split_code

MAX_FILE_BYTES = 200_000  # skip very large/generated files
MAX_FILES = 80
MAX_CHUNKS = 250
COMMON_NO_EXT_FILES = {"readme", "license", "dockerfile", "makefile", "gemfile", "procfile"}


def _remove_readonly(func, path, exc_info):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def load_github(repo_url: str) -> list[Chunk]:
    """Clone a public repo (shallow) and chunk its source files with directory manifest."""
    tmp = tempfile.mkdtemp(prefix="repo_")
    chunks: list[Chunk] = []

    try:
        clean_url = repo_url.strip().rstrip("/")
        Repo.clone_from(clean_url, tmp, depth=1)
        
        repo_name = clean_url.split("/")[-1]
        if repo_name.endswith(".git"):
            repo_name = repo_name[:-4]

        all_folders = set()
        all_files_info = []

        # 1. Discover all folders and candidate files in the repository
        for root, dirs, files in os.walk(tmp):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]

            rel_dir = str(Path(root).relative_to(tmp)).replace("\\", "/")
            if rel_dir and rel_dir != ".":
                all_folders.add(rel_dir)

            for fname in files:
                if fname.startswith("."):
                    continue
                fpath = Path(root) / fname
                rel = str(fpath.relative_to(tmp)).replace("\\", "/")
                
                is_code = fpath.suffix.lower() in CODE_EXTENSIONS or fname.lower() in COMMON_NO_EXT_FILES
                size = fpath.stat().st_size if fpath.exists() else 0
                
                all_files_info.append({
                    "path": rel,
                    "fpath": fpath,
                    "is_code": is_code,
                    "size": size
                })

        # 2. Build Directory Tree & File Manifest Chunk (Chunk #1)
        manifest_lines = [
            f"# Repository Directory Structure & File Manifest: {repo_name}",
            f"Repository: {repo_name}",
            f"Total Files: {len(all_files_info)}",
            f"Total Folders: {len(all_folders)}",
            "",
            "## Folders & Directories:",
        ]
        if all_folders:
            for folder in sorted(all_folders):
                manifest_lines.append(f"- {folder}/")
        else:
            manifest_lines.append("- / (root directory)")

        manifest_lines.append("")
        manifest_lines.append("## Files in Repository:")
        for f in sorted(all_files_info, key=lambda x: x["path"]):
            manifest_lines.append(f"- {f['path']} ({f['size']} bytes)")

        manifest_text = "\n".join(manifest_lines)
        chunks.append(
            Chunk(
                text=manifest_text,
                meta={
                    "source_type": "github",
                    "repo": repo_name,
                    "file_path": "REPOSITORY_STRUCTURE.md",
                    "section": "Directory Tree & File Manifest",
                    "start_line": 1,
                    "end_line": len(manifest_lines),
                }
            )
        )

        # 3. Read and chunk all source code, markup, and config files
        files_processed = 0
        for f in sorted(all_files_info, key=lambda x: x["path"]):
            if files_processed >= MAX_FILES or len(chunks) >= MAX_CHUNKS:
                break
            if not f["is_code"]:
                continue
            if f["size"] > MAX_FILE_BYTES:
                continue

            try:
                text = f["fpath"].read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if not text.strip():
                continue

            files_processed += 1
            rel = f["path"]
            blocks = split_code(text)
            for body, start, end in blocks:
                if len(chunks) >= MAX_CHUNKS:
                    break
                labeled_text = f"// File: {rel} (Lines {start}-{end})\n{body}"
                chunks.append(
                    Chunk(
                        text=labeled_text,
                        meta={
                            "source_type": "github",
                            "repo": repo_name,
                            "file_path": rel,
                            "section": f"{rel}:{start}-{end}",
                            "start_line": start,
                            "end_line": end,
                        },
                    )
                )
    finally:
        shutil.rmtree(tmp, onerror=_remove_readonly)
        if os.path.exists(tmp):
            shutil.rmtree(tmp, ignore_errors=True)

    return chunks
