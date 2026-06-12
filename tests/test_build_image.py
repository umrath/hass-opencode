"""Tests for the decoupled image build script."""
import unittest
from pathlib import Path

BUILD_IMAGE = (
    Path(__file__).resolve().parents[1] / "ci" / "buildhost" / "build-image.sh"
)


class TestBuildImageScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = BUILD_IMAGE.read_text() if BUILD_IMAGE.exists() else ""

    def test_exists_and_substantial(self):
        self.assertTrue(BUILD_IMAGE.exists())
        self.assertGreater(len(self.text), 500)

    def test_builds_amd64_first(self):
        self.assertIn("building amd64", self.text.lower())

    def test_arm64_is_background(self):
        self.assertIn("arm64 build detached", self.text)

    def test_arm64_has_state_tracking(self):
        self.assertIn("ARM_STATE", self.text)
        self.assertIn("arm64-pending", self.text)

    def test_multi_arch_manifest_created(self):
        self.assertIn("imagetools create", self.text)

    def test_uses_cache(self):
        self.assertIn("cache-from", self.text)
        self.assertIn("cache-to", self.text)

    def test_pushes_amd64_immediately(self):
        self.assertIn("amd64 manifest published", self.text)

    def test_uses_ghcr_registry(self):
        self.assertIn("ghcr.io", self.text)

    def test_valid_shell_syntax(self):
        import subprocess
        result = subprocess.run(["bash", "-n", str(BUILD_IMAGE)], capture_output=True)
        self.assertEqual(result.returncode, 0,
            f"build-image.sh has a shell syntax error:\n{result.stderr.decode()}")


if __name__ == "__main__":
    unittest.main()
