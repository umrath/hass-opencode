"""Tests for the Python terminal supervisor (supervisor.py)."""
import ast
import unittest
from pathlib import Path

SUPERVISOR = (
    Path(__file__).resolve().parents[1]
    / "ha_opencode" / "rootfs" / "usr" / "share" / "oc-proxy" / "supervisor.py"
)


class TestSupervisorScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SUPERVISOR.read_text() if SUPERVISOR.exists() else ""

    def test_exists(self):
        self.assertTrue(SUPERVISOR.exists())

    def test_valid_python(self):
        ast.parse(self.text)

    def test_has_signal_handler(self):
        self.assertIn("signal.signal(signal.SIGTERM", self.text)

    def test_starts_both_ttyd_instances(self):
        self.assertIn("desktop", self.text)
        self.assertIn("mobile", self.text)

    def test_uses_subprocess(self):
        self.assertIn("subprocess.Popen", self.text)

    def test_monitors_children(self):
        self.assertIn("poll()", self.text)
        self.assertIn("exited", self.text)

    def test_terminates_all_on_child_death(self):
        self.assertIn("terminate()", self.text)

    def test_exports_for_proxy(self):
        self.assertIn("PROXY_SCRIPT", self.text)


if __name__ == "__main__":
    unittest.main()
