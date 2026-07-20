"""
=============================================================================
بوت متجر تيليجرام الاحترافي - النسخة المحدثة الكاملة
=============================================================================
المكتبات: aiogram 3.x, aiosqlite, python-dotenv
Python: 3.12+
التحديثات:
- نظام طرق دفع يدوية + دفع Binance USDT تلقائي بمفتاح قراءة فقط
- مركز دعم متكامل: تذاكر محفوظة + واتساب + تيليجرام
- طلبات شحن الرصيد مع التحقق بصورة أو نص
- طلبات المنتجات في الأدمن (قسم منفصل)
- منتجات يدوية (تسليم يدوي) ومنتجات مخزون (رقمية)
- عرض المنتجات 2 عرضياً
- العملة: دولار $
=============================================================================
"""

import asyncio
import logging
import os
import datetime
import json
import math
import re
import html
import sys
import uuid
import hmac
import hashlib
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import quote, urlencode

import aiohttp
from typing import Any
from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv

import aiosqlite
from aiogram import Bot, Dispatcher, types, F, BaseMiddleware
from aiogram.filters import CommandStart, Command, StateFilter
from aiogram.types import (
    InlineKeyboardMarkup, InlineKeyboardButton,
    CallbackQuery, Message, ReplyKeyboardRemove
)

try:
    # زر نسخ مباشر مدعوم في aiogram الحديثة / Telegram Bot API 7.11+
    from aiogram.types import CopyTextButton
except ImportError:  # توافق احتياطي مع إصدار أقدم من aiogram
    CopyTextButton = None
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramNetworkError
from api_js4card import JS4CardAPI

if sys.version_info < (3, 12):
    raise RuntimeError(
        'UCHIHA STORE يحتاج Python 3.12 أو أحدث. اختر Python 3.12 من إعدادات السيرفر.'
    )

# =============================================================================
# إعداد السجلات (Logging)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# إضافة معالج يدعم UTF-8 للكونسول والملفات
log_formatter = logging.Formatter('%(asctime)s | %(levelname)-8s | %(name)s | %(message)s')

# معالج الملف
file_handler = logging.FileHandler('bot.log', encoding='utf-8')
file_handler.setFormatter(log_formatter)
logger.addHandler(file_handler)

# معالج الكونسول
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
logger.addHandler(console_handler)
logger.propagate = False # منع التكرار

# =============================================================================
# تحميل متغيرات البيئة
# =============================================================================
load_dotenv()
BOT_TOKEN: str = os.getenv('BOT_TOKEN', '').strip()
ADMIN_ID_ENV = os.getenv('ADMIN_ID', '0').strip()
ADMIN_ID: int = int(ADMIN_ID_ENV) if ADMIN_ID_ENV.isdigit() else 0
DB_PATH: str = os.getenv('DB_PATH', 'store.db').strip()

# جلب توكن API لمتجر js4card
API_TOKEN: str = os.getenv('API_TOKEN', '').strip()

# إعدادات المزامنة السريعة والآمنة
def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))

SYNC_CONCURRENCY: int = _env_int('SYNC_CONCURRENCY', 2, 1, 4)
SYNC_BATCH_SIZE: int = _env_int('SYNC_BATCH_SIZE', 8, 1, 25)
SYNC_CATEGORY_MAX_ATTEMPTS: int = _env_int('SYNC_CATEGORY_MAX_ATTEMPTS', 3, 1, 10)
# المزامنة التلقائية تعمل مرة واحدة عند التشغيل فقط.
# بعد ذلك يتم التحديث يدوياً من لوحة الإدارة حتى لا يعيد البوت المزامنة باستمرار.
SYNC_MIN_RESTART_INTERVAL_SECONDS: int = _env_int('SYNC_MIN_RESTART_INTERVAL_SECONDS', 900, 0, 86400)
SYNC_START_DELAY_SECONDS: int = _env_int('SYNC_START_DELAY_SECONDS', 3, 0, 60)
SYNC_ON_START: bool = os.getenv('SYNC_ON_START', 'true').strip().lower() not in {'0', 'false', 'no', 'off'}
PAYMENT_SYNC_ON_START: bool = False  # طرق الدفع تُدار يدوياً حالياً؛ الأتمتة ستُضاف لاحقاً.


# دفع Binance التلقائي عبر واجهة Wallet للقراءة فقط.
# لا تستخدم هذه الميزة السحب أو التداول؛ تقرأ عنوان الإيداع وسجل الإيداعات فقط.
def _env_flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, '1' if default else '0').strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_decimal(name: str, default: str, minimum: str, maximum: str) -> Decimal:
    try:
        value = Decimal(os.getenv(name, default).strip())
    except (InvalidOperation, AttributeError):
        value = Decimal(default)
    return max(Decimal(minimum), min(value, Decimal(maximum)))


BINANCE_AUTO_PAY_ENABLED: bool = _env_flag('BINANCE_AUTO_PAY_ENABLED', False)
BINANCE_API_KEY: str = os.getenv('BINANCE_API_KEY', '').strip()
BINANCE_API_SECRET: str = os.getenv('BINANCE_API_SECRET', '').strip()
BINANCE_API_BASE_URL: str = os.getenv('BINANCE_API_BASE_URL', 'https://api.binance.com').strip().rstrip('/')
BINANCE_COIN: str = os.getenv('BINANCE_COIN', 'USDT').strip().upper() or 'USDT'
BINANCE_NETWORK: str = os.getenv('BINANCE_NETWORK', 'TRX').strip().upper() or 'TRX'
BINANCE_DEPOSIT_ADDRESS: str = os.getenv('BINANCE_DEPOSIT_ADDRESS', '').strip()
BINANCE_MIN_AMOUNT: Decimal = _env_decimal('BINANCE_MIN_AMOUNT', '5', '1', '100000')
BINANCE_MAX_AMOUNT: Decimal = _env_decimal('BINANCE_MAX_AMOUNT', '1000', '1', '1000000')
BINANCE_UNIQUE_STEP: Decimal = _env_decimal('BINANCE_UNIQUE_STEP', '0.001', '0.001', '0.01')
BINANCE_UNIQUE_SLOTS: int = _env_int('BINANCE_UNIQUE_SLOTS', 99, 10, 999)
BINANCE_PAYMENT_WINDOW_MINUTES: int = _env_int('BINANCE_PAYMENT_WINDOW_MINUTES', 120, 15, 1440)
BINANCE_POLL_SECONDS: int = _env_int('BINANCE_POLL_SECONDS', 60, 30, 1800)
BINANCE_RECV_WINDOW: int = _env_int('BINANCE_RECV_WINDOW', 5000, 1000, 60000)
BINANCE_START_DELAY_SECONDS: int = _env_int('BINANCE_START_DELAY_SECONDS', 10, 0, 300)

# متابعة حالات طلبات الموقع تلقائياً بدون تدخل الإدارة
ORDER_STATUS_MONITOR_ENABLED: bool = os.getenv(
    'ORDER_STATUS_MONITOR_ENABLED', 'true'
).strip().lower() not in {'0', 'false', 'no', 'off'}
ORDER_STATUS_CHECK_INTERVAL_SECONDS: int = _env_int(
    'ORDER_STATUS_CHECK_INTERVAL_SECONDS', 60, 30, 1800
)
ORDER_STATUS_START_DELAY_SECONDS: int = _env_int(
    'ORDER_STATUS_START_DELAY_SECONDS', 15, 0, 300
)
ORDER_STATUS_BATCH_SIZE: int = _env_int(
    'ORDER_STATUS_BATCH_SIZE', 50, 1, 100
)

if not BOT_TOKEN:
    logger.warning("⚠️ BOT_TOKEN غير موجود في ملف .env")
if not ADMIN_ID:
    logger.warning("⚠️ ADMIN_ID غير موجود في ملف .env")
if not API_TOKEN:
    logger.warning("⚠️ API_TOKEN غير موجود في ملف .env")

# =============================================================================
# إعداد البوت والـ Dispatcher
# =============================================================================
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# يمنع تشغيل مزامنتين في الوقت نفسه
API_SYNC_LOCK = asyncio.Lock()
API_SYNC_STATUS = {
    'running': False,
    'mode': '',
    'last_result': '',
    'last_duration': 0.0,
    'categories_done': 0,
    'categories_pending': 0,
    'categories_failed': 0,
    'products_seen': 0,
    'rate_limit_hits': 0,
}

PAYMENT_SYNC_LOCK = asyncio.Lock()
PAYMENT_SYNC_STATUS = {
    'running': False,
    'last_result': '',
    'last_count': 0,
}

# يمنع تشغيل فحصين لحالات الطلبات في الوقت نفسه
ORDER_STATUS_LOCK = asyncio.Lock()

# أقفال قصيرة تمنع تنفيذ طلبين متزامنين للمستخدم نفسه داخل نفس نسخة البوت.
# الحماية الأساسية تبقى داخل قاعدة البيانات عبر purchase_token الفريد.
PURCHASE_LOCKS: dict[int, asyncio.Lock] = {}

def get_purchase_lock(user_id: int) -> asyncio.Lock:
    lock = PURCHASE_LOCKS.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        PURCHASE_LOCKS[user_id] = lock
    return lock


# =============================================================================
# تعريف حالات FSM (Finite State Machine)
# =============================================================================
class AdminCategoryStates(StatesGroup):
    waiting_name = State()
    waiting_edit_name = State()
    waiting_group_name = State()
    waiting_sort_order = State()
    waiting_search = State()

class AdminProductStates(StatesGroup):
    waiting_name = State()
    waiting_description = State()
    waiting_price = State()
    waiting_stock = State()
    waiting_category = State()
    waiting_type = State()
    waiting_delivery_info = State()

class AdminBalanceStates(StatesGroup):
    waiting_user_id = State()
    waiting_amount = State()
    waiting_reason = State()
    action_type = State()

class AdminBroadcastStates(StatesGroup):
    waiting_message = State()

class AdminMessageUserStates(StatesGroup):
    waiting_target_user_id = State()
    waiting_message_text = State()

class AdminSettingsStates(StatesGroup):
    waiting_welcome_message = State()
    waiting_support_message = State()
    waiting_setting_key = State()
    waiting_setting_value = State()
    waiting_support_whatsapp = State()
    waiting_support_telegram = State()

class SupportTicketStates(StatesGroup):
    waiting_new_message = State()
    waiting_user_reply = State()

class AdminSupportStates(StatesGroup):
    waiting_admin_reply = State()

class AdminAdminStates(StatesGroup):
    waiting_new_admin_id = State()
    waiting_remove_admin_id = State()

class AdminOrderStates(StatesGroup):
    waiting_order_status = State()

class AdminCouponStates(StatesGroup):
    waiting_code = State()
    waiting_discount = State()
    waiting_max_uses = State()

class AdminProductEditStates(StatesGroup):
    waiting_new_name = State()
    waiting_new_desc = State()
    waiting_new_price = State()
    waiting_new_stock = State()
    waiting_new_delivery = State()
    waiting_new_time = State()
    waiting_new_btns = State()

class AdminAPIManageStates(StatesGroup):
    waiting_new_price = State()

class AdminProfitMarginStates(StatesGroup):
    waiting_margin = State()
    waiting_category_margin = State()

class AdminAdminPermStates(StatesGroup):
    waiting_perm_value = State()

class AdminCategoryEditStates(StatesGroup):
    waiting_parent_id = State()

class AdminAddAdminStates(StatesGroup):
    waiting_admin_id = State()

class AdminManageStates(StatesGroup):
    waiting_note = State()

# حالات طرق الدفع
class AdminPaymentMethodStates(StatesGroup):
    waiting_method_name = State()
    waiting_method_account = State()
    waiting_method_currency = State()
    waiting_method_limits = State()
    waiting_method_conversion = State()
    waiting_method_proof_mode = State()
    waiting_method_details = State()
    waiting_method_image = State()

# حالات طلبات شحن الرصيد
class DepositRequestStates(StatesGroup):
    waiting_amount = State()
    waiting_payment_method = State()
    waiting_proof = State()

# حالات طلبات المنتجات اليدوية
class ProductOrderStates(StatesGroup):
    waiting_delivery_info = State()

# حالات استيراد منتجات API
class AdminAPIImportStates(StatesGroup):
    waiting_api_token = State()
    waiting_category_selection = State()
    waiting_product_selection = State()

# حالات شراء منتجات من API
class APIProductPurchaseStates(StatesGroup):
    waiting_player_id = State()
    waiting_quantity = State()
    waiting_confirmation = State()
    waiting_dynamic_field = State()  # لجمع الحقول الديناميكية من API


# =============================================================================
# تهيئة قاعدة البيانات الكاملة
# =============================================================================
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        # جدول المستخدمين
        await db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                user_id     INTEGER PRIMARY KEY,
                username    TEXT,
                full_name   TEXT,
                balance     REAL    DEFAULT 0.0,
                joined_date TEXT,
                is_banned   INTEGER DEFAULT 0,
                is_blocked  INTEGER DEFAULT 0
            )
        ''')
        # جدول المشرفين
        await db.execute('''
            CREATE TABLE IF NOT EXISTS admins (
                admin_id              INTEGER PRIMARY KEY,
                added_by              INTEGER,
                added_at              TEXT,
                can_manage_products   INTEGER DEFAULT 0,
                can_manage_users      INTEGER DEFAULT 0,
                can_manage_balance    INTEGER DEFAULT 0,
                can_send_broadcast    INTEGER DEFAULT 0,
                can_manage_orders     INTEGER DEFAULT 0,
                can_manage_categories INTEGER DEFAULT 0,
                can_manage_coupons    INTEGER DEFAULT 0,
                can_view_stats        INTEGER DEFAULT 0,
                can_manage_tickets    INTEGER DEFAULT 0,
                can_manage_payments   INTEGER DEFAULT 0,
                can_manage_settings   INTEGER DEFAULT 0,
                can_manage_sync       INTEGER DEFAULT 0,
                role_name             TEXT DEFAULT 'custom',
                is_active             INTEGER DEFAULT 1,
                note                  TEXT DEFAULT '',
                last_action_at        TEXT DEFAULT ''
            )
        ''')
        # جدول الأقسام
        await db.execute('''
            CREATE TABLE IF NOT EXISTS categories (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT    UNIQUE,
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0
            )
        ''')
        # جدول المنتجات (مع نوع المنتج: stock=مخزون, manual=يدوي)
        await db.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id   INTEGER,
                name          TEXT,
                description   TEXT,
                price         REAL,
                stock         INTEGER DEFAULT 0,
                is_active     INTEGER DEFAULT 1,
                created_at    TEXT,
                product_type  TEXT DEFAULT 'stock',
                delivery_info TEXT DEFAULT '',
                api_id        INTEGER DEFAULT 0,
                api_provider  TEXT DEFAULT '',
                api_params    TEXT DEFAULT '{}',
                last_synced   TEXT DEFAULT '',
                FOREIGN KEY(category_id) REFERENCES categories(id)
            )
        ''')
        # جدول الطلبات
        await db.execute('''
            CREATE TABLE IF NOT EXISTS orders (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER,
                product_id    INTEGER,
                quantity      INTEGER DEFAULT 1,
                total_price   REAL,
                status        TEXT    DEFAULT 'pending',
                order_date    TEXT,
                note          TEXT,
                delivery_info TEXT DEFAULT '',
                api_order_id TEXT DEFAULT '',
                api_order_uuid TEXT DEFAULT '',
                api_provider TEXT DEFAULT '',
                api_status TEXT DEFAULT '',
                api_status_message TEXT DEFAULT '',
                api_status_updated_at TEXT DEFAULT '',
                api_last_checked_at TEXT DEFAULT '',
                api_notified_status TEXT DEFAULT '',
                api_monitor_active INTEGER DEFAULT 1,
                api_refunded INTEGER DEFAULT 0,
                purchase_token TEXT DEFAULT '',
                payment_state TEXT DEFAULT 'unpaid',
                request_payload TEXT DEFAULT '{}',
                purchase_flow TEXT DEFAULT '',
                provider_cost REAL DEFAULT 0,
                gross_profit REAL DEFAULT 0,
                cost_known INTEGER DEFAULT 0,
                FOREIGN KEY(user_id)    REFERENCES users(user_id),
                FOREIGN KEY(product_id) REFERENCES products(id)
            )
        ''')
        # جدول سجل الرصيد
        await db.execute('''
            CREATE TABLE IF NOT EXISTS balance_logs (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER,
                amount   REAL,
                type     TEXT,
                reason   TEXT,
                date     TEXT,
                admin_id INTEGER,
                FOREIGN KEY(user_id) REFERENCES users(user_id)
            )
        ''')
        # جدول الإعدادات
        await db.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        # جدول طرق الدفع
        await db.execute('''
            CREATE TABLE IF NOT EXISTS payment_methods (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                name           TEXT NOT NULL,
                details        TEXT NOT NULL,
                is_active      INTEGER DEFAULT 1,
                created_at     TEXT,
                provider       TEXT DEFAULT 'local',
                external_id    TEXT DEFAULT '',
                icon           TEXT DEFAULT '💳',
                currency       TEXT DEFAULT 'USD',
                min_amount     REAL DEFAULT 0,
                max_amount     REAL DEFAULT 0,
                sort_order     INTEGER DEFAULT 1000,
                raw_data       TEXT DEFAULT '{}',
                last_synced    TEXT DEFAULT '',
                is_synced      INTEGER DEFAULT 0,
                is_manually_edited INTEGER DEFAULT 0,
                status_override INTEGER DEFAULT -1,
                remote_is_active INTEGER DEFAULT 1,
                transfer_label TEXT DEFAULT 'بيانات التحويل',
                transfer_value TEXT DEFAULT '',
                credit_rate    REAL DEFAULT 1,
                fixed_fee      REAL DEFAULT 0,
                fee_percent    REAL DEFAULT 0,
                proof_required INTEGER DEFAULT 1,
                proof_mode     TEXT DEFAULT 'either',
                payment_mode   TEXT DEFAULT 'manual',
                auto_provider  TEXT DEFAULT '',
                auto_config    TEXT DEFAULT '{}',
                image_file_id  TEXT DEFAULT '',
                image_unique_id TEXT DEFAULT ''
            )
        ''')
        # جدول طلبات شحن الرصيد
        await db.execute('''
            CREATE TABLE IF NOT EXISTS deposit_requests (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id          INTEGER,
                amount           REAL,
                payment_method   TEXT,
                proof_type       TEXT,
                proof_content    TEXT,
                proof_file_id    TEXT DEFAULT '',
                status           TEXT DEFAULT 'pending',
                created_at       TEXT,
                reviewed_at      TEXT DEFAULT '',
                admin_note       TEXT DEFAULT '',
                payment_method_id INTEGER DEFAULT 0,
                paid_amount      REAL DEFAULT 0,
                credited_amount  REAL DEFAULT 0,
                payment_snapshot TEXT DEFAULT '{}',
                transaction_reference TEXT DEFAULT '',
                expected_amount TEXT DEFAULT '',
                expires_at TEXT DEFAULT '',
                auto_checked_at TEXT DEFAULT '',
                auto_error TEXT DEFAULT '',
                provider_payload TEXT DEFAULT '{}',
                FOREIGN KEY(user_id) REFERENCES users(user_id)
            )
        ''')
        # جدول الكوبونات
        await db.execute('''
            CREATE TABLE IF NOT EXISTS coupons (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                code        TEXT UNIQUE,
                discount    REAL,
                max_uses    INTEGER DEFAULT 1,
                used_count  INTEGER DEFAULT 0,
                is_active   INTEGER DEFAULT 1,
                created_at  TEXT,
                expires_at  TEXT
            )
        ''')
        # جدول استخدام الكوبونات
        await db.execute('''
            CREATE TABLE IF NOT EXISTS coupon_uses (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                coupon_id INTEGER,
                user_id   INTEGER,
                used_at   TEXT,
                FOREIGN KEY(coupon_id) REFERENCES coupons(id),
                FOREIGN KEY(user_id)   REFERENCES users(user_id)
            )
        ''')
        # جدول المفضلة
        await db.execute('''
            CREATE TABLE IF NOT EXISTS favorites (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                product_id INTEGER,
                added_at   TEXT,
                UNIQUE(user_id, product_id),
                FOREIGN KEY(user_id)    REFERENCES users(user_id),
                FOREIGN KEY(product_id) REFERENCES products(id)
            )
        ''')
        # جدول سجل العمليات
        await db.execute('''
            CREATE TABLE IF NOT EXISTS activity_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                action     TEXT,
                details    TEXT,
                created_at TEXT
            )
        ''')
        # جداول المزامنة الذكية: تحفظ التقدم حتى بعد إعادة تشغيل السيرفر
        await db.execute('''
            CREATE TABLE IF NOT EXISTS api_sync_queue (
                api_id        INTEGER PRIMARY KEY,
                name          TEXT NOT NULL,
                parent_api_id INTEGER DEFAULT 0,
                depth         INTEGER DEFAULT 1,
                sort_order    INTEGER DEFAULT 0,
                state         TEXT DEFAULT 'pending',
                attempts      INTEGER DEFAULT 0,
                last_error    TEXT DEFAULT '',
                updated_at    TEXT DEFAULT ''
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS api_sync_seen_categories (
                api_id INTEGER PRIMARY KEY
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS api_sync_seen_products (
                api_id INTEGER PRIMARY KEY
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS api_sync_meta (
                key   TEXT PRIMARY KEY,
                value TEXT DEFAULT ''
            )
        ''')
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_api_sync_queue_state "
            "ON api_sync_queue(state, depth, sort_order)"
        )

        # نظام الدعم الفني والتذاكر
        await db.execute('''
            CREATE TABLE IF NOT EXISTS support_tickets (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id          INTEGER NOT NULL,
                category         TEXT NOT NULL,
                subject          TEXT DEFAULT '',
                order_id         INTEGER DEFAULT 0,
                status           TEXT DEFAULT 'new',
                assigned_admin   INTEGER DEFAULT 0,
                created_at       TEXT NOT NULL,
                updated_at       TEXT NOT NULL,
                last_message_at  TEXT NOT NULL,
                closed_at        TEXT DEFAULT '',
                rating           INTEGER DEFAULT 0,
                FOREIGN KEY(user_id) REFERENCES users(user_id)
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS support_messages (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id    INTEGER NOT NULL,
                sender_id    INTEGER NOT NULL,
                sender_role  TEXT NOT NULL,
                message_type TEXT DEFAULT 'text',
                content      TEXT DEFAULT '',
                file_id      TEXT DEFAULT '',
                created_at   TEXT NOT NULL,
                FOREIGN KEY(ticket_id) REFERENCES support_tickets(id)
            )
        ''')

        # جدول المتغيرات (Variants) - خيارات المنتج المتعددة
        await db.execute('''
            CREATE TABLE IF NOT EXISTS product_variants (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id      INTEGER NOT NULL,
                variant_name    TEXT NOT NULL,
                variant_value   TEXT,
                price           REAL,
                stock           INTEGER DEFAULT 0,
                api_product_id  INTEGER DEFAULT 0,
                api_provider    TEXT DEFAULT '',
                is_active       INTEGER DEFAULT 1,
                created_at      TEXT,
                FOREIGN KEY(product_id) REFERENCES products(id),
                UNIQUE(product_id, variant_name, variant_value)
            )
        ''')

                # إضافة أعمدة دعم المتغيرات للمنتجات
        try:
            await db.execute("ALTER TABLE products ADD COLUMN has_variants INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE products ADD COLUMN variant_type TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE orders ADD COLUMN variant_id INTEGER DEFAULT 0")
        except Exception:
            pass
        
        # إضافة عمود معرف المتجر الفريد للمستخدمين
        try:
            await db.execute("ALTER TABLE users ADD COLUMN store_user_id TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE users ADD COLUMN store_username TEXT DEFAULT ''")
        except Exception:
            pass
        # تعيين store_user_id للمستخدمين الموجودين
        await db.execute("""
            UPDATE users SET store_user_id = 'USR' || printf('%06d', user_id)
            WHERE store_user_id = '' OR store_user_id IS NULL
        """)
        await db.commit()

        # إضافة الأعمدة الجديدة إن لم تكن موجودة
        alter_queries = [
            "ALTER TABLE products ADD COLUMN product_type TEXT DEFAULT 'stock'",
            "ALTER TABLE products ADD COLUMN delivery_info TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN delivery_info TEXT DEFAULT ''",
            "ALTER TABLE categories ADD COLUMN api_provider TEXT DEFAULT ''",
            "ALTER TABLE categories ADD COLUMN api_id INTEGER DEFAULT 0",
            "ALTER TABLE products ADD COLUMN api_id INTEGER DEFAULT 0",
            "ALTER TABLE products ADD COLUMN api_provider TEXT DEFAULT ''",
            "ALTER TABLE products ADD COLUMN api_params TEXT DEFAULT ''",
            "ALTER TABLE products ADD COLUMN last_synced TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_order_id TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_provider TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_order_uuid TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_status TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_status_message TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_status_updated_at TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_last_checked_at TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_notified_status TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN api_monitor_active INTEGER DEFAULT 1",
            "ALTER TABLE orders ADD COLUMN api_refunded INTEGER DEFAULT 0",
            "ALTER TABLE orders ADD COLUMN purchase_token TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN payment_state TEXT DEFAULT 'unpaid'",
            "ALTER TABLE orders ADD COLUMN request_payload TEXT DEFAULT '{}'",
            "ALTER TABLE orders ADD COLUMN purchase_flow TEXT DEFAULT ''",
            "ALTER TABLE orders ADD COLUMN provider_cost REAL DEFAULT 0",
            "ALTER TABLE orders ADD COLUMN gross_profit REAL DEFAULT 0",
            "ALTER TABLE orders ADD COLUMN cost_known INTEGER DEFAULT 0",
            "ALTER TABLE categories ADD COLUMN parent_id INTEGER DEFAULT 0",
            "ALTER TABLE categories ADD COLUMN profit_margin REAL DEFAULT NULL",
            "ALTER TABLE categories ADD COLUMN display_name TEXT DEFAULT ''",
            "ALTER TABLE categories ADD COLUMN local_parent_id INTEGER DEFAULT NULL",
            "ALTER TABLE categories ADD COLUMN local_sort_order INTEGER DEFAULT NULL",
            "ALTER TABLE categories ADD COLUMN is_hidden INTEGER DEFAULT 0",
            "ALTER TABLE categories ADD COLUMN is_virtual INTEGER DEFAULT 0",
            "ALTER TABLE products ADD COLUMN delivery_time TEXT DEFAULT ''",
            "ALTER TABLE products ADD COLUMN buy_button_1 TEXT DEFAULT ''",
            "ALTER TABLE products ADD COLUMN buy_button_2 TEXT DEFAULT ''",
            "ALTER TABLE products ADD COLUMN buy_button_3 TEXT DEFAULT ''",
            "ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0",
            "ALTER TABLE payment_methods ADD COLUMN provider TEXT DEFAULT 'local'",
            "ALTER TABLE payment_methods ADD COLUMN external_id TEXT DEFAULT ''",
            "ALTER TABLE payment_methods ADD COLUMN icon TEXT DEFAULT '💳'",
            "ALTER TABLE payment_methods ADD COLUMN currency TEXT DEFAULT ''",
            "ALTER TABLE payment_methods ADD COLUMN min_amount REAL DEFAULT 0",
            "ALTER TABLE payment_methods ADD COLUMN max_amount REAL DEFAULT 0",
            "ALTER TABLE payment_methods ADD COLUMN sort_order INTEGER DEFAULT 1000",
            "ALTER TABLE payment_methods ADD COLUMN raw_data TEXT DEFAULT '{}'",
            "ALTER TABLE payment_methods ADD COLUMN last_synced TEXT DEFAULT ''",
            "ALTER TABLE payment_methods ADD COLUMN is_synced INTEGER DEFAULT 0",
            "ALTER TABLE payment_methods ADD COLUMN is_manually_edited INTEGER DEFAULT 0",
            "ALTER TABLE payment_methods ADD COLUMN status_override INTEGER DEFAULT -1",
            "ALTER TABLE payment_methods ADD COLUMN remote_is_active INTEGER DEFAULT 1",
            "ALTER TABLE payment_methods ADD COLUMN transfer_label TEXT DEFAULT 'بيانات التحويل'",
            "ALTER TABLE payment_methods ADD COLUMN transfer_value TEXT DEFAULT ''",
            "ALTER TABLE payment_methods ADD COLUMN credit_rate REAL DEFAULT 1",
            "ALTER TABLE payment_methods ADD COLUMN fixed_fee REAL DEFAULT 0",
            "ALTER TABLE payment_methods ADD COLUMN fee_percent REAL DEFAULT 0",
            "ALTER TABLE payment_methods ADD COLUMN proof_required INTEGER DEFAULT 1",
            "ALTER TABLE payment_methods ADD COLUMN proof_mode TEXT DEFAULT 'either'",
            "ALTER TABLE payment_methods ADD COLUMN payment_mode TEXT DEFAULT 'manual'",
            "ALTER TABLE payment_methods ADD COLUMN auto_provider TEXT DEFAULT ''",
            "ALTER TABLE payment_methods ADD COLUMN auto_config TEXT DEFAULT '{}'",
            "ALTER TABLE payment_methods ADD COLUMN image_file_id TEXT DEFAULT ''",
            "ALTER TABLE payment_methods ADD COLUMN image_unique_id TEXT DEFAULT ''",
            "ALTER TABLE deposit_requests ADD COLUMN payment_method_id INTEGER DEFAULT 0",
            "ALTER TABLE deposit_requests ADD COLUMN paid_amount REAL DEFAULT 0",
            "ALTER TABLE deposit_requests ADD COLUMN credited_amount REAL DEFAULT 0",
            "ALTER TABLE deposit_requests ADD COLUMN payment_snapshot TEXT DEFAULT '{}'",
            "ALTER TABLE deposit_requests ADD COLUMN transaction_reference TEXT DEFAULT ''",
            "ALTER TABLE deposit_requests ADD COLUMN expected_amount TEXT DEFAULT ''",
            "ALTER TABLE deposit_requests ADD COLUMN expires_at TEXT DEFAULT ''",
            "ALTER TABLE deposit_requests ADD COLUMN auto_checked_at TEXT DEFAULT ''",
            "ALTER TABLE deposit_requests ADD COLUMN auto_error TEXT DEFAULT ''",
            "ALTER TABLE deposit_requests ADD COLUMN provider_payload TEXT DEFAULT '{}'",
            "ALTER TABLE admins ADD COLUMN can_manage_payments INTEGER DEFAULT 0",
            "ALTER TABLE admins ADD COLUMN can_manage_settings INTEGER DEFAULT 0",
            "ALTER TABLE admins ADD COLUMN can_manage_sync INTEGER DEFAULT 0",
            "ALTER TABLE admins ADD COLUMN role_name TEXT DEFAULT 'custom'",
            "ALTER TABLE admins ADD COLUMN is_active INTEGER DEFAULT 1",
            "ALTER TABLE admins ADD COLUMN note TEXT DEFAULT ''",
            "ALTER TABLE admins ADD COLUMN last_action_at TEXT DEFAULT ''"
        ]
        for query in alter_queries:
            try:
                await db.execute(query)
                await db.commit()
            except Exception:
                pass

        # ترقية المشرفين القدامى مع الحفاظ على صلاحياتهم الحالية.
        try:
            await db.execute(
                "UPDATE admins SET role_name = 'manager', can_manage_payments = 1, can_manage_sync = 1 "
                "WHERE (role_name IS NULL OR role_name = '' OR role_name = 'custom') "
                "AND (can_manage_products + can_manage_users + can_manage_balance + "
                "can_send_broadcast + can_manage_orders + can_manage_categories + "
                "can_view_stats + can_manage_tickets) >= 6"
            )
            await db.commit()
        except Exception:
            pass

        # فهارس تمنع تكرار طرق الدفع القادمة من الموقع وتحسن ترتيبها
        try:
            await db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_provider_external "
                "ON payment_methods(provider, external_id) "
                "WHERE external_id <> ''"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_active_sort "
                "ON payment_methods(is_active, sort_order, name)"
            )
            await db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_transaction_reference "
                "ON deposit_requests(transaction_reference) "
                "WHERE transaction_reference <> ''"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_deposit_auto_pending "
                "ON deposit_requests(status, payment_method_id, expires_at)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_deposit_expected_amount "
                "ON deposit_requests(expected_amount, status)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_orders_api_monitor "
                "ON orders(api_provider, api_monitor_active, status, api_order_id, api_order_uuid)"
            )
            await db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_api_uuid_unique "
                "ON orders(api_provider, api_order_uuid) "
                "WHERE api_order_uuid <> ''"
            )
            await db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_purchase_token_unique "
                "ON orders(purchase_token) WHERE purchase_token <> ''"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_orders_user_date "
                "ON orders(user_id, order_date DESC)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_categories_parent "
                "ON categories(parent_id, is_active, sort_order)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_categories_local_parent "
                "ON categories(local_parent_id, is_hidden, local_sort_order)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_categories_virtual "
                "ON categories(is_virtual, api_provider)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_support_tickets_status_date "
                "ON support_tickets(status, last_message_at DESC)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_support_tickets_user_date "
                "ON support_tickets(user_id, last_message_at DESC)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_date "
                "ON support_messages(ticket_id, created_at ASC)"
            )
            await db.commit()
        except Exception as exc:
            logger.warning("تعذر إنشاء فهارس طرق الدفع: %s", exc)

        # الإعدادات الافتراضية
        defaults = [
            ('bot_status',       'active'),
            ('welcome_message',  'مرحباً بك في متجرنا! 🛍\nاستخدم القائمة أدناه للتصفح والشراء.'),
            ('support_message',  'مرحباً بك في مركز دعم UCHIHA STORE. للمشكلات المرتبطة بطلب أو رصيد استخدم التذاكر حتى تبقى التفاصيل محفوظة.'),
            ('currency',         '$'),
            ('min_balance_add',  '1'),
            ('max_balance_add',  '10000'),
            ('profit_margin',    '0'),
            ('support_ticket_enabled', '1'),
            ('support_whatsapp_enabled', '0'),
            ('support_whatsapp_number', ''),
            ('support_telegram_enabled', '0'),
            ('support_telegram_username', ''),
            ('support_open_ticket_limit', '3'),
            ('provider_balance_cache', ''),
            ('provider_balance_updated_at', ''),
            ('provider_low_balance_threshold', '20'),
        ]
        for key, value in defaults:
            await db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))

        # إضافة المدير الأساسي
        if ADMIN_ID:
            now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            await db.execute('''
                INSERT OR IGNORE INTO admins
                (admin_id, added_by, added_at,
                 can_manage_products, can_manage_users, can_manage_balance,
                 can_send_broadcast, can_manage_orders, can_manage_categories,
                 can_manage_coupons, can_view_stats, can_manage_tickets,
                 can_manage_payments, can_manage_settings, can_manage_sync,
                 role_name, is_active)
                VALUES (?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'owner', 1)
            ''', (ADMIN_ID, ADMIN_ID, now))

        await db.commit()
    logger.info("تم تهيئة قاعدة البيانات بنجاح.")


# =============================================================================
# دوال المساعدة (Helper Functions)
# =============================================================================

CATEGORY_ADMIN_PAGE_SIZE = 10
CATEGORY_MOVE_PAGE_SIZE = 12
RASHQ_GROUP_DEFINITIONS = [
    ("instagram", "📱 إنستغرام", ("instagram", "insta", "انستا", "انستغرام", "انستقرام")),
    ("tiktok", "🎵 تيك توك", ("tiktok", "tik tok", "تيك توك", "تيكتوك")),
    ("youtube", "▶️ يوتيوب", ("youtube", "يوتيوب")),
    ("telegram", "✈️ تيليجرام", ("telegram", "تلغرام", "تيليجرام", "تليجرام")),
    ("facebook", "👥 فيسبوك", ("facebook", "فيسبوك", "فيس بوك", " fb ")),
    ("twitter", "𝕏 تويتر / X", ("twitter", "تويتر", "اكس", " x ")),
    ("snapchat", "👻 سناب شات", ("snapchat", "snap", "سناب")),
    ("other", "🌐 منصات أخرى", ()),
]


def _is_rashq_category_name(name: str) -> bool:
    normalized = (name or "").strip().lower()
    return any(token in normalized for token in ("رشق", "social", "smm", "متابع", "followers"))


def _admin_category_status(active: int, hidden: int) -> str:
    if hidden:
        return "🙈"
    return "✅" if active else "❌"


async def _category_effective_parent(db: aiosqlite.Connection, category_id: int) -> int:
    async with db.execute(
        "SELECT COALESCE(local_parent_id, parent_id, 0) FROM categories WHERE id = ?",
        (category_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return int(row[0] or 0) if row else 0


async def _category_effective_name(db: aiosqlite.Connection, category_id: int) -> str:
    async with db.execute(
        "SELECT COALESCE(NULLIF(display_name, ''), name) FROM categories WHERE id = ?",
        (category_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return str(row[0]) if row else "قسم غير معروف"


async def _category_path(db: aiosqlite.Connection, category_id: int, max_depth: int = 12) -> str:
    names: list[str] = []
    seen: set[int] = set()
    current = int(category_id or 0)
    while current > 0 and current not in seen and len(names) < max_depth:
        seen.add(current)
        async with db.execute(
            """
            SELECT COALESCE(NULLIF(display_name, ''), name),
                   COALESCE(local_parent_id, parent_id, 0)
            FROM categories WHERE id = ?
            """,
            (current,),
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            break
        names.append(str(row[0]))
        current = int(row[1] or 0)
    return " ← ".join(reversed(names))


async def _category_descendant_ids(db: aiosqlite.Connection, category_id: int) -> set[int]:
    """إرجاع جميع الفروع وفق الترتيب المحلي الفعلي لمنع إنشاء دورة عند النقل."""
    result: set[int] = set()
    frontier = [int(category_id)]
    while frontier:
        parent = frontier.pop()
        async with db.execute(
            """
            SELECT id FROM categories
            WHERE COALESCE(local_parent_id, parent_id, 0) = ?
            """,
            (parent,),
        ) as cursor:
            rows = await cursor.fetchall()
        for row in rows:
            child_id = int(row[0])
            if child_id not in result and child_id != category_id:
                result.add(child_id)
                frontier.append(child_id)
    return result


async def _create_local_group(
    db: aiosqlite.Connection,
    parent_id: int,
    display_name: str,
    sort_order: int = 0,
    slug: str | None = None,
) -> int:
    clean_name = display_name.strip()
    slug_value = re.sub(r"[^a-zA-Z0-9]+", "_", slug or clean_name).strip("_").lower() or "group"
    internal_name = f"__local_group_{int(parent_id)}_{slug_value}"
    async with db.execute("SELECT id FROM categories WHERE name = ?", (internal_name,)) as cursor:
        row = await cursor.fetchone()
    if row:
        group_id = int(row[0])
        await db.execute(
            """
            UPDATE categories
            SET display_name = ?, parent_id = ?, local_parent_id = NULL,
                local_sort_order = ?, is_active = 1, is_hidden = 0,
                is_virtual = 1, api_provider = 'local_group'
            WHERE id = ?
            """,
            (clean_name, int(parent_id), int(sort_order), group_id),
        )
        return group_id
    cursor = await db.execute(
        """
        INSERT INTO categories
        (name, display_name, is_active, sort_order, parent_id, local_parent_id,
         local_sort_order, is_hidden, is_virtual, api_provider, api_id)
        VALUES (?, ?, 1, ?, ?, NULL, ?, 0, 1, 'local_group', 0)
        """,
        (internal_name, clean_name, int(sort_order), int(parent_id), int(sort_order)),
    )
    return int(cursor.lastrowid)


async def _setup_rashq_groups(parent_id: int) -> dict[str, int]:
    """إنشاء مجموعات الرشق وترتيب الأقسام المباشرة حسب اسمها مع حفظ الترتيب محلياً."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("BEGIN IMMEDIATE")
        groups: dict[str, int] = {}
        for index, (key, label, _keywords) in enumerate(RASHQ_GROUP_DEFINITIONS, start=1):
            groups[key] = await _create_local_group(db, parent_id, label, index * 10, key)

        async with db.execute(
            """
            SELECT id, LOWER(COALESCE(NULLIF(display_name, ''), name)), is_virtual
            FROM categories
            WHERE COALESCE(local_parent_id, parent_id, 0) = ?
              AND id NOT IN (%s)
            ORDER BY COALESCE(local_sort_order, sort_order, 0), name
            """ % ",".join("?" for _ in groups.values()),
            (int(parent_id), *groups.values()),
        ) as cursor:
            rows = await cursor.fetchall()

        moved_counts = {key: 0 for key in groups}
        for category_id, lowered_name, is_virtual in rows:
            if int(is_virtual or 0):
                continue
            target_key = "other"
            padded = f" {str(lowered_name or '')} "
            for key, _label, keywords in RASHQ_GROUP_DEFINITIONS:
                if key == "other":
                    continue
                if any(keyword in padded for keyword in keywords):
                    target_key = key
                    break
            await db.execute(
                "UPDATE categories SET local_parent_id = ? WHERE id = ?",
                (groups[target_key], int(category_id)),
            )
            moved_counts[target_key] += 1
        await db.commit()
    return moved_counts


async def get_setting(key: str, default: str = '') -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM settings WHERE key = ?", (key,)) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else default

async def set_setting(key: str, value: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
        await db.commit()


def _normalize_profit_margin(value, default: float = 0.0) -> float:
    """تحويل نسبة الربح إلى رقم آمن ضمن الحدود المسموحة."""
    try:
        margin = float(value)
    except (TypeError, ValueError):
        margin = float(default)
    return max(0.0, min(1000.0, margin))


async def get_default_profit_margin() -> float:
    return _normalize_profit_margin(await get_setting('profit_margin', '0'))


async def _load_category_profit_maps(db, default_margin: float):
    """
    إنشاء خريطتين سريعتين:
    - النسبة الفعلية لكل قسم، مع توريث نسبة القسم الرئيسي إلى كل الفروع.
    - القسم الرئيسي الذي ينتمي إليه كل قسم.
    """
    async with db.execute(
        "SELECT id, COALESCE(parent_id, 0), profit_margin FROM categories"
    ) as cursor:
        rows = await cursor.fetchall()

    parents = {int(row[0]): int(row[1] or 0) for row in rows}
    direct_margins = {
        int(row[0]): (None if row[2] is None else _normalize_profit_margin(row[2], default_margin))
        for row in rows
    }
    effective = {}
    roots = {}

    for category_id in parents:
        current = category_id
        visited = set()
        root_id = category_id
        selected_margin = None

        while current and current not in visited:
            visited.add(current)
            root_id = current
            if selected_margin is None and direct_margins.get(current) is not None:
                selected_margin = direct_margins[current]
            parent_id = parents.get(current, 0)
            if not parent_id or parent_id not in parents:
                break
            current = parent_id

        roots[category_id] = root_id
        effective[category_id] = default_margin if selected_margin is None else selected_margin

    return effective, roots


async def get_effective_profit_margin(category_id: int) -> float:
    default_margin = await get_default_profit_margin()
    async with aiosqlite.connect(DB_PATH) as db:
        effective, _ = await _load_category_profit_maps(db, default_margin)
    return effective.get(int(category_id or 0), default_margin)


async def apply_profit_margins_to_products(root_category_id: int | None = None) -> tuple[int, int]:
    """تطبيق نسب الأقسام على المنتجات الحالية دون مضاعفة الربح القديم."""
    default_margin = await get_default_profit_margin()
    updated = 0
    skipped = 0

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('PRAGMA busy_timeout = 15000')
        effective, roots = await _load_category_profit_maps(db, default_margin)
        async with db.execute(
            "SELECT id, category_id, api_params FROM products WHERE api_provider = 'js4card'"
        ) as cursor:
            products = await cursor.fetchall()

        update_rows = []
        for product_id, category_id, api_params_raw in products:
            category_id = int(category_id or 0)
            if root_category_id is not None and roots.get(category_id) != int(root_category_id):
                continue
            try:
                api_params = json.loads(api_params_raw or '{}')
                base_price = float(api_params.get('base_price'))
            except (TypeError, ValueError, json.JSONDecodeError):
                skipped += 1
                continue
            margin = effective.get(category_id, default_margin)
            new_price = round(base_price * (1 + margin / 100), 2)
            update_rows.append((new_price, product_id))

        if update_rows:
            await db.executemany("UPDATE products SET price = ? WHERE id = ?", update_rows)
            await db.commit()
            updated = len(update_rows)

    return updated, skipped

async def get_user(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)) as cursor:
            return await cursor.fetchone()

async def create_or_update_user(user_id: int, username, full_name: str):
    async with aiosqlite.connect(DB_PATH) as db:
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        store_id = f'USR{user_id:06d}'
        existing = await db.execute("SELECT user_id FROM users WHERE user_id = ?", (user_id,))
        row = await existing.fetchone()
        if row:
            await db.execute(
                "UPDATE users SET username = ?, full_name = ?, store_user_id = COALESCE(NULLIF(store_user_id,''), ?) WHERE user_id = ?",
                (username, full_name, store_id, user_id)
            )
        else:
            await db.execute(
                "INSERT INTO users (user_id, username, full_name, joined_date, store_user_id) VALUES (?, ?, ?, ?, ?)",
                (user_id, username, full_name, now, store_id)
            )
        await db.commit()

async def is_admin(user_id: int) -> bool:
    if user_id == ADMIN_ID:
        return True
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM admins WHERE admin_id = ? AND COALESCE(is_active, 1) = 1",
            (user_id,),
        ) as cursor:
            return await cursor.fetchone() is not None

async def is_super_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID

async def get_admin_perms(user_id: int) -> dict:
    if user_id == ADMIN_ID:
        return {
            'admin_id': user_id,
            'is_active': True,
            'role_name': 'owner',
            'can_manage_products': True,
            'can_manage_users': True,
            'can_manage_balance': True,
            'can_send_broadcast': True,
            'can_manage_orders': True,
            'can_manage_categories': True,
            'can_manage_coupons': True,
            'can_view_stats': True,
            'can_manage_tickets': True,
            'can_manage_payments': True,
            'can_manage_settings': True,
            'can_manage_sync': True,
        }
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT * FROM admins WHERE admin_id = ?", (user_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                return {}
            cols = [d[0] for d in cursor.description]
            result = dict(zip(cols, row))
            if not bool(result.get('is_active', 1)):
                return {}
            return result


ADMIN_PERMISSION_LABELS = {
    'can_manage_products': 'المنتجات',
    'can_manage_users': 'المستخدمون',
    'can_manage_balance': 'الرصيد اليدوي',
    'can_send_broadcast': 'الإذاعة',
    'can_manage_orders': 'الطلبات',
    'can_manage_categories': 'الأقسام',
    'can_view_stats': 'الإحصائيات',
    'can_manage_tickets': 'الدعم والتذاكر',
    'can_manage_payments': 'طرق الدفع وطلبات الشحن',
    'can_manage_settings': 'الإعدادات العامة',
    'can_manage_sync': 'المزامنة',
}

ADMIN_ROLE_PRESETS = {
    'manager': {
        'label': 'مدير تشغيل',
        'permissions': {
            'can_manage_products': 1, 'can_manage_users': 1,
            'can_manage_balance': 1, 'can_send_broadcast': 1,
            'can_manage_orders': 1, 'can_manage_categories': 1,
            'can_view_stats': 1, 'can_manage_tickets': 1,
            'can_manage_payments': 1, 'can_manage_settings': 0,
            'can_manage_sync': 1, 'can_manage_coupons': 0,
        },
    },
    'catalog': {
        'label': 'مسؤول المنتجات والأقسام',
        'permissions': {
            'can_manage_products': 1, 'can_manage_users': 0,
            'can_manage_balance': 0, 'can_send_broadcast': 0,
            'can_manage_orders': 0, 'can_manage_categories': 1,
            'can_view_stats': 0, 'can_manage_tickets': 0,
            'can_manage_payments': 0, 'can_manage_settings': 0,
            'can_manage_sync': 1, 'can_manage_coupons': 0,
        },
    },
    'orders': {
        'label': 'مسؤول الطلبات',
        'permissions': {
            'can_manage_products': 0, 'can_manage_users': 1,
            'can_manage_balance': 0, 'can_send_broadcast': 0,
            'can_manage_orders': 1, 'can_manage_categories': 0,
            'can_view_stats': 0, 'can_manage_tickets': 0,
            'can_manage_payments': 0, 'can_manage_settings': 0,
            'can_manage_sync': 0, 'can_manage_coupons': 0,
        },
    },
    'finance': {
        'label': 'مسؤول المالية والدفع',
        'permissions': {
            'can_manage_products': 0, 'can_manage_users': 1,
            'can_manage_balance': 1, 'can_send_broadcast': 0,
            'can_manage_orders': 1, 'can_manage_categories': 0,
            'can_view_stats': 1, 'can_manage_tickets': 0,
            'can_manage_payments': 1, 'can_manage_settings': 0,
            'can_manage_sync': 0, 'can_manage_coupons': 0,
        },
    },
    'support': {
        'label': 'موظف دعم',
        'permissions': {
            'can_manage_products': 0, 'can_manage_users': 1,
            'can_manage_balance': 0, 'can_send_broadcast': 0,
            'can_manage_orders': 1, 'can_manage_categories': 0,
            'can_view_stats': 0, 'can_manage_tickets': 1,
            'can_manage_payments': 0, 'can_manage_settings': 0,
            'can_manage_sync': 0, 'can_manage_coupons': 0,
        },
    },
    'marketing': {
        'label': 'مسؤول الإعلانات',
        'permissions': {
            'can_manage_products': 0, 'can_manage_users': 0,
            'can_manage_balance': 0, 'can_send_broadcast': 1,
            'can_manage_orders': 0, 'can_manage_categories': 0,
            'can_view_stats': 0, 'can_manage_tickets': 0,
            'can_manage_payments': 0, 'can_manage_settings': 0,
            'can_manage_sync': 0, 'can_manage_coupons': 0,
        },
    },
    'analyst': {
        'label': 'مشاهد الإحصائيات',
        'permissions': {
            'can_manage_products': 0, 'can_manage_users': 0,
            'can_manage_balance': 0, 'can_send_broadcast': 0,
            'can_manage_orders': 0, 'can_manage_categories': 0,
            'can_view_stats': 1, 'can_manage_tickets': 0,
            'can_manage_payments': 0, 'can_manage_settings': 0,
            'can_manage_sync': 0, 'can_manage_coupons': 0,
        },
    },
    'custom': {
        'label': 'صلاحيات مخصصة',
        'permissions': {
            key: 0 for key in [
                'can_manage_products', 'can_manage_users', 'can_manage_balance',
                'can_send_broadcast', 'can_manage_orders', 'can_manage_categories',
                'can_view_stats', 'can_manage_tickets', 'can_manage_payments',
                'can_manage_settings', 'can_manage_sync', 'can_manage_coupons',
            ]
        },
    },
}


def admin_role_label(role_code: str) -> str:
    if role_code == 'owner':
        return 'المالك الرئيسي'
    return ADMIN_ROLE_PRESETS.get(role_code or 'custom', ADMIN_ROLE_PRESETS['custom'])['label']


ADMIN_CALLBACK_PERMISSION_RULES = [
    (('admin_admins', 'admin_admin_', 'admin_add_admin', 'admin_apply_role_',
      'admin_role_menu_', 'admin_toggle_admin_', 'admin_remove_admin_',
      'admin_perm_', 'admin_set_admin_note_'), '__super__'),
    (('admin_profit_margin', 'admin_profit_', 'admin_category_margin_'), '__super__'),
    (('admin_stats', 'admin_stats_'), 'can_view_stats'),
    (('admin_users', 'admin_user_', 'admin_ban_', 'admin_unban_', 'admin_msg_user_'), 'can_manage_users'),
    (('admin_categories', 'admin_cat_', 'admin_add_category'), 'can_manage_categories'),
    (('admin_products', 'admin_prod_', 'admin_add_product', 'admin_manage_api_products'), 'can_manage_products'),
    (('admin_orders', 'admin_order_', 'admin_set_order_status_'), 'can_manage_orders'),
    (('admin_balance', 'admin_add_bal_', 'admin_deduct_bal_'), 'can_manage_balance'),
    (('admin_deposit', 'admin_dep_', 'admin_payment_methods', 'admin_pm_', 'admin_add_payment_method'), 'can_manage_payments'),
    (('admin_broadcast',), 'can_send_broadcast'),
    (('admin_support',), 'can_manage_tickets'),
    (('admin_settings', 'admin_set_', 'admin_toggle_bot_status', 'admin_support_contacts'), 'can_manage_settings'),
    (('admin_api_',), 'can_manage_sync'),
    (('admin_activity_log',), 'can_view_stats'),
]


def _required_permission_for_callback(callback_data: str):
    for prefixes, permission in ADMIN_CALLBACK_PERMISSION_RULES:
        if any(callback_data.startswith(prefix) for prefix in prefixes):
            return permission
    return None


class AdminPermissionMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        user = getattr(event, 'from_user', None)
        if user is None:
            return await handler(event, data)

        if isinstance(event, CallbackQuery):
            callback_data = event.data or ''
            if callback_data.startswith('admin_'):
                if not await is_admin(user.id):
                    await event.answer('⛔ حساب المشرف غير مفعل أو غير مصرح.', show_alert=True)
                    return
                required = _required_permission_for_callback(callback_data)
                if required == '__super__' and not await is_super_admin(user.id):
                    await event.answer('⛔ هذا القسم للمالك الرئيسي فقط.', show_alert=True)
                    return
                if required and required != '__super__':
                    perms = await get_admin_perms(user.id)
                    if not perms.get(required, False):
                        await event.answer(
                            f"⛔ لا تملك صلاحية: {ADMIN_PERMISSION_LABELS.get(required, 'هذا القسم')}",
                            show_alert=True,
                        )
                        return
        elif isinstance(event, Message):
            state = data.get('state')
            if state is not None:
                current_state = await state.get_state()
                if current_state and current_state.split(':', 1)[0].startswith('Admin'):
                    if not await is_admin(user.id):
                        await state.clear()
                        await event.answer('⛔ تم إيقاف صلاحية حساب المشرف.')
                        return
        result = await handler(event, data)
        if isinstance(event, CallbackQuery) and (event.data or '').startswith('admin_') and user.id != ADMIN_ID:
            try:
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute(
                        "UPDATE admins SET last_action_at = ? WHERE admin_id = ?",
                        (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user.id),
                    )
                    await db.commit()
            except Exception:
                pass
        return result


dp.callback_query.outer_middleware(AdminPermissionMiddleware())
dp.message.outer_middleware(AdminPermissionMiddleware())

async def is_banned(user_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT is_banned FROM users WHERE user_id = ?", (user_id,)) as cursor:
            row = await cursor.fetchone()
            return bool(row and row[0])

async def get_user_balance(user_id: int) -> float:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT balance FROM users WHERE user_id = ?", (user_id,)) as cursor:
            row = await cursor.fetchone()
            return float(row[0]) if row else 0.0

async def add_balance(user_id: int, amount: float, reason: str, admin_id: int = 0):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            "INSERT INTO balance_logs (user_id, amount, type, reason, date, admin_id) VALUES (?, ?, 'add', ?, ?, ?)",
            (user_id, amount, reason, now, admin_id)
        )
        await db.commit()

async def deduct_balance(user_id: int, amount: float, reason: str, admin_id: int = 0) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT balance FROM users WHERE user_id = ?", (user_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row[0] < amount:
                return False
        await db.execute("UPDATE users SET balance = balance - ? WHERE user_id = ?", (amount, user_id))
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            "INSERT INTO balance_logs (user_id, amount, type, reason, date, admin_id) VALUES (?, ?, 'deduct', ?, ?, ?)",
            (user_id, amount, reason, now, admin_id)
        )
        await db.commit()
        return True


def _purchase_now() -> str:
    return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    except Exception:
        return '{}'


async def get_order_by_purchase_token(purchase_token: str) -> dict[str, Any] | None:
    if not purchase_token:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, user_id, product_id, quantity, total_price, status, "
            "COALESCE(payment_state, 'unpaid') AS payment_state, "
            "COALESCE(api_status, '') AS api_status "
            "FROM orders WHERE purchase_token = ?",
            (purchase_token,),
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def create_local_order_atomic(
    *,
    user_id: int,
    product_id: int,
    purchase_token: str,
    expected_price: float,
    quantity: int = 1,
    variant_id: int = 0,
    delivery_info: str = '',
    custom_option: str = '',
) -> dict[str, Any]:
    """خصم الرصيد وحجز المخزون وإنشاء الطلب داخل معاملة واحدة."""
    quantity = max(1, int(quantity or 1))
    expected_price = round(float(expected_price or 0), 2)
    now = _purchase_now()

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute('PRAGMA busy_timeout = 10000')
        try:
            await db.execute('BEGIN IMMEDIATE')

            async with db.execute(
                "SELECT id, total_price, status, COALESCE(payment_state, 'unpaid') AS payment_state "
                "FROM orders WHERE purchase_token = ?",
                (purchase_token,),
            ) as cursor:
                existing = await cursor.fetchone()
            if existing:
                await db.rollback()
                return {'status': 'duplicate', 'order': dict(existing)}

            async with db.execute(
                "SELECT id, name, price, stock, product_type, delivery_info, is_active, "
                "COALESCE(api_id, 0) AS api_id, COALESCE(api_provider, '') AS api_provider "
                "FROM products WHERE id = ?",
                (product_id,),
            ) as cursor:
                product = await cursor.fetchone()
            if not product or int(product['is_active'] or 0) != 1:
                await db.rollback()
                return {'status': 'unavailable'}
            if int(product['api_id'] or 0) > 0 and product['api_provider'] == 'js4card':
                await db.rollback()
                return {'status': 'api_product'}

            variant = None
            current_price = round(float(product['price'] or 0), 2)
            if variant_id:
                async with db.execute(
                    "SELECT id, product_id, variant_name, price, stock, is_active "
                    "FROM product_variants WHERE id = ? AND product_id = ?",
                    (variant_id, product_id),
                ) as cursor:
                    variant = await cursor.fetchone()
                if not variant or int(variant['is_active'] or 0) != 1:
                    await db.rollback()
                    return {'status': 'unavailable'}
                current_price = round(float(variant['price'] or 0), 2)

            if abs(current_price - expected_price) > 0.0001:
                await db.rollback()
                return {'status': 'price_changed', 'current_price': current_price}

            total_price = round(current_price * quantity, 2)
            if total_price <= 0:
                await db.rollback()
                return {'status': 'invalid_price'}

            if variant:
                changed_stock = await db.execute(
                    "UPDATE product_variants SET stock = stock - ? "
                    "WHERE id = ? AND is_active = 1 AND stock >= ?",
                    (quantity, variant_id, quantity),
                )
            else:
                changed_stock = await db.execute(
                    "UPDATE products SET stock = stock - ? "
                    "WHERE id = ? AND is_active = 1 AND stock >= ?",
                    (quantity, product_id, quantity),
                )
            if changed_stock.rowcount != 1:
                await db.rollback()
                return {'status': 'out_of_stock'}

            changed_balance = await db.execute(
                "UPDATE users SET balance = balance - ? "
                "WHERE user_id = ? AND balance >= ?",
                (total_price, user_id, total_price),
            )
            if changed_balance.rowcount != 1:
                await db.rollback()
                return {'status': 'insufficient_balance', 'total_price': total_price}

            note_parts = []
            if custom_option:
                note_parts.append(f'الخيار: {custom_option}')
            if variant:
                note_parts.append(f"المتغير: {variant['variant_name']}")
            note = ' | '.join(note_parts)
            request_payload = {
                'product_id': product_id,
                'variant_id': variant_id,
                'quantity': quantity,
                'delivery_info': delivery_info,
                'custom_option': custom_option,
            }
            cursor = await db.execute(
                "INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, status, "
                "order_date, note, delivery_info, purchase_token, payment_state, request_payload, purchase_flow) "
                "VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 'charged', ?, 'local')",
                (
                    user_id, product_id, variant_id, quantity, total_price, now, note,
                    delivery_info, purchase_token, _safe_json(request_payload),
                ),
            )
            order_id = int(cursor.lastrowid)
            await db.execute(
                "INSERT INTO balance_logs (user_id, amount, type, reason, date, admin_id) "
                "VALUES (?, ?, 'deduct', ?, ?, 0)",
                (user_id, total_price, f"شراء طلب #{order_id}: {product['name']}", now),
            )
            await db.commit()
            return {
                'status': 'created', 'order_id': order_id, 'total_price': total_price,
                'product_name': str(product['name']), 'product_type': str(product['product_type'] or 'stock'),
                'delivery_hint': str(product['delivery_info'] or ''),
                'variant_name': str(variant['variant_name']) if variant else '',
            }
        except Exception:
            await db.rollback()
            raise


async def reserve_api_order_atomic(
    *,
    user_id: int,
    local_product_id: int,
    api_product_id: int,
    quantity: int,
    expected_unit_price: float,
    purchase_token: str,
    api_request_uuid: str,
    delivery_info: str,
    request_payload: dict[str, Any],
    variant_id: int = 0,
) -> dict[str, Any]:
    """حجز مبلغ طلب الموقع وإنشاء سجله مرة واحدة فقط."""
    quantity = max(1, int(quantity or 1))
    expected_unit_price = round(float(expected_unit_price or 0), 2)
    now = _purchase_now()

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute('PRAGMA busy_timeout = 10000')
        try:
            await db.execute('BEGIN IMMEDIATE')

            async with db.execute(
                "SELECT id, total_price, status, COALESCE(payment_state, 'unpaid') AS payment_state, "
                "COALESCE(api_status, '') AS api_status FROM orders WHERE purchase_token = ?",
                (purchase_token,),
            ) as cursor:
                existing = await cursor.fetchone()
            if existing:
                await db.rollback()
                return {'status': 'duplicate', 'order': dict(existing)}

            async with db.execute(
                "SELECT id, name, price, stock, is_active, api_id, api_provider "
                "FROM products WHERE id = ?",
                (local_product_id,),
            ) as cursor:
                product = await cursor.fetchone()
            if not product or int(product['is_active'] or 0) != 1 or int(product['stock'] or 0) <= 0:
                await db.rollback()
                return {'status': 'unavailable'}

            current_price = expected_unit_price
            if not variant_id:
                if int(product['api_id'] or 0) != api_product_id or str(product['api_provider'] or '') != 'js4card':
                    await db.rollback()
                    return {'status': 'unavailable'}
                current_price = round(float(product['price'] or 0), 2)
            else:
                async with db.execute(
                    "SELECT price, stock, is_active, api_product_id, api_provider "
                    "FROM product_variants WHERE id = ? AND product_id = ?",
                    (variant_id, local_product_id),
                ) as cursor:
                    variant = await cursor.fetchone()
                if (
                    not variant or int(variant['is_active'] or 0) != 1
                    or int(variant['stock'] or 0) <= 0
                    or int(variant['api_product_id'] or 0) != api_product_id
                    or str(variant['api_provider'] or '') != 'js4card'
                ):
                    await db.rollback()
                    return {'status': 'unavailable'}
                current_price = round(float(variant['price'] or 0), 2)

            if abs(current_price - expected_unit_price) > 0.0001:
                await db.rollback()
                return {'status': 'price_changed', 'current_price': current_price}

            total_price = round(current_price * quantity, 2)
            if total_price <= 0:
                await db.rollback()
                return {'status': 'invalid_price'}

            changed_balance = await db.execute(
                "UPDATE users SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
                (total_price, user_id, total_price),
            )
            if changed_balance.rowcount != 1:
                await db.rollback()
                return {'status': 'insufficient_balance', 'total_price': total_price}

            try:
                base_unit_cost = float(request_payload.get('base_price', 0) or 0)
            except (TypeError, ValueError):
                base_unit_cost = 0.0
            provider_cost = round(base_unit_cost * quantity, 2) if base_unit_cost > 0 else 0.0
            gross_profit = round(total_price - provider_cost, 2) if provider_cost > 0 else 0.0
            cost_known = 1 if provider_cost > 0 else 0

            cursor = await db.execute(
                "INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, status, "
                "order_date, delivery_info, api_provider, api_order_uuid, api_status, "
                "api_status_updated_at, api_monitor_active, purchase_token, payment_state, "
                "request_payload, purchase_flow, provider_cost, gross_profit, cost_known) "
                "VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, 'js4card', ?, 'queued', ?, 1, ?, "
                "'charged', ?, 'api', ?, ?, ?)",
                (
                    user_id, local_product_id, variant_id, quantity, total_price, now,
                    delivery_info, api_request_uuid, now, purchase_token, _safe_json(request_payload),
                    provider_cost, gross_profit, cost_known,
                ),
            )
            order_id = int(cursor.lastrowid)
            await db.execute(
                "INSERT INTO balance_logs (user_id, amount, type, reason, date, admin_id) "
                "VALUES (?, ?, 'deduct', ?, ?, 0)",
                (user_id, total_price, f"شراء طلب API #{order_id}: {product['name']}", now),
            )
            await db.commit()
            return {
                'status': 'created', 'order_id': order_id, 'total_price': total_price,
                'product_name': str(product['name']),
            }
        except Exception:
            await db.rollback()
            raise


async def log_activity(user_id: int, action: str, details: str = ''):
    async with aiosqlite.connect(DB_PATH) as db:
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            "INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?, ?, ?, ?)",
            (user_id, action, details, now)
        )
        await db.execute(
            "UPDATE admins SET last_action_at = ? WHERE admin_id = ?",
            (now, user_id),
        )
        await db.commit()

async def get_all_user_ids() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id FROM users WHERE is_banned = 0") as cursor:
            rows = await cursor.fetchall()
            return [r[0] for r in rows]

async def safe_edit_message(message: Message, text: str, reply_markup=None, parse_mode: str = "Markdown"):
    try:
        await message.edit_text(text, reply_markup=reply_markup, parse_mode=parse_mode)
    except TelegramBadRequest as e:
        if "message is not modified" in str(e):
            return
        logger.error(f"خطأ في تعديل الرسالة: {e}")
        try:
            # إذا فشل التعديل لسبب آخر، نرسل رسالة جديدة ونحذف القديمة إن أمكن
            await message.answer(text, reply_markup=reply_markup, parse_mode=parse_mode)
            await message.delete()
        except Exception:
            pass
    except Exception as e:
        logger.error(f"خطأ غير متوقع في safe_edit_message: {e}")

async def safe_send_message(user_id: int, text: str, reply_markup=None, parse_mode: str = "Markdown") -> bool:
    try:
        await bot.send_message(user_id, text, reply_markup=reply_markup, parse_mode=parse_mode)
        return True
    except (TelegramForbiddenError, TelegramBadRequest, TelegramNetworkError) as e:
        logger.warning(f"فشل إرسال رسالة للمستخدم {user_id}: {e}")
        return False
    except Exception as e:
        logger.error(f"خطأ غير متوقع أثناء إرسال رسالة للمستخدم {user_id}: {e}")
        return False


# =============================================================================
# متابعة حالات طلبات JS4Card تلقائياً
# =============================================================================

def _status_text(value: Any) -> str:
    """تحويل حالة الموقع إلى نص آمن وقصير."""
    if value is None:
        return ''
    if isinstance(value, (dict, list, tuple)):
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value).strip()


def classify_api_order_status(raw_status: Any) -> dict[str, Any]:
    """
    توحيد حالات الموقع مع إبقاء النص الأصلي محفوظاً.
    يعيد الحالة المحلية، المفتاح الموحد، النص العربي، وهل هي نهائية أو فاشلة.
    """
    raw = _status_text(raw_status)
    token = re.sub(r'[\s_\-]+', ' ', raw.casefold()).strip()

    failed_words = (
        'cancelled', 'canceled', 'cancel', 'rejected', 'reject', 'failed', 'failure',
        'error', 'refunded', 'refund', 'declined', 'invalid', 'expired',
        'ملغي', 'ملغى', 'مرفوض', 'فشل', 'فاشل', 'مرتجع', 'مسترد', 'منتهي'
    )
    completed_words = (
        'completed', 'complete', 'done', 'delivered', 'finished', 'successful',
        'successfully', 'fulfilled', 'مكتمل', 'تم التنفيذ', 'تم التسليم', 'ناجح'
    )
    processing_words = (
        'processing', 'in progress', 'running', 'executing', 'accepted', 'working',
        'قيد التنفيذ', 'قيد المعالجة', 'جاري التنفيذ', 'جاري المعالجة'
    )
    review_words = (
        'pending', 'review', 'under review', 'waiting', 'queued', 'queue', 'new',
        'قيد المراجعة', 'بانتظار المراجعة', 'قيد الانتظار', 'انتظار'
    )

    if any(word in token for word in failed_words):
        return {
            'local_status': 'cancelled', 'key': 'failed', 'label': '❌ مرفوض أو فشل',
            'final': True, 'failed': True, 'raw': raw or 'failed'
        }
    if any(word in token for word in completed_words):
        return {
            'local_status': 'completed', 'key': 'completed', 'label': '✅ مكتمل',
            'final': True, 'failed': False, 'raw': raw or 'completed'
        }
    if any(word in token for word in processing_words):
        return {
            'local_status': 'processing', 'key': 'processing', 'label': '🔄 قيد التنفيذ',
            'final': False, 'failed': False, 'raw': raw or 'processing'
        }
    if any(word in token for word in review_words) or token in {'ok', 'success', ''}:
        return {
            'local_status': 'pending', 'key': 'review', 'label': '⏳ قيد المراجعة',
            'final': False, 'failed': False, 'raw': raw or 'pending'
        }
    return {
        'local_status': 'processing', 'key': f"other:{token[:80]}",
        'label': f"🔔 {raw or 'تم تحديث الحالة'}", 'final': False,
        'failed': False, 'raw': raw or 'unknown'
    }


def extract_api_order_items(payload: Any) -> list[dict[str, Any]]:
    """استخراج سجلات الطلبات من أشكال استجابة مختلفة."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []

    for key in ('data', 'orders', 'items', 'results', 'result'):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            for nested_key in ('orders', 'items', 'results', 'data'):
                nested = value.get(nested_key)
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
            if any(k in value for k in ('id', 'order_id', 'orderId', 'uuid', 'order_uuid', 'status', 'state')):
                return [value]

    if any(k in payload for k in ('id', 'order_id', 'orderId', 'uuid', 'order_uuid', 'state')):
        return [payload]
    return []


def _api_record_containers(record: Any) -> list[dict[str, Any]]:
    if not isinstance(record, dict):
        return []
    containers: list[dict[str, Any]] = []
    for key in ('data', 'order', 'result'):
        nested = record.get(key)
        if isinstance(nested, dict):
            containers.append(nested)
    containers.append(record)
    return containers


def extract_api_record_id(record: Any, by_uuid: bool = False) -> str:
    keys = ('uuid', 'order_uuid', 'orderUuid') if by_uuid else (
        'order_id', 'orderId', 'id', 'order', 'reference', 'reference_id'
    )
    for container in _api_record_containers(record):
        for key in keys:
            value = container.get(key)
            if isinstance(value, (str, int)) and str(value).strip():
                return str(value).strip()
    return ''


def extract_api_record_status(record: Any) -> tuple[str, str]:
    """استخراج حالة الطلب ورسالة الموقع إن وجدت."""
    status = ''
    message = ''
    for container in _api_record_containers(record):
        if not status:
            for key in ('order_status', 'orderStatus', 'state', 'status_name', 'status'):
                value = container.get(key)
                if isinstance(value, (str, int)) and str(value).strip():
                    status = str(value).strip()
                    break
        if not message:
            for key in ('message', 'note', 'reason', 'description', 'details', 'response'):
                value = container.get(key)
                if isinstance(value, (str, int)) and str(value).strip():
                    message = str(value).strip()
                    break
    return status, clean_api_text(message, 500)


def extract_created_api_order(api_result: Any) -> tuple[str, str, str]:
    """قراءة رقم الطلب وحالته من رد إنشاء الطلب دون اعتبار OK = مكتمل."""
    if not isinstance(api_result, dict):
        return '', 'pending', ''
    order_id = extract_api_record_id(api_result, by_uuid=False)
    status = ''
    message = ''
    # نفضّل الحالة الموجودة داخل data/order لأنها حالة الطلب الفعلية.
    nested_containers = _api_record_containers(api_result)
    for index, container in enumerate(nested_containers):
        for key in ('order_status', 'orderStatus', 'state', 'status_name'):
            value = container.get(key)
            if isinstance(value, (str, int)) and str(value).strip():
                status = str(value).strip()
                break
        if status:
            break
        # status في المستوى الخارجي غالباً OK ويعني نجاح الطلب البرمجي فقط.
        if index < len(nested_containers) - 1:
            value = container.get('status')
            if isinstance(value, (str, int)) and str(value).strip():
                status = str(value).strip()
                break
    _, message = extract_api_record_status(api_result)
    return order_id, status or 'pending', message


def is_definitive_api_failure(api_result: Any) -> bool:
    """تمييز الرفض الصريح من انقطاع الاتصال المجهول."""
    if not isinstance(api_result, dict):
        return False
    if bool(api_result.get('_definitive_failure')):
        return True
    status = str(api_result.get('status', '') or '').casefold().strip()
    if status not in {'error', 'failed', 'fail', 'invalid', 'rejected', 'cancelled', 'canceled'}:
        return False
    message = clean_api_text(
        api_result.get('message') or api_result.get('error') or api_result.get('details'),
        500,
    ).casefold()
    uncertain_words = ('timeout', 'connection', 'network', 'temporar', '429', 'rate limit')
    return not any(word in message for word in uncertain_words)


async def refund_api_order_once(order_id: int) -> float:
    """إعادة مبلغ طلب فاشل مرة واحدة فقط وبداخل عملية قاعدة بيانات آمنة."""
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute('BEGIN IMMEDIATE')
            async with db.execute(
                "SELECT user_id, total_price, COALESCE(api_refunded, 0) FROM orders WHERE id = ?",
                (order_id,)
            ) as cursor:
                row = await cursor.fetchone()
            if not row or int(row[2] or 0) == 1:
                await db.rollback()
                return 0.0

            user_id = int(row[0])
            amount = round(float(row[1] or 0), 2)
            if amount <= 0:
                await db.execute("UPDATE orders SET api_refunded = 1, payment_state = 'refunded' WHERE id = ?", (order_id,))
                await db.commit()
                return 0.0

            changed = await db.execute(
                "UPDATE orders SET api_refunded = 1, payment_state = 'refunded' WHERE id = ? AND COALESCE(api_refunded, 0) = 0",
                (order_id,)
            )
            if changed.rowcount != 1:
                await db.rollback()
                return 0.0

            await db.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
            now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            await db.execute(
                "INSERT INTO balance_logs (user_id, amount, type, reason, date, admin_id) "
                "VALUES (?, ?, 'refund', ?, ?, 0)",
                (user_id, amount, f'استرداد تلقائي للطلب #{order_id} بعد فشل الموقع', now)
            )
            await db.commit()
            return amount
        except Exception:
            await db.rollback()
            raise


async def apply_api_order_status(order_row: dict[str, Any], record: dict[str, Any]) -> bool:
    """حفظ تغير حالة طلب واحد وإبلاغ الزبون والإدارة عند تغيرها."""
    raw_status, provider_message = extract_api_record_status(record)
    if not raw_status:
        return False

    status_info = classify_api_order_status(raw_status)
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    order_id = int(order_row['id'])
    previous_notified = str(order_row.get('api_notified_status') or '')
    changed_for_user = previous_notified != status_info['key']

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE orders SET status = ?, api_status = ?, api_status_message = ?, "
            "api_status_updated_at = ?, api_last_checked_at = ?, api_monitor_active = ? WHERE id = ?",
            (
                status_info['local_status'], status_info['raw'], provider_message, now, now,
                0 if status_info['final'] else 1, order_id,
            )
        )
        await db.commit()

    refunded_amount = 0.0
    if status_info['failed']:
        refunded_amount = await refund_api_order_once(order_id)

    if changed_for_user:
        product_name = clean_api_text(order_row.get('product_name') or 'غير معروف', 250)
        lines = [
            '🔔 تحديث حالة طلبك', '',
            f"رقم الطلب: #{order_id}",
            f"المنتج: {product_name}",
            f"الحالة: {status_info['label']}",
        ]
        if provider_message and provider_message.casefold() not in status_info['raw'].casefold():
            lines.append(f"ملاحظة الموقع: {provider_message}")
        if refunded_amount > 0:
            lines.extend(['', f"💰 تمت إعادة {refunded_amount:.2f} $ إلى رصيدك تلقائياً."])
        if status_info['key'] == 'review':
            lines.extend(['', 'لا تحتاج إلى مراسلة الإدارة؛ سنخبرك تلقائياً عند تغير الحالة.'])

        await safe_send_message(int(order_row['user_id']), '\n'.join(lines), parse_mode=None)

        admin_lines = [
            '🔄 تحديث تلقائي لطلب الموقع',
            f"الطلب المحلي: #{order_id}",
            f"طلب الموقع: {order_row.get('api_order_id') or order_row.get('api_order_uuid') or 'غير معروف'}",
            f"المستخدم: {order_row['user_id']}",
            f"المنتج: {product_name}",
            f"الحالة: {status_info['label']} ({status_info['raw']})",
        ]
        if refunded_amount > 0:
            admin_lines.append(f"تم رد الرصيد: {refunded_amount:.2f} $")
        await safe_send_message(ADMIN_ID, '\n'.join(admin_lines), parse_mode=None)

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE orders SET api_notified_status = ? WHERE id = ?",
                (status_info['key'], order_id)
            )
            await db.commit()
    return True


async def check_api_order_batch(api: JS4CardAPI, orders: list[dict[str, Any]], by_uuid: bool) -> int:
    if not orders:
        return 0
    lookup_key = 'api_order_uuid' if by_uuid else 'api_order_id'
    lookup_values = [str(order[lookup_key]) for order in orders if order.get(lookup_key)]
    if not lookup_values:
        return 0

    result = await api.check_orders(lookup_values, by_uuid=by_uuid)
    items = extract_api_order_items(result)
    if not items:
        logger.warning('لم تُرجع خدمة الطلبات بيانات للحزمة: %s', lookup_values)
        return 0

    item_map: dict[str, dict[str, Any]] = {}
    for item in items:
        item_id = extract_api_record_id(item, by_uuid=by_uuid)
        if item_id:
            item_map[item_id] = item

    updated = 0
    for index, order in enumerate(orders):
        lookup_value = str(order.get(lookup_key) or '')
        item = item_map.get(lookup_value)
        if item is None and len(items) == len(orders):
            item = items[index]
        if item is not None and await apply_api_order_status(order, item):
            updated += 1
    return updated


async def recover_queued_api_orders_once(api: JS4CardAPI) -> int:
    """استعادة الطلبات التي حُجز رصيدها ثم توقف السيرفر قبل اكتمال الإرسال."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT o.id, o.user_id, o.total_price, o.api_order_uuid, o.request_payload, "
            "COALESCE(p.name, 'غير معروف') AS product_name "
            "FROM orders o LEFT JOIN products p ON p.id = o.product_id "
            "WHERE o.api_provider = 'js4card' AND o.api_status IN ('queued', 'sending') "
            "AND COALESCE(o.api_order_uuid, '') <> '' "
            "AND COALESCE(o.request_payload, '') <> '' "
            "ORDER BY o.id ASC LIMIT 20"
        ) as cursor:
            rows = [dict(row) for row in await cursor.fetchall()]

    recovered = 0
    for row in rows:
        order_id = int(row['id'])
        try:
            payload = json.loads(row.get('request_payload') or '{}')
            if not isinstance(payload, dict):
                raise ValueError('invalid request payload')
            api_product_id = int(payload.get('api_product_id', 0) or 0)
            quantity = int(payload.get('quantity', 1) or 1)
            fields = dict(payload.get('fields', {}) or {})
            if not api_product_id:
                raise ValueError('missing api product id')

            player_id, extra_params = get_player_id_from_fields(fields)
            api_result = await api.create_order(
                api_product_id,
                qty=quantity,
                player_id=player_id,
                order_uuid=str(row['api_order_uuid']),
                **extra_params,
            )
            now = _purchase_now()
            result_ok = bool(isinstance(api_result, dict) and api_result.get('_ok', True))
            result_status = str((api_result or {}).get('status', '')).casefold()

            if not result_ok or result_status in {'error', 'failed', 'fail', 'invalid', 'rejected'}:
                if is_definitive_api_failure(api_result):
                    provider_message = clean_api_text(
                        (api_result or {}).get('message') or (api_result or {}).get('error'), 500
                    )
                    async with aiosqlite.connect(DB_PATH) as db:
                        await db.execute(
                            "UPDATE orders SET status = 'cancelled', api_status = 'rejected', "
                            "api_status_message = ?, api_status_updated_at = ?, api_last_checked_at = ?, "
                            "api_notified_status = 'failed', api_monitor_active = 0 WHERE id = ?",
                            (provider_message, now, now, order_id),
                        )
                        await db.commit()
                    refunded = await refund_api_order_once(order_id)
                    await safe_send_message(
                        int(row['user_id']),
                        f"❌ تعذر تنفيذ طلبك #{order_id} وتمت إعادة {refunded:.2f} $ إلى رصيدك.\n"
                        f"السبب: {provider_message or 'رفض الموقع الطلب'}",
                        parse_mode=None,
                    )
                    await safe_send_message(
                        ADMIN_ID,
                        f"❌ فشل استعادة الطلب #{order_id}\nتم رد الرصيد: {refunded:.2f} $\n"
                        f"السبب: {provider_message or 'غير محدد'}",
                        parse_mode=None,
                    )
                    recovered += 1
                    continue

                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute(
                        "UPDATE orders SET status = 'pending', api_status = 'pending_connection_check', "
                        "api_status_message = ?, api_status_updated_at = ?, api_monitor_active = 1 "
                        "WHERE id = ?",
                        (clean_api_text((api_result or {}).get('message'), 500), now, order_id),
                    )
                    await db.commit()
                continue

            api_order_id, raw_status, provider_message = extract_created_api_order(api_result)
            status_info = classify_api_order_status(raw_status)
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE orders SET status = ?, api_order_id = ?, api_status = ?, api_status_message = ?, "
                    "api_status_updated_at = ?, api_last_checked_at = ?, api_notified_status = ?, "
                    "api_monitor_active = ? WHERE id = ?",
                    (
                        status_info['local_status'], api_order_id, status_info['raw'], provider_message,
                        now, now, status_info['key'], 0 if status_info['final'] else 1, order_id,
                    ),
                )
                await db.commit()
            refunded = await refund_api_order_once(order_id) if status_info['failed'] else 0.0
            await safe_send_message(
                int(row['user_id']),
                f"🔄 تمت استعادة طلبك #{order_id} بعد إعادة تشغيل البوت.\n"
                f"الحالة: {status_info['label']}"
                + (f"\nتم رد الرصيد: {refunded:.2f} $" if refunded else ''),
                parse_mode=None,
            )
            recovered += 1
        except Exception as exc:
            logger.error('Queued API order recovery failed for #%s: %s', order_id, exc, exc_info=True)
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE orders SET status = 'pending', api_status = 'pending_connection_check', "
                    "api_status_message = ?, api_status_updated_at = ?, api_monitor_active = 1 WHERE id = ?",
                    (clean_api_text(exc, 500), _purchase_now(), order_id),
                )
                await db.commit()
    return recovered


async def sync_api_order_statuses_once() -> dict[str, int]:
    """استعادة الطلبات غير المرسلة ثم فحص الحالات النشطة على دفعات."""
    if not API_TOKEN or not ORDER_STATUS_MONITOR_ENABLED:
        return {'checked': 0, 'updated': 0, 'recovered': 0}
    if ORDER_STATUS_LOCK.locked():
        return {'checked': 0, 'updated': 0, 'recovered': 0}

    async with ORDER_STATUS_LOCK:
        updated = 0
        recovered = 0
        async with JS4CardAPI(api_token=API_TOKEN, connection_limit=1) as api:
            recovered = await recover_queued_api_orders_once(api)

            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT o.id, o.user_id, o.total_price, o.status, "
                    "COALESCE(o.api_order_id, '') AS api_order_id, "
                    "COALESCE(o.api_order_uuid, '') AS api_order_uuid, "
                    "COALESCE(o.api_status, '') AS api_status, "
                    "COALESCE(o.api_notified_status, '') AS api_notified_status, "
                    "COALESCE(o.api_refunded, 0) AS api_refunded, "
                    "COALESCE(p.name, 'غير معروف') AS product_name "
                    "FROM orders o LEFT JOIN products p ON p.id = o.product_id "
                    "WHERE o.api_provider = 'js4card' AND COALESCE(o.api_monitor_active, 1) = 1 "
                    "AND o.status IN ('pending', 'processing') "
                    "AND (COALESCE(o.api_order_id, '') <> '' OR COALESCE(o.api_order_uuid, '') <> '') "
                    "ORDER BY o.id ASC LIMIT 1000"
                ) as cursor:
                    rows = [dict(row) for row in await cursor.fetchall()]

            by_id = [row for row in rows if row.get('api_order_id')]
            by_uuid = [row for row in rows if not row.get('api_order_id') and row.get('api_order_uuid')]
            for group, use_uuid in ((by_id, False), (by_uuid, True)):
                for start in range(0, len(group), ORDER_STATUS_BATCH_SIZE):
                    batch = group[start:start + ORDER_STATUS_BATCH_SIZE]
                    try:
                        updated += await check_api_order_batch(api, batch, by_uuid=use_uuid)
                    except Exception as exc:
                        logger.error('خطأ في فحص حزمة حالات الطلبات: %s', exc, exc_info=True)
                    if start + ORDER_STATUS_BATCH_SIZE < len(group):
                        await asyncio.sleep(1)

        return {'checked': len(rows), 'updated': updated, 'recovered': recovered}


async def order_status_monitor_loop():
    """حلقة خفيفة تستمر طوال تشغيل البوت وتبلغ المستخدم عند أي تغير."""
    if not ORDER_STATUS_MONITOR_ENABLED:
        logger.info('Automatic order status monitor is disabled.')
        return
    if ORDER_STATUS_START_DELAY_SECONDS:
        await asyncio.sleep(ORDER_STATUS_START_DELAY_SECONDS)

    while True:
        try:
            result = await sync_api_order_statuses_once()
            if result['checked']:
                logger.info(
                    'Order status check finished: checked=%s updated=%s recovered=%s',
                    result['checked'], result['updated'], result.get('recovered', 0)
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error('Automatic order status monitor error: %s', exc, exc_info=True)
        await asyncio.sleep(ORDER_STATUS_CHECK_INTERVAL_SECONDS)



# =============================================================================
# أدوات ومزامنة طرق الدفع
# =============================================================================


class BinanceWalletError(RuntimeError):
    """خطأ آمن من Binance لا يحتوي المفاتيح أو التوقيع."""


class BinanceWalletClient:
    def __init__(self) -> None:
        self.api_key = BINANCE_API_KEY
        self.api_secret = BINANCE_API_SECRET
        self.base_url = BINANCE_API_BASE_URL
        self._time_offset_ms = 0
        self._time_synced_at = 0.0
        self._time_lock = asyncio.Lock()

    @property
    def ready(self) -> bool:
        return bool(BINANCE_AUTO_PAY_ENABLED and self.api_key and self.api_secret)

    async def _json_request(self, method: str, url: str, *, headers: dict[str, str] | None = None) -> Any:
        timeout = aiohttp.ClientTimeout(total=20, connect=8)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.request(method, url, headers=headers or {}) as response:
                    raw = await response.text()
                    try:
                        payload = json.loads(raw) if raw else {}
                    except json.JSONDecodeError:
                        payload = {'msg': raw[:300]}
                    if response.status >= 400:
                        code = payload.get('code', response.status) if isinstance(payload, dict) else response.status
                        msg = payload.get('msg', 'فشل طلب Binance') if isinstance(payload, dict) else 'فشل طلب Binance'
                        raise BinanceWalletError(f'Binance {code}: {clean_api_text(msg, 220)}')
                    return payload
        except asyncio.TimeoutError as exc:
            raise BinanceWalletError('انتهت مهلة الاتصال مع Binance.') from exc
        except aiohttp.ClientError as exc:
            raise BinanceWalletError(f'تعذر الاتصال مع Binance: {exc.__class__.__name__}') from exc

    async def _sync_time(self, force: bool = False) -> None:
        now_loop = asyncio.get_running_loop().time()
        if not force and now_loop - self._time_synced_at < 300:
            return
        async with self._time_lock:
            now_loop = asyncio.get_running_loop().time()
            if not force and now_loop - self._time_synced_at < 300:
                return
            local_before = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
            payload = await self._json_request('GET', f'{self.base_url}/api/v3/time')
            local_after = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
            server_time = int(payload.get('serverTime') or local_after)
            self._time_offset_ms = server_time - ((local_before + local_after) // 2)
            self._time_synced_at = asyncio.get_running_loop().time()

    async def _signed_get(self, path: str, params: dict[str, Any]) -> Any:
        if not self.ready:
            raise BinanceWalletError('دفع Binance غير مفعّل أو المفاتيح غير مكتملة في .env.')
        await self._sync_time()
        signed = dict(params)
        signed['recvWindow'] = BINANCE_RECV_WINDOW
        signed['timestamp'] = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000) + self._time_offset_ms
        query = urlencode(signed, doseq=True)
        signature = hmac.new(
            self.api_secret.encode('utf-8'), query.encode('utf-8'), hashlib.sha256
        ).hexdigest()
        url = f'{self.base_url}{path}?{query}&signature={signature}'
        return await self._json_request('GET', url, headers={'X-MBX-APIKEY': self.api_key})

    async def deposit_address(self) -> dict[str, Any]:
        if BINANCE_DEPOSIT_ADDRESS:
            return {
                'address': BINANCE_DEPOSIT_ADDRESS,
                'coin': BINANCE_COIN,
                'tag': '',
                'url': '',
            }
        params: dict[str, Any] = {'coin': BINANCE_COIN}
        if BINANCE_NETWORK:
            params['network'] = BINANCE_NETWORK
        payload = await self._signed_get('/sapi/v1/capital/deposit/address', params)
        if not isinstance(payload, dict) or not str(payload.get('address') or '').strip():
            raise BinanceWalletError('لم تُرجع Binance عنوان إيداع صالحاً.')
        return payload

    async def deposit_history(self, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            'coin': BINANCE_COIN,
            'status': 1,
            'startTime': max(0, int(start_ms)),
            'endTime': max(0, int(end_ms)),
            'limit': 1000,
        }
        payload = await self._signed_get('/sapi/v1/capital/deposit/hisrec', params)
        if not isinstance(payload, list):
            raise BinanceWalletError('سجل إيداعات Binance غير صالح.')
        return [item for item in payload if isinstance(item, dict)]


BINANCE_WALLET = BinanceWalletClient()
BINANCE_PAYMENT_LOCK = asyncio.Lock()


def _db_now() -> str:
    return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _parse_db_time(value: str) -> datetime.datetime:
    try:
        return datetime.datetime.strptime(str(value), '%Y-%m-%d %H:%M:%S')
    except (TypeError, ValueError):
        return datetime.datetime.now()


def _decimal_text(value: Decimal, places: str = '0.001') -> str:
    return format(value.quantize(Decimal(places), rounding=ROUND_HALF_UP), 'f')


async def ensure_binance_payment_method() -> int:
    """إنشاء/تحديث طريقة Binance التلقائية من متغيرات البيئة فقط."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id FROM payment_methods WHERE provider = 'binance' AND external_id = 'binance_usdt_auto' LIMIT 1"
        ) as cursor:
            existing = await cursor.fetchone()
        method_id = int(existing[0]) if existing else 0

        if not BINANCE_WALLET.ready:
            if method_id:
                await db.execute('UPDATE payment_methods SET is_active = 0 WHERE id = ?', (method_id,))
                await db.commit()
            return 0

    address_info = await BINANCE_WALLET.deposit_address()
    address = str(address_info.get('address') or '').strip()
    tag = str(address_info.get('tag') or '').strip()
    if not address:
        raise BinanceWalletError('عنوان إيداع Binance فارغ.')

    now = _db_now()
    config = json.dumps({
        'coin': BINANCE_COIN,
        'network': BINANCE_NETWORK,
        'address': address,
        'tag': tag,
        'window_minutes': BINANCE_PAYMENT_WINDOW_MINUTES,
        'unique_step': str(BINANCE_UNIQUE_STEP),
    }, ensure_ascii=False)
    tag_note = f'\nMemo/Tag: {tag}' if tag else ''
    details = (
        f'حوّل المبلغ الدقيق الذي يعرضه البوت بعملة {BINANCE_COIN} عبر شبكة {BINANCE_NETWORK}. '
        'تتم إضافة الرصيد تلقائياً بعد تأكيد الإيداع. لا ترسل عبر شبكة مختلفة.' + tag_note
    )

    async with aiosqlite.connect(DB_PATH) as db:
        if method_id:
            await db.execute(
                """
                UPDATE payment_methods
                SET name = ?, details = ?, is_active = 1, icon = '🟡', currency = ?,
                    min_amount = ?, max_amount = ?, sort_order = 10,
                    transfer_label = ?, transfer_value = ?, credit_rate = 1,
                    fixed_fee = 0, fee_percent = 0, proof_required = 0,
                    proof_mode = 'transaction', payment_mode = 'auto',
                    auto_provider = 'binance_deposit', auto_config = ?, last_synced = ?
                WHERE id = ?
                """,
                (
                    f'Binance {BINANCE_COIN} تلقائي', details, BINANCE_COIN,
                    float(BINANCE_MIN_AMOUNT), float(BINANCE_MAX_AMOUNT),
                    f'عنوان {BINANCE_COIN} — شبكة {BINANCE_NETWORK}', address,
                    config, now, method_id,
                ),
            )
        else:
            cursor = await db.execute(
                """
                INSERT INTO payment_methods
                (name, details, is_active, created_at, provider, external_id, icon,
                 currency, min_amount, max_amount, sort_order, transfer_label,
                 transfer_value, credit_rate, fixed_fee, fee_percent, proof_required,
                 proof_mode, payment_mode, auto_provider, auto_config, last_synced)
                VALUES (?, ?, 1, ?, 'binance', 'binance_usdt_auto', '🟡', ?, ?, ?, 10,
                        ?, ?, 1, 0, 0, 0, 'transaction', 'auto', 'binance_deposit', ?, ?)
                """,
                (
                    f'Binance {BINANCE_COIN} تلقائي', details, now, BINANCE_COIN,
                    float(BINANCE_MIN_AMOUNT), float(BINANCE_MAX_AMOUNT),
                    f'عنوان {BINANCE_COIN} — شبكة {BINANCE_NETWORK}', address,
                    config, now,
                ),
            )
            method_id = int(cursor.lastrowid)
        await db.commit()
    return method_id


async def _allocate_binance_exact_amount(db: aiosqlite.Connection, base_amount: Decimal) -> Decimal:
    base = base_amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    now = _db_now()
    async with db.execute(
        "SELECT expected_amount FROM deposit_requests WHERE status = 'waiting_payment' AND expires_at > ?",
        (now,),
    ) as cursor:
        rows = await cursor.fetchall()
    used: set[Decimal] = set()
    for row in rows:
        try:
            used.add(Decimal(str(row[0])))
        except (InvalidOperation, TypeError):
            continue
    for slot in range(1, BINANCE_UNIQUE_SLOTS + 1):
        candidate = (base + (BINANCE_UNIQUE_STEP * slot)).quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)
        if candidate not in used:
            return candidate
    raise BinanceWalletError('لا توجد قيمة تعريف متاحة حالياً. حاول بعد انتهاء طلب دفع سابق.')


def binance_payment_kb(req_id: int, exact_amount: str, address: str) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    if CopyTextButton is not None:
        rows.append([
            InlineKeyboardButton(text='📋 نسخ المبلغ', copy_text=CopyTextButton(text=exact_amount)),
            InlineKeyboardButton(text='📋 نسخ العنوان', copy_text=CopyTextButton(text=address)),
        ])
    else:
        rows.append([
            InlineKeyboardButton(text='📋 نسخ المبلغ', callback_data=f'binance_copy_amount_{req_id}'),
            InlineKeyboardButton(text='📋 نسخ العنوان', callback_data=f'binance_copy_address_{req_id}'),
        ])
    rows.append([InlineKeyboardButton(text='🔄 تحقق من الدفع الآن', callback_data=f'binance_check_{req_id}')])
    rows.append([InlineKeyboardButton(text='❌ إلغاء الطلب', callback_data=f'binance_cancel_{req_id}')])
    rows.append([back_btn('main_menu')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def create_binance_deposit_request(
    message: Message,
    state: FSMContext,
    data: dict[str, Any],
    requested_amount: float,
    credited_amount: float,
) -> None:
    if not BINANCE_WALLET.ready:
        await message.answer('❌ دفع Binance التلقائي غير مفعّل بعد. تواصل مع الإدارة.')
        return
    method_id = int(data.get('payment_method_id') or 0)
    user_id = int(message.from_user.id)
    async with BINANCE_PAYMENT_LOCK:
        method_id = method_id or await ensure_binance_payment_method()
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT transfer_value, auto_config, name FROM payment_methods WHERE id = ? AND is_active = 1",
                (method_id,),
            ) as cursor:
                method = await cursor.fetchone()
            if not method:
                await message.answer('❌ طريقة Binance غير متاحة حالياً.')
                return
            address = str(method[0] or '').strip()
            try:
                config = json.loads(method[1] or '{}')
            except json.JSONDecodeError:
                config = {}
            tag = str(config.get('tag') or '').strip()
            if not address:
                await message.answer('❌ عنوان Binance غير متوفر. تواصل مع الإدارة.')
                return

            now_dt = datetime.datetime.now()
            now = now_dt.strftime('%Y-%m-%d %H:%M:%S')
            expires_dt = now_dt + datetime.timedelta(minutes=BINANCE_PAYMENT_WINDOW_MINUTES)
            expires_at = expires_dt.strftime('%Y-%m-%d %H:%M:%S')
            await db.execute(
                """
                UPDATE deposit_requests SET status = 'cancelled', reviewed_at = ?
                WHERE user_id = ? AND payment_method_id = ? AND status = 'waiting_payment'
                """,
                (now, user_id, method_id),
            )
            exact = await _allocate_binance_exact_amount(db, Decimal(str(requested_amount)))
            exact_text = _decimal_text(exact)
            snapshot = {
                'provider': 'binance_deposit',
                'coin': BINANCE_COIN,
                'network': BINANCE_NETWORK,
                'address': address,
                'tag': tag,
                'requested_amount': str(requested_amount),
                'exact_amount': exact_text,
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
                (
                    user_id, float(credited_amount), str(method[2] or 'Binance'), now,
                    method_id, float(exact), float(credited_amount),
                    json.dumps(snapshot, ensure_ascii=False), exact_text, expires_at,
                ),
            )
            req_id = int(cursor.lastrowid)
            await db.commit()

    await state.clear()
    tag_line = f'\n🏷 Memo/Tag: <code>{html.escape(tag)}</code>' if tag else ''
    text = (
        '🟡 <b>دفع Binance تلقائي</b>\n'
        '━━━━━━━━━━━━━━━━\n\n'
        f'رقم الطلب: <b>#{req_id}</b>\n'
        f'💵 أرسل بالضبط: <code>{html.escape(exact_text)} {html.escape(BINANCE_COIN)}</code>\n'
        f'🌐 الشبكة: <b>{html.escape(BINANCE_NETWORK)}</b>\n'
        f'📍 العنوان:\n<code>{html.escape(address)}</code>'
        f'{tag_line}\n\n'
        f'💰 الرصيد الذي سيضاف: <b>{_money(credited_amount)} USD</b>\n'
        f'⏳ صالح حتى: <b>{html.escape(expires_at)}</b>\n\n'
        '⚠️ أرسل المبلغ الدقيق ومن الشبكة المحددة فقط. الكسر الصغير في المبلغ مخصص لتمييز طلبك.\n'
        '✅ بعد وصول الإيداع وتأكيده ستتم إضافة الرصيد تلقائياً.'
    )
    await message.answer(
        text,
        parse_mode='HTML',
        reply_markup=binance_payment_kb(req_id, exact_text, address),
    )
    await log_activity(user_id, 'binance_payment_created', f'طلب Binance #{req_id} بقيمة {exact_text} {BINANCE_COIN}')


async def _approve_binance_request(req_id: int, deposit: dict[str, Any]) -> tuple[bool, int, float]:
    txid = str(deposit.get('txId') or deposit.get('id') or '').strip()
    if not txid:
        return False, 0, 0.0
    now = _db_now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('BEGIN IMMEDIATE')
        try:
            async with db.execute(
                "SELECT user_id, credited_amount, status FROM deposit_requests WHERE id = ?",
                (req_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if not row or str(row[2]) != 'waiting_payment':
                await db.rollback()
                return False, int(row[0]) if row else 0, float(row[1]) if row else 0.0
            user_id = int(row[0])
            credit = float(row[1] or 0)
            async with db.execute(
                "SELECT id FROM deposit_requests WHERE transaction_reference = ? AND id <> ? LIMIT 1",
                (txid, req_id),
            ) as cursor:
                duplicate = await cursor.fetchone()
            if duplicate:
                await db.rollback()
                return False, user_id, credit
            cursor = await db.execute(
                """
                UPDATE deposit_requests
                SET status = 'approved', reviewed_at = ?, transaction_reference = ?,
                    auto_checked_at = ?, auto_error = '', provider_payload = ?
                WHERE id = ? AND status = 'waiting_payment'
                """,
                (now, txid, now, json.dumps(deposit, ensure_ascii=False), req_id),
            )
            if cursor.rowcount != 1:
                await db.rollback()
                return False, user_id, credit
            await db.execute(
                "INSERT OR IGNORE INTO users(user_id, username, full_name, balance, joined_date) VALUES (?, '', '', 0, ?)",
                (user_id, now),
            )
            await db.execute('UPDATE users SET balance = balance + ? WHERE user_id = ?', (credit, user_id))
            await db.execute(
                """
                INSERT INTO balance_logs (user_id, amount, type, reason, date, admin_id)
                VALUES (?, ?, 'add', ?, ?, 0)
                """,
                (user_id, credit, f'شحن Binance تلقائي - طلب #{req_id}', now),
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise

    await safe_send_message(
        user_id,
        f'✅ <b>تم تأكيد دفعة Binance تلقائياً</b>\n\n'
        f'رقم الطلب: <b>#{req_id}</b>\n'
        f'تمت إضافة <b>{_money(credit)} USD</b> إلى رصيدك.',
        parse_mode='HTML',
    )
    await safe_send_message(
        ADMIN_ID,
        f'🟡 <b>دفعة Binance مؤكدة</b>\n\n'
        f'الطلب: <b>#{req_id}</b>\nالمستخدم: <code>{user_id}</code>\n'
        f'الرصيد المضاف: <b>{_money(credit)} USD</b>\n'
        f'TXID: <code>{html.escape(txid[:120])}</code>',
        parse_mode='HTML',
    )
    await log_activity(user_id, 'binance_payment_approved', f'تأكيد تلقائي للطلب #{req_id}')
    return True, user_id, credit


def _deposit_matches_request(deposit: dict[str, Any], request: dict[str, Any]) -> bool:
    try:
        deposit_amount = Decimal(str(deposit.get('amount') or '0'))
        expected = Decimal(str(request['expected_amount']))
    except (InvalidOperation, KeyError, TypeError):
        return False
    if deposit_amount != expected:
        return False
    if int(deposit.get('status', 0) or 0) != 1:
        return False
    if str(deposit.get('coin') or '').upper() != BINANCE_COIN:
        return False
    network = str(deposit.get('network') or '').upper()
    if BINANCE_NETWORK and network and network != BINANCE_NETWORK:
        return False
    insert_ms = int(deposit.get('insertTime') or deposit.get('completeTime') or 0)
    created_ms = int(_parse_db_time(request['created_at']).timestamp() * 1000)
    expires_ms = int(_parse_db_time(request['expires_at']).timestamp() * 1000)
    if insert_ms and not (created_ms - 300000 <= insert_ms <= expires_ms + 300000):
        return False
    expected_address = str(request.get('address') or '').strip().lower()
    received_address = str(deposit.get('address') or '').strip().lower()
    if expected_address and received_address and expected_address != received_address:
        return False
    return True


async def check_binance_request(req_id: int) -> tuple[str, str]:
    async with BINANCE_PAYMENT_LOCK:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                """
                SELECT id, user_id, expected_amount, created_at, expires_at, status, payment_snapshot
                FROM deposit_requests WHERE id = ?
                """,
                (req_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if not row:
            return 'missing', 'الطلب غير موجود.'
        status = str(row[5])
        if status == 'approved':
            return 'approved', 'تم تأكيد هذا الطلب مسبقاً.'
        if status != 'waiting_payment':
            return status, 'هذا الطلب لم يعد بانتظار الدفع.'
        if _parse_db_time(row[4]) <= datetime.datetime.now():
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE deposit_requests SET status = 'expired', reviewed_at = ? WHERE id = ? AND status = 'waiting_payment'",
                    (_db_now(), req_id),
                )
                await db.commit()
            return 'expired', 'انتهت مهلة هذا الطلب. أنشئ طلب دفع جديداً.'
        try:
            snapshot = json.loads(row[6] or '{}')
        except json.JSONDecodeError:
            snapshot = {}
        request = {
            'expected_amount': str(row[2]),
            'created_at': str(row[3]),
            'expires_at': str(row[4]),
            'address': str(snapshot.get('address') or ''),
        }
        start_ms = int((_parse_db_time(row[3]) - datetime.timedelta(minutes=5)).timestamp() * 1000)
        end_ms = int(datetime.datetime.now().timestamp() * 1000)
        try:
            deposits = await BINANCE_WALLET.deposit_history(start_ms, end_ms)
        except BinanceWalletError as exc:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE deposit_requests SET auto_checked_at = ?, auto_error = ? WHERE id = ?",
                    (_db_now(), clean_api_text(exc, 240), req_id),
                )
                await db.commit()
            return 'error', clean_api_text(exc, 180)
        for deposit in deposits:
            if _deposit_matches_request(deposit, request):
                approved, _user_id, _credit = await _approve_binance_request(req_id, deposit)
                if approved:
                    return 'approved', 'تم العثور على الدفعة وإضافة الرصيد.'
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE deposit_requests SET auto_checked_at = ?, auto_error = '' WHERE id = ?",
                (_db_now(), req_id),
            )
            await db.commit()
        return 'waiting', 'لم تصل دفعة مطابقة ومؤكدة بعد. انتظر قليلاً ثم أعد التحقق.'


async def check_binance_pending_once() -> int:
    now = _db_now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE deposit_requests SET status = 'expired', reviewed_at = ? "
            "WHERE status = 'waiting_payment' AND expires_at <> '' AND expires_at <= ?",
            (now, now),
        )
        await db.commit()
        async with db.execute(
            """
            SELECT dr.id, dr.expected_amount, dr.created_at, dr.expires_at, dr.payment_snapshot
            FROM deposit_requests dr
            JOIN payment_methods pm ON pm.id = dr.payment_method_id
            WHERE dr.status = 'waiting_payment' AND pm.auto_provider = 'binance_deposit'
            ORDER BY dr.created_at ASC
            """
        ) as cursor:
            rows = await cursor.fetchall()
    if not rows:
        return 0

    earliest = min(_parse_db_time(row[2]) for row in rows) - datetime.timedelta(minutes=5)
    start_ms = int(earliest.timestamp() * 1000)
    end_ms = int(datetime.datetime.now().timestamp() * 1000)
    deposits = await BINANCE_WALLET.deposit_history(start_ms, end_ms)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT transaction_reference FROM deposit_requests WHERE transaction_reference <> ''"
        ) as cursor:
            used = {str(row[0]) for row in await cursor.fetchall()}
    approved_count = 0
    reserved: set[str] = set()
    for row in rows:
        try:
            snapshot = json.loads(row[4] or '{}')
        except json.JSONDecodeError:
            snapshot = {}
        request = {
            'expected_amount': str(row[1]),
            'created_at': str(row[2]),
            'expires_at': str(row[3]),
            'address': str(snapshot.get('address') or ''),
        }
        for deposit in deposits:
            txid = str(deposit.get('txId') or deposit.get('id') or '').strip()
            if not txid or txid in used or txid in reserved:
                continue
            if not _deposit_matches_request(deposit, request):
                continue
            approved, _user_id, _credit = await _approve_binance_request(int(row[0]), deposit)
            if approved:
                approved_count += 1
                reserved.add(txid)
                break
    return approved_count


async def binance_payment_worker() -> None:
    if not BINANCE_AUTO_PAY_ENABLED:
        logger.info('Binance auto payment is disabled.')
        return
    if not BINANCE_API_KEY or not BINANCE_API_SECRET:
        logger.warning('Binance auto payment enabled but API keys are missing.')
        return
    if BINANCE_START_DELAY_SECONDS:
        await asyncio.sleep(BINANCE_START_DELAY_SECONDS)
    try:
        method_id = await ensure_binance_payment_method()
        logger.info('Binance automatic payment method ready: %s', method_id)
    except Exception as exc:
        logger.error('Binance payment setup failed: %s', clean_api_text(exc, 240))
    while True:
        try:
            await check_binance_pending_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning('Binance payment worker check failed: %s', clean_api_text(exc, 240))
        await asyncio.sleep(BINANCE_POLL_SECONDS)


@dp.callback_query(F.data.startswith('binance_check_'))
async def cb_binance_check(callback: CallbackQuery):
    try:
        req_id = int(callback.data.rsplit('_', 1)[1])
    except (TypeError, ValueError):
        await callback.answer('رقم الطلب غير صالح.', show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute('SELECT user_id FROM deposit_requests WHERE id = ?', (req_id,)) as cursor:
            row = await cursor.fetchone()
    if not row or (int(row[0]) != callback.from_user.id and not await is_admin(callback.from_user.id)):
        await callback.answer('غير مصرح لك بهذا الطلب.', show_alert=True)
        return
    await callback.answer('جارٍ فحص Binance…')
    status, message = await check_binance_request(req_id)
    await callback.message.answer(message)


@dp.callback_query(F.data.startswith('binance_cancel_'))
async def cb_binance_cancel(callback: CallbackQuery):
    try:
        req_id = int(callback.data.rsplit('_', 1)[1])
    except (TypeError, ValueError):
        await callback.answer('رقم الطلب غير صالح.', show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE deposit_requests SET status = 'cancelled', reviewed_at = ?
            WHERE id = ? AND user_id = ? AND status = 'waiting_payment'
            """,
            (_db_now(), req_id, callback.from_user.id),
        )
        await db.commit()
    if cursor.rowcount == 1:
        await callback.answer('تم إلغاء طلب الدفع.', show_alert=True)
        await safe_edit_message(callback.message, '❌ تم إلغاء طلب دفع Binance.', back_to_main_kb())
    else:
        await callback.answer('تعذر الإلغاء؛ ربما تمت معالجة الطلب أو انتهت مهلته.', show_alert=True)


@dp.callback_query(F.data.startswith('binance_copy_amount_'))
async def cb_binance_copy_amount(callback: CallbackQuery):
    req_id = int(callback.data.rsplit('_', 1)[1])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            'SELECT user_id, expected_amount FROM deposit_requests WHERE id = ?', (req_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if not row or int(row[0]) != callback.from_user.id:
        await callback.answer('غير مصرح.', show_alert=True)
        return
    await callback.message.answer(f'<code>{html.escape(str(row[1]))}</code>', parse_mode='HTML')
    await callback.answer('اضغط مطولاً لنسخ المبلغ.')


@dp.callback_query(F.data.startswith('binance_copy_address_'))
async def cb_binance_copy_address(callback: CallbackQuery):
    req_id = int(callback.data.rsplit('_', 1)[1])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            'SELECT user_id, payment_snapshot FROM deposit_requests WHERE id = ?', (req_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if not row or int(row[0]) != callback.from_user.id:
        await callback.answer('غير مصرح.', show_alert=True)
        return
    try:
        snapshot = json.loads(row[1] or '{}')
    except json.JSONDecodeError:
        snapshot = {}
    address = str(snapshot.get('address') or '')
    await callback.message.answer(f'<code>{html.escape(address)}</code>', parse_mode='HTML')
    await callback.answer('اضغط مطولاً لنسخ العنوان.')


def _payment_text(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'نعم' if value else 'لا'
    if isinstance(value, (list, tuple, set)):
        return '، '.join(_payment_text(item) for item in value if _payment_text(item))
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip()


def _payment_float(value: Any) -> float:
    if value in (None, '', False):
        return 0.0
    try:
        raw_value = str(value).strip().replace('،', ',')
        # يدعم قيماً مثل: 1 USD أو 0.5% أو $10.
        match = re.search(r'-?[0-9]+(?:[.,][0-9]+)?', raw_value)
        if not match:
            return 0.0
        cleaned = match.group(0).replace(',', '.')
        return max(0.0, float(cleaned))
    except (TypeError, ValueError):
        return 0.0


def _payment_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    normalized = str(value).strip().lower()
    if normalized in {'0', 'false', 'inactive', 'disabled', 'off', 'no', 'غير فعال', 'معطل'}:
        return False
    if normalized in {'1', 'true', 'active', 'enabled', 'on', 'yes', 'ok', 'فعال', 'مفعل'}:
        return True
    return default


def payment_method_icon(name: str, supplied: str = '') -> str:
    supplied = (supplied or '').strip()
    if supplied and len(supplied) <= 5 and not supplied.startswith(('http://', 'https://')):
        return supplied
    value = (name or '').lower()
    rules = [
        (('syriatel', 'سيريتل', 'سيرياتيل'), '📱'),
        (('mtn', 'ام تي ان'), '📲'),
        (('binance', 'باينانس'), '🟡'),
        (('usdt', 'trc20', 'erc20', 'bep20', 'crypto', 'عملة رقمية'), '₮'),
        (('paypal', 'بايبال'), '🅿️'),
        (('visa', 'mastercard', 'card', 'بطاقة'), '💳'),
        (('bank', 'بنك', 'حوالة'), '🏦'),
        (('cash', 'كاش', 'محفظة'), '💸'),
    ]
    for keywords, icon in rules:
        if any(keyword in value for keyword in keywords):
            return icon
    return '💳'


def _extract_payment_items(payload: Any) -> list[dict[str, Any]]:
    """استخراج طرق الدفع من أشكال الاستجابة المختلفة التي قد يعيدها الموقع."""
    if isinstance(payload, list):
        result: list[dict[str, Any]] = []
        for item in payload:
            if isinstance(item, dict):
                result.append(dict(item))
            elif isinstance(item, str) and item.strip():
                result.append({'name': item.strip()})
        return result
    if not isinstance(payload, dict):
        return []

    container_keys = (
        'payment_methods', 'paymentMethods', 'payment-methods',
        'deposit_methods', 'depositMethods', 'deposit-methods',
        'methods', 'payments', 'wallets', 'gateways',
        'data', 'result', 'results', 'items', 'list',
    )
    for key in container_keys:
        if key in payload:
            items = _extract_payment_items(payload.get(key))
            if items:
                return items

    name_keys = {
        'name', 'title', 'label', 'display_name', 'displayName',
        'method_name', 'payment_method',
    }
    if any(key in payload for key in name_keys):
        return [dict(payload)]

    # بعض الواجهات تعيد قاموساً يكون اسم/رمز الطريقة هو المفتاح.
    items: list[dict[str, Any]] = []
    for key, value in payload.items():
        if isinstance(value, dict):
            item = dict(value)
            item.setdefault('code', key)
            items.append(item)
        elif isinstance(value, str) and value.strip():
            items.append({'code': key, 'name': value.strip()})
    return items


def _payment_default_priority(name: str) -> int:
    """ترتيب احترافي عند عدم إرسال الموقع ترتيباً صريحاً."""
    value = (name or '').casefold()
    groups = [
        (('syriatel', 'سيريتل', 'سيرياتيل', 'mtn', 'ام تي ان'), 10),
        (('usdt', 'trc20', 'erc20', 'bep20', 'binance', 'باينانس', 'crypto'), 20),
        (('visa', 'mastercard', 'card', 'بطاقة'), 30),
        (('bank', 'بنك', 'حوالة'), 40),
        (('paypal', 'بايبال'), 50),
        (('cash', 'كاش', 'محفظة'), 60),
    ]
    for keywords, priority in groups:
        if any(keyword in value for keyword in keywords):
            return priority
    return 100


def normalize_payment_methods(payload: Any) -> list[dict[str, Any]]:
    """توحيد طرق الدفع القادمة من الموقع مهما اختلفت أسماء الحقول."""
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    items = _extract_payment_items(payload)

    def first_text(raw: dict[str, Any], keys: tuple[str, ...]) -> tuple[str, str]:
        for key in keys:
            value = _payment_text(raw.get(key))
            if value:
                return value, key
        return '', ''

    def flatten_payment_data(value: Any) -> tuple[dict[str, Any], list[tuple[str, str]]]:
        """تجميع الحقول المتداخلة والحقول المكتوبة على شكل label/value."""
        flat: dict[str, Any] = {}
        labelled: list[tuple[str, str]] = []

        def walk(current: Any, depth: int = 0) -> None:
            if depth > 4:
                return
            if isinstance(current, dict):
                label = _payment_text(
                    current.get('label') or current.get('title') or current.get('name')
                    or current.get('key') or current.get('field')
                )
                labelled_value = _payment_text(
                    current.get('value') or current.get('content') or current.get('text')
                    or current.get('data_value') or current.get('field_value')
                )
                if label and labelled_value and label.casefold() != labelled_value.casefold():
                    labelled.append((label, labelled_value))

                for key, child in current.items():
                    if isinstance(child, (str, int, float, bool)) or child is None:
                        flat.setdefault(str(key), child)
                    else:
                        walk(child, depth + 1)
            elif isinstance(current, (list, tuple)):
                for child in current:
                    walk(child, depth + 1)

        walk(value)
        return flat, labelled

    def labelled_value(fields: list[tuple[str, str]], keywords: tuple[str, ...]) -> tuple[str, str]:
        for label, value in fields:
            normalized_label = label.casefold()
            if any(keyword in normalized_label for keyword in keywords):
                return value, label
        return '', ''

    for index, raw in enumerate(items):
        search_raw, labelled_fields = flatten_payment_data(raw)
        # نعطي الحقول العليا الأولوية على الحقول المتداخلة.
        search_raw.update(raw)

        name, _ = first_text(search_raw, (
            'name', 'title', 'label', 'display_name', 'displayName',
            'method_name', 'payment_method',
        ))
        if not name:
            continue

        external_id, _ = first_text(search_raw, (
            'id', 'method_id', 'payment_method_id', 'uuid', 'code',
            'slug', 'key', 'gateway_id', 'gatewayId',
        ))
        if not external_id:
            external_id = re.sub(r'[^a-z0-9\u0600-\u06ff]+', '-', name.casefold()).strip('-')

        dedupe_key = external_id.casefold() or name.casefold()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        details, _ = first_text(search_raw, (
            'details', 'description', 'instructions', 'instruction', 'note',
            'info', 'message', 'payment_instructions', 'paymentInstructions',
        ))

        transfer_value, transfer_key = first_text(search_raw, (
            'transfer_value', 'transferValue', 'payment_address', 'paymentAddress',
            'account_number', 'accountNumber', 'account_no', 'accountNo',
            'binance_id', 'binanceId', 'pay_id', 'payId', 'recipient_id',
            'recipientId', 'wallet_address', 'walletAddress', 'address',
            'iban', 'account', 'phone_number', 'phoneNumber', 'mobile', 'phone',
            'number', 'destination', 'receiver', 'recipient',
        ))
        explicit_label, _ = first_text(search_raw, (
            'transfer_label', 'transferLabel', 'account_label', 'accountLabel',
            'address_label', 'addressLabel', 'field_label', 'fieldLabel',
        ))
        if not transfer_value:
            transfer_value, labelled_transfer_label = labelled_value(
                labelled_fields,
                (
                    'account', 'iban', 'wallet', 'address', 'binance', 'pay id',
                    'transfer', 'phone', 'mobile', 'رقم', 'معرف', 'معرّف',
                    'عنوان', 'حساب', 'محفظة',
                ),
            )
            if labelled_transfer_label and not explicit_label:
                explicit_label = labelled_transfer_label

        # بعض المواقع ترسل رقم التحويل داخل نص التعليمات فقط.
        if not transfer_value and details:
            transfer_match = re.search(
                r'(?:معر[ّ]?ف(?:\s+Binance)?|رقم(?:\s+الحساب|\s+التحويل)?|'
                r'Binance\s*ID|Account(?:\s+Number)?|Wallet(?:\s+Address)?|IBAN)'
                r'\s*[:：\-]\s*([^\n\r]+)',
                details,
                flags=re.IGNORECASE,
            )
            if transfer_match:
                transfer_value = transfer_match.group(1).strip()
                if not explicit_label:
                    explicit_label = transfer_match.group(0).split(':', 1)[0].strip()
        if explicit_label:
            transfer_label = explicit_label
        elif 'binance' in transfer_key.lower() or 'binance' in name.casefold():
            transfer_label = 'معرّف Binance'
        elif 'wallet' in transfer_key.lower() or 'address' in transfer_key.lower():
            transfer_label = 'عنوان المحفظة'
        elif 'phone' in transfer_key.lower() or transfer_key in {'mobile', 'number'}:
            transfer_label = 'رقم التحويل'
        elif 'iban' in transfer_key.lower():
            transfer_label = 'رقم IBAN'
        else:
            transfer_label = 'بيانات التحويل'

        # نجمع الحقول المهمة في التعليمات من دون تكرار قيمة التحويل الأساسية.
        if not details:
            detail_fields = (
                ('اسم المستلم', ('recipient_name', 'recipientName', 'beneficiary', 'owner_name', 'ownerName')),
                ('الشبكة', ('network', 'chain')),
                ('العملة', ('currency', 'currency_code', 'currencyCode')),
                ('ملاحظة', ('notice', 'warning', 'hint')),
            )
            lines: list[str] = []
            for label, keys in detail_fields:
                value, _ = first_text(search_raw, keys)
                if value:
                    lines.append(f'{label}: {value}')
            details = '\n'.join(lines)

        active_value = search_raw.get(
            'is_active', search_raw.get(
                'isActive', search_raw.get('active', search_raw.get('enabled', search_raw.get('status')))
            )
        )
        remote_active = _payment_bool(active_value, True)
        supplied_icon = _payment_text(search_raw.get('icon') or search_raw.get('emoji'))
        currency, _ = first_text(search_raw, (
            'currency', 'currency_code', 'currencyCode', 'deposit_currency', 'depositCurrency'
        ))
        currency = currency or 'USD'
        min_amount = _payment_float(
            search_raw.get('min_amount', search_raw.get('minAmount', search_raw.get('minimum', search_raw.get('min'))))
        )
        max_amount = _payment_float(
            search_raw.get('max_amount', search_raw.get('maxAmount', search_raw.get('maximum', search_raw.get('max'))))
        )
        if min_amount <= 0:
            labelled_min, _ = labelled_value(
                labelled_fields,
                ('minimum', 'min amount', 'الحد الأدنى', 'اقل مبلغ', 'أقل مبلغ'),
            )
            min_amount = _payment_float(labelled_min)
        if max_amount <= 0:
            labelled_max, _ = labelled_value(
                labelled_fields,
                ('maximum', 'max amount', 'الحد الأعلى', 'الحد الاقصى', 'أعلى مبلغ'),
            )
            max_amount = _payment_float(labelled_max)
        if min_amount <= 0 and details:
            minimum_match = re.search(
                r'(?:الحد\s+الأدنى|minimum|min(?:imum)?\s+amount)\s*[:：\-]?\s*([0-9]+(?:[.,][0-9]+)?)',
                details,
                flags=re.IGNORECASE,
            )
            if minimum_match:
                min_amount = _payment_float(minimum_match.group(1))

        credit_rate = _payment_float(
            search_raw.get('credit_rate', search_raw.get('creditRate', search_raw.get(
                'exchange_rate', search_raw.get('exchangeRate', search_raw.get(
                    'conversion_rate', search_raw.get('conversionRate', search_raw.get('rate'))
                ))
            )))
        )
        if credit_rate <= 0:
            credit_rate = 1.0
        fixed_fee = _payment_float(
            search_raw.get('fixed_fee', search_raw.get('fixedFee', search_raw.get('flat_fee', search_raw.get('flatFee'))))
        )
        fee_percent = _payment_float(
            search_raw.get('fee_percent', search_raw.get('feePercent', search_raw.get(
                'commission_percent', search_raw.get('commissionPercent', search_raw.get('percentage_fee'))
            )))
        )
        fee_percent = min(fee_percent, 100.0)
        proof_required = _payment_bool(
            search_raw.get('proof_required', search_raw.get('proofRequired', search_raw.get('requires_proof'))),
            True,
        )

        explicit_order = None
        for order_key in ('sort_order', 'sortOrder', 'order', 'position', 'priority', 'index'):
            if search_raw.get(order_key) not in (None, ''):
                try:
                    explicit_order = int(search_raw.get(order_key))
                except (TypeError, ValueError):
                    explicit_order = None
                break

        normalized.append({
            'external_id': external_id[:190],
            'name': name[:120],
            'details': details[:4000],
            'icon': payment_method_icon(name, supplied_icon),
            'currency': currency[:20],
            'min_amount': min_amount,
            'max_amount': max_amount,
            'transfer_label': transfer_label[:120],
            'transfer_value': transfer_value[:1000],
            'credit_rate': credit_rate,
            'fixed_fee': fixed_fee,
            'fee_percent': fee_percent,
            'proof_required': 1 if proof_required else 0,
            'sort_order': explicit_order,
            'fallback_priority': _payment_default_priority(name),
            'source_index': index,
            'remote_is_active': 1 if remote_active else 0,
            'raw_data': json.dumps(raw, ensure_ascii=False, default=str),
        })

    normalized.sort(
        key=lambda item: (
            0 if item['sort_order'] is not None else 1,
            item['sort_order'] if item['sort_order'] is not None else item['fallback_priority'],
            item['source_index'],
            item['name'].casefold(),
        )
    )
    return normalized


async def sync_payment_methods_from_api(notify_user_id: int | None = None) -> dict[str, Any]:
    """مزامنة طرق الدفع من JS4Card إلى جدول مستقل دون خلطها بأقسام المنتجات."""
    if not API_TOKEN:
        result = {'status': 'error', 'message': 'توكن الموقع غير موجود.', 'count': 0}
        if notify_user_id:
            await safe_send_message(notify_user_id, '❌ توكن الموقع غير موجود في ملف .env')
        return result

    if PAYMENT_SYNC_LOCK.locked():
        return {'status': 'running', 'message': 'المزامنة تعمل بالفعل.', 'count': 0}

    async with PAYMENT_SYNC_LOCK:
        PAYMENT_SYNC_STATUS['running'] = True
        try:
            api = JS4CardAPI(API_TOKEN)
            preferred_path = await get_setting('last_payment_methods_path', '')
            payload = await api.get_payment_methods(preferred_path=preferred_path or None)
            if payload is None:
                message = getattr(api, 'last_payment_methods_error', '') or 'الموقع لم يُرجع طرق الدفع.'
                result = {'status': 'error', 'message': message, 'count': 0}
                if notify_user_id:
                    await safe_send_message(
                        notify_user_id,
                        f'❌ <b>تعذرت مزامنة طرق الدفع</b>\n\n{html.escape(message)}',
                        parse_mode='HTML',
                    )
                return result

            sync_meta = payload.get('_sync_meta', {}) if isinstance(payload, dict) else {}
            source_path = str(sync_meta.get('path') or getattr(api, 'last_payment_methods_path', '') or '')
            source_complete = bool(
                sync_meta.get('complete', getattr(api, 'last_payment_methods_complete', True))
            )
            source_pages = int(sync_meta.get('pages') or getattr(api, 'last_payment_methods_pages', 1) or 1)

            methods = normalize_payment_methods(payload)
            if not methods:
                result = {
                    'status': 'empty',
                    'message': 'اتصل البوت بالموقع، لكن الموقع لم يرسل أي طريقة دفع قابلة للقراءة.',
                    'count': 0,
                }
                if notify_user_id:
                    await safe_send_message(notify_user_id, f"⚠️ {result['message']}")
                return result

            now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            created = 0
            updated = 0
            active_count = 0
            saved_ids: list[int] = []

            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute('BEGIN IMMEDIATE')
                try:
                    for position, method in enumerate(methods):
                        external_id = method['external_id']
                        async with db.execute(
                            """
                            SELECT id, name, details, is_manually_edited, status_override,
                                   transfer_label, transfer_value, min_amount, max_amount,
                                   credit_rate, fixed_fee, fee_percent, proof_required
                            FROM payment_methods
                            WHERE provider = 'js4card' AND external_id = ?
                            """,
                            (external_id,),
                        ) as cursor:
                            existing = await cursor.fetchone()

                        if not existing:
                            # منع التكرار عندما كانت الطريقة مضافة يدوياً سابقاً بالاسم نفسه.
                            async with db.execute(
                                """
                                SELECT id, name, details, is_manually_edited, status_override,
                                       transfer_label, transfer_value, min_amount, max_amount,
                                       credit_rate, fixed_fee, fee_percent, proof_required
                                FROM payment_methods
                                WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
                                ORDER BY CASE WHEN provider = 'js4card' THEN 0 ELSE 1 END, id
                                LIMIT 1
                                """,
                                (method['name'],),
                            ) as cursor:
                                existing = await cursor.fetchone()

                        remote_active = method['remote_is_active']
                        status_override = existing[4] if existing else -1
                        final_active = status_override if status_override in (0, 1) else remote_active
                        active_count += 1 if final_active else 0
                        sort_order = position * 10

                        if existing:
                            method_id = int(existing[0])
                            manually_edited = bool(existing[3])
                            final_name = existing[1] if manually_edited and existing[1] else method['name']
                            final_details = existing[2] if manually_edited and existing[2] else method['details']
                            final_transfer_label = existing[5] if manually_edited and existing[5] else method['transfer_label']
                            final_transfer_value = existing[6] if manually_edited and existing[6] else method['transfer_value']
                            final_min_amount = existing[7] if manually_edited else method['min_amount']
                            final_max_amount = existing[8] if manually_edited else method['max_amount']
                            final_credit_rate = existing[9] if manually_edited else method['credit_rate']
                            final_fixed_fee = existing[10] if manually_edited else method['fixed_fee']
                            final_fee_percent = existing[11] if manually_edited else method['fee_percent']
                            final_proof_required = existing[12] if manually_edited else method['proof_required']
                            await db.execute(
                                """
                                UPDATE payment_methods
                                SET name = ?, details = ?, is_active = ?, provider = 'js4card',
                                    external_id = ?, icon = ?, currency = ?, min_amount = ?,
                                    max_amount = ?, sort_order = ?, raw_data = ?, last_synced = ?,
                                    is_synced = 1, remote_is_active = ?, transfer_label = ?,
                                    transfer_value = ?, credit_rate = ?, fixed_fee = ?,
                                    fee_percent = ?, proof_required = ?
                                WHERE id = ?
                                """,
                                (
                                    final_name, final_details, final_active, external_id,
                                    method['icon'], method['currency'], final_min_amount,
                                    final_max_amount, sort_order, method['raw_data'], now,
                                    remote_active, final_transfer_label, final_transfer_value,
                                    final_credit_rate, final_fixed_fee, final_fee_percent,
                                    final_proof_required, method_id,
                                ),
                            )
                            updated += 1
                        else:
                            cursor = await db.execute(
                                """
                                INSERT INTO payment_methods
                                (name, details, is_active, created_at, provider, external_id,
                                 icon, currency, min_amount, max_amount, sort_order, raw_data,
                                 last_synced, is_synced, is_manually_edited, status_override,
                                 remote_is_active, transfer_label, transfer_value, credit_rate,
                                 fixed_fee, fee_percent, proof_required)
                                VALUES (?, ?, ?, ?, 'js4card', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, -1, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    method['name'], method['details'], final_active, now,
                                    external_id, method['icon'], method['currency'],
                                    method['min_amount'], method['max_amount'], sort_order,
                                    method['raw_data'], now, remote_active,
                                    method['transfer_label'], method['transfer_value'],
                                    method['credit_rate'], method['fixed_fee'],
                                    method['fee_percent'], method['proof_required'],
                                ),
                            )
                            method_id = int(cursor.lastrowid)
                            created += 1
                        saved_ids.append(method_id)

                    # نعطّل الطرق المختفية فقط عندما أكد المصدر أن جميع الصفحات وصلت.
                    # عند انقطاع صفحة لاحقة نحتفظ بالطرق القديمة حتى لا تختفي من الزبائن خطأً.
                    placeholders = ','.join('?' for _ in saved_ids)
                    if saved_ids and source_complete:
                        await db.execute(
                            f"""
                            UPDATE payment_methods
                            SET remote_is_active = 0,
                                is_active = CASE WHEN status_override IN (0, 1)
                                                 THEN status_override ELSE 0 END
                            WHERE provider = 'js4card' AND id NOT IN ({placeholders})
                            """,
                            saved_ids,
                        )

                    # طرق الدفع لا تُحفظ أبداً في جدول الأقسام. نخفي أي قسم فارغ قديم
                    # يحمل اسم طريقة دفع، مع إبقاء أي قسم حقيقي يحتوي منتجات أو أقساماً فرعية.
                    for method in methods:
                        await db.execute(
                            """
                            UPDATE categories
                            SET is_active = 0
                            WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
                              AND NOT EXISTS (
                                  SELECT 1 FROM products p
                                  WHERE p.category_id = categories.id AND p.is_active = 1
                              )
                              AND NOT EXISTS (
                                  SELECT 1 FROM categories child
                                  WHERE child.parent_id = categories.id AND child.is_active = 1
                              )
                            """,
                            (method['name'],),
                        )

                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

            await set_setting('last_payment_methods_sync', now)
            if source_path:
                await set_setting('last_payment_methods_path', source_path)
            await set_setting('last_payment_methods_complete', '1' if source_complete else '0')
            result = {
                'status': 'success' if source_complete else 'partial',
                'message': (
                    'تمت المزامنة بنجاح.' if source_complete
                    else 'تم حفظ الطرق التي وصلت، لكن المصدر لم يؤكد اكتمال جميع الصفحات.'
                ),
                'count': len(methods),
                'active': active_count,
                'created': created,
                'updated': updated,
                'complete': source_complete,
                'pages': source_pages,
                'path': source_path,
            }
            PAYMENT_SYNC_STATUS['last_result'] = result['status']
            PAYMENT_SYNC_STATUS['last_count'] = len(methods)

            if notify_user_id:
                await safe_send_message(
                    notify_user_id,
                    '✅ <b>تمت مزامنة طرق الدفع</b>\n\n'
                    f"💳 إجمالي الطرق: <b>{len(methods)}</b>\n"
                    f"🟢 المفعلة: <b>{active_count}</b>\n"
                    f"🆕 الجديدة: <b>{created}</b>\n"
                    f"🔄 المحدّثة: <b>{updated}</b>\n"
                    f"📄 الصفحات: <b>{source_pages}</b>"
                    + ('' if source_complete else '\n⚠️ تم الاحتفاظ بالطرق القديمة لأن الاستجابة كانت جزئية.'),
                    parse_mode='HTML',
                )
            return result
        except Exception as exc:
            logger.error('Payment methods sync failed: %s', exc, exc_info=True)
            message = str(exc)[:300] or 'خطأ غير معروف'
            PAYMENT_SYNC_STATUS['last_result'] = 'error'
            if notify_user_id:
                await safe_send_message(
                    notify_user_id,
                    f'❌ <b>فشلت مزامنة طرق الدفع</b>\n\n{html.escape(message)}',
                    parse_mode='HTML',
                )
            return {'status': 'error', 'message': message, 'count': 0}
        finally:
            PAYMENT_SYNC_STATUS['running'] = False


# =============================================================================
# لوحات المفاتيح (Keyboards)
# =============================================================================


def _two_column_rows(buttons: list[InlineKeyboardButton]) -> list[list[InlineKeyboardButton]]:
    """ترتيب الأزرار زرين في كل صف، ويبقى الزر الأخير وحده عند العدد الفردي."""
    return [buttons[index:index + 2] for index in range(0, len(buttons), 2)]


def _short_button_text(value: Any, maximum: int = 24) -> str:
    text_value = ' '.join(str(value or '').split())
    if len(text_value) <= maximum:
        return text_value
    return text_value[:maximum - 1].rstrip() + '…'


def _money(value: Any) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    return f'{number:.2f}'.rstrip('0').rstrip('.')

def main_menu_kb(is_admin_user: bool = False) -> InlineKeyboardMarkup:
    kb = [
        [InlineKeyboardButton(text="🛍 تصفح المتجر", callback_data="shop_categories")],
        [
            InlineKeyboardButton(text="💰 رصيدي", callback_data="my_balance"),
            InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders")
        ],
        [
            InlineKeyboardButton(text="❤️ المفضلة", callback_data="my_favorites"),
            InlineKeyboardButton(text="📞 الدعم", callback_data="support")
        ],
        [InlineKeyboardButton(text="💳 شحن الرصيد", callback_data="deposit_request")],
    ]
    if is_admin_user:
        kb.append([InlineKeyboardButton(text="⚙️ لوحة الإدارة", callback_data="admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def back_to_main_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🏠 القائمة الرئيسية", callback_data="main_menu")]
    ])

def back_btn(callback_data: str = "main_menu", label: str = "🔙 رجوع") -> InlineKeyboardButton:
    return InlineKeyboardButton(text=label, callback_data=callback_data)

def admin_panel_kb(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
    perms = perms or {}
    rows = []

    def allowed(permission: str) -> bool:
        return super_admin or bool(perms.get(permission, False))

    def add_pair(items):
        buttons = [InlineKeyboardButton(text=text, callback_data=callback) for text, callback in items]
        if buttons:
            rows.append(buttons)

    add_pair([
        *(([("📊 الإحصائيات", "admin_stats")] if allowed('can_view_stats') else [])),
        *(([("👥 المستخدمون", "admin_users")] if allowed('can_manage_users') else [])),
    ])
    add_pair([
        *(([("📂 الأقسام", "admin_categories")] if allowed('can_manage_categories') else [])),
        *(([("📦 المنتجات", "admin_products")] if allowed('can_manage_products') else [])),
    ])
    add_pair([
        *(([("🛒 طلبات المنتجات", "admin_orders")] if allowed('can_manage_orders') else [])),
        *(([("💰 الرصيد", "admin_balance_menu")] if allowed('can_manage_balance') else [])),
    ])
    add_pair([
        *(([("💳 طلبات الشحن", "admin_deposit_requests")] if allowed('can_manage_payments') else [])),
        *(([("💸 طرق الدفع", "admin_payment_methods")] if allowed('can_manage_payments') else [])),
    ])
    add_pair([
        *(([("📢 إذاعة", "admin_broadcast")] if allowed('can_send_broadcast') else [])),
        *(([("👮 المشرفون", "admin_admins")] if super_admin else [])),
    ])
    if allowed('can_manage_tickets'):
        rows.append([InlineKeyboardButton(text="🎧 مركز الدعم والتذاكر", callback_data="admin_support_center")])
    add_pair([
        *(([("⚙️ الإعدادات", "admin_settings")] if allowed('can_manage_settings') else [])),
        *(([("💹 نسبة الربح", "admin_profit_margin")] if super_admin else [])),
    ])
    add_pair([
        *(([("⚡ تحديث سريع", "admin_api_sync_now")] if allowed('can_manage_sync') else [])),
        *(([("🔄 فحص شامل", "admin_api_full_sync")] if allowed('can_manage_sync') else [])),
    ])
    add_pair([
        *(([("📊 حالة المزامنة", "admin_api_sync_status")] if allowed('can_manage_sync') else [])),
        *(([("📋 سجل العمليات", "admin_activity_log")] if allowed('can_view_stats') else [])),
    ])
    rows.append([InlineKeyboardButton(text="🏠 الرئيسية", callback_data="main_menu")])
    return InlineKeyboardMarkup(inline_keyboard=rows)

def categories_kb(categories: list, parent_id: int = 0) -> InlineKeyboardMarkup:
    """الأقسام الرئيسية والفرعية: زران في كل صف، والأخير وحده."""
    buttons = [
        InlineKeyboardButton(
            text=f"📂 {_short_button_text(cat[1], 25)}",
            callback_data=f"cat_{cat[0]}",
        )
        for cat in categories
    ]
    kb = _two_column_rows(buttons)
    back_cb = "main_menu" if parent_id == 0 else f"cat_{parent_id}_back"
    kb.append([back_btn(back_cb)])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def products_kb(products: list, category_id: int, page: int = 0, per_page: int = 8) -> InlineKeyboardMarkup:
    """المنتجات: منتجان في كل صف، والأخير وحده."""
    start = page * per_page
    end = start + per_page
    page_products = products[start:end]
    buttons: list[InlineKeyboardButton] = []
    for product in page_products:
        product_type = product[8] if len(product) > 8 else 'stock'
        type_icon = '🟢' if product_type == 'stock' else '🔵'
        name = _short_button_text(product[2], 18)
        buttons.append(
            InlineKeyboardButton(
                text=f"{type_icon} {name} • {_money(product[4])}$",
                callback_data=f"prod_{product[0]}",
            )
        )
    kb = _two_column_rows(buttons)
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️ السابق", callback_data=f"cat_{category_id}_p{page-1}"))
    if end < len(products):
        nav.append(InlineKeyboardButton(text="التالي ▶️", callback_data=f"cat_{category_id}_p{page+1}"))
    if nav:
        kb.append(nav)
    kb.append([back_btn("shop_categories", "🔙 الأقسام")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def product_detail_kb(
    product_id: int,
    category_id: int,
    is_fav: bool = False,
    product_type: str = 'stock',
    custom_btns: list = None,
    api_id: int = 0,
    api_provider: str = ''
) -> InlineKeyboardMarkup:
    """لوحة مفاتيح تفاصيل المنتج
    
    مهم: منتجات API لا تستخدم هذه الدالة بل لها زر مباشر في cb_product_detail
    """
    fav_text = "💔 إزالة من المفضلة" if is_fav else "❤️ أضف للمفضلة"
    fav_cb = f"fav_remove_{product_id}" if is_fav else f"fav_add_{product_id}"

    kb = []

    # منتجات عادية فقط
    if custom_btns:
        for i, btn_text in enumerate(custom_btns):
            if btn_text and btn_text.strip():
                kb.append([InlineKeyboardButton(
                    text=btn_text,
                    callback_data=f"order_confirm_{product_id}_{i+1}"
                )])
    if not kb:
        kb.append([InlineKeyboardButton(
            text="🛒 اطلب الآن",
            callback_data=f"order_confirm_{product_id}"
        )])

    kb.append([InlineKeyboardButton(text=fav_text, callback_data=fav_cb)])
    kb.append([back_btn(f"cat_{category_id}", "🔙 رجوع للمنتجات")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def order_confirm_kb(product_id: int) -> InlineKeyboardMarkup:
    kb = [
        [InlineKeyboardButton(text="✅ تأكيد الطلب", callback_data=f"order_place_{product_id}")],
        [InlineKeyboardButton(text="❌ إلغاء", callback_data=f"prod_{product_id}")]
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)

def my_orders_kb(orders: list) -> InlineKeyboardMarkup:
    kb = []
    for o in orders[:10]:
        status_emoji = {"pending": "⏳", "processing": "🔄", "completed": "✅", "cancelled": "❌"}.get(o[5], "📦")
        kb.append([InlineKeyboardButton(
            text=f"{status_emoji} طلب #{o[0]} - {o[4]} $",
            callback_data=f"order_detail_{o[0]}"
        )])
    kb.append([back_btn("main_menu")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_users_kb(users: list, page: int = 0, per_page: int = 8) -> InlineKeyboardMarkup:
    kb = []
    start = page * per_page
    end = start + per_page
    page_users = users[start:end]
    for u in page_users:
        banned_mark = "🚫" if u[5] else "👤"
        store_id = u[6] if len(u) > 6 and u[6] else f'USR{u[0]:06d}'
        display_name = u[2] or u[1] or str(u[0])
        kb.append([InlineKeyboardButton(
            text=f"{banned_mark} [{store_id}] {display_name}",
            callback_data=f"admin_user_{u[0]}"
        )])
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️", callback_data=f"admin_users_p{page-1}"))
    if end < len(users):
        nav.append(InlineKeyboardButton(text="▶️", callback_data=f"admin_users_p{page+1}"))
    if nav:
        kb.append(nav)
    kb.append([back_btn("admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_user_detail_kb(user_id: int, is_banned: bool) -> InlineKeyboardMarkup:
    ban_text = "✅ رفع الحظر" if is_banned else "🚫 حظر المستخدم"
    ban_cb = f"admin_unban_{user_id}" if is_banned else f"admin_ban_{user_id}"
    kb = [
        [InlineKeyboardButton(text="💰 إضافة رصيد", callback_data=f"admin_add_bal_{user_id}")],
        [InlineKeyboardButton(text="💸 خصم رصيد", callback_data=f"admin_deduct_bal_{user_id}")],
        [InlineKeyboardButton(text="📦 طلبات المستخدم", callback_data=f"admin_user_orders_{user_id}")],
        [InlineKeyboardButton(text=ban_text, callback_data=ban_cb)],
        [InlineKeyboardButton(text="✉️ إرسال رسالة", callback_data=f"admin_msg_user_{user_id}")],
        [back_btn("admin_users")]
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_categories_kb(
    categories: list,
    page: int = 0,
    total_count: int | None = None,
) -> InlineKeyboardMarkup:
    """لوحة الأقسام الرئيسية فقط، مع عدد الفروع وتقسيم الصفحات."""
    kb: list[list[InlineKeyboardButton]] = []
    for cat in categories:
        # id, display_name, active, hidden, children_count, products_count
        status = _admin_category_status(cat[2], cat[3])
        label = _short_button_text(str(cat[1]), 28)
        kb.append([
            InlineKeyboardButton(
                text=f"{status} 📂 {label} • {cat[4]} فرع",
                callback_data=f"admcat_open_{cat[0]}_0",
            )
        ])
    total = int(total_count if total_count is not None else len(categories))
    pages = max(1, math.ceil(total / CATEGORY_ADMIN_PAGE_SIZE))
    nav: list[InlineKeyboardButton] = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️ السابق", callback_data=f"admcat_root_{page-1}"))
    if page + 1 < pages:
        nav.append(InlineKeyboardButton(text="التالي ▶️", callback_data=f"admcat_root_{page+1}"))
    if nav:
        kb.append(nav)
    if pages > 1:
        kb.append([InlineKeyboardButton(text=f"📄 {page+1}/{pages}", callback_data="noop")])
    kb.append([
        InlineKeyboardButton(text="🔎 بحث عن قسم", callback_data="admcat_search"),
        InlineKeyboardButton(text="➕ قسم رئيسي", callback_data="admin_add_category"),
    ])
    kb.append([back_btn("admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def admin_category_children_kb(
    parent_id: int,
    children: list,
    page: int,
    total_count: int,
    parent_parent_id: int,
    is_rashq: bool = False,
) -> InlineKeyboardMarkup:
    kb: list[list[InlineKeyboardButton]] = []
    for cat in children:
        # id, display_name, active, hidden, children_count, products_count, virtual
        status = _admin_category_status(cat[2], cat[3])
        kind = "🧩" if cat[6] else "📁"
        label = _short_button_text(str(cat[1]), 26)
        kb.append([
            InlineKeyboardButton(
                text=f"{status} {kind} {label} • {cat[4]}ف/{cat[5]}م",
                callback_data=f"admin_cat_{cat[0]}",
            )
        ])
    pages = max(1, math.ceil(total_count / CATEGORY_ADMIN_PAGE_SIZE))
    nav: list[InlineKeyboardButton] = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️ السابق", callback_data=f"admcat_open_{parent_id}_{page-1}"))
    if page + 1 < pages:
        nav.append(InlineKeyboardButton(text="التالي ▶️", callback_data=f"admcat_open_{parent_id}_{page+1}"))
    if nav:
        kb.append(nav)
    if pages > 1:
        kb.append([InlineKeyboardButton(text=f"📄 {page+1}/{pages}", callback_data="noop")])
    kb.append([
        InlineKeyboardButton(text="➕ مجموعة محلية", callback_data=f"admcat_addgroup_{parent_id}"),
        InlineKeyboardButton(text="🔎 بحث", callback_data="admcat_search"),
    ])
    if is_rashq:
        kb.append([
            InlineKeyboardButton(
                text="🪄 إنشاء وترتيب مجموعات الرشق",
                callback_data=f"admcat_rashq_{parent_id}",
            )
        ])
    back_cb = "admin_categories" if parent_parent_id == 0 else f"admcat_open_{parent_parent_id}_0"
    kb.append([back_btn(back_cb)])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def admin_category_detail_kb(
    cat_id: int,
    is_active: bool,
    is_hidden: bool,
    effective_parent_id: int,
    child_count: int,
    is_virtual: bool,
    has_local_parent: bool,
) -> InlineKeyboardMarkup:
    toggle_text = "❌ تعطيل" if is_active else "✅ تفعيل"
    hide_text = "👁 إظهار للزبائن" if is_hidden else "🙈 إخفاء عن الزبائن"
    kb: list[list[InlineKeyboardButton]] = []
    if child_count > 0 or is_virtual:
        kb.append([InlineKeyboardButton(text=f"📁 فتح المحتويات ({child_count})", callback_data=f"admcat_open_{cat_id}_0")])
    kb.extend([
        [InlineKeyboardButton(text="✏️ تعديل الاسم الظاهر", callback_data=f"admin_cat_edit_{cat_id}")],
        [
            InlineKeyboardButton(text="📦 نقل القسم", callback_data=f"admcat_move_{cat_id}_0"),
            InlineKeyboardButton(text="🔢 ترتيب الظهور", callback_data=f"admcat_sort_{cat_id}"),
        ],
        [InlineKeyboardButton(text=hide_text, callback_data=f"admcat_hide_{cat_id}")],
        [InlineKeyboardButton(text=toggle_text, callback_data=f"admin_cat_toggle_{cat_id}")],
    ])
    if has_local_parent:
        kb.append([InlineKeyboardButton(text="↩️ إلغاء النقل المحلي", callback_data=f"admcat_resetparent_{cat_id}")])
    if is_virtual:
        kb.append([InlineKeyboardButton(text="🗑 حذف المجموعة المحلية", callback_data=f"admin_cat_delete_{cat_id}")])
    else:
        kb.append([InlineKeyboardButton(text="🙈 إخفاء بدل الحذف", callback_data=f"admcat_hide_{cat_id}")])
    back_cb = "admin_categories" if effective_parent_id == 0 else f"admcat_open_{effective_parent_id}_0"
    kb.append([back_btn(back_cb)])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_products_kb(products: list, page: int = 0, per_page: int = 20) -> InlineKeyboardMarkup:
    kb = []
    start = page * per_page
    end = start + per_page
    page_prods = products[start:end]
    for p in page_prods:
        status = "✅" if p[6] else "❌"
        type_label = "📦" if (len(p) > 8 and p[8] == 'stock') else "👍"
        api_mark = " 🌐" if (len(p) > 9 and p[9] and 'js4card' in str(p[9])) else ""
        kb.append([InlineKeyboardButton(
            text=f"{status}{type_label}{api_mark} {p[2][:35]} - {p[4]} $",
            callback_data=f"admin_prod_{p[0]}"
        )])
    nav = []
    total_pages = (len(products) + per_page - 1) // per_page
    if page > 0:
        nav.append(InlineKeyboardButton(text=f"◀️ السابق", callback_data=f"admin_products_p{page-1}"))
    if end < len(products):
        nav.append(InlineKeyboardButton(text=f"التالي ▶️", callback_data=f"admin_products_p{page+1}"))
    if nav:
        kb.append(nav)
    if total_pages > 1:
        kb.append([InlineKeyboardButton(text=f"📄 صفحة {page+1} / {total_pages}", callback_data="noop")])
    kb.append([InlineKeyboardButton(text="➕ إضافة منتج", callback_data="admin_add_product")])
    kb.append([back_btn("admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_product_detail_kb(prod_id: int, is_active: bool) -> InlineKeyboardMarkup:
    toggle_text = "❌ تعطيل" if is_active else "✅ تفعيل"
    kb = [
        [InlineKeyboardButton(text="✏️ تعديل الاسم", callback_data=f"admin_prod_edit_name_{prod_id}")],
        [InlineKeyboardButton(text="🕒 تعديل وقت التسليم", callback_data=f"admin_prod_edit_time_{prod_id}")],
        [InlineKeyboardButton(text="🔘 تعديل أزرار الشراء", callback_data=f"admin_prod_edit_btns_{prod_id}")],
        [InlineKeyboardButton(text="💰 تعديل السعر", callback_data=f"admin_prod_edit_price_{prod_id}")],
        [InlineKeyboardButton(text="📦 تعديل المخزون", callback_data=f"admin_prod_edit_stock_{prod_id}")],
        [InlineKeyboardButton(text="📋 تعديل معلومات التسليم", callback_data=f"admin_prod_edit_delivery_{prod_id}")],
        [InlineKeyboardButton(text=toggle_text, callback_data=f"admin_prod_toggle_{prod_id}")],
        [InlineKeyboardButton(text="🗑 حذف المنتج", callback_data=f"admin_prod_delete_{prod_id}")],
        [back_btn("admin_products")]
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_orders_kb(orders: list, page: int = 0, per_page: int = 8) -> InlineKeyboardMarkup:
    kb = []
    start = page * per_page
    end = start + per_page
    page_orders = orders[start:end]
    for o in page_orders:
        status_emoji = {"pending": "⏳", "processing": "🔄", "completed": "✅", "cancelled": "❌"}.get(o[5], "📦")
        kb.append([InlineKeyboardButton(
            text=f"{status_emoji} #{o[0]} - {o[4]} $",
            callback_data=f"admin_order_{o[0]}"
        )])
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️", callback_data=f"admin_orders_p{page-1}"))
    if end < len(orders):
        nav.append(InlineKeyboardButton(text="▶️", callback_data=f"admin_orders_p{page+1}"))
    if nav:
        kb.append(nav)
    kb.append([back_btn("admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_order_detail_kb(order_id: int) -> InlineKeyboardMarkup:
    kb = [
        [InlineKeyboardButton(text="🔄 تغيير الحالة", callback_data=f"admin_order_status_{order_id}")],
        [back_btn("admin_orders")]
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_order_status_kb(order_id: int) -> InlineKeyboardMarkup:
    statuses = [
        ("⏳ قيد الانتظار", "pending"),
        ("🔄 قيد المعالجة", "processing"),
        ("✅ مكتمل", "completed"),
        ("❌ ملغي", "cancelled")
    ]
    kb = [[InlineKeyboardButton(text=t, callback_data=f"admin_set_order_status_{order_id}_{s}")] for t, s in statuses]
    kb.append([back_btn(f"admin_order_{order_id}")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_coupons_kb(coupons: list) -> InlineKeyboardMarkup:
    kb = []
    for c in coupons[:10]:
        status = "✅" if c[5] else "❌"
        kb.append([InlineKeyboardButton(text=f"{status} {c[1]} - {c[2]}%", callback_data=f"admin_coupon_{c[0]}")])
    kb.append([InlineKeyboardButton(text="➕ إضافة كوبون", callback_data="admin_add_coupon")])
    kb.append([back_btn("admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_coupon_detail_kb(coupon_id: int, is_active: bool) -> InlineKeyboardMarkup:
    toggle_text = "❌ تعطيل" if is_active else "✅ تفعيل"
    kb = [
        [InlineKeyboardButton(text=toggle_text, callback_data=f"admin_coupon_toggle_{coupon_id}")],
        [InlineKeyboardButton(text="🗑 حذف الكوبون", callback_data=f"admin_coupon_delete_{coupon_id}")],
        [back_btn("admin_coupons")]
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_admins_kb(admins: list) -> InlineKeyboardMarkup:
    kb = []
    for admin in admins:
        admin_id = admin[0]
        if admin_id == ADMIN_ID:
            continue
        name = admin[3] or admin[2] or str(admin_id)
        role_code = admin[4] or 'custom'
        is_active = bool(admin[5])
        status = '🟢' if is_active else '🔴'
        kb.append([InlineKeyboardButton(
            text=f"{status} {name} — {admin_role_label(role_code)}",
            callback_data=f"admin_admin_{admin_id}",
        )])
    kb.append([InlineKeyboardButton(text="➕ إضافة مشرف جديد", callback_data="admin_add_admin")])
    kb.append([back_btn("admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def admin_role_picker_kb(admin_id: int) -> InlineKeyboardMarkup:
    rows = []
    role_items = [
        ('manager', '👔 مدير تشغيل'),
        ('catalog', '📦 منتجات وأقسام'),
        ('orders', '🛒 طلبات'),
        ('finance', '💰 مالية ودفع'),
        ('support', '🎧 دعم'),
        ('marketing', '📢 إعلانات'),
        ('analyst', '📊 إحصائيات'),
        ('custom', '⚙️ مخصص'),
    ]
    for index in range(0, len(role_items), 2):
        row = []
        for code, label in role_items[index:index + 2]:
            row.append(InlineKeyboardButton(
                text=label,
                callback_data=f"admin_apply_role_{code}_{admin_id}",
            ))
        rows.append(row)
    rows.append([back_btn(f"admin_admin_{admin_id}", "🔙 رجوع")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def admin_admin_detail_kb(admin_id: int, is_active: bool = True) -> InlineKeyboardMarkup:
    toggle_text = '⏸ إيقاف حساب المشرف' if is_active else '▶️ تفعيل حساب المشرف'
    kb = [
        [InlineKeyboardButton(text="🎭 تغيير الدور", callback_data=f"admin_role_menu_{admin_id}")],
        [InlineKeyboardButton(text=toggle_text, callback_data=f"admin_toggle_admin_{admin_id}")],
        [InlineKeyboardButton(text="📦 المنتجات", callback_data=f"admin_perm_products_{admin_id}"),
         InlineKeyboardButton(text="👥 المستخدمون", callback_data=f"admin_perm_users_{admin_id}")],
        [InlineKeyboardButton(text="🛒 الطلبات", callback_data=f"admin_perm_orders_{admin_id}"),
         InlineKeyboardButton(text="💰 الرصيد", callback_data=f"admin_perm_balance_{admin_id}")],
        [InlineKeyboardButton(text="💳 الدفع والشحن", callback_data=f"admin_perm_payments_{admin_id}"),
         InlineKeyboardButton(text="🎧 الدعم", callback_data=f"admin_perm_tickets_{admin_id}")],
        [InlineKeyboardButton(text="📂 الأقسام", callback_data=f"admin_perm_categories_{admin_id}"),
         InlineKeyboardButton(text="🔄 المزامنة", callback_data=f"admin_perm_sync_{admin_id}")],
        [InlineKeyboardButton(text="📢 الإذاعة", callback_data=f"admin_perm_broadcast_{admin_id}"),
         InlineKeyboardButton(text="📊 الإحصائيات", callback_data=f"admin_perm_stats_{admin_id}")],
        [InlineKeyboardButton(text="⚙️ الإعدادات", callback_data=f"admin_perm_settings_{admin_id}")],
        [InlineKeyboardButton(text="📝 ملاحظة داخلية", callback_data=f"admin_set_admin_note_{admin_id}")],
        [InlineKeyboardButton(text="📊 سجل عملياته", callback_data=f"admin_admin_log_{admin_id}")],
        [InlineKeyboardButton(text="🗑 إزالة المشرف", callback_data=f"admin_remove_admin_confirm_{admin_id}")],
        [back_btn("admin_admins")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_settings_kb() -> InlineKeyboardMarkup:
    kb = [
        [InlineKeyboardButton(text="📝 رسالة الترحيب", callback_data="admin_set_welcome")],
        [InlineKeyboardButton(text="🎧 رسالة مركز الدعم", callback_data="admin_set_support_msg")],
        [InlineKeyboardButton(text="🔗 إعدادات واتساب وتيليجرام", callback_data="admin_support_contacts")],
        [InlineKeyboardButton(text="🔧 حالة البوت", callback_data="admin_toggle_bot_status")],
        [back_btn("admin_panel")]
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)

def _payment_proof_label(mode: str) -> str:
    return {
        'photo': 'صورة الإيصال فقط',
        'transaction': 'رقم العملية فقط',
        'either': 'صورة أو رقم العملية',
    }.get(str(mode or '').strip().lower(), 'صورة أو رقم العملية')


def payment_proof_mode_kb(context: str, method_id: int = 0) -> InlineKeyboardMarkup:
    suffix = str(method_id) if method_id else 'new'
    back_target = f'admin_pm_{method_id}' if context == 'edit' and method_id else 'admin_payment_methods'
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text='📷 صورة الإيصال', callback_data=f'admin_pm_proof_{context}_photo_{suffix}'),
            InlineKeyboardButton(text='🔢 رقم العملية', callback_data=f'admin_pm_proof_{context}_transaction_{suffix}'),
        ],
        [InlineKeyboardButton(text='🧾 صورة أو رقم عملية', callback_data=f'admin_pm_proof_{context}_either_{suffix}')],
        [back_btn(back_target, '❌ إلغاء')],
    ])


def admin_payment_methods_kb(methods: list) -> InlineKeyboardMarkup:
    kb = []
    for index, method in enumerate(methods, start=1):
        method_id, name, _details, is_active = method[:4]
        stored_icon = method[5] if len(method) > 5 else ''
        icon = payment_method_icon(name, stored_icon)
        status = '🟢' if is_active else '🔴'
        clean_name = str(name or 'طريقة دفع')
        if len(clean_name) > 36:
            clean_name = clean_name[:33] + '...'
        kb.append([
            InlineKeyboardButton(
                text=f'{status} {index:02d} | {icon} {clean_name}',
                callback_data=f'admin_pm_{method_id}',
            )
        ])
    kb.append([InlineKeyboardButton(text='➕ إضافة طريقة دفع يدوية', callback_data='admin_add_payment_method')])
    kb.append([back_btn('admin_panel')])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def admin_payment_method_detail_kb(method_id: int, is_active: bool, provider: str = 'local') -> InlineKeyboardMarkup:
    toggle_text = '⏸ تعطيل' if is_active else '▶️ تفعيل'
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text='✏️ الاسم', callback_data=f'admin_pm_edit_name_{method_id}'),
            InlineKeyboardButton(text='📝 التعليمات', callback_data=f'admin_pm_edit_details_{method_id}'),
        ],
        [
            InlineKeyboardButton(text='🔢 بيانات التحويل', callback_data=f'admin_pm_edit_account_{method_id}'),
            InlineKeyboardButton(text='💵 العملة', callback_data=f'admin_pm_edit_currency_{method_id}'),
        ],
        [
            InlineKeyboardButton(text='📊 الحدود', callback_data=f'admin_pm_edit_limits_{method_id}'),
            InlineKeyboardButton(text='💱 التحويل والرسوم', callback_data=f'admin_pm_edit_conversion_{method_id}'),
        ],
        [InlineKeyboardButton(text='🧾 نوع الإثبات', callback_data=f'admin_pm_edit_proof_{method_id}')],
        [
            InlineKeyboardButton(text='🖼 إضافة/تغيير الباركود', callback_data=f'admin_pm_edit_image_{method_id}'),
            InlineKeyboardButton(text='🗑 حذف الصورة', callback_data=f'admin_pm_remove_image_{method_id}'),
        ],
        [
            InlineKeyboardButton(text='⬆️ للأعلى', callback_data=f'admin_pm_move_up_{method_id}'),
            InlineKeyboardButton(text='⬇️ للأسفل', callback_data=f'admin_pm_move_down_{method_id}'),
        ],
        [InlineKeyboardButton(text=toggle_text, callback_data=f'admin_pm_toggle_{method_id}')],
        [InlineKeyboardButton(text='🗑 حذف', callback_data=f'admin_pm_delete_{method_id}')],
        [back_btn('admin_payment_methods')],
    ])

def admin_deposit_requests_kb(requests: list, page: int = 0, per_page: int = 8) -> InlineKeyboardMarkup:
    kb = []
    start = page * per_page
    end = start + per_page
    page_reqs = requests[start:end]
    for r in page_reqs:
        status_emoji = {"pending": "⏳", "waiting_payment": "🟡", "approved": "✅", "rejected": "❌", "expired": "⌛", "cancelled": "🚫"}.get(r[7], "❓")
        kb.append([InlineKeyboardButton(
            text=f"{status_emoji} #{r[0]} - {r[2]} $ - {r[3]}",
            callback_data=f"admin_dep_{r[0]}"
        )])
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️", callback_data=f"admin_dep_p{page-1}"))
    if end < len(requests):
        nav.append(InlineKeyboardButton(text="▶️", callback_data=f"admin_dep_p{page+1}"))
    if nav:
        kb.append(nav)
    kb.append([back_btn("admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def admin_deposit_detail_kb(req_id: int, status: str) -> InlineKeyboardMarkup:
    kb = []
    if status == 'pending':
        kb.append([
            InlineKeyboardButton(text="✅ قبول وشحن الرصيد", callback_data=f"admin_dep_approve_{req_id}"),
            InlineKeyboardButton(text="❌ رفض", callback_data=f"admin_dep_reject_{req_id}")
        ])
    kb.append([back_btn("admin_deposit_requests")])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def deposit_payment_methods_kb(methods: list) -> InlineKeyboardMarkup:
    kb = []
    row = []
    for method in methods:
        method_id, name = method[0], method[1]
        stored_icon = method[3] if len(method) > 3 else ''
        icon = payment_method_icon(name, stored_icon)
        clean_name = str(name or 'طريقة دفع')
        if len(clean_name) > 20:
            clean_name = clean_name[:18] + '…'
        row.append(InlineKeyboardButton(text=f'{icon} {clean_name}', callback_data=f'dep_method_{method_id}'))
        if len(row) == 2:
            kb.append(row)
            row = []
    if row:
        kb.append(row)
    kb.append([back_btn('main_menu', '❌ إلغاء العملية')])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def payment_transfer_kb(
    method_id: int,
    transfer_value: str,
    back_callback: str = 'deposit_request',
    back_label: str = '🔙 تغيير طريقة الدفع',
    show_proof_button: bool = False,
) -> InlineKeyboardMarkup:
    """لوحة أزرار الدفع: إرسال الإثبات أولاً ثم نسخ رمز التحويل وحده."""
    rows = []
    if show_proof_button:
        rows.append([
            InlineKeyboardButton(
                text='📤 إرسال الإثبات الآن',
                callback_data='deposit_send_proof',
            )
        ])

    value = str(transfer_value or '').strip()
    if value:
        if CopyTextButton is not None and len(value) <= 256:
            rows.append([
                InlineKeyboardButton(
                    text='📋 نسخ الرمز فقط',
                    copy_text=CopyTextButton(text=value),
                )
            ])
        else:
            rows.append([
                InlineKeyboardButton(
                    text='📋 عرض الرمز للنسخ',
                    callback_data=f'payment_copy_{method_id}',
                )
            ])
    rows.append([back_btn(back_callback, back_label)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def favorites_kb(favorites: list) -> InlineKeyboardMarkup:
    kb = []
    for f in favorites:
        kb.append([
            InlineKeyboardButton(text=f"🛍 {f[2]}", callback_data=f"prod_{f[1]}"),
            InlineKeyboardButton(text="💔", callback_data=f"fav_remove_{f[1]}")
        ])
    kb.append([back_btn("main_menu")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


# =============================================================================
# معالجات المستخدم - القائمة الرئيسية
# =============================================================================

@dp.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    user = message.from_user
    await create_or_update_user(user.id, user.username, user.full_name)
    bot_status = await get_setting('bot_status', 'active')
    if bot_status == 'maintenance' and not await is_admin(user.id):
        await message.answer("🔧 البوت في وضع الصيانة حالياً. يرجى المحاولة لاحقاً.")
        return
    if await is_banned(user.id):
        await message.answer("🚫 تم حظرك من استخدام هذا البوت.")
        return
    is_admin_user = await is_admin(user.id)
    welcome_text = await get_setting('welcome_message', 'مرحباً بك!')
    await message.answer(welcome_text, reply_markup=main_menu_kb(is_admin_user))
    await log_activity(user.id, "start", "فتح البوت")

@dp.callback_query(F.data == "main_menu")
async def cb_main_menu(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    is_admin_user = await is_admin(callback.from_user.id)
    welcome_text = await get_setting('welcome_message', 'القائمة الرئيسية')
    await safe_edit_message(callback.message, welcome_text, main_menu_kb(is_admin_user))
    await callback.answer()

# =============================================================================
# مركز الدعم الفني
# =============================================================================

@dp.callback_query(F.data == "support")
async def cb_support(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await show_support_center(callback)

# =============================================================================
# معالجات المتجر - الأقسام والمنتجات
# =============================================================================

@dp.callback_query(F.data == "shop_categories")
async def cb_shop_categories(callback: CallbackQuery):
    if await is_banned(callback.from_user.id):
        await callback.answer("🚫 أنت محظور.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        # عرض الأقسام التي ليس لها أب (الأقسام الرئيسية)
        async with db.execute(
            """
            SELECT c.id, COALESCE(NULLIF(c.display_name, ''), c.name), c.is_active
            FROM categories c
            WHERE c.is_active = 1
              AND COALESCE(c.is_hidden, 0) = 0
              AND COALESCE(c.local_parent_id, c.parent_id, 0) = 0
              AND NOT (
                  COALESCE(c.api_provider, '') <> 'js4card'
                  AND EXISTS (
                      SELECT 1 FROM payment_methods pm
                      WHERE LOWER(TRIM(pm.name)) = LOWER(TRIM(c.name))
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM products p
                      WHERE p.category_id = c.id AND p.is_active = 1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM categories child
                      WHERE child.parent_id = c.id AND child.is_active = 1
                  )
              )
            ORDER BY COALESCE(c.local_sort_order, c.sort_order, 0), COALESCE(NULLIF(c.display_name, ''), c.name)
            """
        ) as cursor:
            categories = await cursor.fetchall()
    if not categories:
        await safe_edit_message(callback.message, "لا توجد أقسام متاحة حالياً.", back_to_main_kb())
        await callback.answer()
        return
    text = (
        "▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n"
        "📂 **الأقســــام الرئيسيــــة**\n"
        "▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n"
        "يرجى اختيار القسم المناسب لتصفح المنتجات المتاحة:"
    )
    await safe_edit_message(callback.message, text, categories_kb(categories))
    await callback.answer()

@dp.callback_query(F.data.startswith("cat_"))
async def cb_category_products(callback: CallbackQuery):
    data = callback.data
    parts = data.split("_")
    cat_id = int(parts[1])
    
    # التعامل مع الرجوع للأقسام الرئيسية
    if len(parts) == 3 and parts[2] == "back":
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT COALESCE(local_parent_id, parent_id, 0) FROM categories WHERE id = ?", (cat_id,)) as cursor:
                row = await cursor.fetchone()
            parent_id = row[0] if row else 0
            
            if parent_id == 0:
                return await cb_shop_categories(callback)
            else:
                # الرجوع للمستوى الأعلى
                cat_id = parent_id
    
    page = 0
    if len(parts) == 3 and parts[2].startswith("p"):
        page = int(parts[2][1:])
        
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COALESCE(NULLIF(display_name, ''), name), COALESCE(local_parent_id, parent_id, 0) FROM categories WHERE id = ?", (cat_id,)) as cursor:
            cat_row = await cursor.fetchone()
        if not cat_row:
            await callback.answer("القسم غير موجود.", show_alert=True)
            return
        cat_name, parent_id = cat_row
        
        # البحث عن أقسام فرعية
        async with db.execute(
            """
            SELECT c.id, COALESCE(NULLIF(c.display_name, ''), c.name), c.is_active
            FROM categories c
            WHERE COALESCE(c.local_parent_id, c.parent_id, 0) = ?
              AND c.is_active = 1
              AND COALESCE(c.is_hidden, 0) = 0
              AND NOT (
                  COALESCE(c.api_provider, '') <> 'js4card'
                  AND EXISTS (
                      SELECT 1 FROM payment_methods pm
                      WHERE LOWER(TRIM(pm.name)) = LOWER(TRIM(c.name))
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM products p
                      WHERE p.category_id = c.id AND p.is_active = 1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM categories child
                      WHERE child.parent_id = c.id AND child.is_active = 1
                  )
              )
            ORDER BY COALESCE(c.local_sort_order, c.sort_order, 0), COALESCE(NULLIF(c.display_name, ''), c.name)
            """,
            (cat_id,)
        ) as cursor:
            sub_categories = await cursor.fetchall()
            
        # البحث عن منتجات
        async with db.execute(
            "SELECT id, category_id, name, description, price, stock, is_active, created_at, product_type, delivery_info, delivery_time "
            "FROM products WHERE category_id = ? AND is_active = 1 AND stock > 0 ORDER BY name",
            (cat_id,)
        ) as cursor:
            products = await cursor.fetchall()
            
    # دمج عرض الأقسام الفرعية والمنتجات معاً إذا وُجدا
    kb = []
    
    # الأقسام الفرعية: زران في كل صف مثل الأقسام الرئيسية
    if sub_categories:
        sub_buttons = [
            InlineKeyboardButton(
                text=f"📁 {_short_button_text(sc[1], 25)}",
                callback_data=f"cat_{sc[0]}",
            )
            for sc in sub_categories
        ]
        kb.extend(_two_column_rows(sub_buttons))
    
    # المنتجات: منتجان في كل صف، والأخير وحده
    if products:
        start = page * 8
        end = start + 8
        page_products = products[start:end]
        product_buttons = []
        for product in page_products:
            type_icon = "🟢" if (len(product) > 8 and product[8] == 'stock') else "🔵"
            name = _short_button_text(product[2], 18)
            product_buttons.append(
                InlineKeyboardButton(
                    text=f"{type_icon} {name} • {_money(product[4])}$",
                    callback_data=f"prod_{product[0]}",
                )
            )
        kb.extend(_two_column_rows(product_buttons))
            
        # إضافة أزرار التنقل للمنتجات
        nav = []
        if page > 0:
            nav.append(InlineKeyboardButton(text="◀️ السابق", callback_data=f"cat_{cat_id}_p{page-1}"))
        if end < len(products):
            nav.append(InlineKeyboardButton(text="التالي ▶️", callback_data=f"cat_{cat_id}_p{page+1}"))
        if nav:
            kb.append(nav)

    # زر الرجوع الذكي
    back_cb = "shop_categories" if parent_id == 0 else f"cat_{parent_id}_back"
    kb.append([back_btn(back_cb, "🔙 رجوع")])
    
    if not kb or (len(kb) == 1 and not sub_categories and not products):
        await safe_edit_message(
            callback.message,
            f"📂 **{cat_name}**\n\nلا توجد محتويات في هذا القسم حالياً.",
            InlineKeyboardMarkup(inline_keyboard=[[back_btn(back_cb, "🔙 رجوع")]])
        )
    else:
        text = (
            f"▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n"
            f"📂 **قسم: {cat_name}**\n"
            f"▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n"
            f"تصفح الأقسام الفرعية والمنتجات المتاحة:"
        )
        await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb))
    
    await callback.answer()

@dp.callback_query(F.data.startswith("prod_"))
async def cb_product_detail(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[1])
    user_id = callback.from_user.id
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, category_id, name, description, price, stock, is_active, created_at, product_type, delivery_info, delivery_time, buy_button_1, buy_button_2, buy_button_3, api_id, api_provider "
            "FROM products WHERE id = ?", (prod_id,)
        ) as cursor:
            product = await cursor.fetchone()
        if not product:
            await callback.answer("المنتج غير موجود.", show_alert=True)
            return
        async with db.execute("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?", (user_id, prod_id)) as cursor:
            is_fav = await cursor.fetchone() is not None

    product_type = product[8] if len(product) > 8 else 'stock'
    delivery_time = product[10] if len(product) > 10 and product[10] else "فوري"
    stock_text = f"✅ متوفر ({product[5]} قطعة)" if product[5] > 0 else "❌ غير متوفر"
    custom_btns = [product[11], product[12], product[13]]
    api_id = product[14] if len(product) > 14 else 0
    api_provider = product[15] if len(product) > 15 else ''

    text = (
        f"🛍 **{product[2]}**\n\n"
        f"📝 {product[3]}\n\n"
        f"💰 السعر: **{product[4]} $**\n"
        f"📦 المخزون: {stock_text}\n"
        f"🕒 وقت التسليم: {delivery_time}"
    )
    
    # منتجات API: اختيار المنتج يبدأ مباشرة بجمع متطلباته من الموقع
    if api_id and api_id > 0 and api_provider == 'js4card':
        await start_api_purchase_flow(callback, state, api_id, prod_id)
        return

    await safe_edit_message(
        callback.message,
        text,
        product_detail_kb(prod_id, product[1], is_fav, product_type, custom_btns)
    )
    await callback.answer()

# =============================================================================
# معالجات الطلبات
# =============================================================================

async def show_local_purchase_confirmation(
    message: Message,
    state: FSMContext,
    product_id: int,
    *,
    custom_option: str = '',
    variant_id: int = 0,
    edit: bool = True,
):
    """جمع بيانات المنتج اليدوي ثم عرض ملخص نهائي قبل أي خصم."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, name, price, stock, product_type, delivery_info, is_active, "
            "COALESCE(api_id, 0) AS api_id, COALESCE(api_provider, '') AS api_provider "
            "FROM products WHERE id = ?",
            (product_id,),
        ) as cursor:
            product = await cursor.fetchone()
        variant = None
        if variant_id:
            async with db.execute(
                "SELECT id, product_id, variant_name, price, stock, api_product_id, api_provider, is_active "
                "FROM product_variants WHERE id = ? AND product_id = ?",
                (variant_id, product_id),
            ) as cursor:
                variant = await cursor.fetchone()

    if not product or int(product['is_active'] or 0) != 1:
        text = '❌ المنتج غير موجود أو غير متاح.'
        if edit:
            await safe_edit_message(message, text, back_to_main_kb())
        else:
            await message.answer(text, reply_markup=back_to_main_kb())
        return

    if variant_id and (not variant or int(variant['is_active'] or 0) != 1):
        text = '❌ الخيار غير موجود أو غير متاح.'
        if edit:
            await safe_edit_message(message, text, back_to_main_kb())
        else:
            await message.answer(text, reply_markup=back_to_main_kb())
        return

    price = round(float(variant['price'] if variant else product['price'] or 0), 2)
    stock = int(variant['stock'] if variant else product['stock'] or 0)
    if stock <= 0:
        text = '❌ نفد هذا المنتج أو الخيار من المخزون.'
        if edit:
            await safe_edit_message(message, text, back_to_main_kb())
        else:
            await message.answer(text, reply_markup=back_to_main_kb())
        return

    data = await state.get_data()
    purchase_token = str(data.get('order_purchase_token') or uuid.uuid4())
    delivery_info = clean_api_text(data.get('order_delivery_info'), 1000)
    product_type = str(product['product_type'] or 'stock')

    await state.update_data(
        order_product_id=product_id,
        order_quantity=1,
        order_purchase_token=purchase_token,
        order_expected_price=price,
        selected_variant_id=variant_id,
        custom_btn_text=custom_option,
        order_product_name=str(product['name']),
        order_product_type=product_type,
        order_delivery_hint=str(product['delivery_info'] or ''),
    )

    if product_type == 'manual' and not delivery_info:
        await state.update_data(order_stage='collect_before_confirm')
        await state.set_state(ProductOrderStates.waiting_delivery_info)
        hint = str(product['delivery_info'] or 'اسم المستخدم / رقم الهاتف / البريد الإلكتروني')
        prompt = (
            f"📝 **معلومات تنفيذ الطلب**\n\n"
            f"المنتج: {product['name']}\n"
            f"أرسل المعلومات المطلوبة قبل تأكيد الشراء:\n{hint}\n\n"
            f"لن يتم خصم أي مبلغ الآن."
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'prod_{product_id}', '❌ إلغاء')]])
        if edit:
            await safe_edit_message(message, prompt, kb)
        else:
            await message.answer(prompt, reply_markup=kb)
        return

    await state.update_data(order_stage='ready_to_confirm')
    await state.set_state(None)
    option_line = f"\nالخيار: {custom_option}" if custom_option else ''
    variant_line = f"\nالنوع: {variant['variant_name']}" if variant else ''
    delivery_line = f"\nبيانات التنفيذ: {delivery_info}" if delivery_info else ''
    summary = (
        f"✅ **راجع طلبك قبل التأكيد**\n\n"
        f"المنتج: {product['name']}"
        f"{variant_line}{option_line}{delivery_line}\n"
        f"الإجمالي: **{price:.2f} $**\n\n"
        f"لن يتم الخصم إلا بعد الضغط على تأكيد الطلب."
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text='✅ تأكيد الطلب', callback_data=f'order_place_{product_id}'),
            InlineKeyboardButton(text='❌ إلغاء', callback_data=f'prod_{product_id}'),
        ]
    ])
    if edit:
        await safe_edit_message(message, summary, kb)
    else:
        await message.answer(summary, reply_markup=kb)


@dp.callback_query(F.data.startswith("order_confirm_"))
async def cb_order_confirm(callback: CallbackQuery, state: FSMContext):
    """اختيار الخيار المناسب ثم جمع البيانات قبل التأكيد."""
    try:
        parts = callback.data.split('_')
        product_id = int(parts[2])
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT id, name, price, stock, buy_button_1, buy_button_2, buy_button_3 "
                "FROM products WHERE id = ? AND is_active = 1",
                (product_id,),
            ) as cursor:
                prod = await cursor.fetchone()
        if not prod:
            await callback.answer('المنتج غير موجود.', show_alert=True)
            return

        if len(parts) > 3:
            button_index = int(parts[3])
            custom_buttons = [prod[4], prod[5], prod[6]]
            if button_index < 1 or button_index > len(custom_buttons):
                await callback.answer('الخيار غير صحيح.', show_alert=True)
                return
            custom_option = clean_api_text(custom_buttons[button_index - 1], 150)
            await state.clear()
            await show_local_purchase_confirmation(
                callback.message, state, product_id,
                custom_option=custom_option, edit=True,
            )
            await callback.answer()
            return

        variants = await get_product_variants(DB_PATH, product_id)
        custom_buttons = [prod[4], prod[5], prod[6]]
        if any(button and str(button).strip() for button in custom_buttons):
            kb = []
            for index, button_text in enumerate(custom_buttons, start=1):
                if button_text and str(button_text).strip():
                    kb.append([
                        InlineKeyboardButton(
                            text=clean_api_text(button_text, 55),
                            callback_data=f'order_confirm_{product_id}_{index}',
                        )
                    ])
            kb.append([back_btn(f'prod_{product_id}', '🔙 رجوع')])
            await safe_edit_message(
                callback.message,
                f"🎯 **{prod[1]}**\n\nاختر الخيار المطلوب:",
                InlineKeyboardMarkup(inline_keyboard=kb),
            )
            await callback.answer()
            return

        if variants and len(variants) > 1:
            kb = []
            for variant in variants:
                if int(variant['stock'] or 0) > 0:
                    kb.append([
                        InlineKeyboardButton(
                            text=f"{clean_api_text(variant['name'], 35)} • {float(variant['price']):.2f}$",
                            callback_data=f"variant_select_{variant['id']}",
                        )
                    ])
            kb.append([back_btn(f'prod_{product_id}', '🔙 رجوع')])
            await safe_edit_message(
                callback.message,
                '🎯 **اختر الخيار المطلوب:**',
                InlineKeyboardMarkup(inline_keyboard=kb),
            )
            await callback.answer()
            return

        await state.clear()
        variant_id = int(variants[0]['id']) if variants and len(variants) == 1 else 0
        await show_local_purchase_confirmation(
            callback.message, state, product_id, variant_id=variant_id, edit=True,
        )
        await callback.answer()
    except Exception as exc:
        logger.error('Error in order confirm: %s', exc, exc_info=True)
        await callback.answer('حدث خطأ أثناء تجهيز الطلب.', show_alert=True)


@dp.callback_query(F.data.startswith("buy_custom_"))
async def cb_buy_custom(callback: CallbackQuery, state: FSMContext):
    try:
        parts = callback.data.split('_')
        product_id = int(parts[2])
        button_index = int(parts[3])
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT buy_button_1, buy_button_2, buy_button_3 FROM products WHERE id = ?",
                (product_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if not row or button_index < 1 or button_index > 3:
            await callback.answer('الخيار غير موجود.', show_alert=True)
            return
        option = clean_api_text(row[button_index - 1], 150)
        await state.clear()
        await show_local_purchase_confirmation(
            callback.message, state, product_id, custom_option=option, edit=True,
        )
        await callback.answer()
    except Exception as exc:
        logger.error('Custom purchase preparation error: %s', exc, exc_info=True)
        await callback.answer('تعذر تجهيز الطلب.', show_alert=True)


@dp.callback_query(F.data.startswith("order_place_"))
async def cb_order_place(callback: CallbackQuery, state: FSMContext):
    try:
        product_id = int(callback.data.split('_')[2])
        user_id = callback.from_user.id
        if await is_banned(user_id):
            await callback.answer('🚫 أنت محظور.', show_alert=True)
            return

        data = await state.get_data()
        if int(data.get('order_product_id', 0) or 0) not in (0, product_id):
            await callback.answer('انتهت بيانات الطلب. اختر المنتج من جديد.', show_alert=True)
            await state.clear()
            return

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT api_id, api_provider FROM products WHERE id = ? AND is_active = 1",
                (product_id,),
            ) as cursor:
                api_row = await cursor.fetchone()
        if not api_row:
            await callback.answer('المنتج غير موجود.', show_alert=True)
            return
        if int(api_row[0] or 0) > 0 and str(api_row[1] or '') == 'js4card':
            await start_api_purchase_flow(callback, state, int(api_row[0]), product_id)
            return

        purchase_token = str(data.get('order_purchase_token') or uuid.uuid4())
        expected_price = float(data.get('order_expected_price', 0) or 0)
        variant_id = int(data.get('selected_variant_id', 0) or 0)
        delivery_info = clean_api_text(data.get('order_delivery_info'), 1000)
        custom_option = clean_api_text(data.get('custom_btn_text'), 150)

        await callback.answer('جاري تنفيذ الطلب...')
        async with get_purchase_lock(user_id):
            result = await create_local_order_atomic(
                user_id=user_id,
                product_id=product_id,
                purchase_token=purchase_token,
                expected_price=expected_price,
                quantity=1,
                variant_id=variant_id,
                delivery_info=delivery_info,
                custom_option=custom_option,
            )

        status = result.get('status')
        if status == 'duplicate':
            order = result['order']
            await state.clear()
            await safe_edit_message(
                callback.message,
                f"ℹ️ **تم تنفيذ هذا الطلب سابقاً**\n\n"
                f"رقم الطلب: #{order['id']}\n"
                f"المبلغ: {float(order['total_price']):.2f} $\n"
                f"الحالة: {order['status']}\n\n"
                f"لم يتم خصم الرصيد مرة أخرى.",
                back_to_main_kb(),
            )
            return
        if status == 'price_changed':
            await state.update_data(order_expected_price=float(result['current_price']))
            await show_local_purchase_confirmation(
                callback.message, state, product_id,
                custom_option=custom_option, variant_id=variant_id, edit=True,
            )
            return
        error_messages = {
            'unavailable': 'المنتج أو الخيار لم يعد متاحاً.',
            'out_of_stock': 'نفد المخزون قبل تنفيذ الطلب.',
            'insufficient_balance': 'رصيدك غير كافٍ لإتمام الطلب.',
            'invalid_price': 'سعر المنتج غير صالح حالياً.',
            'api_product': 'سيتم نقلك إلى مسار شراء الموقع.',
        }
        if status != 'created':
            await safe_edit_message(
                callback.message,
                f"❌ {error_messages.get(status, 'تعذر تنفيذ الطلب.')}",
                back_to_main_kb(),
            )
            return

        order_id = int(result['order_id'])
        total_price = float(result['total_price'])
        product_name = str(result['product_name'])
        product_type = str(result['product_type'])
        variant_name = str(result.get('variant_name') or '')
        new_balance = await get_user_balance(user_id)
        await state.clear()

        text = (
            f"✅ **تم إنشاء طلبك بنجاح**\n\n"
            f"رقم الطلب: **#{order_id}**\n"
            f"المنتج: {product_name}\n"
        )
        if variant_name:
            text += f"الخيار: {variant_name}\n"
        if custom_option:
            text += f"التحديد: {custom_option}\n"
        text += (
            f"المبلغ المدفوع: {total_price:.2f} $\n"
            f"رصيدك المتبقي: {new_balance:.2f} $\n"
            f"الحالة: {'⏳ بانتظار التنفيذ اليدوي' if product_type == 'manual' else '⏳ قيد المعالجة'}"
        )
        await safe_edit_message(callback.message, text, back_to_main_kb())
        await log_activity(user_id, 'order_placed', f'طلب #{order_id} - {product_name}')

        admin_lines = [
            '🛒 طلب جديد',
            f'رقم الطلب: #{order_id}',
            f'المستخدم: {user_id}',
            f'المنتج: {product_name}',
            f'المبلغ: {total_price:.2f} $',
        ]
        if variant_name:
            admin_lines.append(f'الخيار: {variant_name}')
        if custom_option:
            admin_lines.append(f'التحديد: {custom_option}')
        if delivery_info:
            admin_lines.append(f'بيانات التنفيذ: {delivery_info}')
        await safe_send_message(ADMIN_ID, '\n'.join(admin_lines), parse_mode=None)
    except Exception as exc:
        logger.error('Local order execution error: %s', exc, exc_info=True)
        await safe_edit_message(
            callback.message,
            '❌ حدث خطأ أثناء تنفيذ الطلب. راجع طلباتك قبل المحاولة من جديد؛ النظام يمنع تكرار الخصم.',
            back_to_main_kb(),
        )


@dp.message(ProductOrderStates.waiting_delivery_info)
async def process_delivery_info(message: Message, state: FSMContext):
    data = await state.get_data()
    delivery_info = clean_api_text(message.text or message.caption, 1000)
    if not delivery_info:
        await message.answer('❌ أرسل معلومات التنفيذ كنص واضح.')
        return

    if data.get('order_stage') == 'collect_before_confirm':
        product_id = int(data.get('order_product_id', 0) or 0)
        if not product_id:
            await state.clear()
            await message.answer('انتهت بيانات الطلب. اختر المنتج من جديد.')
            return
        await state.update_data(order_delivery_info=delivery_info, order_stage='ready_to_confirm')
        await state.set_state(None)
        await show_local_purchase_confirmation(
            message,
            state,
            product_id,
            custom_option=clean_api_text(data.get('custom_btn_text'), 150),
            variant_id=int(data.get('selected_variant_id', 0) or 0),
            edit=False,
        )
        return

    # توافق مع أي طلب قديم كان يجمع المعلومات بعد إنشاء الطلب.
    order_id = int(data.get('order_id', 0) or 0)
    if order_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE orders SET delivery_info = ? WHERE id = ? AND user_id = ?",
                (delivery_info, order_id, message.from_user.id),
            )
            await db.commit()
        await state.clear()
        await message.answer(
            f"✅ تم حفظ معلومات الطلب #{order_id}. سيتم إشعارك عند تحديث حالته.",
            reply_markup=back_to_main_kb(),
        )
        await safe_send_message(
            ADMIN_ID,
            f"📋 معلومات تنفيذ الطلب #{order_id}\nالمستخدم: {message.from_user.id}\n{delivery_info}",
            parse_mode=None,
        )
        return

    await state.clear()
    await message.answer('انتهت بيانات الطلب. اختر المنتج من جديد.', reply_markup=back_to_main_kb())


@dp.callback_query(F.data == "my_orders")
async def cb_my_orders(callback: CallbackQuery):
    user_id = callback.from_user.id
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT o.id, o.user_id, o.product_id, o.quantity, o.total_price, o.status, o.order_date, p.name "
            "FROM orders o LEFT JOIN products p ON o.product_id = p.id "
            "WHERE o.user_id = ? ORDER BY o.order_date DESC",
            (user_id,)
        ) as cursor:
            orders = await cursor.fetchall()
    if not orders:
        await safe_edit_message(callback.message, "📦 لا توجد طلبات سابقة.", back_to_main_kb())
        await callback.answer()
        return
    await safe_edit_message(callback.message, f"📦 **طلباتك** ({len(orders)} طلب):", my_orders_kb(orders))
    await callback.answer()

@dp.callback_query(F.data.startswith("order_detail_"))
async def cb_order_detail(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[2])
    user_id = callback.from_user.id
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT o.id, o.user_id, o.product_id, o.quantity, o.total_price, o.status, o.order_date, p.name, o.delivery_info, "
            "COALESCE(o.api_status, ''), COALESCE(o.api_status_message, ''), COALESCE(o.api_status_updated_at, '') "
            "FROM orders o LEFT JOIN products p ON o.product_id = p.id "
            "WHERE o.id = ? AND o.user_id = ?",
            (order_id, user_id)
        ) as cursor:
            order = await cursor.fetchone()
    if not order:
        await callback.answer("الطلب غير موجود.", show_alert=True)
        return
    status_map = {"pending": "⏳ قيد الانتظار", "processing": "🔄 قيد المعالجة", "completed": "✅ مكتمل", "cancelled": "❌ ملغي"}
    status_text = status_map.get(order[5], order[5])
    text = (
        f"📦 **تفاصيل الطلب #{order[0]}**\n\n"
        f"المنتج: {order[7] or 'غير معروف'}\n"
        f"الكمية: {order[3]}\n"
        f"المبلغ: {order[4]} $\n"
        f"الحالة: {status_text}\n"
        f"التاريخ: {order[6]}"
    )
    if order[9]:
        api_info = classify_api_order_status(order[9])
        text += f"\nحالة الموقع: {api_info['label']}"
        if order[11]:
            text += f"\nآخر تحديث: {order[11]}"
    if order[10]:
        text += f"\nملاحظة الموقع: {order[10]}"
    if order[8]:  # delivery_info
        text += f"\n\n📋 **معلومات الطلب:**\n{order[8]}"
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=[[back_btn("my_orders", "🔙 طلباتي")]]))
    await callback.answer()


# =============================================================================
# معالجات الرصيد
# =============================================================================

@dp.callback_query(F.data == "my_balance")
async def cb_my_balance(callback: CallbackQuery):
    user_id = callback.from_user.id
    balance = await get_user_balance(user_id)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT amount, type, reason, date FROM balance_logs WHERE user_id = ? ORDER BY date DESC LIMIT 5",
            (user_id,)
        ) as cursor:
            logs = await cursor.fetchall()
        async with db.execute("SELECT store_user_id FROM users WHERE user_id = ?", (user_id,)) as cursor:
            u_row = await cursor.fetchone()
    store_id = (u_row[0] if u_row and u_row[0] else f'USR{user_id:06d}')
    log_text = ""
    if logs:
        log_text = "\n\n📋 **آخر المعاملات:**\n"
        for log in logs:
            sign = "+" if log[1] == "add" else "-"
            log_text += f"• {sign}{log[0]} $ - {log[2]} ({log[3][:10]})\n"
    text = (
        f"💰 **رصيدك الحالي:**\n\n"
        f"🆔 معرفك في المتجر: `{store_id}`\n"
        f"💵 الرصيد: **{balance:.2f} $**{log_text}"
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 شحن الرصيد", callback_data="deposit_request")],
        [back_btn("main_menu")]
    ])
    await safe_edit_message(callback.message, text, kb)
    await callback.answer()

# =============================================================================
# نظام شحن الرصيد مع التحقق بصورة أو نص
# =============================================================================

@dp.callback_query(F.data == 'deposit_request')
async def cb_deposit_request(callback: CallbackQuery, state: FSMContext):
    if await is_banned(callback.from_user.id):
        await callback.answer('🚫 أنت محظور.', show_alert=True)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, name, details, icon, min_amount, max_amount, currency,
                   transfer_label, transfer_value, credit_rate, fixed_fee,
                   fee_percent, proof_required, proof_mode, payment_mode, image_file_id,
                   auto_provider, auto_config
            FROM payment_methods
            WHERE is_active = 1
            ORDER BY sort_order ASC, name COLLATE NOCASE ASC
            """
        ) as cursor:
            methods = await cursor.fetchall()

    if not methods:
        await safe_edit_message(
            callback.message,
            '❌ لا توجد طرق دفع متاحة حالياً. يرجى التواصل مع الدعم.',
            back_to_main_kb(),
        )
        await callback.answer()
        return

    await state.clear()
    await state.set_state(DepositRequestStates.waiting_payment_method)
    text = (
        '💳 <b>شحن رصيد الحساب</b>\n'
        '━━━━━━━━━━━━━━━━\n\n'
        'اختر طريقة الدفع المناسبة. بعد الاختيار ستظهر بيانات التحويل '
        'والحد الأدنى قبل إدخال المبلغ.\n\n'
        f'📌 الطرق المتاحة: <b>{len(methods)}</b>'
    )
    await safe_edit_message(
        callback.message,
        text,
        deposit_payment_methods_kb(methods),
        parse_mode='HTML',
    )
    await callback.answer()


@dp.callback_query(F.data.startswith('dep_method_'), DepositRequestStates.waiting_payment_method)
async def process_deposit_method(callback: CallbackQuery, state: FSMContext):
    try:
        method_id = int(callback.data.split('_')[2])
    except (IndexError, ValueError):
        await callback.answer('طريقة الدفع غير صالحة.', show_alert=True)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, name, details, icon, min_amount, max_amount, currency,
                   transfer_label, transfer_value, credit_rate, fixed_fee,
                   fee_percent, proof_required, proof_mode, payment_mode, image_file_id,
                   auto_provider, auto_config
            FROM payment_methods
            WHERE id = ? AND is_active = 1
            """,
            (method_id,),
        ) as cursor:
            method = await cursor.fetchone()

    if not method:
        await callback.answer('طريقة الدفع غير متاحة حالياً.', show_alert=True)
        return

    method_name = method[1]
    method_icon = method[3] or payment_method_icon(method_name)
    currency = method[6] or 'USD'
    transfer_label = method[7] or 'بيانات التحويل'
    transfer_value = method[8] or ''
    if not str(transfer_value).strip():
        await callback.answer('هذه الطريقة غير مكتملة الإعداد حالياً. تواصل مع الإدارة.', show_alert=True)
        return
    credit_rate = float(method[9] or 1)
    if credit_rate <= 0:
        credit_rate = 1.0

    await state.update_data(
        payment_method_id=method[0],
        payment_method_name=method_name,
        payment_method_details=method[2] or '',
        payment_method_icon=method_icon,
        payment_method_min=float(method[4] or 0),
        payment_method_max=float(method[5] or 0),
        payment_method_currency=currency,
        payment_transfer_label=transfer_label,
        payment_transfer_value=transfer_value,
        payment_credit_rate=credit_rate,
        payment_fixed_fee=float(method[10] or 0),
        payment_fee_percent=float(method[11] or 0),
        payment_proof_required=bool(method[12]),
        payment_proof_mode=str(method[13] or 'either'),
        payment_mode=str(method[14] or 'manual'),
        payment_method_image_file_id=str(method[15] or ''),
        payment_auto_provider=str(method[16] or ''),
        payment_auto_config=str(method[17] or '{}'),
    )
    await state.set_state(DepositRequestStates.waiting_amount)

    limit_lines = []
    if float(method[4] or 0) > 0:
        limit_lines.append(f'📉 الحد الأدنى: <b>{_money(method[4])} {html.escape(currency)}</b>')
    if float(method[5] or 0) > 0:
        limit_lines.append(f'📈 الحد الأعلى: <b>{_money(method[5])} {html.escape(currency)}</b>')
    if not limit_lines:
        limit_lines.append('📊 لا توجد حدود خاصة مسجلة لهذه الطريقة.')

    account_line = (
        f'🔢 <b>{html.escape(transfer_label)}:</b>\n'
        f'<code>{html.escape(transfer_value)}</code>\n\n'
        if transfer_value else
        '⚠️ لم تُحفظ بيانات التحويل لهذه الطريقة بعد؛ راجع التعليمات أو تواصل مع الإدارة.\n\n'
    )
    details = (method[2] or '').strip()
    details_block = f'📝 <b>التعليمات:</b>\n{html.escape(details)}\n\n' if details else ''

    text = (
        f"{html.escape(method_icon)} <b>{html.escape(method_name)}</b>\n"
        '━━━━━━━━━━━━━━━━\n\n'
        + account_line
        + '\n'.join(limit_lines)
        + '\n\n'
        + details_block
        + f'💵 أرسل الآن المبلغ الذي ستقوم بتحويله بعملة <b>{html.escape(currency)}</b>.\n'
          'مثال: <code>10</code>'
    )
    # لا نرسل الباركود هنا كرسالة منفصلة. سيظهر لاحقاً مرفقاً بنفس
    # رسالة ملخص التحويل بعد أن يكتب الزبون المبلغ.
    await safe_edit_message(
        callback.message,
        text,
        payment_transfer_kb(method_id, transfer_value),
        parse_mode='HTML',
    )
    await callback.answer()


@dp.callback_query(F.data.startswith('payment_copy_'))
async def cb_payment_copy_fallback(callback: CallbackQuery):
    """خيار احتياطي للإصدارات القديمة: يرسل الرمز وحده في رسالة قابلة للنسخ."""
    try:
        method_id = int(callback.data.split('_')[2])
    except (IndexError, ValueError):
        await callback.answer('تعذر قراءة طريقة الدفع.', show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            'SELECT transfer_value FROM payment_methods WHERE id = ? AND is_active = 1',
            (method_id,),
        ) as cursor:
            row = await cursor.fetchone()
    value = str(row[0] if row else '').strip()
    if not value:
        await callback.answer('رمز التحويل غير متوفر.', show_alert=True)
        return
    await callback.message.answer(
        f'<code>{html.escape(value)}</code>',
        parse_mode='HTML',
    )
    await callback.answer('اضغط مطولاً على الرمز لنسخه.')


@dp.callback_query(F.data == 'deposit_send_proof', DepositRequestStates.waiting_proof)
async def cb_deposit_send_proof(callback: CallbackQuery):
    """زر إرشادي يبقي ملخص الدفع والباركود في رسالة واحدة."""
    await callback.answer(
        'أرسل الآن صورة الإيصال أو رقم العملية في المحادثة حسب التعليمات الظاهرة.',
        show_alert=True,
    )


@dp.message(DepositRequestStates.waiting_amount)
async def process_deposit_amount(message: Message, state: FSMContext):
    data = await state.get_data()
    method_id = data.get('payment_method_id')
    if not method_id:
        await state.clear()
        await message.answer('انتهت جلسة الشحن. ابدأ العملية من جديد.', reply_markup=back_to_main_kb())
        return

    try:
        raw_amount = (message.text or '').strip().replace(',', '.')
        paid_amount = float(raw_amount)
        if not math.isfinite(paid_amount) or paid_amount <= 0:
            raise ValueError
    except (TypeError, ValueError):
        await message.answer('❌ أرسل المبلغ كرقم أكبر من صفر، مثال: 10')
        return

    global_min = float(await get_setting('min_balance_add', '1'))
    global_max = float(await get_setting('max_balance_add', '10000'))
    method_min = float(data.get('payment_method_min') or 0)
    method_max = float(data.get('payment_method_max') or 0)
    effective_min = max(global_min, method_min) if method_min > 0 else global_min
    effective_max = min(global_max, method_max) if method_max > 0 else global_max

    if paid_amount < effective_min or paid_amount > effective_max:
        currency = str(data.get('payment_method_currency') or 'USD')
        await message.answer(
            f'❌ المبلغ المسموح لهذه الطريقة بين {_money(effective_min)} و '
            f'{_money(effective_max)} {currency}.'
        )
        return

    credit_rate = max(float(data.get('payment_credit_rate') or 1), 0)
    fixed_fee = max(float(data.get('payment_fixed_fee') or 0), 0)
    fee_percent = min(max(float(data.get('payment_fee_percent') or 0), 0), 100)
    credited_amount = (paid_amount * credit_rate) - fixed_fee - (paid_amount * fee_percent / 100)
    credited_amount = round(max(credited_amount, 0), 2)
    if credited_amount <= 0:
        await message.answer('❌ قيمة الرصيد الناتجة صفر. تواصل مع الإدارة لمراجعة إعدادات الطريقة.')
        return

    if (
        str(data.get('payment_mode') or 'manual').lower() == 'auto'
        and str(data.get('payment_auto_provider') or '').lower() == 'binance_deposit'
    ):
        await create_binance_deposit_request(
            message, state, data, paid_amount, credited_amount
        )
        return

    await state.update_data(
        deposit_paid_amount=round(paid_amount, 2),
        deposit_amount=credited_amount,
    )
    await state.set_state(DepositRequestStates.waiting_proof)

    method_name = str(data.get('payment_method_name') or '')
    method_details = str(data.get('payment_method_details') or '').strip()
    icon = str(data.get('payment_method_icon') or payment_method_icon(method_name))
    currency = str(data.get('payment_method_currency') or 'USD')
    transfer_label = str(data.get('payment_transfer_label') or 'بيانات التحويل')
    transfer_value = str(data.get('payment_transfer_value') or '').strip()
    proof_mode = str(data.get('payment_proof_mode') or 'either')

    # إبقاء النص ضمن حد وصف الصورة في تيليجرام، مع عرض المعلومات المهمة
    # والباركود والملخص في رسالة واحدة فقط.
    if len(method_details) > 320:
        method_details = method_details[:317].rstrip() + '...'
    details_html = html.escape(method_details) if method_details else 'لا توجد تعليمات إضافية.'
    transfer_html = (
        f'🔢 <b>{html.escape(transfer_label)}:</b>\n'
        f'<code>{html.escape(transfer_value)}</code>\n'
        if transfer_value else ''
    )
    if proof_mode == 'photo':
        proof_instruction = 'أرسل <b>صورة إيصال الدفع</b> بعد إتمام التحويل.'
    elif proof_mode == 'transaction':
        proof_instruction = 'أرسل <b>رقم العملية</b> كنص بعد إتمام التحويل.'
    else:
        proof_instruction = 'أرسل <b>صورة الإيصال أو رقم العملية</b> بعد إتمام التحويل.'

    text = (
        '🧾 <b>ملخص التحويل</b>\n'
        '━━━━━━━━━━━━━━━━\n\n'
        f'{html.escape(icon)} الطريقة: <b>{html.escape(method_name)}</b>\n'
        + transfer_html
        + f'💵 المبلغ المطلوب: <b>{_money(paid_amount)} {html.escape(currency)}</b>\n'
        + f'💰 الرصيد الذي سيصل: <b>{_money(credited_amount)} USD</b>\n\n'
        + f'📌 <b>التعليمات:</b>\n{details_html}\n\n'
        + f'📤 <b>إرسال الإثبات:</b>\n{proof_instruction}\n\n'
        + '⚠️ لن يُضاف الرصيد إلا بعد مراجعة الإدارة.'
    )
    summary_kb = payment_transfer_kb(
        int(method_id),
        transfer_value,
        back_callback='deposit_request',
        back_label='❌ إلغاء والعودة',
        show_proof_button=True,
    )

    image_file_id = str(data.get('payment_method_image_file_id') or '').strip()
    if image_file_id:
        try:
            await message.answer_photo(
                photo=image_file_id,
                caption=text,
                parse_mode='HTML',
                reply_markup=summary_kb,
            )
            return
        except Exception as exc:
            logger.warning(
                'تعذر إرسال باركود طريقة الدفع %s مع الملخص، سيتم إرسال النص فقط: %s',
                method_id,
                exc,
            )

    await message.answer(
        text,
        parse_mode='HTML',
        reply_markup=summary_kb,
    )


@dp.message(DepositRequestStates.waiting_proof)
async def process_deposit_proof(message: Message, state: FSMContext):
    data = await state.get_data()
    credited_amount = float(data.get('deposit_amount') or 0)
    paid_amount = float(data.get('deposit_paid_amount') or credited_amount)
    method_id = int(data.get('payment_method_id') or 0)
    method_name = str(data.get('payment_method_name') or '')
    currency = str(data.get('payment_method_currency') or 'USD')
    proof_mode = str(data.get('payment_proof_mode') or 'either')
    user_id = message.from_user.id

    proof_type = ''
    proof_content = ''
    proof_file_id = ''
    transaction_reference = ''

    if message.photo:
        if proof_mode == 'transaction':
            await message.answer('❌ هذه الطريقة تتطلب رقم العملية كنص، وليس صورة.')
            return
        proof_type = 'photo'
        proof_file_id = message.photo[-1].file_id
        proof_content = (message.caption or 'صورة إيصال').strip()
    elif message.text:
        if proof_mode == 'photo':
            await message.answer('❌ هذه الطريقة تتطلب صورة واضحة لإيصال الدفع.')
            return
        proof_type = 'text'
        proof_content = message.text.strip()
        transaction_reference = re.sub(r'\s+', '', proof_content).upper()
        if len(transaction_reference) < 4 or len(transaction_reference) > 120:
            await message.answer('❌ أرسل رقم عملية صحيحاً وواضحاً.')
            return
    else:
        expected = _payment_proof_label(proof_mode)
        await message.answer(f'❌ المطلوب: {expected}.')
        return

    if not proof_content and not proof_file_id:
        await message.answer('❌ الإثبات فارغ، أعد إرساله.')
        return

    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    snapshot = {
        'method_id': method_id,
        'name': method_name,
        'currency': currency,
        'transfer_label': data.get('payment_transfer_label', ''),
        'transfer_value': data.get('payment_transfer_value', ''),
        'credit_rate': data.get('payment_credit_rate', 1),
        'fixed_fee': data.get('payment_fixed_fee', 0),
        'fee_percent': data.get('payment_fee_percent', 0),
        'proof_mode': proof_mode,
        'payment_mode': data.get('payment_mode', 'manual'),
    }

    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute('BEGIN IMMEDIATE')
            if transaction_reference:
                async with db.execute(
                    'SELECT id FROM deposit_requests WHERE transaction_reference = ? LIMIT 1',
                    (transaction_reference,),
                ) as cursor:
                    duplicate = await cursor.fetchone()
                if duplicate:
                    await db.rollback()
                    await message.answer(
                        '❌ رقم العملية مستخدم في طلب سابق.\n'
                        'راجع الرقم، أو أرسل صورة الإيصال إذا كانت الطريقة تسمح بذلك.'
                    )
                    return
            cursor = await db.execute(
                """
                INSERT INTO deposit_requests
                (user_id, amount, payment_method, proof_type, proof_content,
                 proof_file_id, status, created_at, payment_method_id, paid_amount,
                 credited_amount, payment_snapshot, transaction_reference)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id, credited_amount, method_name, proof_type, proof_content,
                    proof_file_id, now, method_id, paid_amount, credited_amount,
                    json.dumps(snapshot, ensure_ascii=False), transaction_reference,
                ),
            )
            req_id = int(cursor.lastrowid)
            await db.commit()
    except aiosqlite.IntegrityError:
        await message.answer('❌ رقم العملية مستخدم مسبقاً. لا يمكن استخدام العملية نفسها أكثر من مرة.')
        return

    await state.clear()
    proof_label = 'صورة 📷' if proof_type == 'photo' else 'رقم عملية 🔢'
    reference_line = f'\nرقم العملية: <code>{html.escape(proof_content)}</code>' if proof_type == 'text' else ''
    await message.answer(
        '✅ <b>تم إرسال طلب الشحن بنجاح</b>\n\n'
        f'رقم الطلب: <b>#{req_id}</b>\n'
        f'المبلغ المحوّل: <b>{_money(paid_amount)} {html.escape(currency)}</b>\n'
        f'الرصيد المنتظر: <b>{_money(credited_amount)} USD</b>\n'
        f'طريقة الدفع: <b>{html.escape(method_name)}</b>\n'
        f'الإثبات: <b>{proof_label}</b>'
        f'{reference_line}\n\n'
        'سيتم إشعارك بعد مراجعة الإدارة.',
        parse_mode='HTML',
        reply_markup=back_to_main_kb(),
    )
    await log_activity(user_id, 'deposit_request', f'طلب شحن #{req_id} - محول {paid_amount} {currency} - رصيد {credited_amount} USD')

    user = message.from_user
    admin_text = (
        '💳 <b>طلب شحن رصيد جديد</b>\n\n'
        f'رقم الطلب: <b>#{req_id}</b>\n'
        f'المستخدم: <b>{html.escape(user.full_name)}</b> (<code>{user_id}</code>)\n'
        f'اسم المستخدم: @{html.escape(user.username or "بدون_يوزر")}\n'
        f'المبلغ المحوّل: <b>{_money(paid_amount)} {html.escape(currency)}</b>\n'
        f'الرصيد المطلوب إضافته: <b>{_money(credited_amount)} USD</b>\n'
        f'طريقة الدفع: <b>{html.escape(method_name)}</b>\n'
        f'الإثبات: <b>{proof_label}</b>'
    )
    if proof_type == 'text':
        admin_text += f'\nرقم العملية: <code>{html.escape(proof_content)}</code>'
    admin_kb = admin_deposit_detail_kb(req_id, 'pending')
    if proof_type == 'photo':
        try:
            await bot.send_photo(
                ADMIN_ID,
                photo=proof_file_id,
                caption=admin_text + f'\n\nالتعليق: {html.escape(proof_content)}',
                parse_mode='HTML',
                reply_markup=admin_kb,
            )
        except Exception:
            await safe_send_message(
                ADMIN_ID,
                admin_text + '\n\n[تعذر عرض الصورة، افتح الطلب من لوحة الإدارة]',
                reply_markup=admin_kb,
                parse_mode='HTML',
            )
    else:
        await safe_send_message(ADMIN_ID, admin_text, reply_markup=admin_kb, parse_mode='HTML')


# =============================================================================
# معالجات المفضلة
# =============================================================================

@dp.callback_query(F.data == "my_favorites")
async def cb_my_favorites(callback: CallbackQuery):
    user_id = callback.from_user.id
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT f.id, f.product_id, p.name, p.price FROM favorites f "
            "JOIN products p ON f.product_id = p.id WHERE f.user_id = ? ORDER BY f.added_at DESC",
            (user_id,)
        ) as cursor:
            favorites = await cursor.fetchall()
    if not favorites:
        await safe_edit_message(callback.message, "❤️ قائمة المفضلة فارغة.\nأضف منتجات من المتجر!", back_to_main_kb())
        await callback.answer()
        return
    await safe_edit_message(callback.message, f"❤️ **المفضلة** ({len(favorites)} منتج):", favorites_kb(favorites))
    await callback.answer()

@dp.callback_query(F.data.startswith("fav_add_"))
async def cb_fav_add(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    user_id = callback.from_user.id
    async with aiosqlite.connect(DB_PATH) as db:
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            await db.execute("INSERT INTO favorites (user_id, product_id, added_at) VALUES (?, ?, ?)", (user_id, prod_id, now))
            await db.commit()
            await callback.answer("❤️ تمت الإضافة للمفضلة!", show_alert=False)
        except Exception:
            await callback.answer("المنتج موجود بالفعل في المفضلة.", show_alert=True)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT category_id FROM products WHERE id = ?", (prod_id,)) as cursor:
            row = await cursor.fetchone()
    cat_id = row[0] if row else 0
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?", (user_id, prod_id)) as cursor:
            is_fav = await cursor.fetchone() is not None
        async with db.execute("SELECT product_type FROM products WHERE id = ?", (prod_id,)) as cursor:
            pt = await cursor.fetchone()
    product_type = pt[0] if pt else 'stock'
    try:
        await callback.message.edit_reply_markup(reply_markup=product_detail_kb(prod_id, cat_id, is_fav, product_type))
    except TelegramBadRequest:
        pass

@dp.callback_query(F.data.startswith("fav_remove_"))
async def cb_fav_remove(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    user_id = callback.from_user.id
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM favorites WHERE user_id = ? AND product_id = ?", (user_id, prod_id))
        await db.commit()
    await callback.answer("💔 تمت الإزالة من المفضلة.", show_alert=False)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT f.id, f.product_id, p.name, p.price FROM favorites f JOIN products p ON f.product_id = p.id WHERE f.user_id = ? ORDER BY f.added_at DESC", (user_id,)) as cursor:
            favorites = await cursor.fetchall()
    if favorites:
        try:
            await callback.message.edit_reply_markup(reply_markup=favorites_kb(favorites))
        except TelegramBadRequest:
            pass
    else:
        await safe_edit_message(callback.message, "❤️ قائمة المفضلة فارغة.", back_to_main_kb())


# =============================================================================
# معالجات الإدارة - لوحة التحكم
# =============================================================================

@dp.callback_query(F.data == "admin_panel")
async def cb_admin_panel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    perms = await get_admin_perms(callback.from_user.id)
    await safe_edit_message(
        callback.message,
        f"⚙️ **لوحة الإدارة**\n\nالدور: **{admin_role_label(perms.get('role_name', 'custom'))}**\nاختر القسم:",
        admin_panel_kb(perms, await is_super_admin(callback.from_user.id)),
    )
    await callback.answer()

# =============================================================================
# إدارة طرق الدفع اليدوية من الأدمن
# =============================================================================

async def _load_admin_payment_methods() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, name, details, is_active, provider, icon, sort_order, last_synced,
                   min_amount, transfer_value, payment_mode, proof_mode
            FROM payment_methods
            ORDER BY is_active DESC, sort_order ASC, name COLLATE NOCASE ASC
            """
        ) as cursor:
            return await cursor.fetchall()


@dp.callback_query(F.data == 'admin_payment_methods')
async def cb_admin_payment_methods(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return

    methods = await _load_admin_payment_methods()
    active_count = sum(1 for method in methods if method[3])
    manual_count = sum(1 for method in methods if (method[10] or 'manual') == 'manual')
    text = (
        '💳 <b>إدارة طرق الدفع</b>\n'
        '━━━━━━━━━━━━━━━━\n\n'
        f'🟢 المفعلة: <b>{active_count}</b>\n'
        f'📋 الإجمالي: <b>{len(methods)}</b>\n'
        f'✍️ يدوية: <b>{manual_count}</b>\n\n'
        'تُدار طرق الدفع يدوياً حالياً. يمكنك تحديد بيانات التحويل، العملة، '
        'الحدود، الرسوم، ونوع الإثبات لكل طريقة.\n\n'
        'تم تجهيز قاعدة النظام لإضافة Binance وشام كاش التلقائيين لاحقاً.'
    )
    await safe_edit_message(callback.message, text, admin_payment_methods_kb(methods), parse_mode='HTML')
    await callback.answer()


@dp.callback_query(F.data == 'admin_add_payment_method')
async def cb_admin_add_payment_method(callback: CallbackQuery, state: FSMContext):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer('⛔ للمدير الأساسي فقط.', show_alert=True)
        return
    await state.clear()
    await state.update_data(payment_wizard='create')
    await state.set_state(AdminPaymentMethodStates.waiting_method_name)
    await safe_edit_message(
        callback.message,
        '➕ <b>إضافة طريقة دفع يدوية</b>\n\n'
        'الخطوة 1 من 8\nأرسل اسم الطريقة، مثال: <code>Sham Cash</code>',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn('admin_payment_methods', '❌ إلغاء')]]),
        parse_mode='HTML',
    )
    await callback.answer()


@dp.message(AdminPaymentMethodStates.waiting_method_name)
async def process_payment_method_name(message: Message, state: FSMContext):
    name = (message.text or '').strip()
    if len(name) < 2 or len(name) > 80:
        await message.answer('أرسل اسماً واضحاً بين 2 و80 حرفاً.')
        return
    data = await state.get_data()
    method_id = data.get('editing_method_id')
    if method_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                'UPDATE payment_methods SET name = ?, icon = ?, is_manually_edited = 1 WHERE id = ?',
                (name, payment_method_icon(name), method_id),
            )
            await db.commit()
        await state.clear()
        await message.answer('✅ تم تعديل الاسم.', reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_pm_{method_id}')]]))
        return

    await state.update_data(method_name=name)
    await state.set_state(AdminPaymentMethodStates.waiting_method_account)
    await message.answer(
        'الخطوة 2 من 8\n\nأرسل اسم بيانات التحويل ثم القيمة بهذا الشكل:\n'
        '<code>معرّف Binance | 1120006944</code>\n\n'
        'مثال آخر:\n<code>رقم شام كاش | 09xxxxxxxx</code>',
        parse_mode='HTML',
    )


@dp.message(AdminPaymentMethodStates.waiting_method_account)
async def process_payment_method_account(message: Message, state: FSMContext):
    raw = (message.text or '').strip()
    if not raw:
        await message.answer('أرسل بيانات التحويل.')
        return
    if '|' in raw:
        label, value = (part.strip() for part in raw.split('|', 1))
    else:
        label, value = 'بيانات التحويل', raw
    if not value:
        await message.answer('قيمة التحويل فارغة.')
        return
    label = (label or 'بيانات التحويل')[:120]
    value = value[:1000]
    data = await state.get_data()
    method_id = data.get('editing_method_id')
    if method_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                'UPDATE payment_methods SET transfer_label = ?, transfer_value = ?, is_manually_edited = 1 WHERE id = ?',
                (label, value, method_id),
            )
            await db.commit()
        await state.clear()
        await message.answer('✅ تم تحديث بيانات التحويل.', reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_pm_{method_id}')]]))
        return

    await state.update_data(method_transfer_label=label, method_transfer_value=value)
    await state.set_state(AdminPaymentMethodStates.waiting_method_currency)
    await message.answer(
        'الخطوة 3 من 8\n\nأرسل رمز العملة التي سيدفع بها الزبون، مثال:\n'
        '<code>USD</code> أو <code>USDT</code> أو <code>SYP</code>',
        parse_mode='HTML',
    )


@dp.message(AdminPaymentMethodStates.waiting_method_currency)
async def process_payment_method_currency(message: Message, state: FSMContext):
    currency = re.sub(r'[^A-Za-z0-9_-]', '', (message.text or '').strip().upper())
    if not 2 <= len(currency) <= 12:
        await message.answer('أرسل رمز عملة صحيحاً، مثل USD أو USDT أو SYP.')
        return
    data = await state.get_data()
    method_id = data.get('editing_method_id')
    if method_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute('UPDATE payment_methods SET currency = ?, is_manually_edited = 1 WHERE id = ?', (currency, method_id))
            await db.commit()
        await state.clear()
        await message.answer('✅ تم تحديث العملة.', reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_pm_{method_id}')]]))
        return

    await state.update_data(method_currency=currency)
    await state.set_state(AdminPaymentMethodStates.waiting_method_limits)
    await message.answer(
        'الخطوة 4 من 8\n\nأرسل الحد الأدنى والحد الأعلى بهذا الشكل:\n'
        '<code>1 | 1000</code>\n\nأرسل <code>1 | 0</code> لجعل الحد الأعلى غير محدود.',
        parse_mode='HTML',
    )


@dp.message(AdminPaymentMethodStates.waiting_method_limits)
async def process_payment_method_limits(message: Message, state: FSMContext):
    parts = [part.strip().replace(',', '.') for part in (message.text or '').split('|')]
    if len(parts) != 2:
        await message.answer('استخدم الصيغة: الحد الأدنى | الحد الأعلى')
        return
    try:
        min_amount, max_amount = map(float, parts)
        if not all(math.isfinite(v) for v in (min_amount, max_amount)):
            raise ValueError
        if min_amount < 0 or max_amount < 0 or (max_amount > 0 and max_amount < min_amount):
            raise ValueError
    except (TypeError, ValueError):
        await message.answer('القيم غير صحيحة. الحد الأعلى يجب أن يكون صفراً أو أكبر من الحد الأدنى.')
        return
    data = await state.get_data()
    method_id = data.get('editing_method_id')
    if method_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                'UPDATE payment_methods SET min_amount = ?, max_amount = ?, is_manually_edited = 1 WHERE id = ?',
                (min_amount, max_amount, method_id),
            )
            await db.commit()
        await state.clear()
        await message.answer('✅ تم تحديث الحدود.', reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_pm_{method_id}')]]))
        return

    await state.update_data(method_min_amount=min_amount, method_max_amount=max_amount)
    await state.set_state(AdminPaymentMethodStates.waiting_method_conversion)
    await message.answer(
        'الخطوة 5 من 8\n\nأرسل:\nمعدل إضافة الرصيد | رسم ثابت | نسبة رسم\n\n'
        'بدون رسوم: <code>1 | 0 | 0</code>\n'
        'مثال خصم 2%: <code>1 | 0 | 2</code>',
        parse_mode='HTML',
    )


@dp.message(AdminPaymentMethodStates.waiting_method_conversion)
async def process_payment_method_conversion(message: Message, state: FSMContext):
    parts = [part.strip().replace(',', '.') for part in (message.text or '').split('|')]
    if len(parts) != 3:
        await message.answer('استخدم الصيغة: معدل الإضافة | رسم ثابت | نسبة رسم')
        return
    try:
        rate, fixed_fee, fee_percent = map(float, parts)
        if not all(math.isfinite(v) for v in (rate, fixed_fee, fee_percent)):
            raise ValueError
        if rate <= 0 or fixed_fee < 0 or not 0 <= fee_percent <= 100:
            raise ValueError
    except (TypeError, ValueError):
        await message.answer('القيم غير صحيحة. المعدل أكبر من صفر، والرسوم غير سالبة، والنسبة بين 0 و100.')
        return
    data = await state.get_data()
    method_id = data.get('editing_method_id')
    if method_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                'UPDATE payment_methods SET credit_rate = ?, fixed_fee = ?, fee_percent = ?, is_manually_edited = 1 WHERE id = ?',
                (rate, fixed_fee, fee_percent, method_id),
            )
            await db.commit()
        await state.clear()
        await message.answer('✅ تم تحديث التحويل والرسوم.', reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_pm_{method_id}')]]))
        return

    await state.update_data(method_credit_rate=rate, method_fixed_fee=fixed_fee, method_fee_percent=fee_percent)
    await state.set_state(AdminPaymentMethodStates.waiting_method_proof_mode)
    await message.answer(
        'الخطوة 6 من 8\n\nاختر الإثبات الذي سيطلبه البوت من الزبون:',
        reply_markup=payment_proof_mode_kb('add'),
    )


@dp.callback_query(F.data.startswith('admin_pm_proof_add_'), AdminPaymentMethodStates.waiting_method_proof_mode)
async def cb_payment_proof_add(callback: CallbackQuery, state: FSMContext):
    try:
        mode = callback.data.split('_')[4]
    except IndexError:
        mode = ''
    if mode not in {'photo', 'transaction', 'either'}:
        await callback.answer('اختيار غير صالح.', show_alert=True)
        return
    await state.update_data(method_proof_mode=mode)
    await state.set_state(AdminPaymentMethodStates.waiting_method_details)
    await safe_edit_message(
        callback.message,
        'الخطوة 7 من 8\n\nأرسل تعليمات الدفع التي ستظهر للزبون.\n\n'
        'مثال: حوّل المبلغ أولاً، ثم أرسل رقم العملية. لا تكتب أي ملاحظة داخل التحويل.',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn('admin_payment_methods', '❌ إلغاء')]]),
        parse_mode='HTML',
    )
    await callback.answer()


@dp.callback_query(F.data.startswith('admin_pm_proof_edit_'))
async def cb_payment_proof_edit(callback: CallbackQuery, state: FSMContext):
    parts = callback.data.split('_')
    try:
        mode = parts[4]
        method_id = int(parts[5])
    except (IndexError, ValueError):
        await callback.answer('اختيار غير صالح.', show_alert=True)
        return
    if mode not in {'photo', 'transaction', 'either'}:
        await callback.answer('اختيار غير صالح.', show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE payment_methods SET proof_mode = ?, proof_required = 1, is_manually_edited = 1 WHERE id = ?",
            (mode, method_id),
        )
        await db.commit()
    await state.clear()
    await callback.answer('✅ تم تحديث نوع الإثبات.', show_alert=True)
    await safe_edit_message(
        callback.message,
        '✅ تم تحديث نوع إثبات الدفع.',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_pm_{method_id}', '🔙 العودة للطريقة')]]),
    )


async def _create_payment_method_from_state(
    data: dict,
    image_file_id: str = '',
    image_unique_id: str = '',
) -> int:
    """حفظ طريقة دفع جديدة بعد اكتمال خطوات الإضافة."""
    required = (
        'method_name', 'method_transfer_label', 'method_transfer_value', 'method_currency',
        'method_min_amount', 'method_max_amount', 'method_credit_rate', 'method_fixed_fee',
        'method_fee_percent', 'method_proof_mode', 'method_details',
    )
    if any(key not in data for key in required):
        raise ValueError('بيانات طريقة الدفع غير مكتملة.')

    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('BEGIN IMMEDIATE')
        cursor = await db.execute('SELECT COALESCE(MAX(sort_order), 0) + 10 FROM payment_methods')
        row = await cursor.fetchone()
        sort_order = int(row[0] or 10)
        cursor = await db.execute(
            """
            INSERT INTO payment_methods
            (name, details, is_active, created_at, provider, icon, currency,
             min_amount, max_amount, sort_order, is_synced, is_manually_edited,
             status_override, remote_is_active, transfer_label, transfer_value,
             credit_rate, fixed_fee, fee_percent, proof_required, proof_mode,
             payment_mode, auto_provider, auto_config, image_file_id, image_unique_id)
            VALUES (?, ?, 1, ?, 'local', ?, ?, ?, ?, ?, 0, 1, 1, 1, ?, ?, ?, ?, ?, 1, ?, 'manual', '', '{}', ?, ?)
            """,
            (
                data['method_name'], data['method_details'], now,
                payment_method_icon(data['method_name']), data['method_currency'],
                data['method_min_amount'], data['method_max_amount'], sort_order,
                data['method_transfer_label'], data['method_transfer_value'],
                data['method_credit_rate'], data['method_fixed_fee'],
                data['method_fee_percent'], data['method_proof_mode'],
                image_file_id, image_unique_id,
            ),
        )
        method_id = int(cursor.lastrowid)
        await db.commit()
    return method_id


def _payment_image_from_message(message: Message) -> tuple[str, str]:
    """استخراج Telegram file_id من صورة أو ملف صورة."""
    if message.photo:
        photo = message.photo[-1]
        return photo.file_id, photo.file_unique_id
    if message.document and str(message.document.mime_type or '').startswith('image/'):
        return message.document.file_id, message.document.file_unique_id
    return '', ''


async def _finish_new_payment_method(message: Message, state: FSMContext, image_file_id: str = '', image_unique_id: str = ''):
    data = await state.get_data()
    try:
        method_id = await _create_payment_method_from_state(data, image_file_id, image_unique_id)
    except ValueError:
        await state.clear()
        await message.answer('انتهت جلسة الإضافة أو نقصت بعض البيانات. ابدأ من جديد.')
        return
    except Exception as exc:
        logger.exception('فشل حفظ طريقة الدفع: %s', exc)
        await message.answer('❌ تعذر حفظ طريقة الدفع. حاول مرة أخرى.')
        return

    await state.clear()
    image_status = '✅ تمت إضافة صورة/باركود.' if image_file_id else 'ℹ️ أُضيفت بدون صورة.'
    await message.answer(
        '✅ <b>تمت إضافة طريقة الدفع بنجاح</b>\n\n'
        f"الطريقة: <b>{html.escape(data['method_name'])}</b>\n"
        f"العملة: <b>{html.escape(data['method_currency'])}</b>\n"
        f"الإثبات: <b>{html.escape(_payment_proof_label(data['method_proof_mode']))}</b>\n"
        f'{image_status}',
        parse_mode='HTML',
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[[back_btn(f'admin_pm_{method_id}', '⚙️ فتح الطريقة')]]
        ),
    )
    await log_activity(
        message.from_user.id,
        'add_payment_method',
        f"إضافة طريقة دفع: {data['method_name']}",
    )


@dp.message(AdminPaymentMethodStates.waiting_method_details)
async def process_payment_method_details(message: Message, state: FSMContext):
    details = (message.text or '').strip()
    if not details or len(details) > 2000:
        await message.answer('أرسل تعليمات واضحة لا تتجاوز 2000 حرف.')
        return
    data = await state.get_data()
    method_id = data.get('editing_method_id')
    if method_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                'UPDATE payment_methods SET details = ?, is_manually_edited = 1 WHERE id = ?',
                (details, method_id),
            )
            await db.commit()
        await state.clear()
        await message.answer(
            '✅ تم تعديل التعليمات.',
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[[back_btn(f'admin_pm_{method_id}')]]
            ),
        )
        return

    required = (
        'method_name', 'method_transfer_label', 'method_transfer_value', 'method_currency',
        'method_min_amount', 'method_max_amount', 'method_credit_rate', 'method_fixed_fee',
        'method_fee_percent', 'method_proof_mode',
    )
    if any(key not in data for key in required):
        await state.clear()
        await message.answer('انتهت جلسة الإضافة أو نقصت بعض البيانات. ابدأ من جديد.')
        return

    await state.update_data(method_details=details)
    await state.set_state(AdminPaymentMethodStates.waiting_method_image)
    await message.answer(
        'الخطوة 8 من 8\n\n'
        'أرسل الآن صورة الباركود أو رمز QR الخاص بطريقة الدفع.\n\n'
        'يمكنك أيضاً تخطي الصورة وإضافتها لاحقاً من إعدادات الطريقة.',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text='⏭ تخطي بدون صورة', callback_data='admin_pm_image_skip_new')],
            [back_btn('admin_payment_methods', '❌ إلغاء')],
        ]),
    )


@dp.callback_query(
    F.data == 'admin_pm_image_skip_new',
    AdminPaymentMethodStates.waiting_method_image,
)
async def cb_payment_image_skip_new(callback: CallbackQuery, state: FSMContext):
    await callback.answer('سيتم الحفظ بدون صورة.')
    await _finish_new_payment_method(callback.message, state)


@dp.message(AdminPaymentMethodStates.waiting_method_image)
async def process_payment_method_image(message: Message, state: FSMContext):
    image_file_id, image_unique_id = _payment_image_from_message(message)
    if not image_file_id:
        await message.answer('❌ أرسل صورة أو ملف صورة واضح للباركود.')
        return

    data = await state.get_data()
    method_id = data.get('editing_method_id')
    if method_id:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """
                UPDATE payment_methods
                SET image_file_id = ?, image_unique_id = ?, is_manually_edited = 1
                WHERE id = ?
                """,
                (image_file_id, image_unique_id, method_id),
            )
            await db.commit()
        await state.clear()
        await message.answer(
            '✅ تم حفظ صورة/باركود طريقة الدفع.',
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[[back_btn(f'admin_pm_{method_id}', '🔙 العودة للطريقة')]]
            ),
        )
        return

    await _finish_new_payment_method(message, state, image_file_id, image_unique_id)


@dp.callback_query(F.data.startswith('admin_pm_edit_image_'))
async def cb_admin_payment_image_edit(callback: CallbackQuery, state: FSMContext):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer('⛔ للمدير الأساسي فقط.', show_alert=True)
        return
    try:
        method_id = int(callback.data.rsplit('_', 1)[1])
    except (IndexError, ValueError):
        await callback.answer('طريقة الدفع غير صالحة.', show_alert=True)
        return
    await state.clear()
    await state.update_data(editing_method_id=method_id)
    await state.set_state(AdminPaymentMethodStates.waiting_method_image)
    await safe_edit_message(
        callback.message,
        '🖼 <b>إضافة أو تغيير صورة طريقة الدفع</b>\n\n'
        'أرسل صورة الباركود أو رمز QR الآن.',
        InlineKeyboardMarkup(
            inline_keyboard=[[back_btn(f'admin_pm_{method_id}', '❌ إلغاء')]]
        ),
        parse_mode='HTML',
    )
    await callback.answer()


@dp.callback_query(F.data.startswith('admin_pm_remove_image_'))
async def cb_admin_payment_image_remove(callback: CallbackQuery, state: FSMContext):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer('⛔ للمدير الأساسي فقط.', show_alert=True)
        return
    try:
        method_id = int(callback.data.rsplit('_', 1)[1])
    except (IndexError, ValueError):
        await callback.answer('طريقة الدفع غير صالحة.', show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE payment_methods
            SET image_file_id = '', image_unique_id = '', is_manually_edited = 1
            WHERE id = ?
            """,
            (method_id,),
        )
        await db.commit()
    await state.clear()
    if cursor.rowcount:
        await callback.answer('✅ تم حذف الصورة.', show_alert=True)
    else:
        await callback.answer('طريقة الدفع غير موجودة.', show_alert=True)
    await safe_edit_message(
        callback.message,
        '✅ تم حذف صورة طريقة الدفع.',
        InlineKeyboardMarkup(
            inline_keyboard=[[back_btn(f'admin_pm_{method_id}', '🔙 العودة للطريقة')]]
        ),
    )


async def _move_payment_method(method_id: int, direction: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('BEGIN IMMEDIATE')
        async with db.execute('SELECT sort_order FROM payment_methods WHERE id = ?', (method_id,)) as cursor:
            current = await cursor.fetchone()
        if not current:
            await db.rollback()
            return False
        comparator = '<' if direction == 'up' else '>'
        ordering = 'DESC' if direction == 'up' else 'ASC'
        async with db.execute(
            f'SELECT id, sort_order FROM payment_methods WHERE sort_order {comparator} ? ORDER BY sort_order {ordering} LIMIT 1',
            (current[0],),
        ) as cursor:
            neighbor = await cursor.fetchone()
        if not neighbor:
            await db.rollback()
            return False
        temporary = -int(datetime.datetime.now().timestamp() * 1000)
        await db.execute('UPDATE payment_methods SET sort_order = ? WHERE id = ?', (temporary, method_id))
        await db.execute('UPDATE payment_methods SET sort_order = ? WHERE id = ?', (current[0], neighbor[0]))
        await db.execute('UPDATE payment_methods SET sort_order = ? WHERE id = ?', (neighbor[1], method_id))
        await db.commit()
        return True


@dp.callback_query(F.data.startswith('admin_pm_'))
async def cb_admin_pm_detail(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    parts = callback.data.split('_')
    try:
        method_id = int(parts[-1])
    except (ValueError, IndexError):
        await callback.answer('طريقة الدفع غير صالحة.', show_alert=True)
        return

    action = 'detail'
    if 'toggle' in parts:
        action = 'toggle'
    elif 'delete' in parts:
        action = 'delete'
    elif 'edit' in parts:
        action = 'edit'
    elif 'move' in parts:
        action = 'move'

    if action == 'detail':
        await state.clear()

    if action == 'toggle':
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute('SELECT is_active FROM payment_methods WHERE id = ?', (method_id,)) as cursor:
                row = await cursor.fetchone()
            if not row:
                await callback.answer('طريقة الدفع غير موجودة.', show_alert=True)
                return
            new_status = 0 if row[0] else 1
            await db.execute('UPDATE payment_methods SET is_active = ?, status_override = ? WHERE id = ?', (new_status, new_status, method_id))
            await db.commit()
        await callback.answer('✅ تم تغيير الحالة.')

    elif action == 'delete':
        if not await is_super_admin(callback.from_user.id):
            await callback.answer('⛔ للمدير الأساسي فقط.', show_alert=True)
            return
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute('DELETE FROM payment_methods WHERE id = ?', (method_id,))
            await db.commit()
        methods = await _load_admin_payment_methods()
        await safe_edit_message(callback.message, '🗑 تم حذف طريقة الدفع.', admin_payment_methods_kb(methods))
        await callback.answer('تم الحذف.')
        return

    elif action == 'move':
        direction = 'up' if 'up' in parts else 'down'
        moved = await _move_payment_method(method_id, direction)
        await callback.answer('✅ تم تغيير الترتيب.' if moved else 'لا توجد طريقة أخرى في هذا الاتجاه.', show_alert=not moved)

    elif action == 'edit':
        if 'details' in parts:
            target_state = AdminPaymentMethodStates.waiting_method_details
            prompt = 'أرسل تعليمات الدفع الجديدة كاملة.'
        elif 'account' in parts:
            target_state = AdminPaymentMethodStates.waiting_method_account
            prompt = 'أرسل: اسم الحقل | القيمة\nمثال: معرّف Binance | 1120006944'
        elif 'currency' in parts:
            target_state = AdminPaymentMethodStates.waiting_method_currency
            prompt = 'أرسل رمز العملة، مثل USD أو USDT أو SYP.'
        elif 'limits' in parts:
            target_state = AdminPaymentMethodStates.waiting_method_limits
            prompt = 'أرسل: الحد الأدنى | الحد الأعلى\nمثال: 1 | 1000، أو 1 | 0 بلا حد أعلى.'
        elif 'conversion' in parts:
            target_state = AdminPaymentMethodStates.waiting_method_conversion
            prompt = 'أرسل: معدل الإضافة | رسم ثابت | نسبة رسم\nمثال: 1 | 0 | 0'
        elif 'proof' in parts:
            await state.clear()
            await state.update_data(editing_method_id=method_id)
            await state.set_state(AdminPaymentMethodStates.waiting_method_proof_mode)
            await safe_edit_message(
                callback.message,
                '🧾 <b>اختر نوع إثبات الدفع المطلوب</b>',
                payment_proof_mode_kb('edit', method_id),
                parse_mode='HTML',
            )
            await callback.answer()
            return
        else:
            target_state = AdminPaymentMethodStates.waiting_method_name
            prompt = 'أرسل الاسم الجديد.'
        await state.clear()
        await state.update_data(editing_method_id=method_id)
        await state.set_state(target_state)
        await safe_edit_message(
            callback.message,
            f'✏️ <b>تعديل طريقة الدفع</b>\n\n{prompt}',
            InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_pm_{method_id}', '❌ إلغاء')]]),
            parse_mode='HTML',
        )
        await callback.answer()
        return

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, name, details, is_active, provider, icon, currency,
                   min_amount, max_amount, sort_order, transfer_label, transfer_value,
                   credit_rate, fixed_fee, fee_percent, proof_required, proof_mode,
                   payment_mode, image_file_id
            FROM payment_methods WHERE id = ?
            """,
            (method_id,),
        ) as cursor:
            method = await cursor.fetchone()
    if not method:
        await callback.answer('طريقة الدفع غير موجودة.', show_alert=True)
        return

    status = '🟢 مفعلة' if method[3] else '🔴 معطلة'
    limits = []
    if float(method[7] or 0) > 0:
        limits.append(f'الحد الأدنى: {_money(method[7])} {method[6] or "USD"}')
    if float(method[8] or 0) > 0:
        limits.append(f'الحد الأعلى: {_money(method[8])} {method[6] or "USD"}')
    limits_text = '\n'.join(limits) if limits else 'لا توجد حدود خاصة.'
    details = method[2] or 'لا توجد تعليمات.'
    proof_mode = method[16] or 'either'
    mode_text = 'يدوي' if (method[17] or 'manual') == 'manual' else 'تلقائي'
    if str(method[4] or '') == 'binance':
        mode_text += ' — Binance'
    image_status = '✅ مضافة' if str(method[18] or '').strip() else '➖ غير مضافة'

    text = (
        f"{html.escape(method[5] or payment_method_icon(method[1]))} <b>{html.escape(method[1])}</b>\n"
        '━━━━━━━━━━━━━━━━\n\n'
        f'الحالة: <b>{status}</b>\n'
        f'الوضع: <b>{mode_text}</b>\n'
        f'العملة: <b>{html.escape(method[6] or "USD")}</b>\n'
        f'الترتيب: <b>{method[9]}</b>\n'
        f'صورة/باركود: <b>{image_status}</b>\n\n'
        f'🔢 <b>{html.escape(method[10] or "بيانات التحويل")}:</b>\n'
        f'<code>{html.escape(method[11] or "غير مسجلة")}</code>\n\n'
        f'📊 <b>الحدود:</b>\n{html.escape(limits_text)}\n\n'
        f'💱 <b>حساب الرصيد:</b>\n'
        f'معدل الإضافة: <b>{_money(method[12] or 1)}</b>\n'
        f'الرسم الثابت: <b>{_money(method[13] or 0)} USD</b>\n'
        f'نسبة الرسم: <b>{_money(method[14] or 0)}%</b>\n'
        f'إثبات الدفع: <b>{html.escape(_payment_proof_label(proof_mode))}</b>\n\n'
        f'📝 <b>التعليمات:</b>\n{html.escape(details)}'
    )
    await safe_edit_message(callback.message, text, admin_payment_method_detail_kb(method_id, bool(method[3]), method[4]), parse_mode='HTML')
    await callback.answer()


# =============================================================================
# إدارة طلبات شحن الرصيد من الأدمن
# =============================================================================


async def approve_deposit_request(req_id: int, admin_id: int) -> tuple[bool, str, int, float]:
    """اعتماد الطلب وشحن الرصيد مرة واحدة فقط داخل معاملة آمنة."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('BEGIN IMMEDIATE')
        try:
            async with db.execute(
                "SELECT user_id, amount, status FROM deposit_requests WHERE id = ?",
                (req_id,),
            ) as cursor:
                request_row = await cursor.fetchone()
            if not request_row:
                await db.rollback()
                return False, 'الطلب غير موجود.', 0, 0.0
            user_id, amount, status = int(request_row[0]), float(request_row[1]), request_row[2]
            if status != 'pending':
                await db.rollback()
                return False, 'تم معالجة هذا الطلب مسبقاً.', user_id, amount

            now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            cursor = await db.execute(
                """
                UPDATE deposit_requests
                SET status = 'approved', reviewed_at = ?
                WHERE id = ? AND status = 'pending'
                """,
                (now, req_id),
            )
            if cursor.rowcount != 1:
                await db.rollback()
                return False, 'تمت معالجة الطلب في نفس اللحظة من مشرف آخر.', user_id, amount

            await db.execute(
                'UPDATE users SET balance = balance + ? WHERE user_id = ?',
                (amount, user_id),
            )
            await db.execute(
                """
                INSERT INTO balance_logs (user_id, amount, type, reason, date, admin_id)
                VALUES (?, ?, 'add', ?, ?, ?)
                """,
                (user_id, amount, f'شحن رصيد - طلب #{req_id}', now, admin_id),
            )
            await db.commit()
            return True, 'تمت الموافقة.', user_id, amount
        except Exception:
            await db.rollback()
            raise

@dp.callback_query(F.data == "admin_deposit_requests")
async def cb_admin_deposit_requests(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, user_id, amount, payment_method, proof_type, proof_content, proof_file_id, status, created_at, paid_amount, credited_amount "
            "FROM deposit_requests ORDER BY created_at DESC"
        ) as cursor:
            requests = await cursor.fetchall()
    pending = sum(1 for r in requests if r[7] == 'pending')
    text = f"💳 **طلبات شحن الرصيد**\n\nالإجمالي: {len(requests)} | ⏳ قيد الانتظار: {pending}"
    await safe_edit_message(callback.message, text, admin_deposit_requests_kb(requests))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_dep_p"))
async def cb_admin_dep_page(callback: CallbackQuery):
    page = int(callback.data.split("_p")[1])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, user_id, amount, payment_method, proof_type, proof_content, proof_file_id, status, created_at, paid_amount, credited_amount "
            "FROM deposit_requests ORDER BY created_at DESC"
        ) as cursor:
            requests = await cursor.fetchall()
    await safe_edit_message(callback.message, f"💳 **طلبات الشحن** ({len(requests)}):", admin_deposit_requests_kb(requests, page))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_dep_"))
async def cb_admin_dep_detail(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    # admin_dep_approve_ID / admin_dep_reject_ID / admin_dep_ID
    req_id = int(parts[-1])

    if "approve" in parts:
        approved, approval_message, approved_user_id, approved_amount = await approve_deposit_request(
            req_id, callback.from_user.id
        )
        if not approved:
            await callback.answer(approval_message, show_alert=True)
            return
        await callback.answer(
            f"✅ تمت الموافقة وشحن {_money(approved_amount)} $ للمستخدم {approved_user_id}.",
            show_alert=True,
        )
        await safe_send_message(
            approved_user_id,
            f"✅ **تمت الموافقة على طلب الشحن!**\n\nرقم الطلب: #{req_id}\n"
            f"تم إضافة **{_money(approved_amount)} $** لرصيدك.",
        )
        await log_activity(
            callback.from_user.id,
            "deposit_approved",
            f"قبول طلب #{req_id} - {approved_amount} $",
        )

    elif "reject" in parts:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT user_id, amount, status FROM deposit_requests WHERE id = ?", (req_id,)) as cursor:
                req = await cursor.fetchone()
        if not req:
            await callback.answer("الطلب غير موجود.", show_alert=True)
            return
        if req[2] != 'pending':
            await callback.answer("تم معالجة هذا الطلب مسبقاً.", show_alert=True)
            return
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE deposit_requests SET status = 'rejected', reviewed_at = ? WHERE id = ?", (now, req_id))
            await db.commit()
        await callback.answer("❌ تم رفض الطلب.", show_alert=True)
        await safe_send_message(req[0], f"❌ **تم رفض طلب الشحن #{req_id}.**\n\nيرجى التواصل مع الدعم لمزيد من المعلومات.")
        await log_activity(callback.from_user.id, "deposit_rejected", f"رفض طلب #{req_id}")

    # عرض تفاصيل الطلب
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, user_id, amount, payment_method, proof_type, proof_content, proof_file_id, status, created_at, paid_amount, credited_amount "
            "FROM deposit_requests WHERE id = ?", (req_id,)
        ) as cursor:
            req = await cursor.fetchone()
    if not req:
        await callback.answer("الطلب غير موجود.", show_alert=True)
        return
    status_map = {"pending": "⏳ قيد الانتظار", "waiting_payment": "🟡 بانتظار دفعة Binance", "approved": "✅ مقبول", "rejected": "❌ مرفوض", "expired": "⌛ منتهي", "cancelled": "🚫 ملغى"}
    status_text = status_map.get(req[7], req[7])
    proof_label = "تلقائي 🟡" if req[4] == 'automatic' else ("صورة 📷" if req[4] == 'photo' else "نص 📝")
    text = (
        f"💳 **طلب شحن #{req[0]}**\n\n"
        f"المستخدم: {req[1]}\n"
        f"المبلغ المحوّل: {_money(req[9] or req[2])}\n"
        f"الرصيد الذي سيُضاف: {_money(req[10] or req[2])} $\n"
        f"طريقة الدفع: {req[3]}\n"
        f"نوع الإثبات: {proof_label}\n"
        f"الحالة: {status_text}\n"
        f"التاريخ: {req[8]}\n"
    )
    if req[4] == 'text':
        text += f"\n**الإثبات النصي:**\n`{req[5]}`"

    if req[4] == 'photo' and req[6] and req[7] == 'pending':
        try:
            await bot.send_photo(
                callback.from_user.id,
                photo=req[6],
                caption=text,
                reply_markup=admin_deposit_detail_kb(req_id, req[7]),
                parse_mode="Markdown"
            )
            await callback.answer()
            return
        except Exception:
            pass

    await safe_edit_message(callback.message, text, admin_deposit_detail_kb(req_id, req[7]))
    await callback.answer()

# أوامر سريعة للأدمن لمعالجة طلبات الشحن
@dp.message(Command("dep_approve"))
async def cmd_dep_approve(message: Message):
    if not await is_admin(message.from_user.id):
        return
    parts = message.text.split("_")
    if len(parts) < 3:
        await message.answer("الاستخدام: /dep_approve_<req_id>")
        return
    try:
        req_id = int(parts[2])
    except ValueError:
        await message.answer("معرف غير صحيح.")
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id, amount, status FROM deposit_requests WHERE id = ?", (req_id,)) as cursor:
            req = await cursor.fetchone()
    if not req:
        await message.answer("الطلب غير موجود.")
        return
    if req[2] != 'pending':
        await message.answer("تم معالجة هذا الطلب مسبقاً.")
        return
    approved, approval_message, approved_user_id, approved_amount = await approve_deposit_request(
        req_id, message.from_user.id
    )
    if not approved:
        await message.answer(approval_message)
        return
    await message.answer(
        f"✅ تمت الموافقة وشحن {_money(approved_amount)} $ للمستخدم {approved_user_id}."
    )
    await safe_send_message(
        approved_user_id,
        f"✅ **تمت الموافقة على طلب الشحن!**\n\nرقم الطلب: #{req_id}\n"
        f"تم إضافة **{_money(approved_amount)} $** لرصيدك.",
    )

@dp.message(Command("dep_reject"))
async def cmd_dep_reject(message: Message):
    if not await is_admin(message.from_user.id):
        return
    parts = message.text.split("_")
    if len(parts) < 3:
        await message.answer("الاستخدام: /dep_reject_<req_id>")
        return
    try:
        req_id = int(parts[2])
    except ValueError:
        await message.answer("معرف غير صحيح.")
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id, amount, status FROM deposit_requests WHERE id = ?", (req_id,)) as cursor:
            req = await cursor.fetchone()
    if not req:
        await message.answer("الطلب غير موجود.")
        return
    if req[2] != 'pending':
        await message.answer("تم معالجة هذا الطلب مسبقاً.")
        return
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE deposit_requests SET status = 'rejected', reviewed_at = ? WHERE id = ?", (now, req_id))
        await db.commit()
    await message.answer(f"❌ تم رفض طلب الشحن #{req_id}.")
    await safe_send_message(req[0], f"❌ **تم رفض طلب الشحن #{req_id}.**\n\nيرجى التواصل مع الدعم.")


# =============================================================================
# لوحة الإحصائيات والمال
# =============================================================================

STATS_PERIOD_LABELS = {
    'today': 'اليوم',
    '7d': 'آخر 7 أيام',
    '30d': 'آخر 30 يوماً',
    'all': 'كل المدة',
}


def _stats_period_bounds(period: str):
    period = period if period in STATS_PERIOD_LABELS else 'today'
    now = datetime.datetime.now()
    if period == 'all':
        return period, None, None
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == 'today':
        start = today
    elif period == '7d':
        start = today - datetime.timedelta(days=6)
    else:
        start = today - datetime.timedelta(days=29)
    end = today + datetime.timedelta(days=1)
    return period, start.strftime('%Y-%m-%d %H:%M:%S'), end.strftime('%Y-%m-%d %H:%M:%S')


def _stats_filter(column: str, start: str | None, end: str | None):
    if not start or not end:
        return '', []
    return f' WHERE {column} >= ? AND {column} < ?', [start, end]


def _stats_keyboard(active_period: str) -> InlineKeyboardMarkup:
    def period_btn(label: str, value: str):
        prefix = '✅ ' if active_period == value else ''
        return InlineKeyboardButton(
            text=f'{prefix}{label}',
            callback_data=f'admin_stats_period_{value}',
        )

    return InlineKeyboardMarkup(inline_keyboard=[
        [period_btn('اليوم', 'today'), period_btn('7 أيام', '7d')],
        [period_btn('30 يوماً', '30d'), period_btn('كل المدة', 'all')],
        [InlineKeyboardButton(
            text='🔄 تحديث رصيد المزود',
            callback_data=f'admin_stats_provider_{active_period}',
        )],
        [
            InlineKeyboardButton(text='🛒 الطلبات', callback_data='admin_orders'),
            InlineKeyboardButton(text='💳 طلبات الشحن', callback_data='admin_deposit_requests'),
        ],
        [back_btn('admin_panel')],
    ])


def _float_value(value, default: float = 0.0) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return default


def _extract_balance_from_profile(profile: object) -> float | None:
    if not isinstance(profile, dict):
        return None
    candidates = [profile]
    for key in ('data', 'result', 'profile'):
        nested = profile.get(key)
        if isinstance(nested, dict):
            candidates.append(nested)
    for item in candidates:
        for key in ('balance', 'wallet_balance', 'credit'):
            if key in item:
                try:
                    return float(item.get(key))
                except (TypeError, ValueError):
                    continue
    return None


async def _refresh_provider_balance() -> tuple[bool, str]:
    if not API_TOKEN:
        return False, 'توكن الموقع غير موجود.'
    try:
        async with JS4CardAPI(api_token=API_TOKEN, connection_limit=1) as api:
            profile = await asyncio.wait_for(api.get_profile(), timeout=20)
        balance = _extract_balance_from_profile(profile)
        if balance is None:
            return False, 'لم يعرض الموقع الرصيد بصيغة معروفة.'
        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        await set_setting('provider_balance_cache', str(balance))
        await set_setting('provider_balance_updated_at', now)
        return True, f'تم تحديث رصيد المزود: {balance:.2f} $'
    except Exception as exc:
        logger.warning('Provider balance refresh failed: %s', exc)
        return False, 'تعذر تحديث رصيد المزود الآن.'


async def _collect_admin_stats(period: str) -> dict[str, Any]:
    period, start, end = _stats_period_bounds(period)
    order_where, order_args = _stats_filter('o.order_date', start, end)
    deposit_where, deposit_args = _stats_filter('created_at', start, end)
    user_where, user_args = _stats_filter('joined_date', start, end)
    refund_where, refund_args = _stats_filter('date', start, end)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        async with db.execute(
            "SELECT id, name, COALESCE(NULLIF(display_name, ''), name) AS shown_name, "
            "COALESCE(local_parent_id, parent_id, 0) AS effective_parent FROM categories"
        ) as cursor:
            category_rows = await cursor.fetchall()
        category_map = {
            int(row['id']): {
                'name': str(row['shown_name'] or row['name'] or row['id']),
                'parent': int(row['effective_parent'] or 0),
            }
            for row in category_rows
        }

        async with db.execute(
            "SELECT o.id, o.total_price, o.status, o.order_date, o.quantity, "
            "COALESCE(o.api_provider, '') AS api_provider, "
            "COALESCE(o.payment_state, '') AS payment_state, "
            "COALESCE(o.api_refunded, 0) AS api_refunded, "
            "COALESCE(o.provider_cost, 0) AS provider_cost, "
            "COALESCE(o.gross_profit, 0) AS gross_profit, "
            "COALESCE(o.cost_known, 0) AS cost_known, "
            "COALESCE(o.request_payload, '{}') AS request_payload, "
            "p.name AS product_name, p.api_params, p.category_id "
            "FROM orders o LEFT JOIN products p ON p.id = o.product_id" + order_where,
            order_args,
        ) as cursor:
            order_rows = await cursor.fetchall()

        async with db.execute(
            "SELECT status, COUNT(*) AS count, "
            "COALESCE(SUM(CASE WHEN credited_amount > 0 THEN credited_amount ELSE amount END), 0) AS credited "
            "FROM deposit_requests" + deposit_where + " GROUP BY status",
            deposit_args,
        ) as cursor:
            deposit_rows = await cursor.fetchall()

        async with db.execute(
            "SELECT COUNT(*) AS count FROM users" + user_where,
            user_args,
        ) as cursor:
            new_users = int((await cursor.fetchone())['count'] or 0)

        async with db.execute("SELECT COUNT(*) AS count FROM users") as cursor:
            total_users = int((await cursor.fetchone())['count'] or 0)
        async with db.execute("SELECT COUNT(*) AS count FROM products WHERE is_active = 1") as cursor:
            active_products = int((await cursor.fetchone())['count'] or 0)

        refund_clause = refund_where
        if refund_clause:
            refund_clause += " AND type = 'refund'"
        else:
            refund_clause = " WHERE type = 'refund'"
        async with db.execute(
            "SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM balance_logs" + refund_clause,
            refund_args,
        ) as cursor:
            refunds = _float_value((await cursor.fetchone())['total'])

    def root_category(category_id: int) -> tuple[int, str]:
        current = int(category_id or 0)
        visited = set()
        last = current
        while current and current not in visited and current in category_map:
            visited.add(current)
            last = current
            parent = int(category_map[current]['parent'] or 0)
            if not parent or parent not in category_map:
                break
            current = parent
        name = category_map.get(last, {}).get('name', 'بدون قسم')
        return last, str(name)

    counts = {'completed': 0, 'pending': 0, 'failed': 0, 'total': len(order_rows)}
    revenue = 0.0
    api_revenue = 0.0
    local_revenue = 0.0
    known_provider_cost = 0.0
    known_profit = 0.0
    known_profit_orders = 0
    product_sales: dict[str, dict[str, float]] = {}
    category_sales: dict[int, dict[str, float | str]] = {}

    for row in order_rows:
        status = str(row['status'] or '').casefold()
        if status == 'completed':
            counts['completed'] += 1
        elif status in {'cancelled', 'failed', 'rejected'}:
            counts['failed'] += 1
        else:
            counts['pending'] += 1

        if status != 'completed' or int(row['api_refunded'] or 0) == 1 or str(row['payment_state']) == 'refunded':
            continue

        total_price = _float_value(row['total_price'])
        quantity = max(1, int(row['quantity'] or 1))
        revenue += total_price
        product_name = str(row['product_name'] or f"منتج #{row['id']}")
        product_entry = product_sales.setdefault(product_name, {'revenue': 0.0, 'quantity': 0.0})
        product_entry['revenue'] += total_price
        product_entry['quantity'] += quantity

        root_id, root_name = root_category(int(row['category_id'] or 0))
        category_entry = category_sales.setdefault(root_id, {'name': root_name, 'revenue': 0.0, 'orders': 0.0})
        category_entry['revenue'] = _float_value(category_entry['revenue']) + total_price
        category_entry['orders'] = _float_value(category_entry['orders']) + 1

        if str(row['api_provider']) == 'js4card':
            api_revenue += total_price
            provider_cost = _float_value(row['provider_cost'])
            cost_known = int(row['cost_known'] or 0) == 1 and provider_cost > 0
            if not cost_known:
                base_price = 0.0
                try:
                    payload = json.loads(row['request_payload'] or '{}')
                    base_price = _float_value(payload.get('base_price')) if isinstance(payload, dict) else 0.0
                except (TypeError, json.JSONDecodeError):
                    pass
                if base_price <= 0:
                    try:
                        api_params = json.loads(row['api_params'] or '{}')
                        base_price = _float_value(api_params.get('base_price')) if isinstance(api_params, dict) else 0.0
                    except (TypeError, json.JSONDecodeError):
                        pass
                if base_price > 0:
                    provider_cost = round(base_price * quantity, 2)
                    cost_known = True
            if cost_known:
                known_provider_cost += provider_cost
                known_profit += total_price - provider_cost
                known_profit_orders += 1
        else:
            local_revenue += total_price

    deposits = {'pending': 0, 'approved': 0, 'rejected': 0, 'approved_amount': 0.0}
    for row in deposit_rows:
        status = str(row['status'] or '')
        count = int(row['count'] or 0)
        if status in deposits:
            deposits[status] = count
        if status == 'approved':
            deposits['approved_amount'] = _float_value(row['credited'])

    top_products = sorted(
        product_sales.items(),
        key=lambda item: (item[1]['revenue'], item[1]['quantity']),
        reverse=True,
    )[:3]
    top_categories = sorted(
        category_sales.values(),
        key=lambda item: (_float_value(item['revenue']), _float_value(item['orders'])),
        reverse=True,
    )[:3]

    return {
        'period': period,
        'start': start,
        'end': end,
        'orders': counts,
        'revenue': revenue,
        'api_revenue': api_revenue,
        'local_revenue': local_revenue,
        'provider_cost': known_provider_cost,
        'known_profit': known_profit,
        'known_profit_orders': known_profit_orders,
        'refunds': refunds,
        'deposits': deposits,
        'new_users': new_users,
        'total_users': total_users,
        'active_products': active_products,
        'top_products': top_products,
        'top_categories': top_categories,
    }


async def _render_admin_stats(callback: CallbackQuery, period: str = 'today', *, answer_callback: bool = True):
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    permissions = await get_admin_perms(callback.from_user.id)
    if not permissions.get('can_view_stats', False):
        await callback.answer('⛔ لا تملك صلاحية مشاهدة الإحصائيات.', show_alert=True)
        return

    stats = await _collect_admin_stats(period)
    period = stats['period']
    period_label = STATS_PERIOD_LABELS[period]
    balance_raw = await get_setting('provider_balance_cache', '')
    balance_updated = await get_setting('provider_balance_updated_at', '')
    threshold = _float_value(await get_setting('provider_low_balance_threshold', '20'), 20)
    provider_balance = None
    try:
        provider_balance = float(balance_raw) if str(balance_raw).strip() else None
    except (TypeError, ValueError):
        provider_balance = None

    lines = [
        '📊 <b>لوحة المال والإحصائيات</b>',
        f'🗓 الفترة: <b>{period_label}</b>',
        '',
        '💰 <b>المبيعات والأرباح</b>',
        f"• المبيعات المكتملة: <b>{stats['revenue']:.2f} $</b>",
        f"• ربح منتجات الموقع التقديري: <b>{stats['known_profit']:.2f} $</b>",
        f"• تكلفة الموقع المقدّرة: <b>{stats['provider_cost']:.2f} $</b>",
    ]
    if stats['local_revenue'] > 0:
        lines.append(
            f"• مبيعات محلية/يدوية: <b>{stats['local_revenue']:.2f} $</b> "
            '<i>(تكلفتها غير محددة)</i>'
        )
    lines.extend([
        f"• المبالغ المعادة: <b>{stats['refunds']:.2f} $</b>",
        '',
        '🛒 <b>الطلبات</b>',
        f"• الإجمالي: <b>{stats['orders']['total']}</b>",
        f"• مكتملة: <b>{stats['orders']['completed']}</b>",
        f"• قيد المتابعة: <b>{stats['orders']['pending']}</b>",
        f"• فاشلة/ملغاة: <b>{stats['orders']['failed']}</b>",
        '',
        '💳 <b>شحن الرصيد</b>',
        f"• قيد الانتظار: <b>{stats['deposits']['pending']}</b>",
        f"• مقبولة: <b>{stats['deposits']['approved']}</b> — "
        f"<b>{stats['deposits']['approved_amount']:.2f} $</b>",
        f"• مرفوضة: <b>{stats['deposits']['rejected']}</b>",
        '',
        '👥 <b>المتجر</b>',
        f"• مستخدمون جدد: <b>{stats['new_users']}</b>",
        f"• إجمالي المستخدمين: <b>{stats['total_users']}</b>",
        f"• منتجات مفعلة: <b>{stats['active_products']}</b>",
    ])

    if stats['top_products']:
        lines.extend(['', '🏆 <b>الأكثر مبيعاً</b>'])
        for index, (name, values) in enumerate(stats['top_products'], start=1):
            safe_name = html.escape(clean_api_text(name, 42))
            lines.append(
                f"{index}. {safe_name} — {int(values['quantity'])} طلب/قطعة — "
                f"{values['revenue']:.2f} $"
            )

    if stats['top_categories']:
        lines.extend(['', '📂 <b>أفضل الأقسام الرئيسية</b>'])
        for index, values in enumerate(stats['top_categories'], start=1):
            safe_name = html.escape(clean_api_text(values['name'], 42))
            lines.append(
                f"{index}. {safe_name} — {int(_float_value(values['orders']))} طلب — "
                f"{_float_value(values['revenue']):.2f} $"
            )

    lines.extend(['', '🏦 <b>رصيد حساب الموقع</b>'])
    if provider_balance is None:
        lines.append('• لم يتم تحديثه بعد. استخدم زر التحديث أدناه.')
    else:
        warning = ' ⚠️ منخفض' if provider_balance <= threshold else ' ✅'
        lines.append(f'• الرصيد: <b>{provider_balance:.2f} $</b>{warning}')
        if balance_updated:
            lines.append(f'• آخر تحديث: {html.escape(balance_updated)}')

    lines.extend([
        '',
        '<i>الربح المعروض لمنتجات الموقع تقديري اعتماداً على سعر المزود المحفوظ وقت الشراء. '
        'المبيعات اليدوية لا تدخل في الربح حتى نضيف لها تكلفة شراء.</i>',
    ])

    await safe_edit_message(
        callback.message,
        '\n'.join(lines),
        _stats_keyboard(period),
        parse_mode='HTML',
    )
    if answer_callback:
        await callback.answer()


@dp.callback_query(F.data == 'admin_stats')
async def cb_admin_stats(callback: CallbackQuery):
    await _render_admin_stats(callback, 'today')


@dp.callback_query(F.data.startswith('admin_stats_period_'))
async def cb_admin_stats_period(callback: CallbackQuery):
    period = callback.data.removeprefix('admin_stats_period_')
    await _render_admin_stats(callback, period)


@dp.callback_query(F.data.startswith('admin_stats_provider_'))
async def cb_admin_stats_provider(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    period = callback.data.removeprefix('admin_stats_provider_')
    ok, message = await _refresh_provider_balance()
    await callback.answer(message, show_alert=not ok)
    await _render_admin_stats(callback, period, answer_callback=False)


# =============================================================================
# إدارة المستخدمين
# =============================================================================

@dp.callback_query(F.data == "admin_users")
async def cb_admin_users(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT user_id, username, full_name, balance, joined_date, is_banned, store_user_id FROM users ORDER BY joined_date DESC"
        ) as cursor:
            users = await cursor.fetchall()
    if not users:
        await safe_edit_message(callback.message, "👥 لا يوجد مستخدمون.", InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_panel")]]))
        await callback.answer()
        return
    await safe_edit_message(callback.message, f"👥 **المستخدمون** ({len(users)}):", admin_users_kb(users))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_users_p"))
async def cb_admin_users_page(callback: CallbackQuery):
    page = int(callback.data.split("_p")[1])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT user_id, username, full_name, balance, joined_date, is_banned, store_user_id FROM users ORDER BY joined_date DESC"
        ) as cursor:
            users = await cursor.fetchall()
    await safe_edit_message(callback.message, f"👥 **المستخدمون** ({len(users)}):", admin_users_kb(users, page))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_user_"))
async def cb_admin_user_detail(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    user_id = int(callback.data.split("_")[2])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT user_id, username, full_name, balance, joined_date, is_banned, store_user_id FROM users WHERE user_id = ?",
            (user_id,)
        ) as cursor:
            user = await cursor.fetchone()
        async with db.execute("SELECT COUNT(*) FROM orders WHERE user_id = ?", (user_id,)) as cursor:
            orders_count = (await cursor.fetchone())[0]
        async with db.execute("SELECT COALESCE(SUM(total_price),0) FROM orders WHERE user_id = ? AND status='completed'", (user_id,)) as cursor:
            total_spent = (await cursor.fetchone())[0]
    if not user:
        await callback.answer("المستخدم غير موجود.", show_alert=True)
        return
    banned_text = "🚫 محظور" if user[5] else "✅ نشط"
    store_id = user[6] if len(user) > 6 and user[6] else f'USR{user[0]:06d}'
    text = (
        f"👤 **تفاصيل المستخدم**\n\n"
        f"🆔 معرف المتجر: `{store_id}`\n"
        f"🔢 معرف تيليجرام: `{user[0]}`\n"
        f"👤 اسم المستخدم: @{user[1] or 'غير محدد'}\n"
        f"📛 الاسم الكامل: {user[2]}\n"
        f"💰 الرصيد: **{user[3]:.2f} $**\n"
        f"📅 تاريخ الانضمام: {user[4]}\n"
        f"📦 عدد الطلبات: {orders_count}\n"
        f"💳 إجمالي الإنفاق: {total_spent:.2f} $\n"
        f"🔴 الحالة: {banned_text}"
    )
    await safe_edit_message(callback.message, text, admin_user_detail_kb(user[0], bool(user[5])))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_ban_"))
async def cb_admin_ban_user(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    user_id = int(callback.data.split("_")[2])
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET is_banned = 1 WHERE user_id = ?", (user_id,))
        await db.commit()
    await callback.answer("🚫 تم حظر المستخدم.", show_alert=True)
    await safe_send_message(user_id, "🚫 تم حظرك من استخدام هذا البوت.")

@dp.callback_query(F.data.startswith("admin_unban_"))
async def cb_admin_unban_user(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    user_id = int(callback.data.split("_")[2])
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET is_banned = 0 WHERE user_id = ?", (user_id,))
        await db.commit()
    await callback.answer("✅ تم رفع الحظر.", show_alert=True)
    await safe_send_message(user_id, "✅ تم رفع الحظر عنك.")

@dp.callback_query(F.data.startswith("admin_user_orders_"))
async def cb_admin_user_orders(callback: CallbackQuery):
    user_id = int(callback.data.split("_")[3])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT o.id, o.user_id, o.product_id, o.quantity, o.total_price, o.status, o.order_date, p.name "
            "FROM orders o LEFT JOIN products p ON o.product_id = p.id "
            "WHERE o.user_id = ? ORDER BY o.order_date DESC",
            (user_id,)
        ) as cursor:
            orders = await cursor.fetchall()
    if not orders:
        await callback.answer("لا توجد طلبات لهذا المستخدم.", show_alert=True)
        return
    text = f"📦 **طلبات المستخدم {user_id}** ({len(orders)} طلب):\n\n"
    for o in orders[:10]:
        status_emoji = {"pending": "⏳", "processing": "🔄", "completed": "✅", "cancelled": "❌"}.get(o[5], "📦")
        text += f"{status_emoji} #{o[0]} - {o[7] or 'غير معروف'} - {o[4]} $\n"
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_user_{user_id}")]]))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_msg_user_"))
async def cb_admin_msg_user_start(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    user_id = int(callback.data.split("_")[3])
    await state.set_state(AdminMessageUserStates.waiting_message_text)
    await state.update_data(target_user_id=user_id)
    await safe_edit_message(
        callback.message,
        f"✉️ **إرسال رسالة للمستخدم {user_id}**\n\nأرسل نص الرسالة:",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_user_{user_id}", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminMessageUserStates.waiting_message_text)
async def process_admin_msg_user(message: Message, state: FSMContext):
    data = await state.get_data()
    target_id = data.get("target_user_id")
    await safe_send_message(target_id, f"📩 **رسالة من الإدارة:**\n\n{message.text}")
    await state.clear()
    await message.answer("✅ تم إرسال الرسالة.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_users")]]))

@dp.callback_query(F.data.startswith("admin_add_bal_"))
async def cb_admin_add_bal_user(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    user_id = int(callback.data.split("_")[3])
    await state.set_state(AdminBalanceStates.waiting_amount)
    await state.update_data(target_user_id=user_id, action_type="add")
    await safe_edit_message(
        callback.message,
        f"💰 **إضافة رصيد للمستخدم {user_id}**\n\nأرسل المبلغ:",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_user_{user_id}", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_deduct_bal_"))
async def cb_admin_deduct_bal_user(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    user_id = int(callback.data.split("_")[3])
    await state.set_state(AdminBalanceStates.waiting_amount)
    await state.update_data(target_user_id=user_id, action_type="deduct")
    await safe_edit_message(
        callback.message,
        f"💸 **خصم رصيد من المستخدم {user_id}**\n\nأرسل المبلغ:",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_user_{user_id}", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminBalanceStates.waiting_amount)
async def process_admin_balance_amount(message: Message, state: FSMContext):
    try:
        amount = float(message.text.strip())
        if amount <= 0:
            raise ValueError()
    except ValueError:
        await message.answer("يرجى إرسال مبلغ رقمي صحيح.")
        return
    data = await state.get_data()
    target_id = data.get("target_user_id")
    action = data.get("action_type", "add")
    if action == "add":
        await add_balance(target_id, amount, "إضافة يدوية من الأدمن", message.from_user.id)
        await safe_send_message(target_id, f"💰 تمت إضافة **{amount} $** لرصيدك.")
        await message.answer(f"✅ تمت إضافة {amount} $ للمستخدم {target_id}.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_users")]]))
    else:
        success = await deduct_balance(target_id, amount, "خصم يدوي من الأدمن", message.from_user.id)
        if success:
            await safe_send_message(target_id, f"💸 تم خصم **{amount} $** من رصيدك.")
            await message.answer(f"✅ تم خصم {amount} $ من المستخدم {target_id}.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_users")]]))
        else:
            await message.answer("❌ رصيد المستخدم غير كافٍ.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_users")]]))
    await state.clear()

# =============================================================================
# إدارة الرصيد من الأدمن
# =============================================================================

@dp.callback_query(F.data == "admin_balance_menu")
async def cb_admin_balance_menu(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ إضافة رصيد", callback_data="admin_add_balance")],
        [InlineKeyboardButton(text="➖ خصم رصيد", callback_data="admin_deduct_balance")],
        [InlineKeyboardButton(text="📋 سجل الرصيد", callback_data="admin_balance_log")],
        [back_btn("admin_panel")]
    ])
    await safe_edit_message(callback.message, "💰 **إدارة الرصيد**\nاختر العملية:", kb)
    await callback.answer()

@dp.callback_query(F.data == "admin_add_balance")
async def cb_admin_add_balance_start(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await state.set_state(AdminBalanceStates.waiting_user_id)
    await state.update_data(action_type="add")
    await safe_edit_message(
        callback.message,
        "💰 **إضافة رصيد**\n\nأرسل معرف المستخدم (user_id):",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_balance_menu", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.callback_query(F.data == "admin_deduct_balance")
async def cb_admin_deduct_balance_start(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await state.set_state(AdminBalanceStates.waiting_user_id)
    await state.update_data(action_type="deduct")
    await safe_edit_message(
        callback.message,
        "💸 **خصم رصيد**\n\nأرسل معرف المستخدم (user_id):",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_balance_menu", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminBalanceStates.waiting_user_id)
async def process_admin_balance_user_id(message: Message, state: FSMContext):
    try:
        user_id = int(message.text.strip())
    except ValueError:
        await message.answer("يرجى إرسال معرف رقمي صحيح.")
        return
    user = await get_user(user_id)
    if not user:
        await message.answer("المستخدم غير موجود.")
        return
    await state.update_data(target_user_id=user_id)
    await state.set_state(AdminBalanceStates.waiting_amount)
    await message.answer(f"أرسل المبلغ بالدولار $:")

@dp.callback_query(F.data == "admin_balance_log")
async def cb_admin_balance_log(callback: CallbackQuery):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT user_id, amount, type, reason, date FROM balance_logs ORDER BY date DESC LIMIT 15"
        ) as cursor:
            logs = await cursor.fetchall()
    if not logs:
        await callback.answer("لا يوجد سجل رصيد.", show_alert=True)
        return
    text = "📋 **آخر 15 عملية رصيد:**\n\n"
    for log in logs:
        sign = "+" if log[2] == "add" else "-"
        text += f"• {log[4][:10]} | {log[0]} | {sign}{log[1]} $ | {log[3][:20]}\n"
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_balance_menu")]]))
    await callback.answer()


# =============================================================================
# إدارة الأقسام - شجرة منظمة وترتيب محلي مستقل عن الموقع
# =============================================================================

async def _render_admin_root_categories(callback: CallbackQuery, page: int = 0) -> None:
    page = max(0, int(page))
    offset = page * CATEGORY_ADMIN_PAGE_SIZE
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM categories WHERE COALESCE(local_parent_id, parent_id, 0) = 0"
        ) as cursor:
            total = int((await cursor.fetchone())[0])
        async with db.execute(
            """
            SELECT c.id,
                   COALESCE(NULLIF(c.display_name, ''), c.name) AS display_name,
                   c.is_active,
                   COALESCE(c.is_hidden, 0),
                   (
                       SELECT COUNT(*) FROM categories child
                       WHERE COALESCE(child.local_parent_id, child.parent_id, 0) = c.id
                   ) AS children_count,
                   (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products_count
            FROM categories c
            WHERE COALESCE(c.local_parent_id, c.parent_id, 0) = 0
            ORDER BY COALESCE(c.local_sort_order, c.sort_order, 0), display_name
            LIMIT ? OFFSET ?
            """,
            (CATEGORY_ADMIN_PAGE_SIZE, offset),
        ) as cursor:
            categories = await cursor.fetchall()
    if total and offset >= total:
        return await _render_admin_root_categories(callback, max(0, math.ceil(total / CATEGORY_ADMIN_PAGE_SIZE) - 1))
    text = (
        "📂 إدارة الأقسام الرئيسية\n\n"
        f"تظهر هنا الأقسام الرئيسية فقط: {total}\n"
        "ادخل إلى أي قسم لمشاهدة فروعه بدل تحميل مئات الأقسام دفعة واحدة."
    )
    await safe_edit_message(callback.message, text, admin_categories_kb(categories, page, total))


async def _render_admin_category_children(callback: CallbackQuery, parent_id: int, page: int = 0) -> None:
    page = max(0, int(page))
    offset = page * CATEGORY_ADMIN_PAGE_SIZE
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT COALESCE(NULLIF(display_name, ''), name),
                   COALESCE(local_parent_id, parent_id, 0)
            FROM categories WHERE id = ?
            """,
            (parent_id,),
        ) as cursor:
            parent = await cursor.fetchone()
        if not parent:
            await callback.answer("القسم غير موجود.", show_alert=True)
            return
        parent_name, parent_parent_id = str(parent[0]), int(parent[1] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM categories WHERE COALESCE(local_parent_id, parent_id, 0) = ?",
            (parent_id,),
        ) as cursor:
            total = int((await cursor.fetchone())[0])
        async with db.execute(
            """
            SELECT c.id,
                   COALESCE(NULLIF(c.display_name, ''), c.name) AS display_name,
                   c.is_active,
                   COALESCE(c.is_hidden, 0),
                   (
                       SELECT COUNT(*) FROM categories child
                       WHERE COALESCE(child.local_parent_id, child.parent_id, 0) = c.id
                   ) AS children_count,
                   (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products_count,
                   COALESCE(c.is_virtual, 0)
            FROM categories c
            WHERE COALESCE(c.local_parent_id, c.parent_id, 0) = ?
            ORDER BY COALESCE(c.local_sort_order, c.sort_order, 0), display_name
            LIMIT ? OFFSET ?
            """,
            (parent_id, CATEGORY_ADMIN_PAGE_SIZE, offset),
        ) as cursor:
            children = await cursor.fetchall()
        path = await _category_path(db, parent_id)
    if total and offset >= total:
        return await _render_admin_category_children(callback, parent_id, max(0, math.ceil(total / CATEGORY_ADMIN_PAGE_SIZE) - 1))
    text = (
        f"📂 {parent_name}\n\n"
        f"المسار: {path}\n"
        f"الأقسام المباشرة: {total}\n\n"
        "الرمز  🧩  يعني مجموعة محلية لا يغيرها موقع المزود.\n"
        "الرقمان بجانب القسم: عدد الفروع / عدد المنتجات."
    )
    await safe_edit_message(
        callback.message,
        text,
        admin_category_children_kb(
            parent_id, children, page, total, parent_parent_id, _is_rashq_category_name(parent_name)
        ),
    )


@dp.callback_query(F.data == "admin_categories")
async def cb_admin_categories(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await _render_admin_root_categories(callback, 0)
    await callback.answer()


@dp.callback_query(F.data.startswith("admcat_root_"))
async def cb_admin_categories_page(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    page = int(callback.data.rsplit("_", 1)[1])
    await _render_admin_root_categories(callback, page)
    await callback.answer()


@dp.callback_query(F.data.startswith("admcat_open_"))
async def cb_admin_category_open(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    parent_id, page = int(parts[-2]), int(parts[-1])
    await _render_admin_category_children(callback, parent_id, page)
    await callback.answer()


@dp.callback_query(F.data == "admin_add_category")
async def cb_admin_add_category(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await state.set_state(AdminCategoryStates.waiting_name)
    await state.update_data(new_category_parent=0, new_category_virtual=1)
    await safe_edit_message(
        callback.message,
        "📂 إضافة قسم رئيسي محلي\n\nأرسل الاسم الذي سيظهر للزبائن:",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_categories", "❌ إلغاء")]]),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("admcat_addgroup_"))
async def cb_admin_add_group(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parent_id = int(callback.data.rsplit("_", 1)[1])
    await state.set_state(AdminCategoryStates.waiting_group_name)
    await state.update_data(new_category_parent=parent_id, new_category_virtual=1)
    await safe_edit_message(
        callback.message,
        "🧩 إضافة مجموعة محلية\n\nأرسل اسم المجموعة، مثال: إنستغرام أو تيك توك.",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admcat_open_{parent_id}_0", "❌ إلغاء")]]),
    )
    await callback.answer()


@dp.message(AdminCategoryStates.waiting_name)
@dp.message(AdminCategoryStates.waiting_group_name)
async def process_category_name(message: Message, state: FSMContext):
    name = (message.text or "").strip()
    if len(name) < 2 or len(name) > 80:
        await message.answer("أرسل اسمًا بين حرفين و80 حرفًا.")
        return
    data = await state.get_data()
    parent_id = int(data.get("new_category_parent", 0) or 0)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("BEGIN IMMEDIATE")
        group_id = await _create_local_group(db, parent_id, name, 0, f"custom_{uuid.uuid4().hex[:10]}")
        await db.commit()
    await state.clear()
    back_cb = "admin_categories" if parent_id == 0 else f"admcat_open_{parent_id}_0"
    await message.answer(
        f"✅ تمت إضافة المجموعة: {name}\nالمعرف الداخلي: {group_id}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(back_cb)]]),
    )


@dp.callback_query(F.data == "admcat_search")
async def cb_admin_category_search(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await state.set_state(AdminCategoryStates.waiting_search)
    await safe_edit_message(
        callback.message,
        "🔎 البحث في الأقسام\n\nأرسل جزءًا من اسم القسم. سيبحث البوت في الرئيسي والفرعي.",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_categories", "❌ إلغاء")]]),
    )
    await callback.answer()


@dp.message(AdminCategoryStates.waiting_search)
async def process_admin_category_search(message: Message, state: FSMContext):
    query = (message.text or "").strip()
    if len(query) < 2:
        await message.answer("أرسل حرفين على الأقل.")
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, COALESCE(NULLIF(display_name, ''), name), is_active, COALESCE(is_hidden, 0)
            FROM categories
            WHERE LOWER(COALESCE(NULLIF(display_name, ''), name)) LIKE LOWER(?)
               OR CAST(id AS TEXT) = ?
            ORDER BY COALESCE(local_sort_order, sort_order, 0), name
            LIMIT 25
            """,
            (f"%{query}%", query),
        ) as cursor:
            rows = await cursor.fetchall()
        results = []
        for row in rows:
            results.append((row, await _category_path(db, int(row[0]))))
    await state.clear()
    if not results:
        await message.answer(
            "لم أجد قسمًا مطابقًا.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_categories")]]),
        )
        return
    kb = []
    for row, path in results:
        status = _admin_category_status(row[2], row[3])
        kb.append([
            InlineKeyboardButton(
                text=f"{status} {_short_button_text(path, 42)}",
                callback_data=f"admin_cat_{row[0]}",
            )
        ])
    kb.append([back_btn("admin_categories")])
    await message.answer(
        f"🔎 نتائج البحث عن: {query}\nالنتائج: {len(results)}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=kb),
    )


@dp.callback_query(F.data.startswith("admcat_rashq_"))
async def cb_admin_setup_rashq(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parent_id = int(callback.data.rsplit("_", 1)[1])
    async with aiosqlite.connect(DB_PATH) as db:
        name = await _category_effective_name(db, parent_id)
    if not _is_rashq_category_name(name):
        await callback.answer("هذا الزر مخصص لقسم الرشق.", show_alert=True)
        return
    moved = await _setup_rashq_groups(parent_id)
    summary = "، ".join(
        f"{label}: {moved.get(key, 0)}"
        for key, label, _keywords in RASHQ_GROUP_DEFINITIONS
    )
    await _render_admin_category_children(callback, parent_id, 0)
    await callback.answer(f"تم التنظيم محليًا. {summary}"[:190], show_alert=True)


@dp.callback_query(F.data.startswith("admcat_hide_"))
async def cb_admin_category_hide(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    cat_id = int(callback.data.rsplit("_", 1)[1])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COALESCE(is_hidden, 0) FROM categories WHERE id = ?", (cat_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            await callback.answer("القسم غير موجود.", show_alert=True)
            return
        await db.execute("UPDATE categories SET is_hidden = ? WHERE id = ?", (0 if row[0] else 1, cat_id))
        await db.commit()
    callback.data = f"admin_cat_{cat_id}"
    await cb_admin_cat_detail(callback, None)


@dp.callback_query(F.data.startswith("admcat_sort_"))
async def cb_admin_category_sort(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    cat_id = int(callback.data.rsplit("_", 1)[1])
    await state.set_state(AdminCategoryStates.waiting_sort_order)
    await state.update_data(editing_cat_id=cat_id)
    await safe_edit_message(
        callback.message,
        "🔢 ترتيب الظهور\n\nأرسل رقمًا. الرقم الأصغر يظهر أولًا، مثال: 10 أو 20 أو 30.",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_cat_{cat_id}", "❌ إلغاء")]]),
    )
    await callback.answer()


@dp.message(AdminCategoryStates.waiting_sort_order)
async def process_admin_category_sort(message: Message, state: FSMContext):
    try:
        value = int((message.text or "").strip())
    except ValueError:
        await message.answer("أرسل رقمًا صحيحًا.")
        return
    value = max(-100000, min(value, 100000))
    data = await state.get_data()
    cat_id = int(data.get("editing_cat_id", 0))
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE categories SET local_sort_order = ? WHERE id = ?", (value, cat_id))
        await db.commit()
    await state.clear()
    await message.answer(
        f"✅ تم حفظ ترتيب الظهور: {value}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_cat_{cat_id}")]]),
    )


async def _render_category_move_destinations(callback: CallbackQuery, cat_id: int, page: int = 0) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        excluded = await _category_descendant_ids(db, cat_id)
        excluded.add(cat_id)
        placeholders = ",".join("?" for _ in excluded)
        params = tuple(excluded)
        where_excluded = f"id NOT IN ({placeholders})" if excluded else "1=1"
        async with db.execute(
            f"""
            SELECT id, COALESCE(NULLIF(display_name, ''), name), is_virtual,
                   COALESCE(local_parent_id, parent_id, 0)
            FROM categories
            WHERE {where_excluded}
              AND (COALESCE(local_parent_id, parent_id, 0) = 0 OR COALESCE(is_virtual, 0) = 1)
            ORDER BY COALESCE(local_parent_id, parent_id, 0),
                     COALESCE(local_sort_order, sort_order, 0), name
            """,
            params,
        ) as cursor:
            destinations = await cursor.fetchall()
    total = len(destinations)
    start = max(0, page) * CATEGORY_MOVE_PAGE_SIZE
    page_rows = destinations[start:start + CATEGORY_MOVE_PAGE_SIZE]
    kb = [[InlineKeyboardButton(text="🔝 جعله قسمًا رئيسيًا", callback_data=f"admcat_setmove_{cat_id}_0")]]
    for dest in page_rows:
        icon = "🧩" if dest[2] else "📂"
        kb.append([
            InlineKeyboardButton(
                text=f"{icon} {_short_button_text(str(dest[1]), 35)}",
                callback_data=f"admcat_setmove_{cat_id}_{dest[0]}",
            )
        ])
    pages = max(1, math.ceil(total / CATEGORY_MOVE_PAGE_SIZE))
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️", callback_data=f"admcat_move_{cat_id}_{page-1}"))
    if page + 1 < pages:
        nav.append(InlineKeyboardButton(text="▶️", callback_data=f"admcat_move_{cat_id}_{page+1}"))
    if nav:
        kb.append(nav)
    kb.append([back_btn(f"admin_cat_{cat_id}")])
    await safe_edit_message(
        callback.message,
        "📦 نقل القسم\n\nاختر قسمًا رئيسيًا أو مجموعة محلية. لا يتغير ارتباط المنتجات بالموقع.",
        InlineKeyboardMarkup(inline_keyboard=kb),
    )


@dp.callback_query(F.data.startswith("admcat_move_"))
async def cb_admin_category_move(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    cat_id, page = int(parts[-2]), int(parts[-1])
    await _render_category_move_destinations(callback, cat_id, page)
    await callback.answer()


@dp.callback_query(F.data.startswith("admcat_setmove_"))
async def cb_admin_category_set_move(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    cat_id, parent_id = int(parts[-2]), int(parts[-1])
    async with aiosqlite.connect(DB_PATH) as db:
        descendants = await _category_descendant_ids(db, cat_id)
        if parent_id == cat_id or parent_id in descendants:
            await callback.answer("لا يمكن نقل القسم داخل أحد فروعه.", show_alert=True)
            return
        await db.execute("UPDATE categories SET local_parent_id = ? WHERE id = ?", (parent_id, cat_id))
        await db.commit()
    callback.data = f"admin_cat_{cat_id}"
    await cb_admin_cat_detail(callback, None)


@dp.callback_query(F.data.startswith("admcat_resetparent_"))
async def cb_admin_category_reset_parent(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    cat_id = int(callback.data.rsplit("_", 1)[1])
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE categories SET local_parent_id = NULL WHERE id = ?", (cat_id,))
        await db.commit()
    callback.data = f"admin_cat_{cat_id}"
    await cb_admin_cat_detail(callback, None)


@dp.callback_query(F.data.startswith("admin_cat_"))
async def cb_admin_cat_detail(callback: CallbackQuery, state: FSMContext | None = None):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    cat_id = int(parts[-1])

    if "toggle" in parts:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT is_active FROM categories WHERE id = ?", (cat_id,)) as cursor:
                row = await cursor.fetchone()
            if row:
                await db.execute("UPDATE categories SET is_active = ? WHERE id = ?", (0 if row[0] else 1, cat_id))
                await db.commit()
        await callback.answer("✅ تم تغيير الحالة.")
    elif "delete" in parts:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT COALESCE(is_virtual, 0), COALESCE(local_parent_id, parent_id, 0) FROM categories WHERE id = ?",
                (cat_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if not row:
                await callback.answer("القسم غير موجود.", show_alert=True)
                return
            if not row[0]:
                await db.execute("UPDATE categories SET is_hidden = 1 WHERE id = ?", (cat_id,))
                await db.commit()
                await callback.answer("تم إخفاء قسم المزود بدل حذفه حتى لا يعود بالمزامنة.", show_alert=True)
            else:
                async with db.execute(
                    "SELECT COUNT(*) FROM categories WHERE COALESCE(local_parent_id, parent_id, 0) = ?",
                    (cat_id,),
                ) as cursor:
                    child_count = int((await cursor.fetchone())[0])
                if child_count:
                    await callback.answer("انقل الأقسام الموجودة داخل المجموعة أولًا.", show_alert=True)
                    return
                await db.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
                await db.commit()
                await callback.answer("✅ تم حذف المجموعة المحلية.", show_alert=True)
                parent_id = int(row[1] or 0)
                if parent_id:
                    await _render_admin_category_children(callback, parent_id, 0)
                else:
                    await _render_admin_root_categories(callback, 0)
                return
    elif "edit" in parts:
        if state is None:
            await callback.answer("تعذر فتح التعديل، حاول مرة أخرى.", show_alert=True)
            return
        await state.set_state(AdminCategoryStates.waiting_edit_name)
        await state.update_data(editing_cat_id=cat_id)
        await safe_edit_message(
            callback.message,
            "✏️ تعديل الاسم الظاهر\n\nأرسل الاسم الذي تريد إظهاره في البوت. الاسم الأصلي من الموقع سيبقى محفوظًا.",
            InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_cat_{cat_id}", "❌ إلغاء")]]),
        )
        await callback.answer()
        return

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,
                   name,
                   COALESCE(NULLIF(display_name, ''), name),
                   is_active,
                   COALESCE(local_parent_id, parent_id, 0),
                   COALESCE(is_hidden, 0),
                   COALESCE(is_virtual, 0),
                   local_parent_id,
                   COALESCE(local_sort_order, sort_order, 0),
                   COALESCE(api_provider, '')
            FROM categories WHERE id = ?
            """,
            (cat_id,),
        ) as cursor:
            cat = await cursor.fetchone()
        if not cat:
            await callback.answer("القسم غير موجود.", show_alert=True)
            return
        async with db.execute("SELECT COUNT(*) FROM products WHERE category_id = ?", (cat_id,)) as cursor:
            prod_count = int((await cursor.fetchone())[0])
        async with db.execute(
            "SELECT COUNT(*) FROM categories WHERE COALESCE(local_parent_id, parent_id, 0) = ?",
            (cat_id,),
        ) as cursor:
            child_count = int((await cursor.fetchone())[0])
        path = await _category_path(db, cat_id)
        original_parent = int(cat[4] or 0)
        parent_name = "قسم رئيسي" if original_parent == 0 else await _category_effective_name(db, original_parent)

    status = "✅ مفعل" if cat[3] else "❌ معطل"
    visibility = "🙈 مخفي" if cat[5] else "👁 ظاهر"
    kind = "مجموعة محلية" if cat[6] else ("قسم مرتبط بالموقع" if cat[9] == "js4card" else "قسم محلي")
    original_line = ""
    if str(cat[1]) != str(cat[2]) and not str(cat[1]).startswith("__local_group_"):
        original_line = f"\nالاسم الأصلي: {cat[1]}"
    text = (
        f"📂 {cat[2]}\n\n"
        f"المسار: {path}\n"
        f"النوع: {kind}\n"
        f"الحالة: {status}\n"
        f"الظهور: {visibility}\n"
        f"القسم الأب: {parent_name}\n"
        f"الفروع المباشرة: {child_count}\n"
        f"المنتجات المباشرة: {prod_count}\n"
        f"ترتيب الظهور: {cat[8]}"
        f"{original_line}"
    )
    await safe_edit_message(
        callback.message,
        text,
        admin_category_detail_kb(
            cat_id, bool(cat[3]), bool(cat[5]), original_parent,
            child_count, bool(cat[6]), cat[7] is not None,
        ),
    )
    if not any(token in parts for token in ("toggle", "delete")):
        await callback.answer()


@dp.message(AdminCategoryStates.waiting_edit_name)
async def process_category_edit_name(message: Message, state: FSMContext):
    data = await state.get_data()
    cat_id = int(data.get("editing_cat_id", 0))
    name = (message.text or "").strip()
    if len(name) < 2 or len(name) > 80:
        await message.answer("أرسل اسمًا بين حرفين و80 حرفًا.")
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE categories SET display_name = ? WHERE id = ?", (name, cat_id))
        await db.commit()
    await state.clear()
    await message.answer(
        "✅ تم تحديث الاسم الظاهر، ولن تضيع التسمية عند المزامنة.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_cat_{cat_id}")]]),
    )

# =============================================================================
# إدارة المنتجات (مخزون ويدوي)
# =============================================================================

@dp.callback_query(F.data == "admin_products")
async def cb_admin_products(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, category_id, name, description, price, stock, is_active, created_at, product_type, api_provider "
            "FROM products ORDER BY api_provider DESC, name ASC"
        ) as cursor:
            products = await cursor.fetchall()
    total = len(products)
    api_count = sum(1 for p in products if p[9] == 'js4card')
    manual_count = total - api_count
    text = (
        f"📦 **المنتجات** ({total})، 🌐 API: {api_count}، ✍️ يدوي: {manual_count}\n\n"
        f"اضغط على أي منتج لتعديله:"
    )
    await safe_edit_message(callback.message, text, admin_products_kb(products))
    await callback.answer()

@dp.callback_query(F.data == "noop")
async def cb_noop(callback: CallbackQuery):
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_products_p"))
async def cb_admin_products_page(callback: CallbackQuery):
    page = int(callback.data.split("_p")[1])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, category_id, name, description, price, stock, is_active, created_at, product_type, api_provider "
            "FROM products ORDER BY api_provider DESC, name ASC"
        ) as cursor:
            products = await cursor.fetchall()
    total = len(products)
    api_count = sum(1 for p in products if p[9] == 'js4card')
    manual_count = total - api_count
    text = (
        f"📦 **المنتجات** ({total})، 🌐 API: {api_count}، ✍️ يدوي: {manual_count}\n\n"
        f"اضغط على أي منتج لتعديله:"
    )
    await safe_edit_message(callback.message, text, admin_products_kb(products, page))
    await callback.answer()

@dp.callback_query(F.data == "admin_add_product")
async def cb_admin_add_product(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id, name FROM categories WHERE is_active = 1") as cursor:
            categories = await cursor.fetchall()
    if not categories:
        await callback.answer("لا توجد أقسام. أضف قسماً أولاً.", show_alert=True)
        return
    await state.set_state(AdminProductStates.waiting_category)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        *[[InlineKeyboardButton(text=c[1], callback_data=f"aprod_cat_{c[0]}")] for c in categories],
        [back_btn("admin_products", "❌ إلغاء")]
    ])
    await safe_edit_message(callback.message, "📦 **إضافة منتج جديد**\n\nاختر القسم:", kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("aprod_cat_"), AdminProductStates.waiting_category)
async def process_product_category(callback: CallbackQuery, state: FSMContext):
    cat_id = int(callback.data.split("_")[2])
    await state.update_data(product_category_id=cat_id)
    await state.set_state(AdminProductStates.waiting_type)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📦 مخزون (تسليم فوري)", callback_data="aprod_type_stock")],
        [InlineKeyboardButton(text="🖐 يدوي (تسليم يدوي)", callback_data="aprod_type_manual")],
        [back_btn("admin_add_product", "❌ إلغاء")]
    ])
    await callback.message.edit_text("🏷 **اختر نوع المنتج:**", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("aprod_type_"), AdminProductStates.waiting_type)
async def process_product_type(callback: CallbackQuery, state: FSMContext):
    product_type = callback.data.split("_")[2]
    await state.update_data(product_type=product_type)
    await state.set_state(AdminProductStates.waiting_name)
    await callback.message.edit_text("📝 أرسل **اسم المنتج**:")
    await callback.answer()

@dp.message(AdminProductStates.waiting_name)
async def process_product_name(message: Message, state: FSMContext):
    await state.update_data(product_name=message.text.strip())
    await state.set_state(AdminProductStates.waiting_description)
    await message.answer("📝 أرسل **وصف المنتج**:")

@dp.message(AdminProductStates.waiting_description)
async def process_product_description(message: Message, state: FSMContext):
    await state.update_data(product_description=message.text.strip())
    await state.set_state(AdminProductStates.waiting_price)
    await message.answer("💰 أرسل **سعر المنتج** بالدولار $:")

@dp.message(AdminProductStates.waiting_price)
async def process_product_price(message: Message, state: FSMContext):
    try:
        price = float(message.text.strip())
        if price < 0:
            raise ValueError()
    except ValueError:
        await message.answer("يرجى إرسال سعر رقمي صحيح.")
        return
    await state.update_data(product_price=price)
    await state.set_state(AdminProductStates.waiting_stock)
    await message.answer("📦 أرسل **كمية المخزون** (رقم صحيح):")

@dp.message(AdminProductStates.waiting_stock)
async def process_product_stock(message: Message, state: FSMContext):
    try:
        stock = int(message.text.strip())
        if stock < 0:
            raise ValueError()
    except ValueError:
        await message.answer("يرجى إرسال رقم صحيح.")
        return
    await state.update_data(product_stock=stock)
    data = await state.get_data()
    product_type = data.get('product_type', 'stock')
    if product_type == 'manual':
        await state.set_state(AdminProductStates.waiting_delivery_info)
        await message.answer("📋 أرسل **تعليمات التسليم** (ما يحتاجه المستخدم لإتمام الطلب):\nمثال: أرسل اسم المستخدم في اللعبة")
    else:
        await save_product(message, state)

@dp.message(AdminProductStates.waiting_delivery_info)
async def process_product_delivery_info(message: Message, state: FSMContext):
    await state.update_data(product_delivery_info=message.text.strip())
    await save_product(message, state)

async def save_product(message: Message, state: FSMContext):
    data = await state.get_data()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO products (category_id, name, description, price, stock, is_active, created_at, product_type, delivery_info) "
            "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
            (
                data.get('product_category_id'),
                data.get('product_name'),
                data.get('product_description'),
                data.get('product_price'),
                data.get('product_stock', 0),
                now,
                data.get('product_type', 'stock'),
                data.get('product_delivery_info', '')
            )
        )
        await db.commit()
    await state.clear()
    type_label = "📦 مخزون" if data.get('product_type') == 'stock' else "🖐 يدوي"
    await message.answer(
        f"✅ **تمت إضافة المنتج بنجاح!**\n\n"
        f"الاسم: {data.get('product_name')}\n"
        f"السعر: {data.get('product_price')} $\n"
        f"المخزون: {data.get('product_stock', 0)}\n"
        f"النوع: {type_label}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]])
    )
    await log_activity(message.from_user.id, "add_product", f"إضافة منتج: {data.get('product_name')}")

@dp.callback_query(F.data.startswith("admin_prod_"))
async def cb_admin_prod_detail(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    prod_id = int(parts[-1])

    if "toggle" in parts:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT is_active FROM products WHERE id = ?", (prod_id,)) as cursor:
                row = await cursor.fetchone()
            if row:
                await db.execute("UPDATE products SET is_active = ? WHERE id = ?", (0 if row[0] else 1, prod_id))
                await db.commit()
        await callback.answer("✅ تم تغيير الحالة.")
    elif "delete" in parts:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM products WHERE id = ?", (prod_id,))
            await db.commit()
        await callback.answer("✅ تم حذف المنتج.", show_alert=True)
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT id, category_id, name, description, price, stock, is_active, created_at, product_type FROM products ORDER BY created_at DESC") as cursor:
                products = await cursor.fetchall()
        await safe_edit_message(callback.message, f"📦 **المنتجات** ({len(products)}):", admin_products_kb(products))
        return
    elif "variants" in parts:
        # معالج المتغيرات
        variants = await get_product_variants(DB_PATH, prod_id)
        if variants:
            text = f"🎯 **متغيرات المنتج #{prod_id}**\n\n"
            kb = []
            for v in variants:
                status = "✅" if v['is_active'] else "❌"
                text += f"• {v['name']} - {v['price']}$ ({v['stock']} متوفر) {status}\n"
                kb.append([InlineKeyboardButton(text=f"✏️ {v['name']}", callback_data=f"admin_edit_variant_{v['id']}")])
            kb.append([InlineKeyboardButton(text="➕ إضافة متغير جديد", callback_data=f"admin_add_variant_{prod_id}")])
            kb.append([back_btn(f"admin_prod_{prod_id}", "🔙 رجوع")])
            await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb))
        else:
            text = f"🎯 **إضافة متغيرات للمنتج**\n\nلم يتم إضافة أي متغيرات بعد. اضغط على الزر أدناه لإضافة واحد."
            kb = [[InlineKeyboardButton(text="➕ إضافة متغير جديد", callback_data=f"admin_add_variant_{prod_id}")],
                  [back_btn(f"admin_prod_{prod_id}", "🔙 رجوع")]]
            await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb))
        await callback.answer()
        return

    elif "edit" in parts:
        field = parts[3] if len(parts) > 4 else "name"
        field_labels = {"name": "الاسم", "desc": "الوصف", "price": "السعر", "stock": "المخزون", "delivery": "معلومات التسليم", "time": "وقت التسليم", "btns": "أزرار الشراء"}
        state_map = {
            "name": AdminProductEditStates.waiting_new_name,
            "desc": AdminProductEditStates.waiting_new_desc,
            "price": AdminProductEditStates.waiting_new_price,
            "stock": AdminProductEditStates.waiting_new_stock,
            "delivery": AdminProductEditStates.waiting_new_delivery,
            "time": AdminProductEditStates.waiting_new_time,
            "btns": AdminProductEditStates.waiting_new_btns,
        }
        await state.set_state(state_map.get(field, AdminProductEditStates.waiting_new_name))
        await state.update_data(editing_prod_id=prod_id, editing_field=field)
        
        prompt = f"✏️ **تعديل {field_labels.get(field, field)}**\n\nأرسل القيمة الجديدة:"
        if field == "btns":
            prompt += "\nأرسل 3 أسطر، كل سطر يمثل نص زر."
            
        await safe_edit_message(
            callback.message,
            prompt,
            InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_prod_{prod_id}", "❌ إلغاء")]])
        )
        await callback.answer()
        return

    # عرض تفاصيل المنتج
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, category_id, name, description, price, stock, is_active, created_at, product_type, delivery_info, delivery_time, buy_button_1, buy_button_2, buy_button_3 "
            "FROM products WHERE id = ?", (prod_id,)
        ) as cursor:
            prod = await cursor.fetchone()
        if not prod:
            await callback.answer("المنتج غير موجود.", show_alert=True)
            return
        status = "✅ مفعل" if prod[6] else "❌ معطل"
        type_label = "📦 مخزون" if prod[8] == 'stock' else "🖐 يدوي"
        text = (
            f"📦 **{prod[2]}**\n\n"
            f"الوصف: {prod[3]}\n"
            f"السعر: {prod[4]} $\n"
            f"المخزون: {prod[5]}\n"
            f"النوع: {type_label}\n"
            f"وقت التسليم: {prod[10] or 'فوري'}\n"
            f"الحالة: {status}"
        )
        if prod[9]:
            text += f"\nتعليمات التسليم: {prod[9]}"
            
    custom_btns = [prod[11], prod[12], prod[13]]
    if any(custom_btns):
        text += f"\n\n🔘 أزرار الشراء المخصصة:\n"
        for i, b in enumerate(custom_btns):
            if b and b.strip(): text += f"{i+1}. {b}\n"
            
    await safe_edit_message(callback.message, text, admin_product_detail_kb(prod_id, bool(prod[6])))
    await callback.answer()

# معالجات تعديل المنتج
@dp.message(AdminProductEditStates.waiting_new_name)
async def process_prod_edit_name(message: Message, state: FSMContext):
    data = await state.get_data()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE products SET name = ? WHERE id = ?", (message.text.strip(), data['editing_prod_id']))
        await db.commit()
    await state.clear()
    await message.answer("✅ تم تحديث الاسم.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))

@dp.message(AdminProductEditStates.waiting_new_desc)
async def process_prod_edit_desc(message: Message, state: FSMContext):
    data = await state.get_data()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE products SET description = ? WHERE id = ?", (message.text.strip(), data['editing_prod_id']))
        await db.commit()
    await state.clear()
    await message.answer("✅ تم تحديث الوصف.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))

@dp.message(AdminProductEditStates.waiting_new_price)
async def process_prod_edit_price(message: Message, state: FSMContext):
    try:
        price = float(message.text.strip())
    except ValueError:
        await message.answer("يرجى إرسال سعر رقمي.")
        return
    data = await state.get_data()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE products SET price = ? WHERE id = ?", (price, data['editing_prod_id']))
        await db.commit()
    await state.clear()
    await message.answer("✅ تم تحديث السعر.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))

@dp.message(AdminProductEditStates.waiting_new_stock)
async def process_prod_edit_stock(message: Message, state: FSMContext):
    try:
        stock = int(message.text.strip())
    except ValueError:
        await message.answer("يرجى إرسال رقم صحيح.")
        return
    data = await state.get_data()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE products SET stock = ? WHERE id = ?", (stock, data['editing_prod_id']))
        await db.commit()
    await state.clear()
    await message.answer("✅ تم تحديث المخزون.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))

@dp.message(AdminProductEditStates.waiting_new_delivery)
async def process_prod_edit_delivery(message: Message, state: FSMContext):
    data = await state.get_data()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE products SET delivery_info = ? WHERE id = ?", (message.text.strip(), data['editing_prod_id']))
        await db.commit()
    await state.clear()
    await message.answer("✅ تم تحديث معلومات التسليم.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))

@dp.message(AdminProductEditStates.waiting_new_time)
async def process_prod_edit_time(message: Message, state: FSMContext):
    data = await state.get_data()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE products SET delivery_time = ? WHERE id = ?", (message.text.strip(), data['editing_prod_id']))
        await db.commit()
    await state.clear()
    await message.answer("✅ تم تحديث وقت التسليم.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))

@dp.message(AdminProductEditStates.waiting_new_btns)
async def process_prod_edit_btns(message: Message, state: FSMContext):
    data = await state.get_data()
    lines = message.text.strip().split('\n')
    btn1 = lines[0].strip() if len(lines) > 0 else ''
    btn2 = lines[1].strip() if len(lines) > 1 else ''
    btn3 = lines[2].strip() if len(lines) > 2 else ''
    
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE products SET buy_button_1 = ?, buy_button_2 = ?, buy_button_3 = ? WHERE id = ?",
            (btn1, btn2, btn3, data['editing_prod_id'])
        )
        await db.commit()
    await state.clear()
    await message.answer("✅ تم تحديث أزرار الشراء المخصصة.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))


# =============================================================================
# إدارة طلبات المنتجات من الأدمن
# =============================================================================

@dp.callback_query(F.data == "admin_orders")
async def cb_admin_orders(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT o.id, o.user_id, o.product_id, o.quantity, o.total_price, o.status, o.order_date, p.name "
            "FROM orders o LEFT JOIN products p ON o.product_id = p.id ORDER BY o.order_date DESC"
        ) as cursor:
            orders = await cursor.fetchall()
    pending = sum(1 for o in orders if o[5] == 'pending')
    text = f"🛒 **طلبات المنتجات**\n\nالإجمالي: {len(orders)} | ⏳ قيد الانتظار: {pending}"
    await safe_edit_message(callback.message, text, admin_orders_kb(orders))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_orders_p"))
async def cb_admin_orders_page(callback: CallbackQuery):
    page = int(callback.data.split("_p")[1])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT o.id, o.user_id, o.product_id, o.quantity, o.total_price, o.status, o.order_date, p.name "
            "FROM orders o LEFT JOIN products p ON o.product_id = p.id ORDER BY o.order_date DESC"
        ) as cursor:
            orders = await cursor.fetchall()
    await safe_edit_message(callback.message, f"🛒 **طلبات المنتجات** ({len(orders)}):", admin_orders_kb(orders, page))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_order_"))
async def cb_admin_order_detail(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    order_id = int(parts[-1])
    if "status" in parts:
        await safe_edit_message(callback.message, "🔄 **تغيير حالة الطلب:**", admin_order_status_kb(order_id))
        await callback.answer()
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT o.id, o.user_id, o.product_id, o.quantity, o.total_price, o.status, o.order_date, p.name, o.delivery_info, "
            "COALESCE(o.api_status, ''), COALESCE(o.api_status_message, ''), COALESCE(o.api_status_updated_at, ''), "
            "COALESCE(o.api_order_id, ''), COALESCE(o.api_order_uuid, '') "
            "FROM orders o LEFT JOIN products p ON o.product_id = p.id WHERE o.id = ?",
            (order_id,)
        ) as cursor:
            order = await cursor.fetchone()
    if not order:
        await callback.answer("الطلب غير موجود.", show_alert=True)
        return
    status_map = {"pending": "⏳ قيد الانتظار", "processing": "🔄 قيد المعالجة", "completed": "✅ مكتمل", "cancelled": "❌ ملغي"}
    text = (
        f"🛒 **تفاصيل الطلب #{order[0]}**\n\n"
        f"المستخدم: {order[1]}\n"
        f"المنتج: {order[7] or 'غير معروف'}\n"
        f"الكمية: {order[3]}\n"
        f"المبلغ: {order[4]} $\n"
        f"الحالة: {status_map.get(order[5], order[5])}\n"
        f"التاريخ: {order[6]}"
    )
    if order[9]:
        api_info = classify_api_order_status(order[9])
        text += f"\nحالة الموقع: {api_info['label']} ({order[9]})"
        if order[11]:
            text += f"\nآخر فحص: {order[11]}"
    if order[10]:
        text += f"\nملاحظة الموقع: {order[10]}"
    if order[12] or order[13]:
        text += f"\nرقم طلب الموقع: {order[12] or order[13]}"
    if order[8]:
        text += f"\n\n📋 **معلومات التسليم:**\n{order[8]}"
    await safe_edit_message(callback.message, text, admin_order_detail_kb(order_id))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_set_order_status_"))
async def cb_admin_set_order_status(callback: CallbackQuery):
    parts = callback.data.split("_")
    order_id = int(parts[4])
    new_status = parts[5]
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id FROM orders WHERE id = ?", (order_id,)) as cursor:
            row = await cursor.fetchone()
        await db.execute("UPDATE orders SET status = ? WHERE id = ?", (new_status, order_id))
        await db.commit()
    status_map = {"pending": "⏳ قيد الانتظار", "processing": "🔄 قيد المعالجة", "completed": "✅ مكتمل", "cancelled": "❌ ملغي"}
    await callback.answer(f"✅ تم تغيير الحالة إلى: {status_map.get(new_status, new_status)}", show_alert=True)
    if row:
        await safe_send_message(row[0], f"📦 **تحديث طلبك #{order_id}:**\nالحالة الجديدة: {status_map.get(new_status, new_status)}")

# =============================================================================
# إدارة الكوبونات
# =============================================================================

@dp.callback_query(F.data == "admin_coupons")
async def cb_admin_coupons(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id, code, discount, max_uses, used_count, is_active FROM coupons ORDER BY created_at DESC") as cursor:
            coupons = await cursor.fetchall()
    await safe_edit_message(callback.message, f"🎫 **الكوبونات** ({len(coupons)}):", admin_coupons_kb(coupons))
    await callback.answer()

@dp.callback_query(F.data == "admin_add_coupon")
async def cb_admin_add_coupon(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await state.set_state(AdminCouponStates.waiting_code)
    await safe_edit_message(
        callback.message,
        "🎫 **إضافة كوبون جديد**\n\nأرسل كود الكوبون:",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_coupons", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminCouponStates.waiting_code)
async def process_coupon_code(message: Message, state: FSMContext):
    await state.update_data(coupon_code=message.text.strip().upper())
    await state.set_state(AdminCouponStates.waiting_discount)
    await message.answer("💰 أرسل نسبة الخصم (مثال: 10 لـ 10%):")

@dp.message(AdminCouponStates.waiting_discount)
async def process_coupon_discount(message: Message, state: FSMContext):
    try:
        discount = float(message.text.strip())
        if discount <= 0 or discount > 100:
            raise ValueError()
    except ValueError:
        await message.answer("يرجى إرسال نسبة بين 1 و 100.")
        return
    await state.update_data(coupon_discount=discount)
    await state.set_state(AdminCouponStates.waiting_max_uses)
    await message.answer("🔢 أرسل عدد مرات الاستخدام الأقصى:")

@dp.message(AdminCouponStates.waiting_max_uses)
async def process_coupon_max_uses(message: Message, state: FSMContext):
    try:
        max_uses = int(message.text.strip())
    except ValueError:
        await message.answer("يرجى إرسال رقم صحيح.")
        return
    data = await state.get_data()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                "INSERT INTO coupons (code, discount, max_uses, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
                (data['coupon_code'], data['coupon_discount'], max_uses, now)
            )
            await db.commit()
            await message.answer(
                f"✅ **تمت إضافة الكوبون!**\n\nالكود: `{data['coupon_code']}`\nالخصم: {data['coupon_discount']}%\nالاستخدامات: {max_uses}",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_coupons")]])
            )
        except Exception:
            await message.answer("❌ الكود موجود بالفعل.")
    await state.clear()

@dp.callback_query(F.data.startswith("admin_coupon_"))
async def cb_admin_coupon_detail(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    parts = callback.data.split("_")
    coupon_id = int(parts[-1])
    if "toggle" in parts:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT is_active FROM coupons WHERE id = ?", (coupon_id,)) as cursor:
                row = await cursor.fetchone()
            if row:
                await db.execute("UPDATE coupons SET is_active = ? WHERE id = ?", (0 if row[0] else 1, coupon_id))
                await db.commit()
        await callback.answer("✅ تم تغيير الحالة.")
    elif "delete" in parts:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM coupons WHERE id = ?", (coupon_id,))
            await db.commit()
        await callback.answer("✅ تم حذف الكوبون.", show_alert=True)
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT id, code, discount, max_uses, used_count, is_active FROM coupons ORDER BY created_at DESC") as cursor:
                coupons = await cursor.fetchall()
        await safe_edit_message(callback.message, f"🎫 **الكوبونات** ({len(coupons)}):", admin_coupons_kb(coupons))
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id, code, discount, max_uses, used_count, is_active FROM coupons WHERE id = ?", (coupon_id,)) as cursor:
            coupon = await cursor.fetchone()
    if not coupon:
        await callback.answer("الكوبون غير موجود.", show_alert=True)
        return
    status = "✅ مفعل" if coupon[5] else "❌ معطل"
    text = f"🎫 **كوبون: {coupon[1]}**\n\nالخصم: {coupon[2]}%\nالاستخدامات: {coupon[4]}/{coupon[3]}\nالحالة: {status}"
    await safe_edit_message(callback.message, text, admin_coupon_detail_kb(coupon_id, bool(coupon[5])))
    await callback.answer()

# =============================================================================
# إدارة المشرفين المطورة
# =============================================================================

@dp.callback_query(F.data == "admin_admins")
async def cb_admin_admins(callback: CallbackQuery):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """SELECT a.admin_id, a.added_at, u.username, u.full_name,
                      COALESCE(a.role_name, 'custom'), COALESCE(a.is_active, 1)
               FROM admins a LEFT JOIN users u ON a.admin_id = u.user_id
               ORDER BY COALESCE(a.is_active, 1) DESC, a.added_at DESC"""
        ) as cursor:
            admins = await cursor.fetchall()
    active_count = sum(1 for row in admins if bool(row[5]))
    text = f"""👮 **نظام المشرفين**

🟢 المشرفون النشطون: {active_count}
📋 إجمالي الحسابات: {len(admins)}

كل مشرف يرى فقط الأقسام التي تسمح بها صلاحياته. يمكنك اختيار دور جاهز أو تخصيص الصلاحيات واحدة واحدة."""
    await safe_edit_message(callback.message, text, admin_admins_kb(admins))
    await callback.answer()


@dp.callback_query(F.data == "admin_add_admin")
async def cb_admin_add_admin(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminAddAdminStates.waiting_admin_id)
    text = """👮 **إضافة مشرف جديد**

أرسل معرف تيليجرام الرقمي للمستخدم.
بعدها ستختار دوره وصلاحياته."""
    await safe_edit_message(
        callback.message,
        text,
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_admins", "❌ إلغاء")]])
    )
    await callback.answer()


@dp.message(AdminAddAdminStates.waiting_admin_id)
async def process_add_admin(message: Message, state: FSMContext):
    try:
        new_admin_id = int((message.text or '').strip())
    except ValueError:
        await message.answer("يرجى إرسال معرف رقمي صحيح.")
        return
    if new_admin_id == ADMIN_ID:
        await message.answer("هذا هو حساب المالك الرئيسي بالفعل.")
        return
    if new_admin_id <= 0:
        await message.answer("المعرف غير صحيح.")
        return

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT OR IGNORE INTO admins
               (admin_id, added_by, added_at, role_name, is_active)
               VALUES (?, ?, ?, 'custom', 1)""",
            (new_admin_id, message.from_user.id, now),
        )
        await db.commit()
    await state.clear()
    await log_activity(message.from_user.id, 'admin_added', f'إضافة مشرف #{new_admin_id}')
    await message.answer(
        f"✅ تمت إضافة الحساب `{new_admin_id}`.\n\nاختر الدور المناسب:",
        reply_markup=admin_role_picker_kb(new_admin_id),
    )


@dp.callback_query(F.data.startswith("admin_role_menu_"))
async def cb_admin_role_menu(callback: CallbackQuery):
    admin_id = int(callback.data.rsplit('_', 1)[1])
    text = """🎭 **اختيار دور المشرف**

الدور يضبط مجموعة صلاحيات جاهزة، ويمكنك تعديل أي صلاحية بعد ذلك."""
    await safe_edit_message(callback.message, text, admin_role_picker_kb(admin_id))
    await callback.answer()


@dp.callback_query(F.data.startswith("admin_apply_role_"))
async def cb_admin_apply_role(callback: CallbackQuery):
    parts = callback.data.split('_')
    role_code = parts[3]
    admin_id = int(parts[4])
    if admin_id == ADMIN_ID:
        await callback.answer("لا يمكن تغيير دور المالك الرئيسي.", show_alert=True)
        return
    preset = ADMIN_ROLE_PRESETS.get(role_code)
    if not preset:
        await callback.answer("الدور غير معروف.", show_alert=True)
        return
    columns = list(preset['permissions'].keys())
    values = [int(preset['permissions'][column]) for column in columns]
    assignments = ', '.join(f"{column} = ?" for column in columns)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE admins SET role_name = ?, {assignments}, is_active = 1 WHERE admin_id = ?",
            [role_code, *values, admin_id],
        )
        await db.commit()
    await log_activity(
        callback.from_user.id,
        'admin_role_changed',
        f'المشرف #{admin_id} ← {preset["label"]}',
    )
    await safe_send_message(
        admin_id,
        f"👮 تم تعيين دورك في UCHIHA STORE: **{preset['label']}**\nاستخدم /admin لفتح لوحة الإدارة.",
    )
    await callback.answer(f"✅ تم تعيين الدور: {preset['label']}", show_alert=True)
    callback.data = f"admin_admin_{admin_id}"
    await cb_admin_admin_detail(callback)


@dp.callback_query(F.data.startswith("admin_admin_"))
async def cb_admin_admin_detail(callback: CallbackQuery):
    try:
        admin_id = int(callback.data.split("_")[2])
    except (ValueError, IndexError):
        await callback.answer("خطأ في البيانات.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT a.*, u.username, u.full_name, u.store_user_id
               FROM admins a LEFT JOIN users u ON a.admin_id = u.user_id
               WHERE a.admin_id = ?""",
            (admin_id,),
        ) as cursor:
            adm = await cursor.fetchone()
        async with db.execute(
            "SELECT COUNT(*) FROM activity_log WHERE user_id = ?",
            (admin_id,),
        ) as cursor:
            act_count = int((await cursor.fetchone())[0] or 0)
    if not adm:
        await callback.answer("المشرف غير موجود.", show_alert=True)
        return

    name = adm['full_name'] or adm['username'] or str(adm['admin_id'])
    username = f"@{adm['username']}" if adm['username'] else "غير محدد"
    store_id = adm['store_user_id'] or f"USR{adm['admin_id']:06d}"
    role_code = adm['role_name'] or 'custom'
    active = bool(adm['is_active'])
    permission_lines = []
    for permission, label in ADMIN_PERMISSION_LABELS.items():
        permission_lines.append(f"{'✅' if adm[permission] else '❌'} {label}")

    text = f"""👮 **تفاصيل المشرف**

🟢 الحالة: {'نشط' if active else 'موقوف'}
🎭 الدور: **{admin_role_label(role_code)}**
🆔 معرف المتجر: `{store_id}`
🔢 معرف تيليجرام: `{adm['admin_id']}`
👤 الاسم: {name}
💬 اليوزر: {username}
📅 تاريخ الإضافة: {adm['added_at'] or '-'}
🕒 آخر نشاط: {adm['last_action_at'] or 'لا يوجد'}
📊 عدد العمليات: {act_count}
📝 ملاحظة: {adm['note'] or 'لا توجد'}

🔐 **الصلاحيات:**
""" + '\n'.join(permission_lines)
    await safe_edit_message(callback.message, text, admin_admin_detail_kb(admin_id, active))
    await callback.answer()


@dp.callback_query(F.data.startswith("admin_toggle_admin_"))
async def cb_admin_toggle_active(callback: CallbackQuery):
    admin_id = int(callback.data.rsplit('_', 1)[1])
    if admin_id == ADMIN_ID:
        await callback.answer("لا يمكن إيقاف المالك الرئيسي.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COALESCE(is_active, 1) FROM admins WHERE admin_id = ?", (admin_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            await callback.answer("المشرف غير موجود.", show_alert=True)
            return
        new_value = 0 if bool(row[0]) else 1
        await db.execute("UPDATE admins SET is_active = ? WHERE admin_id = ?", (new_value, admin_id))
        await db.commit()
    await log_activity(
        callback.from_user.id,
        'admin_status_changed',
        f'المشرف #{admin_id} ← {"نشط" if new_value else "موقوف"}',
    )
    await safe_send_message(
        admin_id,
        "✅ تم تفعيل حسابك كمشرف." if new_value else "⏸ تم إيقاف حسابك كمشرف.",
    )
    await callback.answer("تم تحديث حالة المشرف.", show_alert=True)
    callback.data = f"admin_admin_{admin_id}"
    await cb_admin_admin_detail(callback)


@dp.callback_query(F.data.startswith("admin_perm_"))
async def cb_admin_toggle_perm(callback: CallbackQuery):
    parts = callback.data.split("_")
    if len(parts) < 4:
        await callback.answer("بيانات غير صحيحة.", show_alert=True)
        return
    perm_type = parts[2]
    admin_id = int(parts[3])
    if admin_id == ADMIN_ID:
        await callback.answer("صلاحيات المالك الرئيسي ثابتة.", show_alert=True)
        return
    perm_map = {
        'products': 'can_manage_products',
        'users': 'can_manage_users',
        'balance': 'can_manage_balance',
        'broadcast': 'can_send_broadcast',
        'orders': 'can_manage_orders',
        'categories': 'can_manage_categories',
        'stats': 'can_view_stats',
        'tickets': 'can_manage_tickets',
        'payments': 'can_manage_payments',
        'settings': 'can_manage_settings',
        'sync': 'can_manage_sync',
    }
    column = perm_map.get(perm_type)
    if not column:
        await callback.answer("صلاحية غير معروفة.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(f"SELECT {column} FROM admins WHERE admin_id = ?", (admin_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            await callback.answer("المشرف غير موجود.", show_alert=True)
            return
        new_value = 0 if bool(row[0]) else 1
        await db.execute(
            f"UPDATE admins SET {column} = ?, role_name = 'custom' WHERE admin_id = ?",
            (new_value, admin_id),
        )
        await db.commit()
    await log_activity(
        callback.from_user.id,
        'admin_permission_changed',
        f'المشرف #{admin_id}: {ADMIN_PERMISSION_LABELS.get(column, column)} ← {new_value}',
    )
    await callback.answer(
        f"{'✅ تفعيل' if new_value else '❌ تعطيل'}: {ADMIN_PERMISSION_LABELS.get(column, column)}",
        show_alert=True,
    )
    callback.data = f"admin_admin_{admin_id}"
    await cb_admin_admin_detail(callback)


@dp.callback_query(F.data.startswith("admin_set_admin_note_"))
async def cb_admin_set_note(callback: CallbackQuery, state: FSMContext):
    admin_id = int(callback.data.rsplit('_', 1)[1])
    await state.update_data(target_admin_id=admin_id)
    await state.set_state(AdminManageStates.waiting_note)
    text = """📝 أرسل ملاحظة داخلية عن هذا المشرف.
أرسل علامة - لمسح الملاحظة."""
    await safe_edit_message(
        callback.message,
        text,
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_admin_{admin_id}", "❌ إلغاء")]]),
    )
    await callback.answer()


@dp.message(AdminManageStates.waiting_note)
async def process_admin_note(message: Message, state: FSMContext):
    data = await state.get_data()
    admin_id = int(data.get('target_admin_id', 0))
    note = (message.text or '').strip()
    if note == '-':
        note = ''
    if len(note) > 500:
        await message.answer("الملاحظة طويلة. الحد الأقصى 500 حرف.")
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE admins SET note = ? WHERE admin_id = ?", (note, admin_id))
        await db.commit()
    await state.clear()
    await log_activity(message.from_user.id, 'admin_note_changed', f'المشرف #{admin_id}')
    await message.answer(
        "✅ تم حفظ الملاحظة.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_admin_{admin_id}")]]),
    )


@dp.callback_query(F.data.startswith("admin_admin_log_"))
async def cb_admin_admin_log(callback: CallbackQuery):
    admin_id = int(callback.data.split("_")[3])
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT action, details, created_at FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
            (admin_id,),
        ) as cursor:
            logs = await cursor.fetchall()
    if not logs:
        await callback.answer("لا توجد عمليات مسجلة لهذا المشرف.", show_alert=True)
        return
    text = f"📊 **سجل عمليات المشرف #{admin_id}** (آخر 30):\n\n"
    for action, details, created_at in logs:
        text += f"• {created_at[:16]} | {action} | {details}\n"
    await safe_edit_message(
        callback.message,
        text[:3900],
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_admin_{admin_id}", "🔙 رجوع")]]),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("admin_remove_admin_confirm_"))
async def cb_admin_remove_admin_confirm(callback: CallbackQuery):
    admin_id = int(callback.data.rsplit('_', 1)[1])
    if admin_id == ADMIN_ID:
        await callback.answer("لا يمكن إزالة المالك الرئيسي.", show_alert=True)
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ نعم، إزالة المشرف", callback_data=f"admin_remove_admin_{admin_id}")],
        [back_btn(f"admin_admin_{admin_id}", "❌ إلغاء")],
    ])
    await safe_edit_message(
        callback.message,
        f"""⚠️ **تأكيد إزالة المشرف**

هل تريد إزالة المشرف `{admin_id}` نهائياً؟""",
        kb,
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("admin_remove_admin_"))
async def cb_admin_remove_admin(callback: CallbackQuery):
    admin_id = int(callback.data.rsplit('_', 1)[1])
    if admin_id == ADMIN_ID:
        await callback.answer("لا يمكن إزالة المالك الرئيسي.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM admins WHERE admin_id = ?", (admin_id,))
        await db.commit()
    await log_activity(callback.from_user.id, 'admin_removed', f'إزالة مشرف #{admin_id}')
    await callback.answer("✅ تمت إزالة المشرف.", show_alert=True)
    await safe_send_message(admin_id, "❌ تمت إزالتك من قائمة المشرفين.")
    callback.data = 'admin_admins'
    await cb_admin_admins(callback)


# =============================================================================
# الإعدادات
# =============================================================================

@dp.callback_query(F.data == "admin_settings")
async def cb_admin_settings(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    bot_status = await get_setting('bot_status', 'active')
    status_text = "✅ نشط" if bot_status == 'active' else "🔧 صيانة"
    await safe_edit_message(callback.message, f"⚙️ **الإعدادات**\n\nحالة البوت: {status_text}", admin_settings_kb())
    await callback.answer()

@dp.callback_query(F.data == "admin_set_welcome")
async def cb_admin_set_welcome(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    current = await get_setting('welcome_message', '')
    await state.set_state(AdminSettingsStates.waiting_welcome_message)
    await safe_edit_message(
        callback.message,
        f"📝 **تعديل رسالة الترحيب**\n\nالرسالة الحالية:\n{current}\n\nأرسل الرسالة الجديدة:",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_settings", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminSettingsStates.waiting_welcome_message)
async def process_welcome_message(message: Message, state: FSMContext):
    await set_setting('welcome_message', message.text)
    await state.clear()
    await message.answer("✅ تم تحديث رسالة الترحيب.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_settings")]]))

@dp.callback_query(F.data == "admin_set_support_msg")
async def cb_admin_set_support_msg(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    current = await get_setting('support_message', '')
    await state.set_state(AdminSettingsStates.waiting_support_message)
    await safe_edit_message(
        callback.message,
        f"📞 **تعديل رسالة الدعم الفني**\n\nالرسالة الحالية:\n{current}\n\nأرسل الرسالة الجديدة (يمكنك وضع رقم هاتفك وطرق التواصل):",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_settings", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminSettingsStates.waiting_support_message)
async def process_support_message(message: Message, state: FSMContext):
    await set_setting('support_message', message.text)
    await state.clear()
    await message.answer("✅ تم تحديث رسالة الدعم الفني.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_settings")]]))

@dp.callback_query(F.data == "admin_toggle_bot_status")
async def cb_admin_toggle_bot_status(callback: CallbackQuery):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ للمدير الأساسي فقط.", show_alert=True)
        return
    current = await get_setting('bot_status', 'active')
    new_status = 'maintenance' if current == 'active' else 'active'
    await set_setting('bot_status', new_status)
    status_text = "✅ نشط" if new_status == 'active' else "🔧 صيانة"
    await callback.answer(f"تم تغيير حالة البوت إلى: {status_text}", show_alert=True)
    await safe_edit_message(callback.message, f"⚙️ **الإعدادات**\n\nحالة البوت: {status_text}", admin_settings_kb())

# =============================================================================
# الإذاعة
# =============================================================================

@dp.callback_query(F.data == "admin_broadcast")
async def cb_admin_broadcast(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await state.set_state(AdminBroadcastStates.waiting_message)
    await safe_edit_message(
        callback.message,
        "📢 **إرسال إذاعة**\n\nأرسل الرسالة التي تريد إرسالها لجميع المستخدمين:",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_panel", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminBroadcastStates.waiting_message)
async def process_broadcast_message(message: Message, state: FSMContext):
    await state.clear()
    user_ids = await get_all_user_ids()
    sent = 0
    failed = 0
    await message.answer(f"📢 جاري الإرسال لـ {len(user_ids)} مستخدم...")
    for uid in user_ids:
        if uid != message.from_user.id:
            success = await safe_send_message(uid, f"📢 **إذاعة:**\n\n{message.text}")
            if success:
                sent += 1
            else:
                failed += 1
    await message.answer(
        f"✅ **اكتملت الإذاعة!**\n\nتم الإرسال: {sent}\nفشل: {failed}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_panel")]])
    )

# =============================================================================
# سجل العمليات
# =============================================================================

@dp.callback_query(F.data == "admin_activity_log")
async def cb_admin_activity_log(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT user_id, action, details, created_at FROM activity_log ORDER BY created_at DESC LIMIT 20"
        ) as cursor:
            logs = await cursor.fetchall()
    if not logs:
        await callback.answer("لا يوجد سجل.", show_alert=True)
        return
    text = "📋 **آخر 20 عملية:**\n\n"
    for log in logs:
        text += f"• {log[3][:16]} | {log[0]} | {log[1]}\n"
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_panel")]]))
    await callback.answer()

@dp.message(Command("admin"))
async def cmd_admin(message: Message):
    if not await is_admin(message.from_user.id):
        return
    perms = await get_admin_perms(message.from_user.id)
    await message.answer(
        f"⚙️ **لوحة الإدارة**\n\nالدور: **{admin_role_label(perms.get('role_name', 'custom'))}**\nاختر القسم:",
        reply_markup=admin_panel_kb(perms, await is_super_admin(message.from_user.id)),
    )

# =============================================================================
# نسبة الربح ومزامنة API
# =============================================================================

@dp.callback_query(F.data == "admin_profit_margin")
async def cb_admin_profit_margin(callback: CallbackQuery, state: FSMContext):
    """لوحة نسب الربح العامة ونسب الأقسام الرئيسية."""
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ للمدير الأساسي فقط.", show_alert=True)
        return
    await state.clear()
    default_margin = await get_default_profit_margin()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM categories WHERE api_provider = 'js4card' "
            "AND is_active = 1 AND (parent_id = 0 OR parent_id IS NULL)"
        ) as cursor:
            root_count = int((await cursor.fetchone())[0] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM categories WHERE api_provider = 'js4card' "
            "AND is_active = 1 AND (parent_id = 0 OR parent_id IS NULL) "
            "AND profit_margin IS NOT NULL"
        ) as cursor:
            custom_count = int((await cursor.fetchone())[0] or 0)

    text = (
        "💹 إدارة نسب الربح\n\n"
        f"النسبة العامة الاحتياطية: {default_margin:g}%\n"
        f"الأقسام الرئيسية الموجودة: {root_count}\n"
        f"الأقسام التي لها نسبة خاصة: {custom_count}\n\n"
        "يمكنك وضع نسبة مختلفة لكل قسم رئيسي، وستُطبّق تلقائياً على "
        "كل الأقسام الفرعية والمنتجات الموجودة داخله."
    )
    kb = [
        [InlineKeyboardButton(text="📂 نسب الأقسام الرئيسية", callback_data="admin_profit_categories")],
        [InlineKeyboardButton(text="🌐 تعديل النسبة العامة", callback_data="admin_set_profit_margin")],
        [InlineKeyboardButton(text="🔄 تطبيق جميع النسب الآن", callback_data="admin_apply_profit_now")],
        [back_btn("admin_panel")],
    ]
    await safe_edit_message(
        callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb), parse_mode=None
    )
    await callback.answer()


@dp.callback_query(F.data == "admin_profit_categories")
async def cb_admin_profit_categories(callback: CallbackQuery):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    default_margin = await get_default_profit_margin()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, name, profit_margin FROM categories "
            "WHERE api_provider = 'js4card' AND is_active = 1 "
            "AND (parent_id = 0 OR parent_id IS NULL) "
            "ORDER BY sort_order, name"
        ) as cursor:
            categories = await cursor.fetchall()

    if not categories:
        await callback.answer("لا توجد أقسام رئيسية بعد. شغّل فحص الأقسام أولاً.", show_alert=True)
        return

    kb = []
    row = []
    for category_id, name, custom_margin in categories:
        label = f"{_normalize_profit_margin(custom_margin):g}%" if custom_margin is not None else f"عام {default_margin:g}%"
        button_name = clean_api_text(name, 18)
        row.append(InlineKeyboardButton(
            text=f"{button_name} • {label}",
            callback_data=f"admin_profit_cat_{category_id}",
        ))
        if len(row) == 2:
            kb.append(row)
            row = []
    if row:
        kb.append(row)
    kb.append([back_btn("admin_profit_margin")])

    text = (
        "📂 نسب الأقسام الرئيسية\n\n"
        "اختر القسم الذي تريد تحديد نسبة ربح خاصة له.\n"
        "كلمة «عام» تعني أن القسم يستخدم النسبة العامة الاحتياطية."
    )
    await safe_edit_message(
        callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb), parse_mode=None
    )
    await callback.answer()


async def render_profit_category_detail(message: Message, category_id: int):
    default_margin = await get_default_profit_margin()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT name, profit_margin FROM categories WHERE id = ? "
            "AND api_provider = 'js4card' AND (parent_id = 0 OR parent_id IS NULL)",
            (category_id,),
        ) as cursor:
            category = await cursor.fetchone()
        if category:
            async with db.execute(
                "WITH RECURSIVE descendants(id) AS ("
                "SELECT id FROM categories WHERE id = ? "
                "UNION ALL SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id"
                ") SELECT COUNT(*) FROM products WHERE api_provider = 'js4card' "
                "AND category_id IN (SELECT id FROM descendants)",
                (category_id,),
            ) as cursor:
                product_count = int((await cursor.fetchone())[0] or 0)
        else:
            product_count = 0

    if not category:
        return False

    name, custom_margin = category
    effective_margin = default_margin if custom_margin is None else _normalize_profit_margin(custom_margin)
    source_text = "النسبة العامة" if custom_margin is None else "نسبة خاصة"
    text = (
        f"💹 القسم: {clean_api_text(name, 250)}\n\n"
        f"النسبة الحالية: {effective_margin:g}%\n"
        f"المصدر: {source_text}\n"
        f"عدد المنتجات التابعة: {product_count}\n\n"
        "أي نسبة تضعها هنا ستشمل هذا القسم وجميع الأقسام الموجودة بداخله."
    )
    kb = [
        [InlineKeyboardButton(text="✏️ تعيين نسبة خاصة", callback_data=f"admin_set_profit_cat_{category_id}")],
        [InlineKeyboardButton(text="🌐 استخدام النسبة العامة", callback_data=f"admin_reset_profit_cat_{category_id}")],
        [InlineKeyboardButton(text="🔄 تطبيق على هذا القسم الآن", callback_data=f"admin_apply_profit_cat_{category_id}")],
        [back_btn("admin_profit_categories")],
    ]
    await safe_edit_message(
        message, text, InlineKeyboardMarkup(inline_keyboard=kb), parse_mode=None
    )
    return True


@dp.callback_query(F.data.startswith("admin_profit_cat_"))
async def cb_admin_profit_category_detail(callback: CallbackQuery):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    try:
        category_id = int(callback.data.rsplit('_', 1)[1])
    except (TypeError, ValueError):
        await callback.answer("القسم غير صالح.", show_alert=True)
        return

    if not await render_profit_category_detail(callback.message, category_id):
        await callback.answer("القسم غير موجود.", show_alert=True)
        return
    await callback.answer()


@dp.callback_query(F.data == "admin_set_profit_margin")
async def cb_admin_set_profit_margin(callback: CallbackQuery, state: FSMContext):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await state.clear()
    await state.set_state(AdminProfitMarginStates.waiting_margin)
    await safe_edit_message(
        callback.message,
        "🌐 تعديل النسبة العامة\n\n"
        "هذه النسبة تُستخدم فقط للأقسام التي لم تضع لها نسبة خاصة.\n"
        "أرسل الرقم فقط، مثل: 10",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_profit_margin", "❌ إلغاء")]]),
        parse_mode=None,
    )
    await callback.answer()


@dp.message(AdminProfitMarginStates.waiting_margin)
async def process_profit_margin(message: Message, state: FSMContext):
    try:
        margin = float((message.text or '').strip().replace('%', ''))
        if margin < 0 or margin > 1000:
            raise ValueError
    except (TypeError, ValueError):
        await message.answer("❌ أرسل رقماً بين 0 و1000، مثل: 15")
        return

    await set_setting('profit_margin', str(margin))
    await state.clear()
    await message.answer(
        f"✅ تم حفظ النسبة العامة: {margin:g}%\n\n"
        "الأقسام التي لها نسبة خاصة لن تتغير. اضغط تطبيق جميع النسب لتحديث الأسعار الحالية.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 تطبيق جميع النسب", callback_data="admin_apply_profit_now")],
            [back_btn("admin_profit_margin")],
        ]),
    )


@dp.callback_query(F.data.startswith("admin_set_profit_cat_"))
async def cb_admin_set_profit_category(callback: CallbackQuery, state: FSMContext):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    try:
        category_id = int(callback.data.rsplit('_', 1)[1])
    except (TypeError, ValueError):
        await callback.answer("القسم غير صالح.", show_alert=True)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT name FROM categories WHERE id = ? AND api_provider = 'js4card' "
            "AND (parent_id = 0 OR parent_id IS NULL)",
            (category_id,),
        ) as cursor:
            row = await cursor.fetchone()
    if not row:
        await callback.answer("القسم غير موجود.", show_alert=True)
        return

    await state.clear()
    await state.update_data(profit_category_id=category_id, profit_category_name=row[0])
    await state.set_state(AdminProfitMarginStates.waiting_category_margin)
    await safe_edit_message(
        callback.message,
        f"💹 تعيين نسبة قسم {clean_api_text(row[0], 250)}\n\n"
        "أرسل النسبة الجديدة كرقم فقط، مثل: 12.5\n"
        "سيتم تطبيقها على القسم وكل ما بداخله.",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f"admin_profit_cat_{category_id}", "❌ إلغاء")]]),
        parse_mode=None,
    )
    await callback.answer()


@dp.message(AdminProfitMarginStates.waiting_category_margin)
async def process_category_profit_margin(message: Message, state: FSMContext):
    data = await state.get_data()
    category_id = int(data.get('profit_category_id') or 0)
    category_name = clean_api_text(data.get('profit_category_name'), 250)
    try:
        margin = float((message.text or '').strip().replace('%', ''))
        if margin < 0 or margin > 1000:
            raise ValueError
    except (TypeError, ValueError):
        await message.answer("❌ أرسل رقماً بين 0 و1000، مثل: 12.5")
        return

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "UPDATE categories SET profit_margin = ? WHERE id = ? AND api_provider = 'js4card' "
            "AND (parent_id = 0 OR parent_id IS NULL)",
            (margin, category_id),
        )
        await db.commit()
        changed = cursor.rowcount
    if not changed:
        await state.clear()
        await message.answer("❌ تعذر العثور على القسم الرئيسي.")
        return

    updated, skipped = await apply_profit_margins_to_products(category_id)
    await state.clear()
    await message.answer(
        f"✅ تم تعيين نسبة {margin:g}% لقسم {category_name}.\n\n"
        f"تم تحديث أسعار {updated} منتج فوراً."
        + (f"\nتجاوزنا {skipped} منتجاً لا يملك سعراً أساسياً محفوظاً." if skipped else ""),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📂 العودة لنسب الأقسام", callback_data="admin_profit_categories")],
            [back_btn("admin_panel")],
        ]),
    )


@dp.callback_query(F.data.startswith("admin_reset_profit_cat_"))
async def cb_admin_reset_profit_category(callback: CallbackQuery):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    try:
        category_id = int(callback.data.rsplit('_', 1)[1])
    except (TypeError, ValueError):
        await callback.answer("القسم غير صالح.", show_alert=True)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE categories SET profit_margin = NULL WHERE id = ? AND api_provider = 'js4card' "
            "AND (parent_id = 0 OR parent_id IS NULL)",
            (category_id,),
        )
        await db.commit()
    updated, skipped = await apply_profit_margins_to_products(category_id)
    default_margin = await get_default_profit_margin()
    await render_profit_category_detail(callback.message, category_id)
    note = f"تم استخدام النسبة العامة {default_margin:g}% وتحديث {updated} منتج."
    if skipped:
        note += f" تم تجاوز {skipped} منتجاً بلا سعر أساسي."
    await callback.answer(note, show_alert=True)


@dp.callback_query(F.data.startswith("admin_apply_profit_cat_"))
async def cb_admin_apply_profit_category(callback: CallbackQuery):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    try:
        category_id = int(callback.data.rsplit('_', 1)[1])
    except (TypeError, ValueError):
        await callback.answer("القسم غير صالح.", show_alert=True)
        return
    await callback.answer("⏳ جاري تحديث أسعار القسم...")
    updated, skipped = await apply_profit_margins_to_products(category_id)
    text = f"✅ تم تحديث أسعار {updated} منتج تابع لهذا القسم."
    if skipped:
        text += f"\nتم تجاوز {skipped} منتجاً لا يملك سعراً أساسياً محفوظاً."
    await safe_send_message(callback.from_user.id, text)


@dp.callback_query(F.data == "admin_apply_profit_now")
async def cb_admin_apply_profit_now(callback: CallbackQuery):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    await callback.answer("⏳ جاري تطبيق نسب الأقسام على المنتجات...")
    updated, skipped = await apply_profit_margins_to_products()
    text = (
        "✅ تم تطبيق نسب الربح\n\n"
        f"المنتجات التي تم تحديثها: {updated}\n"
        f"المنتجات المتجاوزة لعدم وجود سعر أساسي: {skipped}"
    )
    await safe_edit_message(
        callback.message,
        text,
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_profit_margin")]]),
        parse_mode=None,
    )


async def get_api_sync_progress() -> dict:
    progress = {
        'pending': 0, 'processing': 0, 'done': 0, 'failed': 0,
        'products': 0, 'meta_status': '', 'updated_at': '',
    }
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT state, COUNT(*) FROM api_sync_queue GROUP BY state"
        ) as cursor:
            for state, count in await cursor.fetchall():
                if state in progress:
                    progress[state] = int(count or 0)
        async with db.execute("SELECT COUNT(*) FROM api_sync_seen_products") as cursor:
            row = await cursor.fetchone()
            progress['products'] = int(row[0] or 0) if row else 0
        async with db.execute(
            "SELECT key, value FROM api_sync_meta WHERE key IN ('status', 'updated_at')"
        ) as cursor:
            for key, value in await cursor.fetchall():
                if key == 'status':
                    progress['meta_status'] = value or ''
                elif key == 'updated_at':
                    progress['updated_at'] = value or ''
    return progress


@dp.callback_query(F.data == "admin_api_sync_status")
async def cb_admin_api_sync_status(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    progress = await get_api_sync_progress()
    total = progress['pending'] + progress['processing'] + progress['done'] + progress['failed']
    completed = progress['done']
    percent = (completed / total * 100) if total else 0.0
    running_text = 'تعمل الآن' if API_SYNC_LOCK.locked() else 'متوقفة حالياً'
    text = (
        "📊 **حالة مزامنة المتجر**\n\n"
        f"الحالة: {running_text}\n"
        f"التقدم: {percent:.1f}%\n"
        f"✅ الأقسام المكتملة: {progress['done']}\n"
        f"⏳ الأقسام المتبقية: {progress['pending'] + progress['processing']}\n"
        f"⚠️ الأقسام المتعثرة: {progress['failed']}\n"
        f"📦 المنتجات المحفوظة في الجولة: {progress['products']}\n"
        f"🚦 مرات تهدئة الموقع: {API_SYNC_STATUS.get('rate_limit_hits', 0)}"
    )
    if progress['updated_at']:
        text += f"\n🕒 آخر حفظ للتقدم: {progress['updated_at']}"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔄 تحديث الحالة", callback_data="admin_api_sync_status")],
        [InlineKeyboardButton(text="▶️ متابعة الفحص الشامل", callback_data="admin_api_full_sync")],
        [back_btn("admin_panel")],
    ])
    await safe_edit_message(callback.message, text, kb)
    await callback.answer()


@dp.callback_query(F.data == "admin_api_sync_now")
async def cb_admin_api_sync_now(callback: CallbackQuery):
    """تشغيل مزامنة واحدة في الخلفية دون إيقاف البوت."""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return

    if API_SYNC_LOCK.locked():
        await callback.answer("🔄 توجد مزامنة تعمل بالفعل، لا حاجة لتشغيل واحدة أخرى.", show_alert=True)
        return

    await callback.answer("⚡ بدأ التحديث السريع.", show_alert=True)
    asyncio.create_task(sync_products_from_api(notify_user_id=callback.from_user.id, mode='quick'))
    await safe_edit_message(
        callback.message,
        "⚡ **بدأ التحديث السريع**\n\n"
        "سيتم تحديث الأسعار والأوصاف والمتطلبات دون المرور على جميع الأقسام.\n"
        "سيبقى البوت متاحاً وستصلك النتيجة عند الانتهاء.",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_panel")]])
    )


@dp.callback_query(F.data == "admin_api_full_sync")
async def cb_admin_api_full_sync(callback: CallbackQuery):
    """تشغيل الفحص الشامل لشجرة الأقسام عند الحاجة فقط."""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return

    if API_SYNC_LOCK.locked():
        await callback.answer("🔄 توجد عملية تحديث تعمل بالفعل.", show_alert=True)
        return

    await callback.answer("🔄 بدأ الفحص الشامل في الخلفية.", show_alert=True)
    asyncio.create_task(sync_products_from_api(notify_user_id=callback.from_user.id, mode='full'))
    await safe_edit_message(
        callback.message,
        "🔄 **بدأ الفحص الشامل الذكي**\n\n"
        "إذا وُجد تقدم محفوظ فسيكمل منه بدلاً من البدء من الصفر.\n"
        "سيخفف سرعته تلقائياً عند ضغط الموقع، وسيبقى البوت متاحاً.",
        InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📊 متابعة التقدم", callback_data="admin_api_sync_status")],
            [back_btn("admin_panel")],
        ])
    )

# =============================================================================
# نقطة الدخول الرئيسية
# =============================================================================


# =============================================================================
# أدوات منتجات API والوصف والمتطلبات
# =============================================================================

def clean_api_text(value: object, max_length: int = 3000) -> str:
    """تنظيف النص القادم من API ليظهر بصورة سليمة داخل تيليجرام."""
    text = html.unescape(str(value or '')).strip()
    if not text:
        return ''
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p\s*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\r\n?', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    # منع الرموز القادمة من الوصف من كسر تنسيق Markdown الحالي
    text = text.replace('`', "'").replace('*', '').replace('_', ' ')
    return text[:max_length].strip()


def extract_api_description(product: dict) -> str:
    """استخراج الوصف من أكثر أسماء الحقول شيوعاً لدى مزود الخدمة."""
    if not isinstance(product, dict):
        return ''
    for key in ('description', 'product_description', 'details', 'desc', 'note', 'instructions'):
        value = clean_api_text(product.get(key))
        if value:
            return value
    return ''


def normalize_api_fields(params: object) -> list[dict]:
    """تحويل متطلبات المنتج المختلفة إلى قائمة موحدة يفهمها البوت."""
    if not params:
        return []

    if isinstance(params, dict):
        wrapped = params.get('params') or params.get('fields') or params.get('requirements')
        if wrapped is not None:
            params = wrapped
        else:
            params = [
                {'name': key, 'label': value if isinstance(value, str) else key}
                for key, value in params.items()
            ]

    if not isinstance(params, list):
        params = [params]

    fields: list[dict] = []
    seen: set[str] = set()
    ignored = {'qty', 'quantity', 'order_uuid', 'orderuuid', 'product_id', 'productid'}

    for item in params:
        if isinstance(item, str):
            key = item.strip()
            label = key
            required = True
            options = []
        elif isinstance(item, dict):
            key = str(
                item.get('name') or item.get('key') or item.get('param') or
                item.get('field') or item.get('code') or item.get('id') or ''
            ).strip()
            label = str(
                item.get('label') or item.get('title') or item.get('display_name') or
                item.get('placeholder') or item.get('description') or key
            ).strip()
            required_value = item.get('required', True)
            required = required_value not in (False, 0, '0', 'false', 'False', 'optional')
            options = item.get('options') or item.get('values') or item.get('choices') or []
        else:
            continue

        if not key:
            continue
        normalized_key = re.sub(r'[^a-z0-9]', '', key.lower())
        if normalized_key in ignored or normalized_key in seen:
            continue
        seen.add(normalized_key)

        if isinstance(options, dict):
            options = list(options.values())
        if not isinstance(options, list):
            options = [options]

        fields.append({
            'key': key,
            'label': clean_api_text(label, 120) or key,
            'required': required,
            'options': [clean_api_text(v, 80) for v in options if str(v).strip()]
        })
    return fields


def get_player_id_from_fields(fields: dict) -> tuple[str | None, dict]:
    """فصل معرف اللاعب عن بقية المتطلبات قبل إرسال الطلب للموقع."""
    extra = dict(fields or {})
    player_id = None
    for key in list(extra.keys()):
        normalized = re.sub(r'[^a-z0-9]', '', str(key).lower())
        if normalized in {'playerid', 'userid', 'gameid'}:
            player_id = str(extra.pop(key)).strip()
            break
    return player_id, extra

# =============================================================================
# دالة المزامنة السريعة والآمنة من API
# =============================================================================

def _api_numeric_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _unwrap_api_dict(data: object) -> dict:
    """يدعم الاستجابات المباشرة أو المغلفة داخل data/result."""
    if not isinstance(data, dict):
        return {}
    for key in ('data', 'result'):
        nested = data.get(key)
        if isinstance(nested, dict):
            return nested
    return data


def _extract_content_categories(data: object) -> list[dict]:
    payload = _unwrap_api_dict(data)
    for key in ('categories', 'category', 'cats'):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _extract_content_products(data: object) -> list[dict]:
    payload = _unwrap_api_dict(data)
    for key in ('products', 'items'):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _prepare_api_product(prod: dict, db_category_id: int, profit_margin: float):
    """تجهيز بيانات المنتج للحفظ دون إجراء طلبات متكررة لقاعدة البيانات."""
    if not isinstance(prod, dict):
        return None

    prod_api_id = _api_numeric_id(prod.get('id'))
    if prod_api_id is None:
        return None

    prod_name = clean_api_text(prod.get('name', ''), 250) or f'منتج {prod_api_id}'
    prod_description = extract_api_description(prod)
    if not prod_description:
        qty_values = prod.get('qty_values') or {}
        if not isinstance(qty_values, dict):
            qty_values = {}
        product_type = prod.get('product_type', 'package')
        if product_type == 'amount':
            min_v = qty_values.get('min', 1)
            max_v = qty_values.get('max', 1)
            prod_description = f"منتج بكمية مرنة من {min_v} إلى {max_v}."
        else:
            prod_description = f"منتج رقمي: {prod_name}"

    try:
        base_price = float(prod.get('price', 0) or 0)
    except (TypeError, ValueError):
        base_price = 0.0
    price = round(base_price * (1 + profit_margin / 100), 2)

    params_value = prod.get('params', [])
    qty_values = prod.get('qty_values', {})
    api_params = json.dumps({
        'params': params_value if isinstance(params_value, (list, dict)) else [],
        'qty_values': qty_values if isinstance(qty_values, dict) else {},
        'product_type': prod.get('product_type', 'package'),
        'base_price': base_price,
        'description': prod_description,
    }, ensure_ascii=False)

    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    return {
        'api_id': prod_api_id,
        'category_id': db_category_id,
        'name': prod_name,
        'description': prod_description,
        'price': price,
        'api_params': api_params,
        'now': now,
    }



def _extract_product_category_api_id(product: dict):
    """محاولة معرفة قسم المنتج من بيانات /products دون طلب كل قسم منفرداً."""
    if not isinstance(product, dict):
        return None
    for key in ('category_id', 'categoryId', 'cat_id', 'catId'):
        value = _api_numeric_id(product.get(key))
        if value is not None:
            return value
    category = product.get('category')
    if isinstance(category, dict):
        for key in ('id', 'category_id', 'categoryId'):
            value = _api_numeric_id(category.get(key))
            if value is not None:
                return value
    return _api_numeric_id(category)


async def _count_local_api_products() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM products WHERE api_provider = 'js4card'"
        ) as cursor:
            row = await cursor.fetchone()
            return int(row[0] or 0) if row else 0


async def sync_products_quick_from_api(notify_user_id: int | None = None) -> dict:
    """
    تحديث سريع للمتاجر الكبيرة:
    - طلب واحد لجلب قائمة المنتجات.
    - تحديث الأسعار والأوصاف والمتطلبات فقط.
    - لا يفحص أكثر من 550 قسماً ولا يحذف أي بيانات قديمة.
    """
    if API_SYNC_LOCK.locked():
        return {'status': 'already_running'}

    async with API_SYNC_LOCK:
        started_at = asyncio.get_running_loop().time()
        API_SYNC_STATUS['running'] = True
        API_SYNC_STATUS['last_result'] = 'running'
        result = {
            'status': 'failed', 'mode': 'quick', 'products': 0,
            'updated': 0, 'inserted': 0, 'unchanged': 0,
            'unmapped_new': 0, 'duration': 0.0,
        }
        try:
            if not API_TOKEN:
                raise RuntimeError('API_TOKEN غير موجود في ملف .env')

            async with JS4CardAPI(api_token=API_TOKEN, connection_limit=2) as api:
                products = await api.get_products()
            if not isinstance(products, list):
                raise RuntimeError('الموقع لم يُرجع قائمة المنتجات')

            default_profit_margin = await get_default_profit_margin()

            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute('PRAGMA busy_timeout = 10000')
                async with db.execute(
                    "SELECT id, api_id, category_id, name, description, price, api_params, is_active "
                    "FROM products WHERE api_provider = 'js4card'"
                ) as cursor:
                    existing_rows = await cursor.fetchall()
                existing = {
                    _api_numeric_id(row[1]): {
                        'id': row[0], 'category_id': row[2], 'name': row[3] or '',
                        'description': row[4] or '', 'price': float(row[5] or 0),
                        'api_params': row[6] or '', 'is_active': int(row[7] or 0),
                    }
                    for row in existing_rows if _api_numeric_id(row[1]) is not None
                }
                async with db.execute(
                    "SELECT api_id, id FROM categories WHERE api_provider = 'js4card'"
                ) as cursor:
                    category_map = {
                        _api_numeric_id(row[0]): row[1]
                        for row in await cursor.fetchall()
                        if _api_numeric_id(row[0]) is not None
                    }
                category_profit_map, _ = await _load_category_profit_maps(db, default_profit_margin)

                updates = []
                inserts = []
                unchanged = 0
                unmapped_new = 0
                now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                for product in products:
                    if not isinstance(product, dict):
                        continue
                    api_id = _api_numeric_id(product.get('id'))
                    if api_id is None:
                        continue
                    old = existing.get(api_id)
                    if old:
                        db_category_id = old['category_id']
                    else:
                        category_api_id = _extract_product_category_api_id(product)
                        db_category_id = category_map.get(category_api_id)
                        if not db_category_id:
                            unmapped_new += 1
                            continue

                    product_margin = category_profit_map.get(db_category_id, default_profit_margin)
                    prepared = _prepare_api_product(product, db_category_id, product_margin)
                    if not prepared:
                        continue
                    if old:
                        changed = (
                            old['name'] != prepared['name'] or
                            old['description'] != prepared['description'] or
                            abs(old['price'] - prepared['price']) > 0.000001 or
                            old['api_params'] != prepared['api_params'] or
                            old['is_active'] != 1
                        )
                        if changed:
                            updates.append((
                                prepared['name'], prepared['description'], prepared['price'],
                                prepared['api_params'], now, old['id'],
                            ))
                        else:
                            unchanged += 1
                    else:
                        inserts.append((
                            prepared['category_id'], prepared['name'], prepared['description'],
                            prepared['price'], 1000, prepared['api_id'], prepared['api_params'],
                            now, now,
                        ))

                await db.execute('BEGIN IMMEDIATE')
                try:
                    if updates:
                        await db.executemany(
                            "UPDATE products SET name = ?, description = ?, price = ?, "
                            "api_params = ?, last_synced = ?, is_active = 1 WHERE id = ?",
                            updates,
                        )
                    if inserts:
                        await db.executemany(
                            "INSERT INTO products "
                            "(category_id, name, description, price, stock, product_type, api_id, "
                            "api_provider, api_params, created_at, last_synced, is_active) "
                            "VALUES (?, ?, ?, ?, ?, 'stock', ?, 'js4card', ?, ?, ?, 1)",
                            inserts,
                        )
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

            duration = asyncio.get_running_loop().time() - started_at
            result.update({
                'status': 'success', 'products': len(products),
                'updated': len(updates), 'inserted': len(inserts),
                'unchanged': unchanged, 'unmapped_new': unmapped_new,
                'duration': duration,
            })
            logger.info(
                'Quick sync finished in %.1fs: products=%s updated=%s inserted=%s unchanged=%s unmapped=%s',
                duration, len(products), len(updates), len(inserts), unchanged, unmapped_new,
            )
            await set_setting('api_last_quick_sync_epoch', str(int(datetime.datetime.now().timestamp())))
            if notify_user_id:
                note = ''
                if unmapped_new:
                    note = (
                        f"\nℹ️ توجد {unmapped_new} منتجات جديدة تحتاج فحص الأقسام الشامل "
                        "لوضعها في أقسامها الصحيحة."
                    )
                await safe_send_message(
                    notify_user_id,
                    f"⚡ **اكتمل التحديث السريع**\n\n"
                    f"📦 المنتجات المقروءة: {len(products)}\n"
                    f"✏️ المنتجات المتغيرة: {len(updates)}\n"
                    f"➕ المنتجات الجديدة: {len(inserts)}\n"
                    f"⏱ الوقت: {duration:.1f} ثانية{note}",
                    reply_markup=back_to_main_kb(),
                )
            return result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            duration = asyncio.get_running_loop().time() - started_at
            result.update({'duration': duration, 'error': clean_api_text(exc, 300)})
            logger.error('Quick sync failed: %s', exc, exc_info=True)
            if notify_user_id:
                await safe_send_message(
                    notify_user_id,
                    f"❌ **تعذر التحديث السريع**\n\n{clean_api_text(exc, 250)}\n\n"
                    "لم تُحذف أو تُعطّل أي منتجات قديمة.",
                    reply_markup=back_to_main_kb(),
                )
            return result
        finally:
            API_SYNC_STATUS['running'] = False
            API_SYNC_STATUS['last_result'] = result.get('status', 'failed')
            API_SYNC_STATUS['last_duration'] = result.get('duration', 0.0)


async def sync_products_from_api(
    notify_user_id: int | None = None,
    mode: str = 'auto',
) -> dict:
    """اختيار التحديث المناسب دون إنشاء حلقة مزامنة مستمرة."""
    normalized_mode = str(mode or 'auto').strip().lower()
    if normalized_mode == 'auto':
        local_count = await _count_local_api_products()
        initial_complete = await get_setting('api_initial_full_sync_complete', '0')

        # إذا لم يكتمل الاستيراد الأول، نكمل الفحص الشامل حتى لو حُفظ جزء من المنتجات.
        if local_count <= 0 or initial_complete != '1':
            normalized_mode = 'full'
        else:
            last_sync_raw = await get_setting('api_last_quick_sync_epoch', '0')
            try:
                last_sync_epoch = int(float(last_sync_raw or 0))
            except (TypeError, ValueError):
                last_sync_epoch = 0
            elapsed = int(datetime.datetime.now().timestamp()) - last_sync_epoch
            if last_sync_epoch and elapsed < SYNC_MIN_RESTART_INTERVAL_SECONDS:
                logger.info('Startup sync skipped: last update was %s seconds ago', elapsed)
                return {
                    'status': 'skipped_recent', 'mode': 'auto',
                    'products': local_count, 'duration': 0.0,
                }
            normalized_mode = 'quick'

    if normalized_mode == 'full':
        return await sync_products_full_from_api(notify_user_id=notify_user_id)
    return await sync_products_quick_from_api(notify_user_id=notify_user_id)


async def sync_products_full_from_api(notify_user_id: int | None = None) -> dict:
    """
    مزامنة شاملة قابلة للاستكمال:
    - تحفظ قائمة الأقسام وحالة كل قسم في قاعدة البيانات.
    - عند توقف السيرفر تكمل من الأقسام المتبقية، ولا تبدأ من الصفر.
    - تهدئ الطلبات تلقائياً عند 429 عبر طبقة JS4CardAPI.
    - لا تعطل البيانات القديمة إلا بعد اكتمال الجولة بلا أقسام متعثرة.
    """
    if API_SYNC_LOCK.locked():
        return {'status': 'already_running'}

    async with API_SYNC_LOCK:
        started_at = asyncio.get_running_loop().time()
        API_SYNC_STATUS.update({
            'running': True, 'mode': 'full', 'last_result': 'running',
            'categories_done': 0, 'categories_pending': 0,
            'categories_failed': 0, 'products_seen': 0,
            'rate_limit_hits': 0,
        })
        result = {
            'status': 'failed', 'mode': 'full', 'categories': 0,
            'products': 0, 'pending_categories': 0,
            'failed_categories': 0, 'duration': 0.0,
            'resumed': False,
        }
        full_products_task = None

        async def set_meta(db, key: str, value: object):
            await db.execute(
                "INSERT OR REPLACE INTO api_sync_meta(key, value) VALUES (?, ?)",
                (key, str(value)),
            )

        async def read_meta(db, key: str, default: str = '') -> str:
            async with db.execute(
                "SELECT value FROM api_sync_meta WHERE key = ?", (key,)
            ) as cursor:
                row = await cursor.fetchone()
                return str(row[0]) if row else default

        async def queue_counts(db) -> dict:
            counts = {'pending': 0, 'processing': 0, 'done': 0, 'failed': 0}
            async with db.execute(
                "SELECT state, COUNT(*) FROM api_sync_queue GROUP BY state"
            ) as cursor:
                for state, count in await cursor.fetchall():
                    if state in counts:
                        counts[state] = int(count or 0)
            return counts

        try:
            if not API_TOKEN:
                raise RuntimeError('API_TOKEN غير موجود في ملف .env')

            default_profit_margin = await get_default_profit_margin()
            logger.info(
                'Starting resumable full sync: concurrency=%s batch=%s',
                SYNC_CONCURRENCY, SYNC_BATCH_SIZE,
            )

            async with JS4CardAPI(
                api_token=API_TOKEN,
                connection_limit=SYNC_CONCURRENCY + 1,
            ) as api:
                if not await api.validate_token():
                    raise RuntimeError('توكن API غير صحيح أو الموقع لا يستجيب')

                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute('PRAGMA foreign_keys = ON')
                    await db.execute('PRAGMA busy_timeout = 15000')

                    # أي قسم كان قيد المعالجة وقت انطفاء السيرفر يعود إلى قائمة الانتظار.
                    await db.execute(
                        "UPDATE api_sync_queue SET state = 'pending' WHERE state = 'processing'"
                    )
                    await db.commit()

                    counts = await queue_counts(db)
                    previous_status = await read_meta(db, 'status', '')
                    resume_available = (
                        previous_status in {'running', 'partial', 'paused'} and
                        (counts['pending'] > 0 or counts['failed'] > 0)
                    )

                    if resume_available:
                        result['resumed'] = True
                        # نعطي الأقسام المتعثرة فرصة جديدة في التشغيل التالي.
                        await db.execute(
                            "UPDATE api_sync_queue SET state = 'pending', attempts = 0, last_error = '' "
                            "WHERE state = 'failed'"
                        )
                        await set_meta(db, 'status', 'running')
                        await set_meta(db, 'updated_at', datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
                        await db.commit()
                        logger.info('Resuming saved full sync checkpoint')
                    else:
                        root_content = await api.get_content(category_id=0)
                        root_categories = _extract_content_categories(root_content)
                        if not root_categories:
                            raise RuntimeError('الموقع لم يُرجع الأقسام الرئيسية')

                        await db.execute('BEGIN IMMEDIATE')
                        try:
                            await db.execute('DELETE FROM api_sync_queue')
                            await db.execute('DELETE FROM api_sync_seen_categories')
                            await db.execute('DELETE FROM api_sync_seen_products')
                            now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                            root_rows = []
                            for index, raw in enumerate(root_categories):
                                api_id = _api_numeric_id(raw.get('id'))
                                if api_id is None:
                                    continue
                                root_rows.append((
                                    api_id,
                                    clean_api_text(raw.get('name'), 250) or f'قسم {api_id}',
                                    0, 1, index, 'pending', 0, '', now,
                                ))
                            await db.executemany(
                                "INSERT OR REPLACE INTO api_sync_queue "
                                "(api_id, name, parent_api_id, depth, sort_order, state, attempts, last_error, updated_at) "
                                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                root_rows,
                            )
                            await set_meta(db, 'status', 'running')
                            await set_meta(db, 'started_at', now)
                            await set_meta(db, 'updated_at', now)
                            await db.commit()
                        except Exception:
                            await db.rollback()
                            raise

                    # القائمة العامة تُستخدم لتحديث الوصف والسعر، بالتوازي مع شجرة الأقسام.
                    full_products_task = asyncio.create_task(api.get_products())

                    async with db.execute(
                        "SELECT id, api_id FROM categories WHERE api_provider = 'js4card'"
                    ) as cursor:
                        category_db_ids = {
                            _api_numeric_id(row[1]): int(row[0])
                            for row in await cursor.fetchall()
                            if _api_numeric_id(row[1]) is not None
                        }
                    async with db.execute(
                        "SELECT id, api_id FROM products WHERE api_provider = 'js4card'"
                    ) as cursor:
                        product_db_ids = {
                            _api_numeric_id(row[1]): int(row[0])
                            for row in await cursor.fetchall()
                            if _api_numeric_id(row[1]) is not None
                        }

                    full_product_map: dict[int, dict] = {}
                    semaphore = asyncio.Semaphore(SYNC_CONCURRENCY)

                    async def fetch_one(row):
                        api_id, name, parent_api_id, depth, sort_order, attempts = row
                        try:
                            async with semaphore:
                                content = await api.get_content(category_id=api_id)
                            return row, content
                        except asyncio.CancelledError:
                            raise
                        except Exception as exc:
                            logger.warning('Category %s request crashed: %s', api_id, exc)
                            return row, None

                    while True:
                        async with db.execute(
                            "SELECT api_id, name, parent_api_id, depth, sort_order, attempts "
                            "FROM api_sync_queue WHERE state = 'pending' "
                            "ORDER BY depth, sort_order, api_id LIMIT ?",
                            (SYNC_BATCH_SIZE,),
                        ) as cursor:
                            batch = await cursor.fetchall()
                        if not batch:
                            break

                        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        await db.executemany(
                            "UPDATE api_sync_queue SET state = 'processing', attempts = attempts + 1, "
                            "updated_at = ? WHERE api_id = ?",
                            [(now, int(row[0])) for row in batch],
                        )
                        await db.commit()

                        fetched = await asyncio.gather(
                            *(fetch_one(row) for row in batch),
                            return_exceptions=True,
                        )

                        if full_products_task.done() and not full_product_map:
                            try:
                                full_products = full_products_task.result() or []
                            except Exception:
                                full_products = []
                            full_product_map = {
                                _api_numeric_id(prod.get('id')): prod
                                for prod in full_products
                                if isinstance(prod, dict) and _api_numeric_id(prod.get('id')) is not None
                            }

                        await db.execute('BEGIN IMMEDIATE')
                        try:
                            successful_contents = []
                            for fetched_item in fetched:
                                if isinstance(fetched_item, Exception):
                                    logger.warning('Category task failed: %s', fetched_item)
                                    continue

                                row, content = fetched_item
                                api_id, name, parent_api_id, depth, sort_order, previous_attempts = row
                                api_id = int(api_id)
                                parent_api_id = int(parent_api_id or 0)
                                parent_db_id = category_db_ids.get(parent_api_id, 0)
                                existing_category_id = category_db_ids.get(api_id)

                                # حفظ القسم نفسه حتى لو تأخر محتواه.
                                if existing_category_id:
                                    await db.execute(
                                        "UPDATE categories SET name = ?, parent_id = ?, sort_order = ?, is_active = 1 "
                                        "WHERE id = ?",
                                        (name, parent_db_id, sort_order, existing_category_id),
                                    )
                                else:
                                    try:
                                        cursor = await db.execute(
                                            "INSERT INTO categories "
                                            "(name, is_active, api_provider, api_id, parent_id, sort_order) "
                                            "VALUES (?, 1, 'js4card', ?, ?, ?)",
                                            (name, api_id, parent_db_id, sort_order),
                                        )
                                    except aiosqlite.IntegrityError:
                                        cursor = await db.execute(
                                            "INSERT INTO categories "
                                            "(name, is_active, api_provider, api_id, parent_id, sort_order) "
                                            "VALUES (?, 1, 'js4card', ?, ?, ?)",
                                            (f'{name} · {api_id}', api_id, parent_db_id, sort_order),
                                        )
                                    existing_category_id = int(cursor.lastrowid)
                                    category_db_ids[api_id] = existing_category_id

                                if not isinstance(content, dict):
                                    current_attempt = int(previous_attempts or 0) + 1
                                    next_state = (
                                        'failed' if current_attempt >= SYNC_CATEGORY_MAX_ATTEMPTS else 'pending'
                                    )
                                    await db.execute(
                                        "UPDATE api_sync_queue SET state = ?, last_error = ?, updated_at = ? "
                                        "WHERE api_id = ?",
                                        (next_state, 'لم يستجب الموقع بعد المحاولات', now, api_id),
                                    )
                                    continue

                                await db.execute(
                                    "INSERT OR IGNORE INTO api_sync_seen_categories(api_id) VALUES (?)",
                                    (api_id,),
                                )
                                await db.execute(
                                    "UPDATE api_sync_queue SET state = 'done', last_error = '', updated_at = ? "
                                    "WHERE api_id = ?",
                                    (now, api_id),
                                )

                                child_categories = _extract_content_categories(content)
                                child_rows = []
                                for child_index, child in enumerate(child_categories):
                                    child_id = _api_numeric_id(child.get('id'))
                                    if child_id is None or int(depth or 1) >= 15:
                                        continue
                                    child_rows.append((
                                        child_id,
                                        clean_api_text(child.get('name'), 250) or f'قسم {child_id}',
                                        api_id,
                                        int(depth or 1) + 1,
                                        child_index,
                                        'pending', 0, '', now,
                                    ))
                                if child_rows:
                                    await db.executemany(
                                        "INSERT OR IGNORE INTO api_sync_queue "
                                        "(api_id, name, parent_api_id, depth, sort_order, state, attempts, last_error, updated_at) "
                                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                        child_rows,
                                    )

                                successful_contents.append((content, existing_category_id))

                            # حساب نسب الأقسام مرة واحدة لكل دفعة بدلاً من كل قسم على حدة.
                            category_profit_map, _ = await _load_category_profit_maps(db, default_profit_margin)
                            for content, existing_category_id in successful_contents:
                                products = _extract_content_products(content)
                                margin = category_profit_map.get(existing_category_id, default_profit_margin)
                                for product in products:
                                    product_api_id = _api_numeric_id(product.get('id'))
                                    if product_api_id is None:
                                        continue
                                    best_product = full_product_map.get(product_api_id, product)
                                    prepared = _prepare_api_product(best_product, existing_category_id, margin)
                                    if not prepared:
                                        continue
                                    old_id = product_db_ids.get(product_api_id)
                                    if old_id:
                                        await db.execute(
                                            "UPDATE products SET name = ?, description = ?, price = ?, "
                                            "category_id = ?, api_params = ?, last_synced = ?, is_active = 1 "
                                            "WHERE id = ?",
                                            (
                                                prepared['name'], prepared['description'], prepared['price'],
                                                existing_category_id, prepared['api_params'], prepared['now'], old_id,
                                            ),
                                        )
                                    else:
                                        cursor = await db.execute(
                                            "INSERT INTO products "
                                            "(category_id, name, description, price, stock, product_type, api_id, "
                                            "api_provider, api_params, created_at, last_synced, is_active) "
                                            "VALUES (?, ?, ?, ?, 1000, 'stock', ?, 'js4card', ?, ?, ?, 1)",
                                            (
                                                existing_category_id, prepared['name'], prepared['description'],
                                                prepared['price'], prepared['api_id'], prepared['api_params'],
                                                prepared['now'], prepared['now'],
                                            ),
                                        )
                                        product_db_ids[product_api_id] = int(cursor.lastrowid)
                                    await db.execute(
                                        "INSERT OR IGNORE INTO api_sync_seen_products(api_id) VALUES (?)",
                                        (product_api_id,),
                                    )

                            await set_meta(db, 'status', 'running')
                            await set_meta(db, 'updated_at', now)
                            await db.commit()
                        except Exception:
                            await db.rollback()
                            # الأقسام التي بقيت processing ستعود pending عند الاستكمال.
                            raise

                        counts = await queue_counts(db)
                        async with db.execute("SELECT COUNT(*) FROM api_sync_seen_products") as cursor:
                            products_row = await cursor.fetchone()
                            products_seen = int(products_row[0] or 0) if products_row else 0
                        API_SYNC_STATUS.update({
                            'categories_done': counts['done'],
                            'categories_pending': counts['pending'] + counts['processing'],
                            'categories_failed': counts['failed'],
                            'products_seen': products_seen,
                            'rate_limit_hits': api.rate_limit_hits,
                        })
                        logger.info(
                            'Smart sync progress: done=%s pending=%s failed=%s products=%s rate_limits=%s',
                            counts['done'], counts['pending'] + counts['processing'],
                            counts['failed'], products_seen, api.rate_limit_hits,
                        )

                    # تحديث نهائي للأسعار والأوصاف من قائمة /products دون إعادة فحص الأقسام.
                    try:
                        full_products = await full_products_task
                    except Exception:
                        full_products = []
                    if isinstance(full_products, list) and full_products:
                        category_profit_map, _ = await _load_category_profit_maps(db, default_profit_margin)
                        async with db.execute(
                            "SELECT id, api_id, category_id FROM products WHERE api_provider = 'js4card'"
                        ) as cursor:
                            local_products = await cursor.fetchall()
                        local_map = {
                            _api_numeric_id(api_id): (int(local_id), int(category_id or 0))
                            for local_id, api_id, category_id in local_products
                            if _api_numeric_id(api_id) is not None
                        }
                        update_rows = []
                        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        for product in full_products:
                            if not isinstance(product, dict):
                                continue
                            api_id = _api_numeric_id(product.get('id'))
                            local = local_map.get(api_id)
                            if not local:
                                continue
                            local_id, category_id = local
                            prepared = _prepare_api_product(
                                product, category_id,
                                category_profit_map.get(category_id, default_profit_margin),
                            )
                            if prepared:
                                update_rows.append((
                                    prepared['name'], prepared['description'], prepared['price'],
                                    prepared['api_params'], now, local_id,
                                ))
                        if update_rows:
                            await db.executemany(
                                "UPDATE products SET name = ?, description = ?, price = ?, "
                                "api_params = ?, last_synced = ?, is_active = 1 WHERE id = ?",
                                update_rows,
                            )
                            await db.commit()

                    counts = await queue_counts(db)
                    async with db.execute("SELECT COUNT(*) FROM api_sync_seen_products") as cursor:
                        row = await cursor.fetchone()
                        products_seen = int(row[0] or 0) if row else 0

                    complete = (
                        counts['pending'] == 0 and counts['processing'] == 0 and counts['failed'] == 0
                    )
                    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    if complete:
                        # فقط الجولة الكاملة الناجحة تسمح بتعطيل العناصر التي اختفت من الموقع.
                        await db.execute(
                            "UPDATE categories SET is_active = 0 WHERE api_provider = 'js4card' "
                            "AND NOT EXISTS (SELECT 1 FROM api_sync_seen_categories s WHERE s.api_id = categories.api_id)"
                        )
                        await db.execute(
                            "UPDATE products SET is_active = 0 WHERE api_provider = 'js4card' "
                            "AND NOT EXISTS (SELECT 1 FROM api_sync_seen_products s WHERE s.api_id = products.api_id)"
                        )
                        await set_meta(db, 'status', 'complete')
                        await db.execute(
                            "INSERT OR REPLACE INTO settings(key, value) VALUES ('api_initial_full_sync_complete', '1')"
                        )
                    else:
                        await set_meta(db, 'status', 'partial')
                    await set_meta(db, 'updated_at', now)
                    await db.commit()

            duration = asyncio.get_running_loop().time() - started_at
            result.update({
                'status': 'success' if complete else 'partial',
                'categories': counts['done'],
                'products': products_seen,
                'pending_categories': counts['pending'] + counts['processing'],
                'failed_categories': counts['failed'],
                'duration': duration,
            })
            sync_epoch = str(int(datetime.datetime.now().timestamp()))
            await set_setting('api_last_quick_sync_epoch', sync_epoch)
            if complete:
                await set_setting('api_last_full_sync_epoch', sync_epoch)

            if notify_user_id:
                resume_note = '\n♻️ تم استكمال المزامنة السابقة.' if result['resumed'] else ''
                if complete:
                    message = (
                        "✅ **اكتمل الفحص الشامل**\n\n"
                        f"📂 الأقسام المكتملة: {result['categories']}\n"
                        f"📦 المنتجات المحفوظة: {result['products']}\n"
                        f"🚦 مرات تهدئة الموقع: {api.rate_limit_hits}\n"
                        f"⏱ الوقت: {duration:.1f} ثانية{resume_note}"
                    )
                else:
                    message = (
                        "⚠️ **توقفت الجولة مع حفظ التقدم**\n\n"
                        f"✅ الأقسام المكتملة: {result['categories']}\n"
                        f"⏳ المتبقية: {result['pending_categories']}\n"
                        f"⚠️ المتعثرة: {result['failed_categories']}\n"
                        f"📦 المنتجات المحفوظة: {result['products']}\n\n"
                        "اضغط «فحص شامل» لاحقاً وسيكمل من المكان المحفوظ."
                    )
                await safe_send_message(
                    notify_user_id, message,
                    reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                        [InlineKeyboardButton(text='📊 حالة المزامنة', callback_data='admin_api_sync_status')],
                        [back_btn('admin_panel')],
                    ]),
                )
            return result

        except asyncio.CancelledError:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE api_sync_queue SET state = 'pending' WHERE state = 'processing'"
                )
                await db.execute(
                    "INSERT OR REPLACE INTO api_sync_meta(key, value) VALUES ('status', 'paused')"
                )
                await db.execute(
                    "INSERT OR REPLACE INTO api_sync_meta(key, value) VALUES ('updated_at', ?)",
                    (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),),
                )
                await db.commit()
            raise
        except Exception as exc:
            duration = asyncio.get_running_loop().time() - started_at
            result.update({'duration': duration, 'error': clean_api_text(exc, 300)})
            logger.error('Smart full sync failed: %s', exc, exc_info=True)
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE api_sync_queue SET state = 'pending' WHERE state = 'processing'"
                )
                await db.execute(
                    "INSERT OR REPLACE INTO api_sync_meta(key, value) VALUES ('status', 'partial')"
                )
                await db.execute(
                    "INSERT OR REPLACE INTO api_sync_meta(key, value) VALUES ('updated_at', ?)",
                    (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),),
                )
                await db.commit()
            if notify_user_id:
                await safe_send_message(
                    notify_user_id,
                    f"❌ **توقفت المزامنة مع حفظ التقدم**\n\n{clean_api_text(exc, 250)}\n\n"
                    "عند تشغيل الفحص الشامل مرة أخرى سيكمل من المكان المحفوظ.",
                    reply_markup=back_to_main_kb(),
                )
            return result
        finally:
            if full_products_task is not None and not full_products_task.done():
                full_products_task.cancel()
                await asyncio.gather(full_products_task, return_exceptions=True)
            API_SYNC_STATUS['running'] = False
            API_SYNC_STATUS['last_result'] = result.get('status', 'failed')
            API_SYNC_STATUS['last_duration'] = result.get('duration', 0.0)


async def start_sync_task():
    """
    تشغيل مزامنة واحدة فقط عند بدء البوت.
    لا توجد حلقة تلقائية متكررة؛ التحديثات التالية تُشغّل من لوحة الإدارة.
    """
    if not SYNC_ON_START:
        logger.info('Startup sync is disabled.')
        return
    if SYNC_START_DELAY_SECONDS:
        await asyncio.sleep(SYNC_START_DELAY_SECONDS)
    try:
        # طرق الدفع تُدار يدوياً حالياً، لذلك لا نحاول مزامنتها مع الموقع.
        result = await sync_products_from_api(mode='auto')
        logger.info('Startup sync result: %s', result.get('status'))
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.error('Startup sync error: %s', exc, exc_info=True)


# =============================================================================
# دوال إدارة المتغيرات (Variants)
# =============================================================================

async def create_product_with_variants(db_path, category_id, product_name, description, variants):
    """إنشاء منتج مع متغيرات متعددة"""
    try:
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        async with aiosqlite.connect(db_path) as db:
            # إنشاء المنتج الأساسي
            await db.execute(
                """INSERT INTO products 
                (category_id, name, description, price, stock, product_type, 
                 created_at, has_variants, variant_type)
                VALUES (?, ?, ?, ?, ?, 'stock', ?, 1, 'quantity')""",
                (category_id, product_name, description, 0, 
                 sum(v.get('stock', 0) for v in variants), now)
            )
            await db.commit()
            
            # الحصول على معرف المنتج
            async with db.execute("SELECT last_insert_rowid()") as cursor:
                product_id = (await cursor.fetchone())[0]
            
            # إضافة المتغيرات
            for variant in variants:
                await db.execute(
                    """INSERT INTO product_variants
                    (product_id, variant_name, variant_value, price, stock, 
                     api_product_id, api_provider, is_active, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)""",
                    (product_id, variant.get('name', 'Unknown'), 
                     variant.get('value', ''), variant.get('price', 0),
                     variant.get('stock', 0), variant.get('api_id', 0),
                     variant.get('api_provider', ''), now)
                )
            await db.commit()
            logger.info(f"✅ Product {product_id} created with {len(variants)} variants")
            return product_id
    except Exception as e:
        logger.error(f"❌ Error creating product with variants: {e}")
        return None

async def get_product_variants(db_path, product_id):
    """الحصول على جميع متغيرات المنتج"""
    try:
        async with aiosqlite.connect(db_path) as db:
            async with db.execute(
                """SELECT id, variant_name, variant_value, price, stock, 
                          api_product_id, api_provider, is_active
                   FROM product_variants
                   WHERE product_id = ? AND is_active = 1
                   ORDER BY id ASC""",
                (product_id,)
            ) as cursor:
                rows = await cursor.fetchall()
                return [{'id': r[0], 'name': r[1], 'value': r[2], 'price': r[3],
                        'stock': r[4], 'api_id': r[5], 'api_provider': r[6], 'is_active': r[7]}
                        for r in rows] if rows else None
    except Exception as e:
        logger.error(f"❌ Error getting variants: {e}")
        return None

async def add_variant_to_product(db_path, product_id, variant_name, price, stock, api_id=0, api_provider=''):
    """إضافة متغير جديد للمنتج"""
    try:
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                """INSERT INTO product_variants
                (product_id, variant_name, variant_value, price, stock,
                 api_product_id, api_provider, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)""",
                (product_id, variant_name, '', price, stock, api_id, api_provider, now)
            )
            await db.commit()
            logger.info(f"✅ Variant added to product {product_id}")
            return True
    except Exception as e:
        logger.error(f"❌ Error adding variant: {e}")
        return False

async def get_variant_by_id(db_path, variant_id):
    """الحصول على تفاصيل متغير معين"""
    try:
        async with aiosqlite.connect(db_path) as db:
            async with db.execute(
                """SELECT id, product_id, variant_name, variant_value, price, stock,
                          api_product_id, api_provider, is_active
                   FROM product_variants WHERE id = ?""",
                (variant_id,)
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    return {'id': row[0], 'product_id': row[1], 'name': row[2], 
                           'value': row[3], 'price': row[4], 'stock': row[5],
                           'api_id': row[6], 'api_provider': row[7], 'is_active': row[8]}
                return None
    except Exception as e:
        logger.error(f"❌ Error getting variant: {e}")
        return None

async def update_variant_stock(db_path, variant_id, new_stock):
    """تحديث المخزون للمتغير"""
    try:
        async with aiosqlite.connect(db_path) as db:
            await db.execute("UPDATE product_variants SET stock = ? WHERE id = ?", (new_stock, variant_id))
            await db.commit()
            return True
    except Exception as e:
        logger.error(f"❌ Error updating variant stock: {e}")
        return False


# =============================================================================
# معالجات واجهة المتغيرات (Variants)
# =============================================================================

@dp.callback_query(F.data.startswith("variant_select_"))
async def cb_variant_select(callback: CallbackQuery, state: FSMContext):
    try:
        variant_id = int(callback.data.split('_')[-1])
        variant = await get_variant_by_id(DB_PATH, variant_id)
        if not variant or not variant.get('is_active'):
            await callback.answer('الخيار غير موجود.', show_alert=True)
            return
        if int(variant.get('stock') or 0) <= 0:
            await callback.answer('هذا الخيار غير متوفر حالياً.', show_alert=True)
            return

        if int(variant.get('api_id') or 0) > 0 and variant.get('api_provider') == 'js4card':
            await start_api_purchase_flow(
                callback,
                state,
                int(variant['api_id']),
                int(variant['product_id']),
                price_override=float(variant['price']),
                variant_id=variant_id,
                variant_name=str(variant['name']),
            )
            return

        await state.clear()
        await show_local_purchase_confirmation(
            callback.message,
            state,
            int(variant['product_id']),
            variant_id=variant_id,
            edit=True,
        )
        await callback.answer()
    except Exception as exc:
        logger.error('Variant selection error: %s', exc, exc_info=True)
        await callback.answer('حدث خطأ أثناء اختيار المنتج.', show_alert=True)


@dp.callback_query(F.data.startswith("confirm_variant_buy_"))
async def cb_confirm_variant_buy(callback: CallbackQuery, state: FSMContext):
    """دعم الأزرار القديمة من دون تنفيذ شراء وهمي."""
    try:
        variant_id = int(callback.data.split('_')[-1])
        variant = await get_variant_by_id(DB_PATH, variant_id)
        if not variant:
            await callback.answer('الخيار غير موجود.', show_alert=True)
            return
        callback.data = f"order_place_{variant['product_id']}"
        await state.update_data(
            order_product_id=int(variant['product_id']),
            selected_variant_id=variant_id,
            order_expected_price=float(variant['price']),
            order_purchase_token=str((await state.get_data()).get('order_purchase_token') or uuid.uuid4()),
        )
        await cb_order_place(callback, state)
    except Exception as exc:
        logger.error('Legacy variant confirmation error: %s', exc, exc_info=True)
        await callback.answer('تعذر تنفيذ الطلب.', show_alert=True)


@dp.callback_query(F.data.startswith("admin_variants_"))
async def cb_admin_list_variants(callback: CallbackQuery):
    """عرض قائمة المتغيرات للأدمن"""
    try:
        product_id = int(callback.data.split("_")[-1])
        variants = await get_product_variants(DB_PATH, product_id)
        
        if not variants:
            await callback.answer("لا توجد متغيرات لهذا المنتج", show_alert=True)
            return
        
        text = f"📦 **متغيرات المنتج #{product_id}**\n\n"
        
        kb = []
        for variant in variants:
            status = "✅" if variant['is_active'] else "❌"
            text += f"• {variant['name']} - {variant['price']}$ ({variant['stock']} متوفر) {status}\n"
            
            btn = InlineKeyboardButton(
                text=f"✏️ {variant['name']}",
                callback_data=f"admin_edit_variant_{variant['id']}"
            )
            kb.append([btn])
        
        kb.append([InlineKeyboardButton(text="➕ إضافة خيار جديد", callback_data=f"admin_add_variant_{product_id}")])
        kb.append([InlineKeyboardButton(text="🔙 رجوع", callback_data="admin_products")])
        
        await callback.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))
        await callback.answer()
    except Exception as e:
        logger.error(f"Error listing variants: {e}")
        await callback.answer("حدث خطأ", show_alert=True)


# =============================================================================
# وحدة ربط API JS4Card - واجهة الأدمن
# =============================================================================

# متغير عام لتخزين بيانات API المؤقتة
api_cache = {
    'categories': [],
    'products': [],
    'selected_products': [],
    'api_instance': None
}



@dp.callback_query(F.data == "admin_api_main")
async def cb_admin_api_main(callback: CallbackQuery):
    """إعادة توجيه للوحة الأدمن (للتوافق مع الأزرار القديمة)"""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    callback.data = "admin_panel"
    perms = await get_admin_perms(callback.from_user.id)
    await safe_edit_message(
        callback.message,
        f"⚙️ **لوحة الإدارة**\n\nالدور: **{admin_role_label(perms.get('role_name', 'custom'))}**\nاختر القسم:",
        admin_panel_kb(perms, await is_super_admin(callback.from_user.id)),
    )
    await callback.answer()

@dp.callback_query(F.data == "admin_api_categories")
async def cb_admin_api_categories(callback: CallbackQuery):
    """عرض الأقسام التابعة للـ API فقط"""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id, name, is_active FROM categories WHERE api_provider = 'js4card' ORDER BY name") as cursor:
            categories = await cursor.fetchall()
            
    text = f"📂 **أقسام API JS4Card** ({len(categories)}):"
    
    kb = []
    for cat in categories:
        status = "✅" if cat[2] else "❌"
        kb.append([InlineKeyboardButton(text=f"{status} {cat[1]}", callback_data=f"admin_cat_{cat[0]}")])
        
    kb.append([back_btn("admin_panel")])
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb))
    await callback.answer()

@dp.callback_query(F.data == "admin_manage_api_products")
async def cb_admin_manage_api_products(callback: CallbackQuery, state: FSMContext, page: int = 0):
    """عرض جميع منتجات API المستوردة مع إمكانية تعديل السعر"""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, name, price, api_provider FROM products WHERE api_provider = 'js4card' ORDER BY name ASC"
        ) as cursor:
            all_api_products = await cursor.fetchall()
            
    per_page = 15
    start = page * per_page
    end = start + per_page
    products_on_page = all_api_products[start:end]
    
    text = f"📦 **إدارة منتجات API** ({len(all_api_products)})\n\nاختر منتجاً لتعديل سعره:"
    if not products_on_page:
        text = "لا توجد منتجات API مستوردة حالياً."
        kb = [[back_btn("admin_panel")]]
    else:
        kb = []
        for p in products_on_page:
            kb.append([InlineKeyboardButton(text=f"{p[1]} | {p[2]} $", callback_data=f"admin_api_edit_price_{p[0]}")])
        
        nav_row = []
        if page > 0:
            nav_row.append(InlineKeyboardButton(text="◀️ السابق", callback_data=f"admin_manage_api_products_page_{page-1}"))
        if end < len(all_api_products):
            nav_row.append(InlineKeyboardButton(text="التالي ▶️", callback_data=f"admin_manage_api_products_page_{page+1}"))
        if nav_row:
            kb.append(nav_row)
        
        kb.append([back_btn("admin_panel")])
    
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb))
    await callback.answer()

@dp.callback_query(F.data.startswith("admin_manage_api_products_page_"))
async def cb_admin_manage_api_products_pagination(callback: CallbackQuery, state: FSMContext):
    page = int(callback.data.split("_")[-1])
    await cb_admin_manage_api_products(callback, state, page)

@dp.callback_query(F.data.startswith("admin_api_edit_price_"))
async def cb_admin_api_edit_price(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    
    product_id = int(callback.data.split("_")[-1])
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT name, price FROM products WHERE id = ?", (product_id,)) as cursor:
            product = await cursor.fetchone()
            
    if not product:
        await callback.answer("المنتج غير موجود.", show_alert=True)
        return
        
    await state.update_data(editing_api_product_id=product_id, original_api_product_price=product[1])
    await state.set_state(AdminAPIManageStates.waiting_new_price)
    
    text = f"✏️ **تعديل سعر المنتج: {product[0]}**\n\n"
    text += f"السعر الحالي: {product[1]}$\n"
    text += "الرجاء إدخال السعر الجديد (رقم عشري):"
    
    kb = [[back_btn("admin_manage_api_products", "❌ إلغاء")]]
    
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb))
    await callback.answer()

@dp.message(AdminAPIManageStates.waiting_new_price)
async def process_admin_api_new_price(message: Message, state: FSMContext):
    if not await is_admin(message.from_user.id):
        await message.answer("⛔ غير مصرح.")
        await state.clear()
        return
        
    try:
        new_price = float(message.text.strip())
        if new_price <= 0:
            await message.answer("❌ السعر يجب أن يكون أكبر من صفر. حاول مرة أخرى:")
            return
    except ValueError:
        await message.answer("❌ الرجاء إدخال رقم صحيح للسعر. حاول مرة أخرى:")
        return
        
    data = await state.get_data()
    product_id = data.get("editing_api_product_id")
    
    if not product_id:
        await message.answer("حدث خطأ. الرجاء المحاولة مرة أخرى.")
        await state.clear()
        return
        
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE products SET price = ? WHERE id = ?", (new_price, product_id))
        await db.commit()
        
    await message.answer(f"✅ تم تحديث سعر المنتج بنجاح إلى {new_price}$.")
    await state.clear()
    
    # العودة إلى لوحة الأدمن
    await message.answer("✅ تم تحديث السعر. اضغط للعودة:", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_products")]]))

@dp.callback_query(F.data == "admin_api_import")
async def cb_admin_api_import(callback: CallbackQuery, state: FSMContext):
    """بدء عملية استيراد المنتجات من API"""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    
    await state.set_state(AdminAPIImportStates.waiting_api_token)
    await safe_edit_message(
        callback.message,
        "🔗 **استيراد منتجات من API**\n\n"
        "أرسل توكن API الخاص بك:\n"
        "(يمكنك الحصول عليه من إعدادات حسابك على موقع JS4Card)",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_panel", "❌ إلغاء")]])
    )
    await callback.answer()

@dp.message(AdminAPIImportStates.waiting_api_token)
async def process_api_token(message: Message, state: FSMContext):
    """معالجة إدخال توكن API"""
    token = message.text.strip()
    
    # اختبار التوكن
    api = JS4CardAPI(api_token=token)
    is_valid = await api.validate_token()
    
    if not is_valid:
        await message.answer("❌ التوكن غير صحيح أو منتهي الصلاحية. حاول مجدداً:")
        return
    
    # حفظ API في الـ cache
    api_cache['api_instance'] = api
    
    # جلب الأقسام والمنتجات
    await message.answer("⏳ جاري جلب البيانات من API...")
    
    content = await api.get_content()
    
    if not content:
        await message.answer("❌ فشل جلب البيانات. حاول لاحقاً.")
        await state.clear()
        return
    
    categories = content.get('categories', [])
    products = content.get('products', [])
    
    api_cache['categories'] = categories
    api_cache['products'] = products
    
    # عرض الأقسام للاختيار
    await state.set_state(AdminAPIImportStates.waiting_category_selection)
    
    text = f"✅ تم الاتصال بنجاح!\n\n"
    text += f"📂 الأقسام المتاحة: {len(categories)}\n"
    text += f"📦 المنتجات المتاحة: {len(products)}\n\n"
    text += "اختر القسم الذي تريد استيراد منتجاته:"
    
    kb = []
    for cat in categories[:10]:  # أول 10 أقسام
        btn = InlineKeyboardButton(
            text=f"📂 {cat.get('name', 'Unknown')}",
            callback_data=f"api_cat_{cat.get('id', 0)}"
        )
        kb.append([btn])
    
    kb.append([InlineKeyboardButton(text="📦 جميع المنتجات", callback_data="api_cat_all")])
    kb.append([back_btn("admin_panel", "❌ إلغاء")])
    
    await message.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))

@dp.callback_query(F.data.startswith("api_cat_"))
async def cb_api_category_select(callback: CallbackQuery, state: FSMContext):
    """اختيار قسم من API"""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    
    cat_id = callback.data.split("_")[2]
    
    if cat_id == "all":
        products = api_cache['products']
    else:
        try:
            cat_id = int(cat_id)
            products = [p for p in api_cache['products'] if p.get('category_id') == cat_id]
        except:
            products = api_cache['products']
    
    if not products:
        await callback.answer("لا توجد منتجات في هذا القسم.", show_alert=True)
        return
    
    # عرض المنتجات للاختيار
    text = f"📦 **المنتجات المتاحة** ({len(products)}):\n\n"
    text += "اختر المنتجات التي تريد استيرادها (يمكنك اختيار أكثر من واحد):\n\n"
    
    kb = []
    for i, prod in enumerate(products[:20]):  # أول 20 منتج
        name = prod.get('name', 'Unknown')[:20]
        price = prod.get('price', 0)
        btn = InlineKeyboardButton(
            text=f"✓ {name} - {price}$",
            callback_data=f"api_prod_toggle_{prod.get('id', i)}"
        )
        kb.append([btn])
    
    kb.append([InlineKeyboardButton(text="✅ استيراد المختارة", callback_data="api_import_selected")])
    kb.append([back_btn("admin_panel", "❌ إلغاء")])
    
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=kb))
    await callback.answer()

@dp.callback_query(F.data.startswith("api_prod_toggle_"))
async def cb_api_product_toggle(callback: CallbackQuery):
    """تبديل اختيار المنتج"""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    
    prod_id = int(callback.data.split("_")[3])
    
    if prod_id in api_cache['selected_products']:
        api_cache['selected_products'].remove(prod_id)
        await callback.answer("❌ تم إلغاء الاختيار")
    else:
        api_cache['selected_products'].append(prod_id)
        await callback.answer("✅ تم الاختيار")

@dp.callback_query(F.data == "api_import_selected")
async def cb_api_import_selected(callback: CallbackQuery):
    """استيراد المنتجات المختارة"""
    if not await is_admin(callback.from_user.id):
        await callback.answer("⛔ غير مصرح.", show_alert=True)
        return
    
    if not api_cache['selected_products']:
        await callback.answer("لم تختر أي منتجات.", show_alert=True)
        return
    
    # جلب المنتجات المختارة
    selected_prods = [p for p in api_cache['products'] if p.get('id') in api_cache['selected_products']]
    
    if not selected_prods:
        await callback.answer("حدث خطأ في جلب المنتجات.", show_alert=True)
        return
    
    # استيراد المنتجات إلى قاعدة البيانات
    imported = 0
    async with aiosqlite.connect(DB_PATH) as db:
        for prod in selected_prods:
            try:
                # البحث عن القسم أو إنشاؤه
                cat_name = prod.get('category_name', 'API Products')
                async with db.execute("SELECT id FROM categories WHERE name = ?", (cat_name,)) as cursor:
                    cat_row = await cursor.fetchone()
                
                if not cat_row:
                    await db.execute("INSERT INTO categories (name, is_active) VALUES (?, 1)", (cat_name,))
                    await db.commit()
                    async with db.execute("SELECT id FROM categories WHERE name = ?", (cat_name,)) as cursor:
                        cat_row = await cursor.fetchone()
                
                cat_id = cat_row[0] if cat_row else 1
                
                # إضافة المنتج مع حفظ api_params لضمان بيانات الشراء
                now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                base_price = float(prod.get('price', 0) or 0)
                default_profit_margin = await get_default_profit_margin()
                category_profit_map, _ = await _load_category_profit_maps(db, default_profit_margin)
                product_margin = category_profit_map.get(cat_id, default_profit_margin)
                final_price = round(base_price * (1 + product_margin / 100), 2)
                api_params_data = json.dumps({
                    "params": prod.get('params', []),
                    "qty_values": prod.get('qty_values', {}),
                    "product_type": prod.get('product_type', 'package'),
                    "base_price": base_price
                })
                await db.execute(
                    "INSERT INTO products (category_id, name, description, price, stock, product_type, api_id, api_provider, api_params, created_at, last_synced) "
                    "VALUES (?, ?, ?, ?, ?, 'stock', ?, 'js4card', ?, ?, ?)",
                    (
                        cat_id,
                        prod.get('name', 'Unknown'),
                        prod.get('description', ''),
                        final_price,
                        prod.get('stock', 100),
                        prod.get('id', 0),
                        api_params_data,
                        now,
                        now
                    )
                )
                imported += 1
            except Exception as e:
                logger.error(f"Error importing product: {e}")
                continue
        
        await db.commit()
    
    # مسح الـ cache
    api_cache['selected_products'] = []
    api_cache['products'] = []
    api_cache['categories'] = []
    api_cache['api_instance'] = None
    
    await callback.answer(f"✅ تم استيراد {imported} منتج بنجاح!", show_alert=True)
    await safe_edit_message(
        callback.message,
        f"✅ **تم الاستيراد!**\n\n"
        f"عدد المنتجات المستوردة: {imported}\n\n"
        f"يمكنك الآن إدارتها من قسم المنتجات.",
        InlineKeyboardMarkup(inline_keyboard=[[back_btn("admin_panel")]])
    )

# إضافة الخيار في لوحة الأدمن
def update_admin_panel_kb():
    """تحديث لوحة الأدمن بإضافة خيار استيراد API"""
    # هذه الدالة تُستخدم في معالج admin_panel
    pass



# =============================================================================
# شراء منتجات API: جمع جميع المتطلبات قبل التأكيد
# =============================================================================


def _to_positive_int(value, default: int = 1) -> int:
    try:
        parsed = int(float(value))
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def _api_intro(data: dict, include_description: bool = False) -> str:
    text = f"🛍 **{clean_api_text(data.get('api_product_name'), 250)}**\n"
    description = clean_api_text(data.get('api_product_description'), 1200)
    if include_description and description:
        text += f"\n📝 {description}\n"
    return text


async def _save_fresh_api_product(local_product_id: int, fresh: dict, current_price: float) -> dict:
    """تحديث الوصف والمتطلبات والسعر المحلي عند فتح المنتج."""
    if not fresh or not local_product_id:
        return {}

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT category_id FROM products WHERE id = ?", (local_product_id,)) as cursor:
            category_row = await cursor.fetchone()
    category_id = int(category_row[0] or 0) if category_row else 0
    profit_margin = await get_effective_profit_margin(category_id)

    base_price = float(fresh.get('price', 0) or 0)
    price = round(base_price * (1 + profit_margin / 100), 2) if base_price > 0 else current_price
    description = extract_api_description(fresh)
    params_payload = {
        'params': fresh.get('params', []),
        'qty_values': fresh.get('qty_values', {}),
        'product_type': fresh.get('product_type', 'package'),
        'base_price': base_price,
        'description': description,
    }
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE products SET description = CASE WHEN ? <> '' THEN ? ELSE description END, "
            "price = ?, api_params = ?, last_synced = ? WHERE id = ?",
            (description, description, price, json.dumps(params_payload, ensure_ascii=False), now, local_product_id)
        )
        await db.commit()
    return {'price': price, 'description': description, **params_payload}


async def show_api_confirmation(message: Message, state: FSMContext, edit: bool = False):
    data = await state.get_data()
    product_id = int(data.get('api_product_id', 0) or 0)
    product_name = clean_api_text(data.get('api_product_name'), 250)
    price = float(data.get('api_product_price', 0) or 0)
    quantity = int(data.get('api_quantity', 1) or 1)
    total_price = round(price * quantity, 2)
    collected = data.get('api_collected_fields', {}) or {}
    fields = data.get('api_normalized_fields', []) or []
    purchase_token = str(data.get('api_purchase_token') or uuid.uuid4())
    request_uuid = str(data.get('api_request_uuid') or uuid.uuid4())

    await state.update_data(
        api_total_price=total_price,
        api_purchase_token=purchase_token,
        api_request_uuid=request_uuid,
    )
    await state.set_state(APIProductPurchaseStates.waiting_confirmation)

    labels = {str(field.get('key')): field.get('label') for field in fields}
    text = (
        f"✅ **راجع طلبك قبل التأكيد**\n\n"
        f"المنتج: {product_name}\n"
    )
    variant_name = clean_api_text(data.get('api_variant_name'), 120)
    if variant_name:
        text += f"الخيار: {variant_name}\n"
    if quantity != 1 or data.get('api_requires_quantity'):
        text += f"الكمية: {quantity}\n"
    for key, value in collected.items():
        text += f"{clean_api_text(labels.get(str(key), key), 80)}: {clean_api_text(value, 300)}\n"
    text += (
        f"الإجمالي: **{total_price:.2f} $**\n\n"
        f"لن يتم خصم الرصيد إلا مرة واحدة بعد التأكيد."
    )

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ تأكيد الطلب", callback_data=f"api_confirm_buy_{product_id}"),
            InlineKeyboardButton(text="❌ إلغاء", callback_data="main_menu"),
        ]
    ])
    if edit:
        await safe_edit_message(message, text, kb)
    else:
        await message.answer(text, reply_markup=kb)


async def prompt_next_api_requirement(message: Message, state: FSMContext, edit: bool = False):
    """طلب المتطلبات بالترتيب، ثم إظهار التأكيد بعد اكتمالها."""
    data = await state.get_data()
    include_description = not bool(data.get('api_intro_shown'))

    if data.get('api_requires_quantity') and not data.get('api_quantity_collected'):
        await state.set_state(APIProductPurchaseStates.waiting_quantity)
        min_qty = int(data.get('api_product_min_qty', 1))
        max_qty = int(data.get('api_product_max_qty', min_qty))
        text = _api_intro(data, include_description)
        text += (
            f"\n📦 **أرسل الكمية المطلوبة**\n"
            f"السعر للوحدة: {float(data.get('api_product_price', 0)):.2f} $\n"
            f"الكمية المسموحة: من {min_qty} إلى {max_qty}"
        )
        await state.update_data(api_intro_shown=True)
        kb = InlineKeyboardMarkup(inline_keyboard=[[back_btn('main_menu', '❌ إلغاء')]])
        if edit:
            await safe_edit_message(message, text, kb)
        else:
            await message.answer(text, reply_markup=kb)
        return

    fields = data.get('api_normalized_fields', []) or []
    index = int(data.get('api_field_index', 0) or 0)
    if index < len(fields):
        field = fields[index]
        await state.update_data(api_current_field=field, api_intro_shown=True)
        await state.set_state(APIProductPurchaseStates.waiting_dynamic_field)
        text = _api_intro(data, include_description)
        text += f"\n📝 **أرسل {clean_api_text(field.get('label'), 120)}**"
        options = field.get('options') or []
        if options:
            text += "\n\nالخيارات المتاحة:\n" + "\n".join(f"• {option}" for option in options)
        if not field.get('required', True):
            text += "\n\nيمكنك إرسال /skip لتجاوز هذا الحقل."
        kb = InlineKeyboardMarkup(inline_keyboard=[[back_btn('main_menu', '❌ إلغاء')]])
        if edit:
            await safe_edit_message(message, text, kb)
        else:
            await message.answer(text, reply_markup=kb)
        return

    await show_api_confirmation(message, state, edit=edit)


async def start_api_purchase_flow(
    callback: CallbackQuery,
    state: FSMContext,
    api_product_id: int,
    local_product_id: int = 0,
    *,
    price_override: float | None = None,
    variant_id: int = 0,
    variant_name: str = '',
):
    """جلب أحدث متطلبات المنتج من الموقع ثم بدء الأسئلة مباشرة."""
    try:
        user_id = callback.from_user.id
        if await is_banned(user_id):
            await callback.answer('🚫 أنت محظور.', show_alert=True)
            return

        async with aiosqlite.connect(DB_PATH) as db:
            if local_product_id and variant_id:
                query = (
                    "SELECT id, name, description, price, api_params FROM products "
                    "WHERE id = ? AND is_active = 1"
                )
                args = (local_product_id,)
            elif local_product_id:
                query = (
                    "SELECT id, name, description, price, api_params FROM products "
                    "WHERE id = ? AND api_id = ? AND api_provider = 'js4card' AND is_active = 1"
                )
                args = (local_product_id, api_product_id)
            else:
                query = (
                    "SELECT id, name, description, price, api_params FROM products "
                    "WHERE api_id = ? AND api_provider = 'js4card' AND is_active = 1"
                )
                args = (api_product_id,)
            async with db.execute(query, args) as cursor:
                row = await cursor.fetchone()

        if not row:
            await callback.answer('المنتج غير موجود أو غير متاح.', show_alert=True)
            return

        local_product_id, product_name, local_description, price, raw_params = row
        if price_override is not None:
            price = round(float(price_override), 2)
        try:
            local_payload = json.loads(raw_params) if raw_params else {}
        except (TypeError, json.JSONDecodeError):
            local_payload = {}
        if not isinstance(local_payload, dict):
            local_payload = {}
        try:
            base_price = float(local_payload.get('base_price', 0) or 0)
        except (TypeError, ValueError):
            base_price = 0.0

        # نستخدم المتطلبات التي حُفظت أثناء المزامنة أولاً. هذا يجعل فتح المنتج
        # فورياً ولا يضغط على موقع المزود عند كل ضغطة من الزبائن.
        product_name = clean_api_text(product_name, 250)
        description = clean_api_text(local_description or local_payload.get('description'), 3000)
        params = local_payload.get('params', [])
        qty_values = local_payload.get('qty_values', {}) or {}
        product_type = local_payload.get('product_type', 'package')
        if not isinstance(qty_values, dict):
            qty_values = {}
        if not isinstance(params, (list, dict)):
            params = []

        # إذا كانت المزامنة القديمة لم تحفظ المتطلبات إطلاقاً، نحاول مرة واحدة
        # بمهلة قصيرة فقط، ثم نعود للبيانات المحلية بدلاً من إظهار خطأ للزبون.
        local_requirements_missing = bool(variant_id) or (not params and not qty_values)
        if local_requirements_missing and API_TOKEN:
            try:
                async with JS4CardAPI(api_token=API_TOKEN, connection_limit=1) as api:
                    fresh_products = await asyncio.wait_for(
                        api.get_products([api_product_id]),
                        timeout=10,
                    )
                fresh_product = fresh_products[0] if fresh_products else None
                if isinstance(fresh_product, dict):
                    # المتغير المرتبط بمنتج API مستقل لا يجب أن يكتب سعره أو وصفه
                    # فوق المنتج الأب. نحفظ التحديث محلياً فقط للمنتج المباشر.
                    if variant_id:
                        refreshed = {
                            'description': extract_api_description(fresh_product),
                            'price': float(price or 0),
                        }
                    else:
                        refreshed = await _save_fresh_api_product(
                            local_product_id,
                            fresh_product,
                            float(price or 0),
                        )
                    product_name = clean_api_text(fresh_product.get('name') or product_name, 250)
                    description = (
                        refreshed.get('description')
                        or extract_api_description(fresh_product)
                        or description
                    )
                    if price_override is None:
                        price = float(refreshed.get('price') or price or 0)
                    try:
                        base_price = float(fresh_product.get('price', 0) or base_price or 0)
                    except (TypeError, ValueError):
                        pass
                    fresh_params = fresh_product.get('params', [])
                    fresh_qty_values = fresh_product.get('qty_values', {}) or {}
                    params = fresh_params if isinstance(fresh_params, (list, dict)) else []
                    qty_values = fresh_qty_values if isinstance(fresh_qty_values, dict) else {}
                    product_type = fresh_product.get('product_type') or product_type
            except Exception as exc:
                logger.warning(
                    'Requirements fallback failed for API product %s: %s',
                    api_product_id,
                    exc,
                )

        min_qty = _to_positive_int(qty_values.get('min', 1), 1)
        max_qty = _to_positive_int(qty_values.get('max', min_qty), min_qty)
        if max_qty < min_qty:
            max_qty = min_qty
        requires_quantity = str(product_type).lower() == 'amount' or max_qty > min_qty
        fields = normalize_api_fields(params)
        fixed_quantity = min_qty if not requires_quantity else 1

        await state.clear()
        await state.update_data(
            api_product_id=api_product_id,
            local_product_id=local_product_id,
            api_product_name=product_name,
            api_product_description=description,
            api_product_price=float(price or 0),
            api_product_base_price=float(base_price or 0),
            api_product_type=product_type,
            api_product_min_qty=min_qty,
            api_product_max_qty=max_qty,
            api_requires_quantity=requires_quantity,
            api_quantity=fixed_quantity,
            api_quantity_collected=not requires_quantity,
            api_normalized_fields=fields,
            api_field_index=0,
            api_collected_fields={},
            api_intro_shown=False,
            api_purchase_token=str(uuid.uuid4()),
            api_request_uuid=str(uuid.uuid4()),
            api_variant_id=int(variant_id or 0),
            api_variant_name=clean_api_text(variant_name, 120),
        )

        minimum_total = float(price or 0) * (min_qty if requires_quantity else fixed_quantity)
        balance = await get_user_balance(user_id)
        if balance < minimum_total:
            await callback.answer(
                f'رصيدك غير كافٍ. الحد الأدنى المطلوب: {minimum_total:.2f} $',
                show_alert=True
            )
            await state.clear()
            return

        await prompt_next_api_requirement(callback.message, state, edit=True)
        await callback.answer()
    except Exception as exc:
        logger.error(f'Error starting API purchase flow: {exc}', exc_info=True)
        await state.clear()
        await callback.answer('تعذر فتح بيانات هذا المنتج الآن. جرّب بعد اكتمال المزامنة أو شغّل التحديث السريع.', show_alert=True)


@dp.callback_query(F.data.startswith('api_buy_'))
async def cb_api_buy_product(callback: CallbackQuery, state: FSMContext):
    """دعم الأزرار القديمة وتحويلها إلى المسار الجديد."""
    parts = callback.data.split('_')
    try:
        api_product_id = int(parts[2])
        local_product_id = int(parts[3]) if len(parts) > 3 else 0
    except (ValueError, IndexError):
        await callback.answer('بيانات المنتج غير صحيحة.', show_alert=True)
        return
    await start_api_purchase_flow(callback, state, api_product_id, local_product_id)


@dp.message(APIProductPurchaseStates.waiting_quantity)
async def process_api_quantity(message: Message, state: FSMContext):
    try:
        data = await state.get_data()
        min_qty = int(data.get('api_product_min_qty', 1))
        max_qty = int(data.get('api_product_max_qty', min_qty))
        try:
            quantity = int((message.text or '').strip())
        except ValueError:
            await message.answer('❌ أرسل الكمية كرقم صحيح.')
            return
        if quantity < min_qty or quantity > max_qty:
            await message.answer(f'❌ الكمية يجب أن تكون من {min_qty} إلى {max_qty}.')
            return
        price = float(data.get('api_product_price', 0) or 0)
        await state.update_data(
            api_quantity=quantity,
            api_quantity_collected=True,
            api_total_price=round(price * quantity, 2),
        )
        await prompt_next_api_requirement(message, state)
    except Exception as exc:
        logger.error(f'Error processing API quantity: {exc}', exc_info=True)
        await message.answer('❌ حدث خطأ، أرسل الكمية مرة أخرى.')


@dp.message(APIProductPurchaseStates.waiting_dynamic_field)
async def process_api_dynamic_field(message: Message, state: FSMContext):
    try:
        data = await state.get_data()
        field = data.get('api_current_field') or {}
        value = clean_api_text(message.text, 500)

        if value.lower() == '/skip' and not field.get('required', True):
            value = ''
        elif not value:
            await message.answer('❌ هذه المعلومة مطلوبة، أرسلها من فضلك.')
            return

        options = field.get('options') or []
        if options and value:
            matched = next((option for option in options if option.lower() == value.lower()), None)
            if not matched:
                await message.answer('❌ اختر قيمة من الخيارات المعروضة.')
                return
            value = matched

        collected = dict(data.get('api_collected_fields', {}) or {})
        if value:
            collected[str(field.get('key'))] = value
        await state.update_data(
            api_collected_fields=collected,
            api_field_index=int(data.get('api_field_index', 0)) + 1,
            api_current_field=None,
        )
        await prompt_next_api_requirement(message, state)
    except Exception as exc:
        logger.error(f'Error processing dynamic API field: {exc}', exc_info=True)
        await message.answer('❌ حدث خطأ، أرسل المعلومة مرة أخرى.')


@dp.callback_query(F.data.startswith('api_confirm_buy_'))
async def cb_api_confirm_buy(callback: CallbackQuery, state: FSMContext):
    """تنفيذ طلب الموقع بطريقة تمنع الخصم والطلب المكرر."""
    user_id = callback.from_user.id
    try:
        if await is_banned(user_id):
            await callback.answer('🚫 أنت محظور.', show_alert=True)
            await state.clear()
            return
        api_product_id = int(callback.data.split('_')[3])
        data = await state.get_data()
        if int(data.get('api_product_id', 0) or 0) != api_product_id:
            await callback.answer('انتهت بيانات الطلب، اختر المنتج من جديد.', show_alert=True)
            await state.clear()
            return

        purchase_token = str(data.get('api_purchase_token') or '')
        api_request_uuid = str(data.get('api_request_uuid') or '')
        if not purchase_token or not api_request_uuid:
            await callback.answer('انتهت جلسة التأكيد، اختر المنتج من جديد.', show_alert=True)
            await state.clear()
            return

        product_name = clean_api_text(data.get('api_product_name'), 250)
        expected_price = round(float(data.get('api_product_price', 0) or 0), 2)
        quantity = int(data.get('api_quantity', 1) or 1)
        local_product_id = int(data.get('local_product_id', 0) or 0)
        variant_id = int(data.get('api_variant_id', 0) or 0)
        collected = dict(data.get('api_collected_fields', {}) or {})
        fields = data.get('api_normalized_fields', []) or []
        labels = {str(field.get('key')): field.get('label') for field in fields}

        delivery_parts = [
            f"{clean_api_text(labels.get(str(key), key), 80)}: {clean_api_text(value, 300)}"
            for key, value in collected.items()
        ]
        if quantity != 1 or data.get('api_requires_quantity'):
            delivery_parts.insert(0, f'الكمية: {quantity}')
        variant_name = clean_api_text(data.get('api_variant_name'), 120)
        if variant_name:
            delivery_parts.insert(0, f'الخيار: {variant_name}')
        delivery_info_text = ' | '.join(delivery_parts)

        request_payload = {
            'api_product_id': api_product_id,
            'local_product_id': local_product_id,
            'variant_id': variant_id,
            'quantity': quantity,
            'fields': collected,
            'request_uuid': api_request_uuid,
            'base_price': float(data.get('api_product_base_price', 0) or 0),
        }

        await callback.answer('جاري إرسال الطلب...')
        async with get_purchase_lock(user_id):
            reservation = await reserve_api_order_atomic(
                user_id=user_id,
                local_product_id=local_product_id,
                api_product_id=api_product_id,
                quantity=quantity,
                expected_unit_price=expected_price,
                purchase_token=purchase_token,
                api_request_uuid=api_request_uuid,
                delivery_info=delivery_info_text,
                request_payload=request_payload,
                variant_id=variant_id,
            )

        reservation_status = reservation.get('status')
        if reservation_status == 'duplicate':
            order = reservation['order']
            await state.clear()
            await safe_edit_message(
                callback.message,
                f"ℹ️ **تم إرسال هذا الطلب سابقاً**\n\n"
                f"رقم الطلب: #{order['id']}\n"
                f"المبلغ: {float(order['total_price']):.2f} $\n"
                f"الحالة: {order.get('api_status') or order['status']}\n\n"
                f"لم يتم خصم الرصيد مرة أخرى.",
                back_to_main_kb(),
            )
            return
        if reservation_status == 'price_changed':
            new_price = float(reservation['current_price'])
            await state.update_data(api_product_price=new_price, api_total_price=round(new_price * quantity, 2))
            await show_api_confirmation(callback.message, state, edit=True)
            return
        error_messages = {
            'unavailable': 'المنتج أو الخيار لم يعد متاحاً.',
            'insufficient_balance': 'رصيدك غير كافٍ لإتمام الطلب.',
            'invalid_price': 'سعر المنتج غير صالح حالياً.',
        }
        if reservation_status != 'created':
            await safe_edit_message(
                callback.message,
                f"❌ {error_messages.get(reservation_status, 'تعذر تجهيز الطلب.')}",
                back_to_main_kb(),
            )
            return

        order_id = int(reservation['order_id'])
        total_price = float(reservation['total_price'])
        await safe_edit_message(
            callback.message,
            f"⏳ **جارٍ إرسال طلبك إلى الموقع**\n\n"
            f"رقم الطلب: #{order_id}\n"
            f"المنتج: {product_name}\n"
            f"المبلغ: {total_price:.2f} $\n\n"
            f"لا تضغط مرة أخرى؛ تم تثبيت الطلب بأمان.",
            None,
        )

        player_id, extra_params = get_player_id_from_fields(collected)
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE orders SET api_status = 'sending', api_status_updated_at = ? WHERE id = ?",
                    (_purchase_now(), order_id),
                )
                await db.commit()
            async with JS4CardAPI(api_token=API_TOKEN, connection_limit=1) as api:
                api_result = await api.create_order(
                    api_product_id,
                    qty=quantity,
                    player_id=player_id,
                    order_uuid=api_request_uuid,
                    **extra_params,
                )

            result_ok = bool(isinstance(api_result, dict) and api_result.get('_ok', True))
            result_status = str((api_result or {}).get('status', '')).casefold()
            if not result_ok or result_status in {'error', 'failed', 'fail', 'invalid', 'rejected'}:
                if is_definitive_api_failure(api_result):
                    provider_message = clean_api_text(
                        (api_result or {}).get('message') or (api_result or {}).get('error'),
                        500,
                    )
                    now = _purchase_now()
                    async with aiosqlite.connect(DB_PATH) as db:
                        await db.execute(
                            "UPDATE orders SET status = 'cancelled', api_status = 'rejected', "
                            "api_status_message = ?, api_status_updated_at = ?, api_last_checked_at = ?, "
                            "api_notified_status = 'failed', api_monitor_active = 0 WHERE id = ?",
                            (provider_message, now, now, order_id),
                        )
                        await db.commit()
                    refunded = await refund_api_order_once(order_id)
                    new_balance = await get_user_balance(user_id)
                    await state.clear()
                    await safe_edit_message(
                        callback.message,
                        f"❌ **رفض الموقع الطلب**\n\n"
                        f"رقم الطلب: #{order_id}\n"
                        f"المنتج: {product_name}\n"
                        f"السبب: {provider_message or 'رفض بيانات الطلب'}\n\n"
                        f"💰 تمت إعادة {refunded:.2f} $ إلى رصيدك.\n"
                        f"رصيدك الحالي: {new_balance:.2f} $",
                        back_to_main_kb(),
                    )
                    await safe_send_message(
                        ADMIN_ID,
                        f"❌ رفض الموقع الطلب #{order_id}\nالمستخدم: {user_id}\n"
                        f"المنتج: {product_name}\nالسبب: {provider_message or 'غير محدد'}\n"
                        f"تم رد الرصيد: {refunded:.2f} $",
                        parse_mode=None,
                    )
                    return
                raise RuntimeError(clean_api_text((api_result or {}).get('message'), 500) or 'اتصال غير مؤكد')

            api_order_id, raw_order_status, provider_message = extract_created_api_order(api_result)
            status_info = classify_api_order_status(raw_order_status)
            now = _purchase_now()
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE orders SET status = ?, api_order_id = ?, api_status = ?, api_status_message = ?, "
                    "api_status_updated_at = ?, api_last_checked_at = ?, api_notified_status = ?, "
                    "api_monitor_active = ? WHERE id = ?",
                    (
                        status_info['local_status'], api_order_id, status_info['raw'], provider_message,
                        now, now, status_info['key'], 0 if status_info['final'] else 1, order_id,
                    ),
                )
                await db.commit()

            refunded_amount = await refund_api_order_once(order_id) if status_info['failed'] else 0.0
            new_balance = await get_user_balance(user_id)
            await state.clear()
            text = (
                f"✅ **تم إرسال طلبك إلى الموقع**\n\n"
                f"رقم الطلب: #{order_id}\n"
                f"المنتج: {product_name}\n"
                f"المبلغ: {total_price:.2f} $\n"
                f"الحالة: {status_info['label']}\n"
                f"رصيدك المتبقي: {new_balance:.2f} $\n\n"
                f"🔔 سيصلك إشعار تلقائي عند تغير الحالة."
            )
            if refunded_amount > 0:
                text += f"\n\n💰 تمت إعادة {refunded_amount:.2f} $ إلى رصيدك."
            await safe_edit_message(callback.message, text, back_to_main_kb())

            admin_lines = [
                '✅ طلب API جديد',
                f'رقم الطلب: #{order_id}',
                f'المستخدم: {callback.from_user.first_name} ({user_id})',
                f'المنتج: {product_name}',
                f'المبلغ: {total_price:.2f} $',
                f"الحالة: {status_info['label']}",
                f'رقم طلب الموقع: {api_order_id or api_request_uuid}',
            ]
            if delivery_info_text:
                admin_lines.append(f'البيانات: {delivery_info_text}')
            await safe_send_message(ADMIN_ID, '\n'.join(admin_lines), parse_mode=None)

        except Exception as exc:
            # لا نعيد الرصيد عند انقطاع الاتصال لأن الموقع قد يكون أنشأ الطلب فعلاً.
            # يبقى UUID محفوظاً ويقوم مراقب الحالات بالتحقق منه تلقائياً.
            logger.error('API order uncertain result for #%s: %s', order_id, exc, exc_info=True)
            now = _purchase_now()
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE orders SET status = 'pending', api_status = 'pending_connection_check', "
                    "api_status_message = ?, api_status_updated_at = ?, api_monitor_active = 1 "
                    "WHERE id = ?",
                    (clean_api_text(exc, 500), now, order_id),
                )
                await db.commit()
            new_balance = await get_user_balance(user_id)
            await state.clear()
            await safe_edit_message(
                callback.message,
                f"⚠️ **تعذر تأكيد رد الموقع حالياً**\n\n"
                f"رقم الطلب: #{order_id}\n"
                f"المنتج: {product_name}\n"
                f"المبلغ: {total_price:.2f} $\n"
                f"رصيدك المتبقي: {new_balance:.2f} $\n\n"
                f"البوت سيتحقق تلقائياً باستخدام رقم الطلب الآمن. "
                f"لا تعِد الطلب ولا تحتاج لمراسلة الإدارة الآن.",
                back_to_main_kb(),
            )
            await safe_send_message(
                ADMIN_ID,
                f"⚠️ نتيجة غير مؤكدة للطلب #{order_id}\nالمستخدم: {user_id}\n"
                f"المنتج: {product_name}\nUUID: {api_request_uuid}\n"
                f"سيتم التحقق تلقائياً. الخطأ: {clean_api_text(exc, 200)}",
                parse_mode=None,
            )

        await log_activity(user_id, 'api_purchase', f'طلب API #{order_id} - {product_name}')
    except Exception as exc:
        logger.error('Error confirming API purchase: %s', exc, exc_info=True)
        await safe_edit_message(
            callback.message,
            '❌ حدث خطأ أثناء تنفيذ الطلب. راجع قائمة طلباتك قبل المحاولة من جديد؛ النظام يمنع تكرار الخصم.',
            back_to_main_kb(),
        )



# =============================================================================
# نظام الدعم الفني الهجين: تذاكر + واتساب + تيليجرام
# =============================================================================

SUPPORT_CATEGORY_LABELS = {
    'order': '📦 مشكلة في طلب',
    'deposit': '💳 مشكلة في شحن الرصيد',
    'payment': '💰 مشكلة في الدفع',
    'product': '🛍 سؤال عن منتج',
    'other': '📝 مشكلة أخرى',
}

SUPPORT_STATUS_LABELS = {
    'new': '🆕 جديدة',
    'in_progress': '🔄 قيد المتابعة',
    'waiting_user': '💬 بانتظار رد الزبون',
    'resolved': '✅ تم الحل',
    'closed': '🔒 مغلقة',
}

SUPPORT_ACTIVE_STATUSES = ('new', 'in_progress', 'waiting_user')


def _support_now() -> str:
    return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _support_category_label(category: str) -> str:
    return SUPPORT_CATEGORY_LABELS.get(str(category or ''), '📝 مشكلة أخرى')


def _support_status_label(status: str) -> str:
    return SUPPORT_STATUS_LABELS.get(str(status or ''), '❓ غير معروفة')


def _support_extract_payload(message: Message):
    if message.photo:
        return 'photo', (message.caption or '').strip(), message.photo[-1].file_id
    if message.document:
        return 'document', (message.caption or message.document.file_name or '').strip(), message.document.file_id
    if message.text:
        return 'text', message.text.strip(), ''
    return None, '', ''


def _normalize_whatsapp_number(value: str) -> str:
    return ''.join(ch for ch in str(value or '') if ch.isdigit())


def _normalize_telegram_username(value: str) -> str:
    value = str(value or '').strip()
    value = value.replace('https://t.me/', '').replace('http://t.me/', '')
    value = value.split('?', 1)[0].strip('/').lstrip('@')
    return value


async def _support_admin_ids() -> list[int]:
    ids = {ADMIN_ID} if ADMIN_ID else set()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT admin_id FROM admins WHERE can_manage_tickets = 1 AND COALESCE(is_active, 1) = 1"
        ) as cursor:
            for row in await cursor.fetchall():
                if row and row[0]:
                    ids.add(int(row[0]))
    return sorted(ids)


async def _support_send_payload(
    chat_id: int,
    message_type: str,
    content: str,
    file_id: str,
    prefix: str = '',
    reply_markup=None,
) -> bool:
    body = f'{prefix}\n\n{content}'.strip() if content else prefix.strip()
    try:
        if message_type == 'photo' and file_id:
            await bot.send_photo(
                chat_id,
                file_id,
                caption=body[:1024] if body else None,
                reply_markup=reply_markup,
            )
        elif message_type == 'document' and file_id:
            await bot.send_document(
                chat_id,
                file_id,
                caption=body[:1024] if body else None,
                reply_markup=reply_markup,
            )
        else:
            await bot.send_message(
                chat_id,
                body or 'رسالة دعم جديدة',
                reply_markup=reply_markup,
                parse_mode=None,
            )
        return True
    except (TelegramForbiddenError, TelegramBadRequest, TelegramNetworkError) as exc:
        logger.warning('تعذر إرسال رسالة دعم إلى %s: %s', chat_id, exc)
        return False
    except Exception as exc:
        logger.error('خطأ إرسال رسالة دعم إلى %s: %s', chat_id, exc)
        return False


async def _support_get_ticket(ticket_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT t.id, t.user_id, t.category, t.subject, t.order_id, t.status,
                   t.assigned_admin, t.created_at, t.updated_at, t.last_message_at,
                   t.closed_at, t.rating, u.username, u.full_name, u.store_user_id
            FROM support_tickets t
            LEFT JOIN users u ON u.user_id = t.user_id
            WHERE t.id = ?
            """,
            (ticket_id,),
        ) as cursor:
            return await cursor.fetchone()


async def _support_get_messages(ticket_id: int, limit: int = 12):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, sender_id, sender_role, message_type, content, file_id, created_at
            FROM support_messages
            WHERE ticket_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (ticket_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
    return list(reversed(rows))


async def _support_add_message(
    ticket_id: int,
    sender_id: int,
    sender_role: str,
    message_type: str,
    content: str,
    file_id: str,
):
    now = _support_now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO support_messages
            (ticket_id, sender_id, sender_role, message_type, content, file_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (ticket_id, sender_id, sender_role, message_type, content, file_id, now),
        )
        await db.execute(
            "UPDATE support_tickets SET updated_at = ?, last_message_at = ? WHERE id = ?",
            (now, now, ticket_id),
        )
        await db.commit()


async def _support_notify_admins(
    ticket_id: int,
    user_id: int,
    category: str,
    message_type: str,
    content: str,
    file_id: str,
    is_reply: bool = False,
):
    ticket = await _support_get_ticket(ticket_id)
    full_name = ticket[13] if ticket and ticket[13] else str(user_id)
    store_id = ticket[14] if ticket and ticket[14] else f'USR{user_id:06d}'
    title = '💬 رد جديد على تذكرة' if is_reply else '🆕 تذكرة دعم جديدة'
    prefix = (
        f'{title} #{ticket_id}\n'
        f'الزبون: {full_name}\n'
        f'معرف المتجر: {store_id}\n'
        f'النوع: {_support_category_label(category)}'
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text='🎧 فتح التذكرة', callback_data=f'admin_support_ticket_{ticket_id}')
    ]])
    for admin_id in await _support_admin_ids():
        await _support_send_payload(admin_id, message_type, content, file_id, prefix, kb)


async def _support_notify_user_status(ticket_id: int, user_id: int, status: str):
    await safe_send_message(
        user_id,
        f'🎧 تم تحديث التذكرة #{ticket_id}\nالحالة الجديدة: {_support_status_label(status)}',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text='فتح التذكرة', callback_data=f'support_ticket_{ticket_id}')
        ]]),
        parse_mode=None,
    )


async def _support_menu_keyboard(user_id: int) -> InlineKeyboardMarkup:
    rows = []
    tickets_enabled = await get_setting('support_ticket_enabled', '1') == '1'
    wa_enabled = await get_setting('support_whatsapp_enabled', '0') == '1'
    tg_enabled = await get_setting('support_telegram_enabled', '0') == '1'
    whatsapp = _normalize_whatsapp_number(await get_setting('support_whatsapp_number', ''))
    telegram = _normalize_telegram_username(await get_setting('support_telegram_username', ''))

    if tickets_enabled:
        rows.append([
            InlineKeyboardButton(text='➕ فتح تذكرة جديدة', callback_data='support_new_ticket'),
            InlineKeyboardButton(text='📨 تذاكري', callback_data='support_my_tickets'),
        ])
    if wa_enabled and whatsapp:
        store_id = f'USR{user_id:06d}'
        message = quote(f'مرحباً، أحتاج مساعدة في UCHIHA STORE. معرفي: {store_id}')
        rows.append([InlineKeyboardButton(text='💬 التواصل عبر واتساب', url=f'https://wa.me/{whatsapp}?text={message}')])
    if tg_enabled and telegram:
        rows.append([InlineKeyboardButton(text='✈️ التواصل عبر تيليجرام', url=f'https://t.me/{telegram}')])
    rows.append([back_btn('main_menu', '🏠 القائمة الرئيسية')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def show_support_center(callback: CallbackQuery):
    intro = await get_setting(
        'support_message',
        'اختر وسيلة التواصل المناسبة. للمشكلات المرتبطة بطلب أو رصيد، استخدم التذاكر حتى تبقى التفاصيل محفوظة.',
    )
    kb = await _support_menu_keyboard(callback.from_user.id)
    await safe_edit_message(
        callback.message,
        f'🎧 مركز الدعم الفني\n\n{intro}',
        kb,
        parse_mode=None,
    )
    await callback.answer()


def support_categories_kb() -> InlineKeyboardMarkup:
    buttons = [
        InlineKeyboardButton(text=label, callback_data=f'support_cat_{key}')
        for key, label in SUPPORT_CATEGORY_LABELS.items()
    ]
    rows = _two_column_rows(buttons)
    rows.append([back_btn('support', '🔙 رجوع')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def support_ticket_list_kb(tickets: list) -> InlineKeyboardMarkup:
    rows = []
    for ticket in tickets:
        ticket_id, category, status, last_message_at = ticket
        rows.append([InlineKeyboardButton(
            text=f'{_support_status_label(status)} | #{ticket_id} | {_support_category_label(category)}',
            callback_data=f'support_ticket_{ticket_id}',
        )])
    rows.append([back_btn('support', '🔙 مركز الدعم')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def support_ticket_user_kb(ticket_id: int, status: str) -> InlineKeyboardMarkup:
    rows = []
    if status in SUPPORT_ACTIVE_STATUSES:
        rows.append([InlineKeyboardButton(text='💬 إضافة رد', callback_data=f'support_reply_{ticket_id}')])
        rows.append([InlineKeyboardButton(text='✅ إغلاق التذكرة', callback_data=f'support_close_{ticket_id}')])
    elif status in ('resolved', 'closed'):
        rows.append([InlineKeyboardButton(text='🔓 إعادة فتح التذكرة', callback_data=f'support_reopen_{ticket_id}')])
    rows.append([back_btn('support_my_tickets', '🔙 تذاكري')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def admin_support_center_kb(show_settings: bool = False) -> InlineKeyboardMarkup:
    rows = [[
        InlineKeyboardButton(text='🆕 المفتوحة', callback_data='admin_support_open'),
        InlineKeyboardButton(text='📁 المغلقة', callback_data='admin_support_closed'),
    ]]
    if show_settings:
        rows.append([InlineKeyboardButton(text='🔗 إعدادات التواصل', callback_data='admin_support_contacts')])
    rows.append([back_btn('admin_panel')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def admin_support_ticket_kb(ticket_id: int, status: str) -> InlineKeyboardMarkup:
    rows = []
    if status not in ('resolved', 'closed'):
        rows.append([InlineKeyboardButton(text='💬 الرد على الزبون', callback_data=f'admin_support_reply_{ticket_id}')])
        rows.append([
            InlineKeyboardButton(text='🔄 قيد المتابعة', callback_data=f'admin_support_status_{ticket_id}_in_progress'),
            InlineKeyboardButton(text='⏳ بانتظار الزبون', callback_data=f'admin_support_status_{ticket_id}_waiting_user'),
        ])
        rows.append([
            InlineKeyboardButton(text='✅ تم الحل', callback_data=f'admin_support_status_{ticket_id}_resolved'),
            InlineKeyboardButton(text='🔒 إغلاق', callback_data=f'admin_support_status_{ticket_id}_closed'),
        ])
    else:
        rows.append([InlineKeyboardButton(text='🔓 إعادة فتح', callback_data=f'admin_support_status_{ticket_id}_in_progress')])
    rows.append([back_btn('admin_support_open', '🔙 التذاكر')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _render_support_ticket(ticket_id: int, viewer: str = 'user') -> tuple[str, InlineKeyboardMarkup] | None:
    ticket = await _support_get_ticket(ticket_id)
    if not ticket:
        return None
    messages = await _support_get_messages(ticket_id, 8)
    lines = [
        f'🎧 تذكرة الدعم #{ticket[0]}',
        f'النوع: {_support_category_label(ticket[2])}',
        f'الحالة: {_support_status_label(ticket[5])}',
        f'تاريخ الفتح: {ticket[7]}',
    ]
    if viewer == 'admin':
        username = f'@{ticket[12]}' if ticket[12] else 'بدون اسم مستخدم'
        lines.extend([
            f'الزبون: {ticket[13] or ticket[1]}',
            f'معرف المتجر: {ticket[14] or f"USR{ticket[1]:06d}"}',
            f'تيليجرام: {username}',
            f'User ID: {ticket[1]}',
        ])
    lines.append('\nآخر الرسائل:')
    for msg in messages:
        role = 'الزبون' if msg[2] == 'user' else 'الدعم'
        content = (msg[4] or '').strip()
        if msg[3] == 'photo':
            content = f'[صورة مرفقة] {content}'.strip()
        elif msg[3] == 'document':
            content = f'[ملف مرفق] {content}'.strip()
        if len(content) > 260:
            content = content[:257] + '...'
        lines.append(f'\n{role} — {msg[6]}\n{content or "مرفق"}')
    if viewer == 'admin':
        kb = admin_support_ticket_kb(ticket_id, ticket[5])
    else:
        kb = support_ticket_user_kb(ticket_id, ticket[5])
    return '\n'.join(lines), kb


async def _show_admin_support_center(callback: CallbackQuery):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM support_tickets WHERE status IN ('new','in_progress','waiting_user')"
        ) as cursor:
            open_count = (await cursor.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM support_tickets WHERE status IN ('resolved','closed')"
        ) as cursor:
            closed_count = (await cursor.fetchone())[0]
    text = (
        '🎧 مركز الدعم والتذاكر\n\n'
        f'التذاكر المفتوحة: {open_count}\n'
        f'التذاكر المغلقة أو المحلولة: {closed_count}\n\n'
        'يمكن للمشرف الرد وتغيير حالة التذكرة من داخل البوت.'
    )
    await safe_edit_message(callback.message, text, admin_support_center_kb(await is_super_admin(callback.from_user.id)), parse_mode=None)
    await callback.answer()


@dp.callback_query(F.data == 'support_new_ticket')
async def cb_support_new_ticket(callback: CallbackQuery, state: FSMContext):
    if await get_setting('support_ticket_enabled', '1') != '1':
        await callback.answer('نظام التذاكر متوقف حالياً.', show_alert=True)
        return
    try:
        limit = max(1, int(await get_setting('support_open_ticket_limit', '3')))
    except ValueError:
        limit = 3
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND status IN ('new','in_progress','waiting_user')",
            (callback.from_user.id,),
        ) as cursor:
            active_count = (await cursor.fetchone())[0]
    if active_count >= limit:
        await callback.answer(f'لديك {active_count} تذاكر مفتوحة. أغلق أو أكمل إحداها أولاً.', show_alert=True)
        return
    await state.clear()
    await safe_edit_message(
        callback.message,
        'اختر نوع المشكلة:',
        support_categories_kb(),
        parse_mode=None,
    )
    await callback.answer()


@dp.callback_query(F.data.startswith('support_cat_'))
async def cb_support_category(callback: CallbackQuery, state: FSMContext):
    category = callback.data.removeprefix('support_cat_')
    if category not in SUPPORT_CATEGORY_LABELS:
        await callback.answer('نوع المشكلة غير صالح.', show_alert=True)
        return
    await state.set_state(SupportTicketStates.waiting_new_message)
    await state.update_data(support_category=category)
    await safe_edit_message(
        callback.message,
        f'{_support_category_label(category)}\n\nاكتب تفاصيل المشكلة في رسالة واحدة. يمكنك إرسال نص أو صورة أو ملف.',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn('support', '❌ إلغاء')]]),
        parse_mode=None,
    )
    await callback.answer()


@dp.message(SupportTicketStates.waiting_new_message)
async def process_support_new_ticket(message: Message, state: FSMContext):
    message_type, content, file_id = _support_extract_payload(message)
    if not message_type:
        await message.answer('أرسل نصاً أو صورة أو ملفاً يوضح المشكلة.')
        return
    data = await state.get_data()
    category = data.get('support_category', 'other')
    now = _support_now()
    subject = (content or _support_category_label(category))[:120]
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO support_tickets
            (user_id, category, subject, status, created_at, updated_at, last_message_at)
            VALUES (?, ?, ?, 'new', ?, ?, ?)
            """,
            (message.from_user.id, category, subject, now, now, now),
        )
        ticket_id = cursor.lastrowid
        await db.execute(
            """
            INSERT INTO support_messages
            (ticket_id, sender_id, sender_role, message_type, content, file_id, created_at)
            VALUES (?, ?, 'user', ?, ?, ?, ?)
            """,
            (ticket_id, message.from_user.id, message_type, content, file_id, now),
        )
        await db.commit()
    await state.clear()
    await message.answer(
        f'✅ تم فتح تذكرة الدعم #{ticket_id}.\nسيصلك الرد داخل البوت، ويمكنك متابعة التذكرة من قسم «تذاكري».',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text='فتح التذكرة', callback_data=f'support_ticket_{ticket_id}')
        ], [back_btn('support', '🎧 مركز الدعم')]]),
    )
    await _support_notify_admins(ticket_id, message.from_user.id, category, message_type, content, file_id)
    await log_activity(message.from_user.id, 'support_ticket_created', f'تذكرة #{ticket_id}')


@dp.callback_query(F.data == 'support_my_tickets')
async def cb_support_my_tickets(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, category, status, last_message_at
            FROM support_tickets
            WHERE user_id = ?
            ORDER BY last_message_at DESC
            LIMIT 20
            """,
            (callback.from_user.id,),
        ) as cursor:
            tickets = await cursor.fetchall()
    if not tickets:
        await safe_edit_message(
            callback.message,
            'لا توجد لديك تذاكر دعم حتى الآن.',
            InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text='➕ فتح تذكرة', callback_data='support_new_ticket')],
                [back_btn('support')],
            ]),
            parse_mode=None,
        )
    else:
        await safe_edit_message(
            callback.message,
            '📨 تذاكر الدعم الخاصة بك:',
            support_ticket_list_kb(tickets),
            parse_mode=None,
        )
    await callback.answer()


@dp.callback_query(F.data.startswith('support_ticket_'))
async def cb_support_ticket_detail(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    ticket_id = int(callback.data.rsplit('_', 1)[1])
    ticket = await _support_get_ticket(ticket_id)
    if not ticket or ticket[1] != callback.from_user.id:
        await callback.answer('التذكرة غير موجودة.', show_alert=True)
        return
    rendered = await _render_support_ticket(ticket_id, 'user')
    await safe_edit_message(callback.message, rendered[0], rendered[1], parse_mode=None)
    await callback.answer()


@dp.callback_query(F.data.startswith('support_reply_'))
async def cb_support_user_reply(callback: CallbackQuery, state: FSMContext):
    ticket_id = int(callback.data.rsplit('_', 1)[1])
    ticket = await _support_get_ticket(ticket_id)
    if not ticket or ticket[1] != callback.from_user.id:
        await callback.answer('التذكرة غير موجودة.', show_alert=True)
        return
    if ticket[5] not in SUPPORT_ACTIVE_STATUSES:
        await callback.answer('أعد فتح التذكرة أولاً.', show_alert=True)
        return
    await state.set_state(SupportTicketStates.waiting_user_reply)
    await state.update_data(support_ticket_id=ticket_id)
    await safe_edit_message(
        callback.message,
        f'أرسل ردك على التذكرة #{ticket_id}. يمكنك إرسال نص أو صورة أو ملف.',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'support_ticket_{ticket_id}', '❌ إلغاء')]]),
        parse_mode=None,
    )
    await callback.answer()


@dp.message(SupportTicketStates.waiting_user_reply)
async def process_support_user_reply(message: Message, state: FSMContext):
    message_type, content, file_id = _support_extract_payload(message)
    if not message_type:
        await message.answer('أرسل نصاً أو صورة أو ملفاً.')
        return
    data = await state.get_data()
    ticket_id = int(data.get('support_ticket_id', 0))
    ticket = await _support_get_ticket(ticket_id)
    if not ticket or ticket[1] != message.from_user.id:
        await state.clear()
        await message.answer('تعذر العثور على التذكرة.')
        return
    await _support_add_message(ticket_id, message.from_user.id, 'user', message_type, content, file_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE support_tickets SET status = 'new', updated_at = ?, last_message_at = ? WHERE id = ?",
            (_support_now(), _support_now(), ticket_id),
        )
        await db.commit()
    await state.clear()
    await message.answer(
        f'✅ تم إرسال ردك على التذكرة #{ticket_id}.',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text='فتح التذكرة', callback_data=f'support_ticket_{ticket_id}')
        ]]),
    )
    await _support_notify_admins(ticket_id, message.from_user.id, ticket[2], message_type, content, file_id, True)


@dp.callback_query(F.data.startswith('support_close_'))
async def cb_support_user_close(callback: CallbackQuery):
    ticket_id = int(callback.data.rsplit('_', 1)[1])
    now = _support_now()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE support_tickets
            SET status = 'closed', closed_at = ?, updated_at = ?, last_message_at = ?
            WHERE id = ? AND user_id = ? AND status IN ('new','in_progress','waiting_user')
            """,
            (now, now, now, ticket_id, callback.from_user.id),
        )
        await db.commit()
    if cursor.rowcount:
        await callback.answer('تم إغلاق التذكرة.', show_alert=True)
    else:
        await callback.answer('تعذر إغلاق التذكرة.', show_alert=True)
    rendered = await _render_support_ticket(ticket_id, 'user')
    if rendered:
        await safe_edit_message(callback.message, rendered[0], rendered[1], parse_mode=None)


@dp.callback_query(F.data.startswith('support_reopen_'))
async def cb_support_user_reopen(callback: CallbackQuery):
    ticket_id = int(callback.data.rsplit('_', 1)[1])
    now = _support_now()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE support_tickets
            SET status = 'new', closed_at = '', updated_at = ?, last_message_at = ?
            WHERE id = ? AND user_id = ? AND status IN ('resolved','closed')
            """,
            (now, now, ticket_id, callback.from_user.id),
        )
        await db.commit()
    await callback.answer('تمت إعادة فتح التذكرة.' if cursor.rowcount else 'تعذر إعادة فتح التذكرة.', show_alert=True)
    rendered = await _render_support_ticket(ticket_id, 'user')
    if rendered:
        await safe_edit_message(callback.message, rendered[0], rendered[1], parse_mode=None)
    ticket = await _support_get_ticket(ticket_id)
    if cursor.rowcount and ticket:
        await _support_notify_admins(ticket_id, callback.from_user.id, ticket[2], 'text', 'أعاد الزبون فتح التذكرة.', '', True)


@dp.callback_query(F.data == 'admin_support_center')
async def cb_admin_support_center(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    perms = await get_admin_perms(callback.from_user.id)
    if not perms.get('can_manage_tickets'):
        await callback.answer('لا تملك صلاحية إدارة الدعم.', show_alert=True)
        return
    await _show_admin_support_center(callback)


@dp.callback_query(F.data.in_({'admin_support_open', 'admin_support_closed'}))
async def cb_admin_support_list(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    perms = await get_admin_perms(callback.from_user.id)
    if not perms.get('can_manage_tickets'):
        await callback.answer('لا تملك صلاحية إدارة الدعم.', show_alert=True)
        return
    is_closed = callback.data == 'admin_support_closed'
    where = "status IN ('resolved','closed')" if is_closed else "status IN ('new','in_progress','waiting_user')"
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            f"""
            SELECT t.id, t.category, t.status, t.last_message_at, u.full_name, u.store_user_id
            FROM support_tickets t
            LEFT JOIN users u ON u.user_id = t.user_id
            WHERE {where}
            ORDER BY t.last_message_at DESC
            LIMIT 30
            """
        ) as cursor:
            tickets = await cursor.fetchall()
    rows = []
    for ticket in tickets:
        name = ticket[4] or ticket[5] or 'زبون'
        rows.append([InlineKeyboardButton(
            text=f'{_support_status_label(ticket[2])} | #{ticket[0]} | {name[:18]}',
            callback_data=f'admin_support_ticket_{ticket[0]}',
        )])
    rows.append([back_btn('admin_support_center')])
    text = '📁 التذاكر المغلقة والمحلولة' if is_closed else '🆕 التذاكر المفتوحة'
    if not tickets:
        text += '\n\nلا توجد تذاكر في هذا القسم.'
    await safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=rows), parse_mode=None)
    await callback.answer()


@dp.callback_query(F.data.startswith('admin_support_ticket_'))
async def cb_admin_support_ticket_detail(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    ticket_id = int(callback.data.rsplit('_', 1)[1])
    rendered = await _render_support_ticket(ticket_id, 'admin')
    if not rendered:
        await callback.answer('التذكرة غير موجودة.', show_alert=True)
        return
    await safe_edit_message(callback.message, rendered[0], rendered[1], parse_mode=None)
    await callback.answer()


@dp.callback_query(F.data.startswith('admin_support_reply_'))
async def cb_admin_support_reply(callback: CallbackQuery, state: FSMContext):
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    ticket_id = int(callback.data.rsplit('_', 1)[1])
    ticket = await _support_get_ticket(ticket_id)
    if not ticket:
        await callback.answer('التذكرة غير موجودة.', show_alert=True)
        return
    await state.set_state(AdminSupportStates.waiting_admin_reply)
    await state.update_data(admin_support_ticket_id=ticket_id)
    await safe_edit_message(
        callback.message,
        f'اكتب رد الدعم على التذكرة #{ticket_id}. يمكنك إرسال نص أو صورة أو ملف.',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn(f'admin_support_ticket_{ticket_id}', '❌ إلغاء')]]),
        parse_mode=None,
    )
    await callback.answer()


@dp.message(AdminSupportStates.waiting_admin_reply)
async def process_admin_support_reply(message: Message, state: FSMContext):
    if not await is_admin(message.from_user.id):
        await state.clear()
        return
    message_type, content, file_id = _support_extract_payload(message)
    if not message_type:
        await message.answer('أرسل نصاً أو صورة أو ملفاً.')
        return
    data = await state.get_data()
    ticket_id = int(data.get('admin_support_ticket_id', 0))
    ticket = await _support_get_ticket(ticket_id)
    if not ticket:
        await state.clear()
        await message.answer('التذكرة غير موجودة.')
        return
    await _support_add_message(ticket_id, message.from_user.id, 'admin', message_type, content, file_id)
    now = _support_now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            UPDATE support_tickets
            SET status = 'waiting_user', assigned_admin = ?, updated_at = ?, last_message_at = ?
            WHERE id = ?
            """,
            (message.from_user.id, now, now, ticket_id),
        )
        await db.commit()
    await state.clear()
    prefix = f'🎧 رد الدعم على التذكرة #{ticket_id}'
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text='فتح التذكرة والرد', callback_data=f'support_ticket_{ticket_id}')
    ]])
    await _support_send_payload(ticket[1], message_type, content, file_id, prefix, kb)
    await message.answer(
        f'✅ تم إرسال الرد إلى الزبون في التذكرة #{ticket_id}.',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text='فتح التذكرة', callback_data=f'admin_support_ticket_{ticket_id}')
        ]]),
    )
    await log_activity(message.from_user.id, 'support_admin_reply', f'تذكرة #{ticket_id}')


@dp.callback_query(F.data.startswith('admin_support_status_'))
async def cb_admin_support_status(callback: CallbackQuery):
    if not await is_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    match = re.fullmatch(r'admin_support_status_(\d+)_(new|in_progress|waiting_user|resolved|closed)', callback.data)
    if not match:
        await callback.answer('طلب غير صالح.', show_alert=True)
        return
    ticket_id = int(match.group(1))
    new_status = match.group(2)
    ticket = await _support_get_ticket(ticket_id)
    if not ticket:
        await callback.answer('التذكرة غير موجودة.', show_alert=True)
        return
    now = _support_now()
    closed_at = now if new_status in ('resolved', 'closed') else ''
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            UPDATE support_tickets
            SET status = ?, assigned_admin = ?, updated_at = ?, closed_at = ?
            WHERE id = ?
            """,
            (new_status, callback.from_user.id, now, closed_at, ticket_id),
        )
        await db.commit()
    await _support_notify_user_status(ticket_id, ticket[1], new_status)
    rendered = await _render_support_ticket(ticket_id, 'admin')
    await safe_edit_message(callback.message, rendered[0], rendered[1], parse_mode=None)
    await callback.answer(f'تم تغيير الحالة إلى: {_support_status_label(new_status)}', show_alert=True)


async def _support_contacts_text() -> str:
    wa = await get_setting('support_whatsapp_number', '')
    tg = await get_setting('support_telegram_username', '')
    wa_enabled = await get_setting('support_whatsapp_enabled', '0') == '1'
    tg_enabled = await get_setting('support_telegram_enabled', '0') == '1'
    tickets_enabled = await get_setting('support_ticket_enabled', '1') == '1'
    return (
        '🔗 إعدادات التواصل والدعم\n\n'
        f'التذاكر: {"✅ مفعلة" if tickets_enabled else "❌ معطلة"}\n'
        f'واتساب: {"✅" if wa_enabled else "❌"} {wa or "غير محدد"}\n'
        f'تيليجرام: {"✅" if tg_enabled else "❌"} @{tg if tg else "غير محدد"}'
    )


def admin_support_contacts_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text='📱 تعديل رقم واتساب', callback_data='admin_support_set_whatsapp'),
            InlineKeyboardButton(text='✈️ تعديل تيليجرام', callback_data='admin_support_set_telegram'),
        ],
        [
            InlineKeyboardButton(text='تشغيل/إيقاف واتساب', callback_data='admin_support_toggle_whatsapp'),
            InlineKeyboardButton(text='تشغيل/إيقاف تيليجرام', callback_data='admin_support_toggle_telegram'),
        ],
        [InlineKeyboardButton(text='تشغيل/إيقاف نظام التذاكر', callback_data='admin_support_toggle_tickets')],
        [InlineKeyboardButton(text='📝 تعديل رسالة مركز الدعم', callback_data='admin_set_support_msg')],
        [back_btn('admin_support_center')],
    ])


@dp.callback_query(F.data == 'admin_support_contacts')
async def cb_admin_support_contacts(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    if not await is_super_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    await safe_edit_message(
        callback.message,
        await _support_contacts_text(),
        admin_support_contacts_kb(),
        parse_mode=None,
    )
    await callback.answer()


@dp.callback_query(F.data == 'admin_support_set_whatsapp')
async def cb_admin_support_set_whatsapp(callback: CallbackQuery, state: FSMContext):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    current = await get_setting('support_whatsapp_number', '')
    await state.set_state(AdminSettingsStates.waiting_support_whatsapp)
    await safe_edit_message(
        callback.message,
        f'أرسل رقم واتساب بصيغة دولية من دون + أو مسافات.\nمثال: 9639XXXXXXXX\n\nالحالي: {current or "غير محدد"}',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn('admin_support_contacts', '❌ إلغاء')]]),
        parse_mode=None,
    )
    await callback.answer()


@dp.message(AdminSettingsStates.waiting_support_whatsapp)
async def process_admin_support_whatsapp(message: Message, state: FSMContext):
    if not await is_super_admin(message.from_user.id):
        await state.clear()
        return
    number = _normalize_whatsapp_number(message.text or '')
    if len(number) < 8 or len(number) > 16:
        await message.answer('الرقم غير صالح. أرسله بصيغة دولية من 8 إلى 16 رقماً.')
        return
    await set_setting('support_whatsapp_number', number)
    await set_setting('support_whatsapp_enabled', '1')
    await state.clear()
    await message.answer(
        f'✅ تم حفظ رقم واتساب: {number}',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn('admin_support_contacts')]]),
    )


@dp.callback_query(F.data == 'admin_support_set_telegram')
async def cb_admin_support_set_telegram(callback: CallbackQuery, state: FSMContext):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    current = await get_setting('support_telegram_username', '')
    await state.set_state(AdminSettingsStates.waiting_support_telegram)
    await safe_edit_message(
        callback.message,
        f'أرسل اسم مستخدم تيليجرام من دون @.\nمثال: UchihaSupport\n\nالحالي: @{current}' if current else 'أرسل اسم مستخدم تيليجرام من دون @.\nمثال: UchihaSupport',
        InlineKeyboardMarkup(inline_keyboard=[[back_btn('admin_support_contacts', '❌ إلغاء')]]),
        parse_mode=None,
    )
    await callback.answer()


@dp.message(AdminSettingsStates.waiting_support_telegram)
async def process_admin_support_telegram(message: Message, state: FSMContext):
    if not await is_super_admin(message.from_user.id):
        await state.clear()
        return
    username = _normalize_telegram_username(message.text or '')
    if not re.fullmatch(r'[A-Za-z0-9_]{5,32}', username):
        await message.answer('اسم المستخدم غير صالح. استخدم 5 إلى 32 حرفاً أو رقماً أو _.')
        return
    await set_setting('support_telegram_username', username)
    await set_setting('support_telegram_enabled', '1')
    await state.clear()
    await message.answer(
        f'✅ تم حفظ حساب تيليجرام: @{username}',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[back_btn('admin_support_contacts')]]),
    )


async def _toggle_support_setting(callback: CallbackQuery, key: str, label: str):
    if not await is_super_admin(callback.from_user.id):
        await callback.answer('⛔ غير مصرح.', show_alert=True)
        return
    current = await get_setting(key, '0')
    new_value = '0' if current == '1' else '1'
    await set_setting(key, new_value)
    await callback.answer(f'{label}: {"تم التشغيل" if new_value == "1" else "تم الإيقاف"}', show_alert=True)
    await safe_edit_message(
        callback.message,
        await _support_contacts_text(),
        admin_support_contacts_kb(),
        parse_mode=None,
    )


@dp.callback_query(F.data == 'admin_support_toggle_whatsapp')
async def cb_admin_support_toggle_whatsapp(callback: CallbackQuery):
    await _toggle_support_setting(callback, 'support_whatsapp_enabled', 'واتساب')


@dp.callback_query(F.data == 'admin_support_toggle_telegram')
async def cb_admin_support_toggle_telegram(callback: CallbackQuery):
    await _toggle_support_setting(callback, 'support_telegram_enabled', 'تيليجرام')


@dp.callback_query(F.data == 'admin_support_toggle_tickets')
async def cb_admin_support_toggle_tickets(callback: CallbackQuery):
    await _toggle_support_setting(callback, 'support_ticket_enabled', 'نظام التذاكر')



@dp.message(Command("binance_status"))
async def cmd_binance_status(message: Message):
    if not await is_admin(message.from_user.id):
        return
    if not BINANCE_AUTO_PAY_ENABLED:
        await message.answer('🟡 دفع Binance التلقائي متوقف في .env.')
        return
    if not BINANCE_API_KEY or not BINANCE_API_SECRET:
        await message.answer('❌ مفاتيح Binance غير مكتملة في .env.')
        return
    try:
        method_id = await ensure_binance_payment_method()
        address_info = await BINANCE_WALLET.deposit_address()
        address = str(address_info.get('address') or '')
        masked = (address[:8] + '…' + address[-6:]) if len(address) > 18 else address
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT COUNT(*) FROM deposit_requests WHERE status = 'waiting_payment'"
            ) as cursor:
                pending = int((await cursor.fetchone())[0] or 0)
        await message.answer(
            '✅ <b>اتصال Binance يعمل</b>\n\n'
            f'طريقة الدفع: <b>#{method_id}</b>\n'
            f'العملة: <b>{html.escape(BINANCE_COIN)}</b>\n'
            f'الشبكة: <b>{html.escape(BINANCE_NETWORK)}</b>\n'
            f'العنوان: <code>{html.escape(masked)}</code>\n'
            f'طلبات بانتظار الدفع: <b>{pending}</b>',
            parse_mode='HTML',
        )
    except Exception as exc:
        await message.answer(
            '❌ تعذر الاتصال بـ Binance:\n'
            f'<code>{html.escape(clean_api_text(exc, 250))}</code>',
            parse_mode='HTML',
        )


# يجب أن يبقى هذا المعالج في نهاية جميع معالجات الرسائل
@dp.message()
async def handle_unknown_message(message: Message, state: FSMContext):
    current_state = await state.get_state()
    if current_state:
        return
    if await is_admin(message.from_user.id):
        await message.answer('استخدم /start للقائمة الرئيسية أو /admin للوحة الإدارة.')
    else:
        await message.answer('استخدم /start للقائمة الرئيسية.')


async def main():
    await init_db()
    logger.info('بدء تشغيل البوت...')
    # المزامنة تعمل مرة واحدة في الخلفية؛ لا ننتظرها ولا نشغّل نسخة ثانية منها.
    sync_task = asyncio.create_task(start_sync_task())
    order_status_task = asyncio.create_task(order_status_monitor_loop())
    binance_task = asyncio.create_task(binance_payment_worker())
    try:
        await dp.start_polling(bot, skip_updates=True)
    finally:
        for task in (sync_task, order_status_task, binance_task):
            task.cancel()
        for task in (sync_task, order_status_task, binance_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
        await bot.session.close()


if __name__ == '__main__':
    asyncio.run(main())
