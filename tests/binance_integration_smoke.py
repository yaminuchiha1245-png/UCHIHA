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
            "BINANCE_VERIFICATION_MODE": "reference",
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
            def __init__(self, user_id: int):
                self.id = user_id

        class FakeMessage:
            def __init__(self, user_id: int = 1):
                self.from_user = FakeUser(user_id)
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
        assert "لا توجد أي زيادة" in message.answers[-1][0]
        assert any(
            str(button.callback_data or "").startswith("binance_reference_")
            for row in message.answers[-1][1]["reply_markup"].inline_keyboard
            for button in row
        )

        connection = sqlite3.connect(db_path)
        try:
            _request_id, expected_amount, request_created, expires, snapshot_raw = connection.execute(
                "SELECT id,expected_amount,created_at,expires_at,payment_snapshot "
                "FROM deposit_requests ORDER BY id DESC LIMIT 1"
            ).fetchone()
        finally:
            connection.close()
        snapshot = json.loads(snapshot_raw)
        assert expected_amount == "10", expected_amount
        assert snapshot["verification_mode"] == "reference"
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
        assert bot._deposit_matches_reference(deposit, "OFFLINE-TEST-TX-1")
        assert not bot._deposit_matches_reference(deposit, "another-reference")

        # A reference-mode request must never be approved from the amount alone.
        deposits.append(deposit)
        assert await bot.check_binance_pending_once() == 0
        deposits.clear()

        wrong_status, _ = await bot.check_binance_request(_request_id, "wrong-reference")
        assert wrong_status == "waiting", wrong_status
        waiting_status, _ = await bot.check_binance_request(_request_id, "offline-test-tx-1")
        assert waiting_status == "waiting", waiting_status
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
        assert txid == "OFFLINE-TEST-TX-1", txid
        assert logs == 1, logs

        # Two customers may request the exact same amount; the submitted
        # reference, not the amount, decides which request receives credit.
        second_message = FakeMessage(user_id=2)
        second_state = FakeState()
        await bot.create_binance_deposit_request(
            second_message,
            second_state,
            {"payment_method_id": method_id},
            requested_amount=10,
            credited_amount=10,
        )
        connection = sqlite3.connect(db_path)
        try:
            second_request_id, second_expected = connection.execute(
                "SELECT id,expected_amount FROM deposit_requests WHERE user_id=2 "
                "ORDER BY id DESC LIMIT 1"
            ).fetchone()
        finally:
            connection.close()
        assert second_expected == "10"
        deposits.append({**deposit, "txId": "offline-test-tx-2"})
        second_status, _ = await bot.check_binance_request(
            second_request_id,
            "offline-test-tx-2",
        )
        assert second_status == "approved", second_status

        duplicate_message = FakeMessage(user_id=3)
        duplicate_state = FakeState()
        await bot.create_binance_deposit_request(
            duplicate_message,
            duplicate_state,
            {"payment_method_id": method_id},
            requested_amount=10,
            credited_amount=10,
        )
        connection = sqlite3.connect(db_path)
        try:
            duplicate_request_id = connection.execute(
                "SELECT id FROM deposit_requests WHERE user_id=3 ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
            second_balance = connection.execute(
                "SELECT balance FROM users WHERE user_id=2"
            ).fetchone()[0]
        finally:
            connection.close()
        duplicate_status, _ = await bot.check_binance_request(
            duplicate_request_id,
            "offline-test-tx-2",
        )
        assert duplicate_status == "duplicate", duplicate_status
        assert abs(second_balance - 10.0) < 1e-9, second_balance

        dashboard_text, dashboard_data = await binance_admin._dashboard_text(bot)
        assert "مركز Binance" in dashboard_text
        assert dashboard_data["counts"].get("approved") == 2

        await bot.set_setting("binance_runtime_enabled", "0")
        paused_status, _paused_message = await bot.check_binance_request(999999)
        assert paused_status == "paused", paused_status
        print("Binance offline integration smoke test passed.")


if __name__ == "__main__":
    asyncio.run(main())
