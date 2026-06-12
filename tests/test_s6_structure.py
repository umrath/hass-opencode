"""Tests for the s6-overlay service wiring under ha_opencode/rootfs.

Catches the common s6-rc mistakes: a service with no `type`, a longrun with no
`run`, a oneshot with neither `up` nor `run`, and a user/contents.d entry that
points at a non-existent service (which makes the container fail to boot).
"""

import unittest
from pathlib import Path

S6_ROOT = Path(__file__).resolve().parents[1] / "ha_opencode" / "rootfs" / "etc" / "s6-overlay" / "s6-rc.d"


def service_dirs():
    if not S6_ROOT.exists():
        return []
    return [d for d in S6_ROOT.iterdir()
            if d.is_dir() and d.name != "user"]


class TestS6Structure(unittest.TestCase):
    def test_s6_root_exists(self):
        self.assertTrue(S6_ROOT.exists(), f"{S6_ROOT} must exist")

    def test_every_service_has_a_type(self):
        for d in service_dirs():
            self.assertTrue((d / "type").exists(),
                f"s6 service {d.name} missing a 'type' file")

    def test_type_values_are_known(self):
        for d in service_dirs():
            t = (d / "type").read_text().strip()
            self.assertIn(t, ("longrun", "oneshot", "bundle"),
                f"s6 service {d.name} has unknown type {t!r}")

    def test_longrun_services_have_run(self):
        for d in service_dirs():
            if (d / "type").read_text().strip() == "longrun":
                run = d / "run"
                self.assertTrue(run.exists(), f"longrun {d.name} missing 'run'")
                self.assertGreater(len(run.read_text().strip()), 0,
                    f"longrun {d.name}/run is empty")

    def test_oneshot_services_have_up_or_run(self):
        for d in service_dirs():
            if (d / "type").read_text().strip() == "oneshot":
                self.assertTrue((d / "up").exists() or (d / "run").exists(),
                    f"oneshot {d.name} needs an 'up' or 'run'")

    def test_user_contents_reference_existing_services(self):
        contents = S6_ROOT / "user" / "contents.d"
        self.assertTrue(contents.exists(), "user/contents.d must exist")
        names = {d.name for d in service_dirs()}
        for entry in contents.iterdir():
            self.assertIn(entry.name, names,
                f"user/contents.d/{entry.name} references a missing service")

    # s6-overlay ships virtual/bundle targets that are not service dirs in our
    # tree (e.g. the 'base' bundle every service may depend on). Allow those;
    # any other dependency must resolve to one of our own services.
    S6_VIRTUAL = {"base"}

    def test_dependency_targets_exist(self):
        names = {d.name for d in service_dirs()}
        for d in service_dirs():
            deps = d / "dependencies.d"
            if not deps.exists():
                continue
            for dep in deps.iterdir():
                if dep.name in self.S6_VIRTUAL:
                    continue
                self.assertIn(dep.name, names,
                    f"{d.name} depends on missing service {dep.name}")


class TestNewTerminalServices(unittest.TestCase):
    """Specific tests for the refactored three-service terminal architecture."""

    @classmethod
    def setUpClass(cls):
        cls.proxy_run = S6_ROOT / "ha-opencode-proxy" / "run"
        cls.desktop_run = S6_ROOT / "ha-opencode-desktop" / "run"
        cls.mobile_run = S6_ROOT / "ha-opencode-mobile" / "run"
        cls.ha_type = S6_ROOT / "ha-opencode" / "type"
        cls.ha_contents = S6_ROOT / "ha-opencode" / "contents.d"

    def test_ha_opencode_is_bundle(self):
        self.assertEqual(self.ha_type.read_text().strip(), "bundle",
            "ha-opencode must be a bundle type")

    def test_ha_opencode_contents_correct(self):
        expected = {"ha-opencode-proxy", "ha-opencode-desktop", "ha-opencode-mobile"}
        actual = {e.name for e in self.ha_contents.iterdir()} if self.ha_contents.exists() else set()
        self.assertEqual(actual, expected,
            f"ha-opencode/contents.d must contain exactly {expected}")

    def _read(self, path):
        return path.read_text() if path.exists() else ""

    def test_proxy_run_has_mobile_proxy_branch(self):
        text = self._read(self.proxy_run)
        self.assertIn("mobile_proxy_enabled", text)
        self.assertIn("proxy.py", text)
        self.assertIn("sleep infinity", text)

    def test_desktop_run_has_ttyd_with_tmux(self):
        text = self._read(self.desktop_run)
        self.assertIn("mobile_proxy_enabled", text)
        self.assertIn("ttyd", text)
        self.assertIn("tmux", text)

    def test_mobile_run_has_ttyd_no_tmux(self):
        text = self._read(self.mobile_run)
        self.assertIn("mobile_proxy_enabled", text)
        self.assertIn("ttyd", text)
        self.assertNotIn("tmux", text,
            "mobile run must not use tmux")

    def test_old_run_script_removed(self):
        old_run = S6_ROOT / "ha-opencode" / "run"
        self.assertFalse(old_run.exists(),
            "old ha-opencode/run must be removed (replaced by bundle + sub-services)")

    def test_old_finish_script_removed(self):
        old_finish = S6_ROOT / "ha-opencode" / "finish"
        self.assertFalse(old_finish.exists(),
            "old ha-opencode/finish must be removed")

    def test_proxy_has_no_init_dependency(self):
        """Proxy must start immediately — no deps. HA Supervisor checks port 8099 at boot."""
        deps = S6_ROOT / "ha-opencode-proxy" / "dependencies.d"
        names = {d.name for d in deps.iterdir()} if deps.exists() else set()
        self.assertNotIn("init-opencode", names,
            "proxy must not depend on init-opencode (must bind before init runs)")

    def test_desktop_depends_on_proxy_and_init(self):
        deps = S6_ROOT / "ha-opencode-desktop" / "dependencies.d"
        names = {d.name for d in deps.iterdir()} if deps.exists() else set()
        self.assertIn("ha-opencode-proxy", names)
        self.assertIn("init-opencode", names)

    def test_mobile_depends_on_proxy_and_init(self):
        deps = S6_ROOT / "ha-opencode-mobile" / "dependencies.d"
        names = {d.name for d in deps.iterdir()} if deps.exists() else set()
        self.assertIn("ha-opencode-proxy", names)
        self.assertIn("init-opencode", names)


if __name__ == "__main__":
    unittest.main()
