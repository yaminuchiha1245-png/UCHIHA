from __future__ import annotations

from typing import Any
from urllib.parse import quote

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


DEVELOPER_WHATSAPP_NUMBER = "963942586044"
DEVELOPER_BUTTON_TEXT = "👨‍💻 المبرمج"


def developer_whatsapp_url() -> str:
    message = "مرحباً، أريد التواصل مع مبرمج ZIKO STORE."
    return f"https://wa.me/{DEVELOPER_WHATSAPP_NUMBER}?text={quote(message)}"


def _wrap_main_menu(original: Any):
    def wrapped(is_admin_user: bool = False) -> InlineKeyboardMarkup:
        markup = original(is_admin_user)
        rows: list[list[InlineKeyboardButton]] = []

        # Remove any previous copy so repeated installation/wrapping never
        # creates duplicate developer buttons.
        for row in markup.inline_keyboard:
            filtered = [
                button
                for button in row
                if not (
                    str(getattr(button, "text", "") or "") == DEVELOPER_BUTTON_TEXT
                    or str(getattr(button, "url", "") or "").startswith(
                        f"https://wa.me/{DEVELOPER_WHATSAPP_NUMBER}"
                    )
                )
            ]
            if filtered:
                rows.append(filtered)

        developer_row = [
            InlineKeyboardButton(
                text=DEVELOPER_BUTTON_TEXT,
                url=developer_whatsapp_url(),
            )
        ]

        # Keep the admin button last for admins; the public developer contact
        # sits immediately above it. For normal users it becomes the last row.
        admin_index = next(
            (
                index
                for index, row in enumerate(rows)
                if any(
                    str(getattr(button, "callback_data", "") or "") == "admin_panel"
                    for button in row
                )
            ),
            len(rows),
        )
        rows.insert(admin_index, developer_row)
        return InlineKeyboardMarkup(inline_keyboard=rows)

    return wrapped


def install(store: Any) -> None:
    if getattr(store, "_client_developer_contact_installed", False):
        return
    store.main_menu_kb = _wrap_main_menu(store.main_menu_kb)
    store._client_developer_contact_installed = True
