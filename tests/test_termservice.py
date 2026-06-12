"""Tests for the three-service terminal architecture."""
import unittest
from pathlib import Path

S6 = Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "etc" / "s6-overlay" / "s6-rc.d"
PROXY_RUN = S6 / "ha-opencode-proxy" / "run"
DESKTOP_RUN = S6 / "ha-opencode-desktop" / "run"
MOBILE_RUN = S6 / "ha-opencode-mobile" / "run"
SHARED_THEME = Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "etc" / "profile.d" / "opencode-theme.sh"


class TestProxyService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = PROXY_RUN.read_text() if PROXY_RUN.exists() else ""

    def test_run_exists(self):
        self.assertTrue(PROXY_RUN.exists())

    def test_has_shebang(self):
        self.assertIn("#!/command/with-contenv bashio", self.text)

    def test_mobile_proxy_branch(self):
        self.assertIn("mobile_proxy_enabled", self.text)

    def test_sleeps_when_disabled(self):
        self.assertIn("sleep infinity", self.text)

    def test_exports_proxy_ports(self):
        self.assertIn("OC_PROXY_PORT=8099", self.text)

    def test_starts_proxy(self):
        self.assertIn("python3 /usr/share/oc-proxy/proxy.py", self.text)


class TestDesktopService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = DESKTOP_RUN.read_text() if DESKTOP_RUN.exists() else ""

    def test_run_exists(self):
        self.assertTrue(DESKTOP_RUN.exists())

    def test_has_shebang(self):
        self.assertIn("#!/command/with-contenv bashio", self.text)

    def test_mobile_proxy_branch(self):
        self.assertIn("mobile_proxy_enabled", self.text)

    def test_starts_ttyd_with_tmux(self):
        self.assertIn("ttyd", self.text)
        self.assertIn("tmux", self.text)

    def test_single_instance_fallback(self):
        self.assertIn("PORT=8099", self.text)

    def test_single_instance_binds_all_interfaces(self):
        """W1 regression: In single-instance mode (PORT=8099), ttyd must bind
        0.0.0.0, not 127.0.0.1. HA Ingress connects from the container's
        network IP, not loopback."""
        # The -i 127.0.0.1 must be CONDITIONAL — only in proxy mode (PORT=8098).
        # In single mode (PORT=8099), it must NOT be on the exec ttyd line.
        # Check that the script has conditional logic for -i, not hardcoded.
        exec_lines = [l for l in self.text.split("\n") if "exec ttyd" in l]
        self.assertTrue(exec_lines, "must have exec ttyd")
        full_line = " ".join(exec_lines)
        # Currently broken: -i 127.0.0.1 is hardcoded for both modes.
        # After fix: should only appear in proxy mode branch, not hardcoded.
        # We verify: the -i flag should NOT be on the same line as ${PORT}
        # because it needs to be conditional on mobile_proxy_enabled.
        self.assertNotIn("-i 127.0.0.1", full_line,
            "-i 127.0.0.1 must be conditional, not hardcoded on exec ttyd")


class TestMobileService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = MOBILE_RUN.read_text() if MOBILE_RUN.exists() else ""

    def test_run_exists(self):
        self.assertTrue(MOBILE_RUN.exists())

    def test_has_shebang(self):
        self.assertIn("#!/command/with-contenv bashio", self.text)

    def test_mobile_proxy_branch(self):
        self.assertIn("mobile_proxy_enabled", self.text)

    def test_sleeps_when_disabled(self):
        self.assertIn("sleep infinity", self.text)

    def test_no_tmux(self):
        self.assertIn("ttyd", self.text)
        self.assertNotIn("tmux", self.text)

    def test_larger_font(self):
        self.assertIn("FONT_SIZE_MOBILE", self.text)


class TestSharedTheme(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SHARED_THEME.read_text() if SHARED_THEME.exists() else ""

    def test_exists(self):
        self.assertTrue(SHARED_THEME.exists())

    def test_has_ten_themes(self):
        themes = ["breeze", "catppuccin_mocha", "catppuccin_latte",
                   "dracula", "nord", "tokyo_night", "one_dark",
                   "solarized_dark", "solarized_light", "gruvbox_dark"]
        for t in themes:
            self.assertIn(t, self.text, f"missing theme: {t}")


if __name__ == "__main__":
    unittest.main()
