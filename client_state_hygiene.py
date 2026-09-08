from __future__ import annotations

from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery


class ClientNavigationStateMiddleware(BaseMiddleware):
    """Clear stale FSM input when the user deliberately navigates away from a flow."""

    NAVIGATION_EXACT = {
        "main_menu",
        "admin_panel",
        "cliadmin:home",
        "clifields:list",
        "clicat:summary",
    }
    NAVIGATION_PREFIXES = (
        "cli:root:",
        "cli:sub:",
        "cli:product:",
    )

    async def __call__(
        self,
        handler: Callable[[CallbackQuery, dict[str, Any]], Awaitable[Any]],
        event: CallbackQuery,
        data: dict[str, Any],
    ) -> Any:
        callback_data = str(getattr(event, "data", "") or "")
        should_clear = (
            callback_data in self.NAVIGATION_EXACT
            or callback_data.startswith(self.NAVIGATION_PREFIXES)
        )
        if should_clear:
            state = data.get("state")
            if state is not None:
                try:
                    await state.clear()
                except Exception:
                    pass
        return await handler(event, data)


def install(store: Any) -> None:
    if getattr(store, "_client_state_hygiene_installed", False):
        return
    store.dp.callback_query.outer_middleware(ClientNavigationStateMiddleware())
    store._client_state_hygiene_installed = True
