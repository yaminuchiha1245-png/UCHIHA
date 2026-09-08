#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Launch the isolated client services store on top of UCHIHA Store."""

import bot as store_app
from client_api_sync import install as install_client_api_sync
from client_services_store import install as install_client_services_store
from client_store_admin import install as install_client_store_admin
from storefront_launcher import main as storefront_main


def main() -> None:
    install_client_services_store(store_app)
    install_client_api_sync(store_app)
    install_client_store_admin(store_app)
    storefront_main()


if __name__ == "__main__":
    main()
