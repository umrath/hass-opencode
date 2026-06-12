"""Tests for the opencode session wrapper script."""
import unittest
from pathlib import Path

SESSION = (
    Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "usr" / "local" / "bin" / "opencode-session.sh"
)


class TestSessionScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SESSION.read_text() if SESSION.exists() else ""

    def test_exists(self):
        self.assertTrue(SESSION.exists())

    def test_sources_env_vars(self):
        self.assertIn("/data/.env_vars", self.text)

    def test_checks_supervisor_token(self):
        self.assertIn("SUPERVISOR_TOKEN", self.text)

    def test_sets_ha_token(self):
        self.assertIn("HA_TOKEN", self.text)

    def test_starts_opencode(self):
        self.assertIn("opencode", self.text)

    def test_shows_banner(self):
        self.assertIn("show_banner", self.text)

    def test_drops_to_shell_after(self):
        self.assertIn("show_shell_help", self.text)


if __name__ == "__main__":
    unittest.main()
