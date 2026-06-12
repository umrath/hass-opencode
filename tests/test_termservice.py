"""Tests for the terminal service run script."""
import unittest
from pathlib import Path

RUN = Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "etc" / "s6-overlay" / "s6-rc.d" / "ha-opencode" / "run"
FINISH = RUN.parent / "finish"


class TestTermService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_text = RUN.read_text() if RUN.exists() else ""
        cls.finish_text = FINISH.read_text() if FINISH.exists() else ""

    def test_run_exists(self):
        self.assertTrue(RUN.exists())

    def test_has_shebang(self):
        self.assertIn("#!/command/with-contenv bashio", self.run_text)

    def test_starts_ttyd(self):
        self.assertIn("ttyd ", self.run_text)

    def test_has_mobile_proxy_branch(self):
        self.assertIn("MOBILE_PROXY_ENABLED", self.run_text)

    def test_has_single_instance_branch(self):
        self.assertIn("single instance", self.run_text)
        self.assertIn("exec ttyd", self.run_text)

    def test_has_theme_function(self):
        self.assertIn("get_theme", self.run_text)

    def test_proxy_starts_before_ttyd(self):
        """Regression: proxy must bind BEFORE ttyd so ingress port 8099 is available immediately.
        The HA Supervisor checks ingress right after container start."""
        proxy_idx = self.run_text.find("proxy.py")
        ttyd_idx = self.run_text.find("ttyd -W -p ${DESKTOP_PORT}")
        self.assertLess(proxy_idx, ttyd_idx,
            "proxy must start before ttyd backends (proxy binds ingress port immediately)")

    def test_supervises_children_with_kill_check(self):
        self.assertIn("kill -0", self.run_text)
        self.assertIn("died", self.run_text)
        self.assertIn("sleep 5", self.run_text)

    def test_finish_script_exists(self):
        self.assertTrue(FINISH.exists())

    def test_finish_kills_ttyd(self):
        self.assertIn("pgrep ttyd", self.finish_text)
        self.assertIn("kill", self.finish_text)


if __name__ == "__main__":
    unittest.main()
