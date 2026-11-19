"""Core services for the sellable UCHIHA AI Telegram bot product.

This module is intentionally independent from the existing UCHIHA Store bot.  A
customer bot can run with its own ``AI_BOT_TOKEN`` while the owner keeps the
OpenAI key server-side.  Commercial model names (UCHIHA AI V1/V2/...) are stored
in SQLite and may be mapped to any supported OpenAI model from the admin side.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp
import aiosqlite


OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1").strip().rstrip("/")
OPENAI_BILLING_URL = os.getenv(
    "OPENAI_BILLING_URL",
    "https://platform.openai.com/settings/organization/billing/overview",
).strip()


class AIProductError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(slots=True)
class AIModel:
    id: int
    slug: str
    display_name: str
    provider_model: str
    access_level: str
    button_style: str
    sort_order: int
    enabled: bool
    intelligence_label: str
    analysis_label: str
    image_quality_label: str
    coding_label: str
    education_label: str
    max_output_tokens: int
    reasoning_effort: str
    image_enabled: bool
    image_model: str
    image_quality: str
    system_prompt: str


MODE_LABELS = {
    "general": "💬 محادثة عامة",
    "coding": "💻 البرمجة",
    "study": "📚 التعليم والدراسة",
    "image": "🎨 إنشاء صور",
}

MODE_INSTRUCTIONS = {
    "general": "أجب كمساعد عام واضح ودقيق. نظّم الإجابة بالعربية ما لم يطلب المستخدم لغة أخرى.",
    "coding": (
        "أنت مساعد برمجي. افهم هدف المستخدم أولاً، ثم قدم حلاً عملياً وآمناً. "
        "عند تقديم كود اجعله قابلاً للتشغيل واشرح فقط ما يلزم. لا تدّع تنفيذ أدوات لم تُنفذ فعلاً."
    ),
    "study": (
        "أنت مدرس صبور وعملي. اشرح الفكرة خطوة بخطوة بمستوى يناسب سؤال المستخدم، "
        "واستخدم أمثلة قصيرة ثم اختبر الفهم عند الحاجة."
    ),
}


def db_path() -> Path:
    raw = os.getenv("AI_DB_PATH", "uchiha_ai.db").strip() or "uchiha_ai.db"
    return Path(raw).expanduser().resolve()


def now_text() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _future_text(days: int) -> str:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def _parse_utc(value: str) -> dt.datetime | None:
    try:
        return dt.datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc)
    except (TypeError, ValueError):
        return None


async def ensure_schema() -> None:
    """Create the AI product database and seed the two initial commercial models."""
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(path) as db:
        await db.execute("PRAGMA busy_timeout=10000")
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS ai_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS ai_models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                provider_model TEXT NOT NULL,
                access_level TEXT NOT NULL DEFAULT 'free',
                button_style TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                intelligence_label TEXT NOT NULL DEFAULT 'عادي',
                analysis_label TEXT NOT NULL DEFAULT 'أساسي',
                image_quality_label TEXT NOT NULL DEFAULT 'محدود',
                coding_label TEXT NOT NULL DEFAULT 'جيد',
                education_label TEXT NOT NULL DEFAULT 'جيد',
                max_output_tokens INTEGER NOT NULL DEFAULT 1200,
                reasoning_effort TEXT NOT NULL DEFAULT 'low',
                image_enabled INTEGER NOT NULL DEFAULT 1,
                image_model TEXT NOT NULL DEFAULT 'gpt-image-2',
                image_quality TEXT NOT NULL DEFAULT 'low',
                system_prompt TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_users (
                telegram_id INTEGER PRIMARY KEY,
                username TEXT NOT NULL DEFAULT '',
                full_name TEXT NOT NULL DEFAULT '',
                is_banned INTEGER NOT NULL DEFAULT 0,
                pro_until TEXT NOT NULL DEFAULT '',
                active_model_id INTEGER NOT NULL DEFAULT 0,
                active_mode TEXT NOT NULL DEFAULT 'general',
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_users_pro ON ai_users(pro_until);
            CREATE TABLE IF NOT EXISTS ai_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER NOT NULL,
                model_id INTEGER NOT NULL DEFAULT 0,
                mode TEXT NOT NULL DEFAULT 'general',
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_history_user ON ai_history(telegram_id,id DESC);
            CREATE TABLE IF NOT EXISTS ai_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER NOT NULL,
                model_id INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL,
                input_chars INTEGER NOT NULL DEFAULT 0,
                output_chars INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'ok',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
            """
        )
        now = now_text()
        defaults = {
            "brand_name": "UCHIHA AI",
            "welcome_text": "اختر نموذج الذكاء الاصطناعي الذي تريد استخدامه.",
            "pro_button_label": "⭐ PRO",
            "pro_subscribe_url": os.getenv("AI_PRO_SUBSCRIBE_URL", "").strip(),
            "history_messages": "8",
            "free_daily_limit": "0",
        }
        for key, value in defaults.items():
            await db.execute(
                "INSERT OR IGNORE INTO ai_settings(key,value,updated_at) VALUES(?,?,?)",
                (key, value, now),
            )

        seeded = [
            (
                "uchiha-ai-v1",
                "UCHIHA AI V1",
                os.getenv("AI_V1_OPENAI_MODEL", "gpt-5.6-luna").strip() or "gpt-5.6-luna",
                "free",
                "primary",
                10,
                "منخفض",
                "أساسي",
                "اقتصادي",
                "جيد",
                "ممتاز للدراسة اليومية",
                1400,
                "low",
                1,
                "gpt-image-2",
                "low",
                "أنت UCHIHA AI V1، مساعد سريع واقتصادي. ركّز على الوضوح والاختصار والدقة.",
            ),
            (
                "uchiha-ai-v2",
                "UCHIHA AI V2",
                os.getenv("AI_V2_OPENAI_MODEL", "gpt-5.6-sol").strip() or "gpt-5.6-sol",
                "pro",
                "",
                20,
                "عالي جداً",
                "متقدم",
                "احترافية للغاية",
                "وكيل برمجي ممتاز",
                "شرح وتحليل متقدم",
                5000,
                "high",
                1,
                "gpt-image-2",
                "high",
                "أنت UCHIHA AI V2، مساعد احترافي عالي الدقة. حلّل بعمق مناسب وقدم نتيجة عملية ومنظمة.",
            ),
        ]
        for row in seeded:
            await db.execute(
                """
                INSERT OR IGNORE INTO ai_models(
                    slug,display_name,provider_model,access_level,button_style,sort_order,
                    intelligence_label,analysis_label,image_quality_label,coding_label,
                    education_label,max_output_tokens,reasoning_effort,image_enabled,image_model,
                    image_quality,system_prompt,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (*row, now, now),
            )
        await db.commit()


async def get_setting(key: str, default: str = "") -> str:
    await ensure_schema()
    async with aiosqlite.connect(db_path()) as db:
        async with db.execute("SELECT value FROM ai_settings WHERE key=?", (key,)) as cursor:
            row = await cursor.fetchone()
    return str(row[0]) if row else default


async def set_setting(key: str, value: str) -> None:
    await ensure_schema()
    key = str(key or "").strip()[:80]
    if not key:
        raise AIProductError("invalid_setting", "اسم الإعداد غير صالح.")
    async with aiosqlite.connect(db_path()) as db:
        await db.execute(
            "INSERT INTO ai_settings(key,value,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            (key, str(value or "")[:4000], now_text()),
        )
        await db.commit()


def _model_from_row(row: aiosqlite.Row) -> AIModel:
    return AIModel(
        id=int(row["id"]),
        slug=str(row["slug"]),
        display_name=str(row["display_name"]),
        provider_model=str(row["provider_model"]),
        access_level=str(row["access_level"]),
        button_style=str(row["button_style"] or ""),
        sort_order=int(row["sort_order"] or 0),
        enabled=bool(row["enabled"]),
        intelligence_label=str(row["intelligence_label"] or "عادي"),
        analysis_label=str(row["analysis_label"] or "أساسي"),
        image_quality_label=str(row["image_quality_label"] or "محدود"),
        coding_label=str(row["coding_label"] or "جيد"),
        education_label=str(row["education_label"] or "جيد"),
        max_output_tokens=max(128, int(row["max_output_tokens"] or 1200)),
        reasoning_effort=str(row["reasoning_effort"] or "low"),
        image_enabled=bool(row["image_enabled"]),
        image_model=str(row["image_model"] or "gpt-image-2"),
        image_quality=str(row["image_quality"] or "low"),
        system_prompt=str(row["system_prompt"] or ""),
    )


async def list_models(*, include_disabled: bool = False) -> list[AIModel]:
    await ensure_schema()
    where = "" if include_disabled else "WHERE enabled=1"
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT * FROM ai_models {where} ORDER BY sort_order,id"
        ) as cursor:
            rows = await cursor.fetchall()
    return [_model_from_row(row) for row in rows]


async def get_model(model_id: int, *, include_disabled: bool = False) -> AIModel | None:
    await ensure_schema()
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT * FROM ai_models WHERE id=?" + ("" if include_disabled else " AND enabled=1")
        async with db.execute(query, (int(model_id),)) as cursor:
            row = await cursor.fetchone()
    return _model_from_row(row) if row else None


async def update_model(model_id: int, **changes: Any) -> AIModel:
    allowed = {
        "display_name": (str, 80),
        "provider_model": (str, 100),
        "access_level": (str, 10),
        "button_style": (str, 20),
        "sort_order": (int, None),
        "enabled": (int, None),
        "intelligence_label": (str, 120),
        "analysis_label": (str, 120),
        "image_quality_label": (str, 120),
        "coding_label": (str, 160),
        "education_label": (str, 160),
        "max_output_tokens": (int, None),
        "reasoning_effort": (str, 20),
        "image_enabled": (int, None),
        "image_model": (str, 100),
        "image_quality": (str, 20),
        "system_prompt": (str, 4000),
    }
    assignments: list[str] = []
    values: list[Any] = []
    for key, raw in changes.items():
        if key not in allowed:
            continue
        caster, limit = allowed[key]
        try:
            value = caster(raw)
        except (TypeError, ValueError):
            continue
        if isinstance(value, str):
            value = value.strip()
            if limit:
                value = value[:limit]
        if key == "access_level" and value not in {"free", "pro"}:
            continue
        if key == "reasoning_effort" and value not in {"none", "low", "medium", "high", "xhigh", "max"}:
            continue
        if key == "image_quality" and value not in {"low", "medium", "high", "auto"}:
            continue
        if key == "max_output_tokens":
            value = max(128, min(32000, int(value)))
        if key in {"enabled", "image_enabled"}:
            value = 1 if int(value) else 0
        assignments.append(f"{key}=?")
        values.append(value)
    if not assignments:
        model = await get_model(model_id, include_disabled=True)
        if not model:
            raise AIProductError("model_not_found", "النموذج غير موجود.")
        return model
    assignments.append("updated_at=?")
    values.append(now_text())
    values.append(int(model_id))
    async with aiosqlite.connect(db_path()) as db:
        changed = await db.execute(
            f"UPDATE ai_models SET {','.join(assignments)} WHERE id=?",
            values,
        )
        await db.commit()
    if changed.rowcount != 1:
        raise AIProductError("model_not_found", "النموذج غير موجود.")
    model = await get_model(model_id, include_disabled=True)
    assert model is not None
    return model


async def create_model(
    *, display_name: str, provider_model: str, access_level: str = "pro"
) -> AIModel:
    await ensure_schema()
    display_name = str(display_name or "").strip()[:80]
    provider_model = str(provider_model or "").strip()[:100]
    access_level = access_level if access_level in {"free", "pro"} else "pro"
    if not display_name or not provider_model:
        raise AIProductError("invalid_model", "أدخل اسم النموذج ومعرّف OpenAI.")
    slug_base = "".join(ch.lower() if ch.isalnum() else "-" for ch in display_name).strip("-") or "ai-model"
    slug = f"{slug_base}-{int(dt.datetime.now(dt.timezone.utc).timestamp())}"
    now = now_text()
    async with aiosqlite.connect(db_path()) as db:
        cursor = await db.execute(
            """
            INSERT INTO ai_models(
                slug,display_name,provider_model,access_level,button_style,sort_order,enabled,
                intelligence_label,analysis_label,image_quality_label,coding_label,education_label,
                max_output_tokens,reasoning_effort,image_enabled,image_model,image_quality,
                system_prompt,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                slug, display_name, provider_model, access_level, "", 100, 1,
                "مرتفع", "متقدم", "احترافية", "ممتاز", "متقدم", 4000, "medium",
                1, "gpt-image-2", "medium", "أنت مساعد UCHIHA AI احترافي.", now, now,
            ),
        )
        await db.commit()
        model_id = int(cursor.lastrowid)
    model = await get_model(model_id, include_disabled=True)
    assert model is not None
    return model


