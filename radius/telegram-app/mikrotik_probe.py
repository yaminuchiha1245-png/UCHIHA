from __future__ import annotations

import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor
from typing import Any

PORTS = {"api_tls": 8729, "api": 8728, "https": 443, "http": 80}


def private_ipv4(value: str) -> str:
    address = ipaddress.ip_address(value)
    if address.version != 4 or not address.is_private:
        raise ValueError("private IPv4 required")
    return str(address)


def _connect(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def probe(host: str, timeout: float = 0.8) -> dict[str, Any]:
    host = private_ipv4(host)
    with ThreadPoolExecutor(max_workers=len(PORTS)) as pool:
        futures = {name: pool.submit(_connect, host, port, timeout) for name, port in PORTS.items()}
        ports = {name: future.result() for name, future in futures.items()}
    return {"host": host, "reachable": any(ports.values()), "ports": ports, "mutationEnabled": False}
