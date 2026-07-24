"""One-screen Sham Cash payment flow for the UCHIHA Telegram bot.

The QR image is shown immediately after the customer chooses Sham Cash. The
same payment card lets the customer choose an amount, copy the account code,
and move to proof submission without creating a second barcode message.
"""

from __future__ import annotations

import html
import logging
import math
from typing import Any, Awaitable, Callable

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

LOGGER = logging.getLogger(__name__)


def _replace_registered_handler(observer: Any, callback_name: str, replacement: Any) -> bool:
    replaced = False
    for handler in getattr(observer, "handlers", []):
        callback = getattr(handler, "callback", None)
        if getattr(callback, "__name__", "") != callback_name:
            continue
        try:
            handler.callback = replacement
        except Exception:
            try:
                object.__setattr__(handler, "callback", replacement)
            except Exception:
                continue
        replaced = True
    return replaced


def _is_shamcash(name: Any, provider: Any = "") -> bool:
    clean_name = str(name or "").strip().lower().replace("_", " ").replace("-", " ")
    clean_provider = str(provider or "").strip().lower().replace("_", "").replace("-", "")
    return (
        clean_provider == "shamcash"
        or "شام كاش" in clean_name
        or "sham cash" in clean_name
        or "shamcash" in clean_name.replace(" ", "")
    )


def _money(store: Any, value: Any) -> str:
    formatter = getattr(store, "_money", None)
    if callable(formatter):
        return str(formatter(value))
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.0
    text = f"{number:.2f}".rstrip("0").rstrip(".")
    return text or "0"


def _copy_button(store: Any, method_id: int, value: str) -> InlineKeyboardButton | None:
    value = str(value or "").strip()
    if not value:
        return None
    copy_type = getattr(store, "CopyTextButton", None)
    if copy_type is not None and len(value) <= 256:
        try:
            return InlineKeyboardButton(
                text="📋 نسخ رمز الحساب",
                copy_text=copy_type(text=value),
            )
        except Exception:
            pass
    return InlineKeyboardButton(
        text="📋 عرض الرمز للنسخ",
        callback_data=f"payment_copy_{method_id}",
    )


