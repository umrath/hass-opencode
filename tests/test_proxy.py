"""Tests for the mobile-detection TCP proxy."""
import ast
import unittest
from pathlib import Path

PROXY = Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "usr" / "share" / "oc-proxy" / "proxy.py"


class TestProxyScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = PROXY.read_text() if PROXY.exists() else ""

    def test_exists(self):
        self.assertTrue(PROXY.exists())

    def test_parses_as_valid_python(self):
        ast.parse(self.text)

    def test_imports_asyncio(self):
        self.assertIn("asyncio", self.text)

    def test_defines_handle_function(self):
        self.assertIn("async def handle", self.text)

    def test_defines_main_function(self):
        self.assertIn("async def main", self.text)

    def test_calls_asyncio_run(self):
        self.assertIn("asyncio.run(main())", self.text)

    def test_mobile_patterns_defined(self):
        self.assertIn("MOBILE_PATTERNS", self.text)

    def test_listen_port_configurable(self):
        self.assertIn("LISTEN_PORT", self.text)
        self.assertIn("os.environ", self.text)

    def test_touch_probe_present(self):
        self.assertIn("navigator.maxTouchPoints", self.text)


if __name__ == "__main__":
    unittest.main()
