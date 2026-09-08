from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from client_provider_wizard import _provider_token
from client_services_store import ProviderStates


class ClientProviderWizardTests(unittest.IsolatedAsyncioTestCase):
    def _store(self):
        return SimpleNamespace(
            is_admin=AsyncMock(return_value=True),
            is_super_admin=AsyncMock(return_value=True),
            get_admin_perms=AsyncMock(return_value={}),
        )

    async def test_public_api_accepts_without_token_keyword(self) -> None:
        store = self._store()
        state = SimpleNamespace(
            update_data=AsyncMock(),
            set_state=AsyncMock(),
            clear=AsyncMock(),
        )
        message = SimpleNamespace(
            text="بدون",
            from_user=SimpleNamespace(id=1),
            answer=AsyncMock(),
            delete=AsyncMock(),
        )

        with patch("client_provider_wizard._encrypt") as encrypt:
            await _provider_token(store, message, state)

        encrypt.assert_not_called()
        state.update_data.assert_awaited_once_with(
            token_cipher="",
            token_fingerprint="",
            provider_auth_mode="none",
        )
        state.set_state.assert_awaited_once_with(ProviderStates.catalog_path)
        message.delete.assert_not_called()
        self.assertIn("بدون مصادقة", message.answer.await_args.args[0])

    async def test_real_token_is_encrypted_and_message_deleted(self) -> None:
        store = self._store()
        state = SimpleNamespace(
            update_data=AsyncMock(),
            set_state=AsyncMock(),
            clear=AsyncMock(),
        )
        message = SimpleNamespace(
            text="provider-secret-123",
            from_user=SimpleNamespace(id=1),
            answer=AsyncMock(),
            delete=AsyncMock(),
        )

        with patch("client_provider_wizard._encrypt", return_value=("cipher", "fingerprint")) as encrypt:
            await _provider_token(store, message, state)

        encrypt.assert_called_once_with(store, "provider-secret-123")
        state.update_data.assert_awaited_once_with(
            token_cipher="cipher",
            token_fingerprint="fingerprint",
            provider_auth_mode="auto",
        )
        state.set_state.assert_awaited_once_with(ProviderStates.catalog_path)
        message.delete.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
