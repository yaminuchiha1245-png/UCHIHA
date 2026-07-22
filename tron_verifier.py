#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read-only USDT-TRC20 transaction verification through TronGrid.

The verifier never signs or broadcasts transactions and therefore never needs a
wallet private key.  It only reads solidified transaction receipts and decodes
the official USDT ``Transfer`` event.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from decimal import Decimal
from typing import Any

import aiohttp


TRON_MAINNET_PREFIX = 0x41
TRC20_TRANSFER_TOPIC = (
    "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
)
DEFAULT_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BASE58_INDEX = {char: index for index, char in enumerate(_BASE58_ALPHABET)}


class TronGridError(RuntimeError):
    """A safe, user-displayable TronGrid verification error."""


def normalize_tron_txid(value: Any) -> str:
    """Return an uppercase 64-hex TRON transaction hash or an empty string."""
    raw = re.sub(r"^0x", "", str(value or "").strip(), flags=re.IGNORECASE)
    raw = re.sub(r"\s+", "", raw)
    return raw.upper() if re.fullmatch(r"[0-9A-Fa-f]{64}", raw) else ""


def tron_address_to_hex(address: str) -> str:
    """Validate a Base58Check TRON address and return its 21-byte hex form."""
    text = str(address or "").strip()
    if not text or any(char not in _BASE58_INDEX for char in text):
        raise ValueError("عنوان TRON غير صالح.")

    number = 0
    for char in text:
        number = number * 58 + _BASE58_INDEX[char]
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    leading_zeroes = len(text) - len(text.lstrip("1"))
    decoded = (b"\x00" * leading_zeroes) + raw
    if len(decoded) != 25:
        raise ValueError("عنوان TRON غير صالح.")

    payload, checksum = decoded[:-4], decoded[-4:]
    expected = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    if checksum != expected or len(payload) != 21 or payload[0] != TRON_MAINNET_PREFIX:
        raise ValueError("عنوان TRON غير صالح.")
    return payload.hex().lower()


def is_valid_tron_address(address: str) -> bool:
    try:
        tron_address_to_hex(address)
    except ValueError:
        return False
    return True


def _clean_hex(value: Any) -> str:
    return re.sub(r"^0x", "", str(value or "").strip(), flags=re.IGNORECASE).lower()


def _decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    return (text.rstrip("0").rstrip(".") if "." in text else text) or "0"


