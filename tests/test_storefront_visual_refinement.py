from __future__ import annotations

import unittest

from storefront_category_hierarchy_ui import patch_storefront_html as patch_category
from storefront_hardening import patch_storefront_html as patch_hardening
from storefront_management_ui import patch_storefront_html as patch_management
from storefront_signup_experience import patch_signup_html
from storefront_theme import STOREFRONT_HTML
from storefront_visual_experience import patch_storefront_html as patch_visual
from storefront_visual_refinement import patch_storefront_html


class VisualRefinementTests(unittest.TestCase):
    def customer_document(self) -> str:
        document = patch_management(STOREFRONT_HTML)
        document = patch_category(document)
        document = patch_hardening(document)
        document = patch_signup_html(document)
        document = patch_visual(document)
        return patch_storefront_html(document)

    def test_loader_is_small_and_transparent(self) -> None:
        document = self.customer_document()
        self.assertIn(".uchiha-loader-backdrop{background:rgba(0,0,0,.14)", document)
        self.assertIn(".uchiha-loader-panel{width:150px", document)
        self.assertIn(".uchiha-loader-title,.uchiha-loader-text,.uchiha-loader-dots{display:none!important}", document)

    def test_eye_starts_closed_and_opens_only_when_loader_is_shown(self) -> None:
        document = self.customer_document()
        self.assertIn(".uchiha-eye-aperture{width:106px;height:58px;clip-path:inset(49%", document)
        self.assertIn(".uchiha-loader.show .uchiha-eye-aperture{animation:uchihaRefinedEyeOpen", document)
        self.assertIn("@keyframes uchihaRefinedClosedFade", document)
        self.assertIn('viewBox="0 0 180 96"', document)

    def test_eye_never_rotates_but_loading_ring_does(self) -> None:
        document = self.customer_document()
        self.assertIn(".uchiha-eye-svg{width:106px;height:58px;filter:none;transform:none!important;animation:none!important}", document)
        self.assertIn(".uchiha-loader-ring{width:112px", document)
        self.assertIn("animation-duration:1.05s", document)

    def test_root_and_nested_category_grids_are_distinct(self) -> None:
        document = self.customer_document()
        self.assertIn(".category-grid.uchiha-root-grid{grid-template-columns:repeat(2", document)
        self.assertIn(".category-grid.uchiha-sub-grid{grid-template-columns:repeat(3", document)
        self.assertIn("repeat(3,minmax(0,1fr));gap:16px", document)
        self.assertIn("repeat(4,minmax(0,1fr));gap:12px", document)
        self.assertIn("grid.classList.toggle('uchiha-root-grid',!nested)", document)
        self.assertIn("grid.classList.toggle('uchiha-sub-grid',nested)", document)

    def test_patch_is_idempotent(self) -> None:
        document = self.customer_document()
        self.assertEqual(patch_storefront_html(document), document)


if __name__ == "__main__":
    unittest.main()
