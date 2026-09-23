#!/usr/bin/env python3
"""One-page Arabic PDF for an individual licensed app customer's admin summary.

Only renders the strictly scoped owner-authenticated backend snapshot.
Never decrypts or reads customers' private Android debt records. No temp files.
"""
from __future__ import annotations

import io
import os
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


TZ = timezone(timedelta(hours=3))
FONT = os.getenv("UCHIHA_PDF_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
NAVY = colors.HexColor("#142437")
BLUE = colors.HexColor("#227ACF")
BORDER = colors.HexColor("#DCE5EF")
SOFT = colors.HexColor("#F3F7FB")
DIM = colors.HexColor("#61738B")
RED = colors.HexColor("#B35140")
GREEN = colors.HexColor("#217959")

_registered = False


def register_font() -> None:
    global _registered
    if _registered:
        return
    path = Path(FONT)
    if not path.is_file():
        raise RuntimeError("An Arabic-capable PDF font is not installed")
    pdfmetrics.registerFont(TTFont("DebtArabic", str(path)))
    _registered = True


def safe_text(value: Any, limit: int = 110) -> str:
    if value is None:
        return "—"
    raw = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value))
    raw = raw.strip()
    # The bundled DejaVu font covers Arabic and Latin, but not emoji.
    return "".join(c for c in raw if ord(c) <= 0xFFFF)[:limit] or "—"


def rtl(value: Any) -> str:
    return get_display(arabic_reshaper.reshape(safe_text(value, 170)), base_dir="R")


def date_text(value: Any) -> str:
    if not value:
        return "—"
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(TZ).strftime("%Y-%m-%d %H:%M")
    except (ValueError, OverflowError, TypeError):
        return "—"


def amount_text(value: Any) -> str:
    try:
        n = Decimal(str(value))
        if not n.is_finite():
            return "—"
        return f"{n:,.2f}"
    except (ValueError, InvalidOperation, TypeError):
        return "—"


