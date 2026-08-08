from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ai_bot_core as core


class AIBotCoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.tmp.name) / "ai-test.db")
        self.env = patch.dict(os.environ, {"AI_DB_PATH": self.db}, clear=False)
        self.env.start()
        await core.ensure_schema()

    async def asyncTearDown(self) -> None:
        self.env.stop()
        self.tmp.cleanup()

    async def test_seeds_free_and_pro_models(self) -> None:
        models = await core.list_models()
        self.assertGreaterEqual(len(models), 2)
        self.assertEqual(models[0].display_name, "UCHIHA AI V1")
        self.assertEqual(models[0].access_level, "free")
        self.assertEqual(models[1].display_name, "UCHIHA AI V2")
        self.assertEqual(models[1].access_level, "pro")

    async def test_pro_model_is_locked_until_admin_grants_pro(self) -> None:
        user_id = 778899
        await core.upsert_user(user_id, "test", "Test User")
        models = await core.list_models()
        pro_model = next(item for item in models if item.access_level == "pro")

        with self.assertRaises(core.AIProductError) as caught:
            await core.set_active_model(user_id, pro_model.id)
        self.assertEqual(caught.exception.code, "pro_required")

        await core.set_pro(user_id, 30)
        selected = await core.set_active_model(user_id, pro_model.id)
        self.assertEqual(selected.id, pro_model.id)
        self.assertTrue(await core.is_pro(user_id))

    async def test_admin_can_change_commercial_name_without_changing_provider_id(self) -> None:
        model = (await core.list_models())[0]
        old_provider = model.provider_model
        updated = await core.update_model(model.id, display_name="MY AI BASIC")
        self.assertEqual(updated.display_name, "MY AI BASIC")
        self.assertEqual(updated.provider_model, old_provider)

    async def test_expired_pro_falls_back_to_free_model(self) -> None:
        user_id = 990011
        await core.upsert_user(user_id)
        models = await core.list_models()
        pro_model = next(item for item in models if item.access_level == "pro")
        await core.set_pro(user_id, 1)
        await core.set_active_model(user_id, pro_model.id)
        await core.set_pro(user_id, 0)
        _, active, _ = await core.active_context(user_id)
        self.assertEqual(active.access_level, "free")


if __name__ == "__main__":
    unittest.main()
