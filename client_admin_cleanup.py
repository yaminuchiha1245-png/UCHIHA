from __future__ import annotations

from typing import Any

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


# Buttons inherited from the original UCHIHA Store that conflict with the
# isolated client catalog. The underlying handlers remain untouched on main;
# this module only cleans the client instance navigation.
_REMOVE_EXACT = {
    "admin_categories",
    "admin_products",
    "admin_profit_margin",
    "admin_api_sync_now",
    "admin_api_full_sync",
    "admin_api_sync_status",
    "cli:providers",
    "clisync:list",
    "cli:staged:unorganized",
    "cli:staged:organized",
}

_REMOVE_PREFIXES = (
    "admin_api_categories",
    "admin_manage_api_products",
)


def _should_remove(callback_data: str | None) -> bool:
    value = str(callback_data or "")
    if value in _REMOVE_EXACT:
        return True
    return any(value.startswith(prefix) for prefix in _REMOVE_PREFIXES)


def _clean_admin_panel(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        cleaned: list[list[InlineKeyboardButton]] = []
        seen_callbacks: set[str] = set()

        for row in markup.inline_keyboard:
            next_row: list[InlineKeyboardButton] = []
            for button in row:
                callback_data = getattr(button, "callback_data", None)
                if _should_remove(callback_data):
                    continue
                callback_key = str(callback_data or "")
                if callback_key and callback_key in seen_callbacks:
                    continue
                if callback_key:
                    seen_callbacks.add(callback_key)
                next_row.append(button)
            if next_row:
                cleaned.append(next_row)

        # Make the client-store entry explicit and keep it near the catalog/admin
        # controls instead of scattering provider/sync buttons across the panel.
        has_client_home = any(
            getattr(button, "callback_data", None) == "cliadmin:home"
            for row in cleaned
            for button in row
        )
        p = perms or {}
        if not has_client_home and (
            super_admin or p.get("can_manage_products") or p.get("can_manage_sync")
        ):
            home_index = next(
                (
                    index
                    for index, row in enumerate(cleaned)
                    if any(getattr(button, "callback_data", None) == "main_menu" for button in row)
                ),
                len(cleaned),
            )
            cleaned.insert(
                home_index,
                [
                    InlineKeyboardButton(
                        text="🧰 إدارة متجر العميل",
                        callback_data="cliadmin:home",
                    )
                ],
            )

        return InlineKeyboardMarkup(inline_keyboard=cleaned)

    return wrapped


def install(store: Any) -> None:
    if getattr(store, "_client_admin_cleanup_installed", False):
        return
    store.admin_panel_kb = _clean_admin_panel(store.admin_panel_kb)
    store._client_admin_cleanup_installed = True
