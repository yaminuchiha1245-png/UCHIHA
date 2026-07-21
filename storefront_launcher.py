#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Start UCHIHA with the public storefront theme and safe Telegram deep links.

This integration layer intentionally leaves the large bot and platform cores
untouched. Railway starts this file, which applies the web theme, installs a
high-priority /start product_<id> handler, then delegates to uchiha.py.
"""

from __future__ import annotations

import os
import re

# Keep the owner-configured URL authoritative while