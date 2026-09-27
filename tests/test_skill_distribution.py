import hashlib
import importlib.util
import io
import json
from pathlib import Path
import os
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "public/pages-site-manifest.json").read_text())
ARCHIVE = ROOT / "public" / MANIFEST["archive"]
INSTALLER = ROOT / "public/pages-site-install.py"
spec = importlib.util.spec_from_file_location("pages_skill_installer", INSTALLER)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class DistributionTests(unittest.TestCase):
    def run_installer(self, home, archive=ARCHIVE):
        return subprocess.run([os.sys.executable, str(INSTALLER), "--archive", str(archive)],
                              env={**os.environ, "CODEX_HOME": str(home)},
                              capture_output=True, text=True)

    def test_package_installs_all_source_files_and_repeated_install_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / "codex"
            result = self.run_installer(home)
            self.assertEqual(result.returncode, 0, result.stderr)
            target = home / "skills/pages-site"
            for name, data in installer.archive_files(ARCHIVE.read_bytes()).items():
                self.assertEqual((target / name).read_bytes(), (ROOT / "skills/pages-site" / name).read_bytes())
                self.assertEqual((target / name).read_bytes(), data)
            second = self.run_installer(home)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("Already installed", second.stdout)

    def test_existing_different_installation_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            target = home / "skills/pages-site"
            target.mkdir(parents=True)
            local_file = target / "SKILL.md"
            local_file.write_text("Local changes must survive")
            result = self.run_installer(home)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(local_file.read_text(), "Local changes must survive")
            self.assertEqual(list(target.iterdir()), [local_file])

    def test_invalid_checksum_does_not_create_installation(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / "codex"
            corrupt = Path(temp) / "corrupt.zip"
            corrupt.write_bytes(ARCHIVE.read_bytes() + b"altered")
            result = self.run_installer(home, corrupt)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checksum", result.stderr)
            self.assertFalse(home.exists())

    def test_unsafe_archive_paths_and_symlinks_are_rejected(self):
        original_checksum = installer.ARCHIVE_SHA256
        try:
            for name, mode in [("pages-site/../../outside", 0o100644),
                               ("/pages-site/SKILL.md", 0o100644),
                               ("pages-site/C:/outside", 0o100644),
                               ("pages-site/SKILL.md", 0o120777)]:
                with self.subTest(name=name, mode=mode):
                    stream = io.BytesIO()
                    with zipfile.ZipFile(stream, "w") as archive:
                        entry = zipfile.ZipInfo(name)
                        entry.external_attr = mode << 16
                        archive.writestr(entry, b"outside")
                    data = stream.getvalue()
                    installer.ARCHIVE_SHA256 = hashlib.sha256(data).hexdigest()
                    with self.assertRaisesRegex(ValueError, "unsafe"):
                        installer.archive_files(data)
        finally:
            installer.ARCHIVE_SHA256 = original_checksum

    def test_download_does_not_follow_redirects(self):
        with self.assertRaisesRegex(ValueError, "redirected"):
            installer.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.invalid/")

    def test_manifest_matches_archive_and_public_instructions(self):
        data = ARCHIVE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), MANIFEST["sha256"])
        self.assertEqual(len(data), MANIFEST["bytes"])
        files = installer.archive_files(data)
        self.assertEqual(len(files), MANIFEST["fileCount"])
        self.assertEqual(files[Path("SKILL.md")], (ROOT / "public/pages-site.SKILL.md").read_bytes())
        self.assertFalse(any("node_modules" in name.parts or "__pycache__" in name.parts for name in files))
        self.assertFalse(any(b"/Users/legonaut/" in content for content in files.values()))


if __name__ == "__main__":
    unittest.main()
