from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from provider_store import Access


@dataclass
class ProxyResponse:
    status: int
    body: bytes
    content_type: str = "application/json; charset=utf-8"


class BackendV37Proxy:
    def __init__(self) -> None:
        self.base_url = os.getenv("UCHIHA_RADIUS_V37_URL", "http://127.0.0.1:8790").rstrip("/")
        self.secret = os.getenv("UCHIHA_RADIUS_V37_GATEWAY_HMAC_SECRET", "")
        self.key_id = os.getenv("UCHIHA_RADIUS_V37_GATEWAY_HMAC_KEY_ID", "telegram-provider").strip() or "telegram-provider"
        self.timeout = max(0.5, min(float(os.getenv("UCHIHA_RADIUS_V37_TIMEOUT", "8")), 30.0))
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise RuntimeError("invalid UCHIHA_RADIUS_V37_URL")

    @property
    def configured(self) -> bool:
        return len(self.secret) >= 24

    @staticmethod
    def _role(role: str) -> str:
        return {
            "owner": "owner",
            "admin": "operator",
            "operator": "operator",
            "viewer": "auditor",
        }.get(role, "auditor")

    def _headers(self, access: Access, method: str, target: str, raw_body: bytes) -> dict[str, str]:
        if not self.configured:
            raise RuntimeError("backend v37 gateway HMAC is not configured")
        timestamp = str(int(time.time()))
        nonce = "tg-" + secrets.token_hex(16)
        actor = f"telegram:{access.telegram_user_id}@{access.provider_id}"[:128]
        role = self._role(access.role)
        body_hash = hashlib.sha256(raw_body).hexdigest()
        canonical = "\n".join([
            "UCHIHA-GATEWAY-HMAC-V1",
            method.upper(),
            target,
            actor,
            role,
            timestamp,
            nonce,
            body_hash,
        ])
        signature = hmac.new(self.secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Uchiha-Gateway-Signature": signature,
            "X-Uchiha-Gateway-Key-Id": self.key_id,
            "X-Uchiha-Gateway-Timestamp": timestamp,
            "X-Uchiha-Gateway-Nonce": nonce,
            "X-Uchiha-Actor": actor,
            "X-Uchiha-Role": role,
            "X-Forwarded-Proto": "https",
            "X-Uchiha-Provider-Id": access.provider_id,
        }

    def request(
        self,
        access: Access,
        method: str,
        target: str,
        *,
        payload: dict[str, Any] | None = None,
        passthrough_headers: dict[str, str] | None = None,
    ) -> ProxyResponse:
        method = method.upper()
        if not target.startswith("/api/connectors/radius"):
            raise ValueError("unsupported backend target")
        raw = b"" if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = self._headers(access, method, target, raw)
        for key, value in (passthrough_headers or {}).items():
            if value:
                headers[key] = value
        request = urllib.request.Request(
            self.base_url + target,
            data=raw if method in {"POST","PUT","PATCH","DELETE"} else None,
            method=method,
            headers=headers,
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=self.timeout) as response:
                body = response.read(512 * 1024)
                return ProxyResponse(
                    int(response.status),
                    body,
                    response.headers.get("Content-Type", "application/json; charset=utf-8"),
                )
        except urllib.error.HTTPError as exc:
            return ProxyResponse(
                int(exc.code),
                exc.read(512 * 1024),
                exc.headers.get("Content-Type", "application/json; charset=utf-8") if exc.headers else "application/json; charset=utf-8",
            )
        except Exception as exc:
            body = json.dumps({
                "error": {
                    "code": "backend_v37_unavailable",
                    "message": type(exc).__name__,
                    "status": 503,
                }
            }, separators=(",", ":")).encode()
            return ProxyResponse(503, body)
