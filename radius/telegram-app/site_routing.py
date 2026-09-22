from __future__ import annotations

PREFIX = "@U:"


def encode_route(provider_id: str, router_id: str, original: str = "") -> str:
    provider = str(provider_id or "").strip()
    router = str(router_id or "").strip()
    value = str(original or "").strip()
    if not provider or not router or ":" in provider or ":" in router:
        raise ValueError("invalid site route")
    route = f"{PREFIX}{provider}:{router}:{value}"
    if len(route) > 128:
        raise ValueError("site route exceeds v37 field limit")
    return route


def decode_route(value: str) -> tuple[str, str, str] | None:
    text = str(value or "")
    if not text.startswith(PREFIX):
        return None
    parts = text[len(PREFIX):].split(":", 2)
    if len(parts) != 3 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1], parts[2]


def strip_route(value: str) -> str:
    decoded = decode_route(value)
    return decoded[2] if decoded else str(value or "")


def sanitize_routes(value):
    if isinstance(value, dict):
        return {k: sanitize_routes(v) for k,v in value.items()}
    if isinstance(value, list):
        return [sanitize_routes(v) for v in value]
    if isinstance(value, str):
        return strip_route(value)
    return value
