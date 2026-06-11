"""Tests for repository.yaml — HA add-on repository metadata."""

import unittest
from pathlib import Path

import yaml

REPO_PATH = Path(__file__).resolve().parents[1] / "repository.yaml"


class TestRepositoryYaml(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = yaml.safe_load(REPO_PATH.read_text()) if REPO_PATH.exists() else None

    def test_exists(self):
        self.assertTrue(REPO_PATH.exists(), "repository.yaml must exist")

    def test_parses_to_dict(self):
        self.assertIsInstance(self.cfg, dict)

    def test_name_mentions_opencode(self):
        self.assertIn("OpenCode", self.cfg.get("name", ""))

    def test_url_points_to_umrath_github(self):
        self.assertIn("github.com/umrath", self.cfg.get("url", ""))

    def test_has_maintainer(self):
        self.assertTrue(self.cfg.get("maintainer"))

    def test_no_unexpected_keys(self):
        allowed = {"name", "url", "maintainer"}
        extra = set(self.cfg) - allowed
        self.assertEqual(extra, set(), f"unexpected keys: {extra}")


if __name__ == "__main__":
    unittest.main()
