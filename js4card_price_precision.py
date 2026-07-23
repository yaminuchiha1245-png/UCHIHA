"""Preserve JS4Card sub-cent unit prices until the final quantity total.

JS4Card amount products can have unit prices below one cent. Rounding the unit
price to two decimals before multiplying by the selected quantity makes every
button and charged total incorrect. This module keeps eight decimal places for
unit prices and rounds the final customer total to the provider's three-decimal
wallet precision.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

LOGGER = logging.getLogger(__name__)
UNIT_QUANTUM = Decimal("0.00000001")
TOTAL_QUANTUM = Decimal("0.001")
PRECISION_VERSION = 3


def _decimal(value: Any, default: str = "0") -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def precise_unit(value: Any) -> float:
    return float(_decimal(value).quantize(UNIT_QUANTUM, rounding=ROUND_HALF_UP))


def precise_total(unit_price: Any, quantity: Any) -> float:
    qty = max(1, int(quantity or 1))
    total = _decimal(unit_price) * Decimal(qty)
    return float(total.quantize(TOTAL_QUANTUM, rounding=ROUND_HALF_UP))


def money_text(value: Any) -> str:
    number = _decimal(value).quantize(TOTAL_QUANTUM, rounding=ROUND_HALF_UP)
    text = f"{number:.3f}".rstrip("0").rstrip(".")
    if "." not in text:
        return text + ".00"
    fraction = len(text.rsplit(".", 1)[1])
    return text + ("0" if fraction == 1 else "")


def sale_unit_price(base_price: Any, margin: Any) -> float:
    base = _decimal(base_price)
    multiplier = Decimal("1") + (_decimal(margin) / Decimal("100"))
    return precise_unit(base * multiplier)


def _field_pairs(field: dict[str, Any]) -> list[dict[str, str]]:
    pairs = field.get("option_pairs") or []
    if pairs:
        return [
            {
                "label": str(item.get("label") or item.get("value") or ""),
                "value": str(item.get("value") or ""),
            }
            for item in pairs
            if isinstance(item, dict) and str(item.get("value") or "").strip()
        ]
    return [
        {"label": str(value), "value": str(value)}
        for value in field.get("options") or []
    ]


def _replace_registered_handler(router: Any, callback_name: str, replacement: Any) -> bool:
    replaced = False
    for handler in getattr(router, "handlers", []):
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


def patch_storefront_html(html: str) -> str:
    marker = "function initials(value)"
    if "function exactMoney(value)" not in html and marker in html:
        helper = (
            "function exactMoney(value){const n=Number(value||0);let s=n.toFixed(3)"
            ".replace(/0+$/,'').replace(/\\.$/,'');if(!s.includes('.'))s+='.00';"
            "else if(s.split('.')[1].length===1)s+='0';return s+' $'}\n  "
        )
        html = html.replace(marker, helper + marker, 1)

    old_option = "p.quantity_options.map(q=>`<option value=\"${q}\">${q}</option>`).join('')"
    new_option = (
        "p.quantity_options.map(q=>`<option value=\"${q}\">${q} — "
        "${exactMoney(Number(p.price||0)*Number(q))}</option>`).join('')"
    )
    if old_option in html:
        html = html.replace(old_option, new_option, 1)

    old_modal_price = '<span class="modal-price">${money(p.price)}</span>'
    new_modal_price = (
        '<span class="modal-price">${p.requires_quantity?exactMoney(p.price):money(p.price)}</span>'
    )
    if old_modal_price in html:
        html = html.replace(old_modal_price, new_modal_price, 1)
    return html


async def _effective_margin(store_app: Any, category_id: int) -> float:
    getter = getattr(store_app, "get_effective_profit_margin", None)
    if getter is not None:
        try:
            return float(await getter(category_id))
        except Exception:
            LOGGER.exception("Could not read category profit margin for %s", category_id)
    fallback = getattr(store_app, "get_default_profit_margin", None)
    if fallback is not None:
        try:
            return float(await fallback())
        except Exception:
            LOGGER.exception("Could not read default profit margin")
    return 0.0


async def _refresh_precise_price(
    store_app: Any,
    api_product_id: int,
    local_product_id: int,
    variant_id: int = 0,
) -> tuple[float, float]:
    """Return and persist precise sale/base unit prices for one API product."""
    if not local_product_id:
        return 0.0, 0.0
    async with store_app.aiosqlite.connect(store_app.DB_PATH) as db:
        async with db.execute(
            "SELECT category_id, price, COALESCE(api_params, '{}') "
            "FROM products WHERE id = ?",
            (local_product_id,),
        ) as cursor:
            row = await cursor.fetchone()
        variant_row = None
        if variant_id:
            async with db.execute(
                "SELECT price FROM product_variants WHERE id = ? AND product_id = ?",
                (variant_id, local_product_id),
            ) as cursor:
                variant_row = await cursor.fetchone()
    if not row:
        return 0.0, 0.0

    category_id = int(row[0] or 0)
    current_price = float((variant_row[0] if variant_row else row[1]) or 0)
    try:
        payload = json.loads(row[2] or "{}")
    except (TypeError, json.JSONDecodeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    base_price = precise_unit(payload.get("base_price", 0))
    needs_provider = variant_id or base_price <= 0
    fresh: dict[str, Any] | None = None
    if needs_provider and getattr(store_app, "API_TOKEN", ""):
        try:
            async with store_app.JS4CardAPI(
                api_token=store_app.API_TOKEN,
                connection_limit=1,
            ) as api:
                products = await asyncio.wait_for(
                    api.get_products([api_product_id]),
                    timeout=12,
                )
            candidate = products[0] if products else None
            if isinstance(candidate, dict):
                fresh = candidate
                base_price = precise_unit(candidate.get("price", 0))
        except Exception as exc:
            LOGGER.warning(
                "Could not refresh precise JS4Card price for product %s: %s",
                api_product_id,
                exc,
            )

    if base_price <= 0:
        return precise_unit(current_price), 0.0

    margin = await _effective_margin(store_app, category_id)
    customer_unit = sale_unit_price(base_price, margin)
    payload.update({
        "base_price": base_price,
        "sale_unit_price": customer_unit,
        "price_precision_version": PRECISION_VERSION,
    })
    if fresh:
        for source, target in (
            ("qty_values", "qty_values"),
            ("params", "params"),
            ("product_type", "product_type"),
        ):
            if source in fresh:
                payload[target] = fresh[source]

    async with store_app.aiosqlite.connect(store_app.DB_PATH) as db:
        if variant_id:
            await db.execute(
                "UPDATE product_variants SET price = ? WHERE id = ? AND product_id = ?",
                (customer_unit, variant_id, local_product_id),
            )
        else:
            await db.execute(
                "UPDATE products SET price = ?, api_params = ? WHERE id = ?",
                (customer_unit, json.dumps(payload, ensure_ascii=False), local_product_id),
            )
        await db.commit()
    return customer_unit, base_price


async def _reserve_api_order_precise(
    store_app: Any,
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
    quantity = max(1, int(quantity or 1))
    expected_unit_price = precise_unit(expected_unit_price)
    now = store_app._purchase_now()

    async with store_app.aiosqlite.connect(store_app.DB_PATH) as db:
        db.row_factory = store_app.aiosqlite.Row
        await db.execute("PRAGMA busy_timeout = 10000")
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute(
                "SELECT id, total_price, status, COALESCE(payment_state, 'unpaid') payment_state, "
                "COALESCE(api_status, '') api_status FROM orders WHERE purchase_token = ?",
                (purchase_token,),
            ) as cursor:
                existing = await cursor.fetchone()
            if existing:
                await db.rollback()
                return {"status": "duplicate", "order": dict(existing)}

            async with db.execute(
                "SELECT id, name, price, stock, is_active, api_id, api_provider "
                "FROM products WHERE id = ?",
                (local_product_id,),
            ) as cursor:
                product = await cursor.fetchone()
            if not product or int(product["is_active"] or 0) != 1 or int(product["stock"] or 0) <= 0:
                await db.rollback()
                return {"status": "unavailable"}

            if not variant_id:
                if int(product["api_id"] or 0) != api_product_id or str(product["api_provider"] or "") != "js4card":
                    await db.rollback()
                    return {"status": "unavailable"}
                current_price = precise_unit(product["price"] or 0)
            else:
                async with db.execute(
                    "SELECT price, stock, is_active, api_product_id, api_provider "
                    "FROM product_variants WHERE id = ? AND product_id = ?",
                    (variant_id, local_product_id),
                ) as cursor:
                    variant = await cursor.fetchone()
                if (
                    not variant
                    or int(variant["is_active"] or 0) != 1
                    or int(variant["stock"] or 0) <= 0
                    or int(variant["api_product_id"] or 0) != api_product_id
                    or str(variant["api_provider"] or "") != "js4card"
                ):
                    await db.rollback()
                    return {"status": "unavailable"}
                current_price = precise_unit(variant["price"] or 0)

            # The legacy confirmation passes a two-decimal expected unit price.
            # Accept it only when its cent-rounded value still matches the current
            # precise database price; the database remains the charging source.
            if round(current_price, 2) != round(expected_unit_price, 2):
                await db.rollback()
                return {"status": "price_changed", "current_price": current_price}

            total_price = precise_total(current_price, quantity)
            if total_price <= 0:
                await db.rollback()
                return {"status": "invalid_price"}

            changed_balance = await db.execute(
                "UPDATE users SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
                (total_price, user_id, total_price),
            )
            if changed_balance.rowcount != 1:
                await db.rollback()
                return {"status": "insufficient_balance", "total_price": total_price}

            base_unit_cost = precise_unit(request_payload.get("base_price", 0))
            provider_cost = precise_total(base_unit_cost, quantity) if base_unit_cost > 0 else 0.0
            gross_profit = float(
                (_decimal(total_price) - _decimal(provider_cost)).quantize(
                    TOTAL_QUANTUM,
                    rounding=ROUND_HALF_UP,
                )
            ) if provider_cost > 0 else 0.0
            cost_known = 1 if provider_cost > 0 else 0
            request_payload = dict(request_payload or {})
            request_payload["sale_unit_price"] = current_price
            request_payload["calculated_total"] = total_price

            cursor = await db.execute(
                "INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, status, "
                "order_date, delivery_info, api_provider, api_order_uuid, api_status, "
                "api_status_updated_at, api_monitor_active, purchase_token, payment_state, "
                "request_payload, purchase_flow, provider_cost, gross_profit, cost_known) "
                "VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, 'js4card', ?, 'queued', ?, 1, ?, "
                "'charged', ?, 'api', ?, ?, ?)",
                (
                    user_id,
                    local_product_id,
                    variant_id,
                    quantity,
                    total_price,
                    now,
                    delivery_info,
                    api_request_uuid,
                    now,
                    purchase_token,
                    store_app._safe_json(request_payload),
                    provider_cost,
                    gross_profit,
                    cost_known,
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
                "status": "created",
                "order_id": order_id,
                "total_price": total_price,
                "product_name": str(product["name"]),
            }
        except Exception:
            await db.rollback()
            raise


def _install_storefront_precision() -> None:
    import aiosqlite
    import storefront_api
    import storefront_core as core

    if getattr(core, "_js4card_price_precision_installed", False):
        return
    original_detail = core.product_detail

    async def product_detail(product_id: int) -> dict[str, Any]:
        detail = await original_detail(product_id)
        async with aiosqlite.connect(core.db_path()) as db:
            async with db.execute(
                "SELECT price, COALESCE(api_provider, '') FROM products WHERE id = ?",
                (product_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row and str(row[1] or "") == "js4card":
            detail["price"] = precise_unit(row[0] or 0)
            detail["quantity_totals"] = {
                str(quantity): precise_total(detail["price"], quantity)
                for quantity in detail.get("quantity_options") or []
            }
        return detail

    core.product_detail = product_detail
    storefront_api._STOREFRONT_HTML = patch_storefront_html(storefront_api._STOREFRONT_HTML)
    core._js4card_price_precision_installed = True


def _install_bot_precision(store_app: Any) -> None:
    if getattr(store_app, "_js4card_price_precision_installed", False):
        return
    from js4card_purchase_options import quantity_spec

    previous_prepare = store_app._prepare_api_product
    previous_start = store_app.start_api_purchase_flow

    def prepare_product(prod: dict[str, Any], db_category_id: int, margin: float):
        prepared = previous_prepare(prod, db_category_id, margin)
        if not prepared:
            return prepared
        base = precise_unit(prod.get("price", 0))
        customer_unit = sale_unit_price(base, margin)
        prepared["price"] = customer_unit
        try:
            payload = json.loads(prepared.get("api_params") or "{}")
        except (TypeError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        payload.update({
            "base_price": base,
            "sale_unit_price": customer_unit,
            "price_precision_version": PRECISION_VERSION,
        })
        prepared["api_params"] = json.dumps(payload, ensure_ascii=False)
        return prepared

    store_app._prepare_api_product = prepare_product

    async def show_confirmation(message: Any, state: Any, edit: bool = False):
        data = await state.get_data()
        product_id = int(data.get("api_product_id", 0) or 0)
        product_name = store_app.clean_api_text(data.get("api_product_name"), 250)
        price = precise_unit(data.get("api_product_price", 0))
        quantity = int(data.get("api_quantity", 1) or 1)
        total_price = precise_total(price, quantity)
        collected = data.get("api_collected_fields", {}) or {}
        visible = data.get("api_collected_display", {}) or {}
        fields = data.get("api_normalized_fields", []) or []
        purchase_token = str(data.get("api_purchase_token") or store_app.uuid.uuid4())
        request_uuid = str(data.get("api_request_uuid") or store_app.uuid.uuid4())
        await state.update_data(
            api_product_price=price,
            api_total_price=total_price,
            api_purchase_token=purchase_token,
            api_request_uuid=request_uuid,
        )
        await state.set_state(store_app.APIProductPurchaseStates.waiting_confirmation)
        labels = {str(field.get("key")): field.get("label") for field in fields}
        text = f"✅ **راجع طلبك قبل التأكيد**\n\nالمنتج: {product_name}\n"
        variant_name = store_app.clean_api_text(data.get("api_variant_name"), 120)
        if variant_name:
            text += f"الخيار: {variant_name}\n"
        if quantity != 1 or data.get("api_requires_quantity"):
            text += f"الكمية: {quantity}\n"
        for key, raw_value in collected.items():
            shown = visible.get(key, raw_value)
            text += (
                f"{store_app.clean_api_text(labels.get(str(key), key), 80)}: "
                f"{store_app.clean_api_text(shown, 300)}\n"
            )
        text += (
            f"الإجمالي: **{money_text(total_price)} $**\n\n"
            "لن يتم خصم الرصيد إلا مرة واحدة بعد التأكيد."
        )
        keyboard = store_app.InlineKeyboardMarkup(inline_keyboard=[[
            store_app.InlineKeyboardButton(
                text="✅ تأكيد الطلب",
                callback_data=f"api_confirm_buy_{product_id}",
            ),
            store_app.InlineKeyboardButton(text="❌ إلغاء", callback_data="main_menu"),
        ]])
        if edit:
            await store_app.safe_edit_message(message, text, keyboard)
        else:
            await message.answer(text, reply_markup=keyboard)

    async def prompt_next(message: Any, state: Any, edit: bool = False):
        data = await state.get_data()
        include_description = not bool(data.get("api_intro_shown"))
        if data.get("api_requires_quantity") and not data.get("api_quantity_collected"):
            options = [int(value) for value in data.get("api_quantity_options") or []]
            price = precise_unit(data.get("api_product_price", 0))
            if len(options) == 1:
                quantity = options[0]
                await state.update_data(
                    api_quantity=quantity,
                    api_quantity_collected=True,
                    api_total_price=precise_total(price, quantity),
                )
                return await prompt_next(message, state, edit=edit)
            await state.set_state(store_app.APIProductPurchaseStates.waiting_quantity)
            minimum = int(data.get("api_product_min_qty", 1))
            maximum = int(data.get("api_product_max_qty", minimum))
            text = store_app._api_intro(data, include_description)
            if options:
                text += "\n📦 **اختر الكمية المطلوبة من الأزرار**"
                rows: list[list[Any]] = []
                row: list[Any] = []
                for index, quantity in enumerate(options):
                    total = precise_total(price, quantity)
                    row.append(store_app.InlineKeyboardButton(
                        text=f"{quantity} • {money_text(total)} $",
                        callback_data=f"js4qty:{index}",
                    ))
                    if len(row) == 2:
                        rows.append(row)
                        row = []
                if row:
                    rows.append(row)
                rows.append([store_app.back_btn("main_menu", "❌ إلغاء")])
                keyboard = store_app.InlineKeyboardMarkup(inline_keyboard=rows)
            else:
                step = int(data.get("api_quantity_step", 1) or 1)
                text += (
                    "\n📦 **أرسل الكمية المطلوبة**\n"
                    f"سعر الوحدة: {money_text(price)} $\n"
                    f"الكمية المسموحة: من {minimum} إلى {maximum}"
                )
                if step > 1:
                    text += f" بزيادة {step} في كل مرة"
                keyboard = store_app.InlineKeyboardMarkup(
                    inline_keyboard=[[store_app.back_btn("main_menu", "❌ إلغاء")]]
                )
            await state.update_data(api_intro_shown=True, api_product_price=price)
            if edit:
                await store_app.safe_edit_message(message, text, keyboard)
            else:
                await message.answer(text, reply_markup=keyboard)
            return

        fields = data.get("api_normalized_fields", []) or []
        index = int(data.get("api_field_index", 0) or 0)
        if index < len(fields):
            field = fields[index]
            pairs = _field_pairs(field)
            await state.update_data(api_current_field=field, api_intro_shown=True)
            await state.set_state(store_app.APIProductPurchaseStates.waiting_dynamic_field)
            text = store_app._api_intro(data, include_description)
            if pairs:
                text += f"\n📝 **اختر {store_app.clean_api_text(field.get('label'), 120)}**"
                rows = [[store_app.InlineKeyboardButton(
                    text=store_app.clean_api_text(pair["label"], 55),
                    callback_data=f"js4opt:{index}:{option_index}",
                )] for option_index, pair in enumerate(pairs)]
                if not field.get("required", True):
                    rows.append([store_app.InlineKeyboardButton(
                        text="تجاوز هذا الحقل",
                        callback_data=f"js4opt:{index}:skip",
                    )])
                rows.append([store_app.back_btn("main_menu", "❌ إلغاء")])
                keyboard = store_app.InlineKeyboardMarkup(inline_keyboard=rows)
            else:
                text += f"\n📝 **أرسل {store_app.clean_api_text(field.get('label'), 120)}**"
                if not field.get("required", True):
                    text += "\n\nيمكنك إرسال /skip لتجاوز هذا الحقل."
                keyboard = store_app.InlineKeyboardMarkup(
                    inline_keyboard=[[store_app.back_btn("main_menu", "❌ إلغاء")]]
                )
            if edit:
                await store_app.safe_edit_message(message, text, keyboard)
            else:
                await message.answer(text, reply_markup=keyboard)
            return
        await show_confirmation(message, state, edit=edit)

    async def start_flow(
        callback: Any,
        state: Any,
        api_product_id: int,
        local_product_id: int = 0,
        **kwargs: Any,
    ):
        variant_id = int(kwargs.get("variant_id") or 0)
        customer_unit, base_price = await _refresh_precise_price(
            store_app,
            api_product_id,
            local_product_id,
            variant_id,
        )
        if variant_id and customer_unit > 0:
            kwargs["price_override"] = customer_unit
        await previous_start(
            callback,
            state,
            api_product_id,
            local_product_id,
            **kwargs,
        )
        data = await state.get_data()
        if int(data.get("api_product_id", 0) or 0) != int(api_product_id):
            return
        if customer_unit > 0:
            await state.update_data(
                api_product_price=customer_unit,
                api_product_base_price=base_price or data.get("api_product_base_price", 0),
            )
        await prompt_next(callback.message, state, edit=True)

    async def quantity_message(message: Any, state: Any):
        from js4card_purchase_options import validate_quantity
        data = await state.get_data()
        spec = {
            "options": data.get("api_quantity_options") or [],
            "min": data.get("api_product_min_qty", 1),
            "max": data.get("api_product_max_qty", 1),
            "step": data.get("api_quantity_step", 1),
        }
        try:
            quantity = validate_quantity(spec, (message.text or "").strip())
        except ValueError as exc:
            if str(exc) == "choice":
                await message.answer(
                    "❌ اختر إحدى الكميات المتاحة فقط: "
                    + "، ".join(map(str, spec["options"]))
                    + "."
                )
            else:
                suffix = f" بزيادة {spec['step']}." if int(spec["step"] or 1) > 1 else "."
                await message.answer(
                    f"❌ الكمية يجب أن تكون من {spec['min']} إلى {spec['max']}{suffix}"
                )
            return
        price = precise_unit(data.get("api_product_price", 0))
        await state.update_data(
            api_quantity=quantity,
            api_quantity_collected=True,
            api_total_price=precise_total(price, quantity),
        )
        await prompt_next(message, state)

    async def dynamic_message(message: Any, state: Any):
        data = await state.get_data()
        field = data.get("api_current_field") or {}
        value = store_app.clean_api_text(message.text, 500)
        if value.casefold() == "/skip" and not field.get("required", True):
            raw_value = visible_value = ""
        elif not value:
            await message.answer("❌ هذه المعلومة مطلوبة، أرسلها من فضلك.")
            return
        else:
            pairs = _field_pairs(field)
            matched = next((pair for pair in pairs if value.casefold() in {
                pair["label"].casefold(), pair["value"].casefold()
            }), None) if pairs else None
            if pairs and not matched:
                await message.answer("❌ اختر قيمة من الخيارات المعروضة.")
                return
            raw_value = matched["value"] if matched else value
            visible_value = matched["label"] if matched else value
        collected = dict(data.get("api_collected_fields", {}) or {})
        displayed = dict(data.get("api_collected_display", {}) or {})
        key = str(field.get("key") or "")
        if raw_value and key:
            collected[key] = raw_value
            displayed[key] = visible_value
        await state.update_data(
            api_collected_fields=collected,
            api_collected_display=displayed,
            api_field_index=int(data.get("api_field_index", 0) or 0) + 1,
            api_current_field=None,
        )
        await prompt_next(message, state)

    async def quantity_callback(callback: Any, state: Any):
        data = await state.get_data()
        if data.get("api_quantity_collected"):
            await callback.answer("تم اختيار الكمية مسبقًا.")
            return
        options = [int(value) for value in data.get("api_quantity_options") or []]
        try:
            quantity = options[int(str(callback.data).split(":", 1)[1])]
        except (ValueError, IndexError):
            await callback.answer("هذا الخيار لم يعد متاحًا.", show_alert=True)
            return
        price = precise_unit(data.get("api_product_price", 0))
        await state.update_data(
            api_quantity=quantity,
            api_quantity_collected=True,
            api_total_price=precise_total(price, quantity),
        )
        await prompt_next(callback.message, state, edit=True)
        await callback.answer(f"تم اختيار الكمية {quantity}")

    async def option_callback(callback: Any, state: Any):
        data = await state.get_data()
        field = data.get("api_current_field") or {}
        parts = str(callback.data).split(":", 2)
        try:
            expected_index = int(parts[1])
        except (ValueError, IndexError):
            await callback.answer("هذا الخيار لم يعد متاحًا.", show_alert=True)
            return
        if expected_index != int(data.get("api_field_index", 0) or 0):
            await callback.answer("تم استخدام هذا الخيار مسبقًا.", show_alert=True)
            return
        raw_index = parts[2] if len(parts) > 2 else ""
        if raw_index == "skip" and not field.get("required", True):
            raw_value = visible_value = ""
        else:
            pairs = _field_pairs(field)
            try:
                pair = pairs[int(raw_index)]
            except (ValueError, IndexError):
                await callback.answer("هذا الخيار لم يعد متاحًا.", show_alert=True)
                return
            raw_value, visible_value = pair["value"], pair["label"]
        collected = dict(data.get("api_collected_fields", {}) or {})
        displayed = dict(data.get("api_collected_display", {}) or {})
        key = str(field.get("key") or "")
        if raw_value and key:
            collected[key] = raw_value
            displayed[key] = visible_value
        await state.update_data(
            api_collected_fields=collected,
            api_collected_display=displayed,
            api_field_index=int(data.get("api_field_index", 0) or 0) + 1,
            api_current_field=None,
        )
        await prompt_next(callback.message, state, edit=True)
        await callback.answer("تم اختيار الخيار")

    store_app.show_api_confirmation = show_confirmation
    store_app.prompt_next_api_requirement = prompt_next
    store_app.start_api_purchase_flow = start_flow
    store_app.reserve_api_order_atomic = lambda **kwargs: _reserve_api_order_precise(
        store_app,
        **kwargs,
    )

    replacements = (
        (store_app.dp.message, "quantity_message", quantity_message),
        (store_app.dp.message, "process_api_quantity", quantity_message),
        (store_app.dp.message, "dynamic_message", dynamic_message),
        (store_app.dp.message, "process_api_dynamic_field", dynamic_message),
        (store_app.dp.callback_query, "quantity_callback", quantity_callback),
        (store_app.dp.callback_query, "option_callback", option_callback),
    )
    for router, name, handler in replacements:
        _replace_registered_handler(router, name, handler)

    store_app._js4card_price_precision_installed = True


def install(store_app: Any) -> None:
    _install_storefront_precision()
    _install_bot_precision(store_app)
    LOGGER.info("JS4Card sub-cent price precision installed")
