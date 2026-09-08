from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from client_services_store import _key_path
from client_store_admin import _allowed


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def _backup_root(store: Any) -> Path:
    custom = os.getenv("CLIENT_BACKUP_DIR", "").strip()
    if custom:
        return Path(custom).expanduser()
    return Path(str(store.DB_PATH)).expanduser().resolve().parent / ".backups" / "client-store"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _chmod(path: Path, mode: int) -> None:
    try:
        path.chmod(mode)
    except OSError:
        pass


def _snapshot_dirs(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(
        [path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def _prune(root: Path) -> None:
    keep = _env_int("CLIENT_BACKUP_KEEP", 7, 2, 50)
    for path in _snapshot_dirs(root)[keep:]:
        shutil.rmtree(path, ignore_errors=True)


def _create_backup_sync(store: Any) -> Path:
    source = Path(str(store.DB_PATH)).expanduser()
    if not source.exists():
        raise FileNotFoundError("قاعدة بيانات العميل غير موجودة بعد.")

    root = _backup_root(store)
    root.mkdir(parents=True, exist_ok=True)
    _chmod(root, 0o700)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snapshot = root / f"{stamp}-{uuid.uuid4().hex[:8]}"
    snapshot.mkdir(parents=False, exist_ok=False)
    _chmod(snapshot, 0o700)

    destination = snapshot / "client_store.db"
    src_db = sqlite3.connect(str(source))
    dst_db = sqlite3.connect(str(destination))
    try:
        src_db.backup(dst_db)
        dst_db.commit()
    finally:
        dst_db.close()
        src_db.close()
    _chmod(destination, 0o600)

    key_source = _key_path(store)
    key_included = key_source.exists()
    if key_included:
        key_destination = snapshot / "client_store.key"
        shutil.copy2(key_source, key_destination)
        _chmod(key_destination, 0o600)

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database": destination.name,
        "database_sha256": _sha256(destination),
        "key_included": bool(key_included),
        "format": 1,
    }
    manifest_path = snapshot / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _chmod(manifest_path, 0o600)
    _prune(root)
    return snapshot


async def create_backup(store: Any) -> Path:
    return await asyncio.to_thread(_create_backup_sync, store)


def backup_summary(store: Any) -> tuple[int, str]:
    root = _backup_root(store)
    snapshots = _snapshot_dirs(root)
    latest = snapshots[0].name if snapshots else "لا توجد نسخة بعد"
    return len(snapshots), latest


async def backup_loop(store: Any) -> None:
    enabled = os.getenv("CLIENT_BACKUP_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}
    if not enabled:
        return
    start_delay = _env_int("CLIENT_BACKUP_START_DELAY_SECONDS", 120, 30, 3600)
    interval = _env_int("CLIENT_BACKUP_INTERVAL_SECONDS", 21600, 3600, 604800)
    await asyncio.sleep(start_delay)
    while True:
        try:
            await create_backup(store)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger = getattr(store, "logger", None)
            if logger is not None:
                try:
                    logger.warning("Client backup failed: %s", exc)
                except Exception:
                    pass
        await asyncio.sleep(interval)


def install(store: Any) -> None:
    if getattr(store, "_client_backup_installed", False):
        return

    router = Router(name="client_backup")

    @router.callback_query(F.data == "clibackup:home")
    async def backup_home(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_settings"):
            return await callback.answer("غير مصرح.", show_alert=True)
        count, latest = backup_summary(store)
        text = (
            "🗄 النسخ الاحتياطية\n\n"
            f"عدد النسخ المحلية: {count}\n"
            f"آخر نسخة: {latest}\n\n"
            "النسخة تحتوي قاعدة SQLite ونسخة من مفتاح تشفير مزودي API إذا كان موجودًا.\n"
            "لا يتم إرسال ملفات النسخ عبر تيليجرام ولا رفعها إلى GitHub."
        )
        markup = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="➕ إنشاء نسخة الآن", callback_data="clibackup:create")],
                [store.back_btn("cliadmin:home", "🔙 إدارة المتجر")],
            ]
        )
        try:
            await store.safe_edit_message(callback.message, text, markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)
        await callback.answer()

    @router.callback_query(F.data == "clibackup:create")
    async def backup_create(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_settings"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await callback.answer("جاري إنشاء النسخة…")
        try:
            snapshot = await create_backup(store)
        except Exception as exc:
            return await callback.message.answer(f"❌ تعذر إنشاء النسخة: {str(exc)[:180]}")
        await callback.message.answer(
            "✅ تم إنشاء نسخة احتياطية محلية آمنة.\n"
            f"المعرف: {snapshot.name}\n"
            "تم تطبيق سياسة الاحتفاظ القديمة تلقائيًا."
        )

    store.dp.include_router(router)
    store._client_backup_installed = True
