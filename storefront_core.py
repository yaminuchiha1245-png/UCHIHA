"""Core services for the Uchiha Store customer website.

The Telegram bot and the website intentionally share ``store.db``.  Website
accounts start with a private negative wallet id and are merged into the real
Telegram user id after the one-time bot link succeeds.  This keeps one wallet,
one order history, and one source of truth without exposing provider secrets to
the browser.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiosqlite


SESSION_COOKIE = "uchiha_session"
SESSION_HOURS = 24 * 30
LINK_MINUTES = 10
MAX_IMAGE_BYTES = 3 * 1024 * 1024
ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}


class StorefrontError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class Session:
    id: int
    role: str
    account_id: int
    csrf_token: str
    expires_at: str


def db_path() -> Path:
    return Path(os.getenv("DB_PATH", "store.db").strip() or "store.db").expanduser().resolve()


def now_text() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def future_text(*, hours: int = 0, minutes: int = 0) -> str:
    return (dt.datetime.now() + dt.timedelta(hours=hours, minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")


def _secret_key() -> bytes:
    configured = os.getenv("STOREFRONT_SESSION_SECRET", "").strip()
    if configured:
        return hashlib.sha256(configured.encode("utf-8")).digest()
    fallback = "|".join(
        (
            os.getenv("BOT_TOKEN", ""),
            os.getenv("API_TOKEN", ""),
            os.getenv("ADMIN_ID", ""),
            "uchiha-store-session-v1",
        )
    )
    return hashlib.sha256(fallback.encode("utf-8")).digest()


def token_hash(token: str) -> str:
    return hmac.new(_secret_key(), token.encode("utf-8"), hashlib.sha256).hexdigest()


def normalize_email(value: str) -> str:
    value = str(value or "").strip().casefold()
    if len(value) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise StorefrontError("invalid_email", "أدخل بريدًا إلكترونيًا صحيحًا.")
    return value


def normalize_username(value: str) -> str:
    value = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_\-\.]{3,32}", value):
        raise StorefrontError(
            "invalid_username",
            "اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا أو رقمًا.",
        )
    return value


def normalize_phone(value: str) -> str:
    value = re.sub(r"[^0-9+]", "", str(value or "").strip())
    if value.startswith("+"):
        digits = value[1:]
    else:
        digits = value
    if not digits.isdigit() or not 8 <= len(digits) <= 15:
        raise StorefrontError("invalid_phone", "أدخل رقم هاتف صحيحًا مع رمز الدولة.")
    return "+" + digits


def hash_password(password: str) -> str:
    if len(password or "") < 8:
        raise StorefrontError("weak_password", "كلمة المرور يجب أن تكون 8 أحرف على الأقل.")
    salt = secrets.token_bytes(16)
    iterations = 310_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, raw_iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(raw_iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def clean_text(value: Any, limit: int = 1000) -> str:
    text = html.unescape(str(value or "")).strip()
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:limit].strip()


async def ensure_schema() -> None:
    """Create the website-owned tables without replacing existing bot data."""
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(path) as db:
        await db.execute("PRAGMA busy_timeout = 10000")
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                full_name TEXT,
                balance REAL DEFAULT 0,
                joined_date TEXT,
                is_banned INTEGER DEFAULT 0,
                is_blocked INTEGER DEFAULT 0,
                store_user_id TEXT DEFAULT '',
                store_username TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS balance_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                amount REAL,
                type TEXT,
                reason TEXT,
                date TEXT,
                admin_id INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS web_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                telegram_id INTEGER NOT NULL DEFAULT 0,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                first_name TEXT NOT NULL DEFAULT '',
                last_name TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                last_login_at TEXT NOT NULL DEFAULT ''
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_web_accounts_username_ci
                ON web_accounts(LOWER(username));
            CREATE UNIQUE INDEX IF NOT EXISTS idx_web_accounts_email_ci
                ON web_accounts(LOWER(email));
            CREATE UNIQUE INDEX IF NOT EXISTS idx_web_accounts_telegram
                ON web_accounts(telegram_id) WHERE telegram_id > 0;
            CREATE TABLE IF NOT EXISTS web_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL DEFAULT 'customer',
                account_id INTEGER NOT NULL DEFAULT 0,
                csrf_token TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_web_sessions_expiry ON web_sessions(expires_at);
            CREATE TABLE IF NOT EXISTS web_link_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                account_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_web_link_account ON web_link_codes(account_id, expires_at);
            CREATE TABLE IF NOT EXISTS storefront_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS storefront_banners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subtitle TEXT NOT NULL DEFAULT '',
                cta_label TEXT NOT NULL DEFAULT '',
                cta_target TEXT NOT NULL DEFAULT '',
                accent TEXT NOT NULL DEFAULT '#e4313f',
                art_variant TEXT NOT NULL DEFAULT 'ninja',
                image_blob BLOB,
                image_mime TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS storefront_category_media (
                category_id INTEGER PRIMARY KEY,
                image_blob BLOB,
                image_mime TEXT NOT NULL DEFAULT '',
                accent TEXT NOT NULL DEFAULT '#e4313f',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS storefront_deposit_files (
                request_id INTEGER PRIMARY KEY,
                image_blob BLOB NOT NULL,
                image_mime TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS storefront_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            """
        )
        defaults = {
            "store_name": "Uchiha Store",
            "tagline": "بوابتك السريعة للخدمات والمنتجات الرقمية",
            "announcement": "تسليم رقمي سريع • رصيد واحد في الموقع والبوت",
            "support_telegram": "",
            "support_whatsapp": "",
            "support_email": "",
            "support_hours": "متوفرون يوميًا",
            "hero_interval_ms": "5200",
            "currency": "USD",
            "currency_symbol": "$",
            "primary_color": "#e4313f",
            "secondary_color": "#9f111b",
            "accent_color": "#d7d9de",
        }
        await db.executemany(
            "INSERT OR IGNORE INTO storefront_settings(key, value, updated_at) VALUES (?, ?, ?)",
            [(key, value, now_text()) for key, value in defaults.items()],
        )
        # Upgrade only the original palette. Owner-customized colors remain untouched.
        palette_stamp = now_text()
        await db.executemany(
            "UPDATE storefront_settings SET value = ?, updated_at = ? "
            "WHERE key = ? AND lower(value) = ?",
            [
                ("#e4313f", palette_stamp, "primary_color", "#18d8c5"),
                ("#9f111b", palette_stamp, "secondary_color", "#2d8cff"),
                ("#d7d9de", palette_stamp, "accent_color", "#8b5cf6"),
            ],
        )
        async with db.execute("SELECT COUNT(*) FROM storefront_banners") as cursor:
            banner_count = int((await cursor.fetchone())[0] or 0)
        if not banner_count:
            stamp = now_text()
            await db.executemany(
                """
                INSERT INTO storefront_banners
                (title, subtitle, cta_label, cta_target, accent, art_variant,
                 enabled, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                [
                    ("القوة تبدأ من الظلال", "تجربة رقمية جريئة بهوية Uchiha لا تشبه أي متجر آخر.", "تسوّق الآن", "#categories", "#e4313f", "ninja", 10, stamp, stamp),
                    ("حساب واحد، عالم واحد", "اربط بوت Uchiha واستخدم رصيدك وطلباتك من أي مكان.", "اربط البوت", "#bot-link", "#b51d29", "portal", 20, stamp, stamp),
                    ("إرث لا ينطفئ", "صور السلايدر والأقسام والعروض تحت تحكمك من لوحة الإدارة.", "عرض المنتجات", "#products", "#d7d9de", "energy", 30, stamp, stamp),
                ],
            )
        # Refresh untouched starter banners while preserving every owner upload/edit.
        await db.executemany(
            "UPDATE storefront_banners SET title = ?, subtitle = ?, accent = ?, updated_at = ? "
            "WHERE art_variant = ? AND COALESCE(image_mime, '') = '' AND title = ?",
            [
                ("القوة تبدأ من الظلال", "تجربة رقمية جريئة بهوية Uchiha لا تشبه أي متجر آخر.", "#e4313f", palette_stamp, "ninja", "عالم Uchiha بين يديك"),
                ("حساب واحد، عالم واحد", "اربط بوت Uchiha واستخدم رصيدك وطلباتك من أي مكان.", "#b51d29", palette_stamp, "portal", "رصيد واحد في الموقع والبوت"),
                ("إرث لا ينطفئ", "صور السلايدر والأقسام والعروض تحت تحكمك من لوحة الإدارة.", "#d7d9de", palette_stamp, "energy", "طلبات مباشرة من JS4Card"),
            ],
        )
        await db.execute("DELETE FROM web_sessions WHERE expires_at <= ?", (now_text(),))
        await db.execute("DELETE FROM web_link_codes WHERE expires_at <= ?", (now_text(),))
        await db.commit()


async def audit(actor: str, action: str, details: str = "") -> None:
    async with aiosqlite.connect(db_path()) as db:
        await db.execute(
            "INSERT INTO storefront_audit(actor, action, details, created_at) VALUES (?, ?, ?, ?)",
            (actor[:80], action[:100], clean_text(details, 1000), now_text()),
        )
        await db.commit()


async def create_account(payload: dict[str, Any]) -> dict[str, Any]:
    username = normalize_username(str(payload.get("username", "")))
    email = normalize_email(str(payload.get("email", "")))
    phone = normalize_phone(str(payload.get("phone", "")))
    first_name = clean_text(payload.get("first_name"), 60)
    last_name = clean_text(payload.get("last_name"), 60)
    country = clean_text(payload.get("country"), 60)
    if not first_name:
        raise StorefrontError("invalid_name", "أدخل الاسم الأول.")
    password_value = str(payload.get("password", ""))
    encoded_password = hash_password(password_value)
    created = now_text()
    shadow_id = -(1_000_000_000_000 + secrets.randbelow(8_000_000_000_000))
    full_name = f"{first_name} {last_name}".strip()

    async with aiosqlite.connect(db_path()) as db:
        await db.execute("PRAGMA busy_timeout = 10000")
        try:
            await db.execute("BEGIN IMMEDIATE")
            for _ in range(4):
                async with db.execute("SELECT 1 FROM users WHERE user_id = ?", (shadow_id,)) as cursor:
                    if not await cursor.fetchone():
                        break
                shadow_id = -(1_000_000_000_000 + secrets.randbelow(8_000_000_000_000))
            await db.execute(
                "INSERT INTO users(user_id, username, full_name, balance, joined_date, store_username) "
                "VALUES (?, ?, ?, 0, ?, ?)",
                (shadow_id, username, full_name, created, username),
            )
            cursor = await db.execute(
                """
                INSERT INTO web_accounts
                (user_id, username, email, phone, country, first_name, last_name,
                 password_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (shadow_id, username, email, phone, country, first_name, last_name, encoded_password, created),
            )
            account_id = int(cursor.lastrowid)
            await db.commit()
        except sqlite3.IntegrityError as exc:
            await db.rollback()
            message = str(exc).casefold()
            if "email" in message:
                raise StorefrontError("email_exists", "هذا البريد مستخدم بالفعل.", 409) from exc
            if "username" in message:
                raise StorefrontError("username_exists", "اسم المستخدم مستخدم بالفعل.", 409) from exc
            raise StorefrontError("account_exists", "تعذر إنشاء الحساب بهذه البيانات.", 409) from exc
    await audit(f"account:{account_id}", "signup", username)
    return await get_account(account_id)


async def authenticate(identifier: str, password: str) -> dict[str, Any]:
    identifier = str(identifier or "").strip().casefold()
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM web_accounts
            WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND is_active = 1
            LIMIT 1
            """,
            (identifier, identifier),
        ) as cursor:
            row = await cursor.fetchone()
        if not row or not verify_password(password, str(row["password_hash"] or "")):
            raise StorefrontError("invalid_login", "بيانات تسجيل الدخول غير صحيحة.", 401)
        await db.execute("UPDATE web_accounts SET last_login_at = ? WHERE id = ?", (now_text(), row["id"]))
        await db.commit()
        return dict(row)


async def authenticate_admin(username: str, password: str) -> None:
    expected_user = os.getenv("STOREFRONT_ADMIN_USERNAME", "admin").strip() or "admin"
    expected_hash = os.getenv("STOREFRONT_ADMIN_PASSWORD_HASH", "").strip()
    expected_plain = os.getenv("STOREFRONT_ADMIN_PASSWORD", "").strip()
    user_ok = hmac.compare_digest(str(username or "").strip().casefold(), expected_user.casefold())
    if expected_hash:
        password_ok = verify_password(password, expected_hash)
    else:
        password_ok = bool(expected_plain) and hmac.compare_digest(password, expected_plain)
    if not user_ok or not password_ok:
        raise StorefrontError("invalid_admin_login", "بيانات دخول الإدارة غير صحيحة.", 401)


async def issue_session(*, account_id: int = 0, role: str = "customer") -> tuple[str, Session]:
    token = secrets.token_urlsafe(36)
    csrf = secrets.token_urlsafe(24)
    created = now_text()
    expires = future_text(hours=SESSION_HOURS)
    async with aiosqlite.connect(db_path()) as db:
        cursor = await db.execute(
            "INSERT INTO web_sessions(token_hash, role, account_id, csrf_token, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (token_hash(token), role, int(account_id), csrf, created, expires),
        )
        await db.commit()
        session_id = int(cursor.lastrowid)
    return token, Session(session_id, role, int(account_id), csrf, expires)


async def get_session(token: str | None, role: str | None = None) -> Session | None:
    if not token:
        return None
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, role, account_id, csrf_token, expires_at FROM web_sessions "
            "WHERE token_hash = ? AND expires_at > ? LIMIT 1",
            (token_hash(token), now_text()),
        ) as cursor:
            row = await cursor.fetchone()
    if not row or (role and str(row["role"]) != role):
        return None
    return Session(int(row["id"]), str(row["role"]), int(row["account_id"]), str(row["csrf_token"]), str(row["expires_at"]))


async def revoke_session(token: str | None) -> None:
    if not token:
        return
    async with aiosqlite.connect(db_path()) as db:
        await db.execute("DELETE FROM web_sessions WHERE token_hash = ?", (token_hash(token),))
        await db.commit()


async def get_account(account_id: int) -> dict[str, Any]:
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT a.id, a.user_id, a.telegram_id, a.username, a.email, a.phone,
                   a.country, a.first_name, a.last_name, a.created_at, a.last_login_at,
                   COALESCE(u.balance, 0) AS balance, COALESCE(u.is_banned, 0) AS is_banned
            FROM web_accounts a LEFT JOIN users u ON u.user_id = a.user_id
            WHERE a.id = ? AND a.is_active = 1
            """,
            (account_id,),
        ) as cursor:
            row = await cursor.fetchone()
    if not row:
        raise StorefrontError("account_not_found", "الحساب غير موجود.", 404)
    result = dict(row)
    result["linked"] = int(result.get("telegram_id") or 0) > 0
    result.pop("user_id", None)
    result["balance"] = round(float(result.get("balance") or 0), 2)
    return result


