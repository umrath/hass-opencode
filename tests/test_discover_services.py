"""Tests for discover-services.js — structural validation and error handling."""
import unittest
from pathlib import Path

DISCOVER = (
    Path(__file__).resolve().parents[1]
    / "ha_opencode" / "rootfs" / "usr" / "local" / "bin" / "discover-services.js"
)


class TestDiscoverServices(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = DISCOVER.read_text() if DISCOVER.exists() else ""

    def test_exists(self):
        self.assertTrue(DISCOVER.exists())

    def test_has_shebang(self):
        self.assertIn("#!/usr/bin/env node", self.text)

    def test_requires_supervisor_token(self):
        self.assertIn("SUPERVISOR_TOKEN", self.text)

    def test_writes_to_env_vars_discovered(self):
        self.assertIn("/data/.env_vars_discovered", self.text)

    def test_handles_write_errors(self):
        self.assertIn("catch", self.text)
        self.assertIn("writeFileSync", self.text)

    def test_validates_addons_response(self):
        # Must validate that Supervisor addons response contains expected structure
        self.assertIn(".addons", self.text)

    def test_checks_access_token_for_esphome(self):
        self.assertIn("HA_ACCESS_TOKEN", self.text)

    def test_esphome_discovery_optional(self):
        self.assertIn("esphome", self.text.lower())

    def test_z2m_discovery_conditional(self):
        self.assertIn("Z2M", self.text)
        self.assertIn("DISCOVER_Z2M", self.text)

    def test_sets_timeout(self):
        self.assertIn("REQUEST_TIMEOUT_MS", self.text)

    def test_logs_errors_in_catch(self):
        self.assertIn("main().catch", self.text)
        self.assertIn("console.error", self.text)


if __name__ == "__main__":
    unittest.main()
