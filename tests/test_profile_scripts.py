"""Tests for profile.d shell wrappers."""
import unittest
from pathlib import Path

ROOTFS = Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "etc" / "profile.d"
HAB = ROOTFS / "hab-esphome.sh"
ZIGPORTER = ROOTFS / "zigporter-z2m.sh"


class TestHabEspHome(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = HAB.read_text() if HAB.exists() else ""

    def test_exists(self):
        self.assertTrue(HAB.exists())

    def test_checks_access_token(self):
        self.assertIn("HA_ACCESS_TOKEN", self.text)
        self.assertIn("esphome", self.text.lower())

    def test_blocks_esphome_without_token(self):
        self.assertIn('echo "ESPHome commands require', self.text)

    def test_passes_other_hab_commands(self):
        self.assertIn('command hab "$@"', self.text)


class TestZigporterZ2M(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = ZIGPORTER.read_text() if ZIGPORTER.exists() else ""

    def test_exists(self):
        self.assertTrue(ZIGPORTER.exists())

    def test_checks_z2m_url(self):
        self.assertIn("Z2M_URL", self.text)

    def test_blocks_z2m_without_url(self):
        self.assertIn("requires Zigbee2MQTT URL", self.text)

    def test_z2m_dependent_commands_blocked(self):
        self.assertIn("list-z2m", self.text)
        self.assertIn("network-map", self.text)

    def test_passes_other_zigporter_commands(self):
        self.assertIn('command zigporter "$@"', self.text)


if __name__ == "__main__":
    unittest.main()