async def _account_wallet_id(account_id: int) -> int:
    async with aiosqlite.connect(db_path()) as db:
        async with db.execute(
            "SELECT user_id FROM web_accounts WHERE id = ? AND is_active = 1", (account_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if not row:
        raise StorefrontError("account_not_found", "الحساب غير موجود.", 404)
    return int(row[0])


def telegram_deep_link(base_url: str, code: str) -> str:
    base_url = str(base_url or "").strip()
    if not base_url:
        return ""
    parts = urlsplit(base_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["start"] = f"link_{code}"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


async def create_link_code(account_id: int, telegram_url: str) -> dict[str, Any]:
    account = await get_account(account_id)
    if account["linked"]:
        return {"linked": True, "telegram_id": account["telegram_id"]}
    code = secrets.token_urlsafe(24)
    created = now_text()
    expires = future_text(minutes=LINK_MINUTES)
    async with aiosqlite.connect(db_path()) as db:
        await db.execute("DELETE FROM web_link_codes WHERE account_id = ?", (account_id,))
        await db.execute(
            "INSERT INTO web_link_codes(token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash(code), account_id, created, expires),
        )
        await db.commit()
    return {
        "linked": False,
        "expires_at": expires,
        "bot_url": telegram_deep_link(telegram_url, code),
    }


async def complete_bot_link(code: str, telegram_id: int, username: str = "", full_name: str = "") -> dict[str, Any]:
    telegram_id = int(telegram_id or 0)
    if telegram_id <= 0 or not code:
        return {"status": "invalid"}
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA busy_timeout = 10000")
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute(
                "SELECT id, account_id FROM web_link_codes "
                "WHERE token_hash = ? AND used_at = '' AND expires_at > ? LIMIT 1",
                (token_hash(code), now_text()),
            ) as cursor:
                link = await cursor.fetchone()
            if not link:
                await db.rollback()
                return {"status": "expired"}
            account_id = int(link["account_id"])
            async with db.execute("SELECT * FROM web_accounts WHERE id = ?", (account_id,)) as cursor:
                account = await cursor.fetchone()
            if not account:
                await db.rollback()
                return {"status": "invalid"}
            current_telegram = int(account["telegram_id"] or 0)
            if current_telegram and current_telegram != telegram_id:
                await db.rollback()
                return {"status": "already_linked"}
            async with db.execute(
                "SELECT id FROM web_accounts WHERE telegram_id = ? AND id <> ?", (telegram_id, account_id)
            ) as cursor:
                conflict = await cursor.fetchone()
            if conflict:
                await db.rollback()
                return {"status": "telegram_in_use"}

            source_id = int(account["user_id"])
            if source_id != telegram_id:
                async with db.execute("SELECT * FROM users WHERE user_id = ?", (source_id,)) as cursor:
                    source = await cursor.fetchone()
                async with db.execute("SELECT * FROM users WHERE user_id = ?", (telegram_id,)) as cursor:
                    target = await cursor.fetchone()
                source_balance = float(source["balance"] or 0) if source else 0.0
                if target:
                    await db.execute(
                        "UPDATE users SET balance = balance + ?, username = ?, full_name = ? WHERE user_id = ?",
                        (source_balance, username or target["username"], full_name or target["full_name"], telegram_id),
                    )
                else:
                    await db.execute(
                        "INSERT INTO users(user_id, username, full_name, balance, joined_date, store_username) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (telegram_id, username, full_name or f"{account['first_name']} {account['last_name']}".strip(), source_balance, now_text(), account["username"]),
                    )

                # Tables using the shared wallet id. Missing legacy tables are skipped safely.
                for table in ("orders", "balance_logs", "deposit_requests", "activity_log", "support_tickets"):
                    try:
                        await db.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (telegram_id, source_id))
                    except sqlite3.OperationalError:
                        pass
                try:
                    await db.execute("UPDATE support_messages SET sender_id = ? WHERE sender_id = ?", (telegram_id, source_id))
                except sqlite3.OperationalError:
                    pass
                try:
                    await db.execute(
                        "INSERT OR IGNORE INTO favorites(user_id, product_id, added_at) "
                        "SELECT ?, product_id, added_at FROM favorites WHERE user_id = ?",
                        (telegram_id, source_id),
                    )
                    await db.execute("DELETE FROM favorites WHERE user_id = ?", (source_id,))
                except sqlite3.OperationalError:
                    pass
                try:
                    await db.execute(
                        "INSERT OR IGNORE INTO coupon_uses(coupon_id, user_id, used_at) "
                        "SELECT coupon_id, ?, used_at FROM coupon_uses WHERE user_id = ?",
                        (telegram_id, source_id),
                    )
                    await db.execute("DELETE FROM coupon_uses WHERE user_id = ?", (source_id,))
                except sqlite3.OperationalError:
                    pass
                await db.execute("DELETE FROM users WHERE user_id = ?", (source_id,))

            await db.execute(
                "UPDATE web_accounts SET user_id = ?, telegram_id = ? WHERE id = ?",
                (telegram_id, telegram_id, account_id),
            )
            await db.execute("UPDATE web_link_codes SET used_at = ? WHERE id = ?", (now_text(), link["id"]))
            await db.commit()
        except Exception:
            await db.rollback()
            raise
    await audit(f"telegram:{telegram_id}", "bot_link", f"account:{account_id}")
    return {"status": "linked", "account_id": account_id}


async def get_settings() -> dict[str, str]:
    async with aiosqlite.connect(db_path()) as db:
        async with db.execute("SELECT key, value FROM storefront_settings") as cursor:
            rows = await cursor.fetchall()
    return {str(key): str(value or "") for key, value in rows}


async def update_settings(values: dict[str, Any]) -> dict[str, str]:
    allowed = {
        "store_name", "tagline", "announcement", "support_telegram", "support_whatsapp",
        "support_email", "support_hours", "hero_interval_ms", "currency", "currency_symbol",
        "primary_color", "secondary_color", "accent_color",
    }
    rows: list[tuple[str, str, str]] = []
    for key, value in values.items():
        if key not in allowed:
            continue
        clean_value = clean_text(value, 500)
        if key.endswith("_color") and not re.fullmatch(r"#[0-9a-fA-F]{6}", clean_value):
            raise StorefrontError("invalid_color", f"قيمة اللون {key} غير صحيحة.")
        if key == "hero_interval_ms":
            try:
                clean_value = str(max(2500, min(12000, int(clean_value))))
            except ValueError as exc:
                raise StorefrontError("invalid_interval", "مدة انتقال الصور غير صحيحة.") from exc
        rows.append((key, clean_value, now_text()))
    async with aiosqlite.connect(db_path()) as db:
        await db.executemany(
            "INSERT INTO storefront_settings(key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            rows,
        )
        await db.commit()
    await audit("admin", "settings_update", ",".join(key for key, _, _ in rows))
    return await get_settings()


async def get_banners(*, include_disabled: bool = False) -> list[dict[str, Any]]:
    where = "" if include_disabled else "WHERE enabled = 1"
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT id, title, subtitle, cta_label, cta_target, accent, art_variant, "
            f"image_mime, enabled, sort_order, updated_at FROM storefront_banners {where} "
            "ORDER BY sort_order, id"
        ) as cursor:
            rows = await cursor.fetchall()
    generated_art = {
        "ninja": "/assets/hero-madara-v2.webp",
        "portal": "/assets/hero-obito-v2.webp",
        "energy": "/assets/hero-itachi-sasuke-v2.webp",
    }
    return [
        {
            **dict(row),
            "has_image": bool(row["image_mime"]),
            "image_url": (
                f"/v1/storefront/media/banner/{row['id']}?v={row['updated_at'].replace(' ', '')}"
                if row["image_mime"]
                else generated_art.get(str(row["art_variant"]), "/assets/hero-madara-v2.webp")
            ),
        }
        for row in rows
    ]


async def save_banner(data: dict[str, Any], image: bytes | None = None, mime: str = "") -> dict[str, Any]:
    banner_id = int(data.get("id") or 0)
    title = clean_text(data.get("title"), 100)
    if not title:
        raise StorefrontError("invalid_banner", "عنوان الصورة مطلوب.")
    accent = clean_text(data.get("accent") or "#e4313f", 10)
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
        raise StorefrontError("invalid_color", "لون الصورة غير صحيح.")
    if image is not None:
        if mime not in ALLOWED_IMAGE_MIME:
            raise StorefrontError("invalid_image", "صيغة الصورة غير مدعومة.")
        if len(image) > MAX_IMAGE_BYTES:
            raise StorefrontError("image_too_large", "حجم الصورة يجب ألا يتجاوز 3 ميغابايت.")
    fields = (
        title,
        clean_text(data.get("subtitle"), 220),
        clean_text(data.get("cta_label"), 40),
        clean_text(data.get("cta_target"), 200),
        accent,
        clean_text(data.get("art_variant") or "ninja", 30),
        1 if str(data.get("enabled", "1")).lower() not in {"0", "false", "off"} else 0,
        max(-10000, min(10000, int(data.get("sort_order") or 0))),
    )
    stamp = now_text()
    async with aiosqlite.connect(db_path()) as db:
        if banner_id:
            exists = await (await db.execute("SELECT 1 FROM storefront_banners WHERE id = ?", (banner_id,))).fetchone()
            if not exists:
                raise StorefrontError("banner_not_found", "الصورة غير موجودة.", 404)
            await db.execute(
                "UPDATE storefront_banners SET title=?, subtitle=?, cta_label=?, cta_target=?, "
                "accent=?, art_variant=?, enabled=?, sort_order=?, updated_at=? WHERE id=?",
                (*fields, stamp, banner_id),
            )
            if image is not None:
                await db.execute(
                    "UPDATE storefront_banners SET image_blob=?, image_mime=? WHERE id=?",
                    (image, mime, banner_id),
                )
        else:
            cursor = await db.execute(
                "INSERT INTO storefront_banners(title, subtitle, cta_label, cta_target, accent, "
                "art_variant, enabled, sort_order, created_at, updated_at, image_blob, image_mime) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (*fields, stamp, stamp, image, mime if image else ""),
            )
            banner_id = int(cursor.lastrowid)
        await db.commit()
    await audit("admin", "banner_save", str(banner_id))
    return next(item for item in await get_banners(include_disabled=True) if int(item["id"]) == banner_id)


async def delete_banner(banner_id: int) -> None:
    async with aiosqlite.connect(db_path()) as db:
        cursor = await db.execute("DELETE FROM storefront_banners WHERE id = ?", (int(banner_id),))
        await db.commit()
    if cursor.rowcount != 1:
        raise StorefrontError("banner_not_found", "الصورة غير موجودة.", 404)
    await audit("admin", "banner_delete", str(banner_id))


async def read_media(kind: str, item_id: int) -> tuple[bytes, str] | None:
    async with aiosqlite.connect(db_path()) as db:
        if kind == "banner":
            query = "SELECT image_blob, image_mime FROM storefront_banners WHERE id = ?"
        elif kind == "category":
            query = "SELECT image_blob, image_mime FROM storefront_category_media WHERE category_id = ?"
        elif kind == "deposit":
            query = "SELECT image_blob, image_mime FROM storefront_deposit_files WHERE request_id = ?"
        else:
            return None
        async with db.execute(query, (int(item_id),)) as cursor:
            row = await cursor.fetchone()
    if not row or not row[0] or not row[1]:
        return None
    return bytes(row[0]), str(row[1])


async def save_category_media(category_id: int, image: bytes, mime: str, accent: str = "#e4313f") -> None:
    if mime not in ALLOWED_IMAGE_MIME or not image:
        raise StorefrontError("invalid_image", "صيغة الصورة غير مدعومة.")
    if len(image) > MAX_IMAGE_BYTES:
        raise StorefrontError("image_too_large", "حجم الصورة يجب ألا يتجاوز 3 ميغابايت.")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
        accent = "#e4313f"
    async with aiosqlite.connect(db_path()) as db:
        exists = await (await db.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,))).fetchone()
        if not exists:
            raise StorefrontError("category_not_found", "القسم غير موجود.", 404)
        await db.execute(
            "INSERT INTO storefront_category_media(category_id, image_blob, image_mime, accent, updated_at) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(category_id) DO UPDATE SET "
            "image_blob=excluded.image_blob, image_mime=excluded.image_mime, "
            "accent=excluded.accent, updated_at=excluded.updated_at",
            (category_id, image, mime, accent, now_text()),
        )
        await db.commit()
    await audit("admin", "category_image", str(category_id))


