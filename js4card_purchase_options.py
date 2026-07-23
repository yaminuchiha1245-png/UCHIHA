"""Synchronize JS4Card quantity choices and parameter options across bot and web.

This module is installed by ``storefront_launcher.py``. It keeps the changes
outside the large legacy bot module while preserving the existing atomic order
flow.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Iterable

LOGGER = logging.getLogger(__name__)

_META_QUANTITY_KEYS = {
    "min", "minimum", "min_qty", "minqty",
    "max", "maximum", "max_qty", "maxqty",
    "step", "increment", "multiple", "default",
}
_NESTED_QUANTITY_KEYS = (
    "values", "options", "choices", "allowed", "quantities", "qty",
    "items", "list", "data",
)


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not number.is_integer() or number <= 0:
        return None
    return int(number)


def _first_positive(mapping: dict[str, Any], *keys: str) -> int | None:
    lowered = {str(key).casefold(): value for key, value in mapping.items()}
    for key in keys:
        value = _positive_int(lowered.get(key.casefold()))
        if value is not None:
            return value
    return None


def _dedupe_positive(values: Iterable[Any]) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()
    for value in values:
        parsed = _positive_int(value)
        if parsed is None or parsed in seen:
            continue
        seen.add(parsed)
        result.append(parsed)
    return result


def _quantity_values_from_object(value: Any) -> list[int]:
    """Extract explicit quantities from inconsistent provider response shapes."""
    if value is None:
        return []
    if isinstance(value, str):
        return _dedupe_positive(
            part for part in re.split(r"[\s,;|/]+", value.strip()) if part
        )
    if isinstance(value, (list, tuple, set)):
        collected: list[Any] = []
        for item in value:
            if isinstance(item, dict):
                candidate = None
                for key in ("qty", "quantity", "value", "amount", "id", "code"):
                    candidate = item.get(key)
                    if _positive_int(candidate) is not None:
                        break
                if candidate is not None:
                    collected.append(candidate)
                else:
                    collected.extend(_quantity_values_from_object(item))
            else:
                collected.append(item)
        return _dedupe_positive(collected)
    if isinstance(value, dict):
        for key in _NESTED_QUANTITY_KEYS:
            for actual_key, nested in value.items():
                if str(actual_key).casefold() == key and nested is not value:
                    extracted = _quantity_values_from_object(nested)
                    if extracted:
                        return extracted
        entries = [
            (key, item)
            for key, item in value.items()
            if str(key).casefold() not in _META_QUANTITY_KEYS
            and str(key).casefold() not in _NESTED_QUANTITY_KEYS
        ]
        if not entries:
            return []
        numeric_values = _dedupe_positive(item for _, item in entries)
        if numeric_values:
            return numeric_values
        numeric_keys = _dedupe_positive(key for key, _ in entries)
        if numeric_keys:
            return numeric_keys
        collected: list[int] = []
        for _, item in entries:
            collected.extend(_quantity_values_from_object(item))
        return _dedupe_positive(collected)
    parsed = _positive_int(value)
    return [parsed] if parsed is not None else []


def quantity_spec(qty_values: Any, product_type: Any = "package") -> dict[str, Any]:
    """Normalize provider quantity metadata into fixed, choices, or range mode."""
    mapping = qty_values if isinstance(qty_values, dict) else {}
    explicit = _quantity_values_from_object(qty_values)
    minimum = _first_positive(mapping, "min", "minimum", "min_qty", "minQty") or 1
    maximum = _first_positive(mapping, "max", "maximum", "max_qty", "maxQty") or minimum
    step = _first_positive(mapping, "step", "increment", "multiple") or 1
    if maximum < minimum:
        maximum = minimum
    if explicit:
        options = sorted(_dedupe_positive(explicit))
        return {
            "mode": "fixed" if len(options) == 1 else "choices",
            "options": options,
            "min": options[0],
            "max": options[-1],
            "step": 1,
        }
    count = ((maximum - minimum) // step) + 1 if step > 0 else 0
    if step > 1 and 1 < count <= 40:
        options = list(range(minimum, maximum + 1, step))
        return {
            "mode": "choices",
            "options": options,
            "min": options[0],
            "max": options[-1],
            "step": step,
        }
    variable = str(product_type or "").casefold() == "amount" or maximum > minimum
    return {
        "mode": "range" if variable else "fixed",
        "options": [],
        "min": minimum,
        "max": maximum,
        "step": step,
    }


def extract_quantity_metadata(product: Any) -> Any:
    if not isinstance(product, dict):
        return {}
    for key in (
        "qty_values", "quantity_values", "quantities", "quantity_options",
        "qty_options", "allowed_quantities",
    ):
        if key in product and product.get(key) not in (None, ""):
            return product.get(key)
    return {}


def extract_parameter_metadata(product: Any) -> Any:
    if not isinstance(product, dict):
        return []
    for key in ("params", "fields", "requirements", "inputs", "parameters"):
        if key in product and product.get(key) not in (None, ""):
            return product.get(key)
    return []


def normalize_option_pairs(options: Any) -> list[dict[str, str]]:
    """Preserve the visible label and the raw provider value."""
    pairs: list[dict[str, str]] = []

    def add(label: Any, raw: Any) -> None:
        raw_text = str(raw if raw is not None else "").strip()
        label_text = str(label if label is not None else raw_text).strip()
        if not raw_text:
            raw_text = label_text
        if not label_text:
            label_text = raw_text
        if not raw_text or any(item["value"] == raw_text for item in pairs):
            return
        pairs.append({"label": label_text[:120], "value": raw_text[:500]})

    if isinstance(options, dict):
        for raw, item in options.items():
            if isinstance(item, dict):
                value = item.get("value") or item.get("id") or item.get("code") or raw
                label = (
                    item.get("label") or item.get("name") or item.get("title")
                    or item.get("text") or value
                )
                add(label, value)
            else:
                add(item, raw)
    else:
        if not isinstance(options, (list, tuple, set)):
            options = [] if options in (None, "") else [options]
        for item in options:
            if isinstance(item, dict):
                value = (
                    item.get("value") or item.get("id") or item.get("code")
                    or item.get("key")
                )
                label = (
                    item.get("label") or item.get("name") or item.get("title")
                    or item.get("text") or value
                )
                add(label, value)
            else:
                add(item, item)
    return pairs


def normalize_api_fields(
    params: Any,
    clean_text=lambda value, limit=120: str(value or "").strip()[:limit],
) -> list[dict[str, Any]]:
    """Normalize fields while retaining option IDs required by the provider."""
    if not params:
        return []
    if isinstance(params, dict):
        wrapped = params.get("params") or params.get("fields") or params.get("requirements")
        if wrapped is not None:
            params = wrapped
        else:
            params = [
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
            key = item.strip()
            label = key
            required = True
            options: Any = []
        elif isinstance(item, dict):
            key = str(
                item.get("name") or item.get("key") or item.get("param")
                or item.get("field") or item.get("code") or item.get("id") or ""
            ).strip()
            label = str(
                item.get("label") or item.get("title") or item.get("display_name")
                or item.get("placeholder") or item.get("description") or key
            ).strip()
            required_value = item.get("required", True)
            required = required_value not in (
                False, 0, "0", "false", "False", "optional",
            )
            options = item.get("options") or item.get("values") or item.get("choices") or []
        else:
            continue
        normalized = re.sub(r"[^a-z0-9]", "", key.casefold())
        if not key or normalized in ignored or normalized in seen:
            continue
        seen.add(normalized)
        pairs = normalize_option_pairs(options)
        fields.append({
            "key": key,
            "label": clean_text(label, 120) or key,
            "required": bool(required),
            "options": [clean_text(pair["label"], 120) for pair in pairs],
            "option_pairs": [
                {"label": clean_text(pair["label"], 120), "value": pair["value"]}
                for pair in pairs
            ],
        })
    return fields


def validate_quantity(spec: dict[str, Any], value: Any) -> int:
    quantity = _positive_int(value)
    if quantity is None:
        raise ValueError("invalid")
    options = [int(item) for item in spec.get("options") or []]
    if options and quantity not in options:
        raise ValueError("choice")
    minimum = int(spec.get("min") or 1)
    maximum = int(spec.get("max") or minimum)
    step = max(1, int(spec.get("step") or 1))
    if quantity < minimum or quantity > maximum:
        raise ValueError("range")
    if not options and step > 1 and (quantity - minimum) % step:
        raise ValueError("step")
    return quantity


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


def patch_storefront_html(html: str) -> str:
    """Replace the free-number input with a provider-synchronized selector."""
    old = """${p.requires_quantity?`<div class="field"><label>العدد (${p.min_qty} - ${p.max_qty})</label><input class="input" id="productQty" type="number" inputmode="numeric" min="${p.min_qty}" max="${p.max_qty}" value="${p.min_qty}"></div>`:''}"""
    new = """${p.requires_quantity?`<div class="field"><label>${p.quantity_options?.length?'اختر الكمية':'العدد ('+p.min_qty+' - '+p.max_qty+')'}</label>${p.quantity_options?.length?`<select class="select" id="productQty">${p.quantity_options.map(q=>`<option value="${q}">${q}</option>`).join('')}</select>`:`<input class="input" id="productQty" type="number" inputmode="numeric" min="${p.min_qty}" max="${p.max_qty}" step="${p.quantity_step||1}" value="${p.min_qty}">`}</div>`:''}"""
    if old not in html:
        raise RuntimeError("تعذر العثور على قالب كمية المنتج داخل واجهة المتجر")
    return html.replace(old, new, 1)


async def _read_product_payload(
    store_app: Any,
    local_product_id: int,
    api_product_id: int,
    variant_id: int,
) -> tuple[dict[str, Any], float]:
    payload: dict[str, Any] = {}
    price = 0.0
    if local_product_id:
        async with store_app.aiosqlite.connect(store_app.DB_PATH) as db:
            async with db.execute(
                "SELECT price, COALESCE(api_params, '{}') FROM products WHERE id = ?",
                (local_product_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row:
            price = float(row[0] or 0)
            try:
                payload = json.loads(row[1] or "{}")
            except (TypeError, json.JSONDecodeError):
                payload = {}
    if not isinstance(payload, dict):
        payload = {}
    should_refresh = (
        bool(variant_id)
        or int(payload.get("purchase_options_version", 0) or 0) < 2
    )
    if should_refresh and getattr(store_app, "API_TOKEN", ""):
        try:
            async with store_app.JS4CardAPI(
                api_token=store_app.API_TOKEN,
                connection_limit=1,
            ) as api:
                products = await asyncio.wait_for(
                    api.get_products([api_product_id]),
                    timeout=10,
                )
            fresh = products[0] if products else None
            if isinstance(fresh, dict):
                payload = {
                    **payload,
                    "qty_values": extract_quantity_metadata(fresh),
                    "params": extract_parameter_metadata(fresh),
                    "product_type": fresh.get(
                        "product_type",
                        payload.get("product_type", "package"),
                    ),
                    "purchase_options_version": 2,
                }
                if local_product_id and not variant_id:
                    async with store_app.aiosqlite.connect(store_app.DB_PATH) as db:
                        await db.execute(
                            "UPDATE products SET api_params = ? WHERE id = ?",
                            (json.dumps(payload, ensure_ascii=False), local_product_id),
                        )
                        await db.commit()
        except Exception as exc:
            LOGGER.warning(
                "Could not refresh JS4Card purchase metadata for %s: %s",
                api_product_id,
                exc,
            )
    return payload, price


def _replace_registered_handler(router: Any, old_name: str, replacement: Any) -> bool:
    for handler in getattr(router, "handlers", []):
        callback = getattr(handler, "callback", None)
        if getattr(callback, "__name__", "") != old_name:
            continue
        try:
            handler.callback = replacement
        except Exception:
            try:
                object.__setattr__(handler, "callback", replacement)
            except Exception:
                continue
        return True
    return False


def _install_bot(store_app: Any) -> None:
    if getattr(store_app, "_js4card_purchase_options_installed", False):
        return
    original_start = store_app.start_api_purchase_flow
    original_confirmation = store_app.show_api_confirmation
    original_prepare = store_app._prepare_api_product
    store_app.normalize_api_fields = lambda params: normalize_api_fields(
        params,
        store_app.clean_api_text,
    )

    def prepare_product(prod: dict[str, Any], db_category_id: int, margin: float):
        prepared = original_prepare(prod, db_category_id, margin)
        if not prepared:
            return prepared
        try:
            payload = json.loads(prepared.get("api_params") or "{}")
        except (TypeError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        payload.update({
            "params": extract_parameter_metadata(prod),
            "qty_values": extract_quantity_metadata(prod),
            "product_type": prod.get(
                "product_type",
                payload.get("product_type", "package"),
            ),
            "purchase_options_version": 2,
        })
        prepared["api_params"] = json.dumps(payload, ensure_ascii=False)
        return prepared

    store_app._prepare_api_product = prepare_product

    async def show_confirmation(message: Any, state: Any, edit: bool = False):
        data = await state.get_data()
        raw = dict(data.get("api_collected_fields", {}) or {})
        visible = dict(data.get("api_collected_display", {}) or {})
        if visible:
            await state.update_data(api_collected_fields={**raw, **visible})
        try:
            await original_confirmation(message, state, edit=edit)
        finally:
            if visible:
                await state.update_data(api_collected_fields=raw)

    store_app.show_api_confirmation = show_confirmation

    async def prompt_next(message: Any, state: Any, edit: bool = False):
        data = await state.get_data()
        include_description = not bool(data.get("api_intro_shown"))
        if data.get("api_requires_quantity") and not data.get("api_quantity_collected"):
            options = [int(value) for value in data.get("api_quantity_options") or []]
            if len(options) == 1:
                quantity = options[0]
                price = float(data.get("api_product_price", 0) or 0)
                await state.update_data(
                    api_quantity=quantity,
                    api_quantity_collected=True,
                    api_total_price=round(price * quantity, 2),
                )
                return await prompt_next(message, state, edit=edit)
            await state.set_state(store_app.APIProductPurchaseStates.waiting_quantity)
            minimum = int(data.get("api_product_min_qty", 1))
            maximum = int(data.get("api_product_max_qty", minimum))
            text = store_app._api_intro(data, include_description)
            price = float(data.get("api_product_price", 0) or 0)
            if options:
                text += "\n📦 **اختر الكمية المطلوبة من الأزرار**"
                rows: list[list[Any]] = []
                row: list[Any] = []
                for index, quantity in enumerate(options):
                    row.append(store_app.InlineKeyboardButton(
                        text=f"{quantity} • {price * quantity:.2f} $",
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
                    f"السعر للوحدة: {price:.2f} $\n"
                    f"الكمية المسموحة: من {minimum} إلى {maximum}"
                )
                if step > 1:
                    text += f" بزيادة {step} في كل مرة"
                keyboard = store_app.InlineKeyboardMarkup(
                    inline_keyboard=[[store_app.back_btn("main_menu", "❌ إلغاء")]]
                )
            await state.update_data(api_intro_shown=True)
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
            await state.set_state(
                store_app.APIProductPurchaseStates.waiting_dynamic_field
            )
            text = store_app._api_intro(data, include_description)
            if pairs:
                text += (
                    f"\n📝 **اختر "
                    f"{store_app.clean_api_text(field.get('label'), 120)}**"
                )
                rows = [
                    [store_app.InlineKeyboardButton(
                        text=store_app.clean_api_text(pair["label"], 55),
                        callback_data=f"js4opt:{index}:{option_index}",
                    )]
                    for option_index, pair in enumerate(pairs)
                ]
                if not field.get("required", True):
                    rows.append([store_app.InlineKeyboardButton(
                        text="تجاوز هذا الحقل",
                        callback_data=f"js4opt:{index}:skip",
                    )])
                rows.append([store_app.back_btn("main_menu", "❌ إلغاء")])
                keyboard = store_app.InlineKeyboardMarkup(inline_keyboard=rows)
            else:
                text += (
                    f"\n📝 **أرسل "
                    f"{store_app.clean_api_text(field.get('label'), 120)}**"
                )
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

    store_app.prompt_next_api_requirement = prompt_next

    async def start_flow(
        callback: Any,
        state: Any,
        api_product_id: int,
        local_product_id: int = 0,
        **kwargs: Any,
    ):
        variant_id = int(kwargs.get("variant_id") or 0)
        payload, local_price = await _read_product_payload(
            store_app,
            local_product_id,
            api_product_id,
            variant_id,
        )
        spec = quantity_spec(
            payload.get("qty_values") or {},
            payload.get("product_type") or "package",
        )
        override = kwargs.get("price_override")
        price = float(override if override is not None else local_price or 0)
        minimum_total = price * int(spec.get("min") or 1)
        balance = await store_app.get_user_balance(callback.from_user.id)
        if minimum_total > 0 and balance < minimum_total:
            await callback.answer(
                f"رصيدك غير كافٍ. الحد الأدنى المطلوب: {minimum_total:.2f} $",
                show_alert=True,
            )
            await state.clear()
            return
        await original_start(
            callback,
            state,
            api_product_id,
            local_product_id,
            **kwargs,
        )
        data = await state.get_data()
        if int(data.get("api_product_id", 0) or 0) != int(api_product_id):
            return
        options = [int(value) for value in spec.get("options") or []]
        requires = bool(options and len(options) > 1) or spec.get("mode") == "range"
        fixed = options[0] if len(options) == 1 else int(spec.get("min") or 1)
        await state.update_data(
            api_product_min_qty=int(spec.get("min") or 1),
            api_product_max_qty=int(spec.get("max") or spec.get("min") or 1),
            api_quantity_step=int(spec.get("step") or 1),
            api_quantity_options=options,
            api_requires_quantity=requires,
            api_quantity=fixed,
            api_quantity_collected=not requires,
            api_field_index=0,
            api_current_field=None,
        )
        await prompt_next(callback.message, state, edit=True)

    store_app.start_api_purchase_flow = start_flow

    async def quantity_message(message: Any, state: Any):
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
                allowed = "، ".join(map(str, spec["options"]))
                await message.answer(
                    f"❌ اختر إحدى الكميات المتاحة فقط: {allowed}."
                )
            else:
                suffix = (
                    f" بزيادة {spec['step']}."
                    if int(spec["step"] or 1) > 1 else "."
                )
                await message.answer(
                    f"❌ الكمية يجب أن تكون من {spec['min']} "
                    f"إلى {spec['max']}{suffix}"
                )
            return
        price = float(data.get("api_product_price", 0) or 0)
        await state.update_data(
            api_quantity=quantity,
            api_quantity_collected=True,
            api_total_price=round(price * quantity, 2),
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
            match = next((
                pair for pair in pairs
                if value.casefold() in {
                    pair["label"].casefold(),
                    pair["value"].casefold(),
                }
            ), None) if pairs else None
            if pairs and not match:
                await message.answer("❌ اختر قيمة من الخيارات المعروضة.")
                return
            raw_value = match["value"] if match else value
            visible_value = match["label"] if match else value
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
            index = int(str(callback.data).split(":", 1)[1])
            quantity = options[index]
        except (ValueError, IndexError):
            await callback.answer("هذا الخيار لم يعد متاحًا.", show_alert=True)
            return
        price = float(data.get("api_product_price", 0) or 0)
        await state.update_data(
            api_quantity=quantity,
            api_quantity_collected=True,
            api_total_price=round(price * quantity, 2),
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

    store_app.dp.callback_query.register(
        quantity_callback,
        store_app.F.data.startswith("js4qty:"),
    )
    store_app.dp.callback_query.register(
        option_callback,
        store_app.F.data.startswith("js4opt:"),
    )
    if not _replace_registered_handler(
        store_app.dp.message,
        "process_api_quantity",
        quantity_message,
    ):
        LOGGER.warning("JS4Card quantity message handler was not found")
    if not _replace_registered_handler(
        store_app.dp.message,
        "process_api_dynamic_field",
        dynamic_message,
    ):
        LOGGER.warning("JS4Card dynamic field handler was not found")
    store_app._js4card_purchase_options_installed = True


def _install_storefront() -> None:
    import aiosqlite
    import storefront_api
    import storefront_core as core

    if getattr(core, "_js4card_purchase_options_installed", False):
        return
    original_detail = core.product_detail
    core.normalize_api_fields = lambda params: normalize_api_fields(
        params,
        core.clean_text,
    )

    async def product_detail(product_id: int) -> dict[str, Any]:
        detail = await original_detail(product_id)
        async with aiosqlite.connect(core.db_path()) as db:
            async with db.execute(
                "SELECT COALESCE(api_params, '{}'), "
                "COALESCE(product_type, 'stock') FROM products WHERE id = ?",
                (product_id,),
            ) as cursor:
                row = await cursor.fetchone()
        payload: dict[str, Any] = {}
        if row:
            try:
                payload = json.loads(row[0] or "{}")
            except (TypeError, json.JSONDecodeError):
                payload = {}
        if not isinstance(payload, dict):
            payload = {}
        product_type = payload.get("product_type") or (row[1] if row else "stock")
        spec = quantity_spec(extract_quantity_metadata(payload), product_type)
        detail.update({
            "min_qty": int(spec["min"]),
            "max_qty": int(spec["max"]),
            "quantity_step": int(spec["step"]),
            "quantity_options": [int(value) for value in spec["options"]],
            "requires_quantity": spec["mode"] in {"choices", "range"},
        })
        return detail

    def validate_purchase(
        detail: dict[str, Any],
        payload: dict[str, Any],
    ) -> tuple[int, dict[str, str], int]:
        spec = {
            "options": detail.get("quantity_options") or [],
            "min": detail.get("min_qty", 1),
            "max": detail.get("max_qty", 1),
            "step": detail.get("quantity_step", 1),
        }
        try:
            quantity = validate_quantity(
                spec,
                payload.get("quantity") or detail.get("min_qty") or 1,
            )
        except ValueError as exc:
            if str(exc) == "choice":
                allowed = "، ".join(map(str, spec["options"]))
                raise core.StorefrontError(
                    "invalid_quantity",
                    f"اختر إحدى الكميات المتاحة فقط: {allowed}.",
                ) from exc
            raise core.StorefrontError(
                "invalid_quantity",
                f"الكمية يجب أن تكون من {spec['min']} إلى {spec['max']}.",
            ) from exc
        raw_fields = payload.get("fields") or {}
        if not isinstance(raw_fields, dict):
            raise core.StorefrontError(
                "invalid_fields",
                "بيانات الطلب غير صحيحة.",
            )
        accepted: dict[str, str] = {}
        for field in detail.get("fields") or []:
            value = core.clean_text(raw_fields.get(field["key"]), 500)
            if field.get("required") and not value:
                raise core.StorefrontError(
                    "missing_field",
                    f"الحقل «{field['label']}» مطلوب.",
                )
            pairs = _field_pairs(field)
            if value and pairs:
                matched = next((
                    pair for pair in pairs
                    if value in {pair["label"], pair["value"]}
                ), None)
                if not matched:
                    raise core.StorefrontError(
                        "invalid_option",
                        f"اختر قيمة صحيحة للحقل «{field['label']}».",
                    )
                value = matched["value"]
            if value:
                accepted[str(field["key"])] = value
        try:
            variant_id = int(payload.get("variant_id") or 0)
        except (TypeError, ValueError):
            variant_id = 0
        return quantity, accepted, variant_id

    core.product_detail = product_detail
    core._validate_purchase = validate_purchase
    storefront_api._STOREFRONT_HTML = patch_storefront_html(
        storefront_api._STOREFRONT_HTML
    )
    core._js4card_purchase_options_installed = True


def install(store_app: Any) -> None:
    """Install synchronized JS4Card choices into the bot and storefront."""
    _install_storefront()
    _install_bot(store_app)
    LOGGER.info("JS4Card quantity and option synchronization installed")
