"""Tests for assets not covered by other test files."""
import ast
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TestInjectClipboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "ha_opencode" / "rootfs" / "opt" / "ttyd" / "inject-clipboard.py"
        cls.text = cls.path.read_text() if cls.path.exists() else ""

    def test_exists(self):
        self.assertTrue(self.path.exists())

    def test_valid_python(self):
        ast.parse(self.text)


class TestOpenCodeHaJson(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "ha_opencode" / "rootfs" / "opt" / "ha-mcp-server" / "opencode-ha.json"
        cls.text = cls.path.read_text() if cls.path.exists() else ""

    def test_valid_json(self):
        json.loads(self.text)

    def test_mcp_section(self):
        cfg = json.loads(self.text)
        self.assertIn("mcp", cfg)
        self.assertIn("homeassistant", cfg["mcp"])
        self.assertIn("SUPERVISOR_TOKEN", str(cfg["mcp"]["homeassistant"]))

    def test_lsp_section(self):
        cfg = json.loads(self.text)
        self.assertIn("lsp", cfg)
        self.assertIn("ha-yaml", cfg["lsp"])


class TestDeprecationPatterns(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "ha_opencode" / "rootfs" / "opt" / "shared" / "deprecation-patterns.json"
        cls.text = cls.path.read_text() if cls.path.exists() else ""

    def test_valid_json(self):
        json.loads(self.text)

    def test_is_list_of_objects(self):
        patterns = json.loads(self.text)
        self.assertIsInstance(patterns, list)
        self.assertGreater(len(patterns), 0)


class TestTmuxConfig(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "ha_opencode" / "rootfs" / "etc" / "tmux.conf"
        cls.text = cls.path.read_text() if cls.path.exists() else ""

    def test_exists(self):
        self.assertTrue(self.path.exists())

    def test_sets_osc52(self):
        self.assertIn("set -g allow-passthrough", self.text.lower())


class TestDiscoverServicesSyntax(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "ha_opencode" / "rootfs" / "usr" / "local" / "bin" / "discover-services.js"
        cls.text = cls.path.read_text() if cls.path.exists() else ""

    def test_valid_js_syntax(self):
        result = subprocess.run(["node", "-c", str(self.path)],
                                capture_output=True)
        self.assertEqual(result.returncode, 0,
            f"JS syntax error:\n{result.stderr.decode()}")


class TestClipboardJs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "ha_opencode" / "rootfs" / "opt" / "ttyd" / "clipboard.js"
        cls.text = cls.path.read_text() if cls.path.exists() else ""

    def test_exists(self):
        self.assertTrue(self.path.exists())

    def test_valid_js_syntax(self):
        result = subprocess.run(["node", "-c", str(self.path)],
                                capture_output=True)
        self.assertEqual(result.returncode, 0,
            f"JS syntax error:\n{result.stderr.decode()}")

    def test_has_osc52_handler(self):
        self.assertIn("OSC", self.text)
        self.assertIn("clipboard", self.text.lower())


class TestTouchScrollJs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "ha_opencode" / "rootfs" / "opt" / "ttyd" / "touch-scroll.js"
        cls.text = cls.path.read_text() if cls.path.exists() else ""

    def test_exists(self):
        self.assertTrue(self.path.exists())

    def test_valid_js_syntax(self):
        result = subprocess.run(["node", "-c", str(self.path)],
                                capture_output=True)
        self.assertEqual(result.returncode, 0,
            f"JS syntax error:\n{result.stderr.decode()}")

    def test_inlines_safely(self):
        # injected inline into ttyd's index page, so it must not break out of
        # the <script> wrapper (same constraint inject-clipboard.py enforces).
        self.assertNotIn("</script>", self.text)

    def test_touch_only(self):
        # must be a no-op on non-touch pointers so desktop is unaffected
        self.assertIn("touchstart", self.text)
        self.assertIn("maxTouchPoints", self.text)


if __name__ == "__main__":
    unittest.main()
