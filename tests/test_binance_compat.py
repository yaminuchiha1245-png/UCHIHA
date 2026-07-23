import unittest

from binance_compat import normalize_binance_network, prepare_binance_environment


class BinanceCompatTests(unittest.TestCase):
    def test_legacy_enabled_overrides_empty_canonical(self):
        env = {
            "BINANCE_AUTO_PAY_ENABLED": "",
            "BINANCE_PAYMENT_ENABLED": "1",
            "BINANCE_KEY": "key",
            "BINANCE_SECRET": "secret",
            "BINANCE_NETWORK": "TRC20",
        }
        status = prepare_binance_environment(env)
        self.assertTrue(status["enabled"])
        self.assertEqual(env["BINANCE_AUTO_PAY_ENABLED"], "1")
        self.assertEqual(env["BINANCE_API_KEY"], "key")
        self.assertEqual(env["BINANCE_API_SECRET"], "secret")
        self.assertEqual(env["BINANCE_NETWORK"], "TRX")

    def test_explicit_canonical_setting_wins(self):
        env = {
            "BINANCE_AUTO_PAY_ENABLED": "0",
            "BINANCE_PAYMENT_ENABLED": "1",
        }
        status = prepare_binance_environment(env)
        self.assertFalse(status["enabled"])

    def test_network_aliases(self):
        self.assertEqual(normalize_binance_network("TRC20"), "TRX")
        self.assertEqual(normalize_binance_network("BEP20"), "BSC")
        self.assertEqual(normalize_binance_network("ERC20"), "ETH")

    def test_trongrid_provider_and_legacy_key_alias(self):
        env = {
            "BINANCE_AUTO_PAY_ENABLED": "1",
            "BINANCE_VERIFICATION_PROVIDER": "TRC20",
            "TRON_API_KEY": "read-only-key",
            "BINANCE_DEPOSIT_ADDRESS": "T-address",
        }
        status = prepare_binance_environment(env)
        self.assertEqual(env["BINANCE_VERIFICATION_PROVIDER"], "trongrid")
        self.assertEqual(env["TRONGRID_API_KEY"], "read-only-key")
        self.assertTrue(status["trongrid_api_key_present"])

    def test_pay_id_provider_and_alias(self):
        env = {
            "BINANCE_AUTO_PAY_ENABLED": "1",
            "BINANCE_VERIFICATION_PROVIDER": "pay_id",
            "BINANCE_PAY_ACCOUNT_ID": "123456789",
        }
        status = prepare_binance_environment(env)
        self.assertEqual(env["BINANCE_VERIFICATION_PROVIDER"], "binance_pay")
        self.assertEqual(env["BINANCE_PAY_ID"], "123456789")
        self.assertTrue(status["pay_id_present"])

    def test_dual_provider_alias(self):
        env = {
            "BINANCE_AUTO_PAY_ENABLED": "1",
            "BINANCE_VERIFICATION_PROVIDER": "both",
            "BINANCE_PAY_ID": "123456789",
            "BINANCE_DEPOSIT_ADDRESS": "T-address",
            "TRONGRID_API_KEY": "read-only-key",
        }
        status = prepare_binance_environment(env)
        self.assertEqual(env["BINANCE_VERIFICATION_PROVIDER"], "dual")
        self.assertEqual(status["verification_provider"], "dual")


if __name__ == "__main__":
    unittest.main()
