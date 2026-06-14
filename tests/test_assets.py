"""Tests for required app assets (icons, logos, docs)."""

import json
import re
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

    def test_license_file_is_mit(self):
        """LICENSE must contain MIT in the first 3 lines."""
        license_path = REPO_ROOT / "LICENSE"
        self.assertTrue(license_path.exists(), "LICENSE must exist")
        head = license_path.read_text()
        self.assertIn("MIT", head,
            "LICENSE must be the MIT License")

    def test_oci_labels_are_mit(self):
        """build.yaml OCI labels must state MIT license."""
        for addon in ADDONS:
            path = REPO_ROOT / addon / "build.yaml"
            if not path.exists():
                continue
            content = path.read_text()
            self.assertIn('licenses: "MIT"', content,
                f"{addon}/build.yaml OCI label must say MIT")

    def test_package_json_licenses_are_mit(self):
        """package.json files must say MIT."""
        package_files = list(REPO_ROOT.rglob("opt/*/package.json"))
        for p in package_files:
            try:
                data = json.loads(p.read_text())
            except json.JSONDecodeError:
                continue
            lic = data.get("license", "")
            self.assertEqual(lic, "MIT",
                f"{p.relative_to(REPO_ROOT)} must have license: MIT, got: {lic}")

    def test_docs_license_is_mit(self):
        """DOCS.md license statement must say MIT, not Unlicense."""
        for addon in ADDONS:
            path = REPO_ROOT / addon / "DOCS.md"
            if not path.exists():
                continue
            content = path.read_text()
            self.assertNotIn("Unlicense", content,
                f"{addon}/DOCS.md must not mention Unlicense")
            self.assertIn("MIT", content,
                f"{addon}/DOCS.md must mention MIT License")

    def test_third_party_license_is_mit(self):
        """THIRD-PARTY-LICENSES.md must reference MIT, not Unlicense."""
        path = REPO_ROOT / "THIRD-PARTY-LICENSES.md"
        self.assertTrue(path.exists(), "THIRD-PARTY-LICENSES.md must exist")
        content = path.read_text()
        self.assertNotIn("Unlicense", content,
            "THIRD-PARTY-LICENSES.md must not mention Unlicense")
        self.assertIn("MIT", content,
            "THIRD-PARTY-LICENSES.md must reference MIT License")

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

    def test_version_shield_updatable(self):
        """README version shield must use a pattern update-version-shield.sh can match."""
        readme = REPO_ROOT / "README.md"
        self.assertTrue(readme.exists(), "README.md must exist")
        content = readme.read_text()
        shield_pat = re.compile(
            r'\[version-shield\]: https://img\.shields\.io/badge/version-v[\d.]+-blue\.svg'
        )
        self.assertTrue(shield_pat.search(content),
            "README.md version-shield must match the pattern update-version-shield.sh expects "
            "(e.g. ...img.shields.io/badge/version-vX.Y.Z-blue.svg)")

    def test_stable_addon_has_readme(self):
        self.assertTrue((REPO_ROOT / "ha_opencode" / "README.md").exists()
                        or (REPO_ROOT / "README.md").exists(),
            "an app or root README must document the stable app")


if __name__ == "__main__":
    unittest.main()
