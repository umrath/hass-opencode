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

    def test_screenshot_uses_baked_in_chromium(self):
        # Chromium is built into the image (Dockerfile.base), NOT installed at
        # runtime — the hardened AppArmor profile keeps /usr read-only, so a
        # runtime apt-install would fail. init must only gate on its presence.
        self.assertIn("screenshot_enabled", self.text)
        self.assertNotIn("apt-get install", self.text,
            "must NOT apt-install chromium at runtime (it is baked into the image)")
        self.assertIn("command -v chromium", self.text,
            "screenshot must verify chromium is present before enabling")

    def test_checks_hab_and_zigporter(self):
        self.assertIn("hab", self.text)
        self.assertIn("zigporter", self.text)

    def test_legacy_config_migration(self):
        self.assertIn("/homeassistant/.opencode/opencode.json", self.text,
            "must check for legacy project config")
        self.assertIn("server.py", self.text,
            "must catch python-based legacy MCP configs (server.py)")
        self.assertIn("ha-mcp", self.text,
            "must catch legacy MCP server paths")


if __name__ == "__main__":
    unittest.main()
