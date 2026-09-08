#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Launch the isolated client services store on top of UCHIHA Store."""

import os

from dotenv import load_dotenv

load_dotenv()

if not os.getenv("BOT_TOKEN", "").strip() or not os.getenv("ADMIN_ID", "").strip():
    raise SystemExit(
        "إعداد نسخة العميل غير مكتمل. شغّل أولًا: python client_setup.py"
    )

# Client instances should not inherit UCHIHA Store provider/web automation by default.
# The owner may explicitly override any of these values in the runtime environment.
os.environ.setdefault("SYNC_ON_START", "false")
os.environ.setdefault("BINANCE_AUTO_PAY_ENABLED", "false")
os.environ.setdefault("STOREFRONT_WEB_ENABLED", "0")
os.environ.setdefault("STOREFRONT_API_ENABLED", "0")
os.environ.setdefault("STOREFRONT_PUBLIC_CATALOG_ENABLED", "0")

import bot as store_app
from client_api_sync import install as install_client_api_sync
from client_catalog_tools import install as install_client_catalog_tools
from client_order_fields import install as install_client_order_fields
from client_services_store import install as install_client_services_store
from client_provider_admin import install as install_client_provider_admin
from client_store_admin import install as install_client_store_admin
from client_ui_refinement import install as install_client_ui_refinement
from storefront_launcher import main as storefront_main


def main() -> None:
    install_client_services_store(store_app)
    install_client_api_sync(store_app)
    install_client_provider_admin(store_app)
    install_client_store_admin(store_app)
    install_client_ui_refinement(store_app)
    install_client_catalog_tools(store_app)
    install_client_order_fields(store_app)
    storefront_main()


if __name__ == "__main__":
    main()
