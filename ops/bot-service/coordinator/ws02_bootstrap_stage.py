"""Exact-V0.5.51, stage-only storefront first-paint and tenant-response patch.

No production writes. Existing immutably hashed JS/CSS and PWA policies retained.
Fail closed if the canonical live frontend changed since the coordinator audit.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path("/opt/uchiha/projects/bot-service-stage/uchiha-bot-service")
ORIGINAL_UI = "uchiha-ui-190e50b6453872aa.js"
EXPECTED_UI_SHA = "190e50b6453872aa62a0ae4d679dfe9aae7bfae23263f0744c1ed6c142c84300"
EXPECTED_HTML_SHA = "9b71ef6befd69d4bc9bd6617261c3d100430dd80fd24fb3109ea365cd1ac80df"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def replace_once(data: str, old: str, new: str, context: str) -> str:
    count = data.count(old)
    if count != 1:
        raise RuntimeError(f"{context}: expected one anchor, found {count}")
    return data.replace(old, new, 1)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--stage", required=True)
    args = p.parse_args()
    stage = Path(args.stage).resolve()
    if stage == ROOT or ROOT in stage.parents or stage.exists():
        raise RuntimeError("Stage must be a fresh directory outside production")
    if (ROOT / "VERSION").read_text().strip() != "0.5.51":
        raise RuntimeError("V0.5.51 version drift")
    original = ROOT / "apps/miniapp"
    js_source = (original / "assets" / ORIGINAL_UI).read_bytes()
    html_source = (original / "index.html").read_bytes()
    if digest(js_source) != EXPECTED_UI_SHA or digest(html_source) != EXPECTED_HTML_SHA:
        raise RuntimeError("Frontend drift: refuse to replace newer specialist code")
    js = js_source.decode("utf-8")
    js = replace_once(
        js,
        'function uchihaFirstPaint(){if(!painted){',
        'function uchihaFirstPaint(){if(typeof uchihaRequestedTenant==="function"'
        '&&uchihaRequestedTenant()&&!window.UCHIHA_WEB_META&&!state.storeCatalogError)'
        'return;if(!painted){',
        "explicit tenant may not display the generic storefront before hydration",
    )
    js = replace_once(
        js,
        '.then(function(data){var ok=hydrateStoreCatalog(data);',
        '.then(function(data){if(url!==storeEndpoint())throw new Error("store_tenant_changed");'
        'var ok=hydrateStoreCatalog(data);',
        "stale tenant response is not applied",
    )
    js_name = f"uchiha-ui-{digest(js.encode('utf-8'))[:16]}.js"
    html = html_source.decode("utf-8")
    head = (
        '<script id="tenant-first-paint">(function(){try{'
        "var q=new URLSearchParams(location.search),id=q.get('bot_id')||q.get('bot')||'';"
        "if(/^[1-9][0-9]{0,9}$/.test(id))document.documentElement.classList.add('tenant-pending');"
        "document.addEventListener('uchiha:ui-ready',function(){"
        "document.documentElement.classList.remove('tenant-pending')},{once:true});"
        '}catch(_){}})();</script>\n'
        '<style id="tenant-first-paint-style">.tenantBootText{display:none}'
        '.tenant-pending .bootMark,.tenant-pending .bootText{display:none}'
        '.tenant-pending .tenantBootText{display:block;font-size:17px;'
        'font-weight:700;color:#e8eef7}</style>\n'
    )
    html = replace_once(
        html, "<title>UCHIHA Store — Telegram Mini App</title>",
        head + "<title>UCHIHA Store — Telegram Mini App</title>",
        "tenant-specific early head",
    )
    html = replace_once(
        html, '<div class="bootText">UCHIHA PLATFORM</div>',
        '<div class="bootText">UCHIHA PLATFORM</div>'
        '<div class="tenantBootText">جارٍ فتح المتجر</div>',
        "neutral explicit-tenant spinner",
    )
    html = replace_once(html, ORIGINAL_UI, js_name, "new immutable UI reference")
    if len(html.encode("utf-8")) >= 20000:
        raise RuntimeError("HTML size exceeds release gate")
    # No staging directory is created until all immutable source guards pass.
    (stage / "apps").mkdir(parents=True)
    shutil.copytree(original, stage / "apps/miniapp")
    (stage / "infra").mkdir()
    (stage / "scripts").mkdir()
    (stage / "tests").mkdir()
    shutil.copy2(ROOT / "VERSION", stage / "VERSION")
    shutil.copy2(ROOT / "infra/Caddyfile", stage / "infra/Caddyfile")
    shutil.copy2(ROOT / "scripts/asset_gate.py", stage / "scripts/asset_gate.py")
    for name in (
        "banner_frontend_v0546.js",
        "pwa_head_frontend_v0548.js",
        "service_worker_v0549.js",
        "web_login_frontend_v0547.js",
    ):
        shutil.copy2(ROOT / "tests" / name, stage / "tests" / name)
    asset = stage / "apps/miniapp/assets" / js_name
    asset.write_text(js, encoding="utf-8")
    (stage / "apps/miniapp/index.html").write_text(html, encoding="utf-8")
    (asset.with_suffix(".js.gz")).write_bytes(
        gzip.compress(js.encode("utf-8"), compresslevel=9, mtime=0)
    )
    try:
        import brotli
        compressed = brotli.compress(js.encode("utf-8"), quality=9)
    except ImportError:
        subprocess.run(
            ["node", "-e", (
                'const f=require("fs"),z=require("zlib");'
                'f.writeFileSync(process.argv[2],'
                'z.brotliCompressSync(f.readFileSync(process.argv[1]),'
                '{params:{[z.constants.BROTLI_PARAM_QUALITY]:9}}))'
            ), str(asset), str(asset.with_suffix(".js.br"))],
            check=True,
        )
    else:
        (asset.with_suffix(".js.br")).write_bytes(compressed)
    subprocess.run(["node", "--check", str(asset)], check=True)
    report = {
        "status": "WS02_STAGED_NOT_DEPLOYED",
        "baseline": "0.5.51",
        "base_js_sha256": EXPECTED_UI_SHA,
        "base_html_sha256": EXPECTED_HTML_SHA,
        "candidate_js": js_name,
        "candidate_js_sha256": digest(asset.read_bytes()),
        "candidate_html_sha256": digest(
            (stage / "apps/miniapp/index.html").read_bytes()
        ),
        "api_changed": False,
        "real_orders_enabled": False,
    }
    (stage / "WS02_BOOT_MANIFEST.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print("WS02_EXACT_BASELINE=PASS")
    print(f"WS02_CANDIDATE_ASSET={js_name}")
    print("PRODUCTION_MODIFIED=NO")


if __name__ == "__main__":
    main()
