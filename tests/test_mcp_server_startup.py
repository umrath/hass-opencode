"""Tests for MCP server startup and basic protocol handling.

Starts the MCP server as a subprocess, sends MCP initialize/handshake,
and verifies the server responds correctly without crashing. Catches
the recurring "-32000: connection closed" errors at test time.
"""
import json
import os
import signal
import subprocess
import time
import unittest
from pathlib import Path

MCP_SERVER = (
    Path(__file__).resolve().parents[1]
    / "ha_opencode" / "rootfs" / "opt" / "ha-mcp-server" / "index.js"
)

# Minimal MCP JSON-RPC messages
INITIALIZE = json.dumps({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1.0"},
    },
})

INITIALIZED = json.dumps({
    "jsonrpc": "2.0",
    "method": "notifications/initialized",
})

LIST_TOOLS = json.dumps({
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
})


@unittest.skipUnless(MCP_SERVER.exists(), "MCP server source not found")
class TestMCPServerStartup(unittest.TestCase):

    def setUp(self):
        self.proc = None

    def tearDown(self):
        if self.proc and self.proc.poll() is None:
            os.kill(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.kill(self.proc.pid, signal.SIGKILL)

    def _start_server(self):
        env = os.environ.copy()
        env["SUPERVISOR_TOKEN"] = "test-token-for-unit-test"
        self.proc = subprocess.Popen(
            ["node", str(MCP_SERVER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

    def _send(self, data: str):
        self.proc.stdin.write((data + "\n").encode())
        self.proc.stdin.flush()

    def _read_line(self, timeout: float = 5.0) -> str:
        import select
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                stderr = self.proc.stderr.read().decode(errors="replace")
                self.fail(f"Server exited: {stderr}")
            ready, _, _ = select.select([self.proc.stdout], [], [], 0.5)
            if ready:
                return self.proc.stdout.readline().decode()
        self.fail("Timeout waiting for server response")
        return ""

    def test_server_starts_and_responds_to_initialize(self):
        self._start_server()
        self._send(INITIALIZE)
        response = self._read_line()
        data = json.loads(response)
        self.assertEqual(data.get("id"), 1)
        self.assertIn("result", data)
        self.assertIn("serverInfo", data["result"])

    def test_server_handles_initialized_notification(self):
        self._start_server()
        self._send(INITIALIZE)
        self._read_line()  # consume init response
        self._send(INITIALIZED)
        self._send(LIST_TOOLS)
        response = self._read_line()
        data = json.loads(response)
        self.assertEqual(data.get("id"), 2)
        self.assertIn("result", data)
        self.assertIn("tools", data["result"])
        self.assertGreater(len(data["result"]["tools"]), 0)

    def test_server_does_not_exit_with_valid_token(self):
        self._start_server()
        self._send(INITIALIZE)
        self._read_line()
        time.sleep(1)
        self.assertIsNone(self.proc.poll(),
            "Server should not exit when SUPERVISOR_TOKEN is set")

    def test_server_rejects_missing_token(self):
        env = os.environ.copy()
        # no SUPERVISOR_TOKEN
        proc = subprocess.Popen(
            ["node", str(MCP_SERVER)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=env,
        )
        try:
            proc.stdin.write((INITIALIZE + "\n").encode())
            proc.stdin.flush()
            time.sleep(1)
            # Server stays alive but logs error (our fix: no process.exit)
            self.assertIsNone(proc.poll(),
                "Server should stay alive even without token")
        finally:
            if proc.poll() is None:
                os.kill(proc.pid, signal.SIGTERM)
            proc.wait(timeout=3)


if __name__ == "__main__":
    unittest.main()
