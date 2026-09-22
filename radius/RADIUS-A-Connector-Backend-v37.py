#!/usr/bin/env python3
"""
UCHIHA RADIUS-A Connector Backend v37
Contract version: 1.0

Live-driver additions over v7:
- Keeps v3 authentication, CSRF, RBAC, audit, CORS, rate limits and gateway mode.
- Adds explicit adapter selection: preview or production-dry-run.
- Reads production connector configuration from server environment only.
- Validates RADIUS/MikroTik production readiness without exposing secrets.
- Refuses production-live mode until an approved live driver exists.
- Adds a protected production-readiness endpoint and startup guard.

Safe-by-default: v37 retains an explicitly gated production-live adapter through a server-side MikroTik HTTPS gateway. Live mode remains disabled unless three independent gates are enabled.
"""
from __future__ import annotations

import hashlib
import hmac
try:
    import fcntl
except ImportError:
    fcntl = None
import http.client
import ipaddress
import json
import os
import re
import secrets
import signal
import socket
import sqlite3
import shutil
import subprocess
import sys
import ssl
import stat
import threading
import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib import error as urllib_error
from urllib import request as urllib_request

HOST = os.environ.get("UCHIHA_CONNECTOR_HOST", "127.0.0.1")
PORT = int(os.environ.get("UCHIHA_CONNECTOR_PORT", "8790"))
CONTRACT_VERSION = "1.0"
OPENAPI_VERSION = "3.1.0"
API_CONTRACT_VERSION = "1.8.0"
_API_CONTRACT_CACHE = None
MAX_BODY = 256 * 1024
EDGE_MAX_CONCURRENT_REQUESTS = max(2, min(int(os.environ.get("UCHIHA_EDGE_MAX_CONCURRENT_REQUESTS", "128")), 2048))
EDGE_SOCKET_TIMEOUT_SECONDS = max(1.0, min(float(os.environ.get("UCHIHA_EDGE_SOCKET_TIMEOUT_SECONDS", "15")), 120.0))
EDGE_GATEWAY_AUTH_FAILURE_LIMIT = max(2, min(int(os.environ.get("UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_LIMIT", "30")), 10000))
EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS = max(1.0, min(float(os.environ.get("UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS", "60")), 3600.0))
_EDGE_AUTH_RATE_LOCK = threading.Lock()
_EDGE_AUTH_FAILURES: dict[str, deque] = defaultdict(deque)
_EDGE_REJECTED_AUTH_TOTAL = 0
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{6,128}$")
TRACE_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{6,128}$")
LOG_FORMAT = os.environ.get("UCHIHA_LOG_FORMAT", "json").strip().lower()
if LOG_FORMAT not in {"json", "text"}:
    LOG_FORMAT = "json"
LOG_LEVEL = os.environ.get("UCHIHA_LOG_LEVEL", "INFO").strip().upper()
if LOG_LEVEL not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
    LOG_LEVEL = "INFO"
LOG_HTTP = os.environ.get("UCHIHA_LOG_HTTP", "1").strip() != "0"
_TRACE_ID_CTX: ContextVar[str | None] = ContextVar("uchiha_trace_id", default=None)
_CORRELATION_ID_CTX: ContextVar[str | None] = ContextVar("uchiha_correlation_id", default=None)
REMOTE_LOG_ENABLE = os.environ.get("UCHIHA_LOG_REMOTE_ENABLE", "0").strip() == "1"
REMOTE_LOG_ACK = os.environ.get("UCHIHA_LOG_REMOTE_ACK", "").strip()
REMOTE_LOG_ACK_REQUIRED = "I_UNDERSTAND_REMOTE_LOG_SHIPPING"
REMOTE_LOG_URL = os.environ.get("UCHIHA_LOG_REMOTE_URL", "").strip().rstrip("/")
REMOTE_LOG_TOKEN = os.environ.get("UCHIHA_LOG_REMOTE_TOKEN", "")
REMOTE_LOG_PATH = os.environ.get("UCHIHA_LOG_REMOTE_PATH", "/api/logs/batch").strip() or "/api/logs/batch"
REMOTE_LOG_ALLOW_INSECURE = os.environ.get("UCHIHA_LOG_REMOTE_ALLOW_INSECURE", "0").strip() == "1"
REMOTE_LOG_TIMEOUT_SECONDS = max(0.5, min(float(os.environ.get("UCHIHA_LOG_REMOTE_TIMEOUT", "4.0")), 30.0))
REMOTE_LOG_WORKER_ENABLED = os.environ.get("UCHIHA_LOG_REMOTE_WORKER_ENABLED", "1").strip() != "0"
REMOTE_LOG_POLL_SECONDS = max(0.05, min(float(os.environ.get("UCHIHA_LOG_REMOTE_POLL_SECONDS", "0.5")), 30.0))
REMOTE_LOG_BATCH_SIZE = max(1, min(int(os.environ.get("UCHIHA_LOG_REMOTE_BATCH_SIZE", "50")), 500))
REMOTE_LOG_MAX_ATTEMPTS = max(1, min(int(os.environ.get("UCHIHA_LOG_REMOTE_MAX_ATTEMPTS", "5")), 20))
REMOTE_LOG_RETRY_BASE_SECONDS = max(0.05, min(float(os.environ.get("UCHIHA_LOG_REMOTE_RETRY_BASE_SECONDS", "2.0")), 300.0))
REMOTE_LOG_SENT_RETENTION_SECONDS = max(60, int(os.environ.get("UCHIHA_LOG_REMOTE_SENT_RETENTION_SECONDS", "604800")))
REMOTE_LOG_DEAD_RETENTION_SECONDS = max(60, int(os.environ.get("UCHIHA_LOG_REMOTE_DEAD_RETENTION_SECONDS", "2592000")))
REMOTE_LOG_MAX_BACKLOG = max(100, min(int(os.environ.get("UCHIHA_LOG_REMOTE_MAX_BACKLOG", "10000")), 1000000))
REMOTE_LOG_MAX_RECORD_BYTES = max(2048, min(int(os.environ.get("UCHIHA_LOG_REMOTE_MAX_RECORD_BYTES", "32768")), 262144))
_REMOTE_LOG_STOP = threading.Event()
_REMOTE_LOG_THREAD: threading.Thread | None = None
_REMOTE_LOG_DROP_LOCK = threading.Lock()
_REMOTE_LOG_DROPPED = 0
ALLOWED_NODE_STATES = {"online", "degraded", "offline", "maintenance", "provisioning", "archived"}
ALLOWED_OPERATIONS = {"disconnect", "reauthenticate", "review"}
ALLOWED_ROLES = {"owner", "operator", "support", "auditor"}
ROLE_PERMISSIONS = {
    "owner": {"disconnect", "reauthenticate", "review", "node-status", "read-ledger", "read-audit", "read-readiness", "read-commands", "manage-commands", "cleanup-commands", "read-backups", "manage-backups", "read-alerts", "manage-alerts", "manage-runtime", "read-vouchers", "provision-vouchers", "read-operators", "manage-operators"},
    "operator": {"disconnect", "reauthenticate", "review", "node-status", "read-ledger", "read-readiness", "read-commands", "manage-commands", "read-backups", "read-alerts", "manage-alerts", "read-vouchers", "provision-vouchers"},
    "support": {"reauthenticate", "review", "read-ledger", "read-commands", "read-alerts"},
    "auditor": {"read-ledger", "read-audit", "read-readiness", "read-commands", "read-backups", "read-alerts", "read-vouchers", "read-operators"},
}

BASE_DIR = Path(__file__).resolve().parent
UI_BUILD = "v101"
BACKEND_BUILD = "v37"
DATABASE_SCHEMA_VERSION = 30
DATABASE_SCHEMA_REQUIRED_COLUMNS = {
    "connector_requests": {"request_id", "kind", "operation", "actor", "role", "created_at"},
    "auth_sessions": {"session_id", "csrf_token", "actor", "role", "expires_at"},
    "operator_accounts": {"username", "password_salt", "password_hash", "role", "enabled", "created_at", "updated_at", "last_login_at", "password_changed_at"},
    "audit_events": {"event_id", "actor", "role", "action", "outcome", "trace_id", "correlation_id", "created_at"},
    "connectivity_checks": {"check_id", "result_json", "created_at"},
    "connector_commands": {"command_id", "request_id", "status", "attempts", "updated_at"},
    "backup_restore_drills": {"drill_id", "backup_name", "status", "completed_at"},
    "backup_replications": {"replication_id", "backup_name", "backup_sha256", "status", "created_at", "updated_at"},
    "log_delivery_outbox": {"log_id", "event_name", "level", "record_json", "status", "attempts", "created_at", "updated_at"},
    "gateway_auth_nonces": {"nonce", "key_id", "actor", "used_at", "expires_at", "trace_id"},
    "operational_alerts": {"alert_id", "alert_key", "severity", "status", "last_seen_at"},
    "operational_alert_deliveries": {"delivery_id", "alert_id", "channel", "status", "created_at"},
    "operational_alert_outbox": {"outbox_id", "dedup_key", "status", "attempts", "updated_at"},
    "runtime_control": {"control_key", "enabled", "reason", "updated_at", "updated_by"},
    "deployment_checkpoints": {"checkpoint_id", "status", "safe_for_deployment", "completed_at"},
    "deployment_verifications": {"verification_id", "checkpoint_id", "status", "passed", "completed_at"},
    "voucher_provision_batches": {"batch_id", "request_id", "payload_hash", "provider_id", "plan_id", "quantity", "validity", "status", "created_at", "updated_at"},
    "schema_migrations": {"migration_id", "source_version", "target_version", "description", "applied_at", "backend_build"},
}
PREVIEW_FILE = BASE_DIR / "RADIUS-A-Master-v101.html"
DB_PATH = Path(os.environ.get("UCHIHA_CONNECTOR_DB", str(BASE_DIR / "uchiha_radius_connector_v37.sqlite3")))
INSTANCE_LOCK_REQUIRED = os.environ.get("UCHIHA_INSTANCE_LOCK_REQUIRED", "1").strip() != "0"
INSTANCE_LOCK_PATH = Path(os.environ.get("UCHIHA_INSTANCE_LOCK_PATH", str(DB_PATH) + ".instance.lock"))
HOST_PREFLIGHT_REQUIRED = os.environ.get("UCHIHA_HOST_PREFLIGHT_REQUIRED", "1").strip() != "0"
HOST_MIN_FREE_BYTES = max(0, int(os.environ.get("UCHIHA_HOST_MIN_FREE_BYTES", str(512 * 1024 * 1024))))
_HOST_PREFLIGHT_CACHE = None
_INSTANCE_LOCK_HANDLE = None
_INSTANCE_LOCK_HELD = False
_INSTANCE_LOCK_ACQUIRED_AT = None
_INSTANCE_LOCK_OWNER_PID = None
AUTH_MODE = os.environ.get("UCHIHA_CONNECTOR_AUTH_MODE", "local-preview").strip().lower()
SUPPORTED_AUTH_MODES = {"local-preview", "gateway", "operator-session", "hybrid"}
OPERATOR_USERNAME_RE = re.compile(r"^[A-Za-z0-9._@-]{3,64}$")
OPERATOR_PASSWORD_MIN_LENGTH = max(12, min(int(os.environ.get("UCHIHA_OPERATOR_PASSWORD_MIN_LENGTH", "12")), 64))
OPERATOR_SCRYPT_N_LOG2 = max(14, min(int(os.environ.get("UCHIHA_OPERATOR_SCRYPT_N_LOG2", "14")), 18))
OPERATOR_SCRYPT_N = 1 << OPERATOR_SCRYPT_N_LOG2
OPERATOR_SCRYPT_R = 8
OPERATOR_SCRYPT_P = 1
OPERATOR_LOGIN_FAILURE_LIMIT = max(3, min(int(os.environ.get("UCHIHA_OPERATOR_LOGIN_FAILURE_LIMIT", "5")), 100))
OPERATOR_LOGIN_FAILURE_WINDOW_SECONDS = max(30.0, min(float(os.environ.get("UCHIHA_OPERATOR_LOGIN_FAILURE_WINDOW_SECONDS", "300")), 3600.0))
OPERATOR_BOOTSTRAP_USERNAME = os.environ.get("UCHIHA_BOOTSTRAP_OWNER_USERNAME", "").strip().lower()
OPERATOR_BOOTSTRAP_PASSWORD_FILE = os.environ.get("UCHIHA_BOOTSTRAP_OWNER_PASSWORD_FILE", "").strip()
_OPERATOR_LOGIN_LOCK = threading.Lock()
_OPERATOR_LOGIN_FAILURES: dict[str, deque] = defaultdict(deque)
SESSION_TTL_SECONDS = max(300, int(os.environ.get("UCHIHA_CONNECTOR_SESSION_TTL", "3600")))
RATE_LIMIT = max(10, int(os.environ.get("UCHIHA_CONNECTOR_RATE_LIMIT", "60")))
RATE_WINDOW_SECONDS = max(10, int(os.environ.get("UCHIHA_CONNECTOR_RATE_WINDOW", "60")))
GATEWAY_KEY = os.environ.get("UCHIHA_CONNECTOR_GATEWAY_KEY", "")
GATEWAY_LEGACY_KEY_AUTH = os.environ.get("UCHIHA_GATEWAY_LEGACY_KEY_AUTH", "0").strip() == "1"
GATEWAY_HMAC_SECRET = os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET", "")
GATEWAY_HMAC_KEY_ID = os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID", "primary").strip() or "primary"
GATEWAY_HMAC_PREVIOUS_SECRET = os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_SECRET", "")
GATEWAY_HMAC_PREVIOUS_KEY_ID = os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_KEY_ID", "").strip()
GATEWAY_HMAC_MAX_SKEW_SECONDS = max(30, min(int(os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_MAX_SKEW", "120")), 900))
GATEWAY_NONCE_RETENTION_SECONDS = max(
    GATEWAY_HMAC_MAX_SKEW_SECONDS * 2,
    min(int(os.environ.get("UCHIHA_CONNECTOR_GATEWAY_NONCE_RETENTION", "600")), 86400),
)
GATEWAY_REQUIRE_HTTPS = os.environ.get("UCHIHA_GATEWAY_REQUIRE_HTTPS", "1").strip() != "0"
GATEWAY_NONCE_RE = re.compile(r"^[A-Za-z0-9._:-]{16,128}$")
GATEWAY_SIGNATURE_RE = re.compile(r"^(?:sha256=)?([0-9a-fA-F]{64})$")
LAUNCH_REQUIRE_HTTPS = os.environ.get("UCHIHA_LAUNCH_REQUIRE_HTTPS", "1").strip() != "0"
LAUNCH_REQUIRE_GATEWAY_HMAC = os.environ.get("UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC", "1").strip() != "0"
LAUNCH_REQUIRE_OPERATOR_SESSION = os.environ.get("UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION", "1").strip() != "0"
LAUNCH_REQUIRE_VERIFIED_BACKUP = os.environ.get("UCHIHA_LAUNCH_REQUIRE_VERIFIED_BACKUP", "1").strip() != "0"
LAUNCH_REQUIRE_RECOVERY_DRILL = os.environ.get("UCHIHA_LAUNCH_REQUIRE_RECOVERY_DRILL", "1").strip() != "0"
LAUNCH_REQUIRE_OFFHOST_BACKUP = os.environ.get("UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP", "1").strip() != "0"
LAUNCH_REQUIRE_REMOTE_LOG_SHIPPING = os.environ.get("UCHIHA_LAUNCH_REQUIRE_REMOTE_LOG_SHIPPING", "0").strip() == "1"
LAUNCH_REQUIRE_TELEGRAM = os.environ.get("UCHIHA_LAUNCH_REQUIRE_TELEGRAM", "0").strip() == "1"
LAUNCH_REQUIRE_VOUCHERS = os.environ.get("UCHIHA_LAUNCH_REQUIRE_VOUCHERS", "0").strip() == "1"
LAUNCH_REQUIRE_DIRECT_RADIUS = os.environ.get("UCHIHA_LAUNCH_REQUIRE_DIRECT_RADIUS", "0").strip() == "1"
LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION = os.environ.get("UCHIHA_LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION", "1").strip() != "0"
LAUNCH_REQUIRE_RELEASE_INTEGRITY = os.environ.get("UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY", "1").strip() != "0"
LAUNCH_REQUIRE_EDGE_PROTECTION = os.environ.get("UCHIHA_LAUNCH_REQUIRE_EDGE_PROTECTION", "1").strip() != "0"
LAUNCH_REQUIRE_INSTANCE_LOCK = os.environ.get("UCHIHA_LAUNCH_REQUIRE_INSTANCE_LOCK", "1").strip() != "0"
LAUNCH_REQUIRE_HOST_PREFLIGHT = os.environ.get("UCHIHA_LAUNCH_REQUIRE_HOST_PREFLIGHT", "1").strip() != "0"
RELEASE_INTEGRITY_REQUIRED = os.environ.get(
    "UCHIHA_RELEASE_INTEGRITY_REQUIRED",
    "0",
).strip() == "1"
RELEASE_INTEGRITY_MANIFEST = Path(os.environ.get(
    "UCHIHA_RELEASE_INTEGRITY_MANIFEST",
    str(BASE_DIR / "UCHIHA-RADIUS-v101-Backend-v37-INTEGRITY.json"),
))
RELEASE_INTEGRITY_MANIFEST_SHA256 = os.environ.get(
    "UCHIHA_RELEASE_INTEGRITY_MANIFEST_SHA256", ""
).strip().lower()
ALLOWED_ORIGINS = {x.strip() for x in os.environ.get("UCHIHA_CONNECTOR_ALLOWED_ORIGINS", "").split(",") if x.strip()}
COOKIE_NAME = "uchiha_connector_sid"

PUBLIC_HTTPS_REQUIRED = os.environ.get("UCHIHA_PUBLIC_HTTPS_REQUIRED", "0").strip() == "1"
TRUST_PROXY_HEADERS = os.environ.get("UCHIHA_TRUST_PROXY_HEADERS", "0").strip() == "1"
REJECT_UNTRUSTED_PROXY_HEADERS = os.environ.get("UCHIHA_REJECT_UNTRUSTED_PROXY_HEADERS", "1").strip() != "0"
TRUSTED_PROXY_CIDR_VALUES = [
    x.strip() for x in os.environ.get("UCHIHA_TRUSTED_PROXY_CIDRS", "").split(",") if x.strip()
]
TRUSTED_PROXY_NETWORKS = []
TRUSTED_PROXY_CONFIG_ERRORS = []
for _cidr in TRUSTED_PROXY_CIDR_VALUES:
    try:
        TRUSTED_PROXY_NETWORKS.append(ipaddress.ip_network(_cidr, strict=False))
    except ValueError:
        TRUSTED_PROXY_CONFIG_ERRORS.append(_cidr)
COOKIE_SECURE_POLICY = os.environ.get(
    "UCHIHA_COOKIE_SECURE",
    "1" if PUBLIC_HTTPS_REQUIRED else "0",
).strip() == "1"
HSTS_ENABLED = os.environ.get(
    "UCHIHA_HSTS_ENABLED",
    "1" if PUBLIC_HTTPS_REQUIRED else "0",
).strip() == "1"
HSTS_MAX_AGE_SECONDS = max(300, min(int(os.environ.get("UCHIHA_HSTS_MAX_AGE", "31536000")), 63072000))
HSTS_INCLUDE_SUBDOMAINS = os.environ.get("UCHIHA_HSTS_INCLUDE_SUBDOMAINS", "0").strip() == "1"
HSTS_PRELOAD = os.environ.get("UCHIHA_HSTS_PRELOAD", "0").strip() == "1"

ADAPTER_MODE = os.environ.get("UCHIHA_CONNECTOR_ADAPTER", "preview").strip().lower()
RADIUS_HOST = os.environ.get("UCHIHA_RADIUS_HOST", "").strip()
RADIUS_AUTH_PORT = int(os.environ.get("UCHIHA_RADIUS_AUTH_PORT", "1812"))
RADIUS_ACCT_PORT = int(os.environ.get("UCHIHA_RADIUS_ACCT_PORT", "1813"))
RADIUS_SECRET = os.environ.get("UCHIHA_RADIUS_SECRET", "")
MIKROTIK_BASE_URL = os.environ.get("UCHIHA_MIKROTIK_BASE_URL", "").strip()
MIKROTIK_TOKEN = os.environ.get("UCHIHA_MIKROTIK_TOKEN", "")
PRODUCTION_SITE = os.environ.get("UCHIHA_PRODUCTION_SITE", "").strip()
ENABLE_LIVE = os.environ.get("UCHIHA_CONNECTOR_ENABLE_LIVE", "0").strip() == "1"
PROBE_TIMEOUT_SECONDS = max(0.2, min(float(os.environ.get("UCHIHA_CONNECTOR_PROBE_TIMEOUT", "1.5")), 10.0))
PROBE_MAX_AGE_SECONDS = max(30, int(os.environ.get("UCHIHA_CONNECTOR_PROBE_MAX_AGE", "300")))
REQUIRE_CONNECTIVITY_PREFLIGHT = os.environ.get("UCHIHA_REQUIRE_CONNECTIVITY_PREFLIGHT", "1").strip() != "0"
RADIUS_PROBE_MODE = os.environ.get("UCHIHA_RADIUS_PROBE_MODE", "tcp").strip().lower()
ALLOW_INSECURE_MIKROTIK = os.environ.get("UCHIHA_CONNECTOR_ALLOW_INSECURE_MIKROTIK", "0").strip() == "1"
QUEUE_WORKER_ENABLED = os.environ.get("UCHIHA_QUEUE_WORKER_ENABLED", "1").strip() != "0"
QUEUE_POLL_SECONDS = max(0.05, min(float(os.environ.get("UCHIHA_QUEUE_POLL_SECONDS", "0.20")), 5.0))
QUEUE_MAX_ATTEMPTS = max(1, min(int(os.environ.get("UCHIHA_QUEUE_MAX_ATTEMPTS", "3")), 10))
QUEUE_RETRY_BASE_SECONDS = max(0.05, min(float(os.environ.get("UCHIHA_QUEUE_RETRY_BASE_SECONDS", "0.50")), 30.0))
QUEUE_RESULT_TTL_SECONDS = max(300, int(os.environ.get("UCHIHA_QUEUE_RESULT_TTL_SECONDS", "86400")))
QUEUE_STALE_RUNNING_SECONDS = max(5, int(os.environ.get("UCHIHA_QUEUE_STALE_RUNNING_SECONDS", "60")))
QUEUE_BACKLOG_WARNING = max(1, int(os.environ.get("UCHIHA_QUEUE_BACKLOG_WARNING", "50")))
QUEUE_CLEANUP_MIN_AGE_SECONDS = max(60, int(os.environ.get("UCHIHA_QUEUE_CLEANUP_MIN_AGE_SECONDS", "3600")))
LIVE_ACK = os.environ.get("UCHIHA_CONNECTOR_LIVE_ACK", "").strip()
LIVE_ACK_REQUIRED = "I_UNDERSTAND_LIVE_NETWORK_COMMANDS"
LIVE_DRIVER = os.environ.get("UCHIHA_CONNECTOR_LIVE_DRIVER", "mikrotik-gateway").strip().lower()
LIVE_TIMEOUT_SECONDS = max(0.5, min(float(os.environ.get("UCHIHA_CONNECTOR_LIVE_TIMEOUT", "4.0")), 15.0))
MIKROTIK_SESSION_PATH = os.environ.get("UCHIHA_MIKROTIK_SESSION_PATH", "/api/radius/session-command").strip() or "/api/radius/session-command"
MIKROTIK_NODE_PATH = os.environ.get("UCHIHA_MIKROTIK_NODE_PATH", "/api/radius/node-status").strip() or "/api/radius/node-status"
VOUCHER_PROVISION_ENABLE = os.environ.get("UCHIHA_VOUCHER_PROVISION_ENABLE", "0").strip() == "1"
VOUCHER_PROVISION_ACK = os.environ.get("UCHIHA_VOUCHER_PROVISION_ACK", "").strip()
VOUCHER_PROVISION_ACK_REQUIRED = "I_UNDERSTAND_VOUCHER_PROVISIONING"
VOUCHER_GATEWAY_URL = os.environ.get("UCHIHA_VOUCHER_GATEWAY_URL", "").strip().rstrip("/")
VOUCHER_GATEWAY_TOKEN = os.environ.get("UCHIHA_VOUCHER_GATEWAY_TOKEN", "")
VOUCHER_GATEWAY_PATH = os.environ.get("UCHIHA_VOUCHER_GATEWAY_PATH", "/api/vouchers/batches").strip() or "/api/vouchers/batches"
VOUCHER_TIMEOUT_SECONDS = max(0.5, min(float(os.environ.get("UCHIHA_VOUCHER_TIMEOUT", os.environ.get("UCHIHA_VOUCHER_GATEWAY_TIMEOUT", "4.0"))), 15.0))
VOUCHER_MAX_BATCH = max(1, min(int(os.environ.get("UCHIHA_VOUCHER_MAX_BATCH", "500")), 5000))
VOUCHER_ALLOW_INSECURE = os.environ.get("UCHIHA_VOUCHER_ALLOW_INSECURE", "0").strip() == "1"
_VOUCHER_LOCK = threading.Lock()
DIRECT_RADIUS_ENABLE = os.environ.get("UCHIHA_RADIUS_COA_ENABLE", "0").strip() == "1"
DIRECT_RADIUS_ACK = os.environ.get("UCHIHA_RADIUS_COA_ACK", "").strip()
DIRECT_RADIUS_ACK_REQUIRED = "I_UNDERSTAND_DIRECT_RADIUS_DISCONNECT"
DIRECT_RADIUS_BIN = os.environ.get("UCHIHA_RADIUS_COA_BIN", "radclient").strip() or "radclient"
DIRECT_RADIUS_PORT = int(os.environ.get("UCHIHA_RADIUS_COA_PORT", "3799"))
DIRECT_RADIUS_TIMEOUT_SECONDS = max(0.5, min(float(os.environ.get("UCHIHA_RADIUS_COA_TIMEOUT", "4.0")), 15.0))
DIRECT_RADIUS_SECRET = os.environ.get("UCHIHA_RADIUS_COA_SECRET", "")
DIRECT_RADIUS_ALLOWED_HOSTS = {
    x.strip().lower()
    for x in os.environ.get("UCHIHA_RADIUS_COA_ALLOWED_HOSTS", "").split(",")
    if x.strip()
}
BACKUP_DIR = Path(os.environ.get("UCHIHA_BACKUP_DIR", str(BASE_DIR / "backups")))
BACKUP_RETENTION = max(1, min(int(os.environ.get("UCHIHA_BACKUP_RETENTION", "12")), 200))
OFFHOST_BACKUP_ENABLE = os.environ.get("UCHIHA_BACKUP_OFFHOST_ENABLE", "0").strip() == "1"
OFFHOST_BACKUP_ACK = os.environ.get("UCHIHA_BACKUP_OFFHOST_ACK", "").strip()
OFFHOST_BACKUP_ACK_REQUIRED = "I_UNDERSTAND_OFFHOST_BACKUP_REPLICATION"
OFFHOST_BACKUP_GATEWAY_URL = os.environ.get("UCHIHA_BACKUP_OFFHOST_GATEWAY_URL", "").strip().rstrip("/")
OFFHOST_BACKUP_GATEWAY_TOKEN = os.environ.get("UCHIHA_BACKUP_OFFHOST_GATEWAY_TOKEN", "")
OFFHOST_BACKUP_GATEWAY_PATH = os.environ.get("UCHIHA_BACKUP_OFFHOST_GATEWAY_PATH", "/api/backups/objects").strip() or "/api/backups/objects"
OFFHOST_BACKUP_TIMEOUT_SECONDS = max(1.0, min(float(os.environ.get("UCHIHA_BACKUP_OFFHOST_TIMEOUT", "15")), 120.0))
OFFHOST_BACKUP_ALLOW_INSECURE = os.environ.get("UCHIHA_BACKUP_OFFHOST_ALLOW_INSECURE", "0").strip() == "1"
OFFHOST_BACKUP_AUTO_REPLICATE = os.environ.get("UCHIHA_BACKUP_OFFHOST_AUTO_REPLICATE", "0").strip() == "1"
_OFFHOST_BACKUP_LOCK = threading.Lock()
BACKUP_NAME_RE = re.compile(r"^uchiha-radius-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9_-]{6,32}\.sqlite3$")
RESTORE_DRILL_REQUIRED_TABLES = set(DATABASE_SCHEMA_REQUIRED_COLUMNS.keys())
MAINTENANCE_MODE = os.environ.get("UCHIHA_MAINTENANCE_MODE", "0").strip() == "1"
MAINTENANCE_REASON = os.environ.get("UCHIHA_MAINTENANCE_REASON", "").strip()[:160]
_RUNTIME_CONTROL_LOCK = threading.Lock()
_RUNTIME_MAINTENANCE_ENABLED = False
_RUNTIME_MAINTENANCE_REASON = ""
_RUNTIME_MAINTENANCE_UPDATED_AT: str | None = None
_RUNTIME_MAINTENANCE_UPDATED_BY: str | None = None
DRAIN_MAX_WAIT_SECONDS = max(1.0, min(float(os.environ.get("UCHIHA_DRAIN_MAX_WAIT_SECONDS", "30")), 300.0))
DRAIN_POLL_SECONDS = max(0.02, min(float(os.environ.get("UCHIHA_DRAIN_POLL_SECONDS", "0.1")), 2.0))
GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS = max(1.0, min(float(os.environ.get("UCHIHA_GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS", "30")), 300.0))
GRACEFUL_SHUTDOWN_POLL_SECONDS = max(0.02, min(float(os.environ.get("UCHIHA_GRACEFUL_SHUTDOWN_POLL_SECONDS", "0.1")), 2.0))
_PROCESS_TERMINATING = threading.Event()
_PROCESS_LIFECYCLE_LOCK = threading.Lock()
_PROCESS_TERMINATION_SIGNAL: str | None = None
_PROCESS_TERMINATION_REQUESTED_AT: str | None = None
_PROCESS_TERMINATION_DRAINED = False
_PROCESS_TERMINATION_TIMED_OUT = False
_PROCESS_TERMINATION_COMPLETED_AT: str | None = None
_SHUTDOWN_THREAD: threading.Thread | None = None
_HTTPD: ThreadingHTTPServer | None = None
_PROCESS_STARTED_AT = time.time()
_PROCESS_STARTED_ISO = datetime.fromtimestamp(_PROCESS_STARTED_AT, tz=timezone.utc).isoformat()
METRICS_PUBLIC = os.environ.get("UCHIHA_METRICS_PUBLIC", "0").strip() == "1"
ALERT_MONITOR_ENABLED = os.environ.get("UCHIHA_ALERT_MONITOR_ENABLED", "1").strip() != "0"
ALERT_POLL_SECONDS = max(0.25, min(float(os.environ.get("UCHIHA_ALERT_POLL_SECONDS", "15")), 3600.0))
ALERT_BACKUP_MAX_AGE_SECONDS = max(60, int(os.environ.get("UCHIHA_ALERT_BACKUP_MAX_AGE_SECONDS", "86400")))
ALERT_DRILL_MAX_AGE_SECONDS = max(60, int(os.environ.get("UCHIHA_ALERT_DRILL_MAX_AGE_SECONDS", "604800")))
ALERT_HTTP_5XX_THRESHOLD = max(1, int(os.environ.get("UCHIHA_ALERT_HTTP_5XX_THRESHOLD", "5")))
ALERT_FAILED_COMMAND_THRESHOLD = max(1, int(os.environ.get("UCHIHA_ALERT_FAILED_COMMAND_THRESHOLD", "1")))
TELEGRAM_ALERTS_ENABLED = os.environ.get("UCHIHA_TELEGRAM_ALERTS_ENABLED", "0").strip() == "1"
TELEGRAM_BOT_TOKEN = os.environ.get("UCHIHA_TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("UCHIHA_TELEGRAM_CHAT_ID", "").strip()
TELEGRAM_API_BASE_URL = os.environ.get("UCHIHA_TELEGRAM_API_BASE_URL", "https://api.telegram.org").strip().rstrip("/")
TELEGRAM_ALLOW_INSECURE = os.environ.get("UCHIHA_TELEGRAM_ALLOW_INSECURE", "0").strip() == "1"
TELEGRAM_ALERT_MIN_SEVERITY = os.environ.get("UCHIHA_TELEGRAM_ALERT_MIN_SEVERITY", "warning").strip().lower()
TELEGRAM_NOTIFY_RESOLVED = os.environ.get("UCHIHA_TELEGRAM_NOTIFY_RESOLVED", "1").strip() != "0"
TELEGRAM_TIMEOUT_SECONDS = max(0.5, min(float(os.environ.get("UCHIHA_TELEGRAM_TIMEOUT", "4.0")), 15.0))
TELEGRAM_DELIVERY_WORKER_ENABLED = os.environ.get("UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED", "1").strip() != "0"
TELEGRAM_DELIVERY_POLL_SECONDS = max(0.05, min(float(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_POLL_SECONDS", "0.5")), 30.0))
TELEGRAM_DELIVERY_MAX_ATTEMPTS = max(1, min(int(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_MAX_ATTEMPTS", "5")), 20))
TELEGRAM_DELIVERY_RETRY_BASE_SECONDS = max(0.05, min(float(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_RETRY_BASE_SECONDS", "2.0")), 300.0))
TELEGRAM_DELIVERY_MIN_INTERVAL_SECONDS = max(0.0, min(float(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_MIN_INTERVAL_SECONDS", "0.25")), 10.0))
TELEGRAM_DELIVERY_STALE_RUNNING_SECONDS = max(5, int(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_STALE_RUNNING_SECONDS", "60")))
TELEGRAM_DELIVERY_BACKLOG_WARNING = max(1, int(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_BACKLOG_WARNING", "100")))
TELEGRAM_DELIVERY_SENT_RETENTION_SECONDS = max(60, int(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_SENT_RETENTION_SECONDS", "604800")))
TELEGRAM_DELIVERY_DEAD_RETENTION_SECONDS = max(60, int(os.environ.get("UCHIHA_TELEGRAM_DELIVERY_DEAD_RETENTION_SECONDS", "2592000")))

_DB_LOCK = threading.RLock()
_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
_METRICS_LOCK = threading.Lock()
_HTTP_METRICS = {
    "requestsTotal": 0,
    "responseBytesTotal": 0,
    "latencyMsTotal": 0.0,
    "latencyMsMax": 0.0,
    "status": defaultdict(int),
    "methods": defaultdict(int),
    "routes": defaultdict(lambda: {"count": 0, "status": defaultdict(int), "latencyMsTotal": 0.0, "latencyMsMax": 0.0}),
}


def now_dt() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_dt().isoformat()


def clean(value, limit=256) -> str:
    value = "" if value is None else str(value)
    return value.strip()[:limit]


def stable_payload_hash(payload: dict) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()




def _host_storage_probe(directory: Path, label: str, *, deep: bool) -> dict:
    result = {
        "label": label,
        "path": str(directory),
        "exists": directory.exists(),
        "writable": False,
        "fsync": None,
        "atomicRename": None,
        "freeBytes": None,
        "freeGiB": None,
        "error": None,
    }
    try:
        directory.mkdir(parents=True, exist_ok=True)
        result["exists"] = directory.is_dir()
        result["writable"] = bool(os.access(directory, os.W_OK | os.X_OK))
        usage = shutil.disk_usage(directory)
        result["freeBytes"] = int(usage.free)
        result["freeGiB"] = round(usage.free / (1024 ** 3), 2)
        if deep and result["writable"]:
            token = secrets.token_hex(8)
            first = directory / f".uchiha-preflight-{token}.tmp"
            second = directory / f".uchiha-preflight-{token}.renamed"
            try:
                with first.open("wb") as fh:
                    fh.write(b"UCHIHA-RADIUS-HOST-PREFLIGHT\n")
                    fh.flush()
                    os.fsync(fh.fileno())
                result["fsync"] = True
                os.replace(first, second)
                result["atomicRename"] = second.exists() and not first.exists()
            finally:
                first.unlink(missing_ok=True)
                second.unlink(missing_ok=True)
    except Exception as exc:
        result["error"] = type(exc).__name__
        result["writable"] = False
    return result


def host_environment_readiness(*, deep: bool = False, refresh: bool = False) -> dict:
    global _HOST_PREFLIGHT_CACHE
    if not deep and not refresh and isinstance(_HOST_PREFLIGHT_CACHE, dict):
        return dict(_HOST_PREFLIGHT_CACHE)

    python_ok = sys.version_info >= (3, 10)
    sqlite_ok = sqlite3.sqlite_version_info >= (3, 35, 0)
    linux = bool(sys.platform.startswith("linux"))
    flock_supported = fcntl is not None
    db_storage = _host_storage_probe(DB_PATH.parent, "database", deep=deep)
    backup_storage = _host_storage_probe(BACKUP_DIR, "backup", deep=deep)

    blockers = []
    if not linux: blockers.append("host-linux-required")
    if not python_ok: blockers.append("host-python-version-unsupported")
    if not sqlite_ok: blockers.append("host-sqlite-version-unsupported")
    if not flock_supported: blockers.append("host-flock-unavailable")
    if not db_storage.get("writable"): blockers.append("database-directory-not-writable")
    if not backup_storage.get("writable"): blockers.append("backup-directory-not-writable")
    if int(db_storage.get("freeBytes") or 0) < HOST_MIN_FREE_BYTES:
        blockers.append("database-filesystem-low-space")
    if int(backup_storage.get("freeBytes") or 0) < HOST_MIN_FREE_BYTES:
        blockers.append("backup-filesystem-low-space")
    if deep:
        if db_storage.get("fsync") is not True: blockers.append("database-fsync-probe-failed")
        if db_storage.get("atomicRename") is not True: blockers.append("database-atomic-rename-probe-failed")
        if backup_storage.get("fsync") is not True: blockers.append("backup-fsync-probe-failed")
        if backup_storage.get("atomicRename") is not True: blockers.append("backup-atomic-rename-probe-failed")

    state = {
        "supported": True,
        "required": HOST_PREFLIGHT_REQUIRED,
        "ready": not blockers,
        "deepProbe": bool(deep),
        "linux": linux,
        "platform": sys.platform,
        "pythonVersion": ".".join(map(str, sys.version_info[:3])),
        "pythonSupported": python_ok,
        "sqliteVersion": sqlite3.sqlite_version,
        "sqliteSupported": sqlite_ok,
        "sqliteThreadSafety": int(sqlite3.threadsafety),
        "flockSupported": flock_supported,
        "databaseDirectoryWritable": bool(db_storage.get("writable")),
        "backupDirectoryWritable": bool(backup_storage.get("writable")),
        "databaseFreeBytes": db_storage.get("freeBytes"),
        "databaseFreeGiB": db_storage.get("freeGiB"),
        "backupFreeBytes": backup_storage.get("freeBytes"),
        "backupFreeGiB": backup_storage.get("freeGiB"),
        "minimumFreeBytes": HOST_MIN_FREE_BYTES,
        "databaseFsync": db_storage.get("fsync"),
        "databaseAtomicRename": db_storage.get("atomicRename"),
        "backupFsync": backup_storage.get("fsync"),
        "backupAtomicRename": backup_storage.get("atomicRename"),
        "blockers": blockers,
        "networkCallsPerformed": False,
        "serverSocketBound": False,
        "secretsExposed": False,
        "checkedAt": now_iso(),
    }
    if deep:
        _HOST_PREFLIGHT_CACHE = dict(state)
    return state


def validate_host_environment() -> dict:
    state = host_environment_readiness(deep=True, refresh=True)
    if HOST_PREFLIGHT_REQUIRED and not state.get("ready"):
        raise RuntimeError("host preflight failed: " + ",".join(state.get("blockers") or []))
    return state


def _instance_lock_metadata_from_handle(handle) -> dict | None:
    try:
        handle.seek(0); raw = handle.read().strip()
        if not raw: return None
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def instance_lock_readiness(*, probe: bool = False) -> dict:
    supported = fcntl is not None
    held = bool(_INSTANCE_LOCK_HELD and _INSTANCE_LOCK_HANDLE is not None)
    available = held; owner = None; probe_error = None
    if probe and supported and not held:
        try:
            INSTANCE_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
            with INSTANCE_LOCK_PATH.open("a+", encoding="utf-8") as handle:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    available = True
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                except BlockingIOError:
                    available = False; owner = _instance_lock_metadata_from_handle(handle)
        except Exception as exc:
            available = False; probe_error = type(exc).__name__
    return {"supported": supported, "required": INSTANCE_LOCK_REQUIRED,
        "ready": bool((not INSTANCE_LOCK_REQUIRED) or (supported and (held or (probe and available)))),
        "held": held, "available": available if probe or held else None, "path": str(INSTANCE_LOCK_PATH),
        "databasePath": str(DB_PATH), "ownerPid": _INSTANCE_LOCK_OWNER_PID if held else (owner or {}).get("pid"),
        "ownerBackendBuild": BACKEND_BUILD if held else (owner or {}).get("backendBuild"),
        "acquiredAt": _INSTANCE_LOCK_ACQUIRED_AT if held else (owner or {}).get("acquiredAt"),
        "probeError": probe_error, "staleFileSafe": True, "kernelReleasedOnProcessExit": supported, "secretsExposed": False}


def acquire_instance_lock() -> None:
    global _INSTANCE_LOCK_HANDLE, _INSTANCE_LOCK_HELD, _INSTANCE_LOCK_ACQUIRED_AT, _INSTANCE_LOCK_OWNER_PID
    if not INSTANCE_LOCK_REQUIRED: return
    if fcntl is None: raise RuntimeError("single-instance database lock requires Linux fcntl")
    if _INSTANCE_LOCK_HELD: return
    INSTANCE_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    handle = INSTANCE_LOCK_PATH.open("a+", encoding="utf-8")
    try: fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        owner = _instance_lock_metadata_from_handle(handle) or {}; handle.close()
        raise RuntimeError("database instance lock is already held" + (f" by pid {owner.get('pid')}" if owner.get("pid") else "") + (f" ({owner.get('backendBuild')})" if owner.get("backendBuild") else "") + f": {INSTANCE_LOCK_PATH}")
    acquired_at = now_iso()
    meta={"pid":os.getpid(),"backendBuild":BACKEND_BUILD,"uiBuild":UI_BUILD,"databasePath":str(DB_PATH),"acquiredAt":acquired_at}
    handle.seek(0); handle.truncate(); handle.write(json.dumps(meta,ensure_ascii=False,sort_keys=True)); handle.flush()
    try: os.fsync(handle.fileno()); os.chmod(INSTANCE_LOCK_PATH,0o600)
    except OSError: pass
    _INSTANCE_LOCK_HANDLE=handle; _INSTANCE_LOCK_HELD=True; _INSTANCE_LOCK_ACQUIRED_AT=acquired_at; _INSTANCE_LOCK_OWNER_PID=os.getpid()


def release_instance_lock() -> None:
    global _INSTANCE_LOCK_HANDLE, _INSTANCE_LOCK_HELD, _INSTANCE_LOCK_ACQUIRED_AT, _INSTANCE_LOCK_OWNER_PID
    handle=_INSTANCE_LOCK_HANDLE
    if handle is not None:
        try:
            if fcntl is not None: fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally: handle.close()
    _INSTANCE_LOCK_HANDLE=None; _INSTANCE_LOCK_HELD=False; _INSTANCE_LOCK_ACQUIRED_AT=None; _INSTANCE_LOCK_OWNER_PID=None


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _DB_LOCK, db_connect() as conn:
        previous_schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if previous_schema_version > DATABASE_SCHEMA_VERSION:
            raise RuntimeError(
                f"database schema version {previous_schema_version} is newer than supported {DATABASE_SCHEMA_VERSION}; "
                "refusing to start with an older backend"
            )
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS connector_requests (
            request_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            operation TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            request_json TEXT NOT NULL,
            response_json TEXT NOT NULL,
            http_status INTEGER NOT NULL,
            adapter TEXT NOT NULL,
            actor TEXT NOT NULL DEFAULT 'unknown',
            role TEXT NOT NULL DEFAULT 'unknown',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_connector_requests_created_at
        ON connector_requests(created_at DESC);

        CREATE TABLE IF NOT EXISTS auth_sessions (
            session_id TEXT PRIMARY KEY,
            csrf_token TEXT NOT NULL,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
        ON auth_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS operator_accounts (
            username TEXT PRIMARY KEY,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT,
            password_changed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_operator_accounts_enabled_role
        ON operator_accounts(enabled, role, username);

        CREATE TABLE IF NOT EXISTS audit_events (
            event_id TEXT PRIMARY KEY,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            action TEXT NOT NULL,
            outcome TEXT NOT NULL,
            request_id TEXT,
            trace_id TEXT,
            correlation_id TEXT,
            detail_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
        ON audit_events(created_at DESC);

        CREATE TABLE IF NOT EXISTS connectivity_checks (
            check_id TEXT PRIMARY KEY,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            result_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_connectivity_checks_created_at
        ON connectivity_checks(created_at DESC);

        CREATE TABLE IF NOT EXISTS connector_commands (
            command_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            correlation_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            operation TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            adapter TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            next_attempt_at TEXT,
            result_json TEXT,
            error_json TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_connector_commands_status_next
        ON connector_commands(status, next_attempt_at, created_at);

        CREATE INDEX IF NOT EXISTS idx_connector_commands_created_at
        ON connector_commands(created_at DESC);

        CREATE TABLE IF NOT EXISTS backup_restore_drills (
            drill_id TEXT PRIMARY KEY,
            backup_name TEXT NOT NULL,
            backup_sha256 TEXT NOT NULL,
            status TEXT NOT NULL,
            integrity_verified INTEGER NOT NULL,
            required_tables_json TEXT NOT NULL,
            missing_tables_json TEXT NOT NULL,
            source_bytes INTEGER NOT NULL,
            restored_bytes INTEGER NOT NULL,
            elapsed_ms REAL NOT NULL,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_backup_restore_drills_completed_at
        ON backup_restore_drills(completed_at DESC);

        CREATE TABLE IF NOT EXISTS backup_replications (
            replication_id TEXT PRIMARY KEY,
            backup_name TEXT NOT NULL,
            backup_sha256 TEXT NOT NULL,
            backup_bytes INTEGER NOT NULL,
            status TEXT NOT NULL,
            receipt_id TEXT,
            remote_object_id TEXT,
            remote_sha256 TEXT,
            remote_bytes INTEGER,
            gateway_http_status INTEGER,
            gateway_latency_ms REAL,
            error_code TEXT,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_backup_replications_backup
        ON backup_replications(backup_sha256, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_backup_replications_created
        ON backup_replications(created_at DESC);

        CREATE TABLE IF NOT EXISTS log_delivery_outbox (
            log_id TEXT PRIMARY KEY,
            event_name TEXT NOT NULL,
            level TEXT NOT NULL,
            trace_id TEXT,
            correlation_id TEXT,
            record_json TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL,
            next_attempt_at TEXT,
            last_error_code TEXT,
            remote_receipt_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            sent_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_log_delivery_outbox_due
        ON log_delivery_outbox(status, next_attempt_at, created_at);

        CREATE INDEX IF NOT EXISTS idx_log_delivery_outbox_trace
        ON log_delivery_outbox(trace_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS operational_alerts (
            alert_id TEXT PRIMARY KEY,
            alert_key TEXT NOT NULL UNIQUE,
            severity TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT NOT NULL,
            status TEXT NOT NULL,
            occurrence_count INTEGER NOT NULL DEFAULT 1,
            metadata_json TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            acknowledged_at TEXT,
            acknowledged_by TEXT,
            resolved_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_operational_alerts_status_severity
        ON operational_alerts(status, severity, last_seen_at DESC);

        CREATE TABLE IF NOT EXISTS operational_alert_deliveries (
            delivery_id TEXT PRIMARY KEY,
            alert_id TEXT NOT NULL,
            alert_key TEXT NOT NULL,
            event_type TEXT NOT NULL,
            channel TEXT NOT NULL,
            status TEXT NOT NULL,
            http_status INTEGER,
            latency_ms REAL,
            error_code TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_operational_alert_deliveries_created
        ON operational_alert_deliveries(created_at DESC);

        CREATE TABLE IF NOT EXISTS operational_alert_outbox (
            outbox_id TEXT PRIMARY KEY,
            dedup_key TEXT NOT NULL UNIQUE,
            alert_id TEXT NOT NULL,
            alert_key TEXT NOT NULL,
            event_type TEXT NOT NULL,
            channel TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL,
            next_attempt_at TEXT,
            last_error_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            sent_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_operational_alert_outbox_due
        ON operational_alert_outbox(status, next_attempt_at, created_at);

        CREATE INDEX IF NOT EXISTS idx_operational_alert_outbox_alert
        ON operational_alert_outbox(alert_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS runtime_control (
            control_key TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL,
            reason TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL
        );

        INSERT OR IGNORE INTO runtime_control(
            control_key, enabled, reason, updated_at, updated_by
        ) VALUES ('maintenance', 0, '', CURRENT_TIMESTAMP, 'system');

        CREATE TABLE IF NOT EXISTS deployment_checkpoints (
            checkpoint_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            safe_for_deployment INTEGER NOT NULL,
            reason TEXT NOT NULL,
            maintenance_source TEXT NOT NULL,
            drain_json TEXT NOT NULL,
            backup_name TEXT,
            backup_sha256 TEXT,
            restore_drill_id TEXT,
            restore_drill_passed INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            elapsed_ms REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_deployment_checkpoints_completed
        ON deployment_checkpoints(completed_at DESC);

        CREATE TABLE IF NOT EXISTS deployment_verifications (
            verification_id TEXT PRIMARY KEY,
            checkpoint_id TEXT NOT NULL,
            status TEXT NOT NULL,
            passed INTEGER NOT NULL,
            resume_requested INTEGER NOT NULL,
            resumed INTEGER NOT NULL,
            resume_blocked_by_environment INTEGER NOT NULL,
            expected_backend_build TEXT NOT NULL,
            expected_ui_build TEXT NOT NULL,
            observed_backend_build TEXT NOT NULL,
            observed_ui_build TEXT NOT NULL,
            ui_file_present INTEGER NOT NULL,
            checkpoint_safe INTEGER NOT NULL,
            maintenance_enabled INTEGER NOT NULL,
            drain_drained INTEGER NOT NULL,
            database_ready INTEGER NOT NULL,
            queue_health TEXT NOT NULL,
            queue_running INTEGER NOT NULL,
            adapter_ready INTEGER NOT NULL,
            connectivity_check_id TEXT,
            connectivity_reachable INTEGER NOT NULL,
            backup_integrity_verified INTEGER NOT NULL,
            backup_hash_matches INTEGER NOT NULL,
            blockers_json TEXT NOT NULL,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            elapsed_ms REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_deployment_verifications_completed
        ON deployment_verifications(completed_at DESC);

        CREATE TABLE IF NOT EXISTS voucher_provision_batches (
            batch_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            payload_hash TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            validity TEXT NOT NULL,
            status TEXT NOT NULL,
            receipt_id TEXT,
            external_reference TEXT,
            provisioned_count INTEGER NOT NULL DEFAULT 0,
            gateway_http_status INTEGER,
            gateway_latency_ms REAL,
            error_code TEXT,
            actor TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_voucher_provision_batches_created
        ON voucher_provision_batches(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_voucher_provision_batches_status
        ON voucher_provision_batches(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS gateway_auth_nonces (
            nonce TEXT PRIMARY KEY,
            key_id TEXT NOT NULL,
            actor TEXT NOT NULL,
            used_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            trace_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_gateway_auth_nonces_expires
        ON gateway_auth_nonces(expires_at);

        CREATE TABLE IF NOT EXISTS schema_migrations (
            migration_id TEXT PRIMARY KEY,
            source_version INTEGER NOT NULL,
            target_version INTEGER NOT NULL,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL,
            backend_build TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_schema_migrations_target
        ON schema_migrations(target_version, applied_at DESC);
        """)
        # Safe migration from v2 DB if table already existed without actor/role.
        columns = {row[1] for row in conn.execute("PRAGMA table_info(connector_requests)").fetchall()}
        if "actor" not in columns:
            conn.execute("ALTER TABLE connector_requests ADD COLUMN actor TEXT NOT NULL DEFAULT 'unknown'")
        if "role" not in columns:
            conn.execute("ALTER TABLE connector_requests ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'")

        audit_columns = {row["name"] for row in conn.execute("PRAGMA table_info(audit_events)").fetchall()}
        if "trace_id" not in audit_columns:
            conn.execute("ALTER TABLE audit_events ADD COLUMN trace_id TEXT")
        if "correlation_id" not in audit_columns:
            conn.execute("ALTER TABLE audit_events ADD COLUMN correlation_id TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_trace_id ON audit_events(trace_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_correlation_id ON audit_events(correlation_id, created_at DESC)")

        # v24 formalizes the schema contract. Existing idempotent DDL above upgrades
        # legacy databases; promotion happens only after the complete structure validates.
        missing_schema = _schema_missing_conn(conn)
        if missing_schema:
            raise RuntimeError("database schema validation failed: " + "; ".join(missing_schema))
        if previous_schema_version < DATABASE_SCHEMA_VERSION:
            migration_id = f"schema-{previous_schema_version}-to-{DATABASE_SCHEMA_VERSION}"
            conn.execute(
                """INSERT OR IGNORE INTO schema_migrations(
                    migration_id, source_version, target_version, description, applied_at, backend_build
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    migration_id,
                    previous_schema_version,
                    DATABASE_SCHEMA_VERSION,
                    "Adopt validated UCHIHA RADIUS schema contract",
                    now_iso(),
                    BACKEND_BUILD,
                ),
            )
            conn.execute(f"PRAGMA user_version = {DATABASE_SCHEMA_VERSION}")

        # Recover commands that were claimed before a process restart.
        conn.execute(
            """UPDATE connector_commands
               SET status='queued', next_attempt_at=?, started_at=NULL, updated_at=?
               WHERE status='running'""",
            (now_iso(), now_iso()),
        )

        # Recover alert deliveries that were claimed before a process restart.
        conn.execute(
            """UPDATE operational_alert_outbox
               SET status='retry', next_attempt_at=?, last_error_code='recovered_after_restart',
                   updated_at=?
               WHERE status='running'""",
            (now_iso(), now_iso()),
        )

        # Recover remote log deliveries claimed before a process restart.
        conn.execute(
            """UPDATE log_delivery_outbox
               SET status='retry', next_attempt_at=?, last_error_code='recovered_after_restart',
                   updated_at=?
               WHERE status='running'""",
            (now_iso(), now_iso()),
        )



_LOG_LEVEL_ORDER = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}
_LOG_SENSITIVE_EXACT = {
    "authorization", "cookie", "set-cookie", "csrf", "csrf_token", "csrftoken",
    "password", "secret", "token", "api_key", "apikey", "gateway_key",
    "session_id", "sessionid", "credential", "credentials", "codes", "vouchercodes",
}


def _valid_trace_id(value) -> str | None:
    value = clean(value, 128)
    return value if value and TRACE_ID_RE.fullmatch(value) else None


def _new_trace_id(prefix: str = "HTTP") -> str:
    return f"{prefix}-" + secrets.token_urlsafe(12)


def _redact_log_value(value, key: str | None = None, depth: int = 0):
    if depth > 6:
        return "[TRUNCATED]"
    normalized = re.sub(r"[^a-z0-9]", "", str(key or "").lower())
    if (
        normalized in {re.sub(r"[^a-z0-9]", "", x) for x in _LOG_SENSITIVE_EXACT}
        or normalized.endswith(("token", "secret", "password", "credential"))
        or normalized in {"authorizationheader", "cookieheader"}
    ):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k)[:80]: _redact_log_value(v, str(k), depth+1) for k,v in list(value.items())[:80]}
    if isinstance(value, (list, tuple, set)):
        return [_redact_log_value(v, key, depth+1) for v in list(value)[:80]]
    if isinstance(value, str):
        return value[:1000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return clean(value, 1000)


def structured_log(
    event: str, level: str = "INFO", *, trace_id=None, correlation_id=None,
    ship: bool = True, **fields
) -> None:
    level = level.upper() if level else "INFO"
    if _LOG_LEVEL_ORDER.get(level, 20) < _LOG_LEVEL_ORDER.get(LOG_LEVEL, 20):
        return
    trace = _valid_trace_id(trace_id) or _TRACE_ID_CTX.get()
    correlation = _valid_trace_id(correlation_id) or _CORRELATION_ID_CTX.get()
    record = {
        "timestamp": now_iso(),
        "level": level,
        "service": "uchiha-radius-connector",
        "event": clean(event, 128) or "event",
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "traceId": trace,
        "correlationId": correlation,
    }
    for key,value in fields.items():
        record[str(key)[:80]] = _redact_log_value(value, str(key))
    if LOG_FORMAT == "text":
        extras = " ".join(f"{k}={record[k]}" for k in sorted(record) if k not in {"timestamp","level","service","event"})
        print(f"{record['timestamp']} {record['level']} {record['service']} {record['event']} {extras}", flush=True)
    else:
        print(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")), flush=True)
    if ship and REMOTE_LOG_ENABLE:
        try:
            _enqueue_remote_log(record)
        except Exception:
            # Logging must never make the primary service unavailable.
            pass


class ContractError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.status = status
        self.code = code


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401, code: str = "authentication_required"):
        super().__init__(message)
        self.status = status
        self.code = code


def error_envelope(code: str, message: str, status: int, request_id: str | None = None) -> dict:
    return {
        "ok": False,
        "contractVersion": CONTRACT_VERSION,
        "error": {"code": code, "message": message, "httpStatus": status},
        "requestId": request_id,
        "serverTime": now_iso(),
    }


def is_loopback(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def audit(
    actor: str, role: str, action: str, outcome: str, *,
    request_id=None, trace_id=None, correlation_id=None, detail=None
) -> None:
    event_id = "AUD-" + secrets.token_urlsafe(12)
    payload = _redact_log_value(detail if isinstance(detail, dict) else {})
    trace = _valid_trace_id(trace_id) or _TRACE_ID_CTX.get()
    correlation = _valid_trace_id(correlation_id) or _CORRELATION_ID_CTX.get()
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO audit_events(
                event_id, actor, role, action, outcome, request_id,
                trace_id, correlation_id, detail_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event_id, actor, role, action, outcome, request_id,
                trace, correlation,
                json.dumps(payload, ensure_ascii=False, sort_keys=True), now_iso(),
            ),
        )


def audit_items(limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT event_id, actor, role, action, outcome, request_id,
                      trace_id, correlation_id, detail_json, created_at
               FROM audit_events ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [{
        "eventId": r["event_id"], "actor": r["actor"], "role": r["role"],
        "action": r["action"], "outcome": r["outcome"], "requestId": r["request_id"],
        "traceId": r["trace_id"], "correlationId": r["correlation_id"],
        "detail": json.loads(r["detail_json"]), "createdAt": r["created_at"],
    } for r in rows]


def cleanup_sessions() -> None:
    with _DB_LOCK, db_connect() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now_iso(),))


def create_session(actor: str, role: str, *, mode: str) -> dict:
    if role not in ALLOWED_ROLES:
        raise AuthError("session role is invalid", 403, "invalid_role")
    actor = clean(actor, 128)
    if not actor:
        raise AuthError("session actor is invalid", 400, "invalid_actor")
    sid = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    created = now_dt()
    expires = created + timedelta(seconds=SESSION_TTL_SECONDS)
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO auth_sessions(session_id, csrf_token, actor, role, created_at, expires_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (sid, csrf, actor, role, created.isoformat(), expires.isoformat(), created.isoformat()),
        )
    audit(actor, role, "auth.session.create", "success", detail={"mode": mode})
    return {"session_id": sid, "csrf_token": csrf, "actor": actor, "role": role, "expires_at": expires.isoformat()}


def _operator_normalize_username(value) -> str:
    username = clean(value, 64).lower()
    if not OPERATOR_USERNAME_RE.fullmatch(username):
        raise AuthError("operator username format is invalid", 400, "invalid_operator_username")
    return username


def _operator_password_material(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=OPERATOR_SCRYPT_N,
        r=OPERATOR_SCRYPT_R,
        p=OPERATOR_SCRYPT_P,
        dklen=32,
    )


def _operator_validate_password(password) -> str:
    if not isinstance(password, str):
        raise AuthError("operator password is required", 400, "invalid_operator_password")
    if len(password) < OPERATOR_PASSWORD_MIN_LENGTH or len(password) > 256:
        raise AuthError(
            f"operator password must be {OPERATOR_PASSWORD_MIN_LENGTH}-256 characters",
            400,
            "invalid_operator_password",
        )
    return password


def _operator_public_row(row) -> dict:
    return {
        "username": row["username"],
        "role": row["role"],
        "enabled": bool(row["enabled"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastLoginAt": row["last_login_at"],
        "passwordChangedAt": row["password_changed_at"],
        "passwordHashExposed": False,
    }


def operator_account(username: str) -> dict | None:
    username = clean(username, 64).lower()
    if not username:
        return None
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute("SELECT * FROM operator_accounts WHERE username=?", (username,)).fetchone()
    return dict(row) if row else None


def operator_accounts() -> list[dict]:
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT username, role, enabled, created_at, updated_at, last_login_at, password_changed_at
               FROM operator_accounts ORDER BY enabled DESC, role, username"""
        ).fetchall()
    return [_operator_public_row(row) for row in rows]


def _enabled_owner_count(conn) -> int:
    return int(conn.execute(
        "SELECT COUNT(*) FROM operator_accounts WHERE enabled=1 AND role='owner'"
    ).fetchone()[0])


def set_operator_account(
    username, role, enabled, password, identity: dict | None, *, bootstrap: bool = False
) -> dict:
    username = _operator_normalize_username(username)
    role = clean(role, 32)
    if role not in ALLOWED_ROLES:
        raise AuthError("operator role is invalid", 400, "invalid_role")
    if not isinstance(enabled, bool):
        raise AuthError("operator enabled must be boolean", 400, "invalid_operator_enabled")
    password_supplied = password is not None and password != ""
    if password_supplied:
        password = _operator_validate_password(password)

    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        current = conn.execute("SELECT * FROM operator_accounts WHERE username=?", (username,)).fetchone()
        if current is None and not password_supplied:
            raise AuthError("new operator account requires a password", 400, "operator_password_required")
        if current is not None and current["role"] == "owner" and bool(current["enabled"]):
            would_remove_owner = (not enabled) or role != "owner"
            if would_remove_owner and _enabled_owner_count(conn) <= 1:
                raise AuthError("cannot disable or demote the last enabled owner", 409, "last_owner_required")

        salt_hex = current["password_salt"] if current else None
        hash_hex = current["password_hash"] if current else None
        password_changed_at = current["password_changed_at"] if current else now
        if password_supplied:
            salt = secrets.token_bytes(16)
            salt_hex = salt.hex()
            hash_hex = _operator_password_material(password, salt).hex()
            password_changed_at = now

        if current is None:
            conn.execute(
                """INSERT INTO operator_accounts(
                    username,password_salt,password_hash,role,enabled,
                    created_at,updated_at,last_login_at,password_changed_at
                ) VALUES (?,?,?,?,?,?,?,?,?)""",
                (username,salt_hex,hash_hex,role,1 if enabled else 0,now,now,None,password_changed_at),
            )
        else:
            conn.execute(
                """UPDATE operator_accounts
                   SET password_salt=?,password_hash=?,role=?,enabled=?,updated_at=?,password_changed_at=?
                   WHERE username=?""",
                (salt_hex,hash_hex,role,1 if enabled else 0,now,password_changed_at,username),
            )
            if password_supplied or role != current["role"] or bool(current["enabled"]) != enabled:
                conn.execute("DELETE FROM auth_sessions WHERE actor=?", (username,))

        row = conn.execute(
            """SELECT username, role, enabled, created_at, updated_at, last_login_at, password_changed_at
               FROM operator_accounts WHERE username=?""",
            (username,),
        ).fetchone()

    actor = "bootstrap" if bootstrap else (identity or {}).get("actor", "unknown")
    actor_role = "owner" if bootstrap else (identity or {}).get("role", "unknown")
    audit(
        actor, actor_role, "operator-account.set", "success",
        detail={
            "username": username,
            "role": role,
            "enabled": enabled,
            "passwordChanged": bool(password_supplied),
            "bootstrap": bootstrap,
        },
    )
    return _operator_public_row(row)


def _operator_login_key(peer: str, username: str) -> str:
    return f"{_edge_rate_key(peer)}|{clean(username,64).lower()}"


def _operator_login_prune_locked(key: str, now_mono: float) -> deque:
    bucket = _OPERATOR_LOGIN_FAILURES.get(key, deque())
    cutoff = now_mono - OPERATOR_LOGIN_FAILURE_WINDOW_SECONDS
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()
    if bucket:
        _OPERATOR_LOGIN_FAILURES[key] = bucket
    else:
        _OPERATOR_LOGIN_FAILURES.pop(key, None)
    return bucket


def operator_login_rate_check(peer: str, username: str) -> None:
    key = _operator_login_key(peer, username)
    now_mono = time.monotonic()
    with _OPERATOR_LOGIN_LOCK:
        bucket = _operator_login_prune_locked(key, now_mono)
        if len(bucket) >= OPERATOR_LOGIN_FAILURE_LIMIT:
            raise AuthError("too many failed login attempts", 429, "operator_login_rate_limited")


def operator_login_record_failure(peer: str, username: str) -> None:
    key = _operator_login_key(peer, username)
    now_mono = time.monotonic()
    with _OPERATOR_LOGIN_LOCK:
        bucket = _operator_login_prune_locked(key, now_mono)
        bucket.append(now_mono)
        _OPERATOR_LOGIN_FAILURES[key] = bucket


def operator_login_clear_failures(peer: str, username: str) -> None:
    key = _operator_login_key(peer, username)
    with _OPERATOR_LOGIN_LOCK:
        _OPERATOR_LOGIN_FAILURES.pop(key, None)


def authenticate_operator(username, password, peer: str) -> dict:
    username_raw = clean(username, 64).lower()
    operator_login_rate_check(peer, username_raw)
    try:
        username_norm = _operator_normalize_username(username_raw)
    except AuthError:
        operator_login_record_failure(peer, username_raw)
        audit("unknown", "unknown", "auth.operator.login", "denied", detail={"reason": "invalid-credentials"})
        raise AuthError("invalid username or password", 401, "invalid_credentials")

    supplied_password = password if isinstance(password, str) else ""
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute("SELECT * FROM operator_accounts WHERE username=?", (username_norm,)).fetchone()

    if row:
        salt = bytes.fromhex(row["password_salt"])
        expected = bytes.fromhex(row["password_hash"])
    else:
        salt = bytes.fromhex("85e091eb7856b79b9137c38ea38a6d12")
        expected = bytes(32)
    try:
        actual = _operator_password_material(supplied_password, salt)
    except Exception:
        actual = bytes(32)

    valid = bool(row and row["enabled"] and hmac.compare_digest(actual, expected))
    if not valid:
        operator_login_record_failure(peer, username_norm)
        audit(username_norm or "unknown", "unknown", "auth.operator.login", "denied", detail={"reason": "invalid-credentials"})
        raise AuthError("invalid username or password", 401, "invalid_credentials")

    operator_login_clear_failures(peer, username_norm)
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            "UPDATE operator_accounts SET last_login_at=?, updated_at=? WHERE username=?",
            (now_iso(), now_iso(), username_norm),
        )
    session = create_session(username_norm, row["role"], mode="operator-session")
    audit(username_norm, row["role"], "auth.operator.login", "success", detail={"mode": AUTH_MODE})
    return session


def operator_session_readiness() -> dict:
    active = AUTH_MODE in {"operator-session", "hybrid"}
    enabled_accounts = 0
    enabled_owners = 0
    database_ready = False
    try:
        with db_connect() as conn:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            if "operator_accounts" in tables:
                database_ready = True
                enabled_accounts = int(conn.execute(
                    "SELECT COUNT(*) FROM operator_accounts WHERE enabled=1"
                ).fetchone()[0])
                enabled_owners = int(conn.execute(
                    "SELECT COUNT(*) FROM operator_accounts WHERE enabled=1 AND role='owner'"
                ).fetchone()[0])
    except Exception:
        database_ready = False

    bootstrap_configured = bool(OPERATOR_BOOTSTRAP_USERNAME and OPERATOR_BOOTSTRAP_PASSWORD_FILE)
    bootstrap_file = Path(OPERATOR_BOOTSTRAP_PASSWORD_FILE) if OPERATOR_BOOTSTRAP_PASSWORD_FILE else None
    bootstrap_file_present = bool(bootstrap_file and bootstrap_file.is_file())
    bootstrap_file_secure = False
    if bootstrap_file_present:
        try:
            bootstrap_file_secure = (stat.S_IMODE(bootstrap_file.stat().st_mode) & 0o077) == 0
        except OSError:
            bootstrap_file_secure = False
    bootstrap_ready = bool(
        bootstrap_configured
        and OPERATOR_USERNAME_RE.fullmatch(OPERATOR_BOOTSTRAP_USERNAME)
        and bootstrap_file_present
        and bootstrap_file_secure
    )
    ready = bool(not active or enabled_owners > 0 or bootstrap_ready)
    blockers = []
    if active and enabled_owners < 1 and not bootstrap_ready:
        blockers.append("operator-owner-required")
    if active and bootstrap_file_present and not bootstrap_file_secure and enabled_owners < 1:
        blockers.append("bootstrap-password-file-permissions")
    return {
        "supported": True,
        "active": active,
        "mode": AUTH_MODE,
        "ready": ready,
        "databaseReady": database_ready,
        "enabledAccounts": enabled_accounts,
        "enabledOwners": enabled_owners,
        "bootstrapConfigured": bootstrap_configured,
        "bootstrapReady": bootstrap_ready,
        "passwordKdf": f"scrypt-N{OPERATOR_SCRYPT_N_LOG2}-r{OPERATOR_SCRYPT_R}-p{OPERATOR_SCRYPT_P}",
        "passwordMinLength": OPERATOR_PASSWORD_MIN_LENGTH,
        "loginFailureLimit": OPERATOR_LOGIN_FAILURE_LIMIT,
        "loginFailureWindowSeconds": OPERATOR_LOGIN_FAILURE_WINDOW_SECONDS,
        "sessionTtlSeconds": SESSION_TTL_SECONDS,
        "sessionCookieSecure": COOKIE_SECURE_POLICY,
        "csrfRequired": True,
        "passwordHashesExposed": False,
        "secretsExposed": False,
        "blockers": blockers,
    }


def bootstrap_operator_owner() -> dict:
    state = operator_session_readiness()
    if not state["active"] or state["enabledOwners"] > 0:
        return state
    if not state["bootstrapReady"]:
        raise RuntimeError(
            "operator-session authentication requires an enabled owner account or a secure bootstrap password file"
        )
    password_file = Path(OPERATOR_BOOTSTRAP_PASSWORD_FILE)
    password = password_file.read_text(encoding="utf-8").rstrip("\r\n")
    _operator_validate_password(password)
    set_operator_account(
        OPERATOR_BOOTSTRAP_USERNAME,
        "owner",
        True,
        password,
        None,
        bootstrap=True,
    )
    return operator_session_readiness()


def validate_operator_session_runtime() -> None:
    state = operator_session_readiness()
    if state["active"] and not state["ready"]:
        raise RuntimeError("operator session authentication is not ready: " + ",".join(state["blockers"]))


def validate_operator_session_for_request(session: dict) -> dict:
    if AUTH_MODE not in {"operator-session", "hybrid"}:
        return session
    account = operator_account(session.get("actor", ""))
    if not account or not account.get("enabled") or account.get("role") != session.get("role"):
        delete_session(session.get("session_id"))
        raise AuthError("operator session is no longer valid", 401, "operator_session_revoked")
    return session


def create_preview_session(role: str = "owner") -> dict:
    role = role if role in ALLOWED_ROLES else "owner"
    return create_session("local-preview", role, mode="local-preview")


def get_session(sid: str | None) -> dict | None:
    if not sid:
        return None
    cleanup_sessions()
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute("SELECT * FROM auth_sessions WHERE session_id = ?", (sid,)).fetchone()
        if not row:
            return None
        conn.execute("UPDATE auth_sessions SET last_seen_at = ? WHERE session_id = ?", (now_iso(), sid))
    return dict(row)


def delete_session(sid: str | None) -> None:
    if not sid:
        return
    with _DB_LOCK, db_connect() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE session_id = ?", (sid,))


def parse_cookie(header: str | None) -> str | None:
    if not header:
        return None
    jar = cookies.SimpleCookie()
    try:
        jar.load(header)
    except cookies.CookieError:
        return None
    morsel = jar.get(COOKIE_NAME)
    return morsel.value if morsel else None


def require_contract(payload: dict, header_value: str | None) -> None:
    body_version = clean(payload.get("contractVersion"), 20)
    header_version = clean(header_value, 20)
    if body_version != CONTRACT_VERSION or (header_version and header_version != CONTRACT_VERSION):
        raise ContractError(f"contract version must be {CONTRACT_VERSION}", 409, "contract_version_mismatch")


def validate_request_id(value, idempotency_header: str | None = None) -> str:
    request_id = clean(value, 128)
    idem = clean(idempotency_header, 128)
    if not REQUEST_ID_RE.match(request_id):
        raise ContractError("requestId format is invalid", 400, "invalid_request_id")
    if idem and idem != request_id:
        raise ContractError("Idempotency-Key must match requestId", 409, "idempotency_key_mismatch")
    return request_id


def validate_session(payload: dict) -> dict:
    session = payload.get("session")
    if not isinstance(session, dict):
        raise ContractError("session object is required", 400, "session_required")
    data = {k: clean(session.get(k), 128 if k != "ip" else 64) for k in ("id", "user", "ip", "nas", "authServer", "kind")}
    data["acctSessionId"] = clean(session.get("acctSessionId"), 128)
    data["coaHost"] = clean(session.get("coaHost"), 253).lower()
    for field in ("id", "user", "nas", "authServer"):
        if not data[field]:
            raise ContractError(f"session.{field} is required", 400, "missing_session_field")
    return data


def check_rate(key: str) -> None:
    now = time.monotonic()
    cutoff = now - RATE_WINDOW_SECONDS
    with _RATE_LOCK:
        bucket = _RATE_BUCKETS[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT:
            raise AuthError("rate limit exceeded", 429, "rate_limited")
        bucket.append(now)


def permission_for_operation(operation: str) -> str:
    return operation if operation in {"disconnect", "reauthenticate", "review"} else "node-status"


def require_permission(identity: dict, permission: str) -> None:
    role = identity.get("role", "")
    if permission not in ROLE_PERMISSIONS.get(role, set()):
        audit(identity.get("actor", "unknown"), role or "unknown", f"permission.{permission}", "denied")
        raise AuthError("role is not allowed to perform this operation", 403, "forbidden")


def lookup_idempotent(request_id: str, payload_hash: str) -> tuple[int, dict] | None:
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute("SELECT payload_hash, response_json, http_status FROM connector_requests WHERE request_id = ?", (request_id,)).fetchone()
    if not row:
        return None
    if row["payload_hash"] != payload_hash:
        raise ContractError("requestId has already been used with a different payload", 409, "idempotency_conflict")
    response = json.loads(row["response_json"])
    response["idempotentReplay"] = True
    return int(row["http_status"]), response


def store_request(*, request_id: str, kind: str, operation: str, payload_hash: str,
                  request_payload: dict, response_payload: dict, http_status: int,
                  adapter: str, actor: str, role: str) -> None:
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO connector_requests(request_id, kind, operation, payload_hash,
               request_json, response_json, http_status, adapter, actor, role, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (request_id, kind, operation, payload_hash,
             json.dumps(request_payload, ensure_ascii=False, sort_keys=True),
             json.dumps(response_payload, ensure_ascii=False, sort_keys=True),
             http_status, adapter, actor, role, now_iso()),
        )


def ledger(limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT request_id, kind, operation, http_status, adapter, actor, role, created_at, response_json
               FROM connector_requests ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    items = []
    for row in rows:
        response = json.loads(row["response_json"])
        items.append({
            "requestId": row["request_id"], "kind": row["kind"], "operation": row["operation"],
            "httpStatus": row["http_status"], "adapter": row["adapter"], "actor": row["actor"],
            "role": row["role"], "createdAt": row["created_at"], "status": response.get("status"),
            "decision": response.get("decision"), "effect": response.get("effect"),
            "sessionId": response.get("sessionId"), "nodeCode": response.get("nodeCode"),
        })
    return items



def _secret_present(value: str) -> bool:
    return bool(value and len(value) >= 8)


def _url_valid(value: str) -> bool:
    if not value:
        return False
    parsed = urlparse(value)
    if not parsed.hostname:
        return False
    if parsed.scheme == "https":
        return True
    return ALLOW_INSECURE_MIKROTIK and parsed.scheme == "http"


def _probe_error(exc: Exception) -> str:
    if isinstance(exc, socket.timeout): return "timeout"
    if isinstance(exc, socket.gaierror): return "dns-error"
    if isinstance(exc, ConnectionRefusedError): return "connection-refused"
    if isinstance(exc, TimeoutError): return "timeout"
    return type(exc).__name__.lower()[:64]


def _dns_probe(host: str) -> dict:
    started = time.perf_counter()
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        families = sorted({"ipv6" if item[0] == socket.AF_INET6 else "ipv4" for item in infos if item[0] in {socket.AF_INET, socket.AF_INET6}})
        return {"ok": bool(infos), "latencyMs": round((time.perf_counter()-started)*1000, 2), "addressCount": len(infos), "families": families}
    except Exception as exc:
        return {"ok": False, "latencyMs": round((time.perf_counter()-started)*1000, 2), "error": _probe_error(exc)}


def _tcp_probe(host: str, port: int) -> dict:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=PROBE_TIMEOUT_SECONDS):
            pass
        return {"ok": True, "port": port, "latencyMs": round((time.perf_counter()-started)*1000, 2), "probe": "tcp-connect"}
    except Exception as exc:
        return {"ok": False, "port": port, "latencyMs": round((time.perf_counter()-started)*1000, 2), "probe": "tcp-connect", "error": _probe_error(exc)}


def _http_probe(base_url: str) -> dict:
    started = time.perf_counter()
    parsed = urlparse(base_url)
    if not _url_valid(base_url):
        return {"ok": False, "latencyMs": 0, "error": "invalid-url", "credentialsSent": False}
    target = f"{parsed.scheme}://{parsed.netloc}{parsed.path or '/'}"
    req = urllib_request.Request(target, method="HEAD", headers={"User-Agent": "UCHIHA-RADIUS-ConnectivityProbe/1.0", "Accept": "*/*"})
    opener = urllib_request.build_opener(urllib_request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=PROBE_TIMEOUT_SECONDS) as response:
            status = int(response.status)
        return {"ok": True, "httpStatus": status, "latencyMs": round((time.perf_counter()-started)*1000, 2), "scheme": parsed.scheme, "credentialsSent": False}
    except urllib_error.HTTPError as exc:
        # Any HTTP response proves transport reachability, including auth-required responses.
        return {"ok": True, "httpStatus": int(exc.code), "latencyMs": round((time.perf_counter()-started)*1000, 2), "scheme": parsed.scheme, "credentialsSent": False}
    except Exception as exc:
        return {"ok": False, "latencyMs": round((time.perf_counter()-started)*1000, 2), "scheme": parsed.scheme, "credentialsSent": False, "error": _probe_error(exc)}


def store_connectivity_check(actor: str, role: str, result: dict) -> dict:
    check_id = "CHK-" + secrets.token_hex(8)
    created = now_iso()
    saved = {**result, "checkId": check_id, "checkedAt": created}
    with _DB_LOCK, db_connect() as conn:
        conn.execute("INSERT INTO connectivity_checks(check_id, actor, role, result_json, created_at) VALUES (?, ?, ?, ?, ?)",
                     (check_id, actor, role, json.dumps(saved, ensure_ascii=False, sort_keys=True), created))
    return saved


def latest_connectivity_check() -> dict | None:
    try:
        with _DB_LOCK, db_connect() as conn:
            row = conn.execute("SELECT actor, role, result_json, created_at FROM connectivity_checks ORDER BY created_at DESC LIMIT 1").fetchone()
        if not row: return None
        result = json.loads(row["result_json"])
        result["actor"] = row["actor"]
        result["role"] = row["role"]
        return result
    except sqlite3.Error:
        return None


def connectivity_check(actor: str, role: str) -> dict:
    dns = _dns_probe(RADIUS_HOST) if RADIUS_HOST else {"ok": False, "error": "host-not-configured"}
    if RADIUS_PROBE_MODE == "dns-only":
        auth = {"ok": dns.get("ok", False), "port": RADIUS_AUTH_PORT, "probe": "dns-only", "skippedTcp": True}
        acct = {"ok": dns.get("ok", False), "port": RADIUS_ACCT_PORT, "probe": "dns-only", "skippedTcp": True}
    else:
        auth = _tcp_probe(RADIUS_HOST, RADIUS_AUTH_PORT) if dns.get("ok") else {"ok": False, "port": RADIUS_AUTH_PORT, "probe": "tcp-connect", "error": "dns-unavailable"}
        acct = _tcp_probe(RADIUS_HOST, RADIUS_ACCT_PORT) if dns.get("ok") else {"ok": False, "port": RADIUS_ACCT_PORT, "probe": "tcp-connect", "error": "dns-unavailable"}
    mikrotik = _http_probe(MIKROTIK_BASE_URL)
    overall = bool(dns.get("ok") and auth.get("ok") and acct.get("ok") and mikrotik.get("ok"))
    result = {
        "overallReachable": overall,
        "probeMode": RADIUS_PROBE_MODE,
        "timeoutSeconds": PROBE_TIMEOUT_SECONDS,
        "credentialsSent": False,
        "secretsExposed": False,
        "radius": {"dns": dns, "authTransport": auth, "acctTransport": acct},
        "mikrotikGateway": mikrotik,
    }
    return store_connectivity_check(actor, role, result)


def _check_fresh(check: dict | None) -> bool:
    if not check or not check.get("checkedAt"): return False
    try:
        age = (now_dt() - datetime.fromisoformat(check["checkedAt"])).total_seconds()
        return 0 <= age <= PROBE_MAX_AGE_SECONDS
    except Exception:
        return False


def _safe_join_url(base_url: str, path: str) -> str:
    parsed = urlparse(base_url)
    clean_path = "/" + str(path or "").lstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{clean_path}"


def _live_ack_ok() -> bool:
    return hmac.compare_digest(LIVE_ACK, LIVE_ACK_REQUIRED)


def live_driver_readiness() -> dict:
    gateway_valid = _url_valid(MIKROTIK_BASE_URL)
    token_ready = _secret_present(MIKROTIK_TOKEN)
    driver_supported = LIVE_DRIVER == "mikrotik-gateway"
    ack = _live_ack_ok()
    base = {
        "driver": LIVE_DRIVER,
        "supported": driver_supported,
        "explicitEnable": ENABLE_LIVE,
        "acknowledged": ack,
        "gatewayConfigured": gateway_valid,
        "tokenConfigured": token_ready,
        "sessionPathConfigured": bool(MIKROTIK_SESSION_PATH.startswith("/")),
        "nodePathConfigured": bool(MIKROTIK_NODE_PATH.startswith("/")),
        "timeoutSeconds": LIVE_TIMEOUT_SECONDS,
        "secretsExposed": False,
        "credentialsSource": "server-environment",
    }
    base["ready"] = bool(
        driver_supported and ENABLE_LIVE and ack and gateway_valid and token_ready
        and base["sessionPathConfigured"] and base["nodePathConfigured"]
    )
    return base



def _direct_radius_ack_ok() -> bool:
    return hmac.compare_digest(DIRECT_RADIUS_ACK, DIRECT_RADIUS_ACK_REQUIRED)


def _direct_radius_host_valid(host: str) -> bool:
    if not host or len(host) > 253:
        return False
    if any(ch.isspace() for ch in host):
        return False
    # v10 intentionally supports DNS names and IPv4 literals only.
    return bool(re.fullmatch(r"[A-Za-z0-9.-]+", host))


def direct_radius_readiness() -> dict:
    binary = shutil.which(DIRECT_RADIUS_BIN)
    prod = production_readiness() if "production_readiness" in globals() else None
    preflight_ok = True
    if prod is not None and REQUIRE_CONNECTIVITY_PREFLIGHT:
        preflight_ok = bool(prod.get("connectivityVerified"))
    checks = {
        "productionLiveMode": ADAPTER_MODE == "production-live",
        "globalLiveEnabled": ENABLE_LIVE,
        "globalLiveAcknowledged": _live_ack_ok(),
        "directEnable": DIRECT_RADIUS_ENABLE,
        "directAcknowledged": _direct_radius_ack_ok(),
        "binaryAvailable": bool(binary),
        "secretConfigured": _secret_present(DIRECT_RADIUS_SECRET),
        "allowedHostsConfigured": bool(DIRECT_RADIUS_ALLOWED_HOSTS),
        "portValid": 1 <= DIRECT_RADIUS_PORT <= 65535,
        "preflightSatisfied": preflight_ok,
    }
    ready = all(checks.values())
    return {
        "ready": ready,
        "protocol": "RADIUS Dynamic Authorization",
        "supportedPacket": "Disconnect-Request",
        "coaRequestSupported": False,
        "reauthenticateSupported": False,
        "targeting": "allowlisted-host + Acct-Session-Id",
        "port": DIRECT_RADIUS_PORT,
        "timeoutSeconds": DIRECT_RADIUS_TIMEOUT_SECONDS,
        "binary": Path(binary).name if binary else Path(DIRECT_RADIUS_BIN).name,
        "allowedHostCount": len(DIRECT_RADIUS_ALLOWED_HOSTS),
        "checks": checks,
        "secretsExposed": False,
        "credentialsSource": "server-environment",
    }


def _radius_quote(value: str) -> str:
    value = clean(value, 253).replace("\\\\", "\\\\\\\\").replace('"', '\\\\"')
    value = value.replace("\\r", "").replace("\\n", "")
    return f'"{value}"'


def direct_radius_disconnect(payload: dict) -> dict:
    readiness = direct_radius_readiness()
    if not readiness["ready"]:
        raise ContractError("direct RADIUS Disconnect-Request is not ready", 503, "direct_radius_not_ready")

    operation = clean(payload.get("operation"), 64)
    if operation != "disconnect":
        raise ContractError("direct RADIUS endpoint supports disconnect only", 400, "direct_radius_disconnect_only")

    session = validate_session(payload)
    coa_host = session.get("coaHost", "").lower()
    acct_session_id = session.get("acctSessionId", "")

    if not _direct_radius_host_valid(coa_host):
        raise ContractError("session.coaHost must be a DNS name or IPv4 literal", 400, "invalid_coa_host")
    if coa_host not in DIRECT_RADIUS_ALLOWED_HOSTS:
        raise ContractError("session.coaHost is not in the configured allowlist", 403, "coa_host_not_allowed")
    if not acct_session_id:
        raise ContractError("session.acctSessionId is required for targeted disconnect", 400, "acct_session_id_required")

    attributes = [
        f"User-Name = {_radius_quote(session['user'])}",
        f"Acct-Session-Id = {_radius_quote(acct_session_id)}",
    ]
    ip_value = session.get("ip", "")
    if ip_value:
        try:
            parsed_ip = ipaddress.ip_address(ip_value)
            if parsed_ip.version == 4:
                attributes.append(f"Framed-IP-Address = {parsed_ip}")
        except ValueError:
            pass

    stdin_payload = "\\n".join(attributes) + "\\n"
    target = f"{coa_host}:{DIRECT_RADIUS_PORT}"
    binary = shutil.which(DIRECT_RADIUS_BIN)
    if not binary:
        raise ContractError("radclient binary is unavailable", 503, "radclient_unavailable")

    started = time.perf_counter()
    try:
        proc = subprocess.run(
            [binary, target, "disconnect", DIRECT_RADIUS_SECRET],
            input=stdin_payload,
            text=True,
            capture_output=True,
            timeout=DIRECT_RADIUS_TIMEOUT_SECONDS,
            check=False,
            env={**os.environ, "LC_ALL": "C"},
        )
    except subprocess.TimeoutExpired as exc:
        raise ContractError("direct RADIUS Disconnect-Request timed out", 503, "direct_radius_timeout") from exc
    except OSError as exc:
        raise ContractError("radclient could not be executed", 503, "radclient_execute_failed") from exc

    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    output = ((proc.stdout or "") + "\\n" + (proc.stderr or "")).strip()
    got_ack = bool(re.search(r"Disconnect-ACK|Received\\s+.*ACK", output, re.I))
    got_nak = bool(re.search(r"Disconnect-NAK|Received\\s+.*NAK", output, re.I))

    if proc.returncode != 0 or got_nak or not got_ack:
        code = "direct_radius_nak" if got_nak else "direct_radius_no_ack"
        raise ContractError("direct RADIUS target did not return Disconnect-ACK", 503, code)

    return {
        "ok": True,
        "status": "completed",
        "contractVersion": CONTRACT_VERSION,
        "adapter": "direct-radius-disconnect-v37",
        "adapterMode": "production-live",
        "processedAt": now_iso(),
        "realNetworkCommandSent": True,
        "protocol": "RADIUS-Disconnect-Request",
        "effect": "disconnected",
        "decision": "Operator-Disconnect",
        "reason": "Direct-RADIUS-Disconnect-ACK",
        "sessionId": session["id"],
        "acctSessionId": acct_session_id,
        "user": session["user"],
        "nas": session["nas"],
        "authServer": session["authServer"],
        "destinationHost": coa_host,
        "destinationPort": DIRECT_RADIUS_PORT,
        "latencyMs": latency_ms,
        "credentialsExposed": False,
    }


def _gateway_live_post(path: str, payload: dict) -> dict:
    readiness = live_driver_readiness()
    if not readiness["ready"]:
        raise ContractError("production live driver is not ready", 503, "live_driver_not_ready")
    target = _safe_join_url(MIKROTIK_BASE_URL, path)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib_request.Request(
        target,
        data=raw,
        method="POST",
        headers={
            "User-Agent": "UCHIHA-RADIUS-LiveDriver/1.0",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MIKROTIK_TOKEN}",
            "X-Uchiha-Contract": CONTRACT_VERSION,
        },
    )
    opener = urllib_request.build_opener(urllib_request.ProxyHandler({}))
    started = time.perf_counter()
    try:
        with opener.open(req, timeout=LIVE_TIMEOUT_SECONDS) as response:
            status = int(response.status)
            body = response.read(MAX_BODY)
    except urllib_error.HTTPError as exc:
        body = exc.read(MAX_BODY)
        message = "gateway-http-error"
        try:
            parsed = json.loads(body.decode("utf-8")) if body else {}
            message = clean(parsed.get("error") or parsed.get("message") or message, 160)
        except Exception:
            pass
        if int(exc.code) >= 500:
            raise ContractError(message, 503, "live_gateway_unavailable")
        raise ContractError(message, 502, "live_gateway_rejected")
    except Exception as exc:
        raise ContractError(_probe_error(exc), 503, "live_gateway_unavailable")
    if not (200 <= status < 300):
        raise ContractError(f"gateway HTTP {status}", 502, "live_gateway_rejected")
    try:
        parsed = json.loads(body.decode("utf-8")) if body else {}
    except Exception:
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    return {
        **parsed,
        "gatewayHttpStatus": status,
        "gatewayLatencyMs": round((time.perf_counter() - started) * 1000, 2),
        "credentialsExposed": False,
    }



def _voucher_ack_ok() -> bool:
    return hmac.compare_digest(VOUCHER_PROVISION_ACK, VOUCHER_PROVISION_ACK_REQUIRED)


def _voucher_url_valid() -> bool:
    if not VOUCHER_GATEWAY_URL:
        return False
    parsed = urlparse(VOUCHER_GATEWAY_URL)
    if not parsed.hostname:
        return False
    if parsed.scheme == "https":
        return True
    return bool(VOUCHER_ALLOW_INSECURE and parsed.scheme == "http")


def _voucher_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "batchId": row["batch_id"],
        "requestId": row["request_id"],
        "providerId": row["provider_id"],
        "planId": row["plan_id"],
        "quantity": int(row["quantity"]),
        "validity": row["validity"],
        "status": row["status"],
        "receiptId": row["receipt_id"],
        "externalReference": row["external_reference"],
        "provisionedCount": int(row["provisioned_count"]),
        "gatewayHttpStatus": row["gateway_http_status"],
        "gatewayLatencyMs": row["gateway_latency_ms"],
        "errorCode": row["error_code"],
        "actor": row["actor"],
        "role": row["role"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "completedAt": row["completed_at"],
        "credentialsStored": False,
        "secretsExposed": False,
    }


def voucher_provision_batches(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT * FROM voucher_provision_batches
               ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [_voucher_row_to_dict(row) for row in rows]


def voucher_provisioning_readiness() -> dict:
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS c FROM voucher_provision_batches GROUP BY status"
        ).fetchall()
        latest = conn.execute(
            """SELECT * FROM voucher_provision_batches
               ORDER BY created_at DESC LIMIT 1"""
        ).fetchone()
    counts = {row["status"]: int(row["c"]) for row in rows}
    checks = {
        "enabled": VOUCHER_PROVISION_ENABLE,
        "acknowledged": _voucher_ack_ok(),
        "gatewayConfigured": _voucher_url_valid(),
        "tokenConfigured": _secret_present(VOUCHER_GATEWAY_TOKEN),
        "pathConfigured": bool(VOUCHER_GATEWAY_PATH.startswith("/")),
    }
    ready = all(checks.values())
    blockers = [name for name, ok in checks.items() if not ok]
    return {
        "enabled": VOUCHER_PROVISION_ENABLE,
        "ready": ready,
        "acknowledged": checks["acknowledged"],
        "gatewayConfigured": checks["gatewayConfigured"],
        "gatewayHost": urlparse(VOUCHER_GATEWAY_URL).hostname if checks["gatewayConfigured"] else None,
        "tokenConfigured": checks["tokenConfigured"],
        "pathConfigured": checks["pathConfigured"],
        "maxBatch": VOUCHER_MAX_BATCH,
        "timeoutSeconds": VOUCHER_TIMEOUT_SECONDS,
        "gatewayContract": "receipt-only-idempotent-v1",
        "provisionedBatches": counts.get("provisioned", 0),
        "uncertainBatches": counts.get("uncertain", 0),
        "rejectedBatches": counts.get("rejected", 0),
        "latestBatch": _voucher_row_to_dict(latest) if latest else None,
        "latestReceiptId": latest["receipt_id"] if latest else None,
        "blockers": blockers,
        "codesReturned": False,
        "credentialsSource": "gateway-only",
        "credentialsStored": False,
        "codesReturned": False,
        "secretsExposed": False,
        "checks": checks,
    }


def _validate_voucher_request(payload: dict) -> dict:
    batch = payload.get("batch") if isinstance(payload.get("batch"), dict) else {}
    # UI v89 sends batch{ id, plan, quantity, validity } + scope.
    # Direct API callers may use the normalized top-level form as well.
    provider_id = clean(payload.get("providerId") or payload.get("scope"), 96)
    plan_id = clean(payload.get("planId") or batch.get("plan"), 128)
    validity = clean(payload.get("validity") or batch.get("validity"), 64)
    source_batch_id = clean(batch.get("id"), 128)
    if not provider_id:
        raise ContractError("providerId or scope is required", 400, "voucher_provider_required")
    if not plan_id:
        raise ContractError("planId or batch.plan is required", 400, "voucher_plan_required")
    if not validity:
        raise ContractError("validity or batch.validity is required", 400, "voucher_validity_required")
    quantity = payload.get("quantity")
    if quantity is None:
        quantity = batch.get("quantity")
    if isinstance(quantity, bool):
        raise ContractError("quantity must be an integer", 400, "voucher_quantity_invalid")
    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        raise ContractError("quantity must be an integer", 400, "voucher_quantity_invalid")
    if quantity < 1 or quantity > VOUCHER_MAX_BATCH:
        raise ContractError(
            f"quantity must be between 1 and {VOUCHER_MAX_BATCH}",
            400,
            "voucher_quantity_out_of_range",
        )
    return {
        "providerId": provider_id,
        "planId": plan_id,
        "quantity": quantity,
        "validity": validity,
        "sourceBatchId": source_batch_id or None,
    }


def _voucher_gateway_post(request_id: str, data: dict) -> dict:
    readiness = voucher_provisioning_readiness()
    if not readiness["ready"]:
        raise ContractError("voucher provisioning gateway is not ready", 503, "voucher_gateway_not_ready")
    target = _safe_join_url(VOUCHER_GATEWAY_URL, VOUCHER_GATEWAY_PATH)
    outbound = {
        "contractVersion": CONTRACT_VERSION,
        "requestId": request_id,
        "operation": "provision-voucher-batch",
        "providerId": data["providerId"],
        "planId": data["planId"],
        "quantity": data["quantity"],
        "validity": data["validity"],
        "sourceBatchId": data.get("sourceBatchId"),
        "productionSite": PRODUCTION_SITE or None,
        "requestedAt": now_iso(),
    }
    raw = json.dumps(outbound, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib_request.Request(
        target,
        data=raw,
        method="POST",
        headers={
            "User-Agent": "UCHIHA-RADIUS-VoucherProvisioner/1.0",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {VOUCHER_GATEWAY_TOKEN}",
            "X-Uchiha-Contract": CONTRACT_VERSION,
            "Idempotency-Key": request_id,
        },
    )
    opener = urllib_request.build_opener(urllib_request.ProxyHandler({}))
    started = time.perf_counter()
    try:
        with opener.open(req, timeout=VOUCHER_TIMEOUT_SECONDS) as response:
            status = int(response.status)
            body = response.read(MAX_BODY)
    except urllib_error.HTTPError as exc:
        code = int(exc.code)
        if code >= 500 or code == 429:
            raise ContractError("voucher gateway unavailable", 503, "voucher_gateway_unavailable")
        raise ContractError("voucher gateway rejected request", 502, "voucher_gateway_rejected")
    except Exception as exc:
        raise ContractError(_probe_error(exc), 503, "voucher_gateway_unavailable")

    if not (200 <= status < 300):
        raise ContractError("voucher gateway rejected request", 502, "voucher_gateway_rejected")
    try:
        parsed = json.loads(body.decode("utf-8")) if body else {}
    except Exception:
        raise ContractError("voucher gateway returned invalid JSON", 502, "voucher_gateway_invalid_response")
    if not isinstance(parsed, dict):
        raise ContractError("voucher gateway returned invalid response", 502, "voucher_gateway_invalid_response")

    allowed = {"status", "receiptId", "batchId", "provisionedCount", "externalReference"}
    unexpected = sorted(set(parsed.keys()) - allowed)
    if unexpected or any(isinstance(value, (dict, list, tuple, set)) for value in parsed.values()):
        raise ContractError(
            "voucher gateway returned a non receipt-only payload",
            502,
            "voucher_gateway_credential_payload_rejected",
        )

    receipt_id = clean(parsed.get("receiptId"), 160)
    gateway_batch_id = clean(parsed.get("batchId"), 160)
    external_reference = clean(parsed.get("externalReference"), 200)
    gateway_status = clean(parsed.get("status"), 64).lower()
    try:
        provisioned_count = int(parsed.get("provisionedCount"))
    except (TypeError, ValueError):
        provisioned_count = -1
    if not receipt_id:
        raise ContractError("voucher gateway receiptId is required", 502, "voucher_gateway_invalid_response")
    if gateway_status not in {"provisioned", "completed"}:
        raise ContractError("voucher gateway did not confirm provisioning", 502, "voucher_gateway_not_confirmed")
    if provisioned_count != int(data["quantity"]):
        raise ContractError("voucher gateway provisionedCount mismatch", 502, "voucher_gateway_count_mismatch")

    return {
        "receiptId": receipt_id,
        "gatewayBatchId": gateway_batch_id or None,
        "externalReference": external_reference or None,
        "provisionedCount": provisioned_count,
        "status": "provisioned",
        "gatewayHttpStatus": status,
        "gatewayLatencyMs": round((time.perf_counter() - started) * 1000, 2),
    }


def provision_voucher_batch(payload: dict, idempotency_header: str | None, identity: dict) -> tuple[int, dict]:
    require_contract(payload, None)
    require_permission(identity, "provision-vouchers")
    require_not_maintenance("provision-voucher-batch")
    if not voucher_provisioning_readiness()["ready"]:
        raise ContractError("voucher provisioning gateway is not ready", 503, "voucher_gateway_not_ready")

    request_id = validate_request_id(payload.get("requestId"), idempotency_header)
    if clean(payload.get("operation"), 64) != "provision-voucher-batch":
        raise ContractError("operation must be provision-voucher-batch", 400, "invalid_voucher_operation")
    data = _validate_voucher_request(payload)
    payload_hash = stable_payload_hash({
        "operation": "provision-voucher-batch",
        "providerId": data["providerId"],
        "planId": data["planId"],
        "quantity": data["quantity"],
        "validity": data["validity"],
        "sourceBatchId": data.get("sourceBatchId"),
    })

    with _VOUCHER_LOCK:
        with _DB_LOCK, db_connect() as conn:
            existing = conn.execute(
                "SELECT * FROM voucher_provision_batches WHERE request_id=?",
                (request_id,),
            ).fetchone()
        if existing:
            if not hmac.compare_digest(existing["payload_hash"], payload_hash):
                raise ContractError(
                    "requestId was already used with a different voucher payload",
                    409,
                    "voucher_idempotency_conflict",
                )
            if existing["status"] == "provisioned":
                replay_item = _voucher_row_to_dict(existing)
                return 200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "backendBuild": BACKEND_BUILD,
                    "idempotentReplay": True,
                    "networkProvisioned": True,
                    "requestId": request_id,
                    "receiptId": replay_item["receiptId"],
                    "gatewayBatchId": replay_item["externalReference"],
                    "provisionedCount": replay_item["provisionedCount"],
                    "status": replay_item["status"],
                    "reason": None,
                    "batch": replay_item,
                    "voucherCodesReturned": False,
                    "codesReturned": False,
                    "credentialsStored": False,
                    "secretsExposed": False,
                }

        now = now_iso()
        batch_id = existing["batch_id"] if existing else "VNET-" + secrets.token_urlsafe(10)
        with _DB_LOCK, db_connect() as conn:
            if not existing:
                conn.execute(
                    """INSERT INTO voucher_provision_batches(
                        batch_id, request_id, payload_hash, provider_id, plan_id,
                        quantity, validity, status, provisioned_count,
                        actor, role, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)""",
                    (
                        batch_id, request_id, payload_hash, data["providerId"], data["planId"],
                        data["quantity"], data["validity"],
                        identity["actor"], identity["role"], now, now,
                    ),
                )
            else:
                conn.execute(
                    """UPDATE voucher_provision_batches
                       SET status='pending', error_code=NULL, updated_at=?
                       WHERE request_id=?""",
                    (now, request_id),
                )

        try:
            gateway = _voucher_gateway_post(request_id, data)
        except ContractError as exc:
            failed_status = "uncertain" if exc.status >= 500 else "rejected"
            with _DB_LOCK, db_connect() as conn:
                conn.execute(
                    """UPDATE voucher_provision_batches
                       SET status=?, error_code=?, updated_at=?
                       WHERE request_id=?""",
                    (failed_status, exc.code, now_iso(), request_id),
                )
            audit(
                identity["actor"], identity["role"], "voucher.provision", "error",
                request_id=request_id,
                detail={
                    "batchId": batch_id,
                    "providerId": data["providerId"],
                    "planId": data["planId"],
                    "quantity": data["quantity"],
                    "status": failed_status,
                    "errorCode": exc.code,
                    "voucherCodesStored": False,
                },
            )
            raise

        completed = now_iso()
        with _DB_LOCK, db_connect() as conn:
            conn.execute(
                """UPDATE voucher_provision_batches
                   SET status='provisioned', receipt_id=?, external_reference=?,
                       provisioned_count=?, gateway_http_status=?, gateway_latency_ms=?,
                       error_code=NULL, updated_at=?, completed_at=?
                   WHERE request_id=?""",
                (
                    gateway["receiptId"], gateway["externalReference"] or gateway["gatewayBatchId"],
                    gateway["provisionedCount"], gateway["gatewayHttpStatus"],
                    gateway["gatewayLatencyMs"], completed, completed, request_id,
                ),
            )
            row = conn.execute(
                "SELECT * FROM voucher_provision_batches WHERE request_id=?",
                (request_id,),
            ).fetchone()

        item = _voucher_row_to_dict(row)
        audit(
            identity["actor"], identity["role"], "voucher.provision", "success",
            request_id=request_id,
            detail={
                "batchId": item["batchId"],
                "providerId": item["providerId"],
                "planId": item["planId"],
                "quantity": item["quantity"],
                "provisionedCount": item["provisionedCount"],
                "receiptId": item["receiptId"],
                "voucherCodesStored": False,
            },
        )
        return 201, {
            "ok": True,
            "contractVersion": CONTRACT_VERSION,
            "backendBuild": BACKEND_BUILD,
            "idempotentReplay": False,
            "networkProvisioned": True,
            "requestId": request_id,
            "receiptId": gateway["receiptId"],
            "gatewayBatchId": gateway["gatewayBatchId"],
            "provisionedCount": gateway["provisionedCount"],
            "status": "provisioned",
            "reason": None,
            "batch": item,
            "voucherCodesReturned": False,
            "codesReturned": False,
            "credentialsStored": False,
            "secretsExposed": False,
        }




def _edge_rate_key(value: str | None) -> str:
    value = clean(value, 128)
    if not value:
        return "unknown"
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return value[:128]


def _gateway_auth_rate_prune_locked(key: str, now_mono: float) -> deque:
    bucket = _EDGE_AUTH_FAILURES.get(key, deque())
    cutoff = now_mono - EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()
    if bucket:
        _EDGE_AUTH_FAILURES[key] = bucket
    else:
        _EDGE_AUTH_FAILURES.pop(key, None)
    return bucket


def gateway_auth_rate_limit_check(peer: str) -> dict:
    key = _edge_rate_key(peer)
    now_mono = time.monotonic()
    with _EDGE_AUTH_RATE_LOCK:
        bucket = _gateway_auth_rate_prune_locked(key, now_mono)
        count = len(bucket)
    if count >= EDGE_GATEWAY_AUTH_FAILURE_LIMIT:
        raise AuthError("too many failed gateway authentication attempts", 429, "gateway_auth_rate_limited")
    return {"key": key, "failures": count, "limit": EDGE_GATEWAY_AUTH_FAILURE_LIMIT,
            "windowSeconds": EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS}


def gateway_auth_record_failure(peer: str) -> None:
    global _EDGE_REJECTED_AUTH_TOTAL
    key = _edge_rate_key(peer)
    now_mono = time.monotonic()
    with _EDGE_AUTH_RATE_LOCK:
        bucket = _gateway_auth_rate_prune_locked(key, now_mono)
        bucket.append(now_mono)
        _EDGE_AUTH_FAILURES[key] = bucket
        _EDGE_REJECTED_AUTH_TOTAL += 1


def edge_protection_readiness() -> dict:
    server = _HTTPD
    active = int(getattr(server, "active_requests", 0) or 0)
    peak = int(getattr(server, "peak_active_requests", 0) or 0)
    rejected_capacity = int(getattr(server, "rejected_capacity_total", 0) or 0)
    now_mono = time.monotonic()
    with _EDGE_AUTH_RATE_LOCK:
        current_failures = 0
        for key in list(_EDGE_AUTH_FAILURES.keys()):
            current_failures += len(_gateway_auth_rate_prune_locked(key, now_mono))
        auth_rejected_total = int(_EDGE_REJECTED_AUTH_TOTAL)
    ready = bool(
        EDGE_MAX_CONCURRENT_REQUESTS >= 2
        and EDGE_SOCKET_TIMEOUT_SECONDS >= 1.0
        and EDGE_GATEWAY_AUTH_FAILURE_LIMIT >= 2
        and EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS >= 1.0
    )
    return {
        "supported": True, "ready": ready,
        "boundedConcurrency": True,
        "maxConcurrentRequests": EDGE_MAX_CONCURRENT_REQUESTS,
        "activeRequests": active,
        "peakActiveRequests": peak,
        "capacityRejectedTotal": rejected_capacity,
        "socketTimeoutSeconds": EDGE_SOCKET_TIMEOUT_SECONDS,
        "gatewayPreAuthRateLimit": True,
        "gatewayAuthFailureLimit": EDGE_GATEWAY_AUTH_FAILURE_LIMIT,
        "gatewayAuthFailureWindowSeconds": EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS,
        "gatewayAuthFailuresInWindow": current_failures,
        "gatewayAuthFailureRecordedTotal": auth_rejected_total,
        "requestBodyLimitBytes": MAX_BODY,
        "secretsExposed": False,
    }


_PROXY_HEADER_NAMES = (
    "Forwarded", "X-Forwarded-For", "X-Forwarded-Proto",
    "X-Forwarded-Host", "X-Forwarded-Port", "X-Real-IP",
)


def transport_security_readiness() -> dict:
    proxy_config_valid = not TRUSTED_PROXY_CONFIG_ERRORS
    trusted_proxy_ready = bool(
        TRUST_PROXY_HEADERS
        and TRUSTED_PROXY_NETWORKS
        and proxy_config_valid
    )
    https_enforcement_ready = bool(
        not PUBLIC_HTTPS_REQUIRED
        or trusted_proxy_ready
    )
    blockers = []
    if TRUSTED_PROXY_CONFIG_ERRORS:
        blockers.append("invalid-trusted-proxy-cidr")
    if PUBLIC_HTTPS_REQUIRED and not TRUST_PROXY_HEADERS:
        blockers.append("trusted-proxy-headers-disabled")
    if PUBLIC_HTTPS_REQUIRED and not TRUSTED_PROXY_NETWORKS:
        blockers.append("trusted-proxy-cidrs-required")
    if PUBLIC_HTTPS_REQUIRED and not COOKIE_SECURE_POLICY:
        blockers.append("secure-cookie-policy-disabled")
    if PUBLIC_HTTPS_REQUIRED and not HSTS_ENABLED:
        blockers.append("hsts-disabled")
    return {
        "supported": True,
        "publicHttpsRequired": PUBLIC_HTTPS_REQUIRED,
        "trustProxyHeaders": TRUST_PROXY_HEADERS,
        "trustedProxyCount": len(TRUSTED_PROXY_NETWORKS),
        "proxyConfigValid": proxy_config_valid,
        "httpsEnforcementReady": https_enforcement_ready and not blockers,
        "rejectUntrustedProxyHeaders": REJECT_UNTRUSTED_PROXY_HEADERS,
        "secureCookiePolicy": COOKIE_SECURE_POLICY,
        "hstsEnabled": HSTS_ENABLED,
        "hstsMaxAgeSeconds": HSTS_MAX_AGE_SECONDS if HSTS_ENABLED else 0,
        "hstsIncludeSubdomains": HSTS_INCLUDE_SUBDOMAINS if HSTS_ENABLED else False,
        "hstsPreload": HSTS_PRELOAD if HSTS_ENABLED else False,
        "tlsTermination": "trusted-reverse-proxy" if TRUST_PROXY_HEADERS else "application-http",
        "directTlsListener": False,
        "recommendedForProduction": True,
        "blockers": blockers,
        "secretsExposed": False,
    }


def validate_transport_security_config() -> None:
    if TRUSTED_PROXY_CONFIG_ERRORS:
        raise RuntimeError(
            "invalid UCHIHA_TRUSTED_PROXY_CIDRS: "
            + ",".join(TRUSTED_PROXY_CONFIG_ERRORS)
        )
    if PUBLIC_HTTPS_REQUIRED:
        if not TRUST_PROXY_HEADERS:
            raise RuntimeError(
                "UCHIHA_PUBLIC_HTTPS_REQUIRED=1 requires UCHIHA_TRUST_PROXY_HEADERS=1"
            )
        if not TRUSTED_PROXY_NETWORKS:
            raise RuntimeError(
                "UCHIHA_PUBLIC_HTTPS_REQUIRED=1 requires UCHIHA_TRUSTED_PROXY_CIDRS"
            )
        if not COOKIE_SECURE_POLICY:
            raise RuntimeError(
                "UCHIHA_PUBLIC_HTTPS_REQUIRED=1 requires UCHIHA_COOKIE_SECURE=1"
            )
        if not HSTS_ENABLED:
            raise RuntimeError(
                "UCHIHA_PUBLIC_HTTPS_REQUIRED=1 requires UCHIHA_HSTS_ENABLED=1"
            )



def gateway_authentication_readiness() -> dict:
    active = AUTH_MODE in {"gateway", "hybrid"}
    current_secret = _secret_present(GATEWAY_HMAC_SECRET)
    previous_configured = bool(_secret_present(GATEWAY_HMAC_PREVIOUS_SECRET) and GATEWAY_HMAC_PREVIOUS_KEY_ID)
    transport = transport_security_readiness()
    transport_ok = bool(not GATEWAY_REQUIRE_HTTPS or (transport.get("publicHttpsRequired") and transport.get("httpsEnforcementReady")))
    blockers = []
    if active and not current_secret: blockers.append("gateway-hmac-secret-required")
    if active and not GATEWAY_HMAC_KEY_ID: blockers.append("gateway-hmac-key-id-required")
    if active and GATEWAY_HMAC_PREVIOUS_SECRET and not GATEWAY_HMAC_PREVIOUS_KEY_ID: blockers.append("previous-key-id-required")
    if active and GATEWAY_REQUIRE_HTTPS and not transport_ok: blockers.append("gateway-https-boundary-required")
    if active and GATEWAY_LEGACY_KEY_AUTH and not _secret_present(GATEWAY_KEY): blockers.append("legacy-gateway-key-missing")
    return {
        "supported": True, "active": active, "mode": AUTH_MODE,
        "scheme": "hmac-sha256-v1" if active else "session-cookie",
        "ready": not blockers,
        "currentKeyId": GATEWAY_HMAC_KEY_ID if active and current_secret else None,
        "previousKeyConfigured": previous_configured,
        "previousKeyId": GATEWAY_HMAC_PREVIOUS_KEY_ID if previous_configured else None,
        "maxSkewSeconds": GATEWAY_HMAC_MAX_SKEW_SECONDS,
        "nonceRetentionSeconds": GATEWAY_NONCE_RETENTION_SECONDS,
        "noncePersistence": True, "replayProtection": True,
        "bodyHashBound": True, "methodBound": True, "requestTargetBound": True, "actorRoleBound": True,
        "httpsRequired": GATEWAY_REQUIRE_HTTPS if active else False,
        "transportReady": transport_ok if active else True,
        "legacyKeyAuthEnabled": GATEWAY_LEGACY_KEY_AUTH if active else False,
        "legacyKeyAuthRecommended": False,
        "blockers": blockers, "secretsExposed": False,
    }


def validate_gateway_auth_config() -> None:
    state = gateway_authentication_readiness()
    if AUTH_MODE in {"gateway", "hybrid"} and state["blockers"]:
        raise RuntimeError("gateway authentication configuration is incomplete: " + ",".join(state["blockers"]))


def _gateway_key_for_id(key_id: str) -> str | None:
    if key_id == GATEWAY_HMAC_KEY_ID and _secret_present(GATEWAY_HMAC_SECRET): return GATEWAY_HMAC_SECRET
    if GATEWAY_HMAC_PREVIOUS_KEY_ID and key_id == GATEWAY_HMAC_PREVIOUS_KEY_ID and _secret_present(GATEWAY_HMAC_PREVIOUS_SECRET): return GATEWAY_HMAC_PREVIOUS_SECRET
    return None


def _gateway_canonical_request(method: str, request_target: str, actor: str, role: str, timestamp: str, nonce: str, body_sha256: str) -> str:
    return "\n".join(["UCHIHA-GATEWAY-HMAC-V1", method.upper(), request_target, actor, role, timestamp, nonce, body_sha256.lower()])


def _consume_gateway_nonce(nonce: str, key_id: str, actor: str, timestamp: int, trace_id: str | None) -> None:
    now = now_dt(); expires = now + timedelta(seconds=GATEWAY_NONCE_RETENTION_SECONDS)
    with _DB_LOCK, db_connect() as conn:
        conn.execute("DELETE FROM gateway_auth_nonces WHERE expires_at <= ?", (now.isoformat(),))
        try:
            conn.execute("""INSERT INTO gateway_auth_nonces(nonce,key_id,actor,used_at,expires_at,trace_id) VALUES (?,?,?,?,?,?)""",
                         (nonce,key_id,actor,datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),expires.isoformat(),trace_id))
        except sqlite3.IntegrityError:
            raise AuthError("gateway request nonce was already used", 409, "gateway_replay_detected")


def production_readiness() -> dict:
    checks = {
        "radiusHost": bool(RADIUS_HOST),
        "radiusAuthPort": 1 <= RADIUS_AUTH_PORT <= 65535,
        "radiusAcctPort": 1 <= RADIUS_ACCT_PORT <= 65535,
        "radiusSecret": _secret_present(RADIUS_SECRET),
        "mikrotikBaseUrl": _url_valid(MIKROTIK_BASE_URL),
        "mikrotikToken": _secret_present(MIKROTIK_TOKEN),
        "productionSite": bool(PRODUCTION_SITE),
        "radiusProbeMode": RADIUS_PROBE_MODE in {"tcp", "dns-only"},
    }
    missing = [name for name, ok in checks.items() if not ok]
    configuration_ready = not missing
    last_check = latest_connectivity_check()
    check_fresh = _check_fresh(last_check)
    connectivity_verified = bool(last_check and check_fresh and last_check.get("overallReachable"))
    dry_run_ready = configuration_ready and (connectivity_verified or not REQUIRE_CONNECTIVITY_PREFLIGHT)
    return {
        "adapterMode": ADAPTER_MODE,
        "configurationReady": configuration_ready,
        "connectivityVerified": connectivity_verified,
        "connectivityRequired": REQUIRE_CONNECTIVITY_PREFLIGHT,
        "connectivityCheckFresh": check_fresh,
        "probeMaxAgeSeconds": PROBE_MAX_AGE_SECONDS,
        "dryRunReady": dry_run_ready,
        "liveSupported": True,
        "liveEnabled": ENABLE_LIVE,
        "liveDriver": live_driver_readiness(),
        "checks": checks,
        "missing": missing,
        "lastConnectivityCheck": last_check,
        "secretsExposed": False,
        "configurationSource": "server-environment",
        "radius": {
            "hostConfigured": bool(RADIUS_HOST),
            "authPort": RADIUS_AUTH_PORT,
            "acctPort": RADIUS_ACCT_PORT,
            "secretConfigured": _secret_present(RADIUS_SECRET),
            "probeMode": RADIUS_PROBE_MODE,
        },
        "mikrotik": {
            "baseUrlConfigured": _url_valid(MIKROTIK_BASE_URL),
            "tokenConfigured": _secret_present(MIKROTIK_TOKEN),
            "httpsRequired": not ALLOW_INSECURE_MIKROTIK,
        },
        "siteConfigured": bool(PRODUCTION_SITE),
        "transportSecurity": transport_security_readiness(),
        "gatewayAuthentication": gateway_authentication_readiness(),
        "operatorAuthentication": operator_session_readiness(),
    }

def validate_adapter_mode() -> None:
    validate_transport_security_config()
    validate_gateway_auth_config()
    if AUTH_MODE not in SUPPORTED_AUTH_MODES:
        raise RuntimeError(f"Unsupported UCHIHA_CONNECTOR_AUTH_MODE: {AUTH_MODE}")
    allowed = {"preview", "production-dry-run", "production-live"}
    if ADAPTER_MODE not in allowed:
        raise RuntimeError(f"Unsupported UCHIHA_CONNECTOR_ADAPTER: {ADAPTER_MODE}")
    if RADIUS_PROBE_MODE not in {"tcp", "dns-only"}:
        raise RuntimeError(f"Unsupported UCHIHA_RADIUS_PROBE_MODE: {RADIUS_PROBE_MODE}")
    if ADAPTER_MODE == "production-live":
        if AUTH_MODE == "local-preview":
            raise RuntimeError("production-live is blocked: local-preview authentication is not allowed")
        if not ENABLE_LIVE:
            raise RuntimeError("production-live is blocked: UCHIHA_CONNECTOR_ENABLE_LIVE=1 is required")
        if not _live_ack_ok():
            raise RuntimeError("production-live is blocked: set UCHIHA_CONNECTOR_LIVE_ACK=I_UNDERSTAND_LIVE_NETWORK_COMMANDS")
        if LIVE_DRIVER != "mikrotik-gateway":
            raise RuntimeError(f"production-live driver is unsupported: {LIVE_DRIVER}")
        state = live_driver_readiness()
        if not state["ready"]:
            raise RuntimeError("production-live driver configuration is incomplete")


class RadiusConnectorAdapter(ABC):
    name = "abstract"
    @abstractmethod
    def health(self) -> dict: raise NotImplementedError
    @abstractmethod
    def session_command(self, payload: dict) -> dict: raise NotImplementedError
    @abstractmethod
    def node_status(self, payload: dict) -> dict: raise NotImplementedError


class PreviewRadiusAdapter(RadiusConnectorAdapter):
    name = "preview-safe-backend-v37"

    def health(self) -> dict:
        return {
            "ok": True,
            "adapter": self.name,
            "adapterMode": "preview",
            "contractVersion": CONTRACT_VERSION,
            "backendBuild": BACKEND_BUILD,
            "uiBuild": UI_BUILD,
            "serverTime": now_iso(),
            "mode": "safe-preview",
            "capabilities": [
                "health", "disconnect", "reauthenticate", "node-status",
                "request-ledger", "audit-ledger", "persistent-ledger",
                "idempotency", "rbac", "csrf", "production-readiness", "command-queue", "retry", "dead-letter", "cancel-command", "manual-retry", "queue-cleanup", "connectivity-check"
            ],
            "persistence": "sqlite",
            "idempotency": True,
            "realNetworkCommands": False,
            "authMode": AUTH_MODE,
            "authRequired": True,
            "queue": queue_stats(),
            "queueHealth": queue_stats().get("health"),
            "productionReadiness": production_readiness(),
        }

    def session_command(self, payload: dict) -> dict:
        operation = clean(payload.get("operation"), 64)
        if operation not in ALLOWED_OPERATIONS:
            raise ContractError("operation is not supported", 400, "unsupported_operation")
        session = validate_session(payload)
        if operation == "disconnect":
            result = {"decision": "Operator-Disconnect", "effect": "disconnected", "reason": "Backend-Preview-Adapter"}
        elif operation == "reauthenticate":
            result = {"decision": "Access-Accept", "effect": "reauthenticated", "reason": "Backend-Preview-Adapter"}
        else:
            result = {"decision": "Not-Evaluated", "effect": "review-only", "reason": "Backend-Preview-Adapter"}
        return {
            "ok": True, "status": "completed", "contractVersion": CONTRACT_VERSION,
            "adapter": self.name, "adapterMode": "preview", "processedAt": now_iso(),
            "realNetworkCommandSent": False, "sessionId": session["id"],
            "user": session["user"], "nas": session["nas"],
            "authServer": session["authServer"], **result
        }

    def node_status(self, payload: dict) -> dict:
        node = payload.get("node")
        if not isinstance(node, dict):
            raise ContractError("node object is required", 400, "node_required")
        code, status = clean(node.get("code"), 128), clean(node.get("status"), 64)
        if not code:
            raise ContractError("node.code is required", 400, "node_code_required")
        if status not in ALLOWED_NODE_STATES:
            raise ContractError("node.status is invalid", 400, "invalid_node_status")
        impact = payload.get("impact") if isinstance(payload.get("impact"), dict) else {}
        return {
            "ok": True, "status": "completed", "contractVersion": CONTRACT_VERSION,
            "adapter": self.name, "adapterMode": "preview", "processedAt": now_iso(),
            "realNetworkCommandSent": False, "nodeCode": code, "nodeStatus": status,
            "acceptedImpact": {
                "affectedSessions": int(impact.get("affectedSessions") or 0),
                "disconnectedSessions": int(impact.get("disconnectedSessions") or 0),
            },
        }


class ProductionDryRunAdapter(PreviewRadiusAdapter):
    name = "production-dry-run-v37"

    def _require_ready(self) -> dict:
        state = production_readiness()
        if not state["configurationReady"]:
            raise ContractError(
                "production connector configuration is incomplete: " + ", ".join(state["missing"]),
                503,
                "production_not_ready",
            )
        if state["connectivityRequired"] and not state["connectivityVerified"]:
            raise ContractError(
                "production connectivity preflight is required or stale",
                503,
                "connectivity_preflight_required",
            )
        return state

    def health(self) -> dict:
        state = production_readiness()
        return {
            "ok": True,
            "adapter": self.name,
            "adapterMode": "production-dry-run",
            "contractVersion": CONTRACT_VERSION,
            "backendBuild": BACKEND_BUILD,
            "uiBuild": UI_BUILD,
            "serverTime": now_iso(),
            "mode": "production-dry-run",
            "capabilities": [
                "health", "disconnect", "reauthenticate", "node-status",
                "request-ledger", "audit-ledger", "persistent-ledger",
                "idempotency", "rbac", "csrf", "production-readiness",
                "production-dry-run", "connectivity-check", "command-queue", "retry", "dead-letter", "cancel-command", "manual-retry", "queue-cleanup"
            ],
            "persistence": "sqlite",
            "idempotency": True,
            "realNetworkCommands": False,
            "authMode": AUTH_MODE,
            "authRequired": True,
            "queue": queue_stats(),
            "queueHealth": queue_stats().get("health"),
            "productionReadiness": state,
        }

    def session_command(self, payload: dict) -> dict:
        self._require_ready()
        result = super().session_command(payload)
        result.update({
            "adapter": self.name,
            "adapterMode": "production-dry-run",
            "status": "dry-run",
            "reason": "Production-Dry-Run",
            "realNetworkCommandSent": False,
            "productionSite": PRODUCTION_SITE,
        })
        return result

    def node_status(self, payload: dict) -> dict:
        self._require_ready()
        result = super().node_status(payload)
        result.update({
            "adapter": self.name,
            "adapterMode": "production-dry-run",
            "status": "dry-run",
            "realNetworkCommandSent": False,
            "productionSite": PRODUCTION_SITE,
        })
        return result


class ProductionLiveAdapter(ProductionDryRunAdapter):
    name = "production-live-mikrotik-gateway-v37"

    def _require_live_ready(self) -> dict:
        state = production_readiness()
        if not state["configurationReady"]:
            raise ContractError(
                "production connector configuration is incomplete: " + ", ".join(state["missing"]),
                503,
                "production_not_ready",
            )
        if state["connectivityRequired"] and not state["connectivityVerified"]:
            raise ContractError("production connectivity preflight is required or stale", 503, "connectivity_preflight_required")
        live = live_driver_readiness()
        if not live["ready"]:
            raise ContractError("production live driver is not ready", 503, "live_driver_not_ready")
        return state

    def health(self) -> dict:
        state = production_readiness()
        return {
            "ok": True,
            "adapter": self.name,
            "adapterMode": "production-live",
            "contractVersion": CONTRACT_VERSION,
            "backendBuild": BACKEND_BUILD,
            "uiBuild": UI_BUILD,
            "serverTime": now_iso(),
            "mode": "production-live",
            "capabilities": [
                "health", "disconnect", "reauthenticate", "node-status",
                "request-ledger", "audit-ledger", "persistent-ledger",
                "idempotency", "rbac", "csrf", "production-readiness",
                "connectivity-check", "command-queue", "retry", "dead-letter",
                "cancel-command", "manual-retry", "queue-cleanup", "production-live",
                "mikrotik-gateway-live-driver"
            ],
            "persistence": "sqlite",
            "idempotency": True,
            "realNetworkCommands": True,
            "authMode": AUTH_MODE,
            "authRequired": True,
            "queue": queue_stats(),
            "queueHealth": queue_stats().get("health"),
            "productionReadiness": state,
            "liveDriver": live_driver_readiness(),
        }

    def session_command(self, payload: dict) -> dict:
        self._require_live_ready()
        operation = clean(payload.get("operation"), 64)
        if operation not in {"disconnect", "reauthenticate", "review"}:
            raise ContractError("operation is not supported", 400, "unsupported_operation")
        session = validate_session(payload)
        if operation == "review":
            return {
                "ok": True, "status": "completed", "contractVersion": CONTRACT_VERSION,
                "adapter": self.name, "adapterMode": "production-live", "processedAt": now_iso(),
                "realNetworkCommandSent": False, "sessionId": session["id"], "user": session["user"],
                "nas": session["nas"], "authServer": session["authServer"],
                "decision": "Not-Evaluated", "effect": "review-only", "reason": "Review-Only",
                "productionSite": PRODUCTION_SITE,
            }
        gateway_payload = {
            "contractVersion": CONTRACT_VERSION,
            "requestId": clean(payload.get("requestId"), 128),
            "operation": operation,
            "session": session,
            "productionSite": PRODUCTION_SITE,
            "requestedAt": clean(payload.get("requestedAt"), 64) or now_iso(),
        }
        response = _gateway_live_post(MIKROTIK_SESSION_PATH, gateway_payload)
        effect_default = "disconnected" if operation == "disconnect" else "reauthenticated"
        decision_default = "Operator-Disconnect" if operation == "disconnect" else "Access-Accept"
        return {
            "ok": True,
            "status": clean(response.get("status"), 64) or "completed",
            "contractVersion": CONTRACT_VERSION,
            "adapter": self.name,
            "adapterMode": "production-live",
            "processedAt": now_iso(),
            "realNetworkCommandSent": True,
            "sessionId": session["id"],
            "user": session["user"],
            "nas": session["nas"],
            "authServer": session["authServer"],
            "decision": clean(response.get("decision"), 128) or decision_default,
            "effect": clean(response.get("effect"), 128) or effect_default,
            "reason": clean(response.get("reason"), 160) or "MikroTik-Gateway",
            "gatewayHttpStatus": response.get("gatewayHttpStatus"),
            "gatewayLatencyMs": response.get("gatewayLatencyMs"),
            "credentialsExposed": False,
            "productionSite": PRODUCTION_SITE,
        }

    def node_status(self, payload: dict) -> dict:
        self._require_live_ready()
        node = payload.get("node")
        if not isinstance(node, dict):
            raise ContractError("node object is required", 400, "node_required")
        code, status = clean(node.get("code"), 128), clean(node.get("status"), 64)
        if not code:
            raise ContractError("node.code is required", 400, "node_code_required")
        if status not in ALLOWED_NODE_STATES:
            raise ContractError("node.status is invalid", 400, "invalid_node_status")
        gateway_payload = {
            "contractVersion": CONTRACT_VERSION,
            "requestId": clean(payload.get("requestId"), 128),
            "operation": "node-status",
            "node": {"code": code, "status": status},
            "impact": payload.get("impact") if isinstance(payload.get("impact"), dict) else {},
            "productionSite": PRODUCTION_SITE,
            "requestedAt": clean(payload.get("requestedAt"), 64) or now_iso(),
        }
        response = _gateway_live_post(MIKROTIK_NODE_PATH, gateway_payload)
        return {
            "ok": True,
            "status": clean(response.get("status"), 64) or "completed",
            "contractVersion": CONTRACT_VERSION,
            "adapter": self.name,
            "adapterMode": "production-live",
            "processedAt": now_iso(),
            "realNetworkCommandSent": True,
            "nodeCode": code,
            "nodeStatus": status,
            "gatewayHttpStatus": response.get("gatewayHttpStatus"),
            "gatewayLatencyMs": response.get("gatewayLatencyMs"),
            "credentialsExposed": False,
            "productionSite": PRODUCTION_SITE,
        }


def build_adapter() -> RadiusConnectorAdapter:
    validate_adapter_mode()
    if ADAPTER_MODE == "production-live":
        return ProductionLiveAdapter()
    if ADAPTER_MODE == "production-dry-run":
        return ProductionDryRunAdapter()
    return PreviewRadiusAdapter()


ADAPTER: RadiusConnectorAdapter = build_adapter()




def _backup_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _backup_metadata(path: Path, *, verify: bool = False) -> dict:
    stat = path.stat()
    integrity = None
    if verify:
        try:
            conn = sqlite3.connect(path, timeout=10)
            try:
                row = conn.execute("PRAGMA integrity_check").fetchone()
                integrity = bool(row and str(row[0]).lower() == "ok")
            finally:
                conn.close()
        except Exception:
            integrity = False
    return {
        "name": path.name,
        "bytes": stat.st_size,
        "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "sha256": _backup_sha256(path),
        "integrityVerified": integrity,
    }


def list_database_backups(limit: int = 50) -> list[dict]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    items = sorted(
        (p for p in BACKUP_DIR.iterdir() if p.is_file() and BACKUP_NAME_RE.fullmatch(p.name)),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return [_backup_metadata(p, verify=False) for p in items[:max(1, min(int(limit), 200))]]


def latest_backup_readiness() -> dict:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    items = sorted(
        (p for p in BACKUP_DIR.iterdir() if p.is_file() and BACKUP_NAME_RE.fullmatch(p.name)),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not items:
        return {
            "supported": True,
            "latest": None,
            "latestVerified": False,
            "offHostConfigured": bool(OFFHOST_BACKUP_ENABLE and _offhost_backup_ack_ok() and _offhost_backup_url_valid() and _secret_present(OFFHOST_BACKUP_GATEWAY_TOKEN)),
            "offHostLatestProtected": False,
            "liveRestoreEnabled": False,
            "retention": BACKUP_RETENTION,
        }
    latest = _backup_metadata(items[0], verify=True)
    return {
        "supported": True,
        "latest": latest,
        "latestVerified": bool(latest.get("integrityVerified")),
        "offHostConfigured": bool(OFFHOST_BACKUP_ENABLE and _offhost_backup_ack_ok() and _offhost_backup_url_valid() and _secret_present(OFFHOST_BACKUP_GATEWAY_TOKEN)),
        "offHostLatestProtected": bool(offhost_backup_readiness().get("latestProtected")),
        "liveRestoreEnabled": False,
        "retention": BACKUP_RETENTION,
    }


def _prune_database_backups() -> int:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    items = sorted(
        (p for p in BACKUP_DIR.iterdir() if p.is_file() and BACKUP_NAME_RE.fullmatch(p.name)),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    removed = 0
    for path in items[BACKUP_RETENTION:]:
        try:
            path.unlink()
            removed += 1
        except FileNotFoundError:
            pass
    return removed


def create_database_backup(identity: dict) -> dict:
    require_permission(identity, "manage-backups")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = now_dt().strftime("%Y%m%dT%H%M%SZ")
    suffix = secrets.token_urlsafe(6).replace("-", "_")
    filename = f"uchiha-radius-{stamp}-{suffix}.sqlite3"
    final_path = BACKUP_DIR / filename
    temp_path = BACKUP_DIR / (filename + ".tmp")

    with _DB_LOCK:
        source = db_connect()
        target = sqlite3.connect(temp_path, timeout=10)
        try:
            source.backup(target)
            row = target.execute("PRAGMA integrity_check").fetchone()
            if not row or str(row[0]).lower() != "ok":
                raise ContractError("backup integrity_check failed", 500, "backup_integrity_failed")
            target.commit()
        finally:
            target.close()
            source.close()

    temp_path.replace(final_path)
    result = _backup_metadata(final_path, verify=True)
    removed = _prune_database_backups()
    audit(
        identity["actor"], identity["role"], "backup.create", "success",
        detail={"name": final_path.name, "bytes": result["bytes"], "retentionPruned": removed},
    )
    offhost_result = None
    offhost_error = None
    if OFFHOST_BACKUP_AUTO_REPLICATE and offhost_backup_readiness().get("ready"):
        try:
            offhost_result = replicate_database_backup(final_path.name, identity)
        except ContractError as exc:
            offhost_error = exc.code
    return {
        "ok": True,
        "contractVersion": CONTRACT_VERSION,
        "backendBuild": BACKEND_BUILD,
        "backup": result,
        "retentionPruned": removed,
        "restorePerformed": False,
        "offHostCopied": bool(offhost_result and offhost_result.get("offHostCopied")),
        "offHostReplication": offhost_result.get("replication") if offhost_result else None,
        "offHostError": offhost_error,
        "secretsExposed": False,
    }


def verify_database_backup(name: str, identity: dict) -> dict:
    require_permission(identity, "read-backups")
    name = clean(name, 128)
    if not BACKUP_NAME_RE.fullmatch(name):
        raise ContractError("backup name is invalid", 400, "invalid_backup_name")
    path = BACKUP_DIR / name
    if not path.exists() or not path.is_file():
        raise ContractError("backup not found", 404, "backup_not_found")
    result = _backup_metadata(path, verify=True)
    audit(
        identity["actor"], identity["role"], "backup.verify",
        "success" if result["integrityVerified"] else "failed",
        detail={"name": name, "integrityVerified": result["integrityVerified"]},
    )
    if not result["integrityVerified"]:
        raise ContractError("backup integrity_check failed", 409, "backup_integrity_failed")
    return {
        "ok": True,
        "contractVersion": CONTRACT_VERSION,
        "backup": result,
        "restorePerformed": False,
        "secretsExposed": False,
    }




def _offhost_backup_ack_ok() -> bool:
    return hmac.compare_digest(OFFHOST_BACKUP_ACK, OFFHOST_BACKUP_ACK_REQUIRED)


def _offhost_backup_url_valid() -> bool:
    if not OFFHOST_BACKUP_GATEWAY_URL:
        return False
    parsed = urlparse(OFFHOST_BACKUP_GATEWAY_URL)
    if not parsed.hostname:
        return False
    if parsed.scheme == "https":
        return True
    return bool(OFFHOST_BACKUP_ALLOW_INSECURE and parsed.scheme == "http")


def _backup_replication_row_to_dict(row: sqlite3.Row) -> dict:
    remote_sha = row["remote_sha256"]
    local_sha = row["backup_sha256"]
    remote_bytes = row["remote_bytes"]
    local_bytes = int(row["backup_bytes"])
    return {
        "replicationId": row["replication_id"],
        "backupName": row["backup_name"],
        "backupSha256": local_sha,
        "backupBytes": local_bytes,
        "status": row["status"],
        "receiptId": row["receipt_id"],
        "remoteObjectId": row["remote_object_id"],
        "remoteSha256": remote_sha,
        "remoteBytes": int(remote_bytes) if remote_bytes is not None else None,
        "checksumVerified": bool(
            row["status"] == "replicated"
            and remote_sha
            and hmac.compare_digest(str(remote_sha), str(local_sha))
        ),
        "sizeVerified": bool(
            row["status"] == "replicated"
            and remote_bytes is not None
            and int(remote_bytes) == local_bytes
        ),
        "gatewayHttpStatus": row["gateway_http_status"],
        "gatewayLatencyMs": row["gateway_latency_ms"],
        "errorCode": row["error_code"],
        "actor": row["actor"],
        "role": row["role"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "completedAt": row["completed_at"],
        "secretsExposed": False,
    }


def backup_replications(limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT * FROM backup_replications
               ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [_backup_replication_row_to_dict(row) for row in rows]


def offhost_backup_readiness() -> dict:
    checks = {
        "enabled": OFFHOST_BACKUP_ENABLE,
        "acknowledged": _offhost_backup_ack_ok(),
        "gatewayConfigured": _offhost_backup_url_valid(),
        "tokenConfigured": _secret_present(OFFHOST_BACKUP_GATEWAY_TOKEN),
        "pathConfigured": bool(OFFHOST_BACKUP_GATEWAY_PATH.startswith("/")),
    }
    blockers = [key for key, ok in checks.items() if not ok]
    ready = not blockers

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    local_items = sorted(
        (p for p in BACKUP_DIR.iterdir() if p.is_file() and BACKUP_NAME_RE.fullmatch(p.name)),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    latest_local = _backup_metadata(local_items[0], verify=True) if local_items else None
    protected_row = None
    latest_row = None
    with _DB_LOCK, db_connect() as conn:
        latest_row = conn.execute(
            "SELECT * FROM backup_replications ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        if latest_local:
            protected_row = conn.execute(
                """SELECT * FROM backup_replications
                   WHERE backup_sha256=? AND status='replicated'
                   ORDER BY completed_at DESC LIMIT 1""",
                (latest_local["sha256"],),
            ).fetchone()

    protected = _backup_replication_row_to_dict(protected_row) if protected_row else None
    latest_replication = _backup_replication_row_to_dict(latest_row) if latest_row else None
    latest_protected = bool(
        latest_local
        and protected
        and protected["checksumVerified"]
        and protected["sizeVerified"]
        and protected["backupName"] == latest_local["name"]
    )
    return {
        "supported": True,
        "enabled": OFFHOST_BACKUP_ENABLE,
        "ready": ready,
        "acknowledged": checks["acknowledged"],
        "gatewayConfigured": checks["gatewayConfigured"],
        "gatewayHost": urlparse(OFFHOST_BACKUP_GATEWAY_URL).hostname if checks["gatewayConfigured"] else None,
        "tokenConfigured": checks["tokenConfigured"],
        "pathConfigured": checks["pathConfigured"],
        "autoReplicate": OFFHOST_BACKUP_AUTO_REPLICATE,
        "latestLocalBackup": latest_local,
        "latestReplication": latest_replication,
        "latestProtected": latest_protected,
        "latestReceiptId": protected["receiptId"] if protected else None,
        "latestRemoteObjectId": protected["remoteObjectId"] if protected else None,
        "blockers": blockers,
        "credentialsSource": "server-environment",
        "secretsExposed": False,
        "liveRestoreEnabled": False,
    }


def _offhost_backup_gateway_upload(path: Path, replication_id: str, meta: dict) -> dict:
    if not offhost_backup_readiness()["ready"]:
        raise ContractError("off-host backup gateway is not ready", 503, "offhost_backup_gateway_not_ready")

    parsed = urlparse(OFFHOST_BACKUP_GATEWAY_URL)
    connection_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    host = parsed.hostname
    port = parsed.port
    if not host:
        raise ContractError("off-host backup gateway URL is invalid", 503, "offhost_backup_gateway_not_ready")
    conn = connection_cls(host, port=port, timeout=OFFHOST_BACKUP_TIMEOUT_SECONDS)
    target = OFFHOST_BACKUP_GATEWAY_PATH
    started = time.perf_counter()
    headers = {
        "User-Agent": "UCHIHA-RADIUS-OffHostBackup/1.0",
        "Accept": "application/json",
        "Content-Type": "application/octet-stream",
        "Content-Length": str(meta["bytes"]),
        "Authorization": f"Bearer {OFFHOST_BACKUP_GATEWAY_TOKEN}",
        "X-Uchiha-Contract": CONTRACT_VERSION,
        "Idempotency-Key": replication_id,
        "X-Uchiha-Backup-Name": meta["name"],
        "X-Uchiha-Backup-SHA256": meta["sha256"],
        "X-Uchiha-Backup-Bytes": str(meta["bytes"]),
    }
    try:
        with path.open("rb") as stream:
            conn.request("POST", target, body=stream, headers=headers)
            response = conn.getresponse()
            status = int(response.status)
            body = response.read(MAX_BODY)
    except Exception as exc:
        raise ContractError(_probe_error(exc), 503, "offhost_backup_gateway_unavailable")
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if not (200 <= status < 300):
        if status >= 500 or status == 429:
            raise ContractError("off-host backup gateway unavailable", 503, "offhost_backup_gateway_unavailable")
        raise ContractError("off-host backup gateway rejected upload", 502, "offhost_backup_gateway_rejected")

    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except Exception:
        raise ContractError("off-host backup gateway returned invalid JSON", 502, "offhost_backup_invalid_response")
    if not isinstance(payload, dict):
        raise ContractError("off-host backup gateway returned invalid response", 502, "offhost_backup_invalid_response")

    allowed = {"status", "receiptId", "remoteObjectId", "sha256", "bytes"}
    unexpected = sorted(set(payload.keys()) - allowed)
    if unexpected or any(isinstance(v, (dict, list, tuple, set)) for v in payload.values()):
        raise ContractError("off-host backup gateway returned unexpected payload", 502, "offhost_backup_invalid_response")

    remote_status = clean(payload.get("status"), 64).lower()
    receipt_id = clean(payload.get("receiptId"), 160)
    remote_object_id = clean(payload.get("remoteObjectId"), 200)
    remote_sha = clean(payload.get("sha256"), 128).lower()
    try:
        remote_bytes = int(payload.get("bytes"))
    except (TypeError, ValueError):
        remote_bytes = -1

    if remote_status not in {"stored", "replicated", "completed"} or not receipt_id or not remote_object_id:
        raise ContractError("off-host backup gateway did not confirm storage", 502, "offhost_backup_not_confirmed")
    if not remote_sha or not hmac.compare_digest(remote_sha, str(meta["sha256"]).lower()):
        raise ContractError("off-host backup checksum mismatch", 502, "offhost_backup_checksum_mismatch")
    if remote_bytes != int(meta["bytes"]):
        raise ContractError("off-host backup size mismatch", 502, "offhost_backup_size_mismatch")

    return {
        "status": "replicated",
        "receiptId": receipt_id,
        "remoteObjectId": remote_object_id,
        "remoteSha256": remote_sha,
        "remoteBytes": remote_bytes,
        "gatewayHttpStatus": status,
        "gatewayLatencyMs": round((time.perf_counter() - started) * 1000, 2),
    }


def replicate_database_backup(name: str, identity: dict) -> dict:
    require_permission(identity, "manage-backups")
    if process_is_terminating():
        raise ContractError("off-host replication is blocked while process is terminating", 503, "process_terminating")
    name = clean(name, 128)
    if not BACKUP_NAME_RE.fullmatch(name):
        raise ContractError("backup name is invalid", 400, "invalid_backup_name")
    path = BACKUP_DIR / name
    if not path.exists() or not path.is_file():
        raise ContractError("backup not found", 404, "backup_not_found")

    meta = _backup_metadata(path, verify=True)
    if not meta.get("integrityVerified"):
        raise ContractError("backup integrity_check failed before replication", 409, "backup_integrity_failed")
    if not offhost_backup_readiness()["ready"]:
        raise ContractError("off-host backup gateway is not ready", 503, "offhost_backup_gateway_not_ready")

    with _OFFHOST_BACKUP_LOCK:
        with _DB_LOCK, db_connect() as conn:
            existing = conn.execute(
                """SELECT * FROM backup_replications
                   WHERE backup_sha256=? AND status='replicated'
                   ORDER BY completed_at DESC LIMIT 1""",
                (meta["sha256"],),
            ).fetchone()
        if existing:
            item = _backup_replication_row_to_dict(existing)
            return {
                "ok": True,
                "contractVersion": CONTRACT_VERSION,
                "backendBuild": BACKEND_BUILD,
                "idempotentReplay": True,
                "replication": item,
                "offHostCopied": True,
                "remoteVerified": bool(item["checksumVerified"] and item["sizeVerified"]),
                "liveRestorePerformed": False,
                "secretsExposed": False,
            }

        replication_id = "REPL-" + secrets.token_urlsafe(12)
        created = now_iso()
        with _DB_LOCK, db_connect() as conn:
            conn.execute(
                """INSERT INTO backup_replications(
                    replication_id, backup_name, backup_sha256, backup_bytes,
                    status, actor, role, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'uploading', ?, ?, ?, ?)""",
                (
                    replication_id, meta["name"], meta["sha256"], int(meta["bytes"]),
                    identity["actor"], identity["role"], created, created,
                ),
            )

        try:
            remote = _offhost_backup_gateway_upload(path, replication_id, meta)
        except ContractError as exc:
            final_status = "uncertain" if exc.status >= 503 else "rejected"
            with _DB_LOCK, db_connect() as conn:
                conn.execute(
                    """UPDATE backup_replications
                       SET status=?, error_code=?, updated_at=?
                       WHERE replication_id=?""",
                    (final_status, exc.code, now_iso(), replication_id),
                )
            audit(
                identity["actor"], identity["role"], "backup.replicate-offhost", "error",
                detail={
                    "replicationId": replication_id,
                    "backupName": meta["name"],
                    "backupSha256": meta["sha256"],
                    "status": final_status,
                    "errorCode": exc.code,
                },
            )
            raise

        completed = now_iso()
        with _DB_LOCK, db_connect() as conn:
            conn.execute(
                """UPDATE backup_replications
                   SET status='replicated', receipt_id=?, remote_object_id=?,
                       remote_sha256=?, remote_bytes=?, gateway_http_status=?,
                       gateway_latency_ms=?, error_code=NULL, updated_at=?, completed_at=?
                   WHERE replication_id=?""",
                (
                    remote["receiptId"], remote["remoteObjectId"], remote["remoteSha256"],
                    remote["remoteBytes"], remote["gatewayHttpStatus"], remote["gatewayLatencyMs"],
                    completed, completed, replication_id,
                ),
            )
            row = conn.execute(
                "SELECT * FROM backup_replications WHERE replication_id=?",
                (replication_id,),
            ).fetchone()

        item = _backup_replication_row_to_dict(row)
        audit(
            identity["actor"], identity["role"], "backup.replicate-offhost", "success",
            detail={
                "replicationId": replication_id,
                "backupName": item["backupName"],
                "backupSha256": item["backupSha256"],
                "receiptId": item["receiptId"],
                "remoteObjectId": item["remoteObjectId"],
                "checksumVerified": item["checksumVerified"],
                "sizeVerified": item["sizeVerified"],
            },
        )
        return {
            "ok": True,
            "contractVersion": CONTRACT_VERSION,
            "backendBuild": BACKEND_BUILD,
            "idempotentReplay": False,
            "replication": item,
            "offHostCopied": True,
            "remoteVerified": bool(item["checksumVerified"] and item["sizeVerified"]),
            "liveRestorePerformed": False,
            "secretsExposed": False,
        }


def _restore_drill_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "drillId": row["drill_id"],
        "backupName": row["backup_name"],
        "backupSha256": row["backup_sha256"],
        "status": row["status"],
        "passed": row["status"] == "passed" and bool(row["integrity_verified"]),
        "integrityVerified": bool(row["integrity_verified"]),
        "requiredTables": json.loads(row["required_tables_json"]),
        "missingTables": json.loads(row["missing_tables_json"]),
        "sourceBytes": int(row["source_bytes"]),
        "restoredBytes": int(row["restored_bytes"]),
        "elapsedMs": float(row["elapsed_ms"]),
        "actor": row["actor"],
        "role": row["role"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
    }


def restore_drills(limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            "SELECT * FROM backup_restore_drills ORDER BY completed_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_restore_drill_row_to_dict(row) for row in rows]


def latest_restore_drill_readiness() -> dict:
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM backup_restore_drills ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
    if not row:
        return {
            "supported": True,
            "latest": None,
            "latestRestoreDrillPassed": False,
            "liveRestoreEnabled": False,
        }
    item = _restore_drill_row_to_dict(row)
    return {
        "supported": True,
        "latest": item,
        "latestRestoreDrillPassed": bool(item["passed"]),
        "liveRestoreEnabled": False,
    }


def run_restore_drill(name: str, identity: dict) -> dict:
    require_permission(identity, "manage-backups")
    name = clean(name, 128)
    if not BACKUP_NAME_RE.fullmatch(name):
        raise ContractError("backup name is invalid", 400, "invalid_backup_name")
    source_path = BACKUP_DIR / name
    if not source_path.exists() or not source_path.is_file():
        raise ContractError("backup not found", 404, "backup_not_found")

    source_meta = _backup_metadata(source_path, verify=True)
    if not source_meta.get("integrityVerified"):
        raise ContractError("backup integrity_check failed before restore drill", 409, "backup_integrity_failed")

    drill_id = "DRILL-" + secrets.token_urlsafe(12)
    started_at = now_iso()
    started_perf = time.perf_counter()
    temp_path = BACKUP_DIR / (".restore-drill-" + secrets.token_urlsafe(10) + ".sqlite3.tmp")
    integrity_verified = False
    missing_tables: list[str] = []
    restored_bytes = 0
    status = "failed"

    try:
        source_uri = f"file:{source_path.resolve().as_posix()}?mode=ro"
        source = sqlite3.connect(source_uri, uri=True, timeout=10)
        target = sqlite3.connect(temp_path, timeout=10)
        try:
            source.backup(target)
            target.commit()
            row = target.execute("PRAGMA integrity_check").fetchone()
            integrity_verified = bool(row and str(row[0]).lower() == "ok")
            table_rows = target.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
            tables = {str(r[0]) for r in table_rows}
            missing_tables = sorted(RESTORE_DRILL_REQUIRED_TABLES - tables)
        finally:
            target.close()
            source.close()
        restored_bytes = temp_path.stat().st_size if temp_path.exists() else 0
        status = "passed" if integrity_verified and not missing_tables and restored_bytes > 0 else "failed"
    finally:
        elapsed_ms = round((time.perf_counter() - started_perf) * 1000, 3)
        completed_at = now_iso()
        if temp_path.exists():
            try: temp_path.unlink()
            except OSError: pass

    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO backup_restore_drills(
                drill_id, backup_name, backup_sha256, status, integrity_verified,
                required_tables_json, missing_tables_json, source_bytes, restored_bytes,
                elapsed_ms, actor, role, started_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                drill_id, name, source_meta["sha256"], status, 1 if integrity_verified else 0,
                json.dumps(sorted(RESTORE_DRILL_REQUIRED_TABLES)), json.dumps(missing_tables),
                int(source_meta["bytes"]), int(restored_bytes), elapsed_ms,
                identity["actor"], identity["role"], started_at, completed_at,
            ),
        )

    audit(
        identity["actor"], identity["role"], "backup.restore-drill", status,
        detail={"drillId": drill_id, "backupName": name, "missingTables": missing_tables, "integrityVerified": integrity_verified},
    )

    result = {
        "ok": status == "passed",
        "contractVersion": CONTRACT_VERSION,
        "backendBuild": BACKEND_BUILD,
        "drillId": drill_id,
        "backupName": name,
        "backupSha256": source_meta["sha256"],
        "status": status,
        "passed": status == "passed",
        "integrityVerified": integrity_verified,
        "requiredTables": sorted(RESTORE_DRILL_REQUIRED_TABLES),
        "missingTables": missing_tables,
        "sourceBytes": int(source_meta["bytes"]),
        "restoredBytes": int(restored_bytes),
        "elapsedMs": elapsed_ms,
        "temporaryDatabaseRemoved": not temp_path.exists(),
        "productionDatabaseReplaced": False,
        "liveRestorePerformed": False,
        "secretsExposed": False,
    }
    return result




def _remote_log_ack_ok() -> bool:
    return hmac.compare_digest(REMOTE_LOG_ACK, REMOTE_LOG_ACK_REQUIRED)


def _remote_log_url_valid() -> bool:
    if not REMOTE_LOG_URL:
        return False
    parsed = urlparse(REMOTE_LOG_URL)
    if not parsed.hostname:
        return False
    if parsed.scheme == "https":
        return True
    return bool(REMOTE_LOG_ALLOW_INSECURE and parsed.scheme == "http")


def _remote_log_ready_checks() -> dict:
    return {
        "enabled": REMOTE_LOG_ENABLE,
        "acknowledged": _remote_log_ack_ok(),
        "gatewayConfigured": _remote_log_url_valid(),
        "tokenConfigured": _secret_present(REMOTE_LOG_TOKEN),
        "pathConfigured": bool(REMOTE_LOG_PATH.startswith("/")),
        "workerEnabled": REMOTE_LOG_WORKER_ENABLED,
    }


def _log_outbox_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "logId": row["log_id"],
        "event": row["event_name"],
        "level": row["level"],
        "traceId": row["trace_id"],
        "correlationId": row["correlation_id"],
        "status": row["status"],
        "attempts": int(row["attempts"]),
        "maxAttempts": int(row["max_attempts"]),
        "nextAttemptAt": row["next_attempt_at"],
        "lastErrorCode": row["last_error_code"],
        "remoteReceiptId": row["remote_receipt_id"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "sentAt": row["sent_at"],
        "recordExposed": False,
        "secretsExposed": False,
    }


def log_delivery_items(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit), 500))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT * FROM log_delivery_outbox
               ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [_log_outbox_row_to_dict(row) for row in rows]


def log_delivery_stats() -> dict:
    global _REMOTE_LOG_DROPPED
    try:
        with _DB_LOCK, db_connect() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS c FROM log_delivery_outbox GROUP BY status"
            ).fetchall()
            oldest = conn.execute(
                """SELECT created_at FROM log_delivery_outbox
                   WHERE status IN ('queued','retry','running')
                   ORDER BY created_at ASC LIMIT 1"""
            ).fetchone()
        counts = {row["status"]: int(row["c"]) for row in rows}
    except Exception:
        counts = {}
        oldest = None
    with _REMOTE_LOG_DROP_LOCK:
        dropped = int(_REMOTE_LOG_DROPPED)
    pending = counts.get("queued", 0) + counts.get("retry", 0) + counts.get("running", 0)
    thread = _REMOTE_LOG_THREAD
    return {
        "queued": counts.get("queued", 0),
        "retry": counts.get("retry", 0),
        "running": counts.get("running", 0),
        "sent": counts.get("sent", 0),
        "deadLetter": counts.get("dead-letter", 0),
        "pending": pending,
        "oldestPendingAt": oldest["created_at"] if oldest else None,
        "workerEnabled": bool(REMOTE_LOG_WORKER_ENABLED),
        "workerAlive": bool(thread and thread.is_alive()),
        "droppedSinceStart": dropped,
        "maxBacklog": REMOTE_LOG_MAX_BACKLOG,
        "maxAttempts": REMOTE_LOG_MAX_ATTEMPTS,
    }


def remote_log_shipping_readiness() -> dict:
    checks = _remote_log_ready_checks()
    blockers = [k for k,v in checks.items() if not v]
    stats = log_delivery_stats()
    parsed = urlparse(REMOTE_LOG_URL)
    return {
        "enabled": REMOTE_LOG_ENABLE,
        "ready": not blockers,
        "gatewayHost": parsed.hostname if _remote_log_url_valid() else None,
        "tokenConfigured": checks["tokenConfigured"],
        "acknowledged": checks["acknowledged"],
        "workerEnabled": checks["workerEnabled"],
        "workerAlive": stats["workerAlive"],
        "batchSize": REMOTE_LOG_BATCH_SIZE,
        "maxAttempts": REMOTE_LOG_MAX_ATTEMPTS,
        "pending": stats["pending"],
        "queued": stats["queued"],
        "retry": stats["retry"],
        "running": stats["running"],
        "sent": stats["sent"],
        "deadLetter": stats["deadLetter"],
        "droppedSinceStart": stats["droppedSinceStart"],
        "maxBacklog": REMOTE_LOG_MAX_BACKLOG,
        "blockers": blockers,
        "payloadContract": "sanitized-structured-log-batch-v1",
        "requestBodiesShipped": False,
        "secretsRedacted": True,
        "secretsExposed": False,
    }


def _enqueue_remote_log(record: dict) -> None:
    global _REMOTE_LOG_DROPPED
    if not REMOTE_LOG_ENABLE:
        return
    sanitized = _redact_log_value(record)
    raw = json.dumps(sanitized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(raw.encode("utf-8")) > REMOTE_LOG_MAX_RECORD_BYTES:
        sanitized = {
            "timestamp": record.get("timestamp"),
            "level": record.get("level"),
            "service": record.get("service"),
            "event": record.get("event"),
            "backendBuild": BACKEND_BUILD,
            "uiBuild": UI_BUILD,
            "traceId": record.get("traceId"),
            "correlationId": record.get("correlationId"),
            "recordTruncated": True,
        }
        raw = json.dumps(sanitized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    try:
        with _DB_LOCK, db_connect() as conn:
            row = conn.execute(
                """SELECT COUNT(*) AS c FROM log_delivery_outbox
                   WHERE status IN ('queued','retry','running')"""
            ).fetchone()
            if row and int(row["c"]) >= REMOTE_LOG_MAX_BACKLOG:
                with _REMOTE_LOG_DROP_LOCK:
                    _REMOTE_LOG_DROPPED += 1
                return
            now = now_iso()
            conn.execute(
                """INSERT INTO log_delivery_outbox(
                    log_id,event_name,level,trace_id,correlation_id,record_json,
                    status,attempts,max_attempts,next_attempt_at,
                    created_at,updated_at
                ) VALUES (?,?,?,?,?,?,'queued',0,?,?,?,?)""",
                (
                    "LOG-" + secrets.token_urlsafe(12),
                    clean(record.get("event"), 128) or "event",
                    clean(record.get("level"), 16) or "INFO",
                    _valid_trace_id(record.get("traceId")),
                    _valid_trace_id(record.get("correlationId")),
                    raw,
                    REMOTE_LOG_MAX_ATTEMPTS,
                    now,
                    now,
                    now,
                ),
            )
    except Exception:
        with _REMOTE_LOG_DROP_LOCK:
            _REMOTE_LOG_DROPPED += 1


def _claim_log_batch() -> list[sqlite3.Row]:
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            rows = conn.execute(
                """SELECT * FROM log_delivery_outbox
                   WHERE status IN ('queued','retry')
                     AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                   ORDER BY created_at ASC LIMIT ?""",
                (now, REMOTE_LOG_BATCH_SIZE),
            ).fetchall()
            if not rows:
                conn.execute("COMMIT")
                return []
            ids = [row["log_id"] for row in rows]
            placeholders = ",".join("?" for _ in ids)
            conn.execute(
                f"""UPDATE log_delivery_outbox
                    SET status='running', attempts=attempts+1, updated_at=?
                    WHERE log_id IN ({placeholders})
                      AND status IN ('queued','retry')""",
                (now, *ids),
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    with _DB_LOCK, db_connect() as conn:
        placeholders = ",".join("?" for _ in ids)
        return conn.execute(
            f"""SELECT * FROM log_delivery_outbox
                WHERE log_id IN ({placeholders})
                ORDER BY created_at ASC""",
            tuple(ids),
        ).fetchall()


def _send_remote_log_batch(rows: list[sqlite3.Row]) -> dict:
    readiness = remote_log_shipping_readiness()
    if not readiness["ready"]:
        raise ContractError("remote log gateway is not ready", 503, "remote_log_gateway_not_ready")
    target = _safe_join_url(REMOTE_LOG_URL, REMOTE_LOG_PATH)
    records = [json.loads(row["record_json"]) for row in rows]
    batch_id = "LOGB-" + secrets.token_urlsafe(10)
    raw = json.dumps({
        "contractVersion": CONTRACT_VERSION,
        "backendBuild": BACKEND_BUILD,
        "batchId": batch_id,
        "records": records,
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib_request.Request(
        target,
        data=raw,
        method="POST",
        headers={
            "User-Agent": "UCHIHA-RADIUS-LogShipper/1.0",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {REMOTE_LOG_TOKEN}",
            "X-Uchiha-Contract": CONTRACT_VERSION,
            "Idempotency-Key": batch_id,
        },
    )
    opener = urllib_request.build_opener(urllib_request.ProxyHandler({}))
    started = time.perf_counter()
    try:
        with opener.open(req, timeout=REMOTE_LOG_TIMEOUT_SECONDS) as response:
            status = int(response.status)
            body = response.read(MAX_BODY)
    except urllib_error.HTTPError as exc:
        if int(exc.code) == 429 or int(exc.code) >= 500:
            raise ContractError("remote log gateway unavailable", 503, "remote_log_gateway_unavailable")
        raise ContractError("remote log gateway rejected batch", 502, "remote_log_gateway_rejected")
    except Exception as exc:
        raise ContractError(_probe_error(exc), 503, "remote_log_gateway_unavailable")
    if not (200 <= status < 300):
        raise ContractError("remote log gateway rejected batch", 502, "remote_log_gateway_rejected")
    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except Exception:
        raise ContractError("remote log gateway returned invalid JSON", 502, "remote_log_gateway_invalid_response")
    if not isinstance(payload, dict):
        raise ContractError("remote log gateway returned invalid response", 502, "remote_log_gateway_invalid_response")
    allowed = {"status","receiptId","accepted"}
    if set(payload.keys()) - allowed or any(isinstance(v,(dict,list,tuple,set)) for v in payload.values()):
        raise ContractError("remote log gateway returned unexpected payload", 502, "remote_log_gateway_invalid_response")
    remote_status = clean(payload.get("status"), 64).lower()
    receipt_id = clean(payload.get("receiptId"), 160)
    try:
        accepted = int(payload.get("accepted"))
    except (TypeError,ValueError):
        accepted = -1
    if remote_status not in {"accepted","stored","completed"} or not receipt_id or accepted != len(rows):
        raise ContractError("remote log gateway did not confirm full batch", 502, "remote_log_batch_not_confirmed")
    return {
        "receiptId": receipt_id,
        "accepted": accepted,
        "httpStatus": status,
        "latencyMs": round((time.perf_counter()-started)*1000, 2),
    }


def _finish_log_batch(rows: list[sqlite3.Row], receipt_id: str) -> None:
    now = now_iso()
    ids = [row["log_id"] for row in rows]
    placeholders = ",".join("?" for _ in ids)
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            f"""UPDATE log_delivery_outbox
                SET status='sent', remote_receipt_id=?, last_error_code=NULL,
                    updated_at=?, sent_at=?, next_attempt_at=NULL
                WHERE log_id IN ({placeholders})""",
            (receipt_id, now, now, *ids),
        )


def _fail_log_batch(rows: list[sqlite3.Row], exc: Exception) -> None:
    now = now_dt()
    code = exc.code if isinstance(exc, ContractError) else type(exc).__name__
    transient = isinstance(exc, ContractError) and exc.status >= 503
    with _DB_LOCK, db_connect() as conn:
        for row in rows:
            attempts = int(row["attempts"])
            max_attempts = int(row["max_attempts"])
            if transient and attempts < max_attempts:
                status = "retry"
                delay = REMOTE_LOG_RETRY_BASE_SECONDS * (2 ** max(0, attempts-1))
                next_at = (now + timedelta(seconds=delay)).isoformat()
            else:
                status = "dead-letter"
                next_at = None
            conn.execute(
                """UPDATE log_delivery_outbox
                   SET status=?, next_attempt_at=?, last_error_code=?, updated_at=?
                   WHERE log_id=?""",
                (status, next_at, code, now.isoformat(), row["log_id"]),
            )


def cleanup_log_delivery_outbox() -> dict:
    now = now_dt()
    sent_before = (now - timedelta(seconds=REMOTE_LOG_SENT_RETENTION_SECONDS)).isoformat()
    dead_before = (now - timedelta(seconds=REMOTE_LOG_DEAD_RETENTION_SECONDS)).isoformat()
    with _DB_LOCK, db_connect() as conn:
        sent = conn.execute(
            "DELETE FROM log_delivery_outbox WHERE status='sent' AND sent_at IS NOT NULL AND sent_at < ?",
            (sent_before,),
        ).rowcount
        dead = conn.execute(
            "DELETE FROM log_delivery_outbox WHERE status='dead-letter' AND updated_at < ?",
            (dead_before,),
        ).rowcount
    return {"sentRemoved": sent, "deadLetterRemoved": dead}


def recover_stale_log_delivery() -> int:
    with _DB_LOCK, db_connect() as conn:
        count = conn.execute(
            """UPDATE log_delivery_outbox
               SET status='retry', next_attempt_at=?, last_error_code='recovered_after_restart', updated_at=?
               WHERE status='running'""",
            (now_iso(), now_iso()),
        ).rowcount
    return int(count)


def log_shipping_worker_loop() -> None:
    cleanup_clock = 0
    while not _REMOTE_LOG_STOP.is_set():
        try:
            rows = _claim_log_batch()
            if rows:
                try:
                    result = _send_remote_log_batch(rows)
                    _finish_log_batch(rows, result["receiptId"])
                except Exception as exc:
                    _fail_log_batch(rows, exc)
                continue
            cleanup_clock += 1
            if cleanup_clock >= 120:
                cleanup_log_delivery_outbox()
                cleanup_clock = 0
        except Exception:
            pass
        _REMOTE_LOG_STOP.wait(REMOTE_LOG_POLL_SECONDS)


def start_log_shipping_worker() -> None:
    global _REMOTE_LOG_THREAD
    if not REMOTE_LOG_ENABLE or not REMOTE_LOG_WORKER_ENABLED or (_REMOTE_LOG_THREAD and _REMOTE_LOG_THREAD.is_alive()):
        return
    recover_stale_log_delivery()
    cleanup_log_delivery_outbox()
    _REMOTE_LOG_STOP.clear()
    _REMOTE_LOG_THREAD = threading.Thread(
        target=log_shipping_worker_loop,
        name="uchiha-remote-log-worker",
        daemon=True,
    )
    _REMOTE_LOG_THREAD.start()


def stop_log_shipping_worker() -> None:
    _REMOTE_LOG_STOP.set()
    thread = _REMOTE_LOG_THREAD
    if thread and thread.is_alive():
        thread.join(timeout=2.0)


def retry_log_delivery(log_id: str, identity: dict) -> dict:
    require_permission(identity, "manage-runtime")
    log_id = clean(log_id, 128)
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute("SELECT * FROM log_delivery_outbox WHERE log_id=?", (log_id,)).fetchone()
        if not row:
            raise ContractError("log delivery item not found", 404, "log_delivery_not_found")
        if row["status"] not in {"retry","dead-letter"}:
            raise ContractError("log delivery item is not retryable", 409, "log_delivery_not_retryable")
        conn.execute(
            """UPDATE log_delivery_outbox
               SET status='queued', attempts=0, next_attempt_at=?, last_error_code=NULL,
                   remote_receipt_id=NULL, sent_at=NULL, updated_at=?
               WHERE log_id=?""",
            (now, now, log_id),
        )
        updated = conn.execute("SELECT * FROM log_delivery_outbox WHERE log_id=?", (log_id,)).fetchone()
    audit(identity["actor"], identity["role"], "log-delivery.retry", "success", detail={"logId": log_id})
    return _log_outbox_row_to_dict(updated)


def _metric_route(path: str) -> str:
    path = urlparse(path or "/").path
    if path.startswith("/api/connectors/radius/commands/"):
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 6 and parts[-1] in {"cancel", "retry"}:
            return "/api/connectors/radius/commands/{id}/{action}"
        return "/api/connectors/radius/commands/{id}"
    if path.startswith("/api/connectors/radius/backups/"):
        if path.endswith("/verify"):
            return "/api/connectors/radius/backups/{name}/verify"
        if path.endswith("/restore-drill"):
            return "/api/connectors/radius/backups/{name}/restore-drill"
        if path.endswith("/replicate"):
            return "/api/connectors/radius/backups/{name}/replicate"
    if path.startswith("/api/connectors/radius/alerts/") and path.endswith("/ack"):
        return "/api/connectors/radius/alerts/{id}/ack"
    if path.startswith("/api/connectors/radius/alert-outbox/") and path.endswith("/retry"):
        return "/api/connectors/radius/alert-outbox/{id}/retry"
    return path[:120]


def _record_http_metric(method: str, path: str, status: int, response_bytes: int, started: float | None) -> None:
    latency_ms = round(max(0.0, (time.perf_counter() - started) * 1000), 3) if started else 0.0
    route = _metric_route(path)
    code = str(int(status))
    with _METRICS_LOCK:
        _HTTP_METRICS["requestsTotal"] += 1
        _HTTP_METRICS["responseBytesTotal"] += max(0, int(response_bytes))
        _HTTP_METRICS["latencyMsTotal"] += latency_ms
        _HTTP_METRICS["latencyMsMax"] = max(_HTTP_METRICS["latencyMsMax"], latency_ms)
        _HTTP_METRICS["status"][code] += 1
        _HTTP_METRICS["methods"][clean(method, 16) or "UNKNOWN"] += 1
        item = _HTTP_METRICS["routes"][route]
        item["count"] += 1
        item["status"][code] += 1
        item["latencyMsTotal"] += latency_ms
        item["latencyMsMax"] = max(item["latencyMsMax"], latency_ms)


def _http_metrics_snapshot() -> dict:
    with _METRICS_LOCK:
        total = int(_HTTP_METRICS["requestsTotal"])
        routes = {}
        for route, item in _HTTP_METRICS["routes"].items():
            count = int(item["count"])
            routes[route] = {
                "count": count,
                "status": dict(item["status"]),
                "avgLatencyMs": round(item["latencyMsTotal"] / count, 3) if count else 0.0,
                "maxLatencyMs": round(item["latencyMsMax"], 3),
            }
        return {
            "requestsTotal": total,
            "responseBytesTotal": int(_HTTP_METRICS["responseBytesTotal"]),
            "avgLatencyMs": round(_HTTP_METRICS["latencyMsTotal"] / total, 3) if total else 0.0,
            "maxLatencyMs": round(float(_HTTP_METRICS["latencyMsMax"]), 3),
            "status": dict(_HTTP_METRICS["status"]),
            "methods": dict(_HTTP_METRICS["methods"]),
            "routes": routes,
        }


def operational_metrics() -> dict:
    http = _http_metrics_snapshot()
    queue = queue_stats()
    with _DB_LOCK, db_connect() as conn:
        request_total_row = conn.execute("SELECT COUNT(*) AS c FROM connector_requests").fetchone()
        audit_rows = conn.execute("SELECT outcome, COUNT(*) AS c FROM audit_events GROUP BY outcome").fetchall()
        op_rows = conn.execute("SELECT operation, COUNT(*) AS c FROM connector_requests GROUP BY operation").fetchall()
    status = http["status"]
    http4xx = sum(int(v) for k,v in status.items() if str(k).startswith("4"))
    http5xx = sum(int(v) for k,v in status.items() if str(k).startswith("5"))
    total = int(http["requestsTotal"])
    return {
        "ok": True,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "uptimeSeconds": round(max(0.0, time.time() - _PROCESS_STARTED_AT), 3),
        "http": http,
        "summary": {
            "requestsTotal": total,
            "http4xx": http4xx,
            "http5xx": http5xx,
            "errorRate": round((http4xx + http5xx) / total, 6) if total else 0.0,
            "avgLatencyMs": http["avgLatencyMs"],
            "maxLatencyMs": http["maxLatencyMs"],
            "pending": queue.get("pending", 0),
            "deadLetter": queue.get("deadLetter", 0),
            "failed": queue.get("failed", 0),
            "queueHealth": queue.get("health"),
            "queueWorkerAlive": queue.get("workerAlive"),
            "ledgerRequests": int(request_total_row["c"]) if request_total_row else 0,
        },
        "commandsByOperation": {r["operation"]: int(r["c"]) for r in op_rows},
        "auditOutcomes": {r["outcome"]: int(r["c"]) for r in audit_rows},
        "maintenanceMode": maintenance_enabled(),
        "secretsExposed": False,
        "serverTime": now_iso(),
    }


def prometheus_metrics() -> str:
    data=operational_metrics()
    s=data["summary"]
    http=data["http"]
    lines=[
        "# HELP uchiha_radius_uptime_seconds Backend process uptime.",
        "# TYPE uchiha_radius_uptime_seconds gauge",
        f"uchiha_radius_uptime_seconds {data['uptimeSeconds']}",
        "# HELP uchiha_radius_http_requests_total Connector HTTP responses.",
        "# TYPE uchiha_radius_http_requests_total counter",
        f"uchiha_radius_http_requests_total {s['requestsTotal']}",
        f"uchiha_radius_http_4xx_total {s['http4xx']}",
        f"uchiha_radius_http_5xx_total {s['http5xx']}",
        f"uchiha_radius_http_latency_ms_avg {s['avgLatencyMs']}",
        f"uchiha_radius_http_latency_ms_max {s['maxLatencyMs']}",
        f"uchiha_radius_queue_pending {s['pending']}",
        f"uchiha_radius_queue_dead_letter {s['deadLetter']}",
        f"uchiha_radius_maintenance_mode {1 if data['maintenanceMode'] else 0}",
    ]
    for code,count in sorted(http["status"].items()):
        if re.fullmatch(r"[1-5][0-9]{2}",str(code)):
            lines.append(f'uchiha_radius_http_responses_total{{status="{code}"}} {int(count)}')
    return "\n".join(lines)+"\n"



def load_runtime_control() -> None:
    global _RUNTIME_MAINTENANCE_ENABLED, _RUNTIME_MAINTENANCE_REASON
    global _RUNTIME_MAINTENANCE_UPDATED_AT, _RUNTIME_MAINTENANCE_UPDATED_BY
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute(
            """SELECT enabled, reason, updated_at, updated_by
               FROM runtime_control WHERE control_key='maintenance'"""
        ).fetchone()
    with _RUNTIME_CONTROL_LOCK:
        if row:
            _RUNTIME_MAINTENANCE_ENABLED = bool(row["enabled"])
            _RUNTIME_MAINTENANCE_REASON = clean(row["reason"], 160)
            _RUNTIME_MAINTENANCE_UPDATED_AT = row["updated_at"]
            _RUNTIME_MAINTENANCE_UPDATED_BY = row["updated_by"]
        else:
            _RUNTIME_MAINTENANCE_ENABLED = False
            _RUNTIME_MAINTENANCE_REASON = ""
            _RUNTIME_MAINTENANCE_UPDATED_AT = None
            _RUNTIME_MAINTENANCE_UPDATED_BY = None


def maintenance_control_state() -> dict:
    with _RUNTIME_CONTROL_LOCK:
        runtime_enabled = bool(_RUNTIME_MAINTENANCE_ENABLED)
        runtime_reason = _RUNTIME_MAINTENANCE_REASON
        updated_at = _RUNTIME_MAINTENANCE_UPDATED_AT
        updated_by = _RUNTIME_MAINTENANCE_UPDATED_BY

    effective = bool(MAINTENANCE_MODE or runtime_enabled)
    if MAINTENANCE_MODE:
        source = "environment"
        reason = MAINTENANCE_REASON or runtime_reason or None
    elif runtime_enabled:
        source = "runtime"
        reason = runtime_reason or None
    else:
        source = "none"
        reason = None

    return {
        "enabled": effective,
        "envForced": bool(MAINTENANCE_MODE),
        "runtimeEnabled": runtime_enabled,
        "runtimePersisted": True,
        "source": source,
        "reason": reason,
        "updatedAt": updated_at,
        "updatedBy": updated_by,
    }


def maintenance_enabled() -> bool:
    return bool(maintenance_control_state()["enabled"])



def deployment_drain_status() -> dict:
    maintenance = maintenance_control_state()
    queue = queue_stats()
    running = int(queue.get("running") or 0)
    pending = int(queue.get("pending") or 0)
    if not maintenance["enabled"]:
        phase = "inactive"
        drained = False
    elif running > 0:
        phase = "draining"
        drained = False
    else:
        phase = "drained"
        drained = True
    return {
        "phase": phase,
        "drained": drained,
        "maintenanceEnabled": bool(maintenance["enabled"]),
        "running": running,
        "queuedOrRetry": pending,
        "queueHealth": queue.get("health"),
        "workerAlive": queue.get("workerAlive"),
        "safeForProcessMaintenance": drained,
        "checkedAt": now_iso(),
    }


def enter_maintenance_and_wait(reason: str, timeout_seconds, identity: dict) -> dict:
    require_permission(identity, "manage-runtime")
    try:
        timeout = float(timeout_seconds if timeout_seconds is not None else DRAIN_MAX_WAIT_SECONDS)
    except (TypeError, ValueError):
        raise ContractError("timeoutSeconds must be numeric", 400, "invalid_drain_timeout")
    timeout = max(0.0, min(timeout, DRAIN_MAX_WAIT_SECONDS))

    state = set_runtime_maintenance(True, reason, identity)
    started = time.monotonic()
    last = deployment_drain_status()
    while not last["drained"] and (time.monotonic() - started) < timeout:
        time.sleep(DRAIN_POLL_SECONDS)
        last = deployment_drain_status()

    elapsed_ms = round((time.monotonic() - started) * 1000, 2)
    result = {
        "maintenance": state,
        "drain": last,
        "timeoutSeconds": timeout,
        "elapsedMs": elapsed_ms,
        "timedOut": not last["drained"],
    }
    audit(
        identity["actor"], identity["role"], "runtime.maintenance.drain",
        "success" if last["drained"] else "timeout",
        detail={
            "phase": last["phase"],
            "running": last["running"],
            "queuedOrRetry": last["queuedOrRetry"],
            "elapsedMs": elapsed_ms,
            "timedOut": result["timedOut"],
        },
    )
    return result


def set_runtime_maintenance(enabled: bool, reason: str, identity: dict) -> dict:
    require_permission(identity, "manage-runtime")
    if not isinstance(enabled, bool):
        raise ContractError("enabled must be boolean", 400, "invalid_maintenance_enabled")
    reason = clean(reason, 160)

    if MAINTENANCE_MODE and not enabled:
        raise ContractError(
            "maintenance is forced by UCHIHA_MAINTENANCE_MODE and cannot be disabled at runtime",
            409,
            "maintenance_env_forced",
        )

    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO runtime_control(control_key, enabled, reason, updated_at, updated_by)
               VALUES ('maintenance', ?, ?, ?, ?)
               ON CONFLICT(control_key) DO UPDATE SET
                   enabled=excluded.enabled,
                   reason=excluded.reason,
                   updated_at=excluded.updated_at,
                   updated_by=excluded.updated_by""",
            (1 if enabled else 0, reason if enabled else "", now, identity["actor"]),
        )

    load_runtime_control()
    state = maintenance_control_state()
    audit(
        identity["actor"], identity["role"], "runtime.maintenance.set", "success",
        detail={
            "runtimeEnabled": state["runtimeEnabled"],
            "effectiveEnabled": state["enabled"],
            "source": state["source"],
            "reason": state["reason"],
        },
    )
    return state



def process_is_terminating() -> bool:
    return _PROCESS_TERMINATING.is_set()


def process_lifecycle_state() -> dict:
    try:
        queue = queue_stats()
        running = int(queue.get("running") or 0)
        pending = int(queue.get("pending") or 0)
    except Exception:
        running = 0
        pending = 0
    with _PROCESS_LIFECYCLE_LOCK:
        signal_name = _PROCESS_TERMINATION_SIGNAL
        requested_at = _PROCESS_TERMINATION_REQUESTED_AT
        drained_flag = _PROCESS_TERMINATION_DRAINED
        timed_out = _PROCESS_TERMINATION_TIMED_OUT
        completed_at = _PROCESS_TERMINATION_COMPLETED_AT
    terminating = process_is_terminating()
    drained = bool(terminating and (drained_flag or running == 0))
    phase = "terminating" if terminating else "running"
    return {
        "phase": phase,
        "terminating": terminating,
        "acceptingNetworkCommands": not terminating,
        "signal": signal_name,
        "requestedAt": requested_at,
        "running": running,
        "queuedOrRetry": pending,
        "drained": drained,
        "timedOut": timed_out,
        "completedAt": completed_at,
        "timeoutSeconds": GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS,
        "pollSeconds": GRACEFUL_SHUTDOWN_POLL_SECONDS,
    }


def _graceful_shutdown_worker() -> None:
    global _PROCESS_TERMINATION_DRAINED, _PROCESS_TERMINATION_TIMED_OUT
    global _PROCESS_TERMINATION_COMPLETED_AT
    started = time.monotonic()
    drained = False
    while (time.monotonic() - started) < GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS:
        try:
            if int(queue_stats().get("running") or 0) == 0:
                drained = True
                break
        except Exception:
            break
        time.sleep(GRACEFUL_SHUTDOWN_POLL_SECONDS)

    with _PROCESS_LIFECYCLE_LOCK:
        _PROCESS_TERMINATION_DRAINED = drained
        _PROCESS_TERMINATION_TIMED_OUT = not drained
        _PROCESS_TERMINATION_COMPLETED_AT = now_iso()

    try:
        audit(
            "system", "system", "process.graceful-shutdown",
            "success" if drained else "timeout",
            detail={
                "signal": _PROCESS_TERMINATION_SIGNAL,
                "drained": drained,
                "running": int(queue_stats().get("running") or 0),
                "elapsedMs": round((time.monotonic()-started)*1000, 2),
            },
        )
    except Exception:
        pass

    httpd = _HTTPD
    if httpd is not None:
        httpd.shutdown()


def begin_graceful_shutdown(signal_name: str) -> bool:
    global _SHUTDOWN_THREAD, _PROCESS_TERMINATION_SIGNAL, _PROCESS_TERMINATION_REQUESTED_AT
    if _PROCESS_TERMINATING.is_set():
        return False
    with _PROCESS_LIFECYCLE_LOCK:
        if _PROCESS_TERMINATING.is_set():
            return False
        _PROCESS_TERMINATION_SIGNAL = clean(signal_name, 32) or "SIGTERM"
        _PROCESS_TERMINATION_REQUESTED_AT = now_iso()
        _PROCESS_TERMINATING.set()
    thread = threading.Thread(
        target=_graceful_shutdown_worker,
        name="uchiha-graceful-shutdown",
        daemon=True,
    )
    _SHUTDOWN_THREAD = thread
    thread.start()
    return True


def _process_signal_handler(signum, _frame) -> None:
    try:
        name = signal.Signals(signum).name
    except Exception:
        name = f"SIGNAL-{signum}"
    begin_graceful_shutdown(name)


def service_liveness() -> dict:
    return {
        "ok": True,
        "alive": True,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "startedAt": _PROCESS_STARTED_ISO,
        "uptimeSeconds": round(max(0.0, time.time() - _PROCESS_STARTED_AT), 3),
        "processLifecycle": process_lifecycle_state(),
        "serverTime": now_iso(),
    }



def _schema_missing_conn(conn: sqlite3.Connection) -> list[str]:
    missing: list[str] = []
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    existing_tables = {str(row[0]) for row in rows}
    for table, required_columns in DATABASE_SCHEMA_REQUIRED_COLUMNS.items():
        if table not in existing_tables:
            missing.append(f"missing-table:{table}")
            continue
        columns = {
            str(row[1])
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        for column in sorted(required_columns - columns):
            missing.append(f"missing-column:{table}.{column}")
    return missing


def database_schema_state() -> dict:
    try:
        with db_connect() as conn:
            current = int(conn.execute("PRAGMA user_version").fetchone()[0])
            missing = _schema_missing_conn(conn)
            rows = conn.execute(
                """SELECT migration_id, source_version, target_version,
                          description, applied_at, backend_build
                   FROM schema_migrations
                   ORDER BY applied_at DESC, target_version DESC LIMIT 20"""
            ).fetchall() if "schema_migrations" not in {x.split(":",1)[-1] for x in missing if x.startswith("missing-table:")} else []
        migrations = [{
            "migrationId": row["migration_id"],
            "sourceVersion": int(row["source_version"]),
            "targetVersion": int(row["target_version"]),
            "description": row["description"],
            "appliedAt": row["applied_at"],
            "backendBuild": row["backend_build"],
        } for row in rows]
        compatible = current == DATABASE_SCHEMA_VERSION and not missing
        return {
            "expectedVersion": DATABASE_SCHEMA_VERSION,
            "currentVersion": current,
            "compatible": compatible,
            "newerThanBackend": current > DATABASE_SCHEMA_VERSION,
            "migrationRequired": current < DATABASE_SCHEMA_VERSION,
            "missing": missing,
            "migrationCount": len(migrations),
            "latestMigration": migrations[0] if migrations else None,
            "recentMigrations": migrations,
            "backendBuild": BACKEND_BUILD,
        }
    except Exception as exc:
        return {
            "expectedVersion": DATABASE_SCHEMA_VERSION,
            "currentVersion": None,
            "compatible": False,
            "newerThanBackend": False,
            "migrationRequired": False,
            "missing": ["schema-state-unavailable"],
            "migrationCount": 0,
            "latestMigration": None,
            "recentMigrations": [],
            "backendBuild": BACKEND_BUILD,
            "error": type(exc).__name__,
        }


def _database_ready() -> bool:
    try:
        with db_connect() as conn:
            row = conn.execute("SELECT 1").fetchone()
            current = int(conn.execute("PRAGMA user_version").fetchone()[0])
            missing = _schema_missing_conn(conn)
            return bool(
                row and int(row[0]) == 1
                and current == DATABASE_SCHEMA_VERSION
                and not missing
            )
    except Exception:
        return False


def service_readiness() -> dict:
    db_ok = _database_ready()
    queue = queue_stats() if db_ok else {"health": "unavailable", "workerAlive": False}
    prod = production_readiness() if db_ok else {
        "configurationReady": False,
        "connectivityVerified": False,
        "connectivityRequired": REQUIRE_CONNECTIVITY_PREFLIGHT,
    }

    if ADAPTER_MODE == "production-live":
        adapter_ready = bool(
            prod.get("configurationReady")
            and (prod.get("connectivityVerified") or not prod.get("connectivityRequired"))
            and live_driver_readiness().get("ready")
        )
    elif ADAPTER_MODE == "production-dry-run":
        adapter_ready = bool(prod.get("dryRunReady"))
    else:
        adapter_ready = True

    queue_ready = bool(
        not QUEUE_WORKER_ENABLED
        or queue.get("workerAlive")
        or queue.get("pending", 0) == 0
    ) and queue.get("health") != "degraded"

    maintenance = maintenance_control_state()
    lifecycle = process_lifecycle_state()
    database_schema = database_schema_state()
    transport_security = transport_security_readiness()
    gateway_authentication = gateway_authentication_readiness()
    operator_authentication = operator_session_readiness()
    edge_protection = edge_protection_readiness()
    instance_lease = instance_lock_readiness()
    host_preflight = host_environment_readiness()
    blockers = []
    if HOST_PREFLIGHT_REQUIRED and not host_preflight.get("ready"):
        blockers.append("host-preflight-not-ready")
    if INSTANCE_LOCK_REQUIRED and not instance_lease.get("held"):
        blockers.append("single-instance-lock-not-held")
    if operator_authentication.get("active") and not operator_authentication.get("ready"):
        blockers.append("operator-authentication-not-ready")
    if not edge_protection.get("ready"):
        blockers.append("edge-protection-not-ready")
    if AUTH_MODE == "gateway" and not gateway_authentication.get("ready"):
        blockers.append("gateway-authentication-not-ready")
    if PUBLIC_HTTPS_REQUIRED and not transport_security.get("httpsEnforcementReady"):
        blockers.append("transport-security-config-invalid")
    if lifecycle["terminating"]: blockers.append("process-terminating")
    if maintenance["enabled"]: blockers.append("maintenance-mode")
    if not db_ok:
        blockers.append("database-schema-incompatible" if not database_schema.get("compatible") else "database-unavailable")
    if not queue_ready: blockers.append("queue-not-ready")
    if not adapter_ready: blockers.append("adapter-not-ready")

    ready = not blockers
    return {
        "ok": ready,
        "ready": ready,
        "maintenanceMode": maintenance["enabled"],
        "maintenanceReason": maintenance["reason"],
        "maintenanceControl": {**maintenance, "drain": deployment_drain_status()},
        "processLifecycle": lifecycle,
        "databaseReady": db_ok,
        "databaseSchema": database_schema,
        "transportSecurity": transport_security,
        "gatewayAuthentication": gateway_authentication,
        "operatorAuthentication": operator_authentication,
        "edgeProtection": edge_protection,
        "instanceLease": instance_lease,
        "hostPreflight": host_preflight,
        "queueReady": queue_ready,
        "queueHealth": queue.get("health"),
        "adapterReady": adapter_ready,
        "adapterMode": ADAPTER_MODE,
        "blockers": blockers,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "serverTime": now_iso(),
    }


def ops_summary() -> dict:
    live = service_liveness()
    ready = service_readiness()
    backup = latest_backup_readiness()
    queue = queue_stats() if ready.get("databaseReady") else {"health": "unavailable"}
    return {
        "ok": True,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "liveness": {
            "alive": live["alive"],
            "startedAt": live["startedAt"],
            "uptimeSeconds": live["uptimeSeconds"],
        },
        "readiness": ready,
        "processLifecycle": process_lifecycle_state(),
        "maintenance": {**maintenance_control_state(), "drain": deployment_drain_status()},
        "adapter": {
            "mode": ADAPTER_MODE,
            "name": ADAPTER.name if "ADAPTER" in globals() else None,
        },
        "queue": {
            "health": queue.get("health"),
            "workerAlive": queue.get("workerAlive"),
            "pending": queue.get("pending"),
            "deadLetter": queue.get("deadLetter"),
            "failed": queue.get("failed"),
        },
        "databaseSchema": database_schema_state(),
        "transportSecurity": transport_security_readiness(),
        "gatewayAuthentication": gateway_authentication_readiness(),
        "operatorAuthentication": operator_session_readiness(),
        "launchReadiness": launch_readiness(),
        "releaseIntegrity": release_integrity_readiness(),
        "edgeProtection": edge_protection_readiness(),
        "instanceLease": instance_lock_readiness(),
        "hostPreflight": host_environment_readiness(),
        "backup": backup,
        "offHostBackup": offhost_backup_readiness(),
        "recoveryDrill": latest_restore_drill_readiness(),
        "deploymentCheckpoint": latest_deployment_checkpoint(),
        "postDeployVerification": latest_post_deploy_verification(),
        "voucherProvisioning": voucher_provisioning_readiness(),
        "metrics": operational_metrics()["summary"],
        "alerts": alert_summary(refresh=False),
        "alertNotificationDelivery": telegram_alert_readiness(),
        "remoteLogShipping": remote_log_shipping_readiness(),
        "apiContract": api_contract_summary(),
        "requestTracing": {
            "enabled": True,
            "logFormat": LOG_FORMAT,
            "logLevel": LOG_LEVEL,
            "httpLogging": LOG_HTTP,
            "auditLinked": True,
            "queueCorrelationLinked": True,
            "requestBodiesLogged": False,
            "secretsRedacted": True,
        },
        "secretsExposed": False,
        "serverTime": now_iso(),
    }


def require_not_maintenance(operation: str) -> None:
    if process_is_terminating():
        raise ContractError(
            f"operation {clean(operation, 64) or 'network-command'} is blocked while process is terminating",
            503,
            "process_terminating",
        )
    state = maintenance_control_state()
    if state["enabled"]:
        raise ContractError(
            f"operation {clean(operation, 64) or 'network-command'} is blocked while maintenance mode is enabled",
            503,
            "maintenance_mode",
        )



def _alert_age_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, (now_dt() - datetime.fromisoformat(value)).total_seconds())
    except Exception:
        return None


def _alert_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "alertId": row["alert_id"],
        "key": row["alert_key"],
        "severity": row["severity"],
        "title": row["title"],
        "detail": row["detail"],
        "status": row["status"],
        "occurrenceCount": int(row["occurrence_count"]),
        "metadata": json.loads(row["metadata_json"] or "{}"),
        "firstSeenAt": row["first_seen_at"],
        "lastSeenAt": row["last_seen_at"],
        "acknowledgedAt": row["acknowledged_at"],
        "acknowledgedBy": row["acknowledged_by"],
        "resolvedAt": row["resolved_at"],
        "acknowledged": bool(row["acknowledged_at"]),
    }


def operational_alerts(limit: int = 100, status: str | None = None) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    params: list = []
    where = ""
    if status in {"active", "resolved"}:
        where = " WHERE status=?"
        params.append(status)
    params.append(limit)
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            f"""SELECT * FROM operational_alerts{where}
                ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                         last_seen_at DESC LIMIT ?""",
            tuple(params),
        ).fetchall()
    return [_alert_row_to_dict(r) for r in rows]




def alert_outbox_stats() -> dict:
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS c FROM operational_alert_outbox GROUP BY status"
        ).fetchall()
        oldest = conn.execute(
            """SELECT created_at FROM operational_alert_outbox
               WHERE status IN ('queued','retry','running')
               ORDER BY created_at ASC LIMIT 1"""
        ).fetchone()
        stale_running_row = conn.execute(
            """SELECT COUNT(*) AS c FROM operational_alert_outbox
               WHERE status='running' AND updated_at <= ?""",
            ((now_dt()-timedelta(seconds=TELEGRAM_DELIVERY_STALE_RUNNING_SECONDS)).isoformat(),),
        ).fetchone()
    counts = {r["status"]: int(r["c"]) for r in rows}
    worker_alive = bool(_DELIVERY_THREAD and _DELIVERY_THREAD.is_alive()) if "_DELIVERY_THREAD" in globals() else False
    pending = counts.get("queued",0)+counts.get("retry",0)+counts.get("running",0)
    dead = counts.get("dead-letter",0)
    oldest_age = _alert_age_seconds(oldest["created_at"]) if oldest else None
    stale_running = int(stale_running_row["c"]) if stale_running_row else 0

    if dead > 0 or stale_running > 0 or (pending > 0 and TELEGRAM_DELIVERY_WORKER_ENABLED and not worker_alive):
        health = "degraded"
    elif pending >= TELEGRAM_DELIVERY_BACKLOG_WARNING or (oldest_age is not None and oldest_age >= TELEGRAM_DELIVERY_STALE_RUNNING_SECONDS):
        health = "warning"
    else:
        health = "healthy"

    return {
        "workerEnabled": TELEGRAM_DELIVERY_WORKER_ENABLED,
        "workerAlive": worker_alive,
        "health": health,
        "queued": counts.get("queued", 0),
        "retry": counts.get("retry", 0),
        "running": counts.get("running", 0),
        "sent": counts.get("sent", 0),
        "deadLetter": dead,
        "pending": pending,
        "staleRunning": stale_running,
        "oldestPendingAgeSeconds": round(oldest_age,3) if oldest_age is not None else None,
        "maxAttempts": TELEGRAM_DELIVERY_MAX_ATTEMPTS,
        "backlogWarningThreshold": TELEGRAM_DELIVERY_BACKLOG_WARNING,
        "staleRunningThresholdSeconds": TELEGRAM_DELIVERY_STALE_RUNNING_SECONDS,
    }


def alert_outbox_items(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT outbox_id, alert_id, alert_key, event_type, channel, status,
                      attempts, max_attempts, next_attempt_at, last_error_code,
                      created_at, updated_at, sent_at
               FROM operational_alert_outbox
               ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [{
        "outboxId": r["outbox_id"],
        "alertId": r["alert_id"],
        "alertKey": r["alert_key"],
        "eventType": r["event_type"],
        "channel": r["channel"],
        "status": r["status"],
        "attempts": int(r["attempts"]),
        "maxAttempts": int(r["max_attempts"]),
        "nextAttemptAt": r["next_attempt_at"],
        "lastErrorCode": r["last_error_code"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "sentAt": r["sent_at"],
    } for r in rows]


def _enqueue_alert_delivery(alert: dict, event_type: str) -> dict | None:
    readiness = telegram_alert_readiness()
    if not readiness["enabled"] or not readiness["ready"]:
        return None
    if event_type == "resolved" and not TELEGRAM_NOTIFY_RESOLVED:
        return None
    if event_type != "resolved" and not _telegram_severity_allowed(alert.get("severity") or ""):
        return None

    transition_marker = (
        clean(alert.get("resolvedAt"), 64)
        if event_type == "resolved"
        else clean(alert.get("firstSeenAt"), 64)
    ) or clean(alert.get("lastSeenAt"), 64) or now_iso()
    dedup_raw = f"telegram|{clean(alert.get('alertId'),128)}|{clean(event_type,32)}|{transition_marker}"
    dedup_key = hashlib.sha256(dedup_raw.encode("utf-8")).hexdigest()
    now = now_iso()
    outbox_id = "OUT-" + secrets.token_urlsafe(12)
    with _DB_LOCK, db_connect() as conn:
        existing = conn.execute(
            "SELECT * FROM operational_alert_outbox WHERE dedup_key=?",
            (dedup_key,),
        ).fetchone()
        if existing:
            return {
                "outboxId": existing["outbox_id"],
                "status": existing["status"],
                "deduplicated": True,
            }
        conn.execute(
            """INSERT INTO operational_alert_outbox(
                outbox_id, dedup_key, alert_id, alert_key, event_type, channel,
                status, attempts, max_attempts, next_attempt_at,
                last_error_code, created_at, updated_at, sent_at
            ) VALUES (?, ?, ?, ?, ?, 'telegram', 'queued', 0, ?, ?, NULL, ?, ?, NULL)""",
            (
                outbox_id, dedup_key, clean(alert.get("alertId"),128),
                clean(alert.get("key"),128), clean(event_type,32),
                TELEGRAM_DELIVERY_MAX_ATTEMPTS, now, now, now,
            ),
        )
    return {"outboxId": outbox_id, "status": "queued", "deduplicated": False}


def _claim_alert_outbox() -> sqlite3.Row | None:
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                """SELECT * FROM operational_alert_outbox
                   WHERE status IN ('queued','retry')
                     AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                   ORDER BY created_at ASC LIMIT 1""",
                (now,),
            ).fetchone()
            if not row:
                conn.execute("COMMIT")
                return None
            updated = conn.execute(
                """UPDATE operational_alert_outbox
                   SET status='running', attempts=attempts+1, updated_at=?
                   WHERE outbox_id=? AND status IN ('queued','retry')""",
                (now, row["outbox_id"]),
            ).rowcount
            conn.execute("COMMIT")
            if not updated:
                return None
        except Exception:
            conn.execute("ROLLBACK")
            raise
    with _DB_LOCK, db_connect() as conn:
        return conn.execute(
            "SELECT * FROM operational_alert_outbox WHERE outbox_id=?",
            (row["outbox_id"],),
        ).fetchone()


def _alert_for_outbox(row: sqlite3.Row) -> dict | None:
    with _DB_LOCK, db_connect() as conn:
        alert_row = conn.execute(
            "SELECT * FROM operational_alerts WHERE alert_id=?",
            (row["alert_id"],),
        ).fetchone()
    return _alert_row_to_dict(alert_row) if alert_row else None


def _telegram_send_once(alert: dict, event_type: str) -> dict:
    readiness = telegram_alert_readiness()
    if not readiness["ready"]:
        return {"ok": False, "transient": False, "errorCode": "telegram_not_ready", "httpStatus": None, "latencyMs": 0.0}

    url = f"{TELEGRAM_API_BASE_URL}/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    body = json.dumps({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": _telegram_alert_text(alert, event_type),
        "disable_web_page_preview": True,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib_request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    started = time.perf_counter()
    try:
        opener = urllib_request.build_opener(urllib_request.ProxyHandler({}))
        with opener.open(request, timeout=TELEGRAM_TIMEOUT_SECONDS) as response:
            status = int(response.status)
            raw = response.read(65536)
        latency = round((time.perf_counter()-started)*1000, 2)
        payload = json.loads(raw.decode("utf-8") or "{}")
        if 200 <= status < 300 and payload.get("ok") is True:
            return {"ok": True, "transient": False, "errorCode": None, "httpStatus": status, "latencyMs": latency}
        transient = status == 429 or status >= 500
        return {"ok": False, "transient": transient, "errorCode": "telegram_rejected", "httpStatus": status, "latencyMs": latency}
    except urllib_error.HTTPError as exc:
        latency = round((time.perf_counter()-started)*1000, 2)
        status = int(exc.code)
        return {
            "ok": False,
            "transient": status == 429 or status >= 500,
            "errorCode": "telegram_http_error",
            "httpStatus": status,
            "latencyMs": latency,
        }
    except Exception as exc:
        return {
            "ok": False,
            "transient": True,
            "errorCode": type(exc).__name__.lower()[:64],
            "httpStatus": None,
            "latencyMs": round((time.perf_counter()-started)*1000, 2),
        }


def _finish_alert_outbox(row: sqlite3.Row, result: dict) -> None:
    now = now_dt()
    attempts = int(row["attempts"])
    max_attempts = int(row["max_attempts"])
    alert = _alert_for_outbox(row) or {
        "alertId": row["alert_id"], "key": row["alert_key"],
        "severity": "info", "title": "Operational alert", "detail": "",
    }
    if result.get("ok"):
        status = "sent"
        next_attempt = None
        sent_at = now.isoformat()
        error_code = None
        delivery_status = "sent"
    else:
        transient = bool(result.get("transient"))
        if transient and attempts < max_attempts:
            delay = TELEGRAM_DELIVERY_RETRY_BASE_SECONDS * (2 ** max(0, attempts - 1))
            status = "retry"
            next_attempt = (now + timedelta(seconds=delay)).isoformat()
        else:
            status = "dead-letter"
            next_attempt = None
        sent_at = None
        error_code = clean(result.get("errorCode"), 64) or "delivery_failed"
        delivery_status = "failed"

    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """UPDATE operational_alert_outbox
               SET status=?, next_attempt_at=?, last_error_code=?,
                   updated_at=?, sent_at=?
               WHERE outbox_id=?""",
            (status, next_attempt, error_code, now.isoformat(), sent_at, row["outbox_id"]),
        )

    _store_alert_delivery(
        alert, row["event_type"], delivery_status,
        http_status=result.get("httpStatus"),
        latency_ms=result.get("latencyMs"),
        error_code=error_code,
    )


def _process_alert_outbox(row: sqlite3.Row) -> None:
    alert = _alert_for_outbox(row)
    if not alert:
        _finish_alert_outbox(row, {"ok": False, "transient": False, "errorCode": "alert_not_found", "httpStatus": None, "latencyMs": 0.0})
        return
    result = _telegram_send_once(alert, row["event_type"])
    _finish_alert_outbox(row, result)


_DELIVERY_STOP = threading.Event()
_DELIVERY_THREAD: threading.Thread | None = None
_LAST_DELIVERY_MONO = 0.0


def alert_delivery_worker_loop() -> None:
    global _LAST_DELIVERY_MONO
    while not _DELIVERY_STOP.is_set():
        try:
            row = _claim_alert_outbox()
            if row:
                wait_for = TELEGRAM_DELIVERY_MIN_INTERVAL_SECONDS - (time.monotonic() - _LAST_DELIVERY_MONO)
                if wait_for > 0:
                    _DELIVERY_STOP.wait(wait_for)
                    if _DELIVERY_STOP.is_set():
                        break
                _process_alert_outbox(row)
                _LAST_DELIVERY_MONO = time.monotonic()
                continue
        except Exception as exc:
            try:
                audit("system", "system", "alert.delivery.worker", "error", detail={"exception": type(exc).__name__})
            except Exception:
                pass
        _DELIVERY_STOP.wait(TELEGRAM_DELIVERY_POLL_SECONDS)


def recover_stale_alert_outbox() -> int:
    cutoff=(now_dt()-timedelta(seconds=TELEGRAM_DELIVERY_STALE_RUNNING_SECONDS)).isoformat()
    now=now_iso()
    with _DB_LOCK, db_connect() as conn:
        updated=conn.execute(
            """UPDATE operational_alert_outbox
               SET status='retry', next_attempt_at=?, last_error_code='stale_running_recovered',
                   updated_at=?
               WHERE status='running' AND updated_at <= ?""",
            (now,now,cutoff),
        ).rowcount
    return int(updated)


def cleanup_alert_outbox(identity: dict | None = None, *, force: bool = False) -> dict:
    now=now_dt()
    sent_cutoff=(now-timedelta(seconds=TELEGRAM_DELIVERY_SENT_RETENTION_SECONDS)).isoformat()
    dead_cutoff=(now-timedelta(seconds=TELEGRAM_DELIVERY_DEAD_RETENTION_SECONDS)).isoformat()
    delivery_cutoff=(now-timedelta(seconds=max(TELEGRAM_DELIVERY_SENT_RETENTION_SECONDS, TELEGRAM_DELIVERY_DEAD_RETENTION_SECONDS))).isoformat()
    with _DB_LOCK, db_connect() as conn:
        sent_removed=conn.execute(
            "DELETE FROM operational_alert_outbox WHERE status='sent' AND updated_at < ?",
            (sent_cutoff,),
        ).rowcount
        dead_removed=conn.execute(
            "DELETE FROM operational_alert_outbox WHERE status='dead-letter' AND updated_at < ?",
            (dead_cutoff,),
        ).rowcount
        history_removed=conn.execute(
            "DELETE FROM operational_alert_deliveries WHERE created_at < ?",
            (delivery_cutoff,),
        ).rowcount
    result={
        "sentRemoved":int(sent_removed),
        "deadLetterRemoved":int(dead_removed),
        "deliveryHistoryRemoved":int(history_removed),
        "sentRetentionSeconds":TELEGRAM_DELIVERY_SENT_RETENTION_SECONDS,
        "deadLetterRetentionSeconds":TELEGRAM_DELIVERY_DEAD_RETENTION_SECONDS,
    }
    if identity:
        audit(identity["actor"],identity["role"],"alert-outbox.cleanup","success",detail=result)
    return result


def start_alert_delivery_worker() -> None:
    global _DELIVERY_THREAD
    if not TELEGRAM_DELIVERY_WORKER_ENABLED or (_DELIVERY_THREAD and _DELIVERY_THREAD.is_alive()):
        return
    recover_stale_alert_outbox()
    cleanup_alert_outbox()
    _DELIVERY_STOP.clear()
    _DELIVERY_THREAD = threading.Thread(
        target=alert_delivery_worker_loop,
        name="uchiha-alert-delivery-worker",
        daemon=True,
    )
    _DELIVERY_THREAD.start()


def stop_alert_delivery_worker() -> None:
    _DELIVERY_STOP.set()
    thread = _DELIVERY_THREAD
    if thread and thread.is_alive():
        thread.join(timeout=2.0)


def retry_alert_outbox(outbox_id: str, identity: dict) -> dict:
    require_permission(identity, "manage-alerts")
    outbox_id = clean(outbox_id, 128)
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM operational_alert_outbox WHERE outbox_id=?",
            (outbox_id,),
        ).fetchone()
        if not row:
            raise ContractError("alert outbox item not found", 404, "alert_outbox_not_found")
        if row["status"] not in {"dead-letter", "retry"}:
            raise ContractError(
                f"outbox item in status {row['status']} cannot be retried",
                409,
                "alert_outbox_not_retryable",
            )
        conn.execute(
            """UPDATE operational_alert_outbox
               SET status='queued', attempts=0, next_attempt_at=?,
                   last_error_code=NULL, updated_at=?, sent_at=NULL
               WHERE outbox_id=?""",
            (now, now, outbox_id),
        )
        updated = conn.execute(
            "SELECT * FROM operational_alert_outbox WHERE outbox_id=?",
            (outbox_id,),
        ).fetchone()
    audit(identity["actor"], identity["role"], "alert-outbox.retry", "success",
          detail={"outboxId": outbox_id, "alertKey": updated["alert_key"]})
    for item in alert_outbox_items(200):
        if item["outboxId"] == outbox_id:
            return item
    raise ContractError("retried outbox item could not be reloaded", 500, "alert_outbox_reload_failed")


def telegram_alert_readiness() -> dict:
    parsed = urlparse(TELEGRAM_API_BASE_URL)
    scheme_ok = parsed.scheme == "https" or (TELEGRAM_ALLOW_INSECURE and parsed.scheme == "http")
    checks = {
        "enabled": TELEGRAM_ALERTS_ENABLED,
        "tokenConfigured": bool(TELEGRAM_BOT_TOKEN and len(TELEGRAM_BOT_TOKEN) >= 20),
        "chatConfigured": bool(TELEGRAM_CHAT_ID),
        "apiUrlValid": bool(parsed.hostname and scheme_ok),
        "severityValid": TELEGRAM_ALERT_MIN_SEVERITY in {"critical", "warning", "info"},
    }
    ready = bool(
        checks["enabled"] and checks["tokenConfigured"] and checks["chatConfigured"]
        and checks["apiUrlValid"] and checks["severityValid"]
    )
    last = None
    try:
        with _DB_LOCK, db_connect() as conn:
            row = conn.execute(
                """SELECT status, event_type, http_status, latency_ms, error_code, created_at
                   FROM operational_alert_deliveries
                   WHERE channel='telegram'
                   ORDER BY created_at DESC LIMIT 1"""
            ).fetchone()
        if row:
            last = {
                "status": row["status"],
                "eventType": row["event_type"],
                "httpStatus": row["http_status"],
                "latencyMs": row["latency_ms"],
                "errorCode": row["error_code"],
                "createdAt": row["created_at"],
            }
    except Exception:
        last = None
    return {
        "enabled": TELEGRAM_ALERTS_ENABLED,
        "ready": ready,
        "channel": "telegram",
        "minimumSeverity": TELEGRAM_ALERT_MIN_SEVERITY,
        "notifyResolved": TELEGRAM_NOTIFY_RESOLVED,
        "apiHost": parsed.hostname if parsed.hostname else None,
        "tokenConfigured": checks["tokenConfigured"],
        "chatConfigured": checks["chatConfigured"],
        "checks": checks,
        "lastDeliveryStatus": last.get("status") if last else None,
        "lastDelivery": last,
        "outbox": alert_outbox_stats(),
        "retention": {
            "sentSeconds": TELEGRAM_DELIVERY_SENT_RETENTION_SECONDS,
            "deadLetterSeconds": TELEGRAM_DELIVERY_DEAD_RETENTION_SECONDS,
        },
        "secretsExposed": False,
    }


def alert_delivery_items(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT delivery_id, alert_id, alert_key, event_type, channel,
                      status, http_status, latency_ms, error_code, created_at
               FROM operational_alert_deliveries
               ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [{
        "deliveryId": r["delivery_id"],
        "alertId": r["alert_id"],
        "alertKey": r["alert_key"],
        "eventType": r["event_type"],
        "channel": r["channel"],
        "status": r["status"],
        "httpStatus": r["http_status"],
        "latencyMs": r["latency_ms"],
        "errorCode": r["error_code"],
        "createdAt": r["created_at"],
    } for r in rows]


def _store_alert_delivery(alert: dict, event_type: str, status: str, *,
                          http_status: int | None = None, latency_ms: float | None = None,
                          error_code: str | None = None) -> None:
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO operational_alert_deliveries(
                delivery_id, alert_id, alert_key, event_type, channel, status,
                http_status, latency_ms, error_code, created_at
            ) VALUES (?, ?, ?, ?, 'telegram', ?, ?, ?, ?, ?)""",
            (
                "DLV-" + secrets.token_urlsafe(12),
                clean(alert.get("alertId"), 128),
                clean(alert.get("key"), 128),
                clean(event_type, 32),
                clean(status, 32),
                http_status,
                latency_ms,
                clean(error_code, 64) or None,
                now_iso(),
            ),
        )


def _telegram_severity_allowed(severity: str) -> bool:
    rank = {"info": 1, "warning": 2, "critical": 3}
    configured = rank.get(TELEGRAM_ALERT_MIN_SEVERITY, 2)
    return rank.get(clean(severity, 16), 0) >= configured


def _telegram_alert_text(alert: dict, event_type: str) -> str:
    state = "RESOLVED" if event_type == "resolved" else "ACTIVE"
    severity = clean(alert.get("severity"), 16).upper() or "INFO"
    title = clean(alert.get("title"), 160)
    detail = clean(alert.get("detail"), 400)
    key = clean(alert.get("key"), 128)
    site = clean(PRODUCTION_SITE, 80) or "UCHIHA RADIUS"
    return f"[{site}] {state} · {severity}\\n{title}\\n{detail}\\nKey: {key}"


def _notify_alert_transition(alert: dict, event_type: str) -> None:
    try:
        _enqueue_alert_delivery(alert, event_type)
    except Exception as exc:
        try:
            audit("system", "system", "alert.delivery.enqueue", "error",
                  detail={"channel": "telegram", "eventType": event_type, "exception": type(exc).__name__})
        except Exception:
            pass


def _sync_operational_alert(key: str, condition: dict | None) -> None:
    now = now_iso()
    transition = None
    updated_row = None
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM operational_alerts WHERE alert_key=?",
            (key,),
        ).fetchone()
        if condition:
            severity = clean(condition.get("severity"), 16) or "warning"
            if severity not in {"critical", "warning", "info"}:
                severity = "warning"
            title = clean(condition.get("title"), 160)
            detail = clean(condition.get("detail"), 512)
            metadata = condition.get("metadata") if isinstance(condition.get("metadata"), dict) else {}
            metadata_json = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
            if not row:
                alert_id = "ALT-" + secrets.token_urlsafe(12)
                conn.execute(
                    """INSERT INTO operational_alerts(
                        alert_id, alert_key, severity, title, detail, status,
                        occurrence_count, metadata_json, first_seen_at, last_seen_at,
                        acknowledged_at, acknowledged_by, resolved_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, NULL, NULL, NULL)""",
                    (alert_id, key, severity, title, detail, metadata_json, now, now),
                )
                transition = "active"
            elif row["status"] == "resolved":
                conn.execute(
                    """UPDATE operational_alerts
                       SET severity=?, title=?, detail=?, status='active',
                           occurrence_count=occurrence_count+1, metadata_json=?,
                           first_seen_at=?, last_seen_at=?,
                           acknowledged_at=NULL, acknowledged_by=NULL, resolved_at=NULL
                       WHERE alert_key=?""",
                    (severity, title, detail, metadata_json, now, now, key),
                )
                transition = "active"
            else:
                conn.execute(
                    """UPDATE operational_alerts
                       SET severity=?, title=?, detail=?,
                           occurrence_count=occurrence_count+1,
                           metadata_json=?, last_seen_at=?
                       WHERE alert_key=?""",
                    (severity, title, detail, metadata_json, now, key),
                )
        elif row and row["status"] == "active":
            conn.execute(
                """UPDATE operational_alerts
                   SET status='resolved', last_seen_at=?, resolved_at=?
                   WHERE alert_key=?""",
                (now, now, key),
            )
            transition = "resolved"

        if transition:
            updated_row = conn.execute(
                "SELECT * FROM operational_alerts WHERE alert_key=?",
                (key,),
            ).fetchone()

    if transition and updated_row:
        _notify_alert_transition(_alert_row_to_dict(updated_row), transition)


def evaluate_operational_alerts() -> dict:
    queue = queue_stats()
    service = service_readiness()
    backup = latest_backup_readiness()
    drill = latest_restore_drill_readiness()
    metrics = operational_metrics()["summary"]

    conditions: dict[str, dict | None] = {}

    conditions["service-not-ready"] = (
        {
            "severity": "critical",
            "title": "Service readiness degraded",
            "detail": "Service is not ready: " + ", ".join(service.get("blockers") or ["unknown"]),
            "metadata": {"blockers": service.get("blockers") or []},
        }
        if (not service.get("ready") and not maintenance_enabled()) else None
    )

    conditions["queue-degraded"] = (
        {
            "severity": "critical" if queue.get("health") == "degraded" else "warning",
            "title": "Command queue needs attention",
            "detail": f"Queue health={queue.get('health')} pending={queue.get('pending',0)} stale={queue.get('staleRunning',0)}",
            "metadata": {"health": queue.get("health"), "pending": queue.get("pending",0), "staleRunning": queue.get("staleRunning",0)},
        }
        if queue.get("health") in {"warning", "degraded"} else None
    )

    conditions["dead-letter-commands"] = (
        {
            "severity": "critical",
            "title": "Dead-letter commands present",
            "detail": f"{int(queue.get('deadLetter') or 0)} command(s) are in dead-letter state",
            "metadata": {"deadLetter": int(queue.get("deadLetter") or 0)},
        }
        if int(queue.get("deadLetter") or 0) > 0 else None
    )

    conditions["command-failures"] = (
        {
            "severity": "warning",
            "title": "Failed commands present",
            "detail": f"{int(queue.get('failed') or 0)} failed command(s) require review",
            "metadata": {"failed": int(queue.get("failed") or 0)},
        }
        if int(queue.get("failed") or 0) >= ALERT_FAILED_COMMAND_THRESHOLD else None
    )

    latest_backup = backup.get("latest") if isinstance(backup, dict) else None
    if not latest_backup:
        conditions["backup-missing"] = {
            "severity": "warning",
            "title": "No verified database snapshot",
            "detail": "No local SQLite backup snapshot exists yet",
            "metadata": {},
        }
        conditions["backup-stale"] = None
        conditions["backup-integrity"] = None
    else:
        backup_age = _alert_age_seconds(latest_backup.get("createdAt"))
        conditions["backup-missing"] = None
        conditions["backup-stale"] = (
            {
                "severity": "warning",
                "title": "Database snapshot is stale",
                "detail": f"Latest backup age exceeds {ALERT_BACKUP_MAX_AGE_SECONDS} seconds",
                "metadata": {"ageSeconds": round(backup_age, 3) if backup_age is not None else None},
            }
            if backup_age is None or backup_age > ALERT_BACKUP_MAX_AGE_SECONDS else None
        )
        conditions["backup-integrity"] = (
            {
                "severity": "critical",
                "title": "Latest database snapshot failed verification",
                "detail": "Latest local snapshot did not pass integrity verification",
                "metadata": {},
            }
            if not backup.get("latestVerified") else None
        )

    remote_logs = remote_log_shipping_readiness()
    conditions["remote-log-shipping-dead-letter"] = (
        {
            "severity": "warning",
            "title": "Remote log shipping has dead-letter records",
            "detail": "One or more sanitized operational log records could not be delivered after retries",
            "metadata": {
                "deadLetter": int(remote_logs.get("deadLetter") or 0),
                "pending": int(remote_logs.get("pending") or 0),
                "droppedSinceStart": int(remote_logs.get("droppedSinceStart") or 0),
            },
        }
        if REMOTE_LOG_ENABLE and int(remote_logs.get("deadLetter") or 0) > 0 else None
    )

    offhost = offhost_backup_readiness()
    conditions["offhost-backup-unprotected"] = (
        {
            "severity": "warning",
            "title": "Latest database snapshot is not protected off-host",
            "detail": "Off-host backup replication is enabled but the latest local snapshot has no verified remote copy",
            "metadata": {
                "gatewayReady": bool(offhost.get("ready")),
                "latestProtected": bool(offhost.get("latestProtected")),
            },
        }
        if OFFHOST_BACKUP_ENABLE and latest_backup and not offhost.get("latestProtected") else None
    )

    latest_drill = drill.get("latest") if isinstance(drill, dict) else None
    if latest_backup and not latest_drill:
        conditions["restore-drill-missing"] = {
            "severity": "warning",
            "title": "Restore drill has not been proven",
            "detail": "A backup exists but no successful restore drill has been recorded",
            "metadata": {},
        }
        conditions["restore-drill-stale"] = None
        conditions["restore-drill-failed"] = None
    elif latest_drill:
        drill_age = _alert_age_seconds(latest_drill.get("completedAt"))
        conditions["restore-drill-missing"] = None
        conditions["restore-drill-stale"] = (
            {
                "severity": "warning",
                "title": "Restore drill is stale",
                "detail": f"Latest restore drill age exceeds {ALERT_DRILL_MAX_AGE_SECONDS} seconds",
                "metadata": {"ageSeconds": round(drill_age, 3) if drill_age is not None else None},
            }
            if drill_age is None or drill_age > ALERT_DRILL_MAX_AGE_SECONDS else None
        )
        conditions["restore-drill-failed"] = (
            {
                "severity": "critical",
                "title": "Latest restore drill failed",
                "detail": "The latest backup restore drill did not pass",
                "metadata": {},
            }
            if not drill.get("latestRestoreDrillPassed") else None
        )
    else:
        conditions["restore-drill-missing"] = None
        conditions["restore-drill-stale"] = None
        conditions["restore-drill-failed"] = None

    conditions["http-5xx-threshold"] = (
        {
            "severity": "warning",
            "title": "Backend 5xx responses exceed threshold",
            "detail": f"Observed {int(metrics.get('http5xx') or 0)} HTTP 5xx responses since process start",
            "metadata": {"http5xx": int(metrics.get("http5xx") or 0), "threshold": ALERT_HTTP_5XX_THRESHOLD},
        }
        if int(metrics.get("http5xx") or 0) >= ALERT_HTTP_5XX_THRESHOLD else None
    )

    for key, condition in conditions.items():
        _sync_operational_alert(key, condition)

    return alert_summary(refresh=False)


def alert_summary(*, refresh: bool = False) -> dict:
    if refresh:
        evaluate_operational_alerts()
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT severity, acknowledged_at, COUNT(*) AS c
               FROM operational_alerts WHERE status='active'
               GROUP BY severity, acknowledged_at IS NOT NULL"""
        ).fetchall()
    result = {
        "active": 0,
        "critical": 0,
        "warning": 0,
        "info": 0,
        "acknowledgedActive": 0,
        "monitorEnabled": ALERT_MONITOR_ENABLED,
        "pollSeconds": ALERT_POLL_SECONDS,
    }
    for row in rows:
        count = int(row["c"])
        result["active"] += count
        sev = row["severity"]
        if sev in result:
            result[sev] += count
        if row["acknowledged_at"]:
            result["acknowledgedActive"] += count
    return result


def acknowledge_operational_alert(alert_id: str, identity: dict) -> dict:
    require_permission(identity, "manage-alerts")
    alert_id = clean(alert_id, 128)
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute("SELECT * FROM operational_alerts WHERE alert_id=?", (alert_id,)).fetchone()
        if not row:
            raise ContractError("alert not found", 404, "alert_not_found")
        conn.execute(
            """UPDATE operational_alerts
               SET acknowledged_at=?, acknowledged_by=?
               WHERE alert_id=?""",
            (now, identity["actor"], alert_id),
        )
        updated = conn.execute("SELECT * FROM operational_alerts WHERE alert_id=?", (alert_id,)).fetchone()
    audit(identity["actor"], identity["role"], "alert.acknowledge", "success",
          detail={"alertId": alert_id, "key": updated["alert_key"]})
    return _alert_row_to_dict(updated)


_ALERT_STOP = threading.Event()
_ALERT_THREAD: threading.Thread | None = None


def alert_monitor_loop() -> None:
    while not _ALERT_STOP.is_set():
        try:
            evaluate_operational_alerts()
        except Exception as exc:
            try:
                audit("system", "system", "alert.monitor", "error", detail={"exception": type(exc).__name__})
            except Exception:
                pass
        _ALERT_STOP.wait(ALERT_POLL_SECONDS)


def start_alert_monitor() -> None:
    global _ALERT_THREAD
    if not ALERT_MONITOR_ENABLED or (_ALERT_THREAD and _ALERT_THREAD.is_alive()):
        return
    _ALERT_STOP.clear()
    _ALERT_THREAD = threading.Thread(target=alert_monitor_loop, name="uchiha-alert-monitor", daemon=True)
    _ALERT_THREAD.start()


def stop_alert_monitor() -> None:
    _ALERT_STOP.set()
    thread = _ALERT_THREAD
    if thread and thread.is_alive():
        thread.join(timeout=2.0)



def _deployment_checkpoint_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "checkpointId": row["checkpoint_id"],
        "status": row["status"],
        "safeForDeployment": bool(row["safe_for_deployment"]),
        "reason": row["reason"],
        "maintenanceSource": row["maintenance_source"],
        "drain": json.loads(row["drain_json"] or "{}"),
        "backupName": row["backup_name"],
        "backupSha256": row["backup_sha256"],
        "restoreDrillId": row["restore_drill_id"],
        "restoreDrillPassed": bool(row["restore_drill_passed"]),
        "errorCode": row["error_code"],
        "actor": row["actor"],
        "role": row["role"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
        "elapsedMs": float(row["elapsed_ms"]),
    }


def deployment_checkpoints(limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            "SELECT * FROM deployment_checkpoints ORDER BY completed_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_deployment_checkpoint_row_to_dict(row) for row in rows]


def latest_deployment_checkpoint() -> dict:
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM deployment_checkpoints ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
    item = _deployment_checkpoint_row_to_dict(row) if row else None
    return {
        "supported": True,
        "latest": item,
        "safeForDeployment": bool(item and item["safeForDeployment"]),
        "liveRestorePerformed": False,
    }


def _store_deployment_checkpoint(
    checkpoint_id: str, status: str, safe: bool, reason: str,
    maintenance_source: str, drain: dict, backup_name: str | None,
    backup_sha256: str | None, restore_drill_id: str | None,
    restore_drill_passed: bool, error_code: str | None,
    identity: dict, started_at: str, completed_at: str, elapsed_ms: float,
) -> dict:
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO deployment_checkpoints(
                checkpoint_id, status, safe_for_deployment, reason, maintenance_source,
                drain_json, backup_name, backup_sha256, restore_drill_id,
                restore_drill_passed, error_code, actor, role,
                started_at, completed_at, elapsed_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                checkpoint_id, status, 1 if safe else 0, reason, maintenance_source,
                json.dumps(drain or {}, ensure_ascii=False, sort_keys=True),
                backup_name, backup_sha256, restore_drill_id,
                1 if restore_drill_passed else 0, error_code,
                identity["actor"], identity["role"], started_at, completed_at, elapsed_ms,
            ),
        )
        row = conn.execute(
            "SELECT * FROM deployment_checkpoints WHERE checkpoint_id=?",
            (checkpoint_id,),
        ).fetchone()
    return _deployment_checkpoint_row_to_dict(row)


def create_deployment_checkpoint(reason: str, timeout_seconds, identity: dict) -> dict:
    require_permission(identity, "manage-runtime")
    require_permission(identity, "manage-backups")
    reason = clean(reason, 160) or "deployment-checkpoint"
    checkpoint_id = "CHK-" + secrets.token_urlsafe(12)
    started_at = now_iso()
    started_perf = time.perf_counter()

    drain_result = None
    backup_name = None
    backup_sha256 = None
    restore_drill_id = None
    restore_drill_passed = False
    error_code = None
    status = "failed"
    safe = False

    try:
        drain_result = enter_maintenance_and_wait(reason, timeout_seconds, identity)
        drain = drain_result["drain"]
        if not drain.get("drained"):
            status = "drain-timeout"
            error_code = "deployment_drain_timeout"
        else:
            backup = create_database_backup(identity)
            backup_meta = backup["backup"]
            backup_name = backup_meta["name"]
            backup_sha256 = backup_meta["sha256"]

            drill = run_restore_drill(backup_name, identity)
            restore_drill_id = drill.get("drillId")
            restore_drill_passed = bool(drill.get("passed"))
            safe = bool(
                drain.get("drained")
                and backup_meta.get("integrityVerified")
                and restore_drill_passed
                and drill.get("temporaryDatabaseRemoved")
                and not drill.get("productionDatabaseReplaced")
            )
            status = "verified" if safe else "verification-failed"
            if not safe:
                error_code = "deployment_checkpoint_verification_failed"
    except ContractError as exc:
        error_code = exc.code
        status = "failed"
    except Exception as exc:
        error_code = type(exc).__name__.lower()[:64]
        status = "failed"

    completed_at = now_iso()
    elapsed_ms = round((time.perf_counter() - started_perf) * 1000, 3)
    maintenance = maintenance_control_state()
    drain_snapshot = (
        drain_result["drain"]
        if isinstance(drain_result, dict) and isinstance(drain_result.get("drain"), dict)
        else deployment_drain_status()
    )

    item = _store_deployment_checkpoint(
        checkpoint_id, status, safe, reason, maintenance["source"], drain_snapshot,
        backup_name, backup_sha256, restore_drill_id, restore_drill_passed,
        error_code, identity, started_at, completed_at, elapsed_ms,
    )
    audit(
        identity["actor"], identity["role"], "deployment.checkpoint",
        "success" if safe else status,
        detail={
            "checkpointId": checkpoint_id,
            "safeForDeployment": safe,
            "backupName": backup_name,
            "restoreDrillId": restore_drill_id,
            "errorCode": error_code,
        },
    )
    return {
        "ok": safe,
        "contractVersion": CONTRACT_VERSION,
        "backendBuild": BACKEND_BUILD,
        "checkpoint": item,
        "maintenance": maintenance,
        "safeForDeployment": safe,
        "maintenanceRemainsEnabled": maintenance_enabled(),
        "productionDatabaseReplaced": False,
        "liveRestorePerformed": False,
        "secretsExposed": False,
    }



def _deployment_verification_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "verificationId": row["verification_id"],
        "checkpointId": row["checkpoint_id"],
        "status": row["status"],
        "passed": bool(row["passed"]),
        "resumeRequested": bool(row["resume_requested"]),
        "resumed": bool(row["resumed"]),
        "resumeBlockedByEnvironment": bool(row["resume_blocked_by_environment"]),
        "expectedBackendBuild": row["expected_backend_build"],
        "expectedUiBuild": row["expected_ui_build"],
        "observedBackendBuild": row["observed_backend_build"],
        "observedUiBuild": row["observed_ui_build"],
        "uiFilePresent": bool(row["ui_file_present"]),
        "checkpointSafe": bool(row["checkpoint_safe"]),
        "maintenanceEnabled": bool(row["maintenance_enabled"]),
        "drainDrained": bool(row["drain_drained"]),
        "databaseReady": bool(row["database_ready"]),
        "queueHealth": row["queue_health"],
        "queueRunning": int(row["queue_running"]),
        "adapterReady": bool(row["adapter_ready"]),
        "connectivityCheckId": row["connectivity_check_id"],
        "connectivityReachable": bool(row["connectivity_reachable"]),
        "backupIntegrityVerified": bool(row["backup_integrity_verified"]),
        "backupHashMatches": bool(row["backup_hash_matches"]),
        "blockers": json.loads(row["blockers_json"] or "[]"),
        "actor": row["actor"],
        "role": row["role"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
        "elapsedMs": float(row["elapsed_ms"]),
    }


def deployment_verifications(limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            "SELECT * FROM deployment_verifications ORDER BY completed_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_deployment_verification_row_to_dict(row) for row in rows]


def latest_post_deploy_verification() -> dict:
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM deployment_verifications ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
    item = _deployment_verification_row_to_dict(row) if row else None
    return {
        "supported": True,
        "latest": item,
        "passed": bool(item and item["passed"]),
        "resumed": bool(item and item["resumed"]),
        "secretsExposed": False,
    }


def _load_deployment_checkpoint(checkpoint_id: str | None) -> dict:
    checkpoint_id = clean(checkpoint_id, 128)
    with _DB_LOCK, db_connect() as conn:
        if checkpoint_id:
            row = conn.execute(
                "SELECT * FROM deployment_checkpoints WHERE checkpoint_id=?",
                (checkpoint_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM deployment_checkpoints ORDER BY completed_at DESC LIMIT 1"
            ).fetchone()
    if not row:
        raise ContractError("deployment checkpoint not found", 404, "deployment_checkpoint_not_found")
    return _deployment_checkpoint_row_to_dict(row)


def verify_post_deployment(
    checkpoint_id: str | None,
    expected_backend_build: str | None,
    expected_ui_build: str | None,
    resume_if_passed,
    identity: dict,
) -> dict:
    require_permission(identity, "manage-runtime")
    require_permission(identity, "read-backups")
    if not isinstance(resume_if_passed, bool):
        raise ContractError("resumeIfPassed must be boolean", 400, "invalid_resume_flag")

    expected_backend = clean(expected_backend_build, 64) or BACKEND_BUILD
    expected_ui = clean(expected_ui_build, 64) or UI_BUILD
    checkpoint = _load_deployment_checkpoint(checkpoint_id)
    verification_id = "VERIFY-" + secrets.token_urlsafe(12)
    started_at = now_iso()
    started_perf = time.perf_counter()

    maintenance = maintenance_control_state()
    drain = deployment_drain_status()
    queue = queue_stats()
    db_ready = _database_ready()
    ui_present = PREVIEW_FILE.exists()

    # Run a fresh connectivity probe during maintenance. This sends no RADIUS/MikroTik credentials.
    connectivity = connectivity_check(identity["actor"], identity["role"])
    prod = production_readiness()
    live = live_driver_readiness()

    if ADAPTER_MODE == "production-live":
        adapter_ready = bool(
            prod.get("configurationReady")
            and (connectivity.get("overallReachable") or not prod.get("connectivityRequired"))
            and live.get("ready")
        )
    elif ADAPTER_MODE == "production-dry-run":
        adapter_ready = bool(
            prod.get("configurationReady")
            and (connectivity.get("overallReachable") or not prod.get("connectivityRequired"))
        )
    else:
        adapter_ready = True

    backup_integrity = False
    backup_hash_matches = False
    backup_error = None
    try:
        if checkpoint.get("backupName"):
            verified_backup = verify_database_backup(checkpoint["backupName"], identity)["backup"]
            backup_integrity = bool(verified_backup.get("integrityVerified"))
            backup_hash_matches = bool(
                checkpoint.get("backupSha256")
                and hmac.compare_digest(
                    str(verified_backup.get("sha256") or ""),
                    str(checkpoint.get("backupSha256") or ""),
                )
            )
        else:
            backup_error = "checkpoint-backup-missing"
    except ContractError as exc:
        backup_error = exc.code

    checks = {
        "checkpointSafe": bool(checkpoint.get("safeForDeployment")),
        "maintenanceEnabled": bool(maintenance.get("enabled")),
        "drainDrained": bool(drain.get("drained")),
        "backendBuildMatches": BACKEND_BUILD == expected_backend,
        "uiBuildMatches": UI_BUILD == expected_ui,
        "uiFilePresent": ui_present,
        "databaseReady": db_ready,
        "queueNotDegraded": queue.get("health") != "degraded",
        "queueRunningZero": int(queue.get("running") or 0) == 0,
        "adapterReady": adapter_ready,
        "connectivityReachable": bool(
            connectivity.get("overallReachable")
            or not prod.get("connectivityRequired")
        ),
        "backupIntegrityVerified": backup_integrity,
        "backupHashMatches": backup_hash_matches,
        "checkpointRestoreDrillPassed": bool(checkpoint.get("restoreDrillPassed")),
    }
    blockers = [name for name, ok in checks.items() if not ok]
    if backup_error:
        blockers.append(backup_error)

    passed = not blockers
    resumed = False
    resume_blocked_env = False

    if passed and resume_if_passed:
        if MAINTENANCE_MODE:
            resume_blocked_env = True
        else:
            state = set_runtime_maintenance(False, "", identity)
            resumed = not state.get("enabled", True)

    if passed and resumed:
        status = "verified-resumed"
    elif passed and resume_blocked_env:
        status = "verified-env-maintenance-held"
    elif passed:
        status = "verified-maintenance-held"
    else:
        status = "verification-failed"

    completed_at = now_iso()
    elapsed_ms = round((time.perf_counter() - started_perf) * 1000, 3)

    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """INSERT INTO deployment_verifications(
                verification_id, checkpoint_id, status, passed,
                resume_requested, resumed, resume_blocked_by_environment,
                expected_backend_build, expected_ui_build,
                observed_backend_build, observed_ui_build, ui_file_present,
                checkpoint_safe, maintenance_enabled, drain_drained,
                database_ready, queue_health, queue_running, adapter_ready,
                connectivity_check_id, connectivity_reachable,
                backup_integrity_verified, backup_hash_matches, blockers_json,
                actor, role, started_at, completed_at, elapsed_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                verification_id, checkpoint["checkpointId"], status, 1 if passed else 0,
                1 if resume_if_passed else 0, 1 if resumed else 0, 1 if resume_blocked_env else 0,
                expected_backend, expected_ui, BACKEND_BUILD, UI_BUILD, 1 if ui_present else 0,
                1 if checkpoint.get("safeForDeployment") else 0,
                1 if maintenance.get("enabled") else 0,
                1 if drain.get("drained") else 0,
                1 if db_ready else 0, clean(queue.get("health"), 32) or "unknown",
                int(queue.get("running") or 0), 1 if adapter_ready else 0,
                connectivity.get("checkId"), 1 if connectivity.get("overallReachable") else 0,
                1 if backup_integrity else 0, 1 if backup_hash_matches else 0,
                json.dumps(blockers, ensure_ascii=False),
                identity["actor"], identity["role"], started_at, completed_at, elapsed_ms,
            ),
        )
        row = conn.execute(
            "SELECT * FROM deployment_verifications WHERE verification_id=?",
            (verification_id,),
        ).fetchone()

    item = _deployment_verification_row_to_dict(row)
    audit(
        identity["actor"], identity["role"], "deployment.verify",
        "success" if passed else "failed",
        detail={
            "verificationId": verification_id,
            "checkpointId": checkpoint["checkpointId"],
            "status": status,
            "passed": passed,
            "resumed": resumed,
            "blockers": blockers,
        },
    )

    return {
        "ok": passed,
        "contractVersion": CONTRACT_VERSION,
        "verification": item,
        "checks": checks,
        "checkpoint": checkpoint,
        "maintenance": maintenance_control_state(),
        "resumeRequested": resume_if_passed,
        "resumed": resumed,
        "resumeBlockedByEnvironment": resume_blocked_env,
        "secretsExposed": False,
    }



def _openapi_operation(
    operation_id: str, tag: str, summary: str, *,
    mutating: bool = False, request_schema: str | None = None,
    public: bool = False, query: list[dict] | None = None,
    csrf: bool = True,
) -> dict:
    op = {
        "operationId": operation_id,
        "tags": [tag],
        "summary": summary,
        "responses": {
            "200": {
                "description": "Successful response",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GenericEnvelope"}}},
            },
            "400": {"$ref": "#/components/responses/BadRequest"},
            "401": {"$ref": "#/components/responses/Unauthorized"},
            "403": {"$ref": "#/components/responses/Forbidden"},
            "500": {"$ref": "#/components/responses/InternalError"},
        },
    }
    if public:
        op["security"] = []
    if query:
        op["parameters"] = query
    if mutating:
        op["responses"]["201"] = {
            "description": "Resource/action created",
            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GenericEnvelope"}}},
        }
        op["responses"]["202"] = {
            "description": "Action accepted for durable/asynchronous processing",
            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GenericEnvelope"}}},
        }
        op["responses"]["404"] = {"$ref": "#/components/responses/NotFound"}
        op["responses"]["409"] = {"$ref": "#/components/responses/Conflict"}
        op["responses"]["503"] = {"$ref": "#/components/responses/Unavailable"}
        op["requestBody"] = {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": f"#/components/schemas/{request_schema or 'OperationRequest'}"}
                }
            },
        }
        if csrf:
            op.setdefault("parameters", []).append({
                "name": "X-Uchiha-CSRF",
                "in": "header",
                "required": False,
                "description": "Required for state-changing requests when session-cookie authentication is active.",
                "schema": {"type": "string"},
            })
        op.setdefault("parameters", []).append({
                "name": "Idempotency-Key",
                "in": "header",
                "required": False,
                "description": "Required by idempotent command/provisioning operations where documented.",
                "schema": {"type": "string", "maxLength": 128},
            })
    return op


def api_contract_spec() -> dict:
    global _API_CONTRACT_CACHE
    if _API_CONTRACT_CACHE is not None:
        return _API_CONTRACT_CACHE

    limit_query = [{
        "name": "limit", "in": "query", "required": False,
        "schema": {"type": "integer", "minimum": 1, "maximum": 500},
    }]
    alert_query = limit_query + [{
        "name": "status", "in": "query", "required": False,
        "schema": {"type": "string", "enum": ["active", "resolved"]},
    }]
    path_id = lambda name, description: [{
        "name": name, "in": "path", "required": True,
        "description": description, "schema": {"type": "string", "minLength": 1, "maxLength": 160},
    }]

    paths: dict = {}

    def add(path: str, method: str, operation_id: str, tag: str, summary: str, **kwargs):
        paths.setdefault(path, {})[method.lower()] = _openapi_operation(
            operation_id, tag, summary, **kwargs
        )

    # Service / readiness
    add("/api/connectors/radius/health/live","get","getLiveness","Service","Process liveness",public=True)
    add("/api/connectors/radius/health/ready","get","getReadiness","Service","Service readiness",public=True)
    add("/api/connectors/radius/health","get","getHealth","Service","Connector health",public=True)
    add("/api/connectors/radius/release-readiness","get","getReleaseReadiness","Service","Release readiness",public=True)
    add("/api/connectors/radius/production-readiness","get","getProductionReadiness","Service","Production configuration readiness")
    add("/api/connectors/radius/ops-summary","get","getOpsSummary","Service","Operational summary")
    add("/api/connectors/radius/process-lifecycle","get","getProcessLifecycle","Service","Process lifecycle")
    add("/api/connectors/radius/transport-security","get","getTransportSecurity","Service","Transport security and trusted reverse-proxy state")
    add("/api/connectors/radius/gateway-authentication","get","getGatewayAuthentication","Auth","Gateway HMAC authentication readiness")
    add("/api/connectors/radius/launch-readiness","get","getLaunchReadiness","Deployment","Consolidated launch gate with GO/BLOCKED decision")
    add("/api/connectors/radius/release-integrity","get","getReleaseIntegrity","Deployment","Runtime release-file and API-contract SHA-256 verification")
    add("/api/connectors/radius/edge-protection","get","getEdgeProtection","Security","Bounded concurrency, socket timeout and Gateway pre-auth abuse protection")
    add("/api/connectors/radius/instance-lock","get","getInstanceLock","Deployment","Single-process SQLite ownership lease and split-brain prevention state")
    add("/api/connectors/radius/host-preflight","get","getHostPreflight","Deployment","Runtime host/filesystem readiness without external network calls")
    add("/api/connectors/radius/capabilities","get","getCapabilities","Service","Connector capabilities",public=True)
    add("/api/connectors/radius/database-schema","get","getDatabaseSchema","Service","Database schema state")
    add("/api/connectors/radius/connectivity-check","get","runConnectivityCheck","Service","Run connectivity preflight")
    add("/api/connectors/radius/metrics","get","getOperationalMetrics","Observability","Operational metrics")
    add("/api/connectors/radius/auth-context","get","getAuthContext","Auth","Current authentication context")
    add("/api/connectors/radius/session/login","post","operatorLogin","Auth","Create a production operator session",
        mutating=True,request_schema="OperatorLoginRequest",public=True,csrf=False)
    add("/api/connectors/radius/session/logout","post","operatorLogout","Auth","Destroy the current operator session",
        mutating=True,request_schema="OperationRequest")
    add("/api/connectors/radius/operator-accounts","get","listOperatorAccounts","Auth","List non-secret operator account metadata")
    add("/api/connectors/radius/operator-accounts","post","setOperatorAccount","Auth","Create or update an operator account",
        mutating=True,request_schema="OperatorAccountRequest")

    # Contract self-description
    add("/api/connectors/radius/api-contract","get","getApiContractSummary","Contract","API contract summary")
    add("/api/connectors/radius/openapi.json","get","getOpenApiDocument","Contract","OpenAPI 3.1 document")

    # Command queue / network operations
    add("/api/connectors/radius","post","submitSessionCommand","Commands","Submit a session command",
        mutating=True,request_schema="SessionCommandRequest")
    add("/api/connectors/radius/direct-disconnect","post","submitDirectRadiusDisconnect","Commands","Submit targeted Direct RADIUS Disconnect-Request",
        mutating=True,request_schema="DirectDisconnectRequest")
    add("/api/connectors/radius/node-status","post","queryNodeStatus","Commands","Request live node status",
        mutating=True,request_schema="OperationRequest")
    add("/api/connectors/radius/commands","get","listCommands","Commands","List durable commands",query=limit_query)
    add("/api/connectors/radius/commands/{commandId}","get","getCommand","Commands","Get command state",
        query=path_id("commandId","Durable command identifier"))
    add("/api/connectors/radius/commands/{commandId}/cancel","post","cancelCommand","Commands","Cancel queued/retry command",
        mutating=True,query=path_id("commandId","Durable command identifier"))
    add("/api/connectors/radius/commands/{commandId}/retry","post","retryCommand","Commands","Retry failed/dead-letter command",
        mutating=True,query=path_id("commandId","Durable command identifier"))
    add("/api/connectors/radius/commands/cleanup","post","cleanupCommands","Commands","Clean retained command history",
        mutating=True)
    add("/api/connectors/radius/requests","get","listRequestLedger","Audit","List idempotency request ledger",query=limit_query)
    add("/api/connectors/radius/audit","get","listAuditEvents","Audit","List audit events",query=limit_query)

    # Alerts / deliveries
    add("/api/connectors/radius/alerts","get","listAlerts","Alerts","List operational alerts",query=alert_query)
    add("/api/connectors/radius/alerts/{alertId}/ack","post","ackAlert","Alerts","Acknowledge an operational alert",
        mutating=True,query=path_id("alertId","Operational alert identifier"))
    add("/api/connectors/radius/alert-outbox","get","listAlertOutbox","Alerts","List Telegram delivery outbox",query=limit_query)
    add("/api/connectors/radius/alert-deliveries","get","listAlertDeliveries","Alerts","List alert delivery attempts",query=limit_query)
    add("/api/connectors/radius/alert-outbox/{outboxId}/retry","post","retryAlertDelivery","Alerts","Retry alert delivery",
        mutating=True,query=path_id("outboxId","Alert outbox identifier"))
    add("/api/connectors/radius/alert-outbox/cleanup","post","cleanupAlertOutbox","Alerts","Clean retained alert delivery history",
        mutating=True)

    # Backup / recovery
    add("/api/connectors/radius/backups","get","listBackups","Backup","List local SQLite snapshots",query=limit_query)
    add("/api/connectors/radius/backups","post","createBackup","Backup","Create verified SQLite snapshot",
        mutating=True)
    add("/api/connectors/radius/backups/{name}/verify","post","verifyBackup","Backup","Verify snapshot integrity",
        mutating=True,query=path_id("name","Backup file name"))
    add("/api/connectors/radius/backups/{name}/restore-drill","post","runRestoreDrill","Backup","Restore snapshot into temporary database and verify",
        mutating=True,query=path_id("name","Backup file name"))
    add("/api/connectors/radius/backups/{name}/replicate","post","replicateBackupOffHost","Backup","Replicate snapshot to off-host gateway",
        mutating=True,query=path_id("name","Backup file name"))
    add("/api/connectors/radius/backups/restore-drills","get","listRestoreDrills","Backup","List restore drills",query=limit_query)
    add("/api/connectors/radius/backups/replications","get","listBackupReplications","Backup","List off-host replication receipts",query=limit_query)

    # Voucher provisioning
    add("/api/connectors/radius/voucher-provisioning","get","getVoucherProvisioning","Vouchers","Voucher provisioning readiness")
    add("/api/connectors/radius/voucher-batches","get","listVoucherBatches","Vouchers","List non-secret voucher batch receipts",query=limit_query)
    add("/api/connectors/radius/voucher-batches","post","provisionVoucherBatch","Vouchers","Provision voucher batch through server-side gateway",
        mutating=True,request_schema="VoucherBatchRequest")

    # Deployment/runtime
    add("/api/connectors/radius/runtime-control","get","getRuntimeControl","Deployment","Runtime maintenance state")
    add("/api/connectors/radius/runtime-control/maintenance","post","setMaintenance","Deployment","Enable or disable runtime maintenance",
        mutating=True)
    add("/api/connectors/radius/runtime-control/drain","post","drainDeployment","Deployment","Enter maintenance and drain in-flight commands",
        mutating=True)
    add("/api/connectors/radius/deployment-checkpoint","post","createDeploymentCheckpoint","Deployment","Create guarded pre-deploy checkpoint",
        mutating=True)
    add("/api/connectors/radius/deployment-checkpoints","get","listDeploymentCheckpoints","Deployment","List deployment checkpoints",query=limit_query)
    add("/api/connectors/radius/deployment-verification","post","verifyDeployment","Deployment","Run post-deploy verification and guarded resume",
        mutating=True)
    add("/api/connectors/radius/deployment-verifications","get","listDeploymentVerifications","Deployment","List post-deploy verifications",query=limit_query)

    # Logging / observability shipping
    add("/api/connectors/radius/log-shipping","get","getRemoteLogShipping","Observability","Remote log shipping readiness")
    add("/api/connectors/radius/log-delivery-outbox","get","listLogDeliveryOutbox","Observability","List remote-log delivery metadata",query=limit_query)
    add("/api/connectors/radius/log-delivery-outbox/{logId}/retry","post","retryLogDelivery","Observability","Retry remote-log delivery",
        mutating=True,query=path_id("logId","Remote-log outbox identifier"))

    spec = {
        "openapi": OPENAPI_VERSION,
        "info": {
            "title": "UCHIHA RADIUS-A Connector API",
            "version": API_CONTRACT_VERSION,
            "description": "Machine-readable contract for the UCHIHA RADIUS-A control-plane connector.",
        },
        "servers": [{"url": "/", "description": "Current connector origin"}],
        "tags": [{"name": name} for name in [
            "Service","Contract","Auth","Commands","Audit","Alerts",
            "Backup","Vouchers","Deployment","Observability",
        ]],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "sessionCookie": {
                    "type": "apiKey", "in": "cookie", "name": COOKIE_NAME,
                    "description": "HttpOnly connector session cookie.",
                },
                "gatewaySignature": {"type": "apiKey", "in": "header", "name": "X-Uchiha-Gateway-Signature", "description": "HMAC-SHA256 signature over UCHIHA-GATEWAY-HMAC-V1."},
                "gatewayKeyId": {"type": "apiKey", "in": "header", "name": "X-Uchiha-Gateway-Key-Id", "description": "Active HMAC key identifier."},
                "gatewayTimestamp": {"type": "apiKey", "in": "header", "name": "X-Uchiha-Gateway-Timestamp", "description": "Unix timestamp seconds."},
                "gatewayNonce": {"type": "apiKey", "in": "header", "name": "X-Uchiha-Gateway-Nonce", "description": "Unique persistent anti-replay nonce."},
                "gatewayActor": {"type": "apiKey", "in": "header", "name": "X-Uchiha-Actor", "description": "Signed actor identity."},
                "gatewayRole": {"type": "apiKey", "in": "header", "name": "X-Uchiha-Role", "description": "Signed RBAC role."},
            },
            "schemas": {
                "GenericEnvelope": {
                    "type": "object",
                    "additionalProperties": True,
                    "properties": {
                        "ok": {"type": "boolean"},
                        "contractVersion": {"type": "string"},
                        "traceId": {"type": ["string","null"]},
                        "correlationId": {"type": ["string","null"]},
                    },
                },
                "ErrorEnvelope": {
                    "type": "object",
                    "required": ["error"],
                    "properties": {
                        "error": {
                            "type": "object",
                            "required": ["code","message","status"],
                            "properties": {
                                "code": {"type": "string"},
                                "message": {"type": "string"},
                                "status": {"type": "integer"},
                            },
                        },
                        "traceId": {"type": ["string","null"]},
                        "correlationId": {"type": ["string","null"]},
                    },
                },
                "OperationRequest": {
                    "type": "object",
                    "required": ["contractVersion","requestId","operation"],
                    "properties": {
                        "contractVersion": {"type": "string", "const": CONTRACT_VERSION},
                        "requestId": {"type": "string", "minLength": 6, "maxLength": 128},
                        "operation": {"type": "string"},
                        "correlationId": {"type": "string", "minLength": 6, "maxLength": 128},
                    },
                    "additionalProperties": True,
                },
                "SessionCommandRequest": {
                    "allOf": [
                        {"$ref": "#/components/schemas/OperationRequest"},
                        {
                            "type": "object",
                            "properties": {
                                "operation": {"type": "string", "enum": ["disconnect","reauthenticate","review"]},
                                "subscriber": {"type": "object", "additionalProperties": True},
                            },
                        },
                    ],
                },
                "DirectDisconnectRequest": {
                    "allOf": [
                        {"$ref": "#/components/schemas/OperationRequest"},
                        {
                            "type": "object",
                            "properties": {
                                "operation": {"type": "string", "const": "direct-radius-disconnect"},
                                "nasHost": {"type": "string"},
                                "acctSessionId": {"type": "string"},
                                "userName": {"type": "string"},
                                "framedIpAddress": {"type": "string", "format": "ipv4"},
                            },
                        },
                    ],
                },
                "OperatorLoginRequest": {
                    "allOf": [
                        {"$ref": "#/components/schemas/OperationRequest"},
                        {
                            "type": "object",
                            "required": ["username","password"],
                            "properties": {
                                "operation": {"type": "string", "const": "operator-login"},
                                "username": {"type": "string", "minLength": 3, "maxLength": 64},
                                "password": {"type": "string", "minLength": 12, "maxLength": 256, "writeOnly": True},
                            },
                        },
                    ],
                },
                "OperatorAccountRequest": {
                    "allOf": [
                        {"$ref": "#/components/schemas/OperationRequest"},
                        {
                            "type": "object",
                            "required": ["username","role","enabled"],
                            "properties": {
                                "operation": {"type": "string", "const": "set-operator-account"},
                                "username": {"type": "string", "minLength": 3, "maxLength": 64},
                                "role": {"type": "string", "enum": ["owner","operator","support","auditor"]},
                                "enabled": {"type": "boolean"},
                                "password": {"type": "string", "minLength": 12, "maxLength": 256, "writeOnly": True},
                            },
                        },
                    ],
                },
                "VoucherBatchRequest": {
                    "allOf": [
                        {"$ref": "#/components/schemas/OperationRequest"},
                        {
                            "type": "object",
                            "properties": {
                                "operation": {"type": "string", "const": "provision-voucher-batch"},
                                "providerId": {"type": "string"},
                                "planId": {"type": "string"},
                                "quantity": {"type": "integer", "minimum": 1},
                                "validity": {"type": "string"},
                                "scope": {"type": "string"},
                                "batch": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string"},
                                        "plan": {"type": "string"},
                                        "quantity": {"type": "integer", "minimum": 1},
                                        "validity": {"type": "string"},
                                    },
                                },
                            },
                        },
                    ],
                },
            },
            "responses": {
                "BadRequest": {
                    "description": "Invalid request",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                },
                "Unauthorized": {
                    "description": "Authentication required",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                },
                "Forbidden": {
                    "description": "Permission/CSRF denied",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                },
                "NotFound": {
                    "description": "Resource not found",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                },
                "Conflict": {
                    "description": "State/idempotency conflict",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                },
                "Unavailable": {
                    "description": "Temporarily unavailable or guarded",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                },
                "InternalError": {
                    "description": "Internal error",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                },
            },
        },
        "security": [
            {"sessionCookie": []},
            {"gatewaySignature": [], "gatewayKeyId": [], "gatewayTimestamp": [], "gatewayNonce": [], "gatewayActor": [], "gatewayRole": []},
        ],
        "x-uchiha-contract-version": CONTRACT_VERSION,
        "x-uchiha-backend-build": BACKEND_BUILD,
        "x-uchiha-ui-build": UI_BUILD,
        "x-uchiha-database-schema-version": DATABASE_SCHEMA_VERSION,
        "x-uchiha-secret-values-published": False,
        "x-uchiha-auth-modes": {
            "supported": ["local-preview","operator-session","gateway","hybrid"],
            "recommendedProduction": "hybrid",
            "browserSession": "operator-session",
            "serverAutomation": "gateway-hmac-sha256-v1",
        },
        "x-uchiha-gateway-hmac-v1": {
            "algorithm": "HMAC-SHA256",
            "signatureHeader": "X-Uchiha-Gateway-Signature",
            "keyIdHeader": "X-Uchiha-Gateway-Key-Id",
            "timestampHeader": "X-Uchiha-Gateway-Timestamp",
            "nonceHeader": "X-Uchiha-Gateway-Nonce",
            "actorHeader": "X-Uchiha-Actor",
            "roleHeader": "X-Uchiha-Role",
            "canonicalLines": ["UCHIHA-GATEWAY-HMAC-V1","HTTP_METHOD","REQUEST_TARGET_PATH_AND_QUERY","ACTOR","ROLE","UNIX_TIMESTAMP_SECONDS","NONCE","SHA256_HEX_OF_RAW_REQUEST_BODY"],
            "replayProtection": "persistent-sqlite-nonce",
            "legacyPlainGatewayKeyDefault": False
        },
        "x-uchiha-transport-security": {
            "trustedProxyHeadersSupported": True,
            "httpsEnforcementSupported": True,
            "secureCookiesSupported": True,
            "hstsSupported": True,
            "directTlsListener": False,
        },
    }
    _API_CONTRACT_CACHE = spec
    return spec


def api_contract_summary() -> dict:
    spec = api_contract_spec()
    canonical = json.dumps(spec, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(canonical).hexdigest()
    operation_ids = []
    for path_item in spec["paths"].values():
        for method,value in path_item.items():
            if method.lower() in {"get","post","put","patch","delete","options","head"} and isinstance(value,dict):
                if value.get("operationId"):
                    operation_ids.append(value["operationId"])
    valid = len(operation_ids) == len(set(operation_ids)) and bool(spec["paths"])
    return {
        "enabled": True,
        "valid": valid,
        "openapiVersion": OPENAPI_VERSION,
        "apiContractVersion": API_CONTRACT_VERSION,
        "contractVersion": CONTRACT_VERSION,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "databaseSchemaVersion": DATABASE_SCHEMA_VERSION,
        "sha256": digest,
        "etag": f'"{digest}"',
        "pathCount": len(spec["paths"]),
        "operationCount": len(operation_ids),
        "operationIdsUnique": len(operation_ids) == len(set(operation_ids)),
        "documentEndpoint": "/api/connectors/radius/openapi.json",
        "summaryEndpoint": "/api/connectors/radius/api-contract",
        "authenticatedDocument": True,
        "secretValuesPublished": False,
    }




def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def release_integrity_readiness() -> dict:
    manifest_path = RELEASE_INTEGRITY_MANIFEST
    result = {
        "supported": True,
        "required": RELEASE_INTEGRITY_REQUIRED,
        "verified": False,
        "manifestPresent": manifest_path.is_file(),
        "manifestPinned": bool(RELEASE_INTEGRITY_MANIFEST_SHA256),
        "manifestSha256": None,
        "manifestSha256Matches": False,
        "backendBuildMatches": False,
        "uiBuildMatches": False,
        "databaseSchemaMatches": False,
        "apiContractMatches": False,
        "protectedFiles": 0,
        "verifiedFiles": 0,
        "fileResults": [],
        "blockers": [],
        "secretsExposed": False,
    }
    if not manifest_path.is_file():
        if RELEASE_INTEGRITY_REQUIRED:
            result["blockers"].append("release-integrity-manifest-missing")
        return result

    try:
        raw = manifest_path.read_bytes()
        manifest_sha = hashlib.sha256(raw).hexdigest()
        result["manifestSha256"] = manifest_sha
        result["manifestSha256Matches"] = bool(
            RELEASE_INTEGRITY_MANIFEST_SHA256
            and hmac.compare_digest(manifest_sha, RELEASE_INTEGRITY_MANIFEST_SHA256)
        )
        if RELEASE_INTEGRITY_REQUIRED and not RELEASE_INTEGRITY_MANIFEST_SHA256:
            result["blockers"].append("release-integrity-manifest-sha-pin-missing")
        elif RELEASE_INTEGRITY_MANIFEST_SHA256 and not result["manifestSha256Matches"]:
            result["blockers"].append("release-integrity-manifest-sha-mismatch")

        manifest = json.loads(raw.decode("utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("manifest root must be object")
    except Exception:
        result["blockers"].append("release-integrity-manifest-invalid")
        return result

    result["backendBuildMatches"] = manifest.get("backendBuild") == BACKEND_BUILD
    result["uiBuildMatches"] = manifest.get("uiBuild") == UI_BUILD
    result["databaseSchemaMatches"] = manifest.get("databaseSchemaVersion") == DATABASE_SCHEMA_VERSION
    result["apiContractMatches"] = hmac.compare_digest(
        clean(manifest.get("apiContractSha256"), 128).lower(),
        api_contract_summary().get("sha256", "").lower(),
    )

    for name, ok in (
        ("release-integrity-backend-build-mismatch", result["backendBuildMatches"]),
        ("release-integrity-ui-build-mismatch", result["uiBuildMatches"]),
        ("release-integrity-schema-mismatch", result["databaseSchemaMatches"]),
        ("release-integrity-api-contract-mismatch", result["apiContractMatches"]),
    ):
        if not ok:
            result["blockers"].append(name)

    files = manifest.get("protectedFiles")
    if not isinstance(files, list) or not files:
        result["blockers"].append("release-integrity-protected-files-missing")
        files = []
    result["protectedFiles"] = len(files)

    allowed_runtime = {
        Path(__file__).resolve().name: Path(__file__).resolve(),
        PREVIEW_FILE.resolve().name: PREVIEW_FILE.resolve(),
    }
    verified = 0
    seen = set()
    for item in files:
        if not isinstance(item, dict):
            result["blockers"].append("release-integrity-file-entry-invalid")
            continue
        name = clean(item.get("name"), 160)
        expected_sha = clean(item.get("sha256"), 128).lower()
        expected_bytes = item.get("bytes")
        path = allowed_runtime.get(name)
        entry = {
            "name": name,
            "present": False,
            "sha256Matches": False,
            "bytesMatches": False,
            "verified": False,
        }
        if not path:
            result["blockers"].append("release-integrity-unexpected-file")
            result["fileResults"].append(entry)
            continue
        seen.add(name)
        if not path.is_file():
            result["blockers"].append(f"release-integrity-file-missing:{name}")
            result["fileResults"].append(entry)
            continue
        entry["present"] = True
        actual_bytes = path.stat().st_size
        actual_sha = _sha256_file(path)
        entry["bytesMatches"] = isinstance(expected_bytes, int) and actual_bytes == expected_bytes
        entry["sha256Matches"] = bool(
            re.fullmatch(r"[0-9a-f]{64}", expected_sha)
            and hmac.compare_digest(actual_sha, expected_sha)
        )
        entry["verified"] = bool(entry["bytesMatches"] and entry["sha256Matches"])
        if entry["verified"]:
            verified += 1
        else:
            result["blockers"].append(f"release-integrity-file-mismatch:{name}")
        result["fileResults"].append(entry)

    for required_name in allowed_runtime:
        if required_name not in seen:
            result["blockers"].append(f"release-integrity-file-not-declared:{required_name}")

    result["verifiedFiles"] = verified
    result["verified"] = not result["blockers"]
    return result


def validate_release_integrity_config() -> None:
    if not RELEASE_INTEGRITY_REQUIRED:
        return
    state = release_integrity_readiness()
    if not state["verified"]:
        raise RuntimeError(
            "release integrity verification failed: " + ",".join(state["blockers"])
        )


def launch_readiness() -> dict:
    """Secret-free launch gate derived from existing production and deployment evidence."""
    prod = production_readiness()
    live = live_driver_readiness()
    schema = database_schema_state()
    transport = transport_security_readiness()
    gateway = gateway_authentication_readiness()
    operator_auth = operator_session_readiness()
    api_contract = api_contract_summary()
    backup = latest_backup_readiness()
    drill = latest_restore_drill_readiness()
    offhost = offhost_backup_readiness()
    remote_logs = remote_log_shipping_readiness()
    telegram = telegram_alert_readiness()
    vouchers = voucher_provisioning_readiness()
    direct_radius = direct_radius_readiness()
    checkpoint = latest_deployment_checkpoint()
    verification = latest_post_deploy_verification()
    maintenance = maintenance_control_state()
    drain = deployment_drain_status()
    service = service_readiness()
    release_integrity = release_integrity_readiness()
    edge_protection = edge_protection_readiness()
    instance_lease = instance_lock_readiness()
    host_preflight = host_environment_readiness()

    policy = {
        "requireHttps": LAUNCH_REQUIRE_HTTPS,
        "requireGatewayHmac": LAUNCH_REQUIRE_GATEWAY_HMAC,
        "requireOperatorSession": LAUNCH_REQUIRE_OPERATOR_SESSION,
        "requireVerifiedBackup": LAUNCH_REQUIRE_VERIFIED_BACKUP,
        "requireRecoveryDrill": LAUNCH_REQUIRE_RECOVERY_DRILL,
        "requireOffHostBackup": LAUNCH_REQUIRE_OFFHOST_BACKUP,
        "requireRemoteLogShipping": LAUNCH_REQUIRE_REMOTE_LOG_SHIPPING,
        "requireTelegram": LAUNCH_REQUIRE_TELEGRAM,
        "requireVouchers": LAUNCH_REQUIRE_VOUCHERS,
        "requireDirectRadius": LAUNCH_REQUIRE_DIRECT_RADIUS,
        "requirePostDeployVerification": LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION,
        "requireReleaseIntegrity": LAUNCH_REQUIRE_RELEASE_INTEGRITY,
        "requireEdgeProtection": LAUNCH_REQUIRE_EDGE_PROTECTION,
        "requireInstanceLock": LAUNCH_REQUIRE_INSTANCE_LOCK,
        "requireHostPreflight": LAUNCH_REQUIRE_HOST_PREFLIGHT,
    }

    configuration_checks = {
        "productionLiveMode": ADAPTER_MODE == "production-live",
        "uiFilePresent": PREVIEW_FILE.exists(),
        "databaseSchemaCompatible": bool(
            schema.get("compatible")
            and schema.get("currentVersion") == schema.get("expectedVersion")
        ),
        "apiContractValid": bool(api_contract.get("valid")),
        "releaseIntegrityVerified": bool(
            not LAUNCH_REQUIRE_RELEASE_INTEGRITY
            or release_integrity.get("verified")
        ),
        "edgeProtectionReady": bool(
            not LAUNCH_REQUIRE_EDGE_PROTECTION
            or edge_protection.get("ready")
        ),
        "singleInstanceLeaseHeld": bool(
            not LAUNCH_REQUIRE_INSTANCE_LOCK
            or instance_lease.get("held")
        ),
        "hostEnvironmentReady": bool(
            not LAUNCH_REQUIRE_HOST_PREFLIGHT
            or host_preflight.get("ready")
        ),
        "productionConfigurationReady": bool(prod.get("configurationReady")),
        "connectivityVerified": bool(
            prod.get("connectivityVerified")
            or not prod.get("connectivityRequired")
        ),
        "liveDriverReady": bool(live.get("ready")),
        "httpsBoundaryReady": bool(
            not LAUNCH_REQUIRE_HTTPS
            or (
                transport.get("publicHttpsRequired")
                and transport.get("httpsEnforcementReady")
            )
        ),
        "gatewayHmacReady": bool(
            not LAUNCH_REQUIRE_GATEWAY_HMAC
            or (
                gateway.get("active")
                and gateway.get("ready")
                and gateway.get("scheme") == "hmac-sha256-v1"
                and not gateway.get("legacyKeyAuthEnabled")
            )
        ),
        "operatorSessionReady": bool(
            not LAUNCH_REQUIRE_OPERATOR_SESSION
            or (
                operator_auth.get("active")
                and operator_auth.get("ready")
                and operator_auth.get("enabledOwners", 0) > 0
            )
        ),
        "offHostGatewayReady": bool(
            not LAUNCH_REQUIRE_OFFHOST_BACKUP
            or (
                offhost.get("ready")
                and offhost.get("autoReplicate")
            )
        ),
        "remoteLogGatewayReady": bool(
            not LAUNCH_REQUIRE_REMOTE_LOG_SHIPPING
            or remote_logs.get("ready")
        ),
        "telegramReady": bool(
            not LAUNCH_REQUIRE_TELEGRAM
            or telegram.get("ready")
        ),
        "voucherProvisioningReady": bool(
            not LAUNCH_REQUIRE_VOUCHERS
            or vouchers.get("ready")
        ),
        "directRadiusReady": bool(
            not LAUNCH_REQUIRE_DIRECT_RADIUS
            or direct_radius.get("ready")
        ),
    }

    recovery_checks = {
        "verifiedBackup": bool(
            not LAUNCH_REQUIRE_VERIFIED_BACKUP
            or backup.get("latestVerified")
        ),
        "restoreDrillPassed": bool(
            not LAUNCH_REQUIRE_RECOVERY_DRILL
            or drill.get("latestRestoreDrillPassed")
        ),
        "offHostLatestProtected": bool(
            not LAUNCH_REQUIRE_OFFHOST_BACKUP
            or offhost.get("latestProtected")
        ),
    }

    checkpoint_item = checkpoint.get("latest") or {}
    checkpoint_drain = checkpoint_item.get("drain") or {}
    deployment_checks = {
        "checkpointSafe": bool(checkpoint.get("safeForDeployment")),
        "maintenanceEnabledForDeploy": bool(maintenance.get("enabled")),
        "drainComplete": bool(
            checkpoint_drain.get("drained")
            or drain.get("drained")
        ),
        "checkpointRestoreDrillPassed": bool(
            checkpoint_item.get("restoreDrillPassed")
        ),
    }

    verification_item = verification.get("latest") or {}
    current_build_verified = bool(
        verification.get("passed")
        and verification_item.get("observedBackendBuild") == BACKEND_BUILD
        and verification_item.get("observedUiBuild") == UI_BUILD
    )
    serve_checks = {
        "postDeployVerified": bool(
            not LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION
            or current_build_verified
        ),
        "resumedAfterVerification": bool(
            not LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION
            or verification.get("resumed")
        ),
        "maintenanceDisabled": not bool(maintenance.get("enabled")),
        "serviceReady": bool(service.get("ready")),
        "currentBuildVerified": bool(
            not LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION
            or current_build_verified
        ),
    }

    configuration_blockers = [
        name for name, ok in configuration_checks.items() if not ok
    ]
    recovery_blockers = [
        name for name, ok in recovery_checks.items() if not ok
    ]
    deployment_blockers = [
        name for name, ok in deployment_checks.items() if not ok
    ]
    serve_blockers = [
        name for name, ok in serve_checks.items() if not ok
    ]

    ready_for_checkpoint = not configuration_blockers
    recovery_ready = not recovery_blockers
    safe_to_deploy = bool(
        ready_for_checkpoint
        and recovery_ready
        and not deployment_blockers
    )
    safe_to_serve = bool(
        ready_for_checkpoint
        and recovery_ready
        and not serve_blockers
    )

    all_checks = {
        **configuration_checks,
        **recovery_checks,
        **serve_checks,
    }
    score = int(round(
        100 * sum(1 for ok in all_checks.values() if ok) / max(1, len(all_checks))
    ))

    if safe_to_serve:
        status = "READY_TO_SERVE"
        next_actions = ["launch-approved"]
    elif safe_to_deploy:
        status = "READY_TO_DEPLOY"
        next_actions = [
            "deploy-current-build",
            "run-post-deploy-verification",
        ]
    elif ready_for_checkpoint:
        status = "READY_FOR_CHECKPOINT"
        next_actions = [
            "create-deployment-checkpoint",
            "confirm-backup-and-restore-drill",
        ]
        if LAUNCH_REQUIRE_OFFHOST_BACKUP:
            next_actions.append("confirm-offhost-replication")
    else:
        status = "BLOCKED"
        next_actions = ["resolve-configuration-blockers"]

    if not safe_to_serve and LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION:
        if checkpoint.get("safeForDeployment") and not current_build_verified:
            if "run-post-deploy-verification" not in next_actions:
                next_actions.append("run-post-deploy-verification")

    blockers = list(dict.fromkeys(
        configuration_blockers
        + ([] if status == "READY_FOR_CHECKPOINT" else recovery_blockers)
        + ([] if status == "READY_TO_DEPLOY" else serve_blockers)
    ))

    return {
        "ok": True,
        "go": safe_to_serve,
        "safeToLaunch": safe_to_serve,
        "status": status,
        "score": score,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "databaseSchemaVersion": DATABASE_SCHEMA_VERSION,
        "readyForCheckpoint": ready_for_checkpoint,
        "recoveryReady": recovery_ready,
        "safeToDeploy": safe_to_deploy,
        "safeToServe": safe_to_serve,
        "policy": policy,
        "checks": {
            "configuration": configuration_checks,
            "recovery": recovery_checks,
            "deployment": deployment_checks,
            "serve": serve_checks,
        },
        "blockers": blockers,
        "configurationBlockers": configuration_blockers,
        "recoveryBlockers": recovery_blockers,
        "deploymentBlockers": deployment_blockers,
        "serveBlockers": serve_blockers,
        "nextActions": next_actions,
        "checkpointId": checkpoint_item.get("checkpointId"),
        "verificationId": verification_item.get("verificationId"),
        "latestBackupName": (backup.get("latest") or {}).get("name"),
        "latestOffHostReceiptId": offhost.get("latestReceiptId"),
        "apiContractSha256": api_contract.get("sha256"),
        "releaseIntegrity": release_integrity,
        "edgeProtection": edge_protection,
        "instanceLease": instance_lease,
        "hostPreflight": host_preflight,
        "operatorAuthentication": operator_auth,
        "secretsExposed": False,
        "checkedAt": now_iso(),
    }


def release_readiness() -> dict:
    """Public, secret-free operational summary for the UI readiness panel."""
    health = ADAPTER.health()
    prod = production_readiness()
    live = live_driver_readiness()
    direct_radius = direct_radius_readiness()
    voucher_provisioning = voucher_provisioning_readiness()
    database_schema = database_schema_state()
    backup = latest_backup_readiness()
    offhost_backup = offhost_backup_readiness()
    recovery_drill = latest_restore_drill_readiness()
    deployment_checkpoint = latest_deployment_checkpoint()
    post_deploy_verification = latest_post_deploy_verification()
    queue = queue_stats()
    alerts = alert_summary(refresh=True)
    alert_delivery = telegram_alert_readiness()
    remote_log_shipping = remote_log_shipping_readiness()
    api_contract = api_contract_summary()
    transport_security = transport_security_readiness()
    gateway_authentication = gateway_authentication_readiness()
    operator_authentication = operator_session_readiness()
    release_integrity = release_integrity_readiness()
    edge_protection = edge_protection_readiness()
    instance_lease = instance_lock_readiness()
    host_preflight = host_environment_readiness()
    launch = launch_readiness()
    request_tracing = {
        "enabled": True,
        "logFormat": LOG_FORMAT,
        "logLevel": LOG_LEVEL,
        "httpLogging": LOG_HTTP,
        "requestHeader": "X-Request-ID",
        "correlationHeader": "X-Correlation-ID",
        "responseHeaders": True,
        "auditLinked": True,
        "queueCorrelationLinked": True,
        "requestBodiesLogged": False,
        "secretsRedacted": True,
    }

    service = service_readiness()
    live_conditions_ready = bool(
        prod.get("configurationReady")
        and (prod.get("connectivityVerified") or not prod.get("connectivityRequired"))
        and live.get("ready")
    )
    maintenance = maintenance_control_state()
    lifecycle = process_lifecycle_state()
    if lifecycle["terminating"]:
        release_state = "terminating"
    elif maintenance["enabled"]:
        release_state = "maintenance"
    elif ADAPTER_MODE == "production-live" and health.get("realNetworkCommands") and live_conditions_ready:
        release_state = "live-ready"
    elif ADAPTER_MODE == "production-live":
        release_state = "live-blocked"
    elif ADAPTER_MODE == "production-dry-run":
        release_state = "dry-run-ready" if prod.get("dryRunReady") else "dry-run-blocked"
    else:
        release_state = "safe-preview"

    blockers = []
    if not database_schema.get("compatible"):
        blockers.append("database-schema-incompatible")
    if lifecycle["terminating"]:
        blockers.append("process-terminating")
    if maintenance["enabled"]:
        blockers.append("maintenance-mode")
    if ADAPTER_MODE == "production-live":
        if not live.get("ready"):
            blockers.append("live-driver-not-ready")
        if prod.get("connectivityRequired") and not prod.get("connectivityVerified"):
            blockers.append("connectivity-preflight-required")
    else:
        blockers.append("live-mode-not-selected")

    return {
        "ok": True,
        "contractVersion": CONTRACT_VERSION,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "uiFile": PREVIEW_FILE.name,
        "uiFilePresent": PREVIEW_FILE.exists(),
        "releaseState": release_state,
        "adapterMode": ADAPTER_MODE,
        "adapter": health.get("adapter"),
        "persistence": health.get("persistence", "sqlite"),
        "queueHealth": health.get("queueHealth") or queue.get("health"),
        "realNetworkCommands": bool(health.get("realNetworkCommands")) and not lifecycle["terminating"] and not maintenance["enabled"] and live_conditions_ready,
        "liveReady": bool(live.get("ready")),
        "serviceReady": bool(service.get("ready")),
        "maintenanceMode": maintenance["enabled"],
        "maintenanceReason": maintenance["reason"],
        "maintenanceControl": {**maintenance, "drain": deployment_drain_status()},
        "processLifecycle": lifecycle,
        "configurationReady": bool(prod.get("configurationReady")),
        "connectivityVerified": bool(prod.get("connectivityVerified")),
        "connectivityRequired": bool(prod.get("connectivityRequired")),
        "authMode": AUTH_MODE,
        "blockers": blockers,
        "capabilities": {
            "idempotency": bool(health.get("idempotency")),
            "queue": True,
            "audit": True,
            "rbac": True,
            "csrf": AUTH_MODE != "gateway",
            "productionReadiness": True,
            "releaseReadiness": True,
            "operationalAlerts": True,
            "telegramAlertDelivery": bool(alert_delivery.get("ready")),
            "persistentAlertDeliveryOutbox": True,
            "alertDeliveryManualRetry": True,
            "alertDeliveryRestartRecovery": True,
            "alertDeliveryRetentionCleanup": True,
            "runtimeMaintenanceControl": True,
            "runtimeMaintenancePersistent": True,
            "environmentMaintenanceOverride": True,
            "deploymentDrain": True,
            "deploymentDrainWait": True,
            "deploymentCheckpoint": True,
            "deploymentCheckpointPersists": True,
            "postDeployVerification": True,
            "guardedResume": True,
            "gracefulShutdown": True,
            "sigtermDrain": True,
            "databaseSchemaVersioning": True,
            "databaseMigrationLedger": True,
            "structuredJsonLogging": True,
            "requestTracing": True,
            "auditTraceLinking": True,
            "remoteLogShipping": True,
            "remoteLogShippingGatewayReady": bool(remote_log_shipping.get("ready")),
            "remoteLogShippingDurableOutbox": True,
            "openApi31Contract": True,
            "apiContractChecksum": True,
            "apiContractEtag": True,
            "transportSecurityBoundary": True,
            "trustedProxyValidation": True,
            "httpsEnforcement": True,
            "secureCookies": True,
            "hsts": True,
            "gatewayHmacSigning": True,
            "gatewayReplayProtection": True,
            "gatewayKeyRotationWindow": True,
            "gatewayBodyHashBinding": True,
            "productionOperatorSessions": True,
            "operatorPasswordScrypt": True,
            "operatorCsrfSessions": True,
            "hybridBrowserAndGatewayAuth": True,
            "operatorAccountManagement": True,
            "launchGate": True,
            "launchGateGoBlocked": True,
            "launchSmokeTest": True,
            "releaseIntegrity": True,
            "releaseIntegritySha256": True,
            "releaseIntegrityFailClosed": True,
            "rollbackSafeDeployment": True,
            "boundedHttpConcurrency": True,
            "gatewayPreAuthRateLimit": True,
            "socketSlowClientTimeout": True,
            "edgeAbuseProtection": True,
            "singleInstanceDatabaseLease": True,
            "splitBrainPrevention": True,
            "kernelReleasedInstanceLock": True,
            "hostPreflight": True,
            "hostFilesystemFsyncProbe": True,
            "hostAtomicRenameProbe": True,
            "voucherNetworkProvisioning": bool(voucher_provisioning.get("ready")),
            "voucherReceiptOnlyGateway": True,
            "voucherReceiptOnlyContract": True,
            "directRadiusDisconnectRequest": bool(direct_radius.get("ready")),
            "directRadiusCoARequest": False,
            "databaseBackup": True,
            "offHostBackupReplication": True,
            "offHostBackupGatewayReady": bool(offhost_backup.get("ready")),
            "offHostBackupLatestProtected": bool(offhost_backup.get("latestProtected")),
            "databaseRestoreDrill": True,
            "databaseRestoreLive": False,
            "mikrotikGatewayLive": LIVE_DRIVER == "mikrotik-gateway",
        },
        "directRadiusDynamicAuthorization": direct_radius,
        "voucherProvisioning": voucher_provisioning,
        "databaseSchema": database_schema,
        "databaseBackup": backup,
        "offHostBackup": offhost_backup,
        "databaseRecoveryDrill": recovery_drill,
        "deploymentCheckpoint": deployment_checkpoint,
        "postDeployVerification": post_deploy_verification,
        "operationalMetrics": operational_metrics()["summary"],
        "operationalAlerts": alerts,
        "alertNotificationDelivery": alert_delivery,
        "requestTracing": request_tracing,
        "remoteLogShipping": remote_log_shipping,
        "apiContract": api_contract,
        "transportSecurity": transport_security,
        "gatewayAuthentication": gateway_authentication,
        "operatorAuthentication": operator_authentication,
        "launchReadiness": launch,
        "releaseIntegrity": release_integrity,
        "edgeProtection": edge_protection,
        "instanceLease": instance_lease,
        "hostPreflight": host_preflight,
        "secretsExposed": False,
        "serverTime": now_iso(),
    }



_QUEUE_STOP = threading.Event()
_QUEUE_THREAD: threading.Thread | None = None


def _command_row_to_dict(row: sqlite3.Row) -> dict:
    result = json.loads(row["result_json"]) if row["result_json"] else None
    error = json.loads(row["error_json"]) if row["error_json"] else None
    return {
        "commandId": row["command_id"],
        "requestId": row["request_id"],
        "correlationId": row["correlation_id"],
        "kind": row["kind"],
        "operation": row["operation"],
        "status": row["status"],
        "attempts": int(row["attempts"]),
        "maxAttempts": int(row["max_attempts"]),
        "adapter": row["adapter"],
        "actor": row["actor"],
        "role": row["role"],
        "result": result,
        "error": error,
        "createdAt": row["created_at"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
        "updatedAt": row["updated_at"],
        "nextAttemptAt": row["next_attempt_at"],
    }


def get_command(command_id: str) -> dict | None:
    with _DB_LOCK, db_connect() as conn:
        row = conn.execute("SELECT * FROM connector_commands WHERE command_id=?", (command_id,)).fetchone()
    return _command_row_to_dict(row) if row else None


def commands(limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            "SELECT * FROM connector_commands ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_command_row_to_dict(r) for r in rows]


def _iso_age_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return max(0.0, (now_dt() - dt).total_seconds())
    except Exception:
        return None


def queue_stats() -> dict:
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS c FROM connector_commands GROUP BY status"
        ).fetchall()
        oldest = conn.execute(
            """SELECT created_at FROM connector_commands
               WHERE status IN ('queued','retry')
               ORDER BY created_at ASC LIMIT 1"""
        ).fetchone()
        running = conn.execute(
            """SELECT started_at FROM connector_commands
               WHERE status='running'"""
        ).fetchall()
        due_retry = conn.execute(
            """SELECT COUNT(*) AS c FROM connector_commands
               WHERE status='retry' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)""",
            (now_iso(),),
        ).fetchone()
    counts = {r["status"]: int(r["c"]) for r in rows}
    oldest_age = _iso_age_seconds(oldest["created_at"]) if oldest else None
    stale_running = sum(
        1 for r in running
        if (_iso_age_seconds(r["started_at"]) or 0) >= QUEUE_STALE_RUNNING_SECONDS
    )
    pending = counts.get("queued", 0) + counts.get("retry", 0)
    worker_alive = bool(_QUEUE_THREAD and _QUEUE_THREAD.is_alive())
    if (pending and not worker_alive and QUEUE_WORKER_ENABLED) or stale_running:
        health = "degraded"
    elif pending >= QUEUE_BACKLOG_WARNING or (oldest_age is not None and oldest_age >= QUEUE_STALE_RUNNING_SECONDS):
        health = "warning"
    else:
        health = "healthy"
    return {
        "enabled": QUEUE_WORKER_ENABLED,
        "workerAlive": worker_alive,
        "health": health,
        "queued": counts.get("queued", 0),
        "running": counts.get("running", 0),
        "retry": counts.get("retry", 0),
        "completed": counts.get("completed", 0),
        "failed": counts.get("failed", 0),
        "deadLetter": counts.get("dead-letter", 0),
        "canceled": counts.get("canceled", 0),
        "pending": pending,
        "retryDue": int(due_retry["c"]) if due_retry else 0,
        "staleRunning": stale_running,
        "oldestPendingAgeSeconds": round(oldest_age, 3) if oldest_age is not None else None,
        "maxAttempts": QUEUE_MAX_ATTEMPTS,
        "backlogWarningThreshold": QUEUE_BACKLOG_WARNING,
        "staleRunningThresholdSeconds": QUEUE_STALE_RUNNING_SECONDS,
    }


def cancel_command(command_id: str, identity: dict, reason: str = "") -> dict:
    require_permission(identity, "manage-commands")
    now = now_iso()
    reason = clean(reason, 256) or "operator-cancel"
    with _DB_LOCK, db_connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT * FROM connector_commands WHERE command_id=?",
                (command_id,),
            ).fetchone()
            if not row:
                raise ContractError("command not found", 404, "command_not_found")
            if row["status"] == "running":
                raise ContractError("running command cannot be canceled safely", 409, "command_running")
            if row["status"] not in {"queued", "retry"}:
                raise ContractError(
                    f"command in status {row['status']} cannot be canceled",
                    409,
                    "command_not_cancelable",
                )
            error = {
                "code": "command_canceled",
                "message": reason,
                "canceledBy": identity["actor"],
                "canceledRole": identity["role"],
            }
            updated = conn.execute(
                """UPDATE connector_commands
                   SET status='canceled', error_json=?, next_attempt_at=NULL,
                       completed_at=?, updated_at=?
                   WHERE command_id=? AND status IN ('queued','retry')""",
                (json.dumps(error, ensure_ascii=False, sort_keys=True), now, now, command_id),
            ).rowcount
            if not updated:
                raise ContractError("command state changed before cancellation", 409, "command_state_changed")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    audit(
        identity["actor"], identity["role"], "queue.cancel", "success",
        request_id=row["request_id"],
        detail={"commandId": command_id, "previousStatus": row["status"], "reason": reason},
    )
    return get_command(command_id)


def retry_command(command_id: str, identity: dict) -> dict:
    require_permission(identity, "manage-commands")
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT * FROM connector_commands WHERE command_id=?",
                (command_id,),
            ).fetchone()
            if not row:
                raise ContractError("command not found", 404, "command_not_found")
            if row["status"] not in {"failed", "dead-letter"}:
                raise ContractError(
                    f"command in status {row['status']} cannot be retried manually",
                    409,
                    "command_not_retryable",
                )
            # A successful connector_requests row would make this a replay, so failed/dead-letter
            # commands are only retryable when no successful execution was committed.
            committed = conn.execute(
                "SELECT 1 FROM connector_requests WHERE request_id=?",
                (row["request_id"],),
            ).fetchone()
            if committed:
                raise ContractError(
                    "command already has a committed successful result",
                    409,
                    "command_already_committed",
                )
            updated = conn.execute(
                """UPDATE connector_commands
                   SET status='queued', attempts=0, error_json=NULL, result_json=NULL,
                       next_attempt_at=?, started_at=NULL, completed_at=NULL, updated_at=?
                   WHERE command_id=? AND status IN ('failed','dead-letter')""",
                (now, now, command_id),
            ).rowcount
            if not updated:
                raise ContractError("command state changed before retry", 409, "command_state_changed")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    audit(
        identity["actor"], identity["role"], "queue.manual-retry", "queued",
        request_id=row["request_id"],
        detail={"commandId": command_id, "previousStatus": row["status"]},
    )
    return get_command(command_id)


def cleanup_commands(identity: dict, older_than_seconds: int) -> dict:
    require_permission(identity, "cleanup-commands")
    older_than_seconds = max(QUEUE_CLEANUP_MIN_AGE_SECONDS, min(int(older_than_seconds), 365 * 24 * 3600))
    cutoff = (now_dt() - timedelta(seconds=older_than_seconds)).isoformat()
    terminal = ("completed", "failed", "dead-letter", "canceled")
    with _DB_LOCK, db_connect() as conn:
        rows = conn.execute(
            """SELECT command_id, status FROM connector_commands
               WHERE status IN (?,?,?,?) AND COALESCE(completed_at, updated_at) < ?""",
            (*terminal, cutoff),
        ).fetchall()
        deleted = conn.execute(
            """DELETE FROM connector_commands
               WHERE status IN (?,?,?,?) AND COALESCE(completed_at, updated_at) < ?""",
            (*terminal, cutoff),
        ).rowcount
    by_status = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    audit(
        identity["actor"], identity["role"], "queue.cleanup", "success",
        detail={
            "olderThanSeconds": older_than_seconds,
            "deleted": deleted,
            "byStatus": by_status,
            "idempotencyLedgerPreserved": True,
        },
    )
    return {
        "deleted": deleted,
        "byStatus": by_status,
        "olderThanSeconds": older_than_seconds,
        "idempotencyLedgerPreserved": True,
    }


def enqueue_command(*, kind: str, payload: dict, idempotency_header: str | None, identity: dict) -> tuple[int, dict]:
    require_contract(payload, None)
    require_not_maintenance(clean(payload.get("operation"), 64))
    request_id = validate_request_id(payload.get("requestId"), idempotency_header)
    operation = clean(payload.get("operation"), 64)
    permission = permission_for_operation(operation if kind in {"session-command", "direct-radius-disconnect"} else "node-status")
    require_permission(identity, permission)
    payload_hash = stable_payload_hash(payload)

    completed = lookup_idempotent(request_id, payload_hash)
    if completed:
        status_code, result = completed
        audit(identity["actor"], identity["role"], f"queue.{operation}", "completed-replay", request_id=request_id)
        return status_code, {
            "ok": True,
            "status": "completed",
            "requestId": request_id,
            "idempotentReplay": True,
            "result": result,
        }

    with _DB_LOCK, db_connect() as conn:
        existing = conn.execute(
            "SELECT * FROM connector_commands WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if existing:
            if existing["payload_hash"] != payload_hash:
                raise ContractError(
                    "requestId has already been queued with a different payload",
                    409,
                    "idempotency_conflict",
                )
            item = _command_row_to_dict(existing)
            return (200 if item["status"] == "completed" else 202), {"ok": True, **item, "idempotentReplay": True}

        command_id = "CMD-" + secrets.token_urlsafe(12)
        correlation_id = clean(payload.get("correlationId"), 128) or ("COR-" + secrets.token_urlsafe(10))
        now = now_iso()
        conn.execute(
            """INSERT INTO connector_commands(
                command_id, request_id, correlation_id, kind, operation,
                payload_hash, payload_json, actor, role, adapter, status,
                attempts, max_attempts, next_attempt_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)""",
            (
                command_id, request_id, correlation_id, kind, operation,
                payload_hash, json.dumps(payload, ensure_ascii=False, sort_keys=True),
                identity["actor"], identity["role"], ("direct-radius-disconnect-v37" if kind == "direct-radius-disconnect" else ADAPTER.name),
                QUEUE_MAX_ATTEMPTS, now, now, now,
            ),
        )

    audit(
        identity["actor"], identity["role"], f"queue.{operation}", "queued",
        request_id=request_id,
        detail={"commandId": command_id, "correlationId": correlation_id, "kind": kind},
    )
    return 202, {
        "ok": True,
        "contractVersion": CONTRACT_VERSION,
        "status": "queued",
        "commandId": command_id,
        "requestId": request_id,
        "correlationId": correlation_id,
        "idempotentReplay": False,
    }


def _claim_next_command() -> sqlite3.Row | None:
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                """SELECT * FROM connector_commands
                   WHERE status IN ('queued','retry')
                     AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                   ORDER BY created_at ASC
                   LIMIT 1""",
                (now,),
            ).fetchone()
            if not row:
                conn.execute("COMMIT")
                return None
            updated = conn.execute(
                """UPDATE connector_commands
                   SET status='running', attempts=attempts+1, started_at=COALESCE(started_at, ?), updated_at=?
                   WHERE command_id=? AND status IN ('queued','retry')""",
                (now, now, row["command_id"]),
            ).rowcount
            conn.execute("COMMIT")
            if not updated:
                return None
        except Exception:
            conn.execute("ROLLBACK")
            raise
    with _DB_LOCK, db_connect() as conn:
        return conn.execute("SELECT * FROM connector_commands WHERE command_id=?", (row["command_id"],)).fetchone()


def _finish_command(command_id: str, result: dict) -> None:
    now = now_iso()
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """UPDATE connector_commands
               SET status='completed', result_json=?, error_json=NULL,
                   completed_at=?, updated_at=?, next_attempt_at=NULL
               WHERE command_id=?""",
            (json.dumps(result, ensure_ascii=False, sort_keys=True), now, now, command_id),
        )


def _fail_command(row: sqlite3.Row, exc: Exception) -> None:
    attempts = int(row["attempts"])
    max_attempts = int(row["max_attempts"])
    transient = isinstance(exc, ContractError) and exc.status >= 500
    code = exc.code if isinstance(exc, ContractError) else type(exc).__name__
    message = str(exc)
    now = now_dt()
    if transient and attempts < max_attempts:
        delay = QUEUE_RETRY_BASE_SECONDS * (2 ** max(0, attempts - 1))
        next_at = (now + timedelta(seconds=delay)).isoformat()
        status = "retry"
        completed_at = None
    else:
        status = "dead-letter" if transient and attempts >= max_attempts else "failed"
        next_at = None
        completed_at = now.isoformat()
    error_payload = {
        "code": code,
        "message": message[:512],
        "transient": transient,
        "attempt": attempts,
    }
    with _DB_LOCK, db_connect() as conn:
        conn.execute(
            """UPDATE connector_commands
               SET status=?, error_json=?, next_attempt_at=?, completed_at=?, updated_at=?
               WHERE command_id=?""",
            (
                status,
                json.dumps(error_payload, ensure_ascii=False, sort_keys=True),
                next_at,
                completed_at,
                now.isoformat(),
                row["command_id"],
            ),
        )
    audit(
        row["actor"], row["role"], f"queue.{row['operation']}",
        "retry" if status == "retry" else status,
        request_id=row["request_id"],
        detail={"commandId": row["command_id"], "attempts": attempts, "code": code},
    )


def _process_command(row: sqlite3.Row) -> None:
    payload = json.loads(row["payload_json"])
    identity = {"actor": row["actor"], "role": row["role"]}
    trace_token = _TRACE_ID_CTX.set("WORK-" + clean(row["command_id"], 100))
    correlation_token = _CORRELATION_ID_CTX.set(clean(row["correlation_id"], 128))
    try:
        structured_log(
            "queue.command.start", "INFO",
            commandId=row["command_id"], requestId=row["request_id"],
            operation=row["operation"], attempt=int(row["attempts"]),
        )
        _, result = execute_idempotent(
            kind=row["kind"],
            payload=payload,
            idempotency_header=row["request_id"],
            identity=identity,
        )
        result = {
            **result,
            "commandId": row["command_id"],
            "correlationId": row["correlation_id"],
            "operation": row["operation"],
        }
        _finish_command(row["command_id"], result)
        audit(
            row["actor"], row["role"], f"queue.{row['operation']}", "completed",
            request_id=row["request_id"],
            detail={"commandId": row["command_id"], "correlationId": row["correlation_id"]},
        )
        structured_log(
            "queue.command.completed", "INFO",
            commandId=row["command_id"], requestId=row["request_id"],
            operation=row["operation"],
        )
    except Exception as exc:
        structured_log(
            "queue.command.failed", "ERROR",
            commandId=row["command_id"], requestId=row["request_id"],
            operation=row["operation"],
            errorCode=exc.code if isinstance(exc, ContractError) else type(exc).__name__,
        )
        _fail_command(row, exc)
    finally:
        _TRACE_ID_CTX.reset(trace_token)
        _CORRELATION_ID_CTX.reset(correlation_token)


def command_worker_loop() -> None:
    while not _QUEUE_STOP.is_set():
        if process_is_terminating() or maintenance_enabled():
            _QUEUE_STOP.wait(QUEUE_POLL_SECONDS)
            continue
        try:
            row = _claim_next_command()
            if row:
                _process_command(row)
                continue
        except Exception as exc:
            audit("system", "system", "queue.worker", "error", detail={"exception": type(exc).__name__})
        _QUEUE_STOP.wait(QUEUE_POLL_SECONDS)


def start_command_worker() -> None:
    global _QUEUE_THREAD
    if not QUEUE_WORKER_ENABLED or (_QUEUE_THREAD and _QUEUE_THREAD.is_alive()):
        return
    _QUEUE_STOP.clear()
    _QUEUE_THREAD = threading.Thread(target=command_worker_loop, name="uchiha-command-worker", daemon=True)
    _QUEUE_THREAD.start()


def stop_command_worker() -> None:
    _QUEUE_STOP.set()
    thread = _QUEUE_THREAD
    if thread and thread.is_alive():
        thread.join(timeout=2.0)


def execute_idempotent(*, kind: str, payload: dict, idempotency_header: str | None, identity: dict) -> tuple[int, dict]:
    require_contract(payload, None)
    request_id = validate_request_id(payload.get("requestId"), idempotency_header)
    operation = clean(payload.get("operation"), 64)
    permission = permission_for_operation(operation if kind in {"session-command", "direct-radius-disconnect"} else "node-status")
    require_permission(identity, permission)
    payload_hash = stable_payload_hash(payload)
    replay = lookup_idempotent(request_id, payload_hash)
    if replay:
        audit(identity["actor"], identity["role"], f"connector.{operation}", "replay", request_id=request_id)
        return replay
    if kind == "session-command":
        result = ADAPTER.session_command(payload)
    elif kind == "direct-radius-disconnect":
        result = direct_radius_disconnect(payload)
    else:
        result = ADAPTER.node_status(payload)
    result = {**result, "requestId": request_id, "idempotentReplay": False, "actor": identity["actor"], "role": identity["role"]}
    result_adapter = clean(result.get("adapter"), 128) or ADAPTER.name
    store_request(request_id=request_id, kind=kind, operation=operation, payload_hash=payload_hash,
                  request_payload=payload, response_payload=result, http_status=200,
                  adapter=result_adapter, actor=identity["actor"], role=identity["role"])
    audit(identity["actor"], identity["role"], f"connector.{operation}", "success", request_id=request_id,
          detail={"kind": kind, "adapter": result_adapter, "effect": result.get("effect"), "decision": result.get("decision")})
    return 200, result



class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    """Threading server with a hard concurrency ceiling before thread creation."""
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address, RequestHandlerClass):
        self._edge_semaphore = threading.BoundedSemaphore(EDGE_MAX_CONCURRENT_REQUESTS)
        self._edge_lock = threading.Lock()
        self.active_requests = 0
        self.peak_active_requests = 0
        self.rejected_capacity_total = 0
        super().__init__(server_address, RequestHandlerClass)

    def _reject_capacity(self, request) -> None:
        with self._edge_lock:
            self.rejected_capacity_total += 1
        try:
            body = b'{"error":{"code":"server_capacity_exceeded","message":"server request capacity exceeded","status":503}}'
            response = (
                b"HTTP/1.1 503 Service Unavailable\r\n"
                b"Content-Type: application/json; charset=utf-8\r\n"
                b"Cache-Control: no-store\r\n"
                b"Connection: close\r\n"
                + f"Content-Length: {len(body)}\r\n".encode("ascii")
                + b"\r\n" + body
            )
            request.sendall(response)
        except Exception:
            pass
        finally:
            try: request.shutdown(socket.SHUT_RDWR)
            except Exception: pass
            try: request.close()
            except Exception: pass

    def process_request(self, request, client_address):
        if not self._edge_semaphore.acquire(blocking=False):
            self._reject_capacity(request)
            return
        with self._edge_lock:
            self.active_requests += 1
            self.peak_active_requests = max(self.peak_active_requests, self.active_requests)
        try:
            super().process_request(request, client_address)
        except Exception:
            with self._edge_lock:
                self.active_requests = max(0, self.active_requests - 1)
            self._edge_semaphore.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self._edge_lock:
                self.active_requests = max(0, self.active_requests - 1)
            self._edge_semaphore.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "UCHIHA-RADIUS-Connector/37.0"

    def log_message(self, fmt, *args):
        # Access logs are emitted once through structured http.response events.
        return

    def setup(self):
        super().setup()
        try:
            self.connection.settimeout(EDGE_SOCKET_TIMEOUT_SECONDS)
        except Exception:
            pass

    def _deny_gateway(self, message: str, status: int, code: str):
        gateway_auth_record_failure(self._peer_ip())
        raise AuthError(message, status, code)

    def _start_request(self):
        self._request_started = time.perf_counter()
        inbound_trace = _valid_trace_id(self.headers.get("X-Request-ID")) or _valid_trace_id(self.headers.get("X-Trace-ID"))
        inbound_correlation = _valid_trace_id(self.headers.get("X-Correlation-ID"))
        self._trace_id = inbound_trace or _new_trace_id("HTTP")
        self._correlation_id = inbound_correlation or self._trace_id
        self._operation_request_id = None
        self._request_body_sha256 = hashlib.sha256(b"").hexdigest()
        self._actor = None
        self._role = None
        _TRACE_ID_CTX.set(self._trace_id)
        _CORRELATION_ID_CTX.set(self._correlation_id)

    def _set_correlation_id(self, value):
        value = _valid_trace_id(value)
        if value:
            self._correlation_id = value
            _CORRELATION_ID_CTX.set(value)

    def _trace_response_headers(self):
        self.send_header("X-Request-ID", getattr(self, "_trace_id", None) or _new_trace_id("HTTP"))
        self.send_header("X-Correlation-ID", getattr(self, "_correlation_id", None) or getattr(self, "_trace_id", None) or _new_trace_id("COR"))

    def _log_http_response(self, status: int, response_bytes: int):
        if not LOG_HTTP:
            return
        started = getattr(self, "_request_started", None)
        latency_ms = round(max(0.0, (time.perf_counter()-started)*1000), 3) if started else 0.0
        level = "ERROR" if int(status) >= 500 else ("WARNING" if int(status) >= 400 else "INFO")
        route = _metric_route(self.path)
        structured_log(
            "http.response", level,
            trace_id=getattr(self, "_trace_id", None),
            correlation_id=getattr(self, "_correlation_id", None),
            ship=route not in {"/api/connectors/radius/log-shipping","/api/connectors/radius/log-delivery-outbox"},
            method=self.command,
            route=route,
            status=int(status),
            latencyMs=latency_ms,
            responseBytes=max(0, int(response_bytes)),
            actor=getattr(self, "_actor", None),
            role=getattr(self, "_role", None),
            operationRequestId=getattr(self, "_operation_request_id", None),
            clientIp=self._effective_client_ip(),
            secureTransport=self._request_is_secure(),
            trustedProxy=self._peer_is_trusted_proxy(),
            gatewayAuthScheme=getattr(self, "_gateway_auth_scheme", None),
            gatewayKeyId=getattr(self, "_gateway_key_id", None),
        )

    def _peer_ip(self) -> str:
        return clean(self.client_address[0] if self.client_address else "", 128)

    def _peer_is_trusted_proxy(self) -> bool:
        if not TRUST_PROXY_HEADERS or not TRUSTED_PROXY_NETWORKS:
            return False
        try:
            peer = ipaddress.ip_address(self._peer_ip())
        except ValueError:
            return False
        return any(peer in network for network in TRUSTED_PROXY_NETWORKS)

    def _proxy_headers_present(self) -> bool:
        return any(self.headers.get(name) for name in _PROXY_HEADER_NAMES)

    def _forwarded_proto(self) -> str | None:
        if not self._peer_is_trusted_proxy():
            return None
        value = clean(self.headers.get("X-Forwarded-Proto"), 64).lower()
        if not value:
            forwarded = clean(self.headers.get("Forwarded"), 512)
            match = re.search(r'(?:^|[;,]\s*)proto="?((?:https?))"?', forwarded, re.I)
            return match.group(1).lower() if match else None
        return value.split(",", 1)[0].strip().lower()

    def _request_is_secure(self) -> bool:
        if isinstance(self.connection, ssl.SSLSocket):
            return True
        return self._forwarded_proto() == "https"

    def _effective_client_ip(self) -> str:
        if self._peer_is_trusted_proxy():
            forwarded = clean(self.headers.get("X-Forwarded-For"), 1024)
            if forwarded:
                candidate = forwarded.split(",", 1)[0].strip()
                try:
                    return str(ipaddress.ip_address(candidate))
                except ValueError:
                    pass
            real_ip = clean(self.headers.get("X-Real-IP"), 128)
            try:
                return str(ipaddress.ip_address(real_ip)) if real_ip else self._peer_ip()
            except ValueError:
                pass
        return self._peer_ip()

    def _transport_guard(self):
        trusted_proxy = self._peer_is_trusted_proxy()
        if self._proxy_headers_present() and not trusted_proxy and REJECT_UNTRUSTED_PROXY_HEADERS:
            raise AuthError(
                "forwarded proxy headers are accepted only from configured trusted proxies",
                403,
                "untrusted_proxy_headers",
            )
        if PUBLIC_HTTPS_REQUIRED and not self._request_is_secure():
            raise AuthError(
                "HTTPS is required for this connector endpoint",
                426,
                "https_required",
            )

    def _origin_allowed(self) -> str | None:
        origin = self.headers.get("Origin")
        if not origin: return None
        if origin in ALLOWED_ORIGINS:
            if PUBLIC_HTTPS_REQUIRED and urlparse(origin).scheme != "https":
                return None
            return origin
        parsed = urlparse(origin)
        host = parsed.hostname or ""
        if not PUBLIC_HTTPS_REQUIRED and is_loopback(host): return origin
        return None

    def _security_headers(self):
        origin = self._origin_allowed()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, X-Uchiha-Contract, Idempotency-Key, X-Uchiha-CSRF, X-Uchiha-Gateway-Key, X-Uchiha-Gateway-Signature, X-Uchiha-Gateway-Key-Id, X-Uchiha-Gateway-Timestamp, X-Uchiha-Gateway-Nonce, X-Uchiha-Actor, X-Uchiha-Role, X-Request-ID, X-Correlation-ID")
        self.send_header("Access-Control-Expose-Headers", "X-Request-ID, X-Correlation-ID, X-API-Contract-Version, X-API-Contract-SHA256, X-Transport-Security, X-Trusted-Proxy, ETag")
        contract = api_contract_summary()
        self.send_header("X-API-Contract-Version", API_CONTRACT_VERSION)
        self.send_header("X-API-Contract-SHA256", contract["sha256"])
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Transport-Security", "https" if self._request_is_secure() else "http")
        self.send_header("X-Trusted-Proxy", "1" if self._peer_is_trusted_proxy() else "0")
        if HSTS_ENABLED and self._request_is_secure():
            hsts = f"max-age={HSTS_MAX_AGE_SECONDS}"
            if HSTS_INCLUDE_SUBDOMAINS:
                hsts += "; includeSubDomains"
            if HSTS_PRELOAD:
                hsts += "; preload"
            self.send_header("Strict-Transport-Security", hsts)

    def _json(self, status: int, payload: dict, *, set_cookie: str | None = None):
        if isinstance(payload, dict):
            response = dict(payload)
            payload_correlation = _valid_trace_id(response.get("correlationId"))
            if payload_correlation:
                self._set_correlation_id(payload_correlation)
            response.setdefault("traceId", getattr(self, "_trace_id", None))
            response.setdefault("correlationId", getattr(self, "_correlation_id", None))
        else:
            response = payload
        raw = json.dumps(response, ensure_ascii=False).encode("utf-8")
        _record_http_metric(self.command, self.path, status, len(raw), getattr(self, "_request_started", None))
        self.send_response(status)
        self._security_headers()
        self._trace_response_headers()
        if set_cookie: self.send_header("Set-Cookie", set_cookie)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers(); self.wfile.write(raw)
        self._log_http_response(status, len(raw))

    def _json_document(self, status: int, payload: dict, *, etag: str | None = None):
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
        if etag and self.headers.get("If-None-Match") == etag:
            _record_http_metric(self.command, self.path, 304, 0, getattr(self, "_request_started", None))
            self.send_response(304)
            self._security_headers()
            self._trace_response_headers()
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "private, max-age=300")
            self.send_header("Content-Length", "0")
            self.end_headers()
            self._log_http_response(304, 0)
            return
        _record_http_metric(self.command, self.path, status, len(raw), getattr(self, "_request_started", None))
        self.send_response(status)
        self._security_headers()
        self._trace_response_headers()
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "private, max-age=300")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
        self._log_http_response(status, len(raw))

    def _html(self, path: Path, *, set_cookie: str | None = None):
        raw = path.read_bytes()
        _record_http_metric(self.command, self.path, 200, len(raw), getattr(self, "_request_started", None))
        self.send_response(200)
        self._security_headers()
        self._trace_response_headers()
        if set_cookie: self.send_header("Set-Cookie", set_cookie)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers(); self.wfile.write(raw)
        self._log_http_response(200, len(raw))

    def _text(self, status: int, body: str, content_type: str = "text/plain; charset=utf-8"):
        raw = body.encode("utf-8")
        _record_http_metric(self.command, self.path, status, len(raw), getattr(self, "_request_started", None))
        self.send_response(status)
        self._security_headers()
        self._trace_response_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers(); self.wfile.write(raw)
        self._log_http_response(status, len(raw))

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY: raise ContractError("request body size is invalid", 400, "invalid_body_size")
        raw = self.rfile.read(length)
        self._request_body_sha256 = hashlib.sha256(raw).hexdigest()
        try: payload = json.loads(raw.decode("utf-8"))
        except Exception as exc: raise ContractError("request body must be valid JSON", 400, "invalid_json") from exc
        if not isinstance(payload, dict): raise ContractError("request body must be a JSON object", 400, "invalid_json_type")
        require_contract(payload, self.headers.get("X-Uchiha-Contract"))
        self._operation_request_id = clean(payload.get("requestId"), 128) or None
        body_correlation = _valid_trace_id(payload.get("correlationId"))
        if body_correlation:
            self._set_correlation_id(body_correlation)
        return payload

    def _clear_cookie(self) -> str:
        secure = COOKIE_SECURE_POLICY or self._request_is_secure()
        attributes = [f"{COOKIE_NAME}=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"]
        if secure:
            attributes.append("Secure")
        return "; ".join(attributes)

    def _set_cookie(self, sid: str, max_age: int = SESSION_TTL_SECONDS) -> str:
        secure = COOKIE_SECURE_POLICY or self._request_is_secure()
        attributes = [
            f"{COOKIE_NAME}={sid}",
            "Path=/",
            "HttpOnly",
            "SameSite=Strict",
            f"Max-Age={max_age}",
        ]
        if secure:
            attributes.append("Secure")
        return "; ".join(attributes)

    def _identity(self, *, require_csrf: bool = False, permission: str | None = None) -> dict:
        gateway_header_present = any(self.headers.get(name) for name in (
            "X-Uchiha-Gateway-Signature","X-Uchiha-Gateway-Key-Id",
            "X-Uchiha-Gateway-Timestamp","X-Uchiha-Gateway-Nonce",
            "X-Uchiha-Gateway-Key",
        ))
        use_gateway = AUTH_MODE == "gateway" or (AUTH_MODE == "hybrid" and gateway_header_present)
        if use_gateway:
            gateway_auth_rate_limit_check(self._peer_ip())
            actor = clean(self.headers.get("X-Uchiha-Actor"), 128)
            role = clean(self.headers.get("X-Uchiha-Role"), 32)
            if not actor: self._deny_gateway("gateway actor is required", 401, "gateway_actor_required")
            if role not in ALLOWED_ROLES: self._deny_gateway("gateway role is invalid", 403, "invalid_role")
            signature_header = clean(self.headers.get("X-Uchiha-Gateway-Signature"), 160)
            key_id = clean(self.headers.get("X-Uchiha-Gateway-Key-Id"), 64)
            timestamp_text = clean(self.headers.get("X-Uchiha-Gateway-Timestamp"), 32)
            nonce = clean(self.headers.get("X-Uchiha-Gateway-Nonce"), 128)
            if signature_header and key_id and timestamp_text and nonce:
                match = GATEWAY_SIGNATURE_RE.fullmatch(signature_header)
                if not match: self._deny_gateway("gateway signature format is invalid", 401, "gateway_signature_invalid")
                try: timestamp = int(timestamp_text)
                except ValueError: self._deny_gateway("gateway timestamp is invalid", 401, "gateway_timestamp_invalid")
                if abs(int(time.time()) - timestamp) > GATEWAY_HMAC_MAX_SKEW_SECONDS:
                    self._deny_gateway("gateway signature timestamp is outside the allowed window", 401, "gateway_signature_expired")
                if not GATEWAY_NONCE_RE.fullmatch(nonce): self._deny_gateway("gateway nonce format is invalid", 401, "gateway_nonce_invalid")
                secret = _gateway_key_for_id(key_id)
                if not secret: self._deny_gateway("gateway key id is not active", 401, "gateway_key_id_invalid")
                canonical = _gateway_canonical_request(self.command, self.path, actor, role, timestamp_text, nonce, getattr(self, "_request_body_sha256", hashlib.sha256(b"").hexdigest()))
                expected = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(match.group(1).lower(), expected):
                    structured_log("auth.gateway.denied", "WARNING", actor=actor, role=role, keyId=key_id, reason="signature-invalid")
                    self._deny_gateway("gateway signature verification failed", 401, "gateway_signature_invalid")
                _consume_gateway_nonce(nonce, key_id, actor, timestamp, getattr(self, "_trace_id", None))
                identity = {"actor": actor, "role": role, "session_id": f"gateway:{actor}:{key_id}", "gateway_key_id": key_id, "gateway_auth_scheme": "hmac-sha256-v1"}
            elif GATEWAY_LEGACY_KEY_AUTH:
                supplied = self.headers.get("X-Uchiha-Gateway-Key", "")
                if not GATEWAY_KEY or not hmac.compare_digest(supplied, GATEWAY_KEY): self._deny_gateway("gateway authentication failed", 401, "gateway_auth_failed")
                identity = {"actor": actor, "role": role, "session_id": f"gateway-legacy:{actor}", "gateway_key_id": None, "gateway_auth_scheme": "legacy-static-key"}
            else:
                self._deny_gateway("signed gateway authentication headers are required", 401, "gateway_signature_required")
        else:
            sid = parse_cookie(self.headers.get("Cookie"))
            sess = get_session(sid)
            if not sess: raise AuthError("authentication session is required", 401, "authentication_required")
            if AUTH_MODE in {"operator-session", "hybrid"}:
                sess = validate_operator_session_for_request(sess)
            if require_csrf:
                csrf = self.headers.get("X-Uchiha-CSRF", "")
                if not csrf or not hmac.compare_digest(csrf, sess["csrf_token"]):
                    audit(sess["actor"], sess["role"], "auth.csrf", "denied")
                    raise AuthError("CSRF token is invalid", 403, "csrf_invalid")
            identity = {"actor": sess["actor"], "role": sess["role"], "session_id": sess["session_id"]}
        if permission: require_permission(identity, permission)
        check_rate(identity["session_id"])
        self._actor = identity["actor"]
        self._role = identity["role"]
        self._gateway_auth_scheme = identity.get("gateway_auth_scheme")
        self._gateway_key_id = identity.get("gateway_key_id")
        return identity

    def do_OPTIONS(self):
        self._start_request()
        try:
            self._transport_guard()
        except AuthError as exc:
            return self._json(exc.status, error_envelope(exc.code, str(exc), exc.status))
        origin = self.headers.get("Origin")
        if origin and not self._origin_allowed():
            return self._json(403, error_envelope("origin_forbidden", "origin is not allowed", 403))
        _record_http_metric(self.command, self.path, 204, 0, getattr(self, "_request_started", None))
        self.send_response(204); self._security_headers(); self._trace_response_headers(); self.send_header("Content-Length", "0"); self.end_headers()
        self._log_http_response(204, 0)

    def do_GET(self):
        self._start_request()
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            self._transport_guard()
            if path == "/metrics":
                if not METRICS_PUBLIC:
                    return self._json(404, error_envelope("not_found", "route not found", 404))
                return self._text(200, prometheus_metrics(), "text/plain; version=0.0.4; charset=utf-8")

            if path == "/api/connectors/radius/alert-outbox":
                identity = self._identity(permission="read-alerts")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["100"])[0])
                except ValueError: limit = 100
                audit(identity["actor"], identity["role"], "alert-outbox.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "stats": alert_outbox_stats(),
                    "items": alert_outbox_items(limit),
                })

            if path == "/api/connectors/radius/alert-deliveries":
                identity = self._identity(permission="read-alerts")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["100"])[0])
                except ValueError: limit = 100
                audit(identity["actor"], identity["role"], "alert-deliveries.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "readiness": telegram_alert_readiness(),
                    "items": alert_delivery_items(limit),
                })

            if path == "/api/connectors/radius/alerts":
                identity = self._identity(permission="read-alerts")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["100"])[0])
                except ValueError: limit = 100
                status_filter = clean((params.get("status") or ["active"])[0], 16)
                evaluate_operational_alerts()
                audit(identity["actor"], identity["role"], "alerts.read", "success",
                      detail={"status": status_filter})
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "summary": alert_summary(refresh=False),
                    "items": operational_alerts(limit, status_filter if status_filter in {"active","resolved"} else None),
                })

            if path == "/api/connectors/radius/host-preflight":
                identity = self._identity(permission="read-readiness")
                state = host_environment_readiness()
                audit(identity["actor"], identity["role"], "host-preflight.read",
                      "success" if state["ready"] else "blocked",
                      detail={"ready": state["ready"], "blockers": state["blockers"]})
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, "hostPreflight": state})

            if path == "/api/connectors/radius/instance-lock":
                identity = self._identity(permission="read-readiness")
                state = instance_lock_readiness()
                audit(identity["actor"], identity["role"], "instance-lock.read", "success" if state["ready"] else "blocked", detail={"held": state["held"], "ownerPid": state["ownerPid"], "databasePath": state["databasePath"]})
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, "instanceLease": state})

            if path == "/api/connectors/radius/edge-protection":
                identity = self._identity(permission="read-readiness")
                state = edge_protection_readiness()
                audit(identity["actor"], identity["role"], "edge-protection.read",
                      "success" if state["ready"] else "blocked",
                      detail={
                          "maxConcurrentRequests": state["maxConcurrentRequests"],
                          "capacityRejectedTotal": state["capacityRejectedTotal"],
                          "gatewayAuthFailureRecordedTotal": state["gatewayAuthFailureRecordedTotal"],
                      })
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "edgeProtection": state,
                })

            if path == "/api/connectors/radius/release-integrity":
                identity = self._identity(permission="read-readiness")
                state = release_integrity_readiness()
                audit(
                    identity["actor"], identity["role"],
                    "release-integrity.read",
                    "success" if state["verified"] else "blocked",
                    detail={
                        "verified": state["verified"],
                        "verifiedFiles": state["verifiedFiles"],
                        "protectedFiles": state["protectedFiles"],
                        "blockers": state["blockers"],
                    },
                )
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "releaseIntegrity": state,
                })

            if path == "/api/connectors/radius/launch-readiness":
                identity = self._identity(permission="read-readiness")
                state = launch_readiness()
                audit(
                    identity["actor"], identity["role"],
                    "launch-readiness.read",
                    "success" if state["safeToServe"] else state["status"].lower(),
                    detail={
                        "status": state["status"],
                        "score": state["score"],
                        "blockers": state["blockers"],
                    },
                )
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "launchReadiness": state,
                })

            if path == "/api/connectors/radius/gateway-authentication":
                identity = self._identity(permission="read-readiness")
                state = gateway_authentication_readiness()
                audit(identity["actor"], identity["role"], "gateway-authentication.read", "success", detail={"scheme": state["scheme"], "currentKeyId": state["currentKeyId"], "replayProtection": state["replayProtection"]})
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, "gatewayAuthentication": state})

            if path == "/api/connectors/radius/transport-security":
                identity = self._identity(permission="read-readiness")
                state = transport_security_readiness()
                audit(identity["actor"], identity["role"], "transport-security.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "transportSecurity": state,
                    "request": {
                        "secure": self._request_is_secure(),
                        "trustedProxy": self._peer_is_trusted_proxy(),
                        "clientIp": self._effective_client_ip(),
                        "forwardedProto": self._forwarded_proto(),
                    },
                })

            if path == "/api/connectors/radius/api-contract":
                identity = self._identity(permission="read-readiness")
                summary = api_contract_summary()
                audit(identity["actor"], identity["role"], "api-contract.read", "success",
                      detail={"sha256": summary["sha256"], "operationCount": summary["operationCount"]})
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "apiContract": summary,
                })

            if path == "/api/connectors/radius/openapi.json":
                identity = self._identity(permission="read-readiness")
                summary = api_contract_summary()
                audit(identity["actor"], identity["role"], "openapi.read", "success",
                      detail={"sha256": summary["sha256"], "pathCount": summary["pathCount"]})
                return self._json_document(200, api_contract_spec(), etag=summary["etag"])

            if path == "/api/connectors/radius/metrics":
                identity = self._identity(permission="read-readiness")
                audit(identity["actor"], identity["role"], "metrics.read", "success")
                return self._json(200, operational_metrics())

            if path == "/api/connectors/radius/log-shipping":
                identity = self._identity(permission="read-readiness")
                state = remote_log_shipping_readiness()
                audit(identity["actor"], identity["role"], "log-shipping.read", "success" if state["ready"] else "blocked")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "remoteLogShipping": state,
                })

            if path == "/api/connectors/radius/log-delivery-outbox":
                identity = self._identity(permission="read-audit")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["100"])[0])
                except ValueError: limit = 100
                audit(identity["actor"], identity["role"], "log-delivery-outbox.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "stats": log_delivery_stats(),
                    "items": log_delivery_items(limit),
                    "recordsExposed": False,
                    "secretsExposed": False,
                })

            if path == "/api/connectors/radius/voucher-provisioning":
                identity = self._identity(permission="read-vouchers")
                audit(identity["actor"], identity["role"], "voucher-provisioning.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "readiness": voucher_provisioning_readiness(),
                    "recent": voucher_provision_batches(20),
                    "voucherCodesReturned": False,
                    "secretsExposed": False,
                })

            if path == "/api/connectors/radius/voucher-batches":
                identity = self._identity(permission="read-vouchers")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["100"])[0])
                except ValueError: limit = 100
                audit(identity["actor"], identity["role"], "voucher-batches.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "readiness": voucher_provisioning_readiness(),
                    "items": voucher_provision_batches(limit),
                    "voucherCodesReturned": False,
                    "codesReturned": False,
                    "secretsExposed": False,
                })

            if path == "/api/connectors/radius/database-schema":
                identity = self._identity(permission="read-readiness")
                state = database_schema_state()
                audit(identity["actor"], identity["role"], "database-schema.read", "success" if state["compatible"] else "blocked")
                return self._json(200 if state["compatible"] else 409, {
                    "ok": state["compatible"],
                    "contractVersion": CONTRACT_VERSION,
                    "databaseSchema": state,
                })

            if path == "/api/connectors/radius/process-lifecycle":
                identity = self._identity(permission="read-readiness")
                audit(identity["actor"], identity["role"], "process-lifecycle.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "processLifecycle": process_lifecycle_state(),
                })

            if path == "/api/connectors/radius/deployment-verifications":
                identity = self._identity(permission="read-readiness")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                audit(identity["actor"], identity["role"], "deployment-verifications.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "readiness": latest_post_deploy_verification(),
                    "items": deployment_verifications(limit),
                })

            if path == "/api/connectors/radius/deployment-checkpoints":
                identity = self._identity(permission="read-readiness")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                audit(identity["actor"], identity["role"], "deployment-checkpoints.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "readiness": latest_deployment_checkpoint(),
                    "items": deployment_checkpoints(limit),
                })

            if path == "/api/connectors/radius/runtime-control":
                identity = self._identity(permission="read-readiness")
                audit(identity["actor"], identity["role"], "runtime-control.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "maintenance": {**maintenance_control_state(), "drain": deployment_drain_status()},
                    "queue": queue_stats(),
                })

            if path == "/api/connectors/radius/health/live":
                return self._json(200, service_liveness())

            if path == "/api/connectors/radius/health/ready":
                ready = service_readiness()
                return self._json(200 if ready["ready"] else 503, ready)

            if path == "/api/connectors/radius/ops-summary":
                return self._json(200, ops_summary())

            if path == "/api/connectors/radius/health":
                return self._json(200, ADAPTER.health())

            if path == "/api/connectors/radius/auth-context":
                gateway_header_present = any(self.headers.get(name) for name in (
                    "X-Uchiha-Gateway-Signature","X-Uchiha-Gateway-Key-Id",
                    "X-Uchiha-Gateway-Timestamp","X-Uchiha-Gateway-Nonce","X-Uchiha-Gateway-Key",
                ))
                if AUTH_MODE == "gateway" or (AUTH_MODE == "hybrid" and gateway_header_present):
                    identity = self._identity(permission=None)
                    return self._json(200, {
                        "ok": True, "authenticated": True, "mode": "gateway",
                        "actor": identity["actor"], "role": identity["role"], "csrfToken": None,
                    })
                if AUTH_MODE == "local-preview":
                    if not is_loopback(self.client_address[0]):
                        raise AuthError("local preview authentication is loopback-only", 403, "loopback_required")
                    params = parse_qs(parsed.query)
                    requested_role = clean((params.get("role") or ["owner"])[0], 32)
                    sid = parse_cookie(self.headers.get("Cookie"))
                    sess = get_session(sid)
                    if not sess or (requested_role in ALLOWED_ROLES and requested_role != sess["role"]):
                        if sess: delete_session(sess["session_id"])
                        sess = create_preview_session(requested_role)
                    return self._json(200, {
                        "ok": True, "authenticated": True, "mode": "local-preview", "actor": sess["actor"],
                        "role": sess["role"], "csrfToken": sess["csrf_token"], "expiresAt": sess["expires_at"],
                    }, set_cookie=self._set_cookie(sess["session_id"]))
                sid = parse_cookie(self.headers.get("Cookie"))
                sess = get_session(sid)
                if not sess:
                    return self._json(401, {
                        "ok": False, "authenticated": False, "mode": AUTH_MODE,
                        "loginRequired": True, "csrfToken": None,
                        "error": {"code": "authentication_required", "message": "operator login is required", "status": 401},
                    })
                sess = validate_operator_session_for_request(sess)
                return self._json(200, {
                    "ok": True, "authenticated": True, "mode": AUTH_MODE,
                    "actor": sess["actor"], "role": sess["role"],
                    "csrfToken": sess["csrf_token"], "expiresAt": sess["expires_at"],
                    "loginRequired": False,
                })

            if path == "/api/connectors/radius/operator-accounts":
                identity = self._identity(permission="read-operators")
                items = operator_accounts()
                audit(identity["actor"], identity["role"], "operator-account.list", "success",
                      detail={"count": len(items)})
                return self._json(200, {
                    "ok": True, "contractVersion": CONTRACT_VERSION,
                    "items": items, "passwordHashesExposed": False,
                })

            if path == "/api/connectors/radius/commands":
                identity = self._identity(permission="read-commands")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                audit(identity["actor"], identity["role"], "commands.read", "success")
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, "queue": queue_stats(), "items": commands(limit)})

            if path.startswith("/api/connectors/radius/commands/"):
                identity = self._identity(permission="read-commands")
                command_id = clean(path.rsplit("/", 1)[-1], 128)
                item = get_command(command_id)
                if not item:
                    return self._json(404, error_envelope("command_not_found", "command not found", 404))
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, **item})

            if path == "/api/connectors/radius/requests":
                identity = self._identity(permission="read-ledger")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                audit(identity["actor"], identity["role"], "ledger.read", "success")
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, "persistence": "sqlite", "items": ledger(limit)})

            if path == "/api/connectors/radius/audit":
                identity = self._identity(permission="read-audit")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                return self._json(200, {"ok": True, "items": audit_items(limit)})

            if path == "/api/connectors/radius/connectivity-check":
                identity = self._identity(permission="read-readiness")
                result = connectivity_check(identity["actor"], identity["role"])
                audit(identity["actor"], identity["role"], "connectivity-check.run", "success" if result["overallReachable"] else "degraded",
                      detail={"checkId": result["checkId"], "overallReachable": result["overallReachable"], "credentialsSent": False})
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, **result})

            if path == "/api/connectors/radius/production-readiness":
                identity = self._identity(permission="read-readiness")
                state = production_readiness()
                audit(identity["actor"], identity["role"], "production-readiness.read", "success",
                      detail={"adapterMode": ADAPTER_MODE, "dryRunReady": state["dryRunReady"], "missing": state["missing"]})
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, **state})

            if path == "/api/connectors/radius/release-readiness":
                return self._json(200, release_readiness())

            if path == "/api/connectors/radius/backups/replications":
                identity = self._identity(permission="read-backups")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                audit(identity["actor"], identity["role"], "backup.replications.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "readiness": offhost_backup_readiness(),
                    "items": backup_replications(limit),
                })

            if path == "/api/connectors/radius/backups/restore-drills":
                identity = self._identity(permission="read-backups")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                audit(identity["actor"], identity["role"], "backup.restore-drills.read", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "readiness": latest_restore_drill_readiness(),
                    "items": restore_drills(limit),
                })

            if path == "/api/connectors/radius/backups":
                identity = self._identity(permission="read-backups")
                params = parse_qs(parsed.query)
                try: limit = int((params.get("limit") or ["50"])[0])
                except ValueError: limit = 50
                audit(identity["actor"], identity["role"], "backup.list", "success")
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "items": list_database_backups(limit),
                    "readiness": latest_backup_readiness(),
                })

            if path == "/api/connectors/radius/capabilities":
                return self._json(200, ADAPTER.health())

            if path in ("/", "/RADIUS-A-Master-v101.html", "/RADIUS-A-Master-v53.html"):
                if PREVIEW_FILE.exists(): return self._html(PREVIEW_FILE)
                return self._json(404, error_envelope("preview_file_not_found", "RADIUS-A-Master-v101.html is not beside the backend file", 404))

            return self._json(404, error_envelope("not_found", "route not found", 404))
        except (AuthError, ContractError) as exc:
            return self._json(exc.status, error_envelope(exc.code, str(exc), exc.status))
        except Exception as exc:
            return self._json(500, error_envelope("internal_error", type(exc).__name__, 500))

    def do_POST(self):
        self._start_request()
        parsed = urlparse(self.path)
        request_id = None
        try:
            self._transport_guard()
            payload = self._read_json()
            request_id = clean(payload.get("requestId"), 128) or None

            if parsed.path == "/api/connectors/radius/session/login":
                if AUTH_MODE not in {"operator-session", "hybrid"}:
                    raise AuthError("operator session login is not enabled", 409, "operator_session_disabled")
                if clean(payload.get("operation"), 64) != "operator-login":
                    raise ContractError("session login requires operation=operator-login", 400, "invalid_auth_operation")
                old_sid = parse_cookie(self.headers.get("Cookie"))
                if old_sid:
                    delete_session(old_sid)
                sess = authenticate_operator(
                    payload.get("username"), payload.get("password"), self._peer_ip()
                )
                return self._json(200, {
                    "ok": True, "authenticated": True, "mode": AUTH_MODE,
                    "actor": sess["actor"], "role": sess["role"],
                    "csrfToken": sess["csrf_token"], "expiresAt": sess["expires_at"],
                }, set_cookie=self._set_cookie(sess["session_id"]))

            identity = self._identity(require_csrf=True)

            if parsed.path == "/api/connectors/radius/session/logout":
                if clean(payload.get("operation"), 64) != "operator-logout":
                    raise ContractError("session logout requires operation=operator-logout", 400, "invalid_auth_operation")
                sid = parse_cookie(self.headers.get("Cookie"))
                delete_session(sid)
                audit(identity["actor"], identity["role"], "auth.operator.logout", "success")
                return self._json(200, {
                    "ok": True, "authenticated": False, "mode": AUTH_MODE,
                }, set_cookie=self._clear_cookie())

            if parsed.path == "/api/connectors/radius/operator-accounts":
                if clean(payload.get("operation"), 64) != "set-operator-account":
                    raise ContractError("operator account route requires operation=set-operator-account", 400, "invalid_auth_operation")
                require_permission(identity, "manage-operators")
                item = set_operator_account(
                    payload.get("username"),
                    payload.get("role"),
                    payload.get("enabled"),
                    payload.get("password"),
                    identity,
                )
                return self._json(200, {
                    "ok": True, "contractVersion": CONTRACT_VERSION,
                    "item": item, "passwordHashExposed": False,
                })

            if parsed.path == "/api/connectors/radius/voucher-batches":
                status, result = provision_voucher_batch(
                    payload,
                    self.headers.get("Idempotency-Key"),
                    identity,
                )
                return self._json(status, result)

            if parsed.path.startswith("/api/connectors/radius/log-delivery-outbox/") and parsed.path.endswith("/retry"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 6 and parts[3] == "log-delivery-outbox" and parts[5] == "retry":
                    if clean(payload.get("operation"), 64) != "retry-log-delivery":
                        raise ContractError("log delivery retry requires operation=retry-log-delivery", 400, "invalid_log_delivery_operation")
                    item = retry_log_delivery(parts[4], identity)
                    return self._json(202, {
                        "ok": True,
                        "contractVersion": CONTRACT_VERSION,
                        "item": item,
                        "stats": log_delivery_stats(),
                    })

            if parsed.path == "/api/connectors/radius/deployment-verification":
                if clean(payload.get("operation"), 64) != "verify-deployment":
                    raise ContractError("deployment verification route requires operation=verify-deployment", 400, "invalid_runtime_operation")
                result = verify_post_deployment(
                    payload.get("checkpointId"),
                    payload.get("expectedBackendBuild"),
                    payload.get("expectedUiBuild"),
                    payload.get("resumeIfPassed", False),
                    identity,
                )
                return self._json(200 if result["ok"] else 202, result)

            if parsed.path == "/api/connectors/radius/deployment-checkpoint":
                if clean(payload.get("operation"), 64) != "create-deployment-checkpoint":
                    raise ContractError("deployment checkpoint route requires operation=create-deployment-checkpoint", 400, "invalid_runtime_operation")
                result = create_deployment_checkpoint(
                    payload.get("reason") or "deployment-checkpoint",
                    payload.get("timeoutSeconds"),
                    identity,
                )
                return self._json(201 if result["safeForDeployment"] else 202, result)

            if parsed.path == "/api/connectors/radius/runtime-control/drain":
                if clean(payload.get("operation"), 64) != "enter-maintenance-and-drain":
                    raise ContractError("drain route requires operation=enter-maintenance-and-drain", 400, "invalid_runtime_operation")
                result = enter_maintenance_and_wait(
                    payload.get("reason") or "deployment-drain",
                    payload.get("timeoutSeconds"),
                    identity,
                )
                return self._json(200 if result["drain"]["drained"] else 202, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    **result,
                })

            if parsed.path == "/api/connectors/radius/runtime-control/maintenance":
                if clean(payload.get("operation"), 64) != "set-maintenance":
                    raise ContractError("runtime maintenance route requires operation=set-maintenance", 400, "invalid_runtime_operation")
                state = set_runtime_maintenance(payload.get("enabled"), payload.get("reason") or "", identity)
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "maintenance": {**state, "drain": deployment_drain_status()},
                    "queue": queue_stats(),
                })

            if parsed.path == "/api/connectors/radius/alert-outbox/cleanup":
                if clean(payload.get("operation"), 64) != "cleanup-alert-outbox":
                    raise ContractError("alert outbox cleanup requires operation=cleanup-alert-outbox", 400, "invalid_alert_delivery_operation")
                require_permission(identity, "manage-alerts")
                result = cleanup_alert_outbox(identity)
                return self._json(200, {
                    "ok": True,
                    "contractVersion": CONTRACT_VERSION,
                    "cleanup": result,
                    "stats": alert_outbox_stats(),
                })

            if parsed.path.startswith("/api/connectors/radius/alert-outbox/") and parsed.path.endswith("/retry"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 6 and parts[3] == "alert-outbox" and parts[5] == "retry":
                    if clean(payload.get("operation"), 64) != "retry-alert-delivery":
                        raise ContractError("outbox retry route requires operation=retry-alert-delivery", 400, "invalid_alert_delivery_operation")
                    item = retry_alert_outbox(parts[4], identity)
                    return self._json(202, {
                        "ok": True,
                        "contractVersion": CONTRACT_VERSION,
                        "item": item,
                        "stats": alert_outbox_stats(),
                    })

            if parsed.path.startswith("/api/connectors/radius/alerts/") and parsed.path.endswith("/ack"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 6 and parts[3] == "alerts" and parts[5] == "ack":
                    if clean(payload.get("operation"), 64) != "acknowledge-alert":
                        raise ContractError("alert ack route requires operation=acknowledge-alert", 400, "invalid_alert_operation")
                    item = acknowledge_operational_alert(parts[4], identity)
                    return self._json(200, {
                        "ok": True,
                        "contractVersion": CONTRACT_VERSION,
                        "alert": item,
                        "summary": alert_summary(refresh=False),
                    })

            if parsed.path == "/api/connectors/radius/backups":
                if clean(payload.get("operation"), 64) != "create-backup":
                    raise ContractError("backups route requires operation=create-backup", 400, "invalid_backup_operation")
                result = create_database_backup(identity)
                return self._json(201, result)

            if parsed.path.startswith("/api/connectors/radius/backups/") and parsed.path.endswith("/replicate"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 6 and parts[3] == "backups" and parts[5] == "replicate":
                    if clean(payload.get("operation"), 64) != "replicate-backup":
                        raise ContractError("replicate route requires operation=replicate-backup", 400, "invalid_backup_replication_operation")
                    result = replicate_database_backup(parts[4], identity)
                    return self._json(200 if result.get("idempotentReplay") else 201, result)

            if parsed.path.startswith("/api/connectors/radius/backups/") and parsed.path.endswith("/verify"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 6 and parts[3] == "backups" and parts[5] == "verify":
                    result = verify_database_backup(parts[4], identity)
                    return self._json(200, result)

            if parsed.path.startswith("/api/connectors/radius/backups/") and parsed.path.endswith("/restore-drill"):
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) == 6 and parts[3] == "backups" and parts[5] == "restore-drill":
                    if clean(payload.get("operation"), 64) != "restore-drill":
                        raise ContractError("restore-drill route requires operation=restore-drill", 400, "invalid_restore_drill_operation")
                    result = run_restore_drill(parts[4], identity)
                    return self._json(200 if result["passed"] else 409, result)

            if parsed.path == "/api/connectors/radius/commands/cleanup":
                result = cleanup_commands(identity, int(payload.get("olderThanSeconds") or QUEUE_RESULT_TTL_SECONDS))
                return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, **result, "queue": queue_stats()})

            if parsed.path.startswith("/api/connectors/radius/commands/"):
                parts = [p for p in parsed.path.split("/") if p]
                # api / connectors / radius / commands / {id} / {action}
                if len(parts) == 6 and parts[3] == "commands":
                    command_id, action = clean(parts[4], 128), parts[5]
                    if action == "cancel":
                        item = cancel_command(command_id, identity, payload.get("reason") or "")
                        return self._json(200, {"ok": True, "contractVersion": CONTRACT_VERSION, **item, "queue": queue_stats()})
                    if action == "retry":
                        item = retry_command(command_id, identity)
                        return self._json(202, {"ok": True, "contractVersion": CONTRACT_VERSION, **item, "queue": queue_stats()})

            idem = self.headers.get("Idempotency-Key")
            if parsed.path == "/api/connectors/radius":
                status, response = enqueue_command(kind="session-command", payload=payload, idempotency_header=idem, identity=identity)
                return self._json(status, response)
            if parsed.path == "/api/connectors/radius/node-status":
                status, response = enqueue_command(kind="node-status", payload=payload, idempotency_header=idem, identity=identity)
                return self._json(status, response)
            if parsed.path == "/api/connectors/radius/direct-disconnect":
                if clean(payload.get("operation"), 64) != "disconnect":
                    raise ContractError("direct-disconnect route requires operation=disconnect", 400, "direct_radius_disconnect_only")
                status, response = enqueue_command(kind="direct-radius-disconnect", payload=payload, idempotency_header=idem, identity=identity)
                return self._json(status, response)
            return self._json(404, error_envelope("not_found", "route not found", 404, request_id))
        except (ContractError, AuthError) as exc:
            actor, role = "anonymous", "none"
            try:
                sid = parse_cookie(self.headers.get("Cookie")); sess = get_session(sid)
                if sess: actor, role = sess["actor"], sess["role"]
            except Exception: pass
            audit(actor, role, f"request.{parsed.path}", "denied", request_id=request_id, detail={"code": exc.code, "httpStatus": exc.status})
            return self._json(exc.status, error_envelope(exc.code, str(exc), exc.status, request_id))
        except sqlite3.IntegrityError:
            return self._json(409, error_envelope("idempotency_race", "requestId was concurrently committed; retry the same request", 409, request_id))
        except Exception as exc:
            audit("unknown", "unknown", f"request.{parsed.path}", "error", request_id=request_id, detail={"exception": type(exc).__name__})
            return self._json(500, error_envelope("internal_error", type(exc).__name__, 500, request_id))


def main():
    global _HTTPD
    validate_release_integrity_config()
    validate_host_environment()
    acquire_instance_lock()
    try:
        init_db()
        bootstrap_operator_owner()
    except Exception:
        release_instance_lock()
        raise
    validate_operator_session_runtime()
    load_runtime_control()
    httpd = BoundedThreadingHTTPServer((HOST, PORT), Handler)
    _HTTPD = httpd
    signal.signal(signal.SIGTERM, _process_signal_handler)
    signal.signal(signal.SIGINT, _process_signal_handler)
    schema_state = database_schema_state()
    voucher_ready = voucher_provisioning_readiness()
    offhost_ready = offhost_backup_readiness()
    maintenance = maintenance_control_state()
    structured_log(
        "service.start", "INFO",
        host=HOST,
        port=PORT,
        databasePath=str(DB_PATH),
        databaseSchemaCurrent=schema_state.get("currentVersion"),
        databaseSchemaExpected=DATABASE_SCHEMA_VERSION,
        databaseSchemaCompatible=bool(schema_state.get("compatible")),
        authMode=AUTH_MODE,
        adapterMode=ADAPTER_MODE,
        liveNetworkCommands=bool(ADAPTER_MODE == "production-live"),
        directRadiusReady=bool(direct_radius_readiness().get("ready")),
        voucherProvisioningReady=bool(voucher_ready.get("ready")),
        offHostBackupReady=bool(offhost_ready.get("ready")),
        backupDirectory=str(BACKUP_DIR),
        backupRetention=BACKUP_RETENTION,
        maintenanceEnabled=bool(maintenance.get("enabled")),
        maintenanceSource=maintenance.get("source"),
        gracefulShutdownTimeoutSeconds=GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS,
        metricsPublic=METRICS_PUBLIC,
        alertMonitorEnabled=ALERT_MONITOR_ENABLED,
        telegramDeliveryReady=bool(telegram_alert_readiness().get("ready")),
        queueWorkerEnabled=QUEUE_WORKER_ENABLED,
        apiContractSha256=api_contract_summary()["sha256"],
        apiContractOperations=api_contract_summary()["operationCount"],
        transportSecurity=transport_security_readiness(),
        gatewayAuthentication=gateway_authentication_readiness(),
        operatorAuthentication=operator_session_readiness(),
        launchReadiness=launch_readiness(),
        releaseIntegrity=release_integrity_readiness(),
        edgeProtection=edge_protection_readiness(),
        instanceLease=instance_lock_readiness(),
        hostPreflight=host_environment_readiness(),
        requestBodiesLogged=False,
        secretsRedacted=True,
    )
    start_command_worker()
    start_alert_monitor()
    start_alert_delivery_worker()
    start_log_shipping_worker()
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        stop_alert_delivery_worker()
        stop_alert_monitor()
        stop_command_worker()
        structured_log("service.stop", "INFO", lifecycle=process_lifecycle_state(), secretsRedacted=True)
        stop_log_shipping_worker()
        httpd.server_close()
        _HTTPD = None
        release_instance_lock()


def configuration_self_check() -> dict:
    """Startup-only configuration validation; performs no network command and binds no socket."""
    transport = transport_security_readiness()
    gateway = gateway_authentication_readiness()
    contract = api_contract_summary()
    integrity = release_integrity_readiness()
    edge = edge_protection_readiness()
    instance_lease = instance_lock_readiness(probe=True)
    host_preflight = host_environment_readiness(deep=True, refresh=True)
    operator_auth = operator_session_readiness()
    check_ok = bool(
        (not RELEASE_INTEGRITY_REQUIRED or integrity.get("verified"))
        and contract.get("valid")
        and edge.get("ready")
        and (not INSTANCE_LOCK_REQUIRED or instance_lease.get("available"))
        and (not HOST_PREFLIGHT_REQUIRED or host_preflight.get("ready"))
        and (not operator_auth.get("active") or operator_auth.get("ready"))
    )
    return {
        "ok": check_ok,
        "backendBuild": BACKEND_BUILD,
        "uiBuild": UI_BUILD,
        "databaseSchemaExpected": DATABASE_SCHEMA_VERSION,
        "adapterMode": ADAPTER_MODE,
        "authMode": AUTH_MODE,
        "liveEnabled": ENABLE_LIVE,
        "liveDriver": LIVE_DRIVER,
        "transportSecurity": transport,
        "gatewayAuthentication": gateway,
        "apiContract": {
            "valid": contract.get("valid"),
            "version": contract.get("apiContractVersion"),
            "sha256": contract.get("sha256"),
        },
        "releaseIntegrity": integrity,
        "edgeProtection": edge,
        "instanceLease": instance_lease,
        "hostPreflight": host_preflight,
        "operatorAuthentication": operator_auth,
        "launchPolicy": {
            "requireHttps": LAUNCH_REQUIRE_HTTPS,
            "requireGatewayHmac": LAUNCH_REQUIRE_GATEWAY_HMAC,
            "requireOperatorSession": LAUNCH_REQUIRE_OPERATOR_SESSION,
            "requireVerifiedBackup": LAUNCH_REQUIRE_VERIFIED_BACKUP,
            "requireRecoveryDrill": LAUNCH_REQUIRE_RECOVERY_DRILL,
            "requireOffHostBackup": LAUNCH_REQUIRE_OFFHOST_BACKUP,
            "requireRemoteLogShipping": LAUNCH_REQUIRE_REMOTE_LOG_SHIPPING,
            "requireTelegram": LAUNCH_REQUIRE_TELEGRAM,
            "requireVouchers": LAUNCH_REQUIRE_VOUCHERS,
            "requireDirectRadius": LAUNCH_REQUIRE_DIRECT_RADIUS,
            "requirePostDeployVerification": LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION,
            "requireReleaseIntegrity": LAUNCH_REQUIRE_RELEASE_INTEGRITY,
            "requireEdgeProtection": LAUNCH_REQUIRE_EDGE_PROTECTION,
            "requireInstanceLock": LAUNCH_REQUIRE_INSTANCE_LOCK,
            "requireHostPreflight": LAUNCH_REQUIRE_HOST_PREFLIGHT,
        },
        "networkCallsPerformed": False,
        "serverSocketBound": False,
        "secretsExposed": False,
    }


if __name__ == "__main__":
    if "--check-host" in sys.argv:
        state = host_environment_readiness(deep=True, refresh=True)
        print(json.dumps(state, ensure_ascii=False, sort_keys=True))
        raise SystemExit(0 if state.get("ready") or not HOST_PREFLIGHT_REQUIRED else 2)
    if "--check-config" in sys.argv:
        check = configuration_self_check()
        print(json.dumps(check, ensure_ascii=False, sort_keys=True))
        raise SystemExit(0 if check.get("ok") else 2)
    main()
