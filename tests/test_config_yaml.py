"""Structural and invariant tests for the app config.yaml files.

Oriented on ../hass-opencode's test suite, but every assertion reflects *this*
repo's own contracts (ingress_port 8099, slug ha_opencode, s6 via init:false,
the OpenCode feature set) — not the Codeberg variant's choices. Tests that
would assert not-yet-adopted gaps (llm_model, ssl/share maps, tmpfs, …) are
deliberately omitted; those are future features, not regressions.
"""

import re
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
STABLE = REPO_ROOT / "ha_opencode" / "config.yaml"
BETA = REPO_ROOT / "ha_opencode_beta" / "config.yaml"

# Scalar schema atoms HA Supervisor understands (base form, before an optional
# trailing "?"). Parameterised forms like int(a,b) / list(a|b) / device(...) are
# validated separately.
_SCALAR_ATOMS = {"bool", "str", "int", "float", "email", "url", "port", "password"}
_PARAM_RE = re.compile(r"^(int|float|list|match|device)\(.*\)\??$")


def load(path):
    return yaml.safe_load(path.read_text())


def schema_value_ok(val):
    """Recursively validate a single schema value."""
    if isinstance(val, list):
        return all(schema_value_ok(v) for v in val)
    if isinstance(val, dict):
        return all(schema_value_ok(v) for v in val.values())
    if not isinstance(val, str):
        return False
    base = val[:-1] if val.endswith("?") else val
    if base in _SCALAR_ATOMS:
        return True
    return bool(_PARAM_RE.match(val))


def list_choices(schema_str):
    """Return the choices from a list(a|b|c) schema string, or []."""
    m = re.match(r"^list\((.*)\)\??$", schema_str)
    return m.group(1).split("|") if m else []


class _CommonConfigInvariants:
    """Mixin: invariants every app config.yaml must satisfy.

    Subclasses set cls.PATH and cls.EXPECTED_SLUG.
    """

    PATH = None
    EXPECTED_SLUG = None

    @classmethod
    def setUpClass(cls):
        cls.cfg = load(cls.PATH)

    def test_exists(self):
        self.assertTrue(self.PATH.exists(), f"{self.PATH} must exist")

    def test_parses_to_dict(self):
        self.assertIsInstance(self.cfg, dict)

    def test_required_keys(self):
        for key in ("name", "description", "version", "slug", "image", "url",
                    "arch", "init", "ingress", "ingress_port"):
            self.assertIn(key, self.cfg, f"missing required key: {key}")

    def test_slug(self):
        self.assertEqual(self.cfg["slug"], self.EXPECTED_SLUG)

    def test_image_ends_with_slug(self):
        self.assertTrue(self.cfg["image"].endswith(self.cfg["slug"]),
            f"image {self.cfg['image']!r} should end with slug {self.cfg['slug']!r}")

    def test_version_is_semver_string(self):
        self.assertIsInstance(self.cfg["version"], str)
        self.assertRegex(self.cfg["version"], r"^\d+\.\d+",
            "version must look like a semantic version string")

    def test_arch_supported(self):
        self.assertIsInstance(self.cfg["arch"], list)
        self.assertTrue(self.cfg["arch"])
        for a in self.cfg["arch"]:
            self.assertIn(a, ("amd64", "aarch64"), f"unsupported arch: {a}")

    def test_init_false_for_s6(self):
        # The HA Debian base image ships s6-overlay as PID 1, so the app
        # must NOT request its own init.
        self.assertFalse(self.cfg["init"], "init must be false (s6-overlay base image)")

    def test_ingress(self):
        self.assertTrue(self.cfg["ingress"])
        self.assertTrue(self.cfg["ingress_stream"])
        self.assertEqual(self.cfg["ingress_port"], 8099)

    def test_panel_title_mentions_opencode(self):
        self.assertIn("OpenCode", self.cfg.get("panel_title", ""))

    def test_options_and_schema_keys_match(self):
        self.assertIn("options", self.cfg)
        self.assertIn("schema", self.cfg)
        opts, schema = set(self.cfg["options"]), set(self.cfg["schema"])
        self.assertEqual(opts, schema,
            f"only in options: {sorted(opts - schema)}; "
            f"only in schema: {sorted(schema - opts)}")

    def test_schema_value_types_valid(self):
        for key, val in self.cfg["schema"].items():
            self.assertTrue(schema_value_ok(val),
                f"schema[{key}] has an invalid type spec: {val!r}")

    def test_secret_fields_are_password_type(self):
        schema = self.cfg["schema"]
        for secret in ("ppq_api_key", "access_token"):
            if secret in schema:
                self.assertEqual(schema[secret], "password",
                    f"{secret} must use the masked 'password' schema type")

    def test_list_defaults_are_valid_choices(self):
        # Every list(...) option's default must be one of its declared choices.
        for key, spec in self.cfg["schema"].items():
            if isinstance(spec, str) and spec.startswith("list("):
                choices = list_choices(spec)
                default = self.cfg["options"].get(key)
                self.assertIn(default, choices,
                    f"options[{key}]={default!r} not in {choices}")

    def test_backup_exclude_present(self):
        self.assertIn("backup_exclude", self.cfg,
            "backup_exclude must keep caches out of HA backups")
        self.assertIsInstance(self.cfg["backup_exclude"], list)
        self.assertTrue(self.cfg["backup_exclude"])


