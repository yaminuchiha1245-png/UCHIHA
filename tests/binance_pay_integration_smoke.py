"""Offline smoke test for Binance Pay ID transaction verification."""

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
TX1 = "M_P_71505104267788288"
TX2 = "M_P_71505104267788399"
TX3 = "M_P_71505104267788400"


def _set_env(db_path: str) -> None:
    os.environ.update(
        {
            "BOT_TOKEN": "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi123456789",
            "ADMIN_ID": "1",
            "DB_PATH": db_path,
            "BINANCE_AUTO_PAY_ENABLED": "1",
            "BINANCE_API_KEY": "offline-test-key",
            "BINANCE_API_SECRET": "offline-test-secret",
            "BINANCE_PAY_ID": PAY_ID,
            "BINANCE_COIN": "USDT",
            "BINANCE_VERIFICATION_MODE": "reference",
            "BINANCE_VERIFICATION_PROVIDER": "binance_pay",
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

        async def no_send(*args, **kwargs):
            return None

        async def fake_sync_time(force: bool = False):
            return None

        trades: list[dict[str, object]] = []
        api_error: Exception | None = None

        async def fake_pay_history(start_ms: int, end_ms: int):
            if api_error is not None:
                raise api_error
            return list(trades)

        bot.safe_send_message = no_send
        bot.BINANCE_WALLET._sync_time = fake_sync_time
        bot.BINANCE_WALLET.pay_trade_history = fake_pay_history

        method_id = await bot.ensure_binance_payment_method()
        assert method_id > 0
        assert bot.binance_verification_provider() == "binance_pay"
        assert bot.binance_payment_ready()

        connection = sqlite3.connect(db_path)
        try:
            name, label, value, config_raw = connection.execute(
                "SELECT name,transfer_label,transfer_value,auto_config FROM payment_methods WHERE id=?",
                (method_id,),
            ).fetchone()
        finally:
            connection.close()
        config = json.loads(config_raw)
        assert name == "Binance Pay ID (USDT)"
        assert label == "Binance Pay ID"
        assert value == PAY_ID
        assert config["verification_provider"] == "binance_pay"
        assert config["network"] == ""

        endpoint = bot.BinanceWalletClient()
        calls: list[tuple[str, dict[str, object]]] = []

        async def fake_signed_get(path: str, params: dict[str, object]):
            calls.append((path, dict(params)))
            return {
                "code": "000000",
                "message": "success",
                "success": True,
                "data": [],
            }

        endpoint._signed_get = fake_signed_get
        assert await endpoint.pay_trade_history(1_000, 2_000) == []
        assert calls[0][0] == "/sapi/v1/pay/transactions"
        assert calls[0][1]["limit"] == 100

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
            def __init__(self, user_id: int):
                self.from_user = FakeUser(user_id)
                self.answers: list[tuple[str, dict[str, object]]] = []

            async def answer(self, text: str, **kwargs):
                self.answers.append((text, kwargs))

        class FakeState:
            async def clear(self):
                return None

        async def create_request(user_id: int) -> int:
            message = FakeMessage(user_id)
            await bot.create_binance_deposit_request(
                message,
                FakeState(),
                {"payment_method_id": method_id},
                requested_amount=10,
                credited_amount=10,
            )
            assert "Binance Pay" in message.answers[-1][0]
            assert PAY_ID in message.answers[-1][0]
            assert "TRX (TRC20)" not in message.answers[-1][0]
            connection = sqlite3.connect(db_path)
            try:
                return int(
                    connection.execute(
                        "SELECT id FROM deposit_requests WHERE user_id=? ORDER BY id DESC LIMIT 1",
                        (user_id,),
                    ).fetchone()[0]
                )
            finally:
                connection.close()

        request_id = await create_request(1)
        waiting, _ = await bot.check_binance_request(request_id, TX1)
        assert waiting == "waiting"

        trades.append(
            {
                "orderType": "C2C",
                "transactionId": TX1,
                "transactionTime": int(datetime.datetime.now().timestamp() * 1000),
                "amount": "10.00",
                "currency": "USDT",
            }
        )
        approved, _ = await bot.check_binance_request(request_id, TX1)
        assert approved == "approved"
        connection = sqlite3.connect(db_path)
        try:
            balance = connection.execute("SELECT balance FROM users WHERE user_id=1").fetchone()[0]
            status, reference = connection.execute(
                "SELECT status,transaction_reference FROM deposit_requests WHERE id=?",
                (request_id,),
            ).fetchone()
        finally:
            connection.close()
        assert balance == 10
        assert status == "approved" and reference == TX1

        import storefront_core

        await storefront_core.ensure_schema()
        web_account = await storefront_core.create_account(
            {
                "username": "pay_id_web_user",
                "email": "pay-id@example.test",
                "phone": "+963900000099",
                "first_name": "Pay",
                "last_name": "Customer",
                "country": "SY",
                "password": "StrongPass123!",
            }
        )
        web_invoice = await storefront_core.create_deposit(
            int(web_account["id"]), method_id, 10
        )
        assert web_invoice["payment_channel"] == "binance_pay"
        assert web_invoice["address"] == PAY_ID
        assert web_invoice["network"] == ""
        assert web_invoice["reference_label"] == "Transaction ID"
        trades.append(
            {
                "orderType": "PAY",
                "transactionId": TX3,
                "transactionTime": int(datetime.datetime.now().timestamp() * 1000),
                "amount": "10",
                "currency": "USDT",
            }
        )
        web_result = await storefront_core.verify_auto_deposit(
            int(web_account["id"]), int(web_invoice["id"]), TX3
        )
        assert web_result["status"] == "approved"

        duplicate_id = await create_request(2)
        duplicate, _ = await bot.check_binance_request(duplicate_id, TX1)
        assert duplicate == "duplicate"

        manual_id = await create_request(3)
        api_error = bot.BinanceWalletError(
            "Binance 0: Service unavailable from a restricted location"
        )
        manual, message = await bot.check_binance_request(manual_id, TX2)
        assert manual == "pending_review"
        assert message
        connection = sqlite3.connect(db_path)
        try:
            manual_status, manual_reference, proof = connection.execute(
                "SELECT status,transaction_reference,proof_content FROM deposit_requests WHERE id=?",
                (manual_id,),
            ).fetchone()
        finally:
            connection.close()
        assert manual_status == "pending"
        assert manual_reference == TX2 and proof == TX2
        buttons = bot.admin_deposit_detail_kb(manual_id, manual_status)
        assert any(
            button.callback_data == f"admin_dep_approve_{manual_id}"
            for row in buttons.inline_keyboard
            for button in row
        )

        assert bot._normalize_binance_pay_trade(
            {
                "orderType": "C2C",
                "transactionId": "M_P_123456",
                "transactionTime": 1,
                "amount": "-10",
                "currency": "USDT",
            }
        ) is None
        assert bot._normalize_binance_pay_trade(
            {
                "orderType": "PAYOUT",
                "transactionId": "M_P_123456",
                "transactionTime": 1,
                "amount": "10",
                "currency": "USDT",
            }
        ) is None

        print("Binance Pay ID offline integration smoke test passed.")


if __name__ == "__main__":
    asyncio.run(main())
