#!/usr/bin/env python3
"""Build a reproducible public package from the maintained Pages skill source."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.0"
FILES = (
    "SKILL.md", "agents/openai.yaml", "references/site.md", "references/markdown.md",
    "scripts/pages_http.py", "scripts/test_pages_http.py", "scripts/pages_markdown.mjs",
    "scripts/test_pages_markdown.mjs", "scripts/package.json", "scripts/package-lock.json",
    "scripts/.gitignore",
)


def main():
    source = ROOT / "skills/pages-site"
    public = ROOT / "public"
    archive_name = f"pages-site-{VERSION}.zip"
    archive_path = public / archive_name
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in FILES:
            path = source / name
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"Missing regular skill file: {name}")
            data = path.read_bytes()
            if b"/Users/legonaut/" in data:
                raise ValueError(f"Personal path in public skill: {name}")
            entry = zipfile.ZipInfo(f"pages-site/{name}", date_time=(2026, 9, 27, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compresslevel=9)
    checksum = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    manifest = {"name": "pages-site", "version": VERSION, "archive": archive_name,
                "sha256": checksum, "bytes": archive_path.stat().st_size, "fileCount": len(FILES)}
    (public / "pages-site-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (public / f"{archive_name}.sha256").write_text(f"{checksum}  {archive_name}\n")
    (public / "pages-site.SKILL.md").write_bytes((source / "SKILL.md").read_bytes())
    installer = (ROOT / "scripts/install-pages-skill.py").read_text()
    installer = installer.replace("__ARCHIVE_NAME__", archive_name).replace("__ARCHIVE_SHA256__", checksum)
    (public / "pages-site-install.py").write_text(installer)
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
