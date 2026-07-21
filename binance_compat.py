#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compatibility helpers for legacy Binance Railway variables.

This module never logs or persists API keys. It only normalizes names and
network aliases before ``bot.py`` reads its environment.
"""

from __future__ import annotations

import os
from collections.abc import MutableMapping

_TRUE_VALUES = {"1", "true", "yes", "on", "enabled", "enable"}
_FALSE_VALUES = {"0", "false", "no", "off", "disabled", "disable", ""}
_NETWORK_ALIASES = {
    "TRC20": "TRX",
    "TRON": "TRX",
    "BEP20": "BSC",
    "BSC20": "BSC",
    "ERC20": "ETH",
    "ETHEREUM": "ETH",
    "SOLANA": "SOL",
    "POLYGON": "MATIC",
}


def _first_present(env: MutableMapping[str, str], *names: str) -> str:
    for name in names:
        value = str(env.get(name, "")).strip()
        if value:
            return value
    return ""


def _normalize_flag(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in _TRUE_VALUES:
        return "1"
    if normalized in _FALSE_VALUES:
        return "0"
    return value


def normalize_binance_network(value: str) -> str:
    network = str(value or "TRX").strip().upper() or "TRX"
    return _NETWORK_ALIASES.get(network, network)


def prepare_binance_environment(
    env: MutableMapping[str, str] | None = None,
) -> dict[str, str | bool]:
    """Map legacy variable names to the canonical Binance configuration."""

    target = os.environ if env is None else env

    # An explicitly non-empty canonical value wins. An empty canonical value
    # must not block a valid legacy variable, which was the original bug.
    canonical_enabled = str(target.get("BINANCE_AUTO_PAY_ENABLED", "")).strip()
    if not canonical_enabled:
        legacy_enabled = _first_present(
            target,
            "BINANCE_PAYMENT_ENABLED",
            "BINANCE_PAY_ENABLED",
            "BINANCE_ENABLED",
        )
        if legacy_enabled:
            target["BINANCE_AUTO_PAY_ENABLED"] = _normalize_flag(legacy_enabled)

    aliases = {
        "BINANCE_API_KEY": ("BINANCE_KEY",),
        "BINANCE_API_SECRET": ("BINANCE_SECRET", "BINANCE_SECRET_KEY"),
        "BINANCE_DEPOSIT_ADDRESS": (
            "BINANCE_USDT_ADDRESS",
            "USDT_DEPOSIT_ADDRESS",
            "USDT_ADDRESS",
        ),
    }
    for canonical, legacy_names in aliases.items():
        if not str(target.get(canonical, "")).strip():
            value = _first_present(target, *legacy_names)
            if value:
                target[canonical] = value

    coin = str(target.get("BINANCE_COIN", "USDT")).strip().upper() or "USDT"
    target["BINANCE_COIN"] = coin
    target["BINANCE_NETWORK"] = normalize_binance_network(target.get("BINANCE_NETWORK", "TRX"))

    enabled = _normalize_flag(str(target.get("BINANCE_AUTO_PAY_ENABLED", "0"))) == "1"
    target["BINANCE_AUTO_PAY_ENABLED"] = "1" if enabled else "0"

    return {
        "enabled": enabled,
        "api_key_present": bool(str(target.get("BINANCE_API_KEY", "")).strip()),
        "api_secret_present": bool(str(target.get("BINANCE_API_SECRET", "")).strip()),
        "deposit_address_present": bool(str(target.get("BINANCE_DEPOSIT_ADDRESS", "")).strip()),
        "coin": target["BINANCE_COIN"],
        "network": target["BINANCE_NETWORK"],
    }


__all__ = ["prepare_binance_environment", "normalize_binance_network"]
