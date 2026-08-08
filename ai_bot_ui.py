"""Telegram interface for the UCHIHA AI sellable bot product."""

from __future__ import annotations

import html
import os
from typing import Any

from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    BufferedInputFile,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

import ai_bot_core as core


router = Router(name="uchiha-ai-product")


def _admin_id() -> int:
    raw = os.getenv("AI_ADMIN_ID", os.getenv("ADMIN_ID", "0")).strip()
    return int(raw) if raw.isdigit() else 0


def _is_admin(user_id: int) -> bool:
    return bool(_admin_id() and int(user_id) == _admin_id())


def _btn(
    text: str,
    *,
    callback_data: str | None = None,
    url: str | None = None,
    style: str | None = None,
) -> InlineKeyboardButton:
    kwargs: dict[str, Any] = {"text": text}
    if callback_data is not None:
        kwargs["callback_data"] = callback_data
    elif url is not None:
        kwargs["url"] = url
    else:
        raise ValueError("button requires callback_data or url")
    # Telegram Bot API 9.6 added primary/success/danger button styles. Keep a
    # compatibility fallback for older aiogram releases used by old deployments.
    fields = getattr(InlineKeyboardButton, "model_fields", {})
    if style and "style" in fields:
        kwargs["style"] = style
    return InlineKeyboardButton(**kwargs)


async def _edit(callback: CallbackQuery, text: str, keyboard: InlineKeyboardMarkup) -> None:
    if not callback.message:
        return
    try:
        await callback.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
    except Exception:
        await callback.message.answer(text, reply_markup=keyboard, parse_mode="HTML")


async def _send_long(message: Message, text: str) -> None:
    text = str(text or "")
    while text:
        chunk = text[:3900]
        if len(text) > 3900:
            split_at = max(chunk.rfind("\n"), chunk.rfind(" "))
            if split_at > 2500:
                chunk = text[:split_at]
        await message.answer(chunk)
        text = text[len(chunk):].lstrip()