def normalize_api_fields(params: object) -> list[dict[str, Any]]:
    if not params:
        return []
    if isinstance(params, dict):
        wrapped = params.get("params") or params.get("fields") or params.get("requirements")
        params = wrapped if wrapped is not None else [
            {"name": key, "label": value if isinstance(value, str) else key}
            for key, value in params.items()
        ]
    if not isinstance(params, list):
        params = [params]
    fields: list[dict[str, Any]] = []
    seen: set[str] = set()
    ignored = {"qty", "quantity", "orderuuid", "productid"}
    for item in params:
        if isinstance(item, str):
            key, label, required, options = item.strip(), item.strip(), True, []
        elif isinstance(item, dict):
            key = str(item.get("name") or item.get("key") or item.get("param") or item.get("field") or item.get("code") or item.get("id") or "").strip()
            label = str(item.get("label") or item.get("title") or item.get("display_name") or item.get("placeholder") or item.get("description") or key).strip()
            required = item.get("required", True) not in (False, 0, "0", "false", "False", "optional")
            options = item.get("options") or item.get("values") or item.get("choices") or []
        else:
            continue
        normalized = re.sub(r"[^a-z0-9]", "", key.casefold())
        if not key or normalized in ignored or normalized in seen:
            continue
        seen.add(normalized)
        if isinstance(options, dict):
            options = list(options.values())
        if not isinstance(options, list):
            options = [options]
        fields.append({
            "key": key,
            "label": clean_text(label, 120) or key,
            "required": bool(required),
            "options": [clean_text(value, 80) for value in options if str(value).strip()],
        })
    return fields


