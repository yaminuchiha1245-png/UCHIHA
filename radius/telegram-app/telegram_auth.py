from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl


class TelegramAuthError(ValueError):
    pass


@dataclass(frozen=True)
class TelegramIdentity:
    user_id: int
    first_name: str
    last_name: str
    username: str
    language_code: str
    auth_date: int
    query_id: str | None
    raw_user: dict[str, Any]

    @property
    def display_name(self) -> str:
        name = " ".join(x for x in (self.first_name, self.last_name) if x).strip()
        return name or self.username or str(self.user_id)


def _data_check_string(values: dict[str, str]) -> str:
    return "\n".join(f"{key}={values[key]}" for key in sorted(values) if key != "hash")


def verify_init_data(init_data: str, bot_token: str, *, max_age_seconds: int = 900, now: int | None = None) -> TelegramIdentity:
    if not init_data or not bot_token:
        raise TelegramAuthError("missing init data or bot token")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    supplied_hash = pairs.get("hash", "")
    if len(supplied_hash) != 64:
        raise TelegramAuthError("invalid Telegram hash")

    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, _data_check_string(pairs).encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, supplied_hash):
        raise TelegramAuthError("Telegram signature mismatch")

    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError as exc:
        raise TelegramAuthError("invalid auth_date") from exc
    current = int(time.time() if now is None else now)
    if auth_date <= 0 or auth_date > current + 30:
        raise TelegramAuthError("invalid auth_date")
    if max_age_seconds > 0 and current - auth_date > max_age_seconds:
        raise TelegramAuthError("Telegram init data expired")

    try:
        user = json.loads(pairs.get("user", "{}"))
        user_id = int(user["id"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise TelegramAuthError("invalid Telegram user") from exc
    if user_id <= 0:
        raise TelegramAuthError("invalid Telegram user")

    return TelegramIdentity(
        user_id=user_id,
        first_name=str(user.get("first_name") or ""),
        last_name=str(user.get("last_name") or ""),
        username=str(user.get("username") or ""),
        language_code=str(user.get("language_code") or ""),
        auth_date=auth_date,
        query_id=pairs.get("query_id"),
        raw_user=user,
    )