async def _home_keyboard(user_id: int) -> InlineKeyboardMarkup:
    models = await core.list_models()
    pro = await core.is_pro(user_id)
    pro_label = await core.get_setting("pro_button_label", "⭐ PRO")
    rows: list[list[InlineKeyboardButton]] = [
        [_btn(f"🟡 {pro_label}", callback_data="ai:pro")]
    ]
    for model in models:
        if model.access_level == "free":
            label = f"🔵 {model.display_name} · مجاني"
            style = "primary"
        elif pro:
            label = f"⭐ {model.display_name} · PRO"
            style = "success"
        else:
            label = f"🔒 {model.display_name} · PRO"
            style = None
        rows.append([_btn(label, callback_data=f"ai:model:{model.id}", style=style)])
    rows.append([
        _btn("👤 حسابي", callback_data="ai:account"),
        _btn("🧹 محادثة جديدة", callback_data="ai:clear"),
    ])
    if _is_admin(user_id):
        rows.append([_btn("⚙️ لوحة الإدارة", callback_data="aiadm:home", style="primary")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _home_text(user_id: int) -> str:
    brand = html.escape(await core.get_setting("brand_name", "UCHIHA AI"))
    welcome = html.escape(await core.get_setting("welcome_text", "اختر نموذج الذكاء الاصطناعي."))
    pro = await core.is_pro(user_id)
    status = "⭐ <b>PRO مفعّل</b>" if pro else "🆓 الخطة المجانية"
    return (
        f"🤖 <b>{brand}</b>\n\n"
        f"{welcome}\n\n"
        f"حسابك: {status}\n"
        "اختر النموذج من الأزرار بالأسفل."
    )


def _model_text(model: core.AIModel, *, locked: bool) -> str:
    lock = "🔒 <b>يتطلب PRO</b>\n\n" if locked else "✅ <b>متاح لك الآن</b>\n\n"
    return (
        f"🤖 <b>{html.escape(model.display_name)}</b>\n\n"
        f"{lock}"
        f"🧠 مستوى الذكاء: <b>{html.escape(model.intelligence_label)}</b>\n"
        f"🔎 التحليل: <b>{html.escape(model.analysis_label)}</b>\n"
        f"🎨 إنشاء الصور: <b>{html.escape(model.image_quality_label)}</b>\n"
        f"💻 البرمجة: <b>{html.escape(model.coding_label)}</b>\n"
        f"📚 التعليم: <b>{html.escape(model.education_label)}</b>\n\n"
        + (
            "اشترك في PRO لفتح هذا النموذج وجميع قدراته."
            if locked
            else "اختر ما الذي تريد استخدام النموذج فيه:"
        )
    )


def _model_keyboard(model: core.AIModel, *, locked: bool) -> InlineKeyboardMarkup:
    if locked:
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [_btn("⭐ اشترك PRO", callback_data="ai:pro", style="success")],
                [_btn("↩️ رجوع", callback_data="ai:home")],
            ]
        )
    rows = [
        [
            _btn("💻 البرمجة", callback_data=f"ai:mode:{model.id}:coding", style="primary"),
            _btn("📚 التعليم والدراسة", callback_data=f"ai:mode:{model.id}:study"),
        ],
        [
            _btn("🎨 إنشاء صور", callback_data=f"ai:mode:{model.id}:image"),
            _btn("💬 محادثة عامة", callback_data=f"ai:mode:{model.id}:general"),
        ],
        [_btn("↩️ رجوع", callback_data="ai:home")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _pro_page(user_id: int) -> tuple[str, InlineKeyboardMarkup]:
    pro = await core.is_pro(user_id)
    models = [m for m in await core.list_models() if m.access_level == "pro"]
    names = "\n".join(f"• {html.escape(m.display_name)}" for m in models) or "• نماذج PRO"
    if pro:
        user = await core.get_user(user_id) or {}
        until = html.escape(str(user.get("pro_until") or ""))
        text = (
            "⭐ <b>اشتراك PRO مفعّل</b>\n\n"
            f"صالح حتى: <code>{until}</code> UTC\n\n"
            f"النماذج المفتوحة لك:\n{names}"
        )
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[_btn("↩️ الرئيسية", callback_data="ai:home")]])
        return text, keyboard

    subscribe_url = await core.get_setting("pro_subscribe_url", "")
    text = (
        "⭐ <b>UCHIHA AI PRO</b>\n\n"
        "افتح النماذج الأقوى والقدرات الاحترافية:\n\n"
        f"{names}\n\n"
        "🔥 ذكاء أعلى\n"
        "🧠 تحليل متقدم\n"
        "🎨 صور بجودة أعلى\n"
        "💻 برمجة أكثر قوة\n"
        "⚡ حدود وقدرات أعلى حسب إعدادات صاحب البوت"
    )
    rows: list[list[InlineKeyboardButton]] = []
    if subscribe_url.startswith(("https://", "http://", "tg://")):
        rows.append([_btn("💳 اشترك الآن", url=subscribe_url, style="success")])
    else:
        rows.append([_btn("💳 طريقة الاشتراك", callback_data="ai:subscribe_help", style="success")])
    rows.append([_btn("↩️ رجوع", callback_data="ai:home")])
    return text, InlineKeyboardMarkup(inline_keyboard=rows)


@router.message(CommandStart())
async def start_handler(message: Message) -> None:
    if not message.from_user:
        return
    user = await core.upsert_user(message.from_user.id, message.from_user.username or "", message.from_user.full_name)
    if int(user.get("is_banned") or 0):
        await message.answer("🚫 تم إيقاف حسابك عن استخدام هذا البوت.")
        return
    await message.answer(
        await _home_text(message.from_user.id),
        reply_markup=await _home_keyboard(message.from_user.id),
        parse_mode="HTML",
    )


