#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Safe launcher for UCHIHA storefront deployment.

The core bot remains the owner of orders, payments and delivery.
The storefront only provides the web experience and deep-link handoff.
"""

from __future__ import annotations

import asyncio
import os
import sys


def main() -> None:
    """Delegate startup to the existing UCHIHA core."""
    os.environ.setdefault("STOREFRONT_WEB_ENABLED", "1")
    os.environ.setdefault("STOREFRONT_API_ENABLED", "1")
    os.execv(sys.executable, [sys.executable, "uchiha.py"])


if __name__ == "__main__":
    main()
