"""Offline integration smoke test for Binance matching and idempotent crediting."""

from __future__ import annotations

import asyncio
import datetime
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

        now = datetime.datetime.now()
        insert_ms = int(now.timestamp() * 1000)
        deposit = {
            "amount": "10.001",
            "coin": "USDT",
            "network": "TRX",
            "status": 1,
            "insertTime": insert_ms,
            "address": bot.BINANCE_DEPOSIT_ADDRESS,
            "txId": "offline-test-tx-1",
        }

        async def fake_history(start_ms: int, end_ms: int):
            return [deposit]

        bot.safe_send_message = no_send
        bot.BINANCE_WALLET._sync_time = fake_sync_time
        bot.BINANCE_WALLET.deposit_address = fake_address
        bot.BINANCE_WALLET.deposit_history = fake_history

        connection_test = await binance_admin._test_connection(bot)
        assert connection_test["ok"], connection_test
        method_id = await bot.ensure_binance_payment_method()
        created = now.strftime("%Y-%m-%d %H:%M:%S")
        expires = (now + datetime.timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        snapshot = json.dumps(
            {
                "provider": "binance_deposit",
                "address": bot.BINANCE_DEPOSIT_ADDRESS,
                "network": "TRX",
            }
        )
        async with bot.aiosqlite.connect(db_path) as db:
            await db.execute(
                "INSERT INTO users(user_id,username,full_name,balance,joined_date) VALUES(1,'admin','Admin',0,?)",
                (created,),
            )
            await db.execute(
                """
                INSERT INTO deposit_requests(
                    user_id,amount,payment_method,status,created_at,payment_method_id,
                    paid_amount,credited_amount,payment_snapshot,expected_amount,expires_at
                ) VALUES(1,10,'Binance','waiting_payment',?,?,?,?,?,?,?)
                """,
                (created, method_id, 10.001, 10, snapshot, "10.001", expires),
            )
            await db.commit()

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
