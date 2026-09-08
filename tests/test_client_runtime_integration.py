from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


class ClientRuntimeIntegrationTests(unittest.TestCase):
    def test_client_launcher_installs_without_legacy_storefront_integrations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "client.db")
            env = os.environ.copy()
            env.update(
                {
                    "BOT_TOKEN": "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
                    "ADMIN_ID": "123456789",
                    "DB_PATH": db_path,
                    "CLIENT_STORE_NAME": "Smoke Client",
                    "CLIENT_BACKUP_DIR": str(Path(tmp) / "backups"),
                    # Deliberately inject old secrets/flags; the launcher must
                    # remove/override these before importing bot.py.
                    "API_TOKEN": "legacy-js4",
                    "BINANCE_API_KEY": "legacy-binance",
                    "BINANCE_API_SECRET": "legacy-secret",
                    "SHAMCASH_API_TOKEN": "legacy-sham",
                    "BINANCE_AUTO_PAY_ENABLED": "true",
                    "SHAMCASH_API_ENABLED": "1",
                    "STOREFRONT_WEB_ENABLED": "1",
                }
            )
            script = textwrap.dedent(
                """
                import asyncio
                import os
                import sys

                import client_store_launcher as launcher

                assert 'storefront_launcher' not in sys.modules
                assert 'binance_admin' not in sys.modules
                assert 'shamcash_admin' not in sys.modules
                assert os.getenv('API_TOKEN', '') == ''
                assert os.getenv('BINANCE_API_KEY', '') == ''
                assert os.getenv('BINANCE_API_SECRET', '') == ''
                assert os.getenv('SHAMCASH_API_TOKEN', '') == ''
                assert os.getenv('BINANCE_AUTO_PAY_ENABLED') == 'false'
                assert os.getenv('SHAMCASH_API_ENABLED') == '0'
                assert os.getenv('STOREFRONT_WEB_ENABLED') == '0'

                launcher.install_client_modules()
                asyncio.run(launcher.store_app.init_db())

                assert launcher.store_app._client_backup_installed is True
                assert launcher.store_app._client_catalog_safety_installed is True
                assert launcher.store_app._client_order_admin_safety_installed is True
                assert launcher.store_app._client_payment_policy_installed is True
                assert launcher.store_app._client_api_purchase_runtime_installed is True

                main = launcher.store_app.main_menu_kb(True)
                main_callbacks = [
                    button.callback_data
                    for row in main.inline_keyboard
                    for button in row
                    if button.callback_data
                ]
                assert main_callbacks[:5] == [
                    'cli:root:ios',
                    'cli:root:android',
                    'cli:root:diamond_ff',
                    'deposit_request',
                    'cli:account',
                ], main_callbacks
                assert 'admin_panel' in main_callbacks

                panel = launcher.store_app.admin_panel_kb({}, True)
                callbacks = {
                    button.callback_data
                    for row in panel.inline_keyboard
                    for button in row
                    if button.callback_data
                }
                assert 'cliadmin:home' in callbacks
                assert 'admin_payment_methods' in callbacks
                for forbidden in (
                    'admin_binance',
                    'admin_shamcash',
                    'admin_products',
                    'admin_categories',
                    'admin_api_sync_now',
                    'admin_api_full_sync',
                ):
                    assert forbidden not in callbacks, (forbidden, callbacks)

                print('CLIENT_RUNTIME_SMOKE_PASS')
                """
            )
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=Path(__file__).resolve().parents[1],
                env=env,
                text=True,
                capture_output=True,
                timeout=45,
            )
            if result.returncode != 0:
                self.fail(
                    "client runtime smoke failed\nSTDOUT:\n"
                    + result.stdout
                    + "\nSTDERR:\n"
                    + result.stderr
                )
            self.assertIn("CLIENT_RUNTIME_SMOKE_PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
