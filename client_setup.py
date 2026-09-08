#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-time owner setup for the isolated client Telegram store."""

from __future__ import annotations

import getpass
import re
import shutil
from pathlib import Path

from cryptography.fernet import Fernet


TOKEN_RE = re.compile(r"^\d{5,20}:[A-Za-z0-9_-]{20,}$")


def _read_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def _write_env(path: Path, values: dict[str, str]) -> None:
    lines = [
        "# Isolated client-store runtime configuration.",
        "# Provider/API tokens are NOT stored here; the owner adds them from the bot admin panel.",
        "# This file is intentionally generated from an allowlist and does not inherit legacy UCHIHA secrets.",
    ]
    for key in sorted(values):
        lines.append(f"{key}={values[key]}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _safe_store_name(value: str) -> str:
    clean = " ".join(str(value or "").split())
    return clean[:80] or "متجر الخدمات"


def build_isolated_values(
    *,
    token: str,
    admin_id: str,
    db_path: str,
    key_file: Path,
    store_name: str,
) -> dict[str, str]:
    """Return only client-owned runtime settings; never copy an old .env wholesale."""
    return {
        "ADMIN_ID": admin_id,
        "BINANCE_AUTO_PAY_ENABLED": "false",
        "BOT_TOKEN": token,
        "CLIENT_API_STATUS_INTERVAL_SECONDS": "120",
        "CLIENT_API_STATUS_MONITOR_ENABLED": "true",
        "CLIENT_STORE_MASTER_KEY_FILE": str(key_file),
        "CLIENT_STORE_NAME": _safe_store_name(store_name),
        "DB_PATH": db_path,
        "ORDER_STATUS_MONITOR_ENABLED": "false",
        "STOREFRONT_API_ENABLED": "0",
        "STOREFRONT_PUBLIC_CATALOG_ENABLED": "0",
        "STOREFRONT_WEB_ENABLED": "0",
        "SYNC_ON_START": "false",
    }


def main() -> None:
    root = Path(__file__).resolve().parent
    env_path = root / ".env"
    existing = _read_env(env_path)

    print("UCHIHA Client Store — إعداد أول تشغيل")
    print("لن يتم طلب أي API provider token هنا؛ صاحب البوت يضيفها لاحقًا من لوحة الإدارة.")
    print("لن يتم نسخ أي API_TOKEN أو مفاتيح دفع قديمة من نسخة UCHIHA الأصلية.")

    token = getpass.getpass("Telegram BOT_TOKEN: ").strip()
    if not TOKEN_RE.fullmatch(token):
        raise SystemExit("BOT_TOKEN غير صالح شكليًا. انسخه من BotFather كما هو.")

    admin_id = input("Telegram ADMIN_ID لصاحب البوت: ").strip()
    if not admin_id.isdigit() or int(admin_id) <= 0:
        raise SystemExit("ADMIN_ID يجب أن يكون رقم Telegram صحيحًا.")

    store_name = _safe_store_name(input("اسم المتجر [متجر الخدمات]: ").strip())
    db_default = existing.get("DB_PATH", "client_store.db")
    db_path = input(f"Database path [{db_default}]: ").strip() or db_default

    key_file = root / "client_store.key"
    if not key_file.exists():
        key_file.write_bytes(Fernet.generate_key() + b"\n")
        try:
            key_file.chmod(0o600)
        except OSError:
            pass

    if env_path.exists():
        backup = root / ".env.before-client-setup"
        shutil.copy2(env_path, backup)
        try:
            backup.chmod(0o600)
        except OSError:
            pass

    values = build_isolated_values(
        token=token,
        admin_id=admin_id,
        db_path=db_path,
        key_file=key_file,
        store_name=store_name,
    )
    _write_env(env_path, values)

    print("\n✅ تم تجهيز ملف تشغيل معزول للعميل.")
    print("✅ لم يتم توريث أي توكن API أو مفتاح دفع من البيئة السابقة.")
    print("✅ مفتاح تشفير توكنات المزودين محفوظ محليًا بصلاحيات مقيدة.")
    print("✅ توكنات API للمزودين سيضيفها صاحب البوت من لوحة الإدارة.")
    print("✅ مراقب حالات API يعمل كل دقيقتين، لكنه لا يطلب أي مزوّد ما لم يفعّل المالك Status endpoint له.")
    print("\nتشغيل البوت:")
    print("python client_store_launcher.py")


if __name__ == "__main__":
    main()
