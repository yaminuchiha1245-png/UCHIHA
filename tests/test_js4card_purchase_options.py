import unittest

from js4card_purchase_options import (
    normalize_api_fields,
    normalize_option_pairs,
    patch_storefront_html,
    quantity_spec,
    validate_quantity,
)


class QuantitySpecTests(unittest.TestCase):
    def test_explicit_list_becomes_choices(self):
        spec = quantity_spec({"values": [50, 100, 250]}, "amount")
        self.assertEqual(spec["mode"], "choices")
        self.assertEqual(spec["options"], [50, 100, 250])
        self.assertEqual((spec["min"], spec["max"]), (50, 250))

    def test_indexed_mapping_uses_values(self):
        spec = quantity_spec({"0": "25", "1": "75", "2": "150"})
        self.assertEqual(spec["options"], [25, 75, 150])

    def test_label_mapping_uses_numeric_keys(self):
        spec = quantity_spec({"50": "50 نقطة", "100": "100 نقطة"})
        self.assertEqual(spec["options"], [50, 100])

    def test_step_range_becomes_choices(self):
        spec = quantity_spec({"min": 10, "max": 50, "step": 10}, "amount")
        self.assertEqual(spec["options"], [10, 20, 30, 40, 50])
        self.assertEqual(validate_quantity(spec, 30), 30)
        with self.assertRaises(ValueError):
            validate_quantity(spec, 35)

    def test_free_range_is_preserved(self):
        spec = quantity_spec({"min": 1, "max": 100}, "amount")
        self.assertEqual(spec["mode"], "range")
        self.assertEqual(spec["options"], [])
        self.assertEqual(validate_quantity(spec, 37), 37)


class OptionTests(unittest.TestCase):
    def test_mapping_preserves_raw_provider_value(self):
        pairs = normalize_option_pairs({"eu": "أوروبا", "me": "الشرق الأوسط"})
        self.assertEqual(pairs[0], {"label": "أوروبا", "value": "eu"})

    def test_fields_keep_labels_and_raw_values(self):
        fields = normalize_api_fields([
            {
                "name": "server",
                "label": "السيرفر",
                "options": {"1": "أوروبا", "2": "آسيا"},
            }
        ])
        self.assertEqual(fields[0]["options"], ["أوروبا", "آسيا"])
        self.assertEqual(fields[0]["option_pairs"][1]["value"], "2")


class HtmlPatchTests(unittest.TestCase):
    def test_quantity_input_is_replaced_with_select_support(self):
        source = "before" + (
            '${p.requires_quantity?`<div class="field"><label>العدد '
            '(${p.min_qty} - ${p.max_qty})</label><input class="input" '
            'id="productQty" type="number" inputmode="numeric" '
            'min="${p.min_qty}" max="${p.max_qty}" '
            'value="${p.min_qty}"></div>`:\'\'}'
        ) + "after"
        patched = patch_storefront_html(source)
        self.assertIn("p.quantity_options?.length", patched)
        self.assertIn('<select class="select" id="productQty">', patched)
        self.assertNotIn(
            '<label>العدد (${p.min_qty} - ${p.max_qty})</label><input',
            patched,
        )


if __name__ == "__main__":
    unittest.main()
