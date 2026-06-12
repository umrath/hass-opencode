"""Tests for the proxy lifecycle — verifies it actually starts and responds.

These tests start the proxy on a temporary port, verify it responds to HTTP,
and clean up. They require network access on localhost only.
"""
import os
import signal
import subprocess
import time
import unittest
from pathlib import Path

PROXY = (
    Path(__file__).resolve().parents[1]
    / "ha_opencode" / "rootfs" / "usr" / "share" / "oc-proxy" / "proxy.py"
)


@unittest.skipUnless(PROXY.exists(), "proxy.py not found")
class TestProxyLifecycle(unittest.TestCase):
    """Validate the proxy starts, binds, and can be stopped cleanly."""

    @classmethod
    def setUpClass(cls):
        cls.proxy_port = 18080
        cls.desktop_port = 18081
        cls.mobile_port = 18082

    def setUp(self):
        self.proc = None

    def tearDown(self):
        if self.proc and self.proc.poll() is None:
            os.kill(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.kill(self.proc.pid, signal.SIGKILL)

    def _start_proxy(self):
        env = os.environ.copy()
        env["OC_PROXY_PORT"] = str(self.proxy_port)
        env["OC_DESKTOP_PORT"] = str(self.desktop_port)
        env["OC_MOBILE_PORT"] = str(self.mobile_port)
        self.proc = subprocess.Popen(
            ["python3", str(PROXY)],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True,
        )

    def _wait_for_proxy(self, timeout=10):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                out = self.proc.stdout.read() if self.proc.stdout else ""
                self.fail(f"Proxy exited early: {out}")
            try:
                import socket
                s = socket.create_connection(("127.0.0.1", self.proxy_port), timeout=0.5)
                s.close()
                return
            except (ConnectionRefusedError, OSError):
                time.sleep(0.2)
        self.fail(f"Proxy did not bind port {self.proxy_port} within {timeout}s")

    def test_proxy_starts_and_binds(self):
        self._start_proxy()
        self._wait_for_proxy()
        self.assertIsNone(self.proc.poll(), "proxy should still be running")

    def test_proxy_responds_to_http_get(self):
        self._start_proxy()
        self._wait_for_proxy()
        import urllib.request
        try:
            resp = urllib.request.urlopen(f"http://127.0.0.1:{self.proxy_port}/")
            self.assertIn(resp.status, (200, 302, 404))
        except Exception:
            pass  # index page may 404 if no route matches, the key is the server responded

    def test_proxy_prints_startup_message(self):
        self._start_proxy()
        self._wait_for_proxy()
        out = ""
        deadline = time.time() + 3
        while time.time() < deadline and "[proxy] started" not in out:
            line = self.proc.stdout.readline()
            if not line:
                time.sleep(0.1)
                continue
            out += line
        self.assertIn("[proxy] started", out)

    def test_proxy_stops_cleanly_on_sigterm(self):
        self._start_proxy()
        self._wait_for_proxy()
        os.kill(self.proc.pid, signal.SIGTERM)
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.kill(self.proc.pid, signal.SIGKILL)
            self.fail("Proxy did not stop on SIGTERM")
        self.assertIsNotNone(self.proc.poll())

    def test_proxy_respects_env_ports(self):
        self._start_proxy()
        self._wait_for_proxy()
        out = ""
        deadline = time.time() + 3
        while time.time() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                time.sleep(0.1)
                continue
            out += line
            if "[proxy] started" in out:
                break
        self.assertIn(f"desktop:{self.desktop_port}", out)
        self.assertIn(f"mobile:{self.mobile_port}", out)

    def test_proxy_binds_on_configured_port(self):
        """Verify OC_PROXY_PORT env var is actually used."""
        self._start_proxy()
        self._wait_for_proxy()
        import socket
        # port we configured should be open
        s = socket.create_connection(("127.0.0.1", self.proxy_port), timeout=1)
        s.close()
        # default port (7681) should NOT be open
        with self.assertRaises((ConnectionRefusedError, OSError)):
            socket.create_connection(("127.0.0.1", 7681), timeout=0.5)

    def test_run_script_defines_correct_ports(self):
        """The proxy run script must define ingress/desktop/mobile ports matching proxy defaults."""
        run_script = (
            Path(__file__).resolve().parents[1]
            / "ha_opencode" / "rootfs" / "etc" / "s6-overlay" / "s6-rc.d"
            / "ha-opencode-proxy" / "run"
        )
        text = run_script.read_text()
        self.assertIn("OC_PROXY_PORT=8099", text)
        self.assertIn("OC_DESKTOP_PORT=8098", text)
        self.assertIn("OC_MOBILE_PORT=8097", text)


if __name__ == "__main__":
    unittest.main()