async def upsert_user(telegram_id: int, username: str = "", full_name: str = "") -> dict[str, Any]:
    await ensure_schema()
    now = now_text()
    async with aiosqlite.connect(db_path()) as db:
        await db.execute(
            """
            INSERT INTO ai_users(telegram_id,username,full_name,created_at,last_seen_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(telegram_id) DO UPDATE SET
                username=excluded.username,full_name=excluded.full_name,last_seen_at=excluded.last_seen_at
            """,
            (int(telegram_id), str(username or "")[:80], str(full_name or "")[:160], now, now),
        )
        await db.commit()
    return await get_user(telegram_id) or {}


async def get_user(telegram_id: int) -> dict[str, Any] | None:
    await ensure_schema()
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM ai_users WHERE telegram_id=?", (int(telegram_id),)) as cursor:
            row = await cursor.fetchone()
    return dict(row) if row else None


async def is_pro(telegram_id: int) -> bool:
    user = await get_user(telegram_id)
    if not user:
        return False
    expires = _parse_utc(str(user.get("pro_until") or ""))
    return bool(expires and expires > dt.datetime.now(dt.timezone.utc))


async def set_pro(telegram_id: int, days: int) -> str:
    await upsert_user(telegram_id)
    days = max(0, min(int(days), 36500))
    value = _future_text(days) if days else ""
    async with aiosqlite.connect(db_path()) as db:
        await db.execute("UPDATE ai_users SET pro_until=? WHERE telegram_id=?", (value, int(telegram_id)))
        await db.commit()
    return value


