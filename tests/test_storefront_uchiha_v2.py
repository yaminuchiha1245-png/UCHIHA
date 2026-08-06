from __future__ import annotations

import unittest

from storefront_category_hierarchy_ui import patch_storefront_html as patch_category
from storefront_hardening import patch_storefront_html as patch_hardening
from storefront_management_ui import patch_storefront_html as patch_management
from storefront_signup_experience import patch_signup_html
from storefront_theme import STOREFRONT_HTML
from storefront_uchiha_v2 import patch_storefront_html
from storefront_visual_experience import patch_storefront_html as patch_visual
from storefront_visual_refinement import patch_storefront_html as patch_refinement


class UchihaV2VisualTests(unittest.TestCase):
    def customer_document(self) -> str:
        document = patch_management(STOREFRONT_HTML)
        document = patch_category(document)
        document = patch_hardening(document)
        document = patch_signup_html(document)
        document = patch_visual(document)
        document = patch_refinement(document)
        return patch_storefront_html(document)

    def test_circular_loader_is_svg_and_gpu_friendly(self) -> None:
        document = self.customer_document()
        self.assertIn('class="uchiha-v2-spinner"', document)
        self.assertIn('.uchiha-v2-spinner-ring{transform-origin:center;transform-box:view-box;animation:uchihaV2Spin .9s linear infinite}', document)
        self.assertIn('@keyframes uchihaV2Spin{to{transform:rotate(360deg)}}', document)
        self.assertNotIn('uchiha-v2-spinner.gif', document)

    def test_home_hides_products_until_category_or_search(self) -> None:
        document = self.customer_document()
        self.assertIn('body:not(.uchiha-catalog-mode) .product-section{display:none!important}', document)
        self.assertIn("Boolean(state.category||String(state.query||'').trim())", document)
        self.assertIn("document.body.classList.add('uchiha-catalog-mode')", document)

    def test_stagger_motion_uses_transform_and_opacity(self) -> None:
        document = self.customer_document()
        self.assertIn('@keyframes uchihaV2Enter{from{opacity:0;transform:translateY(10px)}', document)
        self.assertIn("node.style.setProperty('--uchiha-i'", document)
        self.assertIn('@media(prefers-reduced-motion:reduce)', document)

    def test_patch_is_idempotent(self) -> None:
        document = self.customer_document()
        self.assertEqual(patch_storefront_html(document), document)


if __name__ == "__main__":
    unittest.main()
