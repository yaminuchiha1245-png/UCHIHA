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

    token_ok = bool(TOKEN_RE.fullmatch(token))
    admin_ok = admin_id.isdigit() and int(admin_id or 0) > 0
    results.append(_result("PASS" if token_ok else "FAIL", "Telegram BOT_TOKEN مضبوط شكليًا" if token_ok else "BOT_TOKEN مفقود أو غير صالح شكليًا"))
    results.append(_result("PASS" if admin_ok else "FAIL", "Telegram ADMIN_ID مضبوط" if admin_ok else "ADMIN_ID مفقود أو غير صالح"))

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
        for name in (
            "API_TOKEN",
            "BINANCE_API_KEY",
            "BINANCE_API_SECRET",
            "TRONGRID_API_KEY",
            "SHAMCASH_API_TOKEN",
            "CLIENT_STORE_MASTER_KEY",
        )
        if os.getenv(name, "").strip()
    ]
    results.append(
        _result(
            "WARN" if legacy_present else "PASS",
            "يوجد في بيئة التشغيل مفتاح قديم/غير معتمد؛ Launcher العميل سيتجاهله ويمسحه من بيئة العملية"
            if legacy_present
            else "لا توجد مفاتيح UCHIHA/الدفع أو Fernet البيئة القديمة ضمن إعداد العميل",
        )
    )

    legacy_flags = []
    if _flag(os.getenv("BINANCE_AUTO_PAY_ENABLED", "false")):
        legacy_flags.append("Binance")
    if _flag(os.getenv("SHAMCASH_API_ENABLED", "0")):
        legacy_flags.append("ShamCash API")
    if _flag(os.getenv("STOREFRONT_WEB_ENABLED", "0")):
        legacy_flags.append("Storefront Web")
    results.append(
        _result(
            "WARN" if legacy_flags else "PASS",
            "تكاملات قديمة مفعّلة في البيئة وسيجبرها Launcher العميل على التوقف: " + ", ".join(legacy_flags)
            if legacy_flags
            else "تكاملات UCHIHA القديمة غير مفعلة في إعداد العميل",
        )
    )
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
            "auth_mode": "'auto'",
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
            (
                provider_id,
                name,
                base_url,
                catalog_path,
                token_cipher,
                is_active,
                auth_mode,
                purchase_enabled,
                purchase_path,
                status_enabled,
                status_path,
            ) = row
            if not int(is_active or 0):
                continue
            active += 1
            problems: list[str] = []
            if not str(base_url or "").startswith("https://"):
                problems.append("Base URL ليس HTTPS")
            if not str(catalog_path or "").strip():
                problems.append("مسار الكتالوج ناقص")
            if str(auth_mode or "auto") != "none" and not str(token_cipher or "").strip():
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

        if "payment_methods" in tables:
            pm_columns = {
                str(row[1])
                for row in db.execute("PRAGMA table_info(payment_methods)").fetchall()
            }
            provider_expr = "COALESCE(provider,'local')" if "provider" in pm_columns else "'local'"
            mode_expr = "COALESCE(payment_mode,'manual')" if "payment_mode" in pm_columns else "'manual'"
            active_expr = "COALESCE(is_active,0)" if "is_active" in pm_columns else "0"
            local_manual = int(
                db.execute(
                    f"SELECT COUNT(*) FROM payment_methods WHERE {provider_expr} IN ('','local') AND {mode_expr}='manual' AND {active_expr}=1"
                ).fetchone()[0]
                or 0
            )
            legacy_active = int(
                db.execute(
                    f"SELECT COUNT(*) FROM payment_methods WHERE {active_expr}=1 AND ({provider_expr} NOT IN ('','local') OR {mode_expr}<>'manual')"
                ).fetchone()[0]
                or 0
            )
            if local_manual:
                results.append(_result("PASS", f"يوجد {local_manual} طريقة شحن يدوية محلية مفعّلة"))
            else:
                results.append(_result("WARN", "لا توجد طريقة شحن يدوية مفعّلة؛ أضف واحدة من لوحة الإدارة → طرق الدفع"))
            if legacy_active:
                results.append(_result("WARN", f"يوجد {legacy_active} طريقة دفع قديمة مفعّلة؛ Runtime العميل سيعطلها تلقائيًا دون حذفها"))
            else:
                results.append(_result("PASS", "لا توجد طرق دفع قديمة مفعّلة في قاعدة العميل"))
        else:
            results.append(_result("WARN", "جدول طرق الدفع لم يُنشأ بعد؛ سيُنشأ في أول تشغيل"))
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
