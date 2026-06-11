"""Tests for ha_opencode/apparmor.txt — the explicit AppArmor profile.

Structural / allow-list assertions only. AppArmor *enforcement* cannot be
validated off-device; these tests guard the profile against accidental
regressions (wrong name, dropped rule, unbalanced braces) and keep it in sync
with config.yaml.
"""

import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
PROFILE = REPO_ROOT / "ha_opencode" / "apparmor.txt"
CONFIG = REPO_ROOT / "ha_opencode" / "config.yaml"


class TestAppArmor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = PROFILE.read_text() if PROFILE.exists() else ""

    def test_profile_exists_and_substantial(self):
        self.assertTrue(PROFILE.exists(), "ha_opencode/apparmor.txt must exist")
        self.assertGreater(len(self.text), 200, "profile should have real content")

    def test_config_enables_apparmor(self):
        cfg = yaml.safe_load(CONFIG.read_text())
        self.assertTrue(cfg.get("apparmor"),
            "config.yaml must keep apparmor enabled so the profile is loaded")

    def test_profile_name_matches_slug(self):
        cfg = yaml.safe_load(CONFIG.read_text())
        self.assertIn(f"profile {cfg['slug']} ", self.text,
            "profile name must match the add-on slug")

    def test_standard_includes(self):
        self.assertIn("#include <tunables/global>", self.text)
        self.assertIn("#include <abstractions/base>", self.text)

    def test_braces_balanced(self):
        self.assertEqual(self.text.count("{"), self.text.count("}"),
            "unbalanced { } in profile")

    def test_network_and_pty(self):
        self.assertIn("network,", self.text)
        self.assertIn("/dev/ptmx rw", self.text)
        self.assertIn("/dev/pts/* rw", self.text)

    def test_system_read_only(self):
        for rule in ("/etc/** r,", "/usr/** r,", "/proc/** r,"):
            self.assertIn(rule, self.text, f"missing rule: {rule}")

    def test_binary_execute(self):
        self.assertIn("/bin/** ixr", self.text)
        self.assertIn("/usr/bin/**", self.text)
        # Node global modules must be exec + mmap (native addons / opencode).
        self.assertIn("/usr/local/lib/node_modules/** ixmr", self.text)

    def test_app_data_and_home_assistant(self):
        self.assertIn("/data/", self.text)
        self.assertIn("/homeassistant/ r", self.text)
        self.assertIn("/homeassistant/** rwk", self.text)

    def test_mapped_addon_dirs(self):
        # config.yaml mounts addons + all_addon_configs.
        self.assertIn("/addons/** rwk", self.text)
        self.assertIn("/addon_configs/** rwk", self.text)

    def test_s6_overlay_paths(self):
        for rule in ("/init ixr", "/command/** ixr", "/package/** ixr",
                     "/etc/s6-overlay/** ixr"):
            self.assertIn(rule, self.text, f"missing s6 rule: {rule}")

    def test_tmp_exec_mmap_for_opentui(self):
        # OpenCode extracts libopentui.so to /tmp and dlopens it.
        self.assertIn("/tmp/** ixmr", self.text)

    def test_devshm_for_chromium(self):
        self.assertIn("/dev/shm/** rwk", self.text)

    def test_zigporter_venv(self):
        self.assertIn("/opt/zigporter-venv/** ixmr", self.text)

    def test_bundled_node_servers(self):
        self.assertIn("/opt/ha-mcp-server/** ixmr", self.text)
        self.assertIn("/opt/ha-lsp-server/** ixmr", self.text)


if __name__ == "__main__":
    unittest.main()
