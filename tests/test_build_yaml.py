"""Tests for the build.yaml files (build_from base images + pinned build args).

Unlike the Codeberg variant (which inlines build args in the Dockerfile), this
repo keeps a build.yaml per app.
"""

import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
STABLE_BUILD = REPO_ROOT / "ha_opencode" / "build.yaml"
STABLE_CONFIG = REPO_ROOT / "ha_opencode" / "config.yaml"


class TestStableBuildYaml(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = yaml.safe_load(STABLE_BUILD.read_text()) if STABLE_BUILD.exists() else None
        cls.config = yaml.safe_load(STABLE_CONFIG.read_text())

    def test_exists(self):
        self.assertTrue(STABLE_BUILD.exists(), "ha_opencode/build.yaml must exist")

    def test_parses_to_dict(self):
        self.assertIsInstance(self.build, dict)

    def test_build_from_covers_all_config_arches(self):
        self.assertIn("build_from", self.build)
        bf = self.build["build_from"]
        for arch in self.config["arch"]:
            self.assertIn(arch, bf, f"build_from missing base image for arch {arch}")

    def test_build_from_uses_ha_debian_base(self):
        for arch, image in self.build["build_from"].items():
            self.assertIn("home-assistant/base-debian", image,
                f"{arch} base image should be the HA Debian base: {image}")

    def test_args_pin_versions(self):
        self.assertIn("args", self.build)
        for key in ("OPENCODE_VERSION", "TTYD_VERSION"):
            self.assertIn(key, self.build["args"], f"build arg {key} should be pinned")

    def test_has_oci_labels(self):
        self.assertIn("labels", self.build)
        labels = self.build["labels"]
        for label in ("org.opencontainers.image.title",
                      "org.opencontainers.image.source"):
            self.assertIn(label, labels)


if __name__ == "__main__":
    unittest.main()
