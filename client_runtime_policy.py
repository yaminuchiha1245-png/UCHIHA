from __future__ import annotations

import os
from typing import MutableMapping


LEGACY_SECRET_KEYS = (
    "API_TOKEN",
    "BINANCE_API_KEY",
    "BINANCE_API_SECRET",
    "TRONGRID_API_KEY",
    "SHAMCASH_API_TOKEN",
)

LEGACY_PROVIDER_KEYS = (
    "BINANCE_DEPOSIT_ADDRESS",
    "BINANCE_PAY_ID",
    "SHAMCASH_API_BASE_URL",
    "SHAMCASH_API_ACCOUNT_ID",
)

FORCED_CLIENT_FLAGS = {
    "SYNC_ON_START": "false",
    "BINANCE_AUTO_PAY_ENABLED": "false",
    "SHAMCASH_API_ENABLED": "0",
    "ORDER_STATUS_MONITOR_ENABLED": "false",
    "STOREFRONT_WEB_ENABLED": "0",
    "STOREFRONT_API_ENABLED": "0",
    "STOREFRONT_PUBLIC_CATALOG_ENABLED": "0",
}


def isolate_client_environment(env: MutableMapping[str, str] | None = None) -> None:
    """Remove inherited legacy provider values and force client-safe switches.

    BOT_TOKEN, ADMIN_ID and CLIENT_* settings are intentionally untouched.
    """
    target = env if env is not None else os.environ
    for key in (*LEGACY_SECRET_KEYS, *LEGACY_PROVIDER_KEYS):
        target.pop(key, None)
    target.update(FORCED_CLIENT_FLAGS)