async def set_banned(telegram_id: int, banned: bool) -> None:
    await upsert_user(telegram_id)
    async with aiosqlite.connect(db_path()) as db:
        await db.execute(
            "UPDATE ai_users SET is_banned=? WHERE telegram_id=?",
            (1 if banned else 0, int(telegram_id)),
        )
        await db.commit()


async def set_active_model(telegram_id: int, model_id: int) -> AIModel:
    user = await upsert_user(telegram_id)
    if int(user.get("is_banned") or 0):
        raise AIProductError("banned", "تم إيقاف حسابك عن استخدام البوت.")
    model = await get_model(model_id)
    if not model:
        raise AIProductError("model_not_found", "هذا النموذج غير متاح حالياً.")
    if model.access_level == "pro" and not await is_pro(telegram_id):
        raise AIProductError("pro_required", "هذا النموذج متاح لمشتركي PRO فقط.")
    async with aiosqlite.connect(db_path()) as db:
        await db.execute(
            "UPDATE ai_users SET active_model_id=?,active_mode='general' WHERE telegram_id=?",
            (model.id, int(telegram_id)),
        )
        await db.commit()
    return model


async def set_active_mode(telegram_id: int, mode: str) -> str:
    if mode not in MODE_LABELS:
        mode = "general"
    async with aiosqlite.connect(db_path()) as db:
        await db.execute("UPDATE ai_users SET active_mode=? WHERE telegram_id=?", (mode, int(telegram_id)))
        await db.commit()
    return mode