class TronGridClient:
    """Minimal read-only client used to verify solidified TRC20 transfers."""

    def __init__(
        self,
        *,
        api_key: str,
        recipient_address: str,
        base_url: str = "https://api.trongrid.io",
        token_contract: str = DEFAULT_USDT_CONTRACT,
        token_symbol: str = "USDT",
        token_decimals: int = 6,
    ) -> None:
        self.api_key = str(api_key or "").strip()
        self.recipient_address = str(recipient_address or "").strip()
        self.base_url = str(base_url or "https://api.trongrid.io").strip().rstrip("/")
        self.token_contract = str(token_contract or DEFAULT_USDT_CONTRACT).strip()
        self.token_symbol = str(token_symbol or "USDT").strip().upper() or "USDT"
        self.token_decimals = int(token_decimals)

    @property
    def ready(self) -> bool:
        return not self.configuration_error()

    def configuration_error(self) -> str:
        if not self.api_key:
            return "TRONGRID_API_KEY غير موجود في Railway."
        if self.base_url.casefold() != "https://api.trongrid.io":
            return "TRONGRID_API_BASE_URL يجب أن يكون https://api.trongrid.io."
        if not is_valid_tron_address(self.recipient_address):
            return "BINANCE_DEPOSIT_ADDRESS ليس عنوان TRON صالحًا."
        if not is_valid_tron_address(self.token_contract):
            return "عنوان عقد USDT على TRON غير صالح."
        if self.token_contract != DEFAULT_USDT_CONTRACT:
            return "TRON_USDT_CONTRACT لا يطابق عقد USDT الرسمي على TRON."
        if self.token_symbol != "USDT" or self.token_decimals != 6:
            return "إعداد عملة USDT على TRON غير صالح."
        return ""

    async def _json_request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "TRON-PRO-API-KEY": self.api_key,
            "User-Agent": "UCHIHA-Store/1.0",
        }
        timeout = aiohttp.ClientTimeout(total=20, connect=8)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.request(
                    method,
                    f"{self.base_url}{path}",
                    headers=headers,
                    json=payload if method.upper() != "GET" else None,
                ) as response:
                    raw = await response.text()
                    try:
                        data = json.loads(raw) if raw else {}
                    except json.JSONDecodeError:
                        data = {}
                    if response.status == 429:
                        raise TronGridError("تم تجاوز حد طلبات TronGrid مؤقتًا؛ أعد المحاولة بعد قليل.")
                    if response.status in {401, 403}:
                        raise TronGridError("رفض TronGrid مفتاح API؛ تحقق من المفتاح وقيوده.")
                    if response.status >= 400:
                        raise TronGridError(f"فشل اتصال TronGrid (HTTP {response.status}).")
                    if not isinstance(data, dict):
                        raise TronGridError("استجابة TronGrid غير صالحة.")
                    return data
        except asyncio.TimeoutError as exc:
            raise TronGridError("انتهت مهلة الاتصال مع TronGrid.") from exc
        except aiohttp.ClientError as exc:
            raise TronGridError(f"تعذر الاتصال مع TronGrid: {exc.__class__.__name__}") from exc

    async def test_connection(self) -> dict[str, Any]:
        error = self.configuration_error()
        if error:
            raise TronGridError(error)
        block = await self._json_request("POST", "/wallet/getnowblock", payload={})
        block_id = str(block.get("blockID") or "").strip()
        header = block.get("block_header") if isinstance(block.get("block_header"), dict) else {}
        raw_data = header.get("raw_data") if isinstance(header.get("raw_data"), dict) else {}
        block_number = int(raw_data.get("number") or 0)
        if not block_id:
            raise TronGridError("اتصل TronGrid لكن لم يُرجع كتلة صالحة.")
        return {"block_id": block_id, "block_number": block_number}

    async def transaction_deposits(self, txid: str) -> tuple[bool, list[dict[str, Any]]]:
        """Return ``(found, matching transfers)`` for a solidified transaction."""
        normalized = normalize_tron_txid(txid)
        if not normalized:
            raise TronGridError("TXID الخاص بشبكة TRON يجب أن يكون 64 خانة سداسية.")
        error = self.configuration_error()
        if error:
            raise TronGridError(error)

        info = await self._json_request(
            "POST",
            "/walletsolidity/gettransactioninfobyid",
            payload={"value": normalized.lower()},
        )
        if not info:
            return False, []
        returned_id = normalize_tron_txid(info.get("id"))
        if not returned_id:
            return False, []
        if returned_id != normalized:
            raise TronGridError("أعاد TronGrid معاملة مختلفة عن TXID المطلوب.")

        receipt = info.get("receipt") if isinstance(info.get("receipt"), dict) else {}
        result = str(receipt.get("result") or info.get("result") or "").strip().upper()
        if result != "SUCCESS":
            if not result:
                raise TronGridError("لم يُثبت TronGrid نجاح المعاملة بعد.")
            raise TronGridError("المعاملة موجودة على TRON لكنها فشلت ولم تُحوّل USDT.")
        block_number = int(info.get("blockNumber") or 0)
        block_timestamp = int(info.get("blockTimeStamp") or 0)
        if block_number <= 0 or block_timestamp <= 0:
            return False, []

        recipient_hex = tron_address_to_hex(self.recipient_address)[2:]
        contract_hex = tron_address_to_hex(self.token_contract)[2:]
        transfers: list[dict[str, Any]] = []
        logs = info.get("log") if isinstance(info.get("log"), list) else []
        for event in logs:
            if not isinstance(event, dict):
                continue
            event_contract = _clean_hex(event.get("address"))
            topics = event.get("topics") if isinstance(event.get("topics"), list) else []
            if event_contract != contract_hex or len(topics) < 3:
                continue
            if _clean_hex(topics[0]) != TRC20_TRANSFER_TOPIC:
                continue
            destination = _clean_hex(topics[2])
            if len(destination) != 64 or destination[-40:] != recipient_hex:
                continue
            amount_hex = _clean_hex(event.get("data"))
            if not amount_hex or not re.fullmatch(r"[0-9a-f]+", amount_hex):
                continue
            amount_raw = int(amount_hex, 16)
            amount = Decimal(amount_raw) / (Decimal(10) ** self.token_decimals)
            transfers.append(
                {
                    "amount": _decimal_text(amount),
                    "coin": self.token_symbol,
                    "network": "TRX",
                    "status": 1,
                    "insertTime": block_timestamp,
                    "address": self.recipient_address,
                    "txId": normalized,
                    "contractAddress": self.token_contract,
                    "blockNumber": block_number,
                    "confirmation": "solidified",
                    "provider": "trongrid",
                }
            )
        return True, transfers


__all__ = [
    "DEFAULT_USDT_CONTRACT",
    "TRC20_TRANSFER_TOPIC",
    "TronGridClient",
    "TronGridError",
    "is_valid_tron_address",
    "normalize_tron_txid",
    "tron_address_to_hex",
]
