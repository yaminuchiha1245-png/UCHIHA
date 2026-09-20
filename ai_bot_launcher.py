#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import logging
import os
import sys

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from dotenv import load_dotenv

import ai_bot_core as core
from ai_bot_ui import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s")
logger = logging.getLogger("uchiha_ai")


async def main() -> None:
    load_dotenv()
    bot_secret = os.getenv("AI_BOT_TOKEN", "").strip()
    if not bot_secret:
        raise RuntimeError("AI_BOT_TOKEN is required in the server environment.")
    admin = os.getenv("AI_ADMIN_ID", os.getenv("ADMIN_ID", "0")).strip()
    if not admin.isdigit() or int(admin) <= 0:
        raise RuntimeError("AI_ADMIN_ID must contain the Telegram owner id.")
    await core.ensure_schema()
    bot = Bot(token=bot_secret)
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(router)
    info = await bot.get_me()
    logger.info("UCHIHA AI started as @%s (id=%s)", info.username, info.id)
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await bot.session.close()


if __name__ == "__main__":
    if sys.version_info < (3, 12):
        raise RuntimeError("UCHIHA AI requires Python 3.12 or newer.")
    asyncio.run(main())
