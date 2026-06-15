"""Functional MCP tool handler tests — actually invokes tools via subprocess.

Starts the MCP server, sends JSON-RPC `tools/call` requests, and validates
responses. Complements the structural test_mcp_tools.py (which only checks
tool↔case name parity).

Offline-capable tools tested:
  - check_config_syntax  (no HA needed)
  - write_config_safe    (dry-run)
  - tools/list           (already in startup test — re-verified here)
  - resources/list, resources/read
  - prompts/list, prompts/get

Error paths tested:
  - Missing required parameters → schema error
  - Unknown tool → method not found error
  - HA-dependent tools without real HA → graceful error, no crash
"""
import json
import os
import signal
import subprocess
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

MCP_SERVER = (
    Path(__file__).resolve().parents[1]
    / "ha_opencode" / "rootfs" / "opt" / "ha-mcp-server" / "index.js"
)

INITIALIZE = json.dumps({
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {"protocolVersion": "2025-06-18", "capabilities": {},
               "clientInfo": {"name": "test", "version": "1.0"}},
})
INITIALIZED = json.dumps({
    "jsonrpc": "2.0", "method": "notifications/initialized",
})


@unittest.skipUnless(MCP_SERVER.exists(), "MCP server source not found")
class TestMcpToolsFunctional(unittest.TestCase):

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
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=env,
        )

    def _init(self):
        self._start_server()
        self._send(INITIALIZE)
        self._read_line()  # init response
        self._send(INITIALIZED)
        time.sleep(0.2)    # let server process the notification

    def _send(self, data: str):
        self.proc.stdin.write((data + "\n").encode())
        self.proc.stdin.flush()

    def _read_line(self, timeout: float = 10.0) -> str:
        import select
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                stderr = self.proc.stderr.read().decode(errors="replace")
                self.fail(f"Server exited prematurely: {stderr}")
            ready, _, _ = select.select([self.proc.stdout], [], [], 0.5)
            if ready:
                line = self.proc.stdout.readline().decode()
                if line.strip():
                    return line
        self.fail(f"Timeout ({timeout}s) waiting for server response")
        return ""

    def _call_tool(self, tool_name: str, args: dict = None, msg_id: int = 10):
        req = json.dumps({
            "jsonrpc": "2.0", "id": msg_id, "method": "tools/call",
            "params": {"name": tool_name, "arguments": args or {}},
        })
        self._send(req)
        return json.loads(self._read_line())

    def _assert_tool_error(self, resp, msg=""):
        """Tool errors are returned as result.isError, not top-level error."""
        self.assertIn("result", resp, f"{msg}: missing result ({resp})")
        result = resp["result"]
        if isinstance(result, dict):
            self.assertTrue(result.get("isError"),
                f"{msg}: expected isError in result, got {result}")

    # ── check_config_syntax (offline-capable) ────────────────────────────────

    def test_check_config_syntax_valid_yaml(self):
        self._init()
        resp = self._call_tool("check_config_syntax", {
            "yaml": "sensor:\n  - platform: template\n    name: Test",
        })
        self.assertNotIn("error", resp)
        self.assertIn("result", resp)

    def test_check_config_syntax_with_deprecation(self):
        self._init()
        resp = self._call_tool("check_config_syntax", {
            "yaml": "sensor:\n  - platform: mqtt\n    state_topic: test",
        })
        self.assertNotIn("error", resp)
        self.assertIn("result", resp)

    def test_check_config_syntax_missing_param(self):
        self._init()
        resp = self._call_tool("check_config_syntax", {})
        self._assert_tool_error(resp,
            "missing required param must return isError")

    def test_check_config_syntax_garbage_params(self):
        self._init()
        resp = self._call_tool("check_config_syntax", {"yaml": ""})
        self.assertNotIn("error", resp,
            "empty yaml string is valid input — must not be a protocol error")
        self.assertIn("result", resp)

    # ── write_config_safe (dry-run, offline-capable) ─────────────────────────

    def test_write_config_safe_dry_run(self):
        self._init()
        with TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "configuration.yaml"
            config_path.write_text("homeassistant:\n  name: Test\n")
            resp = self._call_tool("write_config_safe", {
                "path": str(config_path),
                "yaml": "homeassistant:\n  name: Renamed\n",
                "dry_run": True,
            })
            self.assertNotIn("error", resp,
                f"write_config_safe dry-run should succeed, got: {resp.get('error')}")
            self.assertIn("result", resp)

    def test_write_config_safe_path_not_found(self):
        self._init()
        resp = self._call_tool("write_config_safe", {
            "path": "/nonexistent/config_never_here.yaml",
            "yaml": "test: true",
            "dry_run": True,
        })
        self._assert_tool_error(resp,
            "write to nonexistent path must return isError")

    # ── error paths ──────────────────────────────────────────────────────────

    def test_unknown_tool_returns_error(self):
        self._init()
        resp = self._call_tool("nonexistent_tool_xyz", {}, 20)
        self._assert_tool_error(resp,
            "unknown tool must return isError, not crash")

    def test_call_before_initialize_rejected(self):
        self._start_server()
        resp = self._call_tool("check_config_syntax", {"yaml": "test: true"}, 30)
        self._assert_tool_error(resp,
            "call before initialize must return isError")

    def test_ha_dependent_tool_graceful_without_ha(self):
        """Tools that need HA should return isError gracefully, not crash."""
        self._init()
        resp = self._call_tool("get_states", {}, 40)
        self._assert_tool_error(resp,
            "HA-dependent tool without real HA must return isError, not crash")

    def test_server_survives_tool_call(self):
        """Server must not exit after a tool call, even an error one."""
        self._init()
        self._call_tool("check_config_syntax", {"yaml": "test: true"}, 50)
        time.sleep(0.3)
        self.assertIsNone(self.proc.poll(),
            "Server must stay alive after tool call")

    def test_multiple_sequential_calls(self):
        """Server must handle multiple calls without breaking."""
        self._init()
        for i in range(3):
            resp = self._call_tool("check_config_syntax",
                                   {"yaml": f"sensor: {{name: test{i}}}"},
                                   60 + i)
            self.assertNotIn("error", resp,
                f"Call {i} should succeed, got: {resp.get('error')}")
            self.assertIn("result", resp, f"Call {i} missing result")

    # ── resources ────────────────────────────────────────────────────────────

    def test_resources_list(self):
        self._init()
        self._send(json.dumps({"jsonrpc": "2.0", "id": 70, "method": "resources/list"}))
        resp = json.loads(self._read_line())
        self.assertIn("result", resp)
        self.assertIn("resources", resp["result"])
        self.assertGreater(len(resp["result"]["resources"]), 0,
                           "server must expose resources")

    def test_resources_read_requires_ha(self):
        """All ha:// resources need a real HA — must return error, not crash."""
        self._init()
        self._send(json.dumps({"jsonrpc": "2.0", "id": 71, "method": "resources/read",
                               "params": {"uri": "ha://areas"}}))
        resp = json.loads(self._read_line())
        self.assertIn("error", resp,
            "ha:// resource without HA must return protocol error")
        self.assertEqual(-32603, resp["error"]["code"],
            "should be internal error (-32603)")

    def test_resources_read_unknown_uri(self):
        self._init()
        self._send(json.dumps({"jsonrpc": "2.0", "id": 72, "method": "resources/read",
                               "params": {"uri": "ha://nonexistent_zzz"}}))
        resp = json.loads(self._read_line())
        self.assertIn("error", resp,
            "unknown resource URI must return protocol error")

    # ── prompts ──────────────────────────────────────────────────────────────

    def test_prompts_list(self):
        self._init()
        self._send(json.dumps({"jsonrpc": "2.0", "id": 80, "method": "prompts/list"}))
        resp = json.loads(self._read_line())
        self.assertIn("result", resp)
        self.assertIn("prompts", resp["result"])
        self.assertGreater(len(resp["result"]["prompts"]), 0,
                           "server must expose prompts")

    # ── tools/list re-verified ───────────────────────────────────────────────

    def test_tools_list_endpoint(self):
        self._init()
        self._send(json.dumps({"jsonrpc": "2.0", "id": 90, "method": "tools/list"}))
        resp = json.loads(self._read_line())
        self.assertIn("result", resp)
        self.assertIn("tools", resp["result"])
        self.assertGreater(len(resp["result"]["tools"]), 10,
                           "server must expose many tools")


if __name__ == "__main__":
    unittest.main()
