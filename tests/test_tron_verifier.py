from __future__ import annotations

import unittest

from tron_verifier import (
    DEFAULT_USDT_CONTRACT,
    TRC20_TRANSFER_TOPIC,
    TronGridClient,
    TronGridError,
    is_valid_tron_address,
    normalize_tron_txid,
    tron_address_to_hex,
)


RECIPIENT = "TUD4YXYdj2t1gP5th3A7t97mx1AUmrrQRt"
TXID = "AB" * 32


def transaction_info(
    *,
    amount_raw: int = 10_000_000,
    recipient: str = RECIPIENT,
    contract: str = DEFAULT_USDT_CONTRACT,
    result: str = "SUCCESS",
) -> dict:
    recipient_hex = tron_address_to_hex(recipient)[2:]
    contract_hex = tron_address_to_hex(contract)[2:]
    return {
        "id": TXID.lower(),
        "blockNumber": 77_000_001,
        "blockTimeStamp": 1_750_000_000_000,
        "receipt": {"result": result},
        "log": [
            {
                "address": contract_hex,
                "topics": [
                    TRC20_TRANSFER_TOPIC,
                    "0" * 24 + "11" * 20,
                    "0" * 24 + recipient_hex,
                ],
                "data": f"{amount_raw:064x}",
            }
        ],
    }


class TronAddressTests(unittest.TestCase):
    def test_known_addresses_and_txid(self) -> None:
        self.assertTrue(is_valid_tron_address(RECIPIENT))
        self.assertTrue(is_valid_tron_address(DEFAULT_USDT_CONTRACT))
        self.assertEqual(
            tron_address_to_hex(DEFAULT_USDT_CONTRACT),
            "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
        )
        self.assertEqual(normalize_tron_txid(TXID.lower()), TXID)

    def test_rejects_invalid_address_and_txid(self) -> None:
        self.assertFalse(is_valid_tron_address("T-not-a-real-address"))
        self.assertEqual(normalize_tron_txid("short"), "")


class TronGridClientTests(unittest.IsolatedAsyncioTestCase):
    def client(self) -> TronGridClient:
        return TronGridClient(api_key="offline-key", recipient_address=RECIPIENT)

    async def test_exact_confirmed_usdt_transfer(self) -> None:
        client = self.client()

        async def fake_request(method, path, *, payload=None):
            self.assertEqual(method, "POST")
            self.assertEqual(path, "/walletsolidity/gettransactioninfobyid")
            self.assertEqual(payload, {"value": TXID.lower()})
            return transaction_info()

        client._json_request = fake_request
        found, deposits = await client.transaction_deposits(TXID)
        self.assertTrue(found)
        self.assertEqual(len(deposits), 1)
        self.assertEqual(deposits[0]["amount"], "10")
        self.assertEqual(deposits[0]["coin"], "USDT")
        self.assertEqual(deposits[0]["network"], "TRX")
        self.assertEqual(deposits[0]["address"], RECIPIENT)
        self.assertEqual(deposits[0]["txId"], TXID)
        self.assertEqual(deposits[0]["confirmation"], "solidified")

    async def test_wrong_recipient_or_fake_token_never_matches(self) -> None:
        client = self.client()
        payload = transaction_info()
        payload["log"][0]["topics"][2] = "0" * 24 + "22" * 20

        async def wrong_recipient(*args, **kwargs):
            return payload

        client._json_request = wrong_recipient
        found, deposits = await client.transaction_deposits(TXID)
        self.assertTrue(found)
        self.assertEqual(deposits, [])

        payload = transaction_info()
        payload["log"][0]["address"] = "33" * 20

        async def fake_contract(*args, **kwargs):
            return payload

        client._json_request = fake_contract
        found, deposits = await client.transaction_deposits(TXID)
        self.assertTrue(found)
        self.assertEqual(deposits, [])

    async def test_failed_or_unconfirmed_transaction_is_not_a_deposit(self) -> None:
        client = self.client()

        async def failed(*args, **kwargs):
            return transaction_info(result="REVERT")

        client._json_request = failed
        with self.assertRaises(TronGridError):
            await client.transaction_deposits(TXID)

        async def missing(*args, **kwargs):
            return {}

        client._json_request = missing
        self.assertEqual(await client.transaction_deposits(TXID), (False, []))

        payload = transaction_info()
        payload["receipt"] = {}

        async def missing_success(*args, **kwargs):
            return payload

        client._json_request = missing_success
        with self.assertRaises(TronGridError):
            await client.transaction_deposits(TXID)

    async def test_connection_and_configuration_validation(self) -> None:
        client = self.client()

        async def block(*args, **kwargs):
            return {
                "blockID": "01" * 32,
                "block_header": {"raw_data": {"number": 88}},
            }

        client._json_request = block
        result = await client.test_connection()
        self.assertEqual(result["block_number"], 88)

        missing_key = TronGridClient(api_key="", recipient_address=RECIPIENT)
        self.assertFalse(missing_key.ready)
        with self.assertRaises(TronGridError):
            await missing_key.test_connection()

        wrong_contract = TronGridClient(
            api_key="offline-key",
            recipient_address=RECIPIENT,
            token_contract=RECIPIENT,
        )
        self.assertFalse(wrong_contract.ready)
        self.assertIn("الرسمي", wrong_contract.configuration_error())

        wrong_endpoint = TronGridClient(
            api_key="offline-key",
            recipient_address=RECIPIENT,
            base_url="http://api.trongrid.io",
        )
        self.assertFalse(wrong_endpoint.ready)
        self.assertIn("https://api.trongrid.io", wrong_endpoint.configuration_error())


if __name__ == "__main__":
    unittest.main()
