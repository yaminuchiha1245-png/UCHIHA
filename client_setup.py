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
        "# Client store runtime configuration.",
        "# Provider/API tokens are NOT stored here; the owner adds them from the bot admin panel.",
    ]
    for key in sorted(values):
        lines.append(f"{key}={values[key]}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def main() -> None:
    root = Path(__file__).resolve().parent
    env_path = root / ".env"
    existing = _read_env(env_path)

    print("UCHIHA Client Store — إعداد أول تشغيل")
    print("لن يتم طلب أي API provider token هنا؛ صاحب البوت يضيفها لاحقًا من لوحة الإدارة.")

    token = getpass.getpass("Telegram BOT_TOKEN: ").strip()
    if not TOKEN_RE.fullmatch(token):
        raise SystemExit("BOT_TOKEN غير صالح شكليًا. انسخه من BotFather كما هو.")

    admin_id = input("Telegram ADMIN_ID لصاحب البوت: ").strip()
    if not admin_id.isdigit() or int(admin_id) <= 0:
        raise SystemExit("ADMIN_ID يجب أن يكون رقم Telegram صحيحًا.")

    db_default = existing.get("DB_PATH", "client_store.db")
    db_path = input(f"Database path [{db_default}]: ").strip() or db_default

    key_file = root / "client_store.key"
    if not key_file.exists():
        key_file.write_bytes(Fernet.generate_key() + b"\n")
        try:
            key_file.chmod(0o600)
        except OSError:
            pass

    values = dict(existing)
    values.update(
        {
            "BOT_TOKEN": token,
            "ADMIN_ID": admin_id,
            "DB_PATH": db_path,
            "CLIENT_STORE_MASTER_KEY_FILE": str(key_file),
            "SYNC_ON_START": "false",
            "BINANCE_AUTO_PAY_ENABLED": values.get("BINANCE_AUTO_PAY_ENABLED", "false"),
        }
    )

    if env_path.exists():
        backup = root / ".env.before-client-setup"
        shutil.copy2(env_path, backup)
        try:
            backup.chmod(0o600)
        except OSError:
            pass

    _write_env(env_path, values)

    print("\n✅ تم تجهيز ملف التشغيل.")
    print("✅ مفتاح تشفير توكنات المزودين محفوظ محليًا بصلاحيات مقيدة.")
    print("✅ توكنات API للمزودين سيضيفها صاحب البوت من: لوحة الإدارة → مزودو API.")
    print("\nتشغيل البوت:")
    print("python client_store_launcher.py")


if __name__ == "__main__":
    main()
