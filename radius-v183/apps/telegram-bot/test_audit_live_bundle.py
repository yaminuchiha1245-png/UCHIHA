"""Offline, non-destructive release audit tests."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from audit_live_bundle import audit_bundle, main
from stage_bundle import RUNTIME_FILES, stage_bundle


class LiveAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / "staged"
        self.live = self.root / "live"
        stage_bundle(Path(__file__).parent, self.bundle)
        shutil.copytree(self.bundle, self.live)

    def test_complete_verified_bundle_matches_deployed_runtime(self):
        result = audit_bundle(self.bundle, self.live)
        self.assertEqual(result["status"], "match")
        self.assertEqual(result["matched"], len(RUNTIME_FILES))
        self.assertEqual(set(result["files"]), set(RUNTIME_FILES))

    def test_single_stale_screen_is_reported_without_modifying_live(self):
        source = self.live / "v183_screens.py"
        contents = source.read_bytes()
        source.write_bytes(contents + b"\n# stale collector menu\n")
        result = audit_bundle(self.bundle, self.live)
        self.assertEqual(result["status"], "drift")
        self.assertEqual(result["files"]["v183_screens.py"], "drift")
        self.assertEqual(result["matched"], len(RUNTIME_FILES) - 1)
        self.assertEqual(source.read_bytes(), contents + b"\n# stale collector menu\n")

    def test_missing_avatar_is_reported(self):
        (self.live / "assets/profile-default.png").unlink()
        result = audit_bundle(self.bundle, self.live)
        self.assertEqual(result["files"]["assets/profile-default.png"], "missing")

    def test_unsafe_symlink_is_rejected_without_reading_its_target(self):
        file = self.live / "v183_bot.py"
        file.unlink()
        secret = self.root / "sensitive-example.env"
        secret.write_text("THIS_SHOULD_NEVER_BE_READ")
        file.symlink_to(secret)
        result = audit_bundle(self.bundle, self.live)
        self.assertEqual(result["files"]["v183_bot.py"], "unsafe_symlink")
        self.assertNotIn("THIS_SHOULD_NEVER_BE_READ", json.dumps(result))

    def test_missing_or_symlinked_live_directory(self):
        shutil.rmtree(self.live)
        self.assertEqual(audit_bundle(self.bundle, self.live)["status"], "missing")
        self.live.symlink_to(self.bundle, target_is_directory=True)
        self.assertEqual(audit_bundle(self.bundle, self.live)["status"], "unsafe")

    def test_cli_exit_codes_are_actionable(self):
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["--bundle", str(self.bundle),
                                   "--live", str(self.live)]), 0)
        (self.live / "v183_member_workflows.py").unlink()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["--bundle", str(self.bundle),
                                   "--live", str(self.live)]), 1)


if __name__ == "__main__":
    unittest.main()
