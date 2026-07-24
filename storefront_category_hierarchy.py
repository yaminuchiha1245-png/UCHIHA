"""Install recursive category browsing and owner category controls."""
from __future__ import annotations
from typing import Any

from storefront_category_hierarchy_admin_ui import patch_admin_html
from storefront_category_hierarchy_data import ensure_schema, install_catalog
from storefront_category_hierarchy_routes import install_routes
from storefront_category_hierarchy_ui import patch_storefront_html


def install(api_module: Any) -> None:
    if getattr(api_module, "_storefront_category_hierarchy_installed", False):
        return
    install_catalog(api_module)
    install_routes(api_module)
    import storefront_admin_theme
    import storefront_theme
    customer = patch_storefront_html(api_module._STOREFRONT_HTML)
    admin = patch_admin_html(storefront_admin_theme.ADMIN_HTML)
    api_module._STOREFRONT_HTML = customer
    storefront_theme.STOREFRONT_HTML = customer
    storefront_admin_theme.ADMIN_HTML = admin
    api_module._storefront_category_hierarchy_installed = True


__all__ = ["ensure_schema", "install"]
