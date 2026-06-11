"""Tests for the CHANGELOG.md files.

This repo uses plain `## <version>` headings (no dates). The release flow bumps
config.yaml on tag while the CHANGELOG is curated under `## Unreleased`, so the
contract is: the current version is documented OR an Unreleased section exists.
"""

import re
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
ADDONS = ("ha_opencode", "ha_opencode_beta")


def version_of(addon):
    cfg = yaml.safe_load((REPO_ROOT / addon / "config.yaml").read_text())
    return cfg["version"]


class TestChangelogs(unittest.TestCase):
    def test_changelog_exists_and_nonempty(self):
        for addon in ADDONS:
            path = REPO_ROOT / addon / "CHANGELOG.md"
            self.assertTrue(path.exists(), f"{addon}/CHANGELOG.md must exist")
            self.assertGreater(len(path.read_text().strip()), 0,
                f"{addon}/CHANGELOG.md must not be empty")

    def test_has_at_least_one_heading(self):
        for addon in ADDONS:
            text = (REPO_ROOT / addon / "CHANGELOG.md").read_text()
            self.assertRegex(text, r"(?m)^## ",
                f"{addon}/CHANGELOG.md must have at least one '## ' heading")

    def test_current_version_documented_or_unreleased(self):
        for addon in ADDONS:
            with self.subTest(addon=addon):
                text = (REPO_ROOT / addon / "CHANGELOG.md").read_text()
                ver = version_of(addon)
                has_version = re.search(
                    r"(?m)^## \[?" + re.escape(ver) + r"\]?(\s|$)", text)
                has_unreleased = re.search(r"(?m)^## \[?Unreleased\]?", text)
                self.assertTrue(has_version or has_unreleased,
                    f"{addon}: neither '## {ver}' nor '## Unreleased' present in CHANGELOG")


if __name__ == "__main__":
    unittest.main()
