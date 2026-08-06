"""Owner-managed branding, policies, currencies, and product overrides."""
from __future__ import annotations
from typing import Any
from storefront_management_admin_ui import patch_admin_html
from storefront_management_data import (
    _install_catalog,
    _install_schema_and_settings,
    ensure_management_schema,
    parse_exchange_rates,
)
from storefront_management_routes import _install_routes
from storefront_management_ui import patch_storefront_html


def _install_html(api_module: Any) -> None:
    import storefront_theme
    import storefront_admin_theme

    storefront_theme.STOREFRONT_HTML = patch_storefront_html(storefront_theme.STOREFRONT_HTML)
    storefront_admin_theme.ADMIN_HTML = patch_admin_html(storefront_admin_theme.ADMIN_HTML)
    api_module._STOREFRONT_HTML = storefront_theme.STOREFRONT_HTML


def install(api_module: Any) -> None:
    if getattr(api_module, "_storefront_management_installed", False):
        return
    _install_schema_and_settings(api_module)
    _install_catalog(api_module)
    _install_routes(api_module)
    _install_html(api_module)
    api_module._storefront_management_installed = True

    # Category hierarchy is additive and installs after the existing management
    # HTML so the owner keeps one unified admin experience.
    from storefront_category_hierarchy import install as install_category_hierarchy

    install_category_hierarchy(api_module)

    # Apply the professional demo-store owner-panel skin last so it can normalize
    # every section added by management and category hierarchy.
    import storefront_admin_theme
    from storefront_admin_demo_parity import patch_admin_html as patch_admin_demo_parity

    storefront_admin_theme.ADMIN_HTML = patch_admin_demo_parity(storefront_admin_theme.ADMIN_HTML)


__all__ = [
    "ensure_management_schema",
    "install",
    "parse_exchange_rates",
    "patch_admin_html",
    "patch_storefront_html",
]
