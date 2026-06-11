"""Tests for the add-on translation files.

The key contract is parity: every user option in config.yaml must have a
matching entry under `configuration:` in each shipped translation, with a name
and a description. This catches the common bug of adding an option without a
UI label (it then renders as a raw slug).

Only `en` is required today. Additional languages (es, pt-BR) are a known gap
(M3); when added they are picked up automatically and validated for parity.
"""

import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
ADDONS = ("ha_opencode", "ha_opencode_beta")
REQUIRED_LANGS = ("en",)


def options_of(addon):
    cfg = yaml.safe_load((REPO_ROOT / addon / "config.yaml").read_text())
    return set(cfg["options"])


def translation_files(addon):
    return sorted((REPO_ROOT / addon / "translations").glob("*.yaml"))


class TestTranslations(unittest.TestCase):
    def test_required_languages_present(self):
        for addon in ADDONS:
            present = {p.stem for p in translation_files(addon)}
            for lang in REQUIRED_LANGS:
                self.assertIn(lang, present, f"{addon}: missing {lang}.yaml")

    def test_all_translations_parse_and_have_configuration(self):
        for addon in ADDONS:
            for path in translation_files(addon):
                cfg = yaml.safe_load(path.read_text())
                self.assertIsInstance(cfg, dict, f"{path} is not a dict")
                self.assertIn("configuration", cfg, f"{path} missing configuration:")

    def test_configuration_keys_match_options(self):
        for addon in ADDONS:
            opts = options_of(addon)
            for path in translation_files(addon):
                with self.subTest(addon=addon, lang=path.stem):
                    cfg = yaml.safe_load(path.read_text())
                    trans = set(cfg["configuration"])
                    self.assertEqual(opts, trans,
                        f"{path.name}: only in config: {sorted(opts - trans)}; "
                        f"only in translation: {sorted(trans - opts)}")

    def test_each_entry_has_name_and_description(self):
        for addon in ADDONS:
            for path in translation_files(addon):
                cfg = yaml.safe_load(path.read_text())
                for key, entry in cfg["configuration"].items():
                    self.assertIsInstance(entry, dict,
                        f"{path.name}:{key} must be a mapping")
                    self.assertTrue(entry.get("name"),
                        f"{path.name}:{key} missing name")
                    self.assertTrue(entry.get("description"),
                        f"{path.name}:{key} missing description")


if __name__ == "__main__":
    unittest.main()
