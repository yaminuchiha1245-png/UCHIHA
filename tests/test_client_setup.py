from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from client_setup import build_isolated_values


class ClientSetupTests(unittest.TestCase):
    def test_generated_environment_contains_only_client_owned_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            key_file = Path(tmp) / "client_store.key"
            values = build_isolated_values(
                token="123456:abcdefghijklmnopqrstuvwxyzABCDE",
                admin_id="123456789",
                db_path="client_store.db",
                key_file=key_file,
                store_name="  My   Client Store  ",
            )

        self.assertEqual(values["CLIENT_STORE_NAME"], "My Client Store")
        self.assertEqual(values["BINANCE_AUTO_PAY_ENABLED"], "false")
        self.assertEqual(values["SYNC_ON_START"], "false")
        self.assertEqual(values["STOREFRONT_WEB_ENABLED"], "0")
        self.assertNotIn("API_TOKEN", values)
        self.assertNotIn("BINANCE_API_KEY", values)
        self.assertNotIn("BINANCE_API_SECRET", values)
        self.assertNotIn("TRONGRID_API_KEY", values)


if __name__ == "__main__":
    unittest.main()
