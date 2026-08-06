from __future__ import annotations

import unittest

from storefront_admin_demo_parity import patch_admin_html
from storefront_admin_theme import ADMIN_HTML
from storefront_category_hierarchy_admin_ui import patch_admin_html as patch_category_admin
from storefront_management_admin_ui import patch_admin_html as patch_management_admin


class AdminDemoParityTests(unittest.TestCase):
    def admin_document(self) -> str:
        document = patch_management_admin(ADMIN_HTML)
        document = patch_category_admin(document)
        return patch_admin_html(document)

    def test_equal_admin_controls_are_installed(self) -> None:
        document = self.admin_document()
        self.assertIn("--control-h:44px", document)
        self.assertIn("height:var(--control-h)", document)
        self.assertIn("border-radius:10px", document)

    def test_navigation_uses_svg_icons_instead_of_symbols(self) -> None:
        document = self.admin_document()
        self.assertIn("admin-nav-icon", document)
        self.assertIn("const labels={dashboard:'لوحة التحكم'", document)
        self.assertIn('<svg viewBox="0 0 24 24">', document)

    def test_admin_loading_indicator_is_css_only(self) -> None:
        document = self.admin_document()
        self.assertIn("admin-loading-spinner", document)
        self.assertIn("@keyframes adminSpin", document)
        self.assertNotIn("admin-loader.gif", document)

    def test_patch_is_idempotent(self) -> None:
        document = self.admin_document()
        self.assertEqual(patch_admin_html(document), document)


if __name__ == "__main__":
    unittest.main()