async def product_detail(product_id: int) -> dict[str, Any]:
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT p.id, p.category_id, p.name, p.description, p.price, p.stock,
                   p.is_active, COALESCE(p.product_type, 'stock') product_type,
                   COALESCE(p.delivery_time, '') delivery_time,
                   COALESCE(p.api_id, 0) api_id, COALESCE(p.api_provider, '') api_provider,
                   COALESCE(p.api_params, '{}') api_params, COALESCE(p.has_variants, 0) has_variants,
                   COALESCE(NULLIF(c.display_name, ''), c.name, 'منتجات رقمية') category_name
            FROM products p LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.id = ?
            """,
            (product_id,),
        ) as cursor:
            row = await cursor.fetchone()
        if not row or int(row["is_active"] or 0) != 1 or int(row["stock"] or 0) <= 0:
            raise StorefrontError("product_unavailable", "المنتج غير متاح حاليًا.", 404)
        try:
            api_params = json.loads(row["api_params"] or "{}")
        except json.JSONDecodeError:
            api_params = {}
        if not isinstance(api_params, dict):
            api_params = {}
        qty_values = api_params.get("qty_values") or {}
        try:
            min_qty = max(1, int(qty_values.get("min", 1) or 1))
        except (TypeError, ValueError):
            min_qty = 1
        try:
            max_qty = max(min_qty, int(qty_values.get("max", min_qty) or min_qty))
        except (TypeError, ValueError):
            max_qty = min_qty
        variants: list[dict[str, Any]] = []
        try:
            async with db.execute(
                "SELECT id, variant_name, price, stock, COALESCE(api_product_id,0), "
                "COALESCE(api_provider,'') FROM product_variants "
                "WHERE product_id = ? AND is_active = 1 AND stock > 0 ORDER BY sort_order, id",
                (product_id,),
            ) as cursor:
                variants = [
                    {"id": int(v[0]), "name": str(v[1]), "price": round(float(v[2] or 0), 2), "stock": int(v[3] or 0), "api_id": int(v[4] or 0), "api_provider": str(v[5] or "")}
                    for v in await cursor.fetchall()
                ]
        except sqlite3.OperationalError:
            variants = []
    return {
        "id": int(row["id"]), "category_id": int(row["category_id"] or 0),
        "category_name": str(row["category_name"]), "name": str(row["name"]),
        "description": clean_text(row["description"], 2500), "price": round(float(row["price"] or 0), 2),
        "stock": int(row["stock"] or 0), "product_type": str(row["product_type"]),
        "delivery_time": str(row["delivery_time"]), "provider": str(row["api_provider"]),
        "fields": normalize_api_fields(api_params.get("params") or []),
        "min_qty": min_qty, "max_qty": max_qty,
        "requires_quantity": str(api_params.get("product_type") or row["product_type"]).casefold() == "amount" or max_qty > min_qty,
        "variants": variants,
    }


def _validate_purchase(detail: dict[str, Any], payload: dict[str, Any]) -> tuple[int, dict[str, str], int]:
    try:
        quantity = int(payload.get("quantity") or detail["min_qty"] or 1)
    except (TypeError, ValueError) as exc:
        raise StorefrontError("invalid_quantity", "الكمية غير صحيحة.") from exc
    if quantity < int(detail["min_qty"]) or quantity > int(detail["max_qty"]):
        raise StorefrontError("invalid_quantity", f"الكمية يجب أن تكون من {detail['min_qty']} إلى {detail['max_qty']}.")
    raw_fields = payload.get("fields") or {}
    if not isinstance(raw_fields, dict):
        raise StorefrontError("invalid_fields", "بيانات الطلب غير صحيحة.")
    accepted: dict[str, str] = {}
    for field in detail["fields"]:
        value = clean_text(raw_fields.get(field["key"]), 500)
        if field["required"] and not value:
            raise StorefrontError("missing_field", f"الحقل «{field['label']}» مطلوب.")
        if value and field["options"] and value not in field["options"]:
            raise StorefrontError("invalid_option", f"اختر قيمة صحيحة للحقل «{field['label']}».")
        if value:
            accepted[str(field["key"])] = value
    try:
        variant_id = int(payload.get("variant_id") or 0)
    except (TypeError, ValueError):
        variant_id = 0
    return quantity, accepted, variant_id


async def purchase(account_id: int, product_id: int, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    """Place a website order using the same atomic bot purchase functions."""
    if not re.fullmatch(r"[A-Za-z0-9_\-:.]{8,120}", idempotency_key or ""):
        raise StorefrontError("invalid_idempotency", "أعد فتح نافذة الشراء وحاول مرة أخرى.")
    detail = await product_detail(product_id)
    quantity, fields, variant_id = _validate_purchase(detail, payload)
    user_id = await _account_wallet_id(account_id)
    purchase_token = "web:" + hashlib.sha256(f"{account_id}:{idempotency_key}".encode()).hexdigest()

    # Lazy import avoids a startup cycle; in production bot.py is already loaded by uchiha.py.
    import bot as store

    existing = await store.get_order_by_purchase_token(purchase_token)
    if existing:
        return {"status": "duplicate", "order_id": int(existing["id"]), "order_status": existing["status"], "charged": float(existing["total_price"] or 0)}

    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, price, api_id, api_provider, api_params, name FROM products WHERE id = ?",
            (product_id,),
        ) as cursor:
            product = await cursor.fetchone()
        variant = None
        if variant_id:
            async with db.execute(
                "SELECT id, variant_name, price, api_product_id, api_provider FROM product_variants "
                "WHERE id = ? AND product_id = ? AND is_active = 1 AND stock > 0",
                (variant_id, product_id),
            ) as cursor:
                variant = await cursor.fetchone()
            if not variant:
                raise StorefrontError("variant_unavailable", "الخيار المحدد غير متاح.")

    provider = str((variant["api_provider"] if variant else product["api_provider"]) or "")
    expected_price = round(float((variant["price"] if variant else product["price"]) or 0), 2)
    if provider != "js4card":
        result = await store.create_local_order_atomic(
            user_id=user_id, product_id=product_id, purchase_token=purchase_token,
            expected_price=expected_price, quantity=quantity, variant_id=variant_id,
            delivery_info=" | ".join(f"{key}: {value}" for key, value in fields.items()),
        )
        status = str(result.get("status"))
        if status == "duplicate":
            order = result.get("order") or {}
            return {
                "status": "duplicate",
                "order_id": int(order.get("id") or 0),
                "charged": float(order.get("total_price") or 0),
                "order_status": str(order.get("status") or "pending"),
            }
        if status == "insufficient_balance":
            raise StorefrontError("insufficient_balance", "رصيدك غير كافٍ لإتمام الطلب.", 409)
        if status != "created":
            raise StorefrontError(status, "تعذر إنشاء الطلب؛ حدّث الصفحة وحاول مجددًا.", 409)
        return {"status": "created", "order_id": result["order_id"], "charged": result["total_price"], "order_status": "pending"}

    api_product_id = int((variant["api_product_id"] if variant else product["api_id"]) or 0)
    api_request_uuid = str(uuid.uuid4())
    try:
        params_payload = json.loads(product["api_params"] or "{}")
    except json.JSONDecodeError:
        params_payload = {}
    base_price = float((params_payload or {}).get("base_price", 0) or 0)
    labels = {str(field["key"]): str(field["label"]) for field in detail["fields"]}
    delivery = " | ".join(f"{labels.get(key, key)}: {value}" for key, value in fields.items())
    request_payload = {
        "api_product_id": api_product_id, "local_product_id": product_id,
        "variant_id": variant_id, "quantity": quantity, "fields": fields,
        "request_uuid": api_request_uuid, "base_price": base_price,
    }
    reservation = await store.reserve_api_order_atomic(
        user_id=user_id, local_product_id=product_id, api_product_id=api_product_id,
        quantity=quantity, expected_unit_price=expected_price, purchase_token=purchase_token,
        api_request_uuid=api_request_uuid, delivery_info=delivery,
        request_payload=request_payload, variant_id=variant_id,
    )
    reservation_status = str(reservation.get("status"))
    if reservation_status == "duplicate":
        order = reservation["order"]
        return {"status": "duplicate", "order_id": int(order["id"]), "charged": float(order["total_price"]), "order_status": order.get("api_status") or order["status"]}
    if reservation_status == "insufficient_balance":
        raise StorefrontError("insufficient_balance", "رصيدك غير كافٍ لإتمام الطلب.", 409)
    if reservation_status == "price_changed":
        raise StorefrontError("price_changed", "تغيّر سعر المنتج؛ راجع السعر الجديد.", 409)
    if reservation_status != "created":
        raise StorefrontError(reservation_status, "المنتج غير متاح حاليًا.", 409)

    order_id = int(reservation["order_id"])
    from api_js4card import JS4CardAPI

    try:
        async with aiosqlite.connect(db_path()) as db:
            await db.execute("UPDATE orders SET api_status='sending', api_status_updated_at=? WHERE id=?", (now_text(), order_id))
            await db.commit()
        player_id, extra_params = store.get_player_id_from_fields(fields)
        async with JS4CardAPI(api_token=os.getenv("API_TOKEN", "").strip(), connection_limit=1) as api:
            api_result = await api.create_order(api_product_id, qty=quantity, player_id=player_id, order_uuid=api_request_uuid, **extra_params)
        result_ok = bool(isinstance(api_result, dict) and api_result.get("_ok", True))
        result_status = str((api_result or {}).get("status", "")).casefold()
        if not result_ok or result_status in {"error", "failed", "fail", "invalid", "rejected"}:
            if store.is_definitive_api_failure(api_result):
                message = clean_text((api_result or {}).get("message") or (api_result or {}).get("error"), 500)
                async with aiosqlite.connect(db_path()) as db:
                    await db.execute(
                        "UPDATE orders SET status='cancelled', api_status='rejected', api_status_message=?, "
                        "api_status_updated_at=?, api_monitor_active=0 WHERE id=?",
                        (message, now_text(), order_id),
                    )
                    await db.commit()
                refunded = await store.refund_api_order_once(order_id)
                raise StorefrontError("provider_rejected", f"رفض مزود الخدمة الطلب. أُعيد {refunded:.2f} إلى رصيدك.", 409)
            return {"status": "processing", "order_id": order_id, "charged": reservation["total_price"], "order_status": "sending"}
        api_order_id, raw_status, provider_message = store.extract_created_api_order(api_result)
        status_info = store.classify_api_order_status(raw_status)
        async with aiosqlite.connect(db_path()) as db:
            await db.execute(
                "UPDATE orders SET status=?, api_order_id=?, api_status=?, api_status_message=?, "
                "api_status_updated_at=?, api_last_checked_at=?, api_notified_status=?, api_monitor_active=? WHERE id=?",
                (status_info["local_status"], api_order_id, status_info["raw"], provider_message,
                 now_text(), now_text(), status_info["key"], 0 if status_info["final"] else 1, order_id),
            )
            await db.commit()
        if status_info["failed"]:
            await store.refund_api_order_once(order_id)
        await audit(f"account:{account_id}", "web_purchase", f"order:{order_id}")
        return {"status": "created", "order_id": order_id, "charged": reservation["total_price"], "order_status": status_info["local_status"]}
    except StorefrontError:
        raise
    except Exception:
        # The existing bot recovery worker will query/re-send by the stable UUID.
        return {"status": "processing", "order_id": order_id, "charged": reservation["total_price"], "order_status": "sending"}


async def account_orders(account_id: int, limit: int = 50) -> list[dict[str, Any]]:
    user_id = await _account_wallet_id(account_id)
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT o.id, o.quantity, o.total_price, o.status, o.order_date,
                   COALESCE(o.api_status, '') api_status, COALESCE(o.delivery_info, '') delivery_info,
                   COALESCE(p.name, 'منتج') product_name
            FROM orders o LEFT JOIN products p ON p.id = o.product_id
            WHERE o.user_id = ? ORDER BY o.id DESC LIMIT ?
            """,
            (user_id, max(1, min(100, int(limit)))),
        ) as cursor:
            rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def wallet_history(account_id: int, limit: int = 50) -> dict[str, Any]:
    user_id = await _account_wallet_id(account_id)
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT COALESCE(balance,0) FROM users WHERE user_id=?", (user_id,)) as cursor:
            row = await cursor.fetchone()
            balance = float(row[0] or 0) if row else 0.0
        async with db.execute(
            "SELECT id, amount, type, reason, date FROM balance_logs WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, max(1, min(100, int(limit)))),
        ) as cursor:
            logs = [dict(item) for item in await cursor.fetchall()]
        async with db.execute(
            "SELECT COALESCE(SUM(total_price),0), COUNT(*) FROM orders WHERE user_id=?",
            (user_id,),
        ) as cursor:
            totals = await cursor.fetchone()
    return {"balance": round(balance, 2), "purchases": round(float(totals[0] or 0), 2), "orders": int(totals[1] or 0), "items": logs}


