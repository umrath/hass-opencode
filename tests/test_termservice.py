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