class TestStableConfig(_CommonConfigInvariants, unittest.TestCase):
    PATH = STABLE
    EXPECTED_SLUG = "ha_opencode"

    def test_image_and_url_are_umrath(self):
        self.assertIn("umrath/ha_opencode", self.cfg["image"])
        self.assertIn("github.com/umrath", self.cfg["url"])

    def test_panel_icon(self):
        self.assertEqual(self.cfg["panel_icon"], "mdi:robot")

    def test_ha_api_permissions(self):
        self.assertTrue(self.cfg["homeassistant_api"])
        self.assertTrue(self.cfg["hassio_api"])
        self.assertEqual(self.cfg["hassio_role"], "manager")

    def test_security_posture(self):
        self.assertFalse(self.cfg["host_network"])
        self.assertEqual(self.cfg.get("privileged", []), [])
        self.assertTrue(self.cfg["apparmor"], "apparmor must be enabled")
        self.assertTrue(self.cfg.get("tmpfs", False),
            "tmpfs must be enabled — /tmp is a RAM disk to prevent flash wear")

    def test_only_lan_server_port_is_declared(self):
        # The PPQ proxy binds 127.0.0.1 only and must never be a mapped port;
        # the single declared port is the opt-in LAN server (4096/tcp).
        ports = self.cfg.get("ports") or {}
        self.assertEqual(set(ports), {"4096/tcp"},
            f"unexpected mapped ports: {set(ports) - {'4096/tcp'}}")

    def test_core_feature_defaults(self):
        opts = self.cfg["options"]
        self.assertTrue(opts["mcp_enabled"])
        self.assertTrue(opts["lsp_enabled"])
        self.assertEqual(opts["font_size"], 14)

    def test_opencode_update_policy_default(self):
        policy = self.cfg.get("options", {}).get("opencode_update_policy")
        self.assertIsNotNone(policy, "opencode_update_policy option is required")
        docs_path = REPO_ROOT / self.PATH / "DOCS.md"
        if not docs_path.exists():
            return
        docs_text = docs_path.read_text()
        # Normalise: strip formatting, collapse whitespace
        flat = " ".join(
            docs_text.replace("**", "").replace("`", "").replace("\n", " ").split()
        )
        pat = r"\bdefault\b.*\b" + re.escape(policy) + r"\b"
        self.assertTrue(re.search(pat, flat),
            f"{self.PATH}/DOCS.md 'default' must refer to '{policy}', "
            f"not the other policy value")

    def test_beta_only_options_absent(self):
        # Sanity that stable doesn't accidentally inherit a beta-flagged toggle.
        self.assertIn("mobile_proxy_enabled", self.cfg["options"])

    def test_secret_defaults_empty(self):
        self.assertEqual(self.cfg["options"]["ppq_api_key"], "")
        self.assertEqual(self.cfg["options"]["access_token"], "")


class TestBetaConfig(_CommonConfigInvariants, unittest.TestCase):
    # Beta is config-only (no Dockerfile/rootfs) and its image/url are rewritten
    # by the release workflow, so only structural invariants are asserted here.
    PATH = BETA
    EXPECTED_SLUG = "ha_opencode_beta"

    def test_version_has_beta_suffix(self):
        self.assertRegex(self.cfg["version"], r"b\d+$",
            "beta version should carry a bN pre-release suffix")


if __name__ == "__main__":
    unittest.main()
