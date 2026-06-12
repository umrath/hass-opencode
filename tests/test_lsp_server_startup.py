"""Tests for LSP server startup — verifies it initializes without crashing."""
import json
import os
import signal
import subprocess
import time
import unittest
from pathlib import Path

LSP_SERVER = (
    Path(__file__).resolve().parents[1]
    / "ha_opencode" / "rootfs" / "opt" / "ha-lsp-server" / "server.js"
)
NODE_MODULES = LSP_SERVER.parent / "node_modules" / "vscode-languageserver"
MISSING_DEPS = not NODE_MODULES.exists()

INITIALIZE = json.dumps({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "processId": None,
        "capabilities": {},
        "rootUri": "file:///homeassistant",
    },
})
CONTENT_LENGTH = f"Content-Length: {len(INITIALIZE)}\r\n\r\n"


@unittest.skipIf(MISSING_DEPS, "LSP server dependencies not installed")
class TestLSPServerStartup(unittest.TestCase):

    def setUp(self):
        self.proc = None

    def tearDown(self):
        if self.proc and self.proc.poll() is None:
            os.kill(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.kill(self.proc.pid, signal.SIGKILL)

    def test_server_starts_without_crashing(self):
        env = os.environ.copy()
        self.proc = subprocess.Popen(
            ["node", str(LSP_SERVER), "--stdio"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=env,
        )
        time.sleep(1)
        self.assertIsNone(self.proc.poll(),
            "LSP server should not crash on startup")


class TestLSPServerCrashHandlers(unittest.TestCase):
    def test_server_has_crash_handlers(self):
        text = LSP_SERVER.read_text()
        self.assertIn("unhandledRejection", text)
        self.assertIn("uncaughtException", text)


if __name__ == "__main__":
    unittest.main()
