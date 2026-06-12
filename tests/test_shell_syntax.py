"""Comprehensive shell syntax validation for ALL project shell scripts.

Catches syntax errors BEFORE they reach CI or production.
Every script that passes `bash -n` here is guaranteed to parse correctly.
"""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SHELL_SCRIPTS = [
    # s6 service scripts
    "ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/ha-opencode-desktop/run",
    "ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/ha-opencode-mobile/run",
    "ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/ha-opencode-proxy/run",
    "ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/ha-opencode-server/run",
    "ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/init-opencode/run",
    "ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/ppq-private-proxy/run",
    # profile scripts
    "ha_opencode/rootfs/etc/profile.d/hab-esphome.sh",
    "ha_opencode/rootfs/etc/profile.d/opencode-theme.sh",
    "ha_opencode/rootfs/etc/profile.d/zigporter-z2m.sh",
    # CLI tools
    "ha_opencode/rootfs/usr/local/bin/ha-logs",
    "ha_opencode/rootfs/usr/local/bin/ha-mcp",
    "ha_opencode/rootfs/usr/local/bin/opencode-session.sh",
    # CI scripts
    "ci/buildhost/build-base.sh",
    "ci/buildhost/build-image.sh",
    "ci/buildhost/install.sh",
    "ci/buildhost/run-ci.sh",
    "ci/version-bump.sh",
    "ci/run.sh",
    "ci/lib.sh",
    # CI checks
    "ci/checks/22-changelog-content.sh",
]


def generate_test(script_path):
    def test(self):
        full = ROOT / script_path
        if not full.exists():
            self.skipTest(f"{script_path} not found")
        result = subprocess.run(["bash", "-n", str(full)], capture_output=True)
        self.assertEqual(result.returncode, 0,
            f"{script_path} has shell syntax error:\n{result.stderr.decode()}")

    test.__name__ = f"test_{script_path.replace('/', '_').replace('.', '_')}"
    test.__doc__ = f"bash -n on {script_path}"
    return test


class TestShellSyntax(unittest.TestCase):
    pass


for path in SHELL_SCRIPTS:
    setattr(TestShellSyntax, f"test_{path.replace('/', '_').replace('.', '_')}",
            generate_test(path))


if __name__ == "__main__":
    unittest.main()
