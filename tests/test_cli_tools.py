"""Tests for CLI tools (ha-mcp, ha-logs)."""
import unittest
from pathlib import Path

BIN = Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "usr" / "local" / "bin"
HA_MCP = BIN / "ha-mcp"
HA_LOGS = BIN / "ha-logs"


class TestHaMcp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = HA_MCP.read_text() if HA_MCP.exists() else ""

    def test_exists(self):
        self.assertTrue(HA_MCP.exists())

    def test_has_shebang(self):
        self.assertIn("#!/command/with-contenv bashio", self.text)

    def test_supports_status_command(self):
        self.assertIn("status", self.text)

    def test_supports_enable_command(self):
        self.assertIn("enable", self.text)

    def test_supports_disable_command(self):
        self.assertIn("disable", self.text)

    def test_checks_supervisor_token(self):
        self.assertIn("SUPERVISOR_TOKEN", self.text)

    def test_uses_open code_config(self):
        self.assertIn("opencode.json", self.text)


class TestHaLogs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = HA_LOGS.read_text() if HA_LOGS.exists() else ""

    def test_exists(self):
        self.assertTrue(HA_LOGS.exists())

    def test_has_shebang(self):
        self.assertIn("#!/command/with-contenv bashio", self.text)

    def test_supports_core_logs(self):
        self.assertIn("core", self.text.lower())

    def test_supports_error_logs(self):
        self.assertIn("error", self.text.lower())

    def test_supports_supervisor_logs(self):
        self.assertIn("supervisor", self.text.lower())

    def test_uses_supervisor_api(self):
        self.assertIn("supervisor", self.text)


if __name__ == "__main__":
    unittest.main()
