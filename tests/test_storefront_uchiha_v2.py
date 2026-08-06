from __future__ import annotations

import unittest

from storefront_category_hierarchy_ui import patch_storefront_html as patch_category
from storefront_demo_parity import patch_storefront_html
from storefront_hardening import patch_storefront_html as patch_hardening
from storefront_management_ui import patch_storefront_html as patch_management
from storefront_signup_experience import patch_signup_html
from storefront_theme import STOREFRONT_HTML
from storefront_visual_experience import patch_storefront_html as patch_visual
from storefront_visual_refinement import patch_storefront_html as patch_refinement


class DemoParityVisualTests(unittest.TestCase):
    def customer_document(self) -> str:
        document = patch_management(STOREFRONT_HTML)
        document = patch_category(document)
        document = patch_hardening(document)
        document = patch_signup_html(document)
        document = patch_visual(document)
        document = patch_refinement(document)
        return patch_storefront_html(document)

    def test_rejected_playful_skin_is_not_present(self) -> None:
        document = self.customer_document()
        self.assertNotIn("uchihaV2Enter", document)
        self.assertNotIn("uchiha-v2-spinner", document)

    def test_professional_equal_control_system_is_installed(self) -> None:
        document = self.customer_document()
        self.assertIn("--control-h:44px", document)
        self.assertIn("height:var(--control-h)", document)
        self.assertIn("border-radius:10px!important", document)

    def test_home_stays_category_first(self) -> None:
        document = self.customer_document()
        self.assertIn("body:not(.demo-catalog-mode) .product-section{display:none!important}", document)
        self.assertIn("Boolean(state.category||String(state.query||'').trim())", document)

    def test_loader_uses_uchiha_identity_without_gif(self) -> None:
        document = self.customer_document()
        self.assertIn('class="demo-uchiha-loader"', document)
        self.assertIn(".demo-loader-ring{transform-origin:center;transform-box:view-box", document)
        self.assertNotIn(".gif", document)

    def test_patch_is_idempotent(self) -> None:
        document = self.customer_document()
        self.assertEqual(patch_storefront_html(document), document)


if __name__ == "__main__":
    unittest.main()
