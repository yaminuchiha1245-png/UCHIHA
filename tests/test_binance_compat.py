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


if __name__ == "__main__":
    unittest.main()