@router.callback_query(F.data == "ai:home")
async def home_callback(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return
    await core.upsert_user(callback.from_user.id, callback.from_user.username or "", callback.from_user.full_name)
    await callback.answer()
    await _edit(callback, await _home_text(callback.from_user.id), await _home_keyboard(callback.from_user.id))


@router.callback_query(F.data.startswith("ai:model:"))
async def model_callback(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return
    try:
        model_id = int((callback.data or "").rsplit(":", 1)[1])
    except (ValueError, IndexError):
        await callback.answer("النموذج غير صالح.", show_alert=True)
        return
    model = await core.get_model(model_id)
    if not model:
        await callback.answer("هذا النموذج غير متاح حالياً.", show_alert=True)
        return
    locked = model.access_level == "pro" and not await core.is_pro(callback.from_user.id)
    if not locked:
        try:
            await core.set_active_model(callback.from_user.id, model.id)
        except core.AIProductError as exc:
            await callback.answer(exc.message, show_alert=True)
            return
    await callback.answer()
    await _edit(callback, _model_text(model, locked=locked), _model_keyboard(model, locked=locked))


@router.callback_query(F.data.startswith("ai:mode:"))
async def mode_callback(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return
    parts = (callback.data or "").split(":")
    if len(parts) != 4:
        return
    try:
        model_id = int(parts[2])
    except ValueError:
        await callback.answer("النموذج غير صالح.", show_alert=True)
        return
    mode = parts[3]
    try:
        model = await core.set_active_model(callback.from_user.id, model_id)
        await core.set_active_mode(callback.from_user.id, mode)
    except core.AIProductError as exc:
        await callback.answer(exc.message, show_alert=True)
        return
    label = core.MODE_LABELS.get(mode, "💬 محادثة عامة")
    text = (
        f"✅ تم اختيار <b>{html.escape(model.display_name)}</b>\n"
        f"الوضع: <b>{html.escape(label)}</b>\n\n"
        + (
            "🎨 أرسل الآن وصف الصورة التي تريد إنشاءها."
            if mode == "image"
            else "✍️ أرسل رسالتك الآن وسأجيبك مباشرة."
        )
    )
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [_btn("🔁 تغيير الاستخدام", callback_data=f"ai:model:{model.id}")],
            [_btn("🏠 الرئيسية", callback_data="ai:home")],
        ]
    )
    await callback.answer()
    await _edit(callback, text, keyboard)


@router.callback_query(F.data == "ai:pro")
async def pro_callback(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return
    text, keyboard = await _pro_page(callback.from_user.id)
    await callback.answer()
    await _edit(callback, text, keyboard)


@router.callback_query(F.data == "ai:subscribe_help")
async def subscribe_help(callback: CallbackQuery) -> None:
    await callback.answer("لم يحدد صاحب البوت رابط الدفع بعد. تواصل معه لتفعيل PRO.", show_alert=True)


@router.callback_query(F.data == "ai:clear")
async def clear_callback(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return
    await core.clear_history(callback.from_user.id)
    await callback.answer("تم بدء محادثة جديدة ✅", show_alert=False)
    await _edit(callback, await _home_text(callback.from_user.id), await _home_keyboard(callback.from_user.id))


@router.callback_query(F.data == "ai:account")
async def account_callback(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return
    user = await core.upsert_user(callback.from_user.id, callback.from_user.username or "", callback.from_user.full_name)
    usage = await core.usage_for_user(callback.from_user.id)
    pro = await core.is_pro(callback.from_user.id)
    model = await core.get_model(int(user.get("active_model_id") or 0))
    text = (
        "👤 <b>حسابي</b>\n\n"
        f"🆔 <code>{callback.from_user.id}</code>\n"
        f"⭐ الخطة: <b>{'PRO' if pro else 'مجاني'}</b>\n"
        f"🤖 النموذج الحالي: <b>{html.escape(model.display_name) if model else 'لم يتم الاختيار'}</b>\n"
        f"💬 الطلبات المنفذة: <b>{usage['requests']}</b>\n"
        f"🧠 Tokens داخلة: <b>{usage['input_tokens']}</b>\n"
        f"📝 Tokens خارجة: <b>{usage['output_tokens']}</b>"
    )
    await callback.answer()
    await _edit(
        callback,
        text,
        InlineKeyboardMarkup(inline_keyboard=[[_btn("↩️ رجوع", callback_data="ai:home")]]),
    )


# ---------------------------------------------------------------------------
# Admin panel
# ---------------------------------------------------------------------------


def _admin_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                _btn("📊 الإحصائيات", callback_data="aiadm:dashboard", style="primary"),
                _btn("🤖 النماذج", callback_data="aiadm:models"),
            ],
            [
                _btn("👥 المستخدمون", callback_data="aiadm:users"),
                _btn("⭐ اشتراكات PRO", callback_data="aiadm:pro"),
            ],
            [
                _btn("🧠 OpenAI", callback_data="aiadm:openai"),
                _btn("⚙️ إعدادات المنتج", callback_data="aiadm:settings"),
            ],
            [_btn("🏠 واجهة المستخدم", callback_data="ai:home")],
        ]
    )


async def _admin_guard(callback: CallbackQuery) -> bool:
    if not callback.from_user or not _is_admin(callback.from_user.id):
        await callback.answer("غير مصرح لك بدخول لوحة الإدارة.", show_alert=True)
        return False
    return True


@router.message(Command("admin"))
async def admin_command(message: Message) -> None:
    if not message.from_user or not _is_admin(message.from_user.id):
        return
    await message.answer(
        "⚙️ <b>لوحة إدارة UCHIHA AI</b>\n\nتحكم بالنماذج والمستخدمين وPRO وربط OpenAI من مكان واحد.",
        reply_markup=_admin_keyboard(),
        parse_mode="HTML",
    )


@router.callback_query(F.data == "aiadm:home")
async def admin_home(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    await callback.answer()
    await _edit(
        callback,
        "⚙️ <b>لوحة إدارة UCHIHA AI</b>\n\nاختر القسم الذي تريد إدارته:",
        _admin_keyboard(),
    )


@router.callback_query(F.data == "aiadm:dashboard")
async def admin_dashboard(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    data = await core.dashboard()
    text = (
        "📊 <b>إحصائيات UCHIHA AI</b>\n\n"
        f"👥 المستخدمون: <b>{data['users']}</b>\n"
        f"⭐ مشتركو PRO: <b>{data['pro_users']}</b>\n"
        f"🤖 النماذج المفعلة: <b>{data['models']}</b>\n"
        f"💬 طلبات اليوم: <b>{data['today_requests']}</b>\n"
        f"🧠 Input tokens: <b>{data['input_tokens']}</b>\n"
        f"📝 Output tokens: <b>{data['output_tokens']}</b>\n"
        f"🔑 OpenAI: <b>{'متصل ✅' if data['openai_configured'] else 'غير مربوط ❌'}</b>"
    )
    await callback.answer()
    await _edit(
        callback,
        text,
        InlineKeyboardMarkup(inline_keyboard=[
            [_btn("🔄 تحديث", callback_data="aiadm:dashboard")],
            [_btn("↩️ رجوع", callback_data="aiadm:home")],
        ]),
    )


@router.callback_query(F.data == "aiadm:models")
async def admin_models(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    models = await core.list_models(include_disabled=True)
    rows: list[list[InlineKeyboardButton]] = []
    for model in models:
        icon = "🟢" if model.enabled else "⚫"
        lock = "⭐" if model.access_level == "pro" else "🆓"
        rows.append([_btn(f"{icon} {lock} {model.display_name}", callback_data=f"aiadm:model:{model.id}")])
    rows.append([_btn("↩️ رجوع", callback_data="aiadm:home")])
    await callback.answer()
    await _edit(
        callback,
        "🤖 <b>إدارة النماذج</b>\n\nكل اسم تجاري يمكن ربطه بنموذج OpenAI مختلف. اختر نموذجاً:",
        InlineKeyboardMarkup(inline_keyboard=rows),
    )


@router.callback_query(F.data.startswith("aiadm:model:"))
async def admin_model_detail(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    try:
        model_id = int((callback.data or "").rsplit(":", 1)[1])
    except ValueError:
        return
    model = await core.get_model(model_id, include_disabled=True)
    if not model:
        await callback.answer("النموذج غير موجود.", show_alert=True)
        return
    text = (
        f"🤖 <b>{html.escape(model.display_name)}</b>\n\n"
        f"🆔 ID: <code>{model.id}</code>\n"
        f"🔌 OpenAI model: <code>{html.escape(model.provider_model)}</code>\n"
        f"⭐ الوصول: <b>{'PRO' if model.access_level == 'pro' else 'مجاني'}</b>\n"
        f"👁 الحالة: <b>{'مفعّل' if model.enabled else 'موقوف'}</b>\n"
        f"🧠 reasoning: <code>{html.escape(model.reasoning_effort)}</code>\n"
        f"🎨 image: <code>{html.escape(model.image_model)} / {html.escape(model.image_quality)}</code>\n\n"
        "لتغيير الاسم أو معرف OpenAI استخدم أوامر الإدارة الظاهرة في قسم الإعدادات."
    )
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                _btn(
                    "⏸ إيقاف" if model.enabled else "▶️ تفعيل",
                    callback_data=f"aiadm:model_toggle:{model.id}",
                    style="danger" if model.enabled else "success",
                ),
                _btn(
                    "اجعله مجاني" if model.access_level == "pro" else "اجعله PRO",
                    callback_data=f"aiadm:model_access:{model.id}",
                ),
            ],
            [_btn("↩️ النماذج", callback_data="aiadm:models")],
        ]
    )
    await callback.answer()
    await _edit(callback, text, keyboard)


@router.callback_query(F.data.startswith("aiadm:model_toggle:"))
async def admin_model_toggle(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    model_id = int((callback.data or "0").rsplit(":", 1)[1])
    model = await core.get_model(model_id, include_disabled=True)
    if model:
        await core.update_model(model.id, enabled=0 if model.enabled else 1)
    callback.data = f"aiadm:model:{model_id}"
    await admin_model_detail(callback)


@router.callback_query(F.data.startswith("aiadm:model_access:"))
async def admin_model_access(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    model_id = int((callback.data or "0").rsplit(":", 1)[1])
    model = await core.get_model(model_id, include_disabled=True)
    if model:
        await core.update_model(model.id, access_level="free" if model.access_level == "pro" else "pro")
    callback.data = f"aiadm:model:{model_id}"
    await admin_model_detail(callback)


@router.callback_query(F.data == "aiadm:users")
async def admin_users(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    users = await core.recent_users(12)
    rows: list[list[InlineKeyboardButton]] = []
    for user in users:
        uid = int(user["telegram_id"])
        pro = await core.is_pro(uid)
        label = user.get("full_name") or user.get("username") or str(uid)
        rows.append([_btn(f"{'⭐' if pro else '👤'} {str(label)[:24]}", callback_data=f"aiadm:user:{uid}")])
    rows.append([_btn("↩️ رجوع", callback_data="aiadm:home")])
    await callback.answer()
    await _edit(
        callback,
        "👥 <b>آخر المستخدمين نشاطاً</b>\n\nاختر مستخدماً لإدارة اشتراكه أو حظره:",
        InlineKeyboardMarkup(inline_keyboard=rows),
    )


@router.callback_query(F.data.startswith("aiadm:user:"))
async def admin_user_detail(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    uid = int((callback.data or "0").rsplit(":", 1)[1])
    user = await core.get_user(uid)
    if not user:
        await callback.answer("المستخدم غير موجود.", show_alert=True)
        return
    usage = await core.usage_for_user(uid)
    pro = await core.is_pro(uid)
    text = (
        "👤 <b>إدارة مستخدم</b>\n\n"
        f"🆔 <code>{uid}</code>\n"
        f"الاسم: <b>{html.escape(str(user.get('full_name') or '-'))}</b>\n"
        f"اليوزر: <code>@{html.escape(str(user.get('username') or '-'))}</code>\n"
        f"⭐ PRO: <b>{'نعم' if pro else 'لا'}</b>\n"
        f"📅 حتى: <code>{html.escape(str(user.get('pro_until') or '-'))}</code>\n"
        f"🚫 محظور: <b>{'نعم' if int(user.get('is_banned') or 0) else 'لا'}</b>\n"
        f"💬 الطلبات: <b>{usage['requests']}</b>"
    )
    banned = bool(int(user.get("is_banned") or 0))
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                _btn("⭐ PRO 30 يوم", callback_data=f"aiadm:grant:{uid}:30", style="success"),
                _btn("⭐ PRO سنة", callback_data=f"aiadm:grant:{uid}:365", style="success"),
            ],
            [_btn("إلغاء PRO", callback_data=f"aiadm:grant:{uid}:0")],
            [
                _btn(
                    "✅ فك الحظر" if banned else "🚫 حظر",
                    callback_data=f"aiadm:ban:{uid}:{0 if banned else 1}",
                    style="success" if banned else "danger",
                )
            ],
            [_btn("↩️ المستخدمون", callback_data="aiadm:users")],
        ]
    )
    await callback.answer()
    await _edit(callback, text, keyboard)


@router.callback_query(F.data.startswith("aiadm:grant:"))
async def admin_grant(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    _, _, uid_raw, days_raw = (callback.data or "").split(":")
    uid, days = int(uid_raw), int(days_raw)
    await core.set_pro(uid, days)
    callback.data = f"aiadm:user:{uid}"
    await admin_user_detail(callback)


@router.callback_query(F.data.startswith("aiadm:ban:"))
async def admin_ban(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    _, _, uid_raw, banned_raw = (callback.data or "").split(":")
    uid, banned = int(uid_raw), bool(int(banned_raw))
    await core.set_banned(uid, banned)
    callback.data = f"aiadm:user:{uid}"
    await admin_user_detail(callback)


@router.callback_query(F.data == "aiadm:pro")
async def admin_pro(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    data = await core.dashboard()
    subscribe_url = await core.get_setting("pro_subscribe_url", "")
    text = (
        "⭐ <b>إدارة PRO</b>\n\n"
        f"المشتركون حالياً: <b>{data['pro_users']}</b>\n"
        f"رابط الاشتراك: <code>{html.escape(subscribe_url or 'غير محدد')}</code>\n\n"
        "يمكن منح أو إلغاء PRO من قسم المستخدمين."
    )
    await callback.answer()
    await _edit(
        callback,
        text,
        InlineKeyboardMarkup(inline_keyboard=[
            [_btn("👥 إدارة المستخدمين", callback_data="aiadm:users")],
            [_btn("↩️ رجوع", callback_data="aiadm:home")],
        ]),
    )


@router.callback_query(F.data == "aiadm:openai")
async def admin_openai(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    data = await core.dashboard()
    text = (
        "🧠 <b>OpenAI</b>\n\n"
        f"🔑 الربط: <b>{'متصل ✅' if data['openai_configured'] else 'غير مربوط ❌'}</b>\n"
        f"🧠 Input tokens المسجلة: <b>{data['input_tokens']}</b>\n"
        f"📝 Output tokens المسجلة: <b>{data['output_tokens']}</b>\n\n"
        "مفتاح OpenAI لا يظهر داخل تيليجرام ولا يُحفظ في قاعدة البيانات.\n"
        "زر تجديد الرصيد يفتح صفحة الفوترة الرسمية للحساب المرتبط."
    )
    rows: list[list[InlineKeyboardButton]] = [
        [_btn("💳 تجديد رصيد OpenAI", url=str(data["billing_url"]), style="success")],
        [_btn("🔄 تحديث", callback_data="aiadm:openai")],
        [_btn("↩️ رجوع", callback_data="aiadm:home")],
    ]
    await callback.answer()
    await _edit(callback, text, InlineKeyboardMarkup(inline_keyboard=rows))


@router.callback_query(F.data == "aiadm:settings")
async def admin_settings(callback: CallbackQuery) -> None:
    if not await _admin_guard(callback):
        return
    text = (
        "⚙️ <b>إعدادات المنتج</b>\n\n"
        "الأوامر الإدارية الحالية:\n"
        "<code>/aiaddmodel الاسم | openai-model | pro</code>\n"
        "<code>/airename ID | الاسم الجديد</code>\n"
        "<code>/aiprovider ID | openai-model</code>\n"
        "<code>/aipro USER_ID DAYS</code>\n"
        "<code>/aiban USER_ID</code>\n"
        "<code>/aiunban USER_ID</code>\n\n"
        "الإعدادات الحساسة مثل OPENAI_API_KEY تبقى في Railway Variables فقط."
    )
    await callback.answer()
    await _edit(
        callback,
        text,
        InlineKeyboardMarkup(inline_keyboard=[[_btn("↩️ رجوع", callback_data="aiadm:home")]]),
    )


# ---------------------------------------------------------------------------
# Admin text commands for fields that need free-form input.
# ---------------------------------------------------------------------------


@router.message(Command("aiaddmodel"))
async def add_model_command(message: Message) -> None:
    if not message.from_user or not _is_admin(message.from_user.id):
        return
    raw = (message.text or "").partition(" ")[2]
    parts = [part.strip() for part in raw.split("|")]
    if len(parts) < 2:
        await message.answer("الاستخدام: /aiaddmodel الاسم | openai-model | pro")
        return
    access = parts[2].lower() if len(parts) > 2 else "pro"
    try:
        model = await core.create_model(display_name=parts[0], provider_model=parts[1], access_level=access)
    except core.AIProductError as exc:
        await message.answer(exc.message)
        return
    await message.answer(f"✅ تمت إضافة {model.display_name} برقم {model.id}.")


@router.message(Command("airename"))
async def rename_model_command(message: Message) -> None:
    if not message.from_user or not _is_admin(message.from_user.id):
        return
    raw = (message.text or "").partition(" ")[2]
    left, sep, right = raw.partition("|")
    if not sep or not left.strip().isdigit() or not right.strip():
        await message.answer("الاستخدام: /airename ID | الاسم الجديد")
        return
    model = await core.update_model(int(left.strip()), display_name=right.strip())
    await message.answer(f"✅ أصبح اسم النموذج: {model.display_name}")


@router.message(Command("aiprovider"))
async def provider_model_command(message: Message) -> None:
    if not message.from_user or not _is_admin(message.from_user.id):
        return
    raw = (message.text or "").partition(" ")[2]
    left, sep, right = raw.partition("|")
    if not sep or not left.strip().isdigit() or not right.strip():
        await message.answer("الاستخدام: /aiprovider ID | openai-model")
        return
    model = await core.update_model(int(left.strip()), provider_model=right.strip())
    await message.answer(f"✅ {model.display_name} أصبح مربوطاً بـ {model.provider_model}")


@router.message(Command("aipro"))
async def pro_command(message: Message) -> None:
    if not message.from_user or not _is_admin(message.from_user.id):
        return
    parts = (message.text or "").split()
    if len(parts) != 3 or not parts[1].isdigit() or not parts[2].isdigit():
        await message.answer("الاستخدام: /aipro USER_ID DAYS")
        return
    until = await core.set_pro(int(parts[1]), int(parts[2]))
    await message.answer(f"✅ تم تحديث PRO للمستخدم {parts[1]} حتى {until or 'ملغي'}.")


@router.message(Command("aiban"))
async def ban_command(message: Message) -> None:
    if not message.from_user or not _is_admin(message.from_user.id):
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("الاستخدام: /aiban USER_ID")
        return
    await core.set_banned(int(parts[1]), True)
    await message.answer("🚫 تم حظر المستخدم.")


@router.message(Command("aiunban"))
async def unban_command(message: Message) -> None:
    if not message.from_user or not _is_admin(message.from_user.id):
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("الاستخدام: /aiunban USER_ID")
        return
    await core.set_banned(int(parts[1]), False)
    await message.answer("✅ تم فك الحظر.")


@router.message(F.text)
async def prompt_handler(message: Message, bot: Bot) -> None:
    if not message.from_user or not message.text or message.text.startswith("/"):
        return
    user = await core.upsert_user(message.from_user.id, message.from_user.username or "", message.from_user.full_name)
    if int(user.get("is_banned") or 0):
        await message.answer("🚫 تم إيقاف حسابك عن استخدام هذا البوت.")
        return
    try:
        _, model, mode = await core.active_context(message.from_user.id)
        if mode == "image":
            await bot.send_chat_action(message.chat.id, "upload_photo")
            image, model = await core.generate_image(message.from_user.id, message.text)
            caption = f"🎨 تم الإنشاء بواسطة {model.display_name}"
            if isinstance(image, bytes):
                await message.answer_photo(BufferedInputFile(image, filename="uchiha-ai.png"), caption=caption)
            else:
                await message.answer_photo(image, caption=caption)
        else:
            await bot.send_chat_action(message.chat.id, "typing")
            answer, _ = await core.generate_text(message.from_user.id, message.text)
            await _send_long(message, answer)
    except core.AIProductError as exc:
        if exc.code == "pro_required":
            text, keyboard = await _pro_page(message.from_user.id)
            await message.answer(text, reply_markup=keyboard, parse_mode="HTML")
        else:
            await message.answer(f"⚠️ {exc.message}")


__all__ = ["router"]