async def payment_methods() -> list[dict[str, Any]]:
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT id, name, details, icon, currency, min_amount, max_amount,
                   transfer_label, transfer_value, credit_rate, fixed_fee, fee_percent,
                   proof_required, proof_mode, payment_mode, auto_provider
            FROM payment_methods WHERE is_active=1 ORDER BY sort_order, id
            """
        ) as cursor:
            rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def create_deposit(
    account_id: int,
    method_id: int,
    amount: float,
    reference: str = "",
    proof: bytes | None = None,
    proof_mime: str = "",
) -> dict[str, Any]:
    user_id = await _account_wallet_id(account_id)
    try:
        amount_decimal = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise StorefrontError("invalid_amount", "المبلغ غير صحيح.") from exc
    if amount_decimal <= 0:
        raise StorefrontError("invalid_amount", "أدخل مبلغًا أكبر من صفر.")
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM payment_methods WHERE id=? AND is_active=1", (method_id,)) as cursor:
            method = await cursor.fetchone()
        if not method:
            raise StorefrontError("method_unavailable", "طريقة الدفع غير متاحة.", 404)
        minimum, maximum = Decimal(str(method["min_amount"] or 0)), Decimal(str(method["max_amount"] or 0))
        if minimum > 0 and amount_decimal < minimum:
            raise StorefrontError("below_minimum", f"الحد الأدنى هو {minimum} {method['currency']}.")
        if maximum > 0 and amount_decimal > maximum:
            raise StorefrontError("above_maximum", f"الحد الأعلى هو {maximum} {method['currency']}.")
        credited = amount_decimal * Decimal(str(method["credit_rate"] or 1))
        credited -= Decimal(str(method["fixed_fee"] or 0))
        credited -= credited * Decimal(str(method["fee_percent"] or 0)) / Decimal("100")
        credited = max(Decimal("0"), credited).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if credited <= 0:
            raise StorefrontError("invalid_credit", "المبلغ بعد الرسوم لا ينتج رصيدًا صالحًا.")
        if method["auto_provider"] == "binance_deposit":
            import bot as store
            if not getattr(store, "BINANCE_WALLET", None) or not store.BINANCE_WALLET.ready:
                raise StorefrontError("gateway_unavailable", "بوابة Binance غير مفعلة حاليًا.", 503)
            async with store.BINANCE_PAYMENT_LOCK:
                await db.execute(
                    "UPDATE deposit_requests SET status='cancelled', reviewed_at=? "
                    "WHERE user_id=? AND payment_method_id=? AND status='waiting_payment'",
                    (now_text(), user_id, method_id),
                )
                exact = await store._allocate_binance_exact_amount(db, amount_decimal)
                exact_text = store._decimal_text(exact)
                try:
                    auto_config = json.loads(method["auto_config"] or "{}")
                except (json.JSONDecodeError, TypeError):
                    auto_config = {}
                expires = future_text(minutes=int(getattr(store, "BINANCE_PAYMENT_WINDOW_MINUTES", 120)))
                snapshot = {
                    "provider": "binance_deposit", "coin": getattr(store, "BINANCE_COIN", "USDT"),
                    "network": getattr(store, "BINANCE_NETWORK", "TRX"),
                    "address": str(method["transfer_value"] or ""), "tag": str(auto_config.get("tag") or ""),
                    "requested_amount": str(amount_decimal), "exact_amount": exact_text,
                }
                cursor = await db.execute(
                    """
                    INSERT INTO deposit_requests
                    (user_id, amount, payment_method, proof_type, proof_content, proof_file_id,
                     status, created_at, payment_method_id, paid_amount, credited_amount,
                     payment_snapshot, transaction_reference, expected_amount, expires_at,
                     auto_checked_at, auto_error, provider_payload)
                    VALUES (?, ?, ?, 'automatic', '', '', 'waiting_payment', ?, ?, ?, ?, ?, '', ?, ?, '', '', '{}')
                    """,
                    (user_id, float(credited), str(method["name"]), now_text(), method_id,
                     float(exact), float(credited), json.dumps(snapshot, ensure_ascii=False), exact_text, expires),
                )
                request_id = int(cursor.lastrowid)
                await db.commit()
            return {"id": request_id, "status": "waiting_payment", "expected_amount": exact_text, "expires_at": expires, "address": str(method["transfer_value"] or ""), "currency": str(method["currency"] or "USD")}

        if int(method["proof_required"] or 0) and not proof and not reference.strip():
            raise StorefrontError("proof_required", "أرفق إثبات التحويل أو رقم العملية.")
        if proof is not None:
            if proof_mime not in ALLOWED_IMAGE_MIME or len(proof) > MAX_IMAGE_BYTES:
                raise StorefrontError("invalid_proof", "إثبات التحويل يجب أن يكون صورة لا تتجاوز 3 ميغابايت.")
        snapshot = {"method": str(method["name"]), "transfer_label": str(method["transfer_label"] or ""), "transfer_value": str(method["transfer_value"] or ""), "paid_amount": str(amount_decimal), "credited_amount": str(credited)}
        cursor = await db.execute(
            """
            INSERT INTO deposit_requests
            (user_id, amount, payment_method, proof_type, proof_content, proof_file_id,
             status, created_at, payment_method_id, paid_amount, credited_amount,
             payment_snapshot, transaction_reference)
            VALUES (?, ?, ?, ?, ?, '', 'pending', ?, ?, ?, ?, ?, ?)
            """,
            (user_id, float(credited), str(method["name"]), "image" if proof else "text",
             "website_upload" if proof else clean_text(reference, 500), now_text(), method_id,
             float(amount_decimal), float(credited), json.dumps(snapshot, ensure_ascii=False), clean_text(reference, 120)),
        )
        request_id = int(cursor.lastrowid)
        if proof:
            await db.execute(
                "INSERT OR REPLACE INTO storefront_deposit_files(request_id, image_blob, image_mime, created_at) VALUES (?, ?, ?, ?)",
                (request_id, proof, proof_mime, now_text()),
            )
        await db.commit()
    await audit(f"account:{account_id}", "deposit_create", f"request:{request_id}")
    return {"id": request_id, "status": "pending", "credited_amount": float(credited)}


async def admin_dashboard() -> dict[str, Any]:
    async with aiosqlite.connect(db_path()) as db:
        async def scalar(query: str, params: tuple[Any, ...] = ()) -> float:
            async with db.execute(query, params) as cursor:
                row = await cursor.fetchone()
                return float(row[0] or 0) if row else 0.0
        return {
            "accounts": int(await scalar("SELECT COUNT(*) FROM web_accounts")),
            "linked_accounts": int(await scalar("SELECT COUNT(*) FROM web_accounts WHERE telegram_id>0")),
            "products": int(await scalar("SELECT COUNT(*) FROM products WHERE is_active=1")),
            "orders": int(await scalar("SELECT COUNT(*) FROM orders")),
            "sales": round(await scalar("SELECT COALESCE(SUM(total_price),0) FROM orders WHERE status<>'cancelled'"), 2),
            "pending_deposits": int(await scalar("SELECT COUNT(*) FROM deposit_requests WHERE status IN ('pending','waiting_payment')")),
        }


async def admin_accounts(limit: int = 100) -> list[dict[str, Any]]:
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT a.id, a.username, a.email, a.phone, a.telegram_id, a.created_at, "
            "COALESCE(u.balance,0) balance, COALESCE(u.is_banned,0) is_banned "
            "FROM web_accounts a LEFT JOIN users u ON u.user_id=a.user_id ORDER BY a.id DESC LIMIT ?",
            (max(1, min(500, int(limit))),),
        ) as cursor:
            return [dict(row) for row in await cursor.fetchall()]


async def admin_adjust_balance(account_id: int, amount: float, reason: str) -> dict[str, Any]:
    user_id = await _account_wallet_id(account_id)
    amount = round(float(amount), 2)
    if amount == 0 or abs(amount) > 1_000_000:
        raise StorefrontError("invalid_amount", "قيمة تعديل الرصيد غير صحيحة.")
    async with aiosqlite.connect(db_path()) as db:
        await db.execute("BEGIN IMMEDIATE")
        if amount < 0:
            changed = await db.execute("UPDATE users SET balance=balance+? WHERE user_id=? AND balance>=?", (amount, user_id, abs(amount)))
            if changed.rowcount != 1:
                await db.rollback()
                raise StorefrontError("insufficient_balance", "رصيد العميل أقل من قيمة الخصم.", 409)
        else:
            await db.execute("UPDATE users SET balance=balance+? WHERE user_id=?", (amount, user_id))
        await db.execute(
            "INSERT INTO balance_logs(user_id,amount,type,reason,date,admin_id) VALUES (?,?,?,?,?,?)",
            (user_id, abs(amount), "add" if amount > 0 else "deduct", clean_text(reason, 250) or "تعديل من لوحة الموقع", now_text(), int(os.getenv("ADMIN_ID", "0") or 0)),
        )
        await db.commit()
    await audit("admin", "balance_adjust", f"account:{account_id};amount:{amount}")
    return await get_account(account_id)


async def admin_deposits(limit: int = 100) -> list[dict[str, Any]]:
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT d.id, d.user_id, d.amount, d.paid_amount, d.credited_amount,
                   d.payment_method, d.status, d.created_at, d.transaction_reference,
                   d.proof_type, a.id account_id, a.username
            FROM deposit_requests d LEFT JOIN web_accounts a ON a.user_id=d.user_id
            ORDER BY d.id DESC LIMIT ?
            """,
            (max(1, min(500, int(limit))),),
        ) as cursor:
            rows = await cursor.fetchall()
    return [{**dict(row), "proof_url": f"/v1/storefront/media/deposit/{row['id']}" if row["proof_type"] == "image" else ""} for row in rows]


