from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class V37GatewayError(RuntimeError):
    def __init__(self, message: str, status: int = 502, body: bytes = b""):
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass(frozen=True)
class GatewayResponse:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8"))


class V37Gateway:
    def __init__(
        self,
        base_url: str,
        *,
        key_id: str,
        secret: str,
        public_host: str = "radius.uchiha-builder.com",
        timeout: float = 8.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.key_id = key_id.strip() or "primary"
        self.secret = secret
        self.public_host = public_host.strip()
        self.timeout = timeout
        if not self.base_url.startswith(("http://127.0.0.1", "http://localhost", "https://")):
            raise ValueError("v37 base URL must be loopback HTTP or HTTPS")
        if len(self.secret) < 24:
            raise ValueError("v37 HMAC secret is missing or too short")

    @classmethod
    def from_secret_file(
        cls,
        base_url: str,
        *,
        key_id: str,
        secret_file: str,
        public_host: str,
        timeout: float = 8.0,
    ) -> "V37Gateway":
        value = Path(secret_file).read_text(encoding="utf-8").strip()
        return cls(base_url, key_id=key_id, secret=value, public_host=public_host, timeout=timeout)

    @staticmethod
    def canonical(
        method: str,
        request_target: str,
        actor: str,
        role: str,
        timestamp: str,
        nonce: str,
        body_hash: str,
    ) -> str:
        return "\n".join([
            "UCHIHA-GATEWAY-HMAC-V1",
            method.upper(),
            request_target,
            actor,
            role,
            timestamp,
            nonce,
            body_hash.lower(),
        ])

    def headers(self, method: str, target: str, body: bytes, *, actor: str, role: str) -> dict[str, str]:
        timestamp = str(int(time.time()))
        nonce = f"tg-{secrets.token_hex(16)}"
        body_hash = hashlib.sha256(body).hexdigest()
        canonical = self.canonical(method, target, actor, role, timestamp, nonce, body_hash)
        signature = hmac.new(self.secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Uchiha-Gateway-Signature": f"sha256={signature}",
            "X-Uchiha-Gateway-Key-Id": self.key_id,
            "X-Uchiha-Gateway-Timestamp": timestamp,
            "X-Uchiha-Gateway-Nonce": nonce,
            "X-Uchiha-Actor": actor,
            "X-Uchiha-Role": role,
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": self.public_host,
            "Host": self.public_host,
        }

    def request(
        self,
        method: str,
        target: str,
        *,
        actor: str,
        role: str,
        payload: dict[str, Any] | None = None,
    ) -> GatewayResponse:
        if not target.startswith("/api/connectors/radius"):
            raise ValueError("refusing to proxy outside the v37 connector namespace")
        body = b""
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = self.headers(method, target, body, actor=actor, role=role)
        request = urllib.request.Request(
            self.base_url + target,
            data=body if method.upper() in {"POST", "PUT", "PATCH", "DELETE"} else None,
            headers=headers,
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return GatewayResponse(
                    status=int(response.status),
                    headers={k.lower(): v for k, v in response.headers.items()},
                    body=response.read(),
                )
        except urllib.error.HTTPError as exc:
            return GatewayResponse(
                status=int(exc.code),
                headers={k.lower(): v for k, v in exc.headers.items()},
                body=exc.read(),
            )
        except (urllib.error.URLError, TimeoutError) as exc:
            raise V37GatewayError(f"v37 unavailable: {type(exc).__name__}") from exc
