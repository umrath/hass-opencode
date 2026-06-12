#!/usr/bin/env python3
"""Supervise the OpenCode terminal: proxy + dual ttyd backends.

Runs as the s6-supervised foreground process. Starts all three components
as subprocesses, monitors them, and exits non-zero if any child dies so s6
restarts the service cleanly.

Clean separation:
- The asyncio proxy binds the ingress port (8099) immediately
- ttyd backends start as subprocesses
- Signal forwarding: SIGTERM -> children -> exit 0
- Child death detection: any child exits -> kill all -> exit 1
"""
import os
import signal
import subprocess
import sys
import time

PROXY_PORT = os.environ.get("OC_PROXY_PORT", "8099")
DESKTOP_PORT = os.environ.get("OC_DESKTOP_PORT", "8098")
MOBILE_PORT = os.environ.get("OC_MOBILE_PORT", "8097")

TTYD_BIN = "/usr/bin/ttyd"
PROXY_SCRIPT = "/usr/share/oc-proxy/proxy.py"
SESSION_SCRIPT = "/usr/local/bin/opencode-session.sh"
TTYD_INDEX = "/opt/ttyd/index.html"
FONT_SIZE = os.environ.get("TTYD_FONT_SIZE", "14")
FONT_SIZE_MOBILE = os.environ.get("TTYD_FONT_SIZE_MOBILE", "16")
CURSOR_BLINK = os.environ.get("TTYD_CURSOR_BLINK", "false")
CURSOR_STYLE = os.environ.get("TTYD_CURSOR_STYLE", "block")
THEME_JSON = os.environ.get("TTYD_THEME", "{}")

children = []


def ttyd_args(port, font_size, shell_cmd):
    return [
        TTYD_BIN, "-W",
        "-p", port,
        "-i", "127.0.0.1",
        "-I", TTYD_INDEX,
        "-t", f"fontSize={font_size}",
        "-t", "fontWeight=normal",
        "-t", "fontWeightBold=bold",
        "-t", "letterSpacing=0",
        "-t", "lineHeight=1.0",
        "-t", f"cursorBlink={CURSOR_BLINK}",
        "-t", f"cursorStyle={CURSOR_STYLE}",
        "-t", "drawBoldTextInBrightColors=true",
        "-t", "minimumContrastRatio=4.5",
        "-t", "macOptionClickForcesSelection=true",
        "-t", "scrollback=5000",
        "-t", f"theme={THEME_JSON}",
        "bash", "-c", shell_cmd,
    ]


def start_ttyd(name, port, font_size, shell_cmd):
    proc = subprocess.Popen(
        ttyd_args(port, font_size, shell_cmd),
        stdout=sys.stderr, stderr=sys.stderr,
    )
    children.append(proc)
    print(f"[supervisor] {name} ttyd started on port {port} (pid {proc.pid})", flush=True)
    return proc


def handle_signal(signum, frame):
    print(f"[supervisor] received signal {signum}, stopping children", flush=True)
    for c in children:
        try:
            c.terminate()
        except Exception:
            pass
    sys.exit(0)


def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    # Start desktop ttyd (tmux)
    desktop_cmd = f"cd /homeassistant && tmux new-session -A -s opencode {SESSION_SCRIPT}"
    start_ttyd("desktop", DESKTOP_PORT, FONT_SIZE, desktop_cmd)

    # Start mobile ttyd (no tmux)
    mobile_cmd = f"cd /homeassistant && {SESSION_SCRIPT}"
    start_ttyd("mobile", MOBILE_PORT, FONT_SIZE_MOBILE, mobile_cmd)

    # Wait a moment for ttyd to bind, then start the proxy as foreground process
    time.sleep(1)

    print(f"[supervisor] starting proxy on 0.0.0.0:{PROXY_PORT}", flush=True)

    # Proxy runs in foreground. When it exits, we exit too.
    # Use subprocess.run instead of exec so we can still handle signals.
    proxy_proc = subprocess.Popen(
        [sys.executable, PROXY_SCRIPT],
        stdout=sys.stderr, stderr=sys.stderr,
        env=os.environ,
    )
    children.append(proxy_proc)

    # Monitor all children. If proxy dies first, tear down.
    # s6 handles SIGTERM via the signal handler above.
    while True:
        for i, c in enumerate(children):
            if c.poll() is not None:
                name = ["desktop ttyd", "mobile ttyd", "proxy"][i]
                print(f"[supervisor] {name} (pid {c.pid}) exited with code {c.returncode}", flush=True)
                for other in children:
                    try:
                        other.terminate()
                    except Exception:
                        pass
                for other in children:
                    try:
                        other.wait(timeout=5)
                    except Exception:
                        other.kill()
                sys.exit(1)
        time.sleep(2)


if __name__ == "__main__":
    main()