async def active_context(telegram_id: int) -> tuple[dict[str, Any], AIModel, str]:
    user = await upsert_user(telegram_id)
    model_id = int(user.get("active_model_id") or 0)
    model = await get_model(model_id) if model_id else None
    if not model:
        models = await list_models()
        if not models:
            raise AIProductError("no_models", "لا توجد نماذج مفعلة حالياً.")
        free = next((item for item in models if item.access_level == "free"), models[0])
        if free.access_level == "pro" and not await is_pro(telegram_id):
            raise AIProductError("pro_required", "لا يوجد نموذج مجاني مفعّل حالياً.")
        model = await set_active_model(telegram_id, free.id)
        user = await get_user(telegram_id) or user
    if model.access_level == "pro" and not await is_pro(telegram_id):
        free_models = [item for item in await list_models() if item.access_level == "free"]
        if not free_models:
            raise AIProductError("pro_required", "انتهى اشتراك PRO. جدده لاستخدام هذا النموذج.")
        model = await set_active_model(telegram_id, free_models[0].id)
        user = await get_user(telegram_id) or user
    return user, model, str(user.get("active_mode") or "general")


async def clear_history(telegram_id: int) -> None:
    async with aiosqlite.connect(db_path()) as db:
        await db.execute("DELETE FROM ai_history WHERE telegram_id=?", (int(telegram_id),))
        await db.commit()


