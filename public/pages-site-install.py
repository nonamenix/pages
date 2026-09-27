#!/usr/bin/env python3
"""Install the verified Pages skill without replacing an existing installation."""
import argparse
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import urllib.request
import zipfile

ARCHIVE_URL = "https://pages.live4.dev/pages-site-1.0.0.zip"
ARCHIVE_SHA256 = "f7b4623b0bb785397ce1dc4e0df0402a8b8186ad935221986eb4ceb3913ac4eb"
MAX_DOWNLOAD = 2 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Archive download redirected; installation stopped.")


def download():
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(ARCHIVE_URL, timeout=30) as response:
        data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError("Archive exceeds the download limit.")
    return data


def archive_files(data):
    if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Archive checksum does not match; installation stopped.")
    files = {}
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            name = PurePosixPath(entry.filename)
            if (name.is_absolute() or ".." in name.parts or "\\" in entry.filename or ":" in entry.filename
                    or len(name.parts) < 2 or name.parts[0] != "pages-site"
                    or stat.S_ISLNK(entry.external_attr >> 16) or entry.is_dir()):
                raise ValueError("Archive contains an unsafe path or file type.")
            relative = Path(*name.parts[1:])
            if relative in files:
                raise ValueError("Archive contains duplicate files.")
            total += entry.file_size
            if total > MAX_DOWNLOAD or len(files) >= 64:
                raise ValueError("Archive exceeds the extraction limit.")
            files[relative] = archive.read(entry)
    if Path("SKILL.md") not in files:
        raise ValueError("Archive is missing SKILL.md.")
    return files


def install(files, destination):
    if destination.exists() or destination.is_symlink():
        if (not destination.is_symlink() and destination.is_dir()
                and all((destination / name).is_file()
                        and not (destination / name).is_symlink()
                        and (destination / name).read_bytes() == data
                        for name, data in files.items())):
            return False
        raise ValueError("pages-site already exists; existing files were preserved.")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix=".pages-site-", dir=destination.parent) as staging:
        prepared = Path(staging) / "pages-site"
        prepared.mkdir(mode=0o700)
        for name, data in files.items():
            filename = prepared / name
            filename.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with filename.open("xb") as output:
                output.write(data)
            filename.chmod(0o600)
        if destination.exists() or destination.is_symlink():
            raise ValueError("Installation directory appeared; existing files were preserved.")
        prepared.rename(destination)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", type=Path, help="Alternative pages-site installation directory")
    parser.add_argument("--archive", type=Path, help="Use a locally downloaded ZIP with the same checksum")
    args = parser.parse_args()
    codex_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    destination = args.dest or codex_home / "skills" / "pages-site"
    try:
        data = args.archive.read_bytes() if args.archive else download()
        changed = install(archive_files(data), destination)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Installation stopped: {error}", file=sys.stderr)
        return 1
    print(f"{'Installed' if changed else 'Already installed'} pages-site: {destination}")
    print("The skill will be available on your next Codex turn.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
