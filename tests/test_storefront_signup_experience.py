import unittest

import storefront_signup_experience as signup


class SignupExperienceTests(unittest.TestCase):
    def test_unicode_username_accepts_arabic_and_latin(self):
        self.assertEqual(
            signup.normalize_username("يامن_اوتشيها"),
            "يامن_اوتشيها",
        )
        self.assertEqual(
            signup.normalize_username("Uchiha.35"),
            "Uchiha.35",
        )

    def test_username_rejects_spaces_and_unsupported_characters(self):
        for value in ("يامن اوتشيها", "ab", "@uchiha", "___"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                signup.normalize_username(value)

    def test_signup_html_patch_adds_steps_and_country_selector(self):
        fixture = (
            "<html><head><style>body{}  </style></head><body>\n"
            + signup.OLD_SIGNUP_FORM
            + "\n<script>\n"
            + "function showAuthTab(name){}\n"
            + "async function submitSignup(e){}\n"
            + "async function boot(){}\n"
            + "  boot();\n  </script></body></html>"
        )
        patched = signup.patch_signup_html(fixture)
        self.assertIn('data-signup-step="1"', patched)
        self.assertIn('data-signup-step="2"', patched)
        self.assertIn(
            '<select class="select" id="signupCountry"',
            patched,
        )
        self.assertIn('id="signupPasswordConfirm"', patched)
        self.assertIn("signupCountries=[", patched)
        self.assertNotIn('placeholder="مثال: سوريا" required', patched)

    def test_patch_is_idempotent(self):
        fixture = (
            "<style>  </style>\n"
            + signup.OLD_SIGNUP_FORM
            + "\n<script>\n  boot();\n  </script>"
        )
        first = signup.patch_signup_html(fixture)
        self.assertEqual(signup.patch_signup_html(first), first)


if __name__ == "__main__":
    unittest.main()
