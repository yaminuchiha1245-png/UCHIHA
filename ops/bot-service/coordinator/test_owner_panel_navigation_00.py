"""Offline owner-panel navigation regression: no tokens, HTTP or database."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "bot-engine"))
from panel_navigation import EditablePanelMessage, replace_text


class DummyMessage:
    def __init__(self, text="old", photo=None, edit_error=None, delete_error=None):
        self.text = text
        self.photo = photo
        self.edit_error = edit_error
        self.delete_error = delete_error
        self.message_id = 123
        self.sent = []
        self.edited = []
        self.deleted = 0
        self.disabled = 0

    async def edit_text(self, text, **kwargs):
        if self.edit_error:
            raise RuntimeError(self.edit_error)
        self.edited.append((text, kwargs))
        return self

    async def answer(self, text, **kwargs):
        self.sent.append(("text", text, kwargs))
        return DummyMessage(text=text)

    async def answer_photo(self, photo, **kwargs):
        self.sent.append(("photo", photo, kwargs))
        return DummyMessage(text=None, photo=[photo])

    async def delete(self):
        self.deleted += 1
        if self.delete_error:
            raise RuntimeError(self.delete_error)

    async def edit_reply_markup(self, **kwargs):
        self.disabled += 1


class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_text_to_text(self):
        msg = DummyMessage()
        self.assertIs(await replace_text(msg, "next", reply_markup="nav"), msg)
        self.assertEqual(msg.edited, [("next", {"reply_markup": "nav"})])
        self.assertEqual(msg.sent, [])

    async def test_photo_to_text(self):
        msg = DummyMessage(text=None, photo=["logo"])
        await replace_text(msg, "orders")
        self.assertEqual(len(msg.sent), 1)
        self.assertEqual(msg.deleted, 1)

    async def test_undeletable_photo_disables_buttons(self):
        msg = DummyMessage(text=None, photo=["logo"], delete_error="restricted")
        await replace_text(msg, "orders")
        self.assertEqual(msg.disabled, 1)

    async def test_no_duplicate_if_unchanged(self):
        msg = DummyMessage(edit_error="message is not modified")
        await replace_text(msg, "same")
        self.assertEqual(msg.sent, [])

    async def test_unexpected_failure_does_not_add_messages(self):
        msg = DummyMessage(edit_error="Forbidden")
        with self.assertRaises(RuntimeError):
            await replace_text(msg, "screen")
        self.assertEqual(msg.sent, [])

    async def test_legacy_message_without_edit_method(self):
        msg = DummyMessage()
        msg.edit_text = None
        await replace_text(msg, "fresh")
        self.assertEqual(len(msg.sent), 1)
        self.assertEqual(msg.deleted, 1)

    async def test_fallback_if_missing_old_message(self):
        msg = DummyMessage(edit_error="message to edit not found")
        await replace_text(msg, "new")
        self.assertEqual(len(msg.sent), 1)

    async def test_default_back_button(self):
        msg = DummyMessage()
        await EditablePanelMessage(msg, "back").answer("screen")
        self.assertEqual(msg.edited[0][1]["reply_markup"], "back")

    async def test_text_to_photo(self):
        msg = DummyMessage()
        await EditablePanelMessage(msg).answer_photo(b"logo", caption="home")
        self.assertEqual(msg.sent[0][0], "photo")
        self.assertEqual(msg.deleted, 1)

    def test_owner_callbacks_are_inplace(self):
        root = Path(__file__).resolve().parents[1] / "apps" / "bot-engine"
        central = (root / "main.py").read_text()
        merchant = (root / "merchant_admin_panel.py").read_text()
        body = central.split("@router.callback_query(F.data == 'admin:home')", 1)[1]
        body = body.split("dp.include_router(router)", 1)[0]
        self.assertNotIn("await call.message.answer(", body)
        self.assertNotIn("display_users(call.message,", body)
        self.assertNotIn("await call.message.answer(", merchant)
        self.assertNotIn("show_categories(call.message,", merchant)


if __name__ == "__main__":
    unittest.main()
