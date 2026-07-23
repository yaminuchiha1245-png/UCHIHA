"""Offline smoke test for simultaneous Binance Pay ID and USDT-TRC20 methods."""

from __future__ import annotations

import asyncio
import datetime
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PAY_ID = "123456789"
RECIPIENT = "TUD4YXYdj2t1gP5th3A7t97mx1AUmrrQRt"
PAY_TX = "M_P_71505104267789999"
TRON_TX = "ab" * 32


def _set_env(db_path: str) -> None:
    os.environ.update(
        {
            "BOT_TOKEN": "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi123456789",
            "ADMIN_ID": "1",
            "DB_PATH": db_path,
            "BINANCE_AUTO_PAY_ENABLED": "1",
            "BINANCE_VERIFICATION_PROVIDER": "dual",
            "BINANCE_VERIFICATION_MODE": "reference",
            "BINANCE_COIN": "USDT",
            "BINANCE_PAY_ID": PAY_ID,
            "BINANCE_API_KEY": "offline-test-key",
            "BINANCE_API_SECRET": "offline-test-secret",
            "BINANCE_NETWORK": "TRX",
            "BINANCE_DEPOSIT_ADDRESS": RECIPIENT,
            "TRONGRID_API_KEY": "offline-trongrid-key",
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

        pay_trades: list[dict[str, object]] = []
        tron_deposits: list[dict[str, object]] = []

        async def no_send(*args, **kwargs):
            return None

        async def fake_sync_time(force: bool = False):
            return None

        async def fake_pay_history(start_ms: int, end_ms: int):
            return list(pay_trades)

        async def fake_tron_test():
            return {"block_id": "cd" * 32, "block_number": 91_000_000}

        async def fake_transaction_deposits(txid: str):
            matches = [
                item
                for item in tron_deposits
                if bot._normalize_binance_reference(item.get("txId"))
                == bot._normalize_binance_reference(txid)
            ]
            return bool(matches), matches

        bot.safe_send_message = no_send
        bot.BINANCE_WALLET._sync_time = fake_sync_time
        bot.BINANCE_WALLET.pay_trade_history = fake_pay_history
        bot.TRON_GRID.test_connection = fake_tron_test
        bot.TRON_GRID.transaction_deposits = fake_transaction_deposits

        primary_id = await bot.ensure_binance_payment_method()
        assert primary_id > 0
        assert bot.binance_verification_provider() == "dual"

        connection = sqlite3.connect(db_path)
        try:
            methods = connection.execute(
                "SELECT id,external_id,name,transfer_value,auto_config,is_active "
                "FROM payment_methods WHERE provider='binance' ORDER BY sort_order,id"
            ).fetchall()
        finally:
            connection.close()
        assert len(methods) == 2, methods
        pay_method, tron_method = methods
        pay_config = json.loads(pay_method[4])
        tron_config = json.loads(tron_method[4])
        assert pay_method[1] == "binance_usdt_auto"
        assert pay_method[2] == "Binance Pay ID (USDT)"
        assert pay_method[3] == PAY_ID and pay_method[5] == 1
        assert pay_config["verification_provider"] == "binance_pay"
        assert pay_config["payment_channel"] == "binance_pay"
        assert tron_method[1] == "binance_usdt_tron_auto"
        assert tron_method[2] == "USDT TRC20 (TRON)"
        assert tron_method[3] == RECIPIENT and tron_method[5] == 1
        assert tron_config["verification_provider"] == "trongrid"
        assert tron_config["network"] == "TRX"

        now = datetime.datetime.now()
        created = now.strftime("%Y-%m-%d %H:%M:%S")
        async with bot.aiosqlite.connect(db_path) as db:
            await db.executemany(
                "INSERT INTO users(user_id,username,full_name,balance,joined_date) "
                "VALUES(?,?,?,?,?)",
                [
                    (1, "pay_customer", "Pay Customer", 0, created),
                    (2, "tron_customer", "TRON Customer", 0, created),
                ],
            )
            await db.commit()

        class FakeUser:
            def __init__(self, user_id: int):
                self.id = user_id

        class FakeMessage:
            def __init__(self, user_id: int):
                self.from_user = FakeUser(user_id)
                self.answers: list[tuple[str, dict[str, object]]] = []

            async def answer(self, text: str, **kwargs):
                self.answers.append((text, kwargs))

        class FakeState:
            async def clear(self):
                return None

        pay_message = FakeMessage(1)
        await bot.create_binance_deposit_request(
            pay_message,
            FakeState(),
            {"payment_method_id": int(pay_method[0])},
            requested_amount=1,
            credited_amount=1,
        )
        assert PAY_ID in pay_message.answers[-1][0]
        assert "Binance Pay" in pay_message.answers[-1][0]
        assert "TRX (TRC20)" not in pay_message.answers[-1][0]

        tron_message = FakeMessage(2)
        await bot.create_binance_deposit_request(
            tron_message,
            FakeState(),
            {"payment_method_id": int(tron_method[0])},
            requested_amount=1,
            credited_amount=1,
        )
        assert RECIPIENT in tron_message.answers[-1][0]
        assert "TRX (TRC20)" in tron_message.answers[-1][0]
        assert PAY_ID not in tron_message.answers[-1][0]

        connection = sqlite3.connect(db_path)
        try:
            request_rows = connection.execute(
                "SELECT id,user_id,payment_snapshot FROM deposit_requests ORDER BY id"
            ).fetchall()
        finally:
            connection.close()
        assert len(request_rows) == 2
        pay_request, tron_request = request_rows
        assert json.loads(pay_request[2])["verification_provider"] == "binance_pay"
        assert json.loads(tron_request[2])["verification_provider"] == "trongrid"

        transaction_time = int(datetime.datetime.now().timestamp() * 1000)
        pay_trades.append(
            {
                "orderType": "PAY",
                "transactionId": PAY_TX,
                "transactionTime": transaction_time,
                "amount": "1.00",
                "currency": "USDT",
            }
        )
        tron_deposits.append(
            {
                "amount": "1",
                "coin": "USDT",
                "network": "TRX",
                "status": 1,
                "insertTime": transaction_time,
                "address": RECIPIENT,
                "txId": TRON_TX,
            }
        )
        pay_status, _ = await bot.check_binance_request(int(pay_request[0]), PAY_TX)
        tron_status, _ = await bot.check_binance_request(int(tron_request[0]), TRON_TX)
        assert pay_status == "approved", pay_status
        assert tron_status == "approved", tron_status

        connection = sqlite3.connect(db_path)
        try:
            balances = connection.execute(
                "SELECT user_id,balance FROM users WHERE user_id IN (1,2) ORDER BY user_id"
            ).fetchall()
        finally:
            connection.close()
        assert balances == [(1, 1.0), (2, 1.0)], balances

        test_result = await binance_admin._test_connection(bot)
        assert test_result["ok"] and not test_result["degraded"], test_result
        assert test_result["provider"] == "dual"
        dashboard_text, dashboard_data = await binance_admin._dashboard_text(bot)
        assert "الخيار 1 — Binance Pay ID" in dashboard_text
        assert "الخيار 2 — USDT TRC20" in dashboard_text
        assert dashboard_data["visible_methods"] == 2
        assert dashboard_data["expected_methods"] == 2

        async def blocked_pay_history(start_ms: int, end_ms: int):
            raise bot.BinanceWalletError(
                "Binance 0: Service unavailable from a restricted location"
            )

        bot.BINANCE_WALLET.pay_trade_history = blocked_pay_history
        degraded = await binance_admin._test_connection(bot)
        assert degraded["ok"] and degraded["degraded"], degraded
        assert "مراجعة" in degraded["message"]

        print("Binance dual-method offline integration smoke test passed.")


if __name__ == "__main__":
    asyncio.run(main())
