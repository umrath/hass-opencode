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


if __name__ == "__main__":
    unittest.main()
