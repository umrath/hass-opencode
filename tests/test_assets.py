"""Tests for required app assets (icons, logos, docs)."""

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ADDONS = ("ha_opencode", "ha_opencode_beta")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class TestProjectAssets(unittest.TestCase):
    def test_root_readme_exists(self):
        self.assertTrue((REPO_ROOT / "README.md").exists(),
            "root README.md must exist")

    def test_license_file_exists(self):
        self.assertTrue((REPO_ROOT / "LICENSE").exists(),
            "LICENSE must exist at repo root")

    def test_each_addon_has_icon_and_logo(self):
        for addon in ADDONS:
            for asset in ("icon.png", "logo.png"):
                path = REPO_ROOT / addon / asset
                self.assertTrue(path.exists(), f"{addon}/{asset} must exist")

    def test_pngs_have_valid_magic_bytes(self):
        for addon in ADDONS:
            for asset in ("icon.png", "logo.png"):
                path = REPO_ROOT / addon / asset
                with path.open("rb") as fh:
                    head = fh.read(8)
                self.assertEqual(head, PNG_MAGIC, f"{addon}/{asset} is not a valid PNG")

    def test_each_addon_has_docs_and_changelog(self):
        for addon in ADDONS:
            for doc in ("DOCS.md", "CHANGELOG.md"):
                path = REPO_ROOT / addon / doc
                self.assertTrue(path.exists(), f"{addon}/{doc} must exist")

    def test_stable_addon_has_readme(self):
        self.assertTrue((REPO_ROOT / "ha_opencode" / "README.md").exists()
                        or (REPO_ROOT / "README.md").exists(),
            "an app or root README must document the stable app")


if __name__ == "__main__":
    unittest.main()