async def admin_review_deposit(request_id: int, decision: str, note: str = "") -> dict[str, Any]:
    decision = str(decision).casefold()
    if decision not in {"approve", "reject"}:
        raise StorefrontError("invalid_decision", "قرار المراجعة غير صحيح.")
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        async with db.execute("SELECT * FROM deposit_requests WHERE id=?", (request_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            await db.rollback()
            raise StorefrontError("deposit_not_found", "طلب الشحن غير موجود.", 404)
        if str(row["status"]) != "pending":
            await db.rollback()
            raise StorefrontError("deposit_reviewed", "تمت مراجعة هذا الطلب مسبقًا.", 409)
        new_status = "approved" if decision == "approve" else "rejected"
        changed = await db.execute(
            "UPDATE deposit_requests SET status=?, reviewed_at=?, admin_note=? WHERE id=? AND status='pending'",
            (new_status, now_text(), clean_text(note, 500), request_id),
        )
        if changed.rowcount != 1:
            await db.rollback()
            raise StorefrontError("deposit_reviewed", "تمت مراجعة هذا الطلب مسبقًا.", 409)
        credited = round(float(row["credited_amount"] or row["amount"] or 0), 2)
        if decision == "approve" and credited > 0:
            await db.execute("UPDATE users SET balance=balance+? WHERE user_id=?", (credited, row["user_id"]))
            await db.execute(
                "INSERT INTO balance_logs(user_id,amount,type,reason,date,admin_id) VALUES (?,?,'add',?,?,?)",
                (row["user_id"], credited, f"اعتماد شحن الموقع #{request_id}", now_text(), int(os.getenv("ADMIN_ID", "0") or 0)),
            )
        await db.commit()
    await audit("admin", f"deposit_{decision}", f"request:{request_id}")
    return {"id": request_id, "status": new_status, "credited": credited if decision == "approve" else 0}


__all__ = [name for name in globals() if not name.startswith("_")]