async def _history(telegram_id: int, limit: int) -> list[dict[str, str]]:
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT role,content FROM ai_history WHERE telegram_id=? ORDER BY id DESC LIMIT ?",
            (int(telegram_id), max(0, min(int(limit), 30))),
        ) as cursor:
            rows = await cursor.fetchall()
    return [{"role": str(row["role"]), "content": str(row["content"])} for row in reversed(rows)]


async def _save_history(telegram_id: int, model_id: int, mode: str, role: str, content: str) -> None:
    async with aiosqlite.connect(db_path()) as db:
        await db.execute(
            "INSERT INTO ai_history(telegram_id,model_id,mode,role,content,created_at) VALUES(?,?,?,?,?,?)",
            (int(telegram_id), int(model_id), mode, role, str(content)[:20000], now_text()),
        )
        await db.execute(
            "DELETE FROM ai_history WHERE telegram_id=? AND id NOT IN "
            "(SELECT id FROM ai_history WHERE telegram_id=? ORDER BY id DESC LIMIT 40)",
            (int(telegram_id), int(telegram_id)),
        )
        await db.commit()


def _extract_response_text(payload: dict[str, Any]) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    parts: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            if content.get("type") in {"output_text", "text"} and isinstance(content.get("text"), str):
                parts.append(content["text"])
    return "\n".join(part.strip() for part in parts if part.strip()).strip()


def _api_key() -> str:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        raise AIProductError(
            "openai_not_configured",
            "لم يتم ربط OpenAI بعد. أضف OPENAI_API_KEY في متغيرات الاستضافة.",
        )
    return key


