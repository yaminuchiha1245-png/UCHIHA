"""Apply an exact-source owner-panel navigation change ONLY inside an isolated VPS stage.

Never run this against the canonical production directory. No bot/network/DB work.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import py_compile
from pathlib import Path

PRODUCTION = Path("/opt/uchiha/projects/bot-service-stage/uchiha-bot-service")
BASELINE = {
    "main.py": "01dcc64cd6b86a58374c63f490005acd1a6fd73f7839f963e9e45a65d6545ac3",
    "merchant_admin_panel.py": "24038e3a37ae403a79ef34261c062520f4005eede41d34b14575bd0c3fa25c0a",
}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def require_once(text: str, needle: str, context: str) -> None:
    if text.count(needle) != 1:
        raise RuntimeError(f"{context}: expected one source anchor, got {text.count(needle)}")


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--stage", required=True)
    cli.add_argument("--helper", required=True)
    args = cli.parse_args()
    stage = Path(args.stage).resolve(strict=True)
    production = PRODUCTION.resolve()
    if stage == production or production in stage.parents:
        raise RuntimeError("Refusing to change canonical production source")
    if (stage / "VERSION").read_text().strip() != "0.5.51":
        raise RuntimeError("Stage version drift; this patch is ONLY for V0.5.51")
    src = stage / "apps" / "bot-engine"
    originals = {}
    for name, expected in BASELINE.items():
        path = src / name
        raw = path.read_bytes()
        if sha(raw) != expected:
            raise RuntimeError(f"Refusing to overwrite newer {name}; source SHA256 drift")
        originals[name] = raw.decode("utf-8")
    helper = Path(args.helper).read_bytes()
    if not helper or (src / "panel_navigation.py").exists():
        raise RuntimeError("Missing helper or stage already contains panel navigation")
    main_py = originals["main.py"]
    require_once(main_py, "from merchant_admin_panel import build_merchant_panel, dashboard_keyboard\n", "main import")
    main_py = main_py.replace(
        "from merchant_admin_panel import build_merchant_panel, dashboard_keyboard\n",
        "from merchant_admin_panel import build_merchant_panel, dashboard_keyboard\n"
        "from panel_navigation import EditablePanelMessage\n",
    )
    anchor = (
        "        async def sync_telegram_identity(user, event_type: str = 'profile') "
        "-> tuple[dict, str | None]:"
    )
    require_once(main_py, anchor, "main owner guard")
    main_py = main_py.replace(anchor, (
        "        def owner_panel(call: CallbackQuery) -> EditablePanelMessage:\n"
        "            \"\"\"Edit owner menus in place; retain a safe back control.\"\"\"\n"
        "            return EditablePanelMessage(\n"
        "                call.message,\n"
        "                back_markup=InlineKeyboardMarkup(inline_keyboard=[[\n"
        "                    InlineKeyboardButton(text='↩️ لوحة الإدارة', callback_data='admin:home'),\n"
        "                ]]),\n"
        "            )\n\n"
        + anchor
    ))
    begin = "        @router.callback_query(F.data == 'admin:home')"
    end = "        dp.include_router(router)"
    require_once(main_py, begin, "central callback start")
    require_once(main_py, end, "central callback end")
    first, rest = main_py.split(begin, 1)
    central, last = rest.split(end, 1)
    if central.count("await call.message.answer(") != 15:
        raise RuntimeError("Central owner callback structure changed")
    if central.count("display_users(call.message,") != 2:
        raise RuntimeError("Central user-navigation structure changed")
    central = central.replace("await call.message.answer(", "await owner_panel(call).answer(")
    central = central.replace("display_users(call.message,", "display_users(owner_panel(call),")
    main_py = first + begin + central + end + last

    merchant = originals["merchant_admin_panel.py"]
    import_line = "from shop_factory_flow import STYLE_OPTIONS, style_keyboard\n"
    require_once(merchant, import_line, "merchant import")
    merchant = merchant.replace(
        import_line, import_line + "from panel_navigation import EditablePanelMessage\n",
    )
    menu_anchor = "    def menu(summary):"
    require_once(merchant, menu_anchor, "merchant guard")
    merchant = merchant.replace(menu_anchor, (
        "    def owner_panel(call: CallbackQuery) -> EditablePanelMessage:\n"
        "        return EditablePanelMessage(\n"
        "            call.message,\n"
        "            back_markup=keyboard([('↩️ الإدارة', 'madmin:home')]),\n"
        "        )\n\n"
        + menu_anchor
    ))
    if merchant.count("await call.message.answer(") != 35:
        raise RuntimeError("Merchant owner callback structure changed")
    merchant = merchant.replace(
        "await call.message.answer(", "await owner_panel(call).answer(",
    )
    for fn, expected in {
        "dashboard": 1, "show_categories": 3, "show_search_results": 2,
        "show_orders": 4, "show_settings": 3,
    }.items():
        before = fn + "(call.message"
        if merchant.count(before) != expected:
            raise RuntimeError(f"Merchant {fn} call-site drift")
        merchant = merchant.replace(before, fn + "(owner_panel(call)")
    changes = {
        "main.py": main_py.encode("utf-8"),
        "merchant_admin_panel.py": merchant.encode("utf-8"),
        "panel_navigation.py": helper,
    }
    # All guards above must pass BEFORE any output file is altered.
    for name, body in changes.items():
        (src / name).write_bytes(body)
        py_compile.compile(str(src / name), doraise=True)
    report = {
        "status": "STAGED_NOT_DEPLOYED",
        "baseline": "0.5.51",
        "base_sha256": BASELINE,
        "candidate_sha256": {name: sha(data) for name, data in changes.items()},
        "provenance": "UCHIHA chat 00 exact-source navigation candidate",
        "real_orders_enabled": False,
    }
    (stage / "NAV_STAGE_MANIFEST.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
    )
    print("STAGE_APPLIED: YES; PRODUCTION_MODIFIED: NO")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
