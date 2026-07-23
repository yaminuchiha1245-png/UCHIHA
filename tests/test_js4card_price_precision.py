import unittest

from js4card_price_precision import (
    money_text,
    patch_storefront_html,
    precise_total,
    precise_unit,
    sale_unit_price,
)


class PricePrecisionTests(unittest.TestCase):
    def test_sub_cent_unit_price_is_not_rounded_to_one_cent(self):
        self.assertEqual(precise_unit("0.0081023611"), 0.00810236)

    def test_final_total_matches_three_decimal_provider_precision(self):
        self.assertEqual(precise_total("0.0081023611", 7200), 58.337)

    def test_margin_is_applied_before_final_total(self):
        unit = sale_unit_price("0.0081023611", 10)
        self.assertEqual(unit, 0.0089126)
        self.assertEqual(precise_total(unit, 7200), 64.171)

    def test_money_text_keeps_provider_third_decimal(self):
        self.assertEqual(money_text("58.337"), "58.337")
        self.assertEqual(money_text("1"), "1.00")
        self.assertEqual(money_text("0.9"), "0.90")

    def test_storefront_quantity_labels_show_calculated_total(self):
        html = (
            "function initials(value){}"
            "p.quantity_options.map(q=>`<option value=\"${q}\">${q}</option>`).join('')"
            '<span class="modal-price">${money(p.price)}</span>'
        )
        patched = patch_storefront_html(html)
        self.assertIn("function exactMoney(value)", patched)
        self.assertIn("exactMoney(Number(p.price||0)*Number(q))", patched)
        self.assertIn("p.requires_quantity?exactMoney(p.price):money(p.price)", patched)


if __name__ == "__main__":
    unittest.main()
