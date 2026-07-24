from __future__ import annotations

import unittest

from storefront_admin_theme import ADMIN_HTML
from storefront_category_hierarchy_admin_ui import patch_admin_html as patch_category_admin
from storefront_category_hierarchy_ui import patch_storefront_html as patch_category_customer
from storefront_hardening import patch_storefront_html as patch_hardening
from storefront_management_admin_ui import patch_admin_html as patch_management_admin
from storefront_management_ui import patch_storefront_html as patch_management_customer
from storefront_signup_experience import patch_signup_html
from storefront_theme import STOREFRONT_HTML
from storefront_visual_experience import patch_admin_html, patch_storefront_html


class VisualExperienceTests(unittest.TestCase):
    def customer_document(self) -> str:
        document = patch_management_customer(STOREFRONT_HTML)
        document = patch_category_customer(document)
        document = patch_hardening(document)
        document = patch_signup_html(document)
        return patch_storefront_html(document)

    def admin_document(self) -> str:
        document = patch_management_admin(ADMIN_HTML)
        document = patch_category_admin(document)
        return patch_admin_html(document)

    def test_customer_loader_has_static_eye_and_rotating_ring(self) -> None:
        document = self.customer_document()
        self.assertIn('id="uchihaLoader"', document)
        self.assertIn("@keyframes uchihaLoaderRing", document)
        self.assertIn(".uchiha-eye-svg{", document)
        self.assertIn("animation:none!important", document)
        self.assertIn("@keyframes uchihaEyeOpen", document)

    def test_blood_tears_are_delayed_until_long_loading(self) -> None:
        document = self.customer_document()
        self.assertIn("setTimeout(()=>{if(uchihaVisualState.tokens.size){el.root.classList.add('is-blood')", document)
        self.assertIn("},4300)", document)
        self.assertIn("uchiha-blood-tear one", document)
        self.assertIn("uchiha-blood-tear two", document)

    def test_product_and_category_clicks_use_resilient_delegation(self) -> None:
        document = self.customer_document()
        self.assertIn("productGrid.addEventListener('click'", document)
        self.assertIn("categoryGrid.addEventListener('click'", document)
        self.assertIn("e.stopImmediatePropagation()", document)
        self.assertIn("openProduct(Number(card.dataset.product))", document)
        self.assertIn("selectCategory(card.dataset.category)", document)

    def test_critical_customer_actions_are_wrapped(self) -> None:
        document = self.customer_document()
        for marker in (
            "const uchihaOriginalOpenProduct=openProduct",
            "const uchihaOriginalSubmitLogin=submitLogin",
            "const uchihaOriginalSubmitSignup=submitSignup",
            "const uchihaOriginalConfirmPurchase=confirmPurchase",
            "const uchihaOriginalOpenDeposit=openDeposit",
            "const uchihaOriginalVerifyAutoDeposit=verifyAutoDeposit",
            "const uchihaOriginalStartBotLink=startBotLink",
        ):
            self.assertIn(marker, document)

    def test_visual_patch_is_idempotent(self) -> None:
        customer = self.customer_document()
        admin = self.admin_document()
        self.assertEqual(patch_storefront_html(customer), customer)
        self.assertEqual(patch_admin_html(admin), admin)

    def test_admin_write_loader_is_installed(self) -> None:
        document = self.admin_document()
        self.assertIn('id="adminUchihaLoader"', document)
        self.assertIn("const adminUchihaOriginalApi=api", document)
        self.assertIn("const method=String(opt.method||'GET').toUpperCase()", document)
        self.assertIn("method!=='GET'", document)
        self.assertIn("adminUchihaVisual.bloodTimer", document)

    def test_reduced_motion_is_respected(self) -> None:
        document = self.customer_document()
        self.assertIn("@media(prefers-reduced-motion:reduce)", document)
        self.assertIn(".uchiha-eye-aperture{animation:none!important", document)


if __name__ == "__main__":
    unittest.main()
