"""Regression checks for production-derived Telegram WebApp v101."""
from __future__ import annotations

import hashlib
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from build_telegram_webapp import build


class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.current = ""

    def handle_data(self, data):
        if self.current is not None:
            self.current += data

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            if self.current.strip():
                self.scripts.append(self.current)
            self.current = None


class TelegramBundleIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.source = ROOT.parent / "RADIUS-A-Master-v101.html"
        cls.runtime = ROOT / "web" / "telegram-runtime-v101.js"
        cls.output = Path(cls.temp.name) / "index.html"
        cls.source_before = hashlib.sha256(cls.source.read_bytes()).hexdigest()
        cls.info = build(cls.source, cls.runtime, cls.output)
        cls.html = cls.output.read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_source_is_unchanged(self):
        self.assertEqual(self.info["sourceSha256"], self.source_before)
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.source_before)

    def test_no_sample_finance_or_search(self):
        for value in ("INV-82641", "INV-82640", "INV-82639", "INV-82638",
                      'keywords:"atlas connect AC مزود المنطقة A provider"',
                      'status:"simulated"', "UCHIHA-DEMO-2026"):
            with self.subTest(value=value):
                self.assertNotIn(value, self.html)

    def test_production_never_reads_or_writes_unscoped_cache(self):
        self.assertIn("function lC(){if(window.__UCHIHA_PROVIDER_RUNTIME__===true)", self.html)
        for name in ("lS", "lAS", "lBS"):
            self.assertIn(f"function {name}(", self.html)
            start = self.html.index(f"function {name}(")
            self.assertIn("if(window.__UCHIHA_PROVIDER_RUNTIME__===true)return;",
                          self.html[start:start + 130])

    def test_runtime_does_not_store_private_provider_catalog(self):
        runtime = self.runtime.read_text(encoding="utf-8")
        self.assertNotIn('localStorage.setItem("uchiha-radius-local-catalog"', runtime)
        self.assertNotIn('localStorage.setItem("uchiha-radius-provider-cache"', runtime)
        self.assertIn('window.__UCHIHA_PROVIDER_LIVE_CATALOG__ = catalog', runtime)

    def test_telegram_requires_authenticated_profile_and_hides_fake_plan(self):
        runtime = self.runtime.read_text(encoding="utf-8")
        for required in (
            'html.uchiha-telegram-runtime:not(.uchiha-telegram-authenticated) #root',
            'data-uchiha-live-profile-verified="1"',
            '.radius-plan-strip',
            '.scope-switch.platform',
            'syncProviderHeader()',
            "document.readyState === 'loading'",
        ):
            with self.subTest(marker=required):
                self.assertIn(required, runtime)

    def test_runtime_asset_is_cache_busted(self):
        runtime_hash = hashlib.sha256(self.runtime.read_bytes()).hexdigest()[:12]
        self.assertIn(f'telegram-runtime-v101.js?v={runtime_hash}', self.html)

    def test_bot_activation_never_passes_token_as_process_argument(self):
        script = (ROOT / 'deploy' / 'activate-telegram-bot.sh').read_text(encoding='utf-8')
        self.assertNotIn('python3 - "${TOKEN}"', script)
        self.assertNotIn('"${ENV_FILE}" "${TOKEN}"', script)
        self.assertIn('"${ENV_FILE}" "${TOKEN_FILE}"', script)
        self.assertIn('chmod 0600 "${TOKEN_FILE}"', script)
        self.assertEqual(script.count('python3 - "${TOKEN_FILE}"'), 2)
        deploy = (ROOT / 'deploy' / 'central-deploy.sh').read_text(encoding='utf-8')
        self.assertIn('install -m 0750 "$HERE/activate-telegram-bot.sh"', deploy)

    def test_javascript_syntax(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js unavailable")
        parser = InlineScripts()
        parser.feed(self.html)
        self.assertGreater(len(parser.scripts), 1)
        files = [(self.runtime.name, self.runtime.read_text(encoding="utf-8"))]
        files += [(f"inline-{i}.js", source) for i, source in enumerate(parser.scripts)]
        for name, source in files:
            with self.subTest(name=name):
                script = Path(self.temp.name) / name
                script.write_text(source, encoding="utf-8")
                result = subprocess.run([node, "--check", str(script)],
                                        capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr[-1500:])


if __name__ == "__main__":
    unittest.main()
