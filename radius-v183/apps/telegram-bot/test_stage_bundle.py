"""Release-staging regression coverage; never touches the production bot."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from stage_bundle import RUNTIME_FILES, stage_bundle, verify_bundle, refuse_production


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = Path(__file__).parent
        self.bundle = self.root / "bot-stage"

    def test_bundle_has_every_runtime_module_avatar_and_no_secrets(self):
        manifest = stage_bundle(self.source, self.bundle)
        self.assertEqual(manifest["entrypoint"], "v183_screens.py")
        self.assertEqual(set(manifest["sha256"]), set(RUNTIME_FILES))
        self.assertEqual(manifest["containsSecrets"], False)
        self.assertEqual(
            {str(p.relative_to(self.bundle)) for p in self.bundle.rglob("*") if p.is_file()},
            set(RUNTIME_FILES) | {"bundle-manifest.json"},
        )
        self.assertEqual(verify_bundle(self.bundle), manifest)
        self.assertFalse((self.bundle / ".env").exists())
        self.assertFalse((self.bundle / "test_v183_member_workflows.py").exists())

    def test_modified_module_rejected_before_any_deployment(self):
        stage_bundle(self.source, self.bundle)
        target = self.bundle / "v183_member_workflows.py"
        target.write_text(target.read_text() + "\n# tampered\n")
        with self.assertRaisesRegex(ValueError, "mismatched"):
            verify_bundle(self.bundle)

    def test_missing_avatar_fails_and_cleanup_is_atomic(self):
        fake = self.root / "incomplete"
        fake.mkdir()
        for relative in RUNTIME_FILES:
            if relative == "assets/profile-default.png":
                continue
            item = fake / relative
            item.parent.mkdir(exist_ok=True, parents=True)
            item.write_bytes((self.source / relative).read_bytes())
        with self.assertRaisesRegex(ValueError, "Required runtime file"):
            stage_bundle(fake, self.bundle)
        self.assertFalse(self.bundle.exists())
        self.assertEqual(list(self.root.glob(".bot-stage.*")), [])

    def test_existing_target_is_never_overwritten(self):
        self.bundle.mkdir()
        marker = self.bundle / "untouched.txt"
        marker.write_text("pre-existing")
        with self.assertRaises(FileExistsError):
            stage_bundle(self.source, self.bundle)
        self.assertEqual(marker.read_text(), "pre-existing")

    def test_live_directory_cannot_be_a_stage_or_verify_target(self):
        for target in (
            Path("/opt/uchiha-radius/telegram-v183"),
            Path("/opt/uchiha-radius/telegram-v183/bundle"),
        ):
            with self.assertRaisesRegex(ValueError, "live bot"):
                refuse_production(target)
        with self.assertRaisesRegex(ValueError, "live bot"):
            stage_bundle(self.source, Path("/opt/uchiha-radius/telegram-v183"))

    def test_manifest_tampering_rejected(self):
        stage_bundle(self.source, self.bundle)
        path = self.bundle / "bundle-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["sha256"].pop("v183_member_workflows.py")
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            verify_bundle(self.bundle)


if __name__ == "__main__":
    unittest.main()
