from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

BOOTSTRAP = '''\n<script>window.__UCHIHA_PROVIDER_RUNTIME__=true;</script>\n<script src="https://telegram.org/js/telegram-web-app.js"></script>\n<script src="/telegram-assets/telegram-runtime-v101.js"></script>\n'''


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_demo_arrays(text: str) -> str:
    start = text.find('jN=[{recordId:"ISP-DEMO-001"')
    sub = text.find('],vN=[{recordId:"SUB-DEMO-001"', start)
    ses = text.find('],gl=[{id:"SES-DEMO-001"', sub)
    end_marker = text.find('}];function lR(', ses)
    if min(start, sub, ses, end_marker) < 0:
        raise RuntimeError("frozen v101 sample markers changed; refusing unsafe build")
    text = text[:start] + 'jN=[],vN=[],gl=[]' + text[end_marker + 2:]
    # v101 also uses SES-DEMO-001 once as a UI placeholder. Keep the frozen source
    # unchanged, but remove demo wording from the derived Telegram runtime.
    text = text.replace('placeholder:"SES-DEMO-001"', 'placeholder:"SES-SESSION-ID"')
    if any(marker in text for marker in ("ISP-DEMO-001", "SUB-DEMO-001", "SES-DEMO-001")):
        raise RuntimeError("demo identifiers remain after patch")
    return text


def harden_runtime(text: str) -> str:
    marker = 'window.__uchihaStorageMode="local";'
    replacement = 'if(window.__UCHIHA_PROVIDER_RUNTIME__===true)throw new Error("provider backend unavailable");window.__uchihaStorageMode="local";'
    if text.count(marker) != 1:
        raise RuntimeError("local fallback marker mismatch")
    text = text.replace(marker, replacement, 1)

    start = text.find('const v=lApplySessionRequest(o,u),g=lConnEntry({id:p,adapter:"preview"')
    end = text.find('}}async function lVoucherProvision', start)
    if start < 0 or end < 0:
        raise RuntimeError("connector simulation marker mismatch")
    safe = ('const v=lConnEntry({id:p,adapter:"backend",endpoint:f,operation:y.operation,status:"connector-unavailable",'
            'sessionId:c.id,user:c.user,nas:c.nas,authServer:c.authServer,contractVersion:"1.0"});'
            'return{effect:"connector-unavailable",decision:"Not-Evaluated",sessionId:c.id,user:c.user,nas:c.nas,authServer:c.authServer,'
            'reason:"provider-backend-required",connectorMode:v.adapter,connectorRequestId:v.id,connectorEndpoint:v.endpoint,connectorContract:"1.0"}')
    text = text[:start] + safe + text[end:]
    text = text.replace('n("إصدار تجريبي","Pilot release")', 'n("تشغيل فعلي","Live runtime")')
    return text


def build(source: Path, runtime_js: Path, output: Path) -> dict[str, str | int]:
    before = sha256(source)
    text = source.read_text(encoding="utf-8")
    text = replace_demo_arrays(text)
    text = harden_runtime(text)
    body_index = text.lower().find("<body")
    body_close = text.find(">", body_index)
    if body_index < 0 or body_close < 0:
        raise RuntimeError("body tag not found")
    text = text[:body_close + 1] + BOOTSTRAP + text[body_close + 1:]
    if "telegram-runtime-v101.js" not in text or "window.__UCHIHA_PROVIDER_RUNTIME__" not in text:
        raise RuntimeError("Telegram runtime injection failed")
    if 'status:"simulated"' in text:
        raise RuntimeError("simulated connector fallback remains")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text, encoding="utf-8")
    after = sha256(source)
    if before != after:
        raise RuntimeError("frozen v101 source was modified")
    return {"sourceSha256": before, "outputSha256": sha256(output), "outputBytes": output.stat().st_size}


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=here.parent / "RADIUS-A-Master-v101.html")
    parser.add_argument("--runtime", type=Path, default=here / "web" / "telegram-runtime-v101.js")
    parser.add_argument("--output", type=Path, default=here / "dist" / "index.html")
    args = parser.parse_args()
    result = build(args.source, args.runtime, args.output)
    print(result)


if __name__ == "__main__":
    main()