async def _log_usage(
    telegram_id: int,
    model_id: int,
    kind: str,
    *,
    input_chars: int = 0,
    output_chars: int = 0,
    input_tokens: int = 0,
    output_tokens: int = 0,
    status: str = "ok",
) -> None:
    async with aiosqlite.connect(db_path()) as db:
        await db.execute(
            """
            INSERT INTO ai_usage(
                telegram_id,model_id,kind,input_chars,output_chars,input_tokens,output_tokens,status,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                int(telegram_id), int(model_id), kind, int(input_chars), int(output_chars),
                int(input_tokens), int(output_tokens), status[:40], now_text(),
            ),
        )
        await db.commit()


async def generate_text(telegram_id: int, prompt: str) -> tuple[str, AIModel]:
    user, model, mode = await active_context(telegram_id)
    if int(user.get("is_banned") or 0):
        raise AIProductError("banned", "تم إيقاف حسابك عن استخدام البوت.")
    prompt = str(prompt or "").strip()
    if not prompt:
        raise AIProductError("empty_prompt", "أرسل رسالتك أولاً.")
    if mode == "image":
        raise AIProductError("image_mode", "وضع الصور مفعّل؛ استخدم generate_image لهذا الطلب.")

    try:
        history_count = int(await get_setting("history_messages", "8"))
    except ValueError:
        history_count = 8
    history = await _history(telegram_id, history_count)
    instructions = "\n\n".join(
        part for part in (model.system_prompt, MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS["general"])) if part
    )
    request_input = [*history, {"role": "user", "content": prompt}]
    payload: dict[str, Any] = {
        "model": model.provider_model,
        "instructions": instructions,
        "input": request_input,
        "max_output_tokens": model.max_output_tokens,
        "store": False,
    }
    if model.reasoning_effort and model.reasoning_effort != "none":
        payload["reasoning"] = {"effort": model.reasoning_effort}

    headers = {"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"}
    timeout = aiohttp.ClientTimeout(total=150)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{OPENAI_API_BASE}/responses", headers=headers, json=payload) as response:
                data = await response.json(content_type=None)
                if response.status >= 400:
                    message = str((data.get("error") or {}).get("message") or "OpenAI request failed")
                    await _log_usage(telegram_id, model.id, "text", input_chars=len(prompt), status=f"http_{response.status}")
                    raise AIProductError("openai_error", f"تعذر الحصول على رد من الذكاء الاصطناعي: {message[:300]}")
    except aiohttp.ClientError as exc:
        await _log_usage(telegram_id, model.id, "text", input_chars=len(prompt), status="network_error")
        raise AIProductError("openai_network", "تعذر الاتصال بخدمة الذكاء الاصطناعي حالياً.") from exc

    text = _extract_response_text(data)
    if not text:
        await _log_usage(telegram_id, model.id, "text", input_chars=len(prompt), status="empty_output")
        raise AIProductError("empty_output", "لم يصل رد نصي صالح. حاول مرة أخرى.")
    usage = data.get("usage") or {}
    await _save_history(telegram_id, model.id, mode, "user", prompt)
    await _save_history(telegram_id, model.id, mode, "assistant", text)
    await _log_usage(
        telegram_id,
        model.id,
        "text",
        input_chars=len(prompt),
        output_chars=len(text),
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
    )
    return text, model


async def generate_image(telegram_id: int, prompt: str) -> tuple[bytes | str, AIModel]:
    user, model, _ = await active_context(telegram_id)
    if int(user.get("is_banned") or 0):
        raise AIProductError("banned", "تم إيقاف حسابك عن استخدام البوت.")
    if not model.image_enabled:
        raise AIProductError("image_disabled", "إنشاء الصور غير متاح في هذا النموذج.")
    prompt = str(prompt or "").strip()
    if not prompt:
        raise AIProductError("empty_prompt", "أرسل وصف الصورة التي تريد إنشاءها.")
    headers = {"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"}
    payload = {
        "model": model.image_model,
        "prompt": prompt,
        "size": "1024x1024",
        "quality": model.image_quality,
        "n": 1,
    }
    timeout = aiohttp.ClientTimeout(total=180)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{OPENAI_API_BASE}/images/generations", headers=headers, json=payload) as response:
                data = await response.json(content_type=None)
                if response.status >= 400:
                    message = str((data.get("error") or {}).get("message") or "OpenAI image request failed")
                    await _log_usage(telegram_id, model.id, "image", input_chars=len(prompt), status=f"http_{response.status}")
                    raise AIProductError("openai_image_error", f"تعذر إنشاء الصورة: {message[:300]}")
    except aiohttp.ClientError as exc:
        await _log_usage(telegram_id, model.id, "image", input_chars=len(prompt), status="network_error")
        raise AIProductError("openai_network", "تعذر الاتصال بخدمة إنشاء الصور حالياً.") from exc

    items = data.get("data") or []
    if not items or not isinstance(items[0], dict):
        raise AIProductError("empty_image", "لم تصل صورة صالحة من الخدمة.")
    first = items[0]
    result: bytes | str
    if first.get("b64_json"):
        try:
            result = base64.b64decode(first["b64_json"], validate=True)
        except (ValueError, TypeError) as exc:
            raise AIProductError("invalid_image", "وصلت الصورة بصيغة غير صالحة.") from exc
    elif first.get("url"):
        result = str(first["url"])
    else:
        raise AIProductError("empty_image", "لم تصل صورة صالحة من الخدمة.")
    await _log_usage(telegram_id, model.id, "image", input_chars=len(prompt))
    return result, model


async def dashboard() -> dict[str, Any]:
    await ensure_schema()
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    async with aiosqlite.connect(db_path()) as db:
        async with db.execute("SELECT COUNT(*) FROM ai_users") as cursor:
            users = int((await cursor.fetchone())[0] or 0)
        async with db.execute("SELECT COUNT(*) FROM ai_users WHERE pro_until > ?", (now_text(),)) as cursor:
            pro_users = int((await cursor.fetchone())[0] or 0)
        async with db.execute("SELECT COUNT(*) FROM ai_usage WHERE created_at LIKE ?", (today + "%",)) as cursor:
            today_requests = int((await cursor.fetchone())[0] or 0)
        async with db.execute(
            "SELECT COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0) FROM ai_usage"
        ) as cursor:
            token_row = await cursor.fetchone()
        async with db.execute("SELECT COUNT(*) FROM ai_models WHERE enabled=1") as cursor:
            models = int((await cursor.fetchone())[0] or 0)
    return {
        "users": users,
        "pro_users": pro_users,
        "today_requests": today_requests,
        "input_tokens": int(token_row[0] or 0),
        "output_tokens": int(token_row[1] or 0),
        "models": models,
        "openai_configured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "billing_url": OPENAI_BILLING_URL,
    }


async def recent_users(limit: int = 12) -> list[dict[str, Any]]:
    await ensure_schema()
    async with aiosqlite.connect(db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM ai_users ORDER BY last_seen_at DESC LIMIT ?",
            (max(1, min(int(limit), 50)),),
        ) as cursor:
            rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def usage_for_user(telegram_id: int) -> dict[str, int]:
    await ensure_schema()
    async with aiosqlite.connect(db_path()) as db:
        async with db.execute(
            "SELECT COUNT(*),COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0) "
            "FROM ai_usage WHERE telegram_id=?",
            (int(telegram_id),),
        ) as cursor:
            row = await cursor.fetchone()
    return {"requests": int(row[0] or 0), "input_tokens": int(row[1] or 0), "output_tokens": int(row[2] or 0)}


__all__ = [
    "AIModel",
    "AIProductError",
    "MODE_LABELS",
    "OPENAI_BILLING_URL",
    "active_context",
    "clear_history",
    "create_model",
    "dashboard",
    "db_path",
    "ensure_schema",
    "generate_image",
    "generate_text",
    "get_model",
    "get_setting",
    "get_user",
    "is_pro",
    "list_models",
    "recent_users",
    "set_active_mode",
    "set_active_model",
    "set_banned",
    "set_pro",
    "set_setting",
    "update_model",
    "upsert_user",
    "usage_for_user",
]