def pdf_for_user(report: dict[str, Any], *, generated_at: datetime | None = None) -> bytes:
    """Render the bot owner's one-page report from validated RPC output."""
    if not isinstance(report, dict) or report.get("ok") is not True:
        raise ValueError("Backend has not authorized a user report")
    user = report.get("user")
    wallet = report.get("wallet")
    if not isinstance(user, dict) or not isinstance(wallet, dict):
        raise ValueError("Incomplete report snapshot")
    user_id = str(user.get("id") or "")
    if not re.fullmatch(r"[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", user_id):
        raise ValueError("Invalid report customer ID")
    register_font()
    document = io.BytesIO()
    c = canvas.Canvas(document, pagesize=A4, pageCompression=1)
    c.setTitle("UCHIHA - Customer Account Summary")
    c.setAuthor("UCHIHA Software")
    W, H = A4

    def rect(x: float, y: float, w: float, h: float,
             fill: colors.Color, stroke: colors.Color | None = None,
             radius: float = 12.0) -> None:
        c.setFillColor(fill)
        c.setStrokeColor(stroke or fill)
        c.roundRect(x, y, w, h, radius,
                    fill=1, stroke=1 if stroke else 0)

    def text_right(text: Any, x: float, y: float, size: float = 11,
                   color: colors.Color = NAVY, max_width: float = 455.0) -> None:
        raw = safe_text(text)
        c.setFont("DebtArabic", size)
        c.setFillColor(color)
        # Ellipsize before shaping; never draw outside the reserved column.
        while raw:
            # Pure ASCII dates, phone numbers and device ratios should remain
            # left-to-right even inside the right-aligned Arabic column.
            shaped = raw if raw.isascii() else rtl(raw)
            if pdfmetrics.stringWidth(shaped, "DebtArabic", size) <= max_width:
                c.drawRightString(x, y, shaped)
                return
            raw = raw[:-2] + "…" if len(raw) > 3 else raw[:-1]
        c.drawRightString(x, y, "—")

    def text_left(text: Any, x: float, y: float, size: float = 10,
                  color: colors.Color = NAVY) -> None:
        c.setFont("DebtArabic", size)
        c.setFillColor(color)
        c.drawString(x, y, safe_text(text))

    def row(label: str, value: Any, y: float, value_color=NAVY,
            colwidth: float = 222) -> None:
        text_right(label, 545, y, 10, DIM, 195)
        text_right(value, 328, y, 10.5, value_color, colwidth)

    now = generated_at or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    c.setFillColor(SOFT)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.rect(0, H - 116, W, 116, stroke=0, fill=1)
    c.setFillColor(BLUE)
    c.rect(0, H - 116, 8, 116, stroke=0, fill=1)
    text_right("شركة أوتشيها البرمجية", 548, H - 39, 18, colors.white)
    text_right("ملخص حساب مستخدم - تطبيق الديون", 548, H - 71, 11, colors.HexColor("#D7E9FB"))
    text_left("UCHIHA / CUSTOMER SUMMARY", 43, H - 97, 9,
              colors.HexColor("#B4CEE8"))

    name = safe_text(user.get("label") or "مستخدم", 100)
    rect(36, 505, W-72, 198, colors.white, BORDER)
    text_right("بيانات الحساب", 544, 675, 13, BLUE)
    text_right(name, 544, 644, 15, NAVY, 460)
    c.setStrokeColor(BORDER)
    c.line(50, 627, 545, 627)
    is_active = bool(user.get("active"))
    expires = user.get("expires_at")
    expired = False
    if expires:
        try:
            expiry = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                expiry=expiry.replace(tzinfo=timezone.utc)
            expired = expiry <= now.astimezone(expiry.tzinfo)
        except (ValueError, TypeError):
            pass
    current = "موقوف" if not is_active else "منتهي" if expired else "مفعّل"
    row("الهاتف", user.get("phone") or "غير مسجل", 604)
    row("حالة الاشتراك", current, 582, RED if not is_active or expired else GREEN)
    row("تاريخ الانتهاء", date_text(expires) if expires else "بلا انتهاء", 560)
    row("الأجهزة المفعّلة", f"{int(user.get('devices') or 0)} / {int(user.get('max_devices') or 1)}", 538)
    text_left("ID " + user_id[-13:].upper(), 50, 516, 8, DIM)

    rect(36, 424, W-72, 69, colors.white, BORDER)
    text_right("المحفظة الرقمية", 545, 466, 12, BLUE)
    text_right("الرصيد الحالي", 545, 440, 10, DIM)
    text_left(amount_text(wallet.get("balance")), 55, 438, 17, NAVY)
    c.setStrokeColor(BORDER)
    c.line(285, 440, 314, 440)

    backup = report.get("backup") or {}
    if not isinstance(backup, dict):
        backup = {}
    rect(36, 295, W-72, 117, colors.white, BORDER)
    text_right("آخر ملخص نسخة احتياطية", 545, 383, 12, BLUE)
    status = backup.get("status")
    if status == "available":
        text_right("تاريخ آخر نسخة: " + date_text(backup.get("created_at")),
                   544, 360, 9.5, DIM)
        text_right("المحل: " + safe_text(backup.get("shop"), 65),
                   544, 339, 10, NAVY)
        text_right(
            f"العملاء: {safe_text(backup.get('clients'))}   |   "
            f"التسجيلات: {safe_text(backup.get('entries'))}   |   "
            f"المنتجات: {safe_text(backup.get('products'))}",
            544, 315, 10, NAVY
        )
    elif status == "no_consent":
        text_right("لم يوافق المستخدم على مشاركة ملخص النسخة الاحتياطية.",
                   544, 345, 10, DIM)
        text_right("لن تظهر بيانات الديون الخاصة به في هذا التقرير.",
                   544, 320, 10, DIM)
    else:
        text_right("لا توجد نسخة احتياطية متاحة لهذا المستخدم.",
                   544, 340, 10, DIM)

    rect(36, 126, W-72, 157, colors.white, BORDER)
    text_right("آخر حركات المحفظة الرقمية", 545, 257, 12, BLUE)
    records = wallet.get("recent")
    if not isinstance(records, list):
        records = []
    displayed = records[:5]
    if not displayed:
        text_right("لا توجد حركات محفوظة في المحفظة الرقمية.", 544, 224, 10, DIM)
    else:
        y = 234
        for item in displayed:
            if not isinstance(item, dict):
                continue
            text_right(
                date_text(item.get("created_at"))[:10] + "  "
                + safe_text(item.get("kind"), 25),
                540, y, 9, DIM, 240
            )
            text_left(amount_text(item.get("amount")), 54, y-1, 10, NAVY)
            y -= 25

    c.setStrokeColor(BORDER)
    c.line(38, 105, W-38, 105)
    text_right(
        "هذا ملخص إداري للحساب، وليس كشف ديون العملاء أو مستندًا محاسبيًا مفصلًا.",
        543, 85, 9, DIM, 500
    )
    text_right("تاريخ الإصدار: " + now.astimezone(TZ).strftime("%Y-%m-%d %H:%M"),
               543, 60, 8.5, DIM)
    text_left("UCHIHA • PRIVATE ADMIN DOCUMENT", 38, 60, 8, DIM)
    c.showPage()
    c.save()
    result = document.getvalue()
    document.close()
    if not result.startswith(b"%PDF-") or not (3000 < len(result) < 1_000_000):
        raise RuntimeError("Invalid generated PDF")
    return result
