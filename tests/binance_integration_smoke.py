"""Offline integration smoke test for Binance matching and idempotent crediting."""

from __future__ import annotations

import asyncio
import datetime
import hashlib
import hmac
import json
import os
import sqlite3
import tempfile
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _set_env(db_path: str) -> None:
    os.environ.update(
        {
            "BOT_TOKEN": "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi123456789",
            "ADMIN_ID": "1",
            "DB_PATH": db_path,
            "BINANCE_AUTO_PAY_ENABLED": "1",
            "BINANCE_API_KEY": "offline-test-key",
            "BINANCE_API_SECRET": "offline-test-secret",
            "BINANCE_DEPOSIT_ADDRESS": "TOfflineTestAddress123456789",
            "BINANCE_COIN": "USDT",
            "BINANCE_NETWORK": "TRC20",
            "BINANCE_START_DELAY_SECONDS": "0",
        }
    )


async def main() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = str(Path(temp_dir) / "store.db")
        _set_env(db_path)

        import bot
        import binance_admin

        binance_admin.install(bot)
        await bot.init_db()

        panel = bot.admin_panel_kb({"can_manage_payments": True}, False)
        assert any(
            button.callback_data == "admin_binance"
            for row in panel.inline_keyboard
            for button in row
        ), "Binance admin button missing"

        async def no_send(*args, **kwargs):
            return None

        async def fake_sync_time(force: bool = False):
            return None

        async def fake_address():
            return {"address": bot.BINANCE_DEPOSIT_ADDRESS, "tag": ""}

        deposits: list[dict[str, object]] = []

        async def fake_history(start_ms: int, end_ms: int):
            return list(deposits)

        bot.safe_send_message = no_send
        bot.BINANCE_WALLET._sync_time = fake_sync_time
        bot.BINANCE_WALLET.deposit_address = fake_address
        bot.BINANCE_WALLET.deposit_history = fake_history

        connection_test = await binance_admin._test_connection(bot)
        assert connection_test["ok"], connection_test
        method_id = await bot.ensure_binance_payment_method()

        # Verify the official signed request contract without a live API key.
        signed_client = bot.BinanceWalletClient()
        signed_call: dict[str, object] = {}

        async def fake_json_request(method: str, url: str, *, headers=None):
            signed_call.update(method=method, url=url, headers=headers or {})
            return {"ok": True}

        signed_client._sync_time = fake_sync_time
        signed_client._json_request = fake_json_request
        await signed_client._signed_get("/sapi/v1/capital/deposit/hisrec", {"coin": "USDT"})
        assert signed_call["method"] == "GET"
        assert signed_call["headers"]["X-MBX-APIKEY"] == "offline-test-key"
        unsigned_query, signature = str(signed_call["url"]).split("?", 1)[1].rsplit("&signature=", 1)
        expected_signature = hmac.new(
            b"offline-test-secret", unsigned_query.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        assert signature == expected_signature

        endpoint_calls: list[tuple[str, dict[str, object]]] = []

        async def fake_signed_get(path: str, params: dict[str, object]):
            endpoint_calls.append((path, dict(params)))
            if path.endswith("/address"):
                return {"address": "TContractAddress", "tag": ""}
            return []

        signed_client._signed_get = fake_signed_get
        configured_address = bot.BINANCE_DEPOSIT_ADDRESS
        bot.BINANCE_DEPOSIT_ADDRESS = ""
        try:
            await signed_client.deposit_address()
        finally:
            bot.BINANCE_DEPOSIT_ADDRESS = configured_address
        await signed_client.deposit_history(1_000, 2_000)
        assert endpoint_calls[0] == (
            "/sapi/v1/capital/deposit/address",
            {"coin": "USDT", "network": "TRX"},
        )
        assert endpoint_calls[1][0] == "/sapi/v1/capital/deposit/hisrec"
        assert endpoint_calls[1][1]["status"] == 1

        now = datetime.datetime.now()
        created = now.strftime("%Y-%m-%d %H:%M:%S")
        async with bot.aiosqlite.connect(db_path) as db:
            await db.execute(
                "INSERT INTO users(user_id,username,full_name,balance,joined_date) VALUES(1,'admin','Admin',0,?)",
                (created,),
            )
            await db.commit()

        class FakeUser:
            id = 1

        class FakeMessage:
            from_user = FakeUser()

            def __init__(self):
                self.answers: list[tuple[str, dict[str, object]]] = []

            async def answer(self, text: str, **kwargs):
                self.answers.append((text, kwargs))

        class FakeState:
            cleared = False

            async def clear(self):
                self.cleared = True

        message = FakeMessage()
        state = FakeState()
        await bot.create_binance_deposit_request(
            message,
            state,
            {"payment_method_id": method_id},
            requested_amount=10,
            credited_amount=10,
        )
        assert state.cleared
        assert message.answers and "Binance AutoPay" in message.answers[-1][0]
        assert "1️⃣" in message.answers[-1][0] and "TRX (TRC20)" in message.answers[-1][0]

        connection = sqlite3.connect(db_path)
        try:
            _request_id, expected_amount, request_created, expires, snapshot_raw = connection.execute(
                "SELECT id,expected_amount,created_at,expires_at,payment_snapshot "
                "FROM deposit_requests ORDER BY id DESC LIMIT 1"
            ).fetchone()
        finally:
            connection.close()
        snapshot = json.loads(snapshot_raw)
        insert_ms = int(datetime.datetime.now().timestamp() * 1000)
        deposit = {
            "amount": expected_amount,
            "coin": "USDT",
            "network": "TRC20",
            "status": 1,
            "insertTime": insert_ms,
            "address": bot.BINANCE_DEPOSIT_ADDRESS,
            "txId": "offline-test-tx-1",
        }
        request = {
            "expected_amount": expected_amount,
            "created_at": request_created,
            "expires_at": expires,
            "address": snapshot["address"],
        }
        assert bot._deposit_matches_request(deposit, request)
        assert not bot._deposit_matches_request({**deposit, "amount": "10.999"}, request)
        assert not bot._deposit_matches_request({**deposit, "network": "BSC"}, request)
        assert not bot._deposit_matches_request({**deposit, "status": 0}, request)
        deposits.append(deposit)

        first = await bot.check_binance_pending_once()
        second = await bot.check_binance_pending_once()
        connection = sqlite3.connect(db_path)
        try:
            balance = connection.execute("SELECT balance FROM users WHERE user_id=1").fetchone()[0]
            status, txid = connection.execute(
                "SELECT status,transaction_reference FROM deposit_requests ORDER BY id DESC LIMIT 1"
            ).fetchone()
            logs = connection.execute(
                "SELECT COUNT(*) FROM balance_logs WHERE reason LIKE 'شحن Binance تلقائي%'"
            ).fetchone()[0]
        finally:
            connection.close()

        assert first == 1, first
        assert second == 0, second
        assert abs(balance - 10.0) < 1e-9, balance
        assert status == "approved", status
        assert txid == "offline-test-tx-1", txid
        assert logs == 1, logs
        dashboard_text, dashboard_data = await binance_admin._dashboard_text(bot)
        assert "مركز Binance" in dashboard_text
        assert dashboard_data["counts"].get("approved") == 1

        await bot.set_setting("binance_runtime_enabled", "0")
        paused_status, _paused_message = await bot.check_binance_request(999999)
        assert paused_status == "paused", paused_status
        print("Binance offline integration smoke test passed.")


if __name__ == "__main__":
    asyncio.run(main())
