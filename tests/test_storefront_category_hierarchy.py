from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import aiosqlite

import storefront_admin_theme
import storefront_theme
from storefront_category_hierarchy_data import (
    augment_categories,
    ensure_schema,
    validate_parent,
)
from storefront_category_hierarchy_admin_ui import patch_admin_html
from storefront_category_hierarchy_ui import patch_storefront_html
from storefront_hardening import patch_storefront_html as patch_hardening_html
from storefront_management_admin_ui import patch_admin_html as patch_management_admin
from storefront_management_ui import patch_storefront_html as patch_management_html
from storefront_signup_experience import patch_signup_html


class FakeStorefrontError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class FakeCore:
    StorefrontError = FakeStorefrontError

    def __init__(self, path: Path) -> None:
        self._path = path

    def db_path(self) -> Path:
        return self._path

    @staticmethod
    def now_text() -> str:
        return "2026-07-24 00:00:00"


class CategoryHierarchyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "store.db"
        self.core = FakeCore(self.db_path)
        self.api = SimpleNamespace(core=self.core)
        async with aiosqlite.connect(self.db_path) as db:
            await db.executescript(
                """
                CREATE TABLE categories(
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    display_name TEXT DEFAULT '',
                    parent_id INTEGER DEFAULT 0,
                    local_parent_id INTEGER,
                    sort_order INTEGER DEFAULT 0,
                    local_sort_order INTEGER,
                    is_hidden INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    is_virtual INTEGER DEFAULT 0,
                    api_provider TEXT DEFAULT '',
                    api_id INTEGER DEFAULT 0
                );
                CREATE TABLE products(
                    id INTEGER PRIMARY KEY,
                    category_id INTEGER,
                    is_active INTEGER DEFAULT 1,
                    stock INTEGER DEFAULT 1
                );
                CREATE TABLE storefront_category_media(
                    category_id INTEGER PRIMARY KEY,
                    image_blob BLOB,
                    image_mime TEXT DEFAULT '',
                    accent TEXT DEFAULT '#e4313f',
                    updated_at TEXT DEFAULT ''
                );
                INSERT INTO categories(id,name,display_name,parent_id,local_parent_id,sort_order)
                VALUES
                    (1,'ai','الذكاء الاصطناعي',0,NULL,10),
                    (2,'chat','نماذج المحادثة',1,NULL,10),
                    (3,'gpt','ChatGPT',2,NULL,10);
                INSERT INTO products(id,category_id,is_active,stock) VALUES(1,3,1,5);
                """
            )
            await db.commit()
        await ensure_schema(self.core)

    async def asyncTearDown(self) -> None:
        self.temp.cleanup()

    async def test_schema_and_category_augmentation(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO storefront_category_presentation(category_id,description,badge,updated_at) VALUES(1,?,?,?)",
                ("أدوات ونماذج الذكاء الاصطناعي", "مميز", "2026-07-24 00:00:00"),
            )
            await db.commit()
            db.row_factory = aiosqlite.Row
            items = [
                {"id": 1, "name": "الذكاء الاصطناعي", "parent_id": 0, "product_count": 1, "image_url": "/1"},
                {"id": 2, "name": "نماذج المحادثة", "parent_id": 1, "product_count": 1, "image_url": "/2"},
                {"id": 3, "name": "ChatGPT", "parent_id": 2, "product_count": 1, "image_url": "/3"},
            ]
            result = await augment_categories(self.api, db, items)
        self.assertEqual(result[0]["child_count"], 1)
        self.assertTrue(result[0]["has_children"])
        self.assertEqual(result[0]["description"], "أدوات ونماذج الذكاء الاصطناعي")
        self.assertEqual(result[0]["badge"], "مميز")
        self.assertEqual(result[2]["direct_product_count"], 1)
        self.assertFalse(result[2]["has_children"])

    async def test_cycle_is_rejected_but_new_nested_category_is_allowed(self) -> None:
        with self.assertRaises(FakeStorefrontError) as context:
            await validate_parent(self.api, 1, 3)
        self.assertEqual(context.exception.code, "category_cycle")
        await validate_parent(self.api, 0, 2)

    def test_customer_and_admin_html_patches_compose(self) -> None:
        customer = patch_management_html(storefront_theme.STOREFRONT_HTML)
        customer = patch_hardening_html(customer)
        customer = patch_signup_html(customer)
        customer = patch_storefront_html(customer)
        self.assertIn('id="categoryBreadcrumbs"', customer)
        self.assertIn("categoryChildren(parentId)", customer)
        self.assertIn("signupCountries=[", customer)
        self.assertIn("purchaseIntent", customer)

        admin = patch_management_admin(storefront_admin_theme.ADMIN_HTML)
        admin = patch_admin_html(admin)
        self.assertIn("flatCategoryTree", admin)
        self.assertIn('id="addCategory"', admin)
        self.assertIn("/v1/storefront/admin/category-tree", admin)


if __name__ == "__main__":
    unittest.main()
