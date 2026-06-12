"""Tests for ha_opencode/Dockerfile — multi-stage build invariants.

Asserts the structural contract of the image build (stages, key tooling, the
ttyd health check, labels) without pinning exact versions, which live in
build.yaml and move over time.
"""

import re
import unittest
from pathlib import Path

DOCKERFILE = Path(__file__).resolve().parents[1] / "ha_opencode" / "Dockerfile"
BASE_DOCKERFILE = Path(__file__).resolve().parents[1] / "ha_opencode" / "Dockerfile.base"


class TestDockerfile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = DOCKERFILE.read_text() if DOCKERFILE.exists() else ""
        cls.base_text = BASE_DOCKERFILE.read_text() if BASE_DOCKERFILE.exists() else ""

    # ── Base Dockerfile ──────────────────────────────────────────────────────

    def test_base_exists_and_substantial(self):
        self.assertTrue(BASE_DOCKERFILE.exists())
        self.assertGreater(len(self.base_text), 800)
        self.assertRegex(self.base_text, r"(?m)^FROM\s+ghcr\.io/home-assistant/base-debian:trixie")

    def test_base_has_required_args(self):
        for arg in ("BUILD_ARCH", "TARGETARCH", "TTYD_VERSION", "OPENCODE_VERSION"):
            self.assertIn(f"ARG {arg}", self.base_text, f"Dockerfile.base missing ARG {arg}")

    def test_base_installs_system_packages(self):
        for pkg in ("git", "jq", "nodejs", "procps", "python3", "python3-venv", "tmux"):
            self.assertIn(pkg, self.base_text, f"Dockerfile.base should install {pkg}")

    def test_base_installs_global_npm(self):
        self.assertIn("opencode-ai", self.base_text)
        self.assertIn("prettier", self.base_text)
        self.assertIn("ppq-private-mode", self.base_text)
        self.assertIn("tsx", self.base_text)

    # ── App Dockerfile ──────────────────────────────────────────────────────

    def test_exists_and_substantial(self):
        self.assertTrue(DOCKERFILE.exists())
        self.assertGreater(len(self.text), 500)

    def test_has_hab_builder_stage(self):
        self.assertRegex(self.text, r"(?m)^FROM\s+.*\sAS\s+hab-builder",
            "multi-stage hab CLI builder stage must be present")

    def test_copies_hab_binary_from_builder(self):
        self.assertRegex(self.text, r"(?m)^COPY\s+--from=hab-builder\s")

    def test_final_stage_from_build_from(self):
        self.assertRegex(self.text, r"(?m)^FROM\s+ghcr\.io/umrath/ha_opencode-base:latest\b",
            "final stage must build FROM the pre-baked base image")

    def test_installs_core_tooling(self):
        for tool in ("nodejs", "git", "jq", "tmux", "python3"):
            self.assertIn(tool, self.base_text, f"Dockerfile.base should install {tool}")

    def test_installs_ttyd_and_opencode_and_prettier(self):
        self.assertIn("ttyd", self.base_text)
        self.assertIn("opencode-ai", self.base_text)
        self.assertIn("prettier", self.base_text)

    def test_copies_rootfs(self):
        self.assertRegex(self.text, r"(?m)^COPY\s+rootfs\s+/")

    def test_workdir_is_homeassistant(self):
        self.assertRegex(self.text, r"(?m)^WORKDIR\s+/homeassistant\b")

    def test_healthcheck_watches_ttyd(self):
        self.assertIn("HEALTHCHECK", self.text)
        m = re.search(r"HEALTHCHECK.*?CMD\s+(.+)", self.text, re.DOTALL)
        self.assertTrue(m and "ttyd" in m.group(1),
            "health check should verify the ttyd process")

    def test_healthcheck_start_period_sufficient(self):
        self.assertIn("--start-period=60s", self.text,
            "start-period must be >=60s so container reports 'starting' during boot")

    def test_has_hass_labels(self):
        for label in ("io.hass.name", "io.hass.type", "io.hass.version"):
            self.assertIn(label, self.text, f"missing label {label}")
        self.assertIn('io.hass.type="app"', self.text,
            "label must say 'app' not 'add-on'")


if __name__ == "__main__":
    unittest.main()
