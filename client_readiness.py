#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Secret-safe readiness check for the isolated client store."""

from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv


TOKEN_RE = re.compile(r"^\d{5,20}:[A-Za-z0-9_-]{20,}$")


def _flag(value: str, default: bool = False) -> bool:
    text = str(value or ("1" if default else "0")).strip().lower()
    return text in {"1", "true", "yes", "on"}


def _result(kind: str, message: str) -> tuple[str, str]:
    return kind, message


def check_environment() -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    token = os.getenv("BOT_TOKEN", "").strip()
    admin_id = os.getenv("ADMIN_ID", "").strip()
    db_path = Path(os.getenv("DB_PATH", "client_store.db").strip() or "client_store.db").expanduser()
    key_path = Path(os.getenv("CLIENT_STORE_MASTER_KEY_FILE", "client_store.key").strip() or "client_store.key").expanduser()

    results.append(_result("PASS" if TOKEN_RE.fullmatch(token) else "FAIL", "Telegram BOT_TOKEN مضبوط شكليًا" if TOKEN_RE.fullmatch(token) else "BOT_TOKEN مفقود أو غير صالح شكليًا"))
    results.append(_result("PASS" if admin_id.isdigit() and int(admin_id or 0) > 0 else "FAIL", "Telegram ADMIN_ID مضبوط" if admin_id.isdigit() and int(admin_id or 0) > 0 else "ADMIN_ID مفقود أو غير صالح"))

    if key_path.exists():
        try:
            Fernet(key_path.read_bytes().strip())
            results.append(_result("PASS", "مفتاح تشفير مزودي API موجود وصالح"))
        except Exception:
            results.append(_result("FAIL", "ملف مفتاح تشفير مزودي API موجود لكنه غير صالح"))
    else:
        results.append(_result("FAIL", "مفتاح تشفير مزودي API غير موجود"))

    if db_path.exists():
        results.append(_result("PASS", "قاعدة بيانات العميل موجودة"))
    else:
        parent = db_path.parent if str(db_path.parent) else Path(".")
        writable = parent.exists() and os.access(parent, os.W_OK)
        results.append(_result("WARN" if writable else "FAIL", "قاعدة البيانات لم تُنشأ بعد؛ أول تشغيل سينشئها" if writable else "مسار قاعدة البيانات غير قابل للكتابة"))

    legacy_present = [
        name
        for name in ("API_TOKEN", "BINANCE_API_KEY", "BINANCE_API_SECRET", "TRONGRID_API_KEY")
        if os.getenv(name, "").strip()
    ]
    results.append(
        _result(
            "WARN" if legacy_present else "PASS",
            "يوجد في بيئة التشغيل مفاتيح UCHIHA قديمة غير مطلوبة لنسخة العميل" if legacy_present else "لا توجد مفاتيح UCHIHA القديمة ضمن إعداد العميل",
        )
    )

    if _flag(os.getenv("BINANCE_AUTO_PAY_ENABLED", "false")):
        results.append(_result("WARN", "Binance auto payment مفعّل صراحة في البيئة"))
    else:
        results.append(_result("PASS", "الدفع التلقائي القديم غير مفعّل"))
    return results


def check_database() -> list[tuple[str, str]]:
    db_path = Path(os.getenv("DB_PATH", "client_store.db").strip() or "client_store.db").expanduser()
    if not db_path.exists():
        return []
    results: list[tuple[str, str]] = []
    try:
        db = sqlite3.connect(str(db_path))
    except sqlite3.Error:
        return [_result("FAIL", "تعذر فتح قاعدة بيانات العميل")]
    try:
        tables = {
            str(row[0])
            for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        required = {"users", "orders", "products", "client_api_providers", "client_provider_products"}
        missing = sorted(required - tables)
        if missing:
            results.append(_result("FAIL", "قاعدة البيانات ناقصة جداول نسخة العميل؛ شغّل البوت مرة واحدة لإكمال التهيئة"))
            return results
        results.append(_result("PASS", "جداول العميل الأساسية موجودة"))

        columns = {
            str(row[1])
            for row in db.execute("PRAGMA table_info(client_api_providers)").fetchall()
        }
        provider_select = ["id", "name", "base_url", "catalog_path", "token_cipher", "is_active"]
        optional = {
            "purchase_enabled": "0",
            "purchase_path": "''",
            "status_enabled": "0",
            "status_path": "''",
        }
        select_parts = list(provider_select)
        for key, fallback in optional.items():
            select_parts.append(key if key in columns else f"{fallback} AS {key}")
        query = f"SELECT {','.join(select_parts)} FROM client_api_providers WHERE adapter_key<>'manual'"
        providers = db.execute(query).fetchall()
        active = 0
        broken = 0
        for row in providers:
            provider_id, name, base_url, catalog_path, token_cipher, is_active, purchase_enabled, purchase_path, status_enabled, status_path = row
            if not int(is_active or 0):
                continue
            active += 1
            problems: list[str] = []
            if not str(base_url or "").startswith("https://"):
                problems.append("Base URL ليس HTTPS")
            if not str(catalog_path or "").strip():
                problems.append("مسار الكتالوج ناقص")
            if not str(token_cipher or "").strip():
                problems.append("التوكن غير محفوظ")
            if int(purchase_enabled or 0) and not str(purchase_path or "").strip():
                problems.append("الشراء مفعّل بلا مسار")
            if int(status_enabled or 0) and not str(status_path or "").strip():
                problems.append("متابعة الحالة مفعّلة بلا مسار")
            if problems:
                broken += 1
                results.append(_result("FAIL", f"مزوّد مفعّل #{int(provider_id)} ({str(name)[:40]}): " + "، ".join(problems)))
        if active == 0:
            results.append(_result("WARN", "لا يوجد مزوّد API مفعّل؛ المنتجات اليدوية تظل قابلة للعمل"))
        elif broken == 0:
            results.append(_result("PASS", f"إعدادات {active} مزوّد API مفعّل مكتملة مبدئيًا"))

        unorganized = int(db.execute("SELECT COUNT(*) FROM client_provider_products WHERE status='unorganized'").fetchone()[0] or 0)
        if unorganized:
            results.append(_result("WARN", f"يوجد {unorganized} منتجًا في «غير مرتبة»"))
        else:
            results.append(_result("PASS", "لا توجد منتجات معلقة في «غير مرتبة»"))
    except sqlite3.Error as exc:
        results.append(_result("FAIL", f"فشل فحص قاعدة البيانات: {str(exc)[:120]}"))
    finally:
        db.close()
    return results


def main() -> int:
    load_dotenv()
    results = check_environment() + check_database()
    icons = {"PASS": "✅", "WARN": "⚠️", "FAIL": "❌"}
    print("Client Store — فحص الجاهزية\n")
    for kind, message in results:
        print(f"{icons.get(kind, '•')} {kind}: {message}")
    failures = sum(1 for kind, _ in results if kind == "FAIL")
    warnings = sum(1 for kind, _ in results if kind == "WARN")
    print(f"\nالنتيجة: {failures} أخطاء، {warnings} تنبيهات.")
    print("ملاحظة: هذا الفحص لا يطبع أي توكن أو مفتاح سري.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