def _keyboard(store: Any, data: dict[str, Any], amount_selected: bool) -> InlineKeyboardMarkup:
    method_id = int(data.get("payment_method_id") or 0)
    transfer_value = str(data.get("payment_transfer_value") or "").strip()
    rows: list[list[InlineKeyboardButton]] = []

    amount = float(data.get("deposit_paid_amount") or 0)
    amount_label = (
        f"💵 تغيير المبلغ: {_money(store, amount)}"
        if amount_selected and amount > 0
        else "💵 اختيار المبلغ"
    )
    rows.append([
        InlineKeyboardButton(text=amount_label, callback_data="shamcash_choose_amount")
    ])
    rows.append([
        InlineKeyboardButton(text="📤 إثبات التحويل", callback_data="shamcash_send_proof")
    ])

    copy_button = _copy_button(store, method_id, transfer_value)
    if copy_button is not None:
        rows.append([copy_button])
    rows.append([store.back_btn("deposit_request", "❌ إلغاء وتغيير الطريقة")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _caption(store: Any, data: dict[str, Any], *, waiting_for_amount: bool = False) -> str:
    name = str(data.get("payment_method_name") or "شام كاش")
    icon = str(data.get("payment_method_icon") or "🟣")
    currency = str(data.get("payment_method_currency") or "USD")
    transfer_label = str(data.get("payment_transfer_label") or "رمز الحساب")
    transfer_value = str(data.get("payment_transfer_value") or "").strip()
    paid_amount = float(data.get("deposit_paid_amount") or 0)
    credited_amount = float(data.get("deposit_amount") or 0)
    method_min = float(data.get("payment_method_min") or 0)
    method_max = float(data.get("payment_method_max") or 0)

    amount_block = "💵 <b>المبلغ:</b> لم يتم اختياره بعد"
    if paid_amount > 0:
        amount_block = (
            f"💵 <b>المبلغ المطلوب تحويله كاملًا:</b> "
            f"{html.escape(_money(store, paid_amount))} {html.escape(currency)}\n"
            f"💰 <b>الرصيد الذي سيصل:</b> "
            f"{html.escape(_money(store, credited_amount))} USD"
        )

    limits: list[str] = []
    if method_min > 0:
        limits.append(f"الحد الأدنى {_money(store, method_min)} {currency}")
    if method_max > 0:
        limits.append(f"الحد الأعلى {_money(store, method_max)} {currency}")
    limits_block = f"\n📊 <b>{html.escape(' — '.join(limits))}</b>" if limits else ""

    if waiting_for_amount:
        prompt = "\n\n✍️ <b>أرسل الآن المبلغ الذي تريد شحنه كرقم في المحادثة.</b>"
    elif paid_amount > 0:
        prompt = (
            "\n\n✅ تم تثبيت المبلغ. اضغط <b>إثبات التحويل</b> ثم أرسل "
            "رقم العملية أو معرّف التحويل."
        )
    else:
        prompt = "\n\nاضغط <b>اختيار المبلغ</b> وحدد المبلغ الذي تريد شحنه."

    account_block = ""
    if transfer_value:
        account_block = (
            f"🔢 <b>{html.escape(transfer_label)}:</b>\n"
            f"<code>{html.escape(transfer_value)}</code>\n\n"
        )

    return (
        f"{html.escape(icon)} <b>{html.escape(name)}</b>\n"
        "━━━━━━━━━━━━━━━━\n\n"
        f"{account_block}"
        f"{amount_block}{limits_block}\n\n"
        "📌 <b>تعليمات التحويل:</b>\n"
        "• حوّل المبلغ كاملًا كما تم اختياره.\n"
        "• لا تكتب أي ملاحظة داخل التحويل.\n"
        "• بعد التحويل أرسل رقم العملية أو معرّف التحويل."
        f"{prompt}"
    )


async def _edit_screen(store: Any, data: dict[str, Any], *, waiting_for_amount: bool = False) -> bool:
    chat_id = int(data.get("shamcash_screen_chat_id") or 0)
    message_id = int(data.get("shamcash_screen_message_id") or 0)
    has_photo = bool(data.get("shamcash_screen_has_photo"))
    if not chat_id or not message_id:
        return False

    amount_selected = float(data.get("deposit_paid_amount") or 0) > 0
    caption = _caption(store, data, waiting_for_amount=waiting_for_amount)
    keyboard = _keyboard(store, data, amount_selected)
    try:
        if has_photo:
            await store.bot.edit_message_caption(
                chat_id=chat_id,
                message_id=message_id,
                caption=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
        else:
            await store.bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
        return True
    except Exception as exc:
        LOGGER.warning("Could not update Sham Cash payment screen: %s", exc)
        return False


async def _method_row(store: Any, method_id: int) -> tuple[Any, ...] | None:
    async with store.aiosqlite.connect(store.DB_PATH) as db:
        try:
            query = """
                SELECT id, name, details, icon, min_amount, max_amount, currency,
                       transfer_label, transfer_value, credit_rate, fixed_fee,
                       fee_percent, proof_required, proof_mode, payment_mode,
                       image_file_id, auto_provider, auto_config,
                       COALESCE(provider, '')
                FROM payment_methods
                WHERE id = ? AND is_active = 1
            """
            async with db.execute(query, (method_id,)) as cursor:
                return await cursor.fetchone()
        except Exception:
            query = """
                SELECT id, name, details, icon, min_amount, max_amount, currency,
                       transfer_label, transfer_value, credit_rate, fixed_fee,
                       fee_percent, proof_required, proof_mode, payment_mode,
                       image_file_id, auto_provider, auto_config
                FROM payment_methods
                WHERE id = ? AND is_active = 1
            """
            async with db.execute(query, (method_id,)) as cursor:
                row = await cursor.fetchone()
            return tuple(row) + ("",) if row else None


def install(store: Any) -> None:
    if getattr(store, "_shamcash_payment_ui_installed", False):
        return

    original_method: Callable[..., Awaitable[Any]] | None = None
    original_amount: Callable[..., Awaitable[Any]] | None = None
    for handler in getattr(store.dp.callback_query, "handlers", []):
        callback = getattr(handler, "callback", None)
        if getattr(callback, "__name__", "") == "process_deposit_method":
            original_method = callback
            break
    for handler in getattr(store.dp.message, "handlers", []):
        callback = getattr(handler, "callback", None)
        if getattr(callback, "__name__", "") == "process_deposit_amount":
            original_amount = callback
            break

    if original_method is None or original_amount is None:
        LOGGER.warning("Sham Cash UI patch skipped because deposit handlers were not found")
        return

    async def process_deposit_method(callback: CallbackQuery, state: Any) -> Any:
        try:
            method_id = int(str(callback.data or "").split("_")[2])
        except (IndexError, TypeError, ValueError):
            return await original_method(callback, state)

        method = await _method_row(store, method_id)
        if not method or not _is_shamcash(method[1], method[18] if len(method) > 18 else ""):
            return await original_method(callback, state)

        transfer_value = str(method[8] or "").strip()
        if not transfer_value:
            await callback.answer(
                "طريقة شام كاش غير مكتملة الإعداد حاليًا. تواصل مع الإدارة.",
                show_alert=True,
            )
            return None

        credit_rate = float(method[9] or 1)
        if credit_rate <= 0:
            credit_rate = 1.0
        await state.update_data(
            payment_method_id=int(method[0]),
            payment_method_name=str(method[1] or "شام كاش"),
            payment_method_details=str(method[2] or ""),
            payment_method_icon=str(method[3] or "🟣"),
            payment_method_min=float(method[4] or 0),
            payment_method_max=float(method[5] or 0),
            payment_method_currency=str(method[6] or "USD"),
            payment_transfer_label=str(method[7] or "رمز الحساب"),
            payment_transfer_value=transfer_value,
            payment_credit_rate=credit_rate,
            payment_fixed_fee=float(method[10] or 0),
            payment_fee_percent=float(method[11] or 0),
            payment_proof_required=True,
            payment_proof_mode="transaction",
            payment_mode=str(method[14] or "manual"),
            payment_method_image_file_id=str(method[15] or ""),
            payment_auto_provider=str(method[16] or ""),
            payment_auto_config=str(method[17] or "{}"),
            payment_provider=str(method[18] or ""),
            deposit_paid_amount=0,
            deposit_amount=0,
        )
        await state.set_state(store.DepositRequestStates.waiting_payment_method)
        data = await state.get_data()
        caption = _caption(store, data)
        keyboard = _keyboard(store, data, False)
        image_file_id = str(method[15] or "").strip()

        sent: Message | None = None
        if image_file_id:
            try:
                sent = await callback.message.answer_photo(
                    photo=image_file_id,
                    caption=caption,
                    parse_mode="HTML",
                    reply_markup=keyboard,
                )
            except Exception as exc:
                LOGGER.warning("Could not send Sham Cash QR image: %s", exc)
        if sent is None:
            sent = await callback.message.answer(
                caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )

        await state.update_data(
            shamcash_screen_chat_id=sent.chat.id,
            shamcash_screen_message_id=sent.message_id,
            shamcash_screen_has_photo=bool(image_file_id and sent.photo),
        )
        try:
            await callback.message.delete()
        except Exception:
            pass
        await callback.answer()
        return None

    async def process_deposit_amount(message: Message, state: Any) -> Any:
        data = await state.get_data()
        if not _is_shamcash(data.get("payment_method_name"), data.get("payment_provider")):
            return await original_amount(message, state)

        try:
            raw_amount = str(message.text or "").strip().replace(",", ".")
            paid_amount = float(raw_amount)
            if not math.isfinite(paid_amount) or paid_amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            await message.answer("❌ أرسل المبلغ كرقم أكبر من صفر، مثال: 10")
            return None

        global_min = float(await store.get_setting("min_balance_add", "1"))
        global_max = float(await store.get_setting("max_balance_add", "10000"))
        method_min = float(data.get("payment_method_min") or 0)
        method_max = float(data.get("payment_method_max") or 0)
        effective_min = max(global_min, method_min) if method_min > 0 else global_min
        effective_max = min(global_max, method_max) if method_max > 0 else global_max
        currency = str(data.get("payment_method_currency") or "USD")

        if paid_amount < effective_min or paid_amount > effective_max:
            await message.answer(
                f"❌ المبلغ المسموح لطريقة شام كاش بين "
                f"{_money(store, effective_min)} و {_money(store, effective_max)} {currency}."
            )
            return None

        credit_rate = max(float(data.get("payment_credit_rate") or 1), 0)
        fixed_fee = max(float(data.get("payment_fixed_fee") or 0), 0)
        fee_percent = min(max(float(data.get("payment_fee_percent") or 0), 0), 100)
        credited_amount = round(
            max((paid_amount * credit_rate) - fixed_fee - (paid_amount * fee_percent / 100), 0),
            2,
        )
        if credited_amount <= 0:
            await message.answer(
                "❌ قيمة الرصيد الناتجة صفر. تواصل مع الإدارة لمراجعة إعدادات الطريقة."
            )
            return None

        await state.update_data(
            deposit_paid_amount=round(paid_amount, 2),
            deposit_amount=credited_amount,
            payment_proof_mode="transaction",
        )
        await state.set_state(store.DepositRequestStates.waiting_proof)
        data = await state.get_data()
        updated = await _edit_screen(store, data)
        if not updated:
            await message.answer(
                _caption(store, data),
                parse_mode="HTML",
                reply_markup=_keyboard(store, data, True),
            )
        try:
            await message.delete()
        except Exception:
            pass
        return None

    _replace_registered_handler(
        store.dp.callback_query,
        "process_deposit_method",
        process_deposit_method,
    )
    _replace_registered_handler(
        store.dp.message,
        "process_deposit_amount",
        process_deposit_amount,
    )

    router = Router(name="shamcash_payment_ui")

    @router.callback_query(F.data == "shamcash_choose_amount")
    async def choose_amount(callback: CallbackQuery, state: Any) -> None:
        data = await state.get_data()
        if not _is_shamcash(data.get("payment_method_name"), data.get("payment_provider")):
            await callback.answer("انتهت جلسة الدفع. ابدأ العملية من جديد.", show_alert=True)
            return
        await state.update_data(
            shamcash_screen_chat_id=callback.message.chat.id,
            shamcash_screen_message_id=callback.message.message_id,
            shamcash_screen_has_photo=bool(callback.message.photo),
        )
        await state.set_state(store.DepositRequestStates.waiting_amount)
        data = await state.get_data()
        await _edit_screen(store, data, waiting_for_amount=True)
        await callback.answer("أرسل المبلغ الآن كرقم في المحادثة.", show_alert=True)

    @router.callback_query(F.data == "shamcash_send_proof")
    async def send_proof(callback: CallbackQuery, state: Any) -> None:
        data = await state.get_data()
        if not _is_shamcash(data.get("payment_method_name"), data.get("payment_provider")):
            await callback.answer("انتهت جلسة الدفع. ابدأ العملية من جديد.", show_alert=True)
            return
        paid_amount = float(data.get("deposit_paid_amount") or 0)
        if paid_amount <= 0:
            await callback.answer("اختر المبلغ أولًا ثم نفّذ التحويل.", show_alert=True)
            return
        await state.set_state(store.DepositRequestStates.waiting_proof)
        await callback.answer(
            "أرسل الآن رقم العملية أو معرّف التحويل في المحادثة.",
            show_alert=True,
        )

    store.dp.include_router(router)
    store._shamcash_payment_ui_installed = True
    LOGGER.info("One-screen Sham Cash payment UI installed")
