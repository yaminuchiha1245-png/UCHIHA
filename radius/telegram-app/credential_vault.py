from __future__ import annotations

import os
import secrets
import string
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class CredentialVaultError(RuntimeError):
    pass


class CredentialVault:
    def __init__(self, key: bytes):
        try:
            self._fernet = Fernet(key)
        except Exception as exc:
            raise CredentialVaultError("invalid credential encryption key") from exc

    @classmethod
    def from_file(cls, path: str | Path) -> "CredentialVault":
        file_path = Path(path)
        try:
            mode = file_path.stat().st_mode & 0o777
        except FileNotFoundError as exc:
            raise CredentialVaultError("credential key file is missing") from exc
        if mode & 0o077:
            raise CredentialVaultError("credential key file must not be group/world readable")
        key = file_path.read_bytes().strip()
        return cls(key)

    @classmethod
    def from_env(cls) -> "CredentialVault":
        path = os.getenv("UCHIHA_RADIUS_CREDENTIAL_KEY_FILE", "/etc/uchiha-radius/credential.key")
        return cls.from_file(path)

    @staticmethod
    def generate_key() -> bytes:
        return Fernet.generate_key()

    @staticmethod
    def validate_password(value: str) -> str:
        password = str(value or "")
        if not 8 <= len(password) <= 64:
            raise ValueError("RADIUS password must be 8-64 characters")
        if any(ord(ch) < 33 or ord(ch) > 126 for ch in password):
            raise ValueError("RADIUS password must use printable ASCII without spaces")
        return password

    @staticmethod
    def generate_password(length: int = 18) -> str:
        if length < 12:
            raise ValueError("password length too short")
        alphabet = string.ascii_letters + string.digits + "-_"
        while True:
            value = "".join(secrets.choice(alphabet) for _ in range(length))
            if (
                any(ch.islower() for ch in value)
                and any(ch.isupper() for ch in value)
                and any(ch.isdigit() for ch in value)
            ):
                return value

    def encrypt(self, password: str) -> str:
        value = self.validate_password(password)
        return self._fernet.encrypt(value.encode("utf-8")).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        try:
            value = self._fernet.decrypt(str(ciphertext or "").encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeDecodeError, ValueError) as exc:
            raise CredentialVaultError("credential decryption failed") from exc
        return self.validate_password(value)
