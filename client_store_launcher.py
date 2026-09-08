#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Launch the isolated client Telegram services store.

This launcher intentionally does not use storefront_launcher.py. The legacy
storefront launcher installs JS4Card/Binance/ShamCash/web integrations that
belong to the original UCHIHA Store and would violate per-client secret
isolation.
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv

from client_runtime_policy import isolate_client_environment

load_dotenv()
isolate_client_environment()

if not os.getenv("BOT_TOKEN", "").strip() or not os.getenv("ADMIN_ID", "").strip():
    raise SystemExit(
        "إعداد نسخة العميل غير مكتمل. شغّل أولًا: python client_setup.py"
    )

# Import the base Telegram store only after the environment is isolated so its
# module-level configuration cannot read a previous client's provider secrets.
import bot as store_app

from client_admin_cleanup import install as install_client_admin_cleanup
from client_api_purchase_runtime import install as install_client_api_purchase_runtime
from client_api_status import install as install_client_api_status
from client_api_sync import install as install_client_api_sync
from client_backup import backup_loop, install as install_client_backup
from client_catalog_tools import install as install_client_catalog_tools
from client_customer_center import install as install_client_customer_center
from client_identity import install as install_client_identity
from client_order_fields import install as install_client_order_fields
from client_payment_policy import install as install_client_payment_policy
from client_provider_admin import install as install_client_provider_admin
from client_provider_wizard import install as install_client_provider_wizard
from client_purchase_admin import install as install_client_purchase_admin
from client_reseller_admin import install as install_client_reseller_admin
from client_services_store import install as install_client_services_store
from client_state_hygiene import install as install_client_state_hygiene
from client_store_admin import install as install_client_store_admin
from client_ui_refinement import install as install_client_ui_refinement


def install_client_modules() -> None:
    install_client_services_store(store_app)
    install_client_api_sync(store_app)
    install_client_provider_admin(store_app)
    install_client_store_admin(store_app)
    install_client_provider_wizard(store_app)
    install_client_ui_refinement(store_app)
    install_client_catalog_tools(store_app)
    install_client_order_fields(store_app)
    # API purchase runtime must be installed after order fields so it can extend
    # the same buy button while preserving the manual-product flow.
    install_client_api_purchase_runtime(store_app)
    install_client_purchase_admin(store_app)
    install_client_api_status(store_app)
    install_client_identity(store_app)
    install_client_reseller_admin(store_app)
    install_client_customer_center(store_app)
    install_client_payment_policy(store_app)
    install_client_backup(store_app)
    install_client_state_hygiene(store_app)
    # Must be last so it can consolidate buttons added by all client modules.
    install_client_admin_cleanup(store_app)


async def run_client() -> None:
    """Run Telegram polling and the local backup worker as sibling tasks."""
    bot_task = asyncio.create_task(store_app.main(), name="client-store-bot")
    backup_task = asyncio.create_task(backup_loop(store_app), name="client-store-backup")
    try:
        await bot_task
    finally:
        backup_task.cancel()
        try:
            await backup_task
        except asyncio.CancelledError:
            pass
        if not bot_task.done():
            bot_task.cancel()


def main() -> None:
    install_client_modules()
    asyncio.run(run_client())


if __name__ == "__main__":
    main()
