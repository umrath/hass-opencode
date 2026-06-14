"""Tests for the init-opencode oneshot service."""
import unittest
from pathlib import Path

INIT = (
    Path(__file__).resolve().parents[1]
    / "ha_opencode" / "rootfs" / "etc" / "s6-overlay" / "s6-rc.d" / "init-opencode" / "run"
)


class TestInitService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = INIT.read_text() if INIT.exists() else ""

    def test_exists_and_substantial(self):
        self.assertTrue(INIT.exists())
        self.assertGreater(len(self.text), 500)

    def test_has_shebang(self):
        self.assertIn("#!/command/with-contenv bashio", self.text)

    def test_reads_config_options(self):
        for opt in ("mcp_enabled", "lsp_enabled", "cpu_mode", "opencode_update_policy"):
            self.assertIn(opt, self.text, f"missing config read for {opt}")

    def test_generates_opencode_json(self):
        self.assertIn("opencode.json", self.text)

    def test_deploys_agents_md(self):
        self.assertIn("AGENTS.md", self.text)

    def test_detects_cpu(self):
        self.assertIn("cpu_mode", self.text)
        self.assertIn("AVX2", self.text)

    def test_uses_bundled_opencode(self):
        self.assertIn("bundled OpenCode", self.text)

    def test_installs_chromium_at_runtime(self):
        self.assertIn("screenshot_enabled", self.text)
        self.assertIn("chromium", self.text)
        # Timeout protection and fallback
        self.assertIn("timeout", self.text,
            "chromium install must have timeout protection")
        self.assertIn("SCREENSHOT_ENABLED=false", self.text,
            "screenshot must fall back to disabled on install failure")

    def test_checks_hab_and_zigporter(self):
        self.assertIn("hab", self.text)
        self.assertIn("zigporter", self.text)


if __name__ == "__main__":
    unittest.main()
