"""Keep owner callback navigation on one Telegram message whenever possible.

Text-to-text transitions edit the current bot message. Telegram cannot turn a
photo into a text message, or the reverse, so those transitions replace the
message and retire its previous keyboard. A command or typed FSM answer is
still a new message; this module is for callback-driven owner navigation.
"""

from __future__ import annotations

from contextlib import suppress


async def _retire_old_message(message):
    try:
        await message.delete()
    except Exception:
        # When Telegram rejects deletion, keep the old message read-only.
        with suppress(Exception):
            await message.edit_reply_markup(reply_markup=None)


async def replace_text(message, text, *, reply_markup=None, **kwargs):
    if getattr(message, "text", None) is not None and callable(getattr(message, "edit_text", None)):
        try:
            return await message.edit_text(text, reply_markup=reply_markup, **kwargs)
        except Exception as exc:
            error = str(exc).lower()
            if "message is not modified" in error:
                return message
            # Do not silently create more menus for unexpected API failures.
            if not any(part in error for part in (
                "message to edit not found", "there is no text in the message",
            )):
                raise
    # Telegram cannot edit a media message into a plain-text message.
    newer = await message.answer(text, reply_markup=reply_markup, **kwargs)
    await _retire_old_message(message)
    return newer


class EditablePanelMessage:
    """Duck-typed Message for existing helpers called from owner callbacks."""

    def __init__(self, message, back_markup=None):
        self.original = message
        self.back_markup = back_markup

    def __getattr__(self, name):
        return getattr(self.original, name)

    async def answer(self, text, *, reply_markup=None, **kwargs):
        return await replace_text(
            self.original, text,
            reply_markup=reply_markup if reply_markup is not None else self.back_markup,
            **kwargs,
        )

    async def answer_photo(self, photo, *, caption=None, reply_markup=None, **kwargs):
        markup = reply_markup if reply_markup is not None else self.back_markup
        if getattr(self.original, "photo", None):
            from aiogram.types import InputMediaPhoto

            try:
                return await self.original.edit_media(
                    InputMediaPhoto(media=photo, caption=caption, **kwargs),
                    reply_markup=markup,
                )
            except Exception as exc:
                if "message is not modified" in str(exc).lower():
                    return self.original
                if "message to edit not found" not in str(exc).lower():
                    raise
        newer = await self.original.answer_photo(
            photo, caption=caption, reply_markup=markup, **kwargs,
        )
        await _retire_old_message(self.original)
        return newer
