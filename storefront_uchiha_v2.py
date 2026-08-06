"""Compatibility bridge for the retired UCHIHA v2 storefront skin.

The previous playful theme was rejected. Existing imports now delegate to the
professional demo-parity layer so deployment code does not need a risky rewrite.
"""
from __future__ import annotations

from typing import Any

from storefront_demo_parity import patch_storefront_html


def install(api_module: Any) -> None:
    if getattr(api_module, "_storefront_demo_parity_installed", False):
        return
    import storefront_theme

    customer = patch_storefront_html(api_module._STOREFRONT_HTML)
    api_module._STOREFRONT_HTML = customer
    storefront_theme.STOREFRONT_HTML = customer
    api_module._storefront_demo_parity_installed = True


__all__ = ["install", "patch_storefront_html"]
