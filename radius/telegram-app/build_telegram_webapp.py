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
    text = text[:start] + 'jN=[],vN=[],gl=window.__UCHIHA_RADIUS_SESSION_SEED__||(window.__UCHIHA_RADIUS_SESSION_SEED__=[])' + text[end_marker + 2:]
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

    node_preview = 'return lConnEntry({id:u,adapter:"preview",endpoint:c,operation:"node-status",status:"simulated",nodeCode:n,nodeStatus:t,affectedSessions:o?.affected??0,disconnectedSessions:o?.disconnected??0,contractVersion:"1.0"})'
    node_live = 'return lConnEntry({id:u,adapter:"backend",endpoint:c,operation:"node-status",status:"connector-unavailable",nodeCode:n,nodeStatus:t,affectedSessions:o?.affected??0,disconnectedSessions:o?.disconnected??0,contractVersion:"1.0"})'
    if text.count(node_preview) != 1:
        raise RuntimeError("node connector simulation marker mismatch")
    text = text.replace(node_preview, node_live, 1)

    text = text.replace('n("إصدار تجريبي","Pilot release")', 'n("تشغيل فعلي","Live runtime")')
    text = text.replace('Master v54', 'Master v101')
    text = text.replace('schemaVersion:54', 'schemaVersion:101')
    text = text.replace('"uchiha-radius-local-schema-version","54"', '"uchiha-radius-local-schema-version","101"')
    text = text.replace('RADIUS-A-v54-readiness-', 'RADIUS-A-v101-readiness-')
    text = text.replace('or the preview adapter otherwise', 'and refuses simulation when the backend is unavailable')
    return text


def live_provider_runtime(text: str) -> str:
    replacements = {
        'if(!o)return{...t,runtimeSource:"sample"};':
            'if(!o)return{...t,runtimeSource:window.__UCHIHA_PROVIDER_RUNTIME__===true?"live":"sample"};',
        'j.runtimeSource==="local"?"LOCAL CONTROL":"SAMPLE"':
            'j.runtimeSource==="local"?"LOCAL CONTROL":j.runtimeSource==="live"?"LIVE RADIUS":"SAMPLE"',
        'j.runtimeSource=="local"?"LOCAL CONTROL":"SAMPLE"':
            'j.runtimeSource=="local"?"LOCAL CONTROL":j.runtimeSource=="live"?"LIVE RADIUS":"SAMPLE"',
        'n("عينة مستقرة","Stable sample")':
            'n("جلسة حية","Live session")',
        'n("هذه ليست بيانات RADIUS حية بعد","These are not live RADIUS records yet")':
            'n("بيانات RADIUS الحية للمزود","Live provider RADIUS records")',
        'n("الربط القادم سيستبدل العينة دون تغيير الواجهة","The future connector replaces samples without changing the workflow")':
            'n("تتحدث الجلسات تلقائيًا من شبكة المزود","Sessions refresh automatically from the provider network")',
        'n("مساحة الجلسات جاهزة للبيانات الحية","Session workspace is live-data ready")':
            'n("مساحة الجلسات متصلة بالبيانات الحية","Session workspace is connected to live data")',
        'n("المعروض الآن عينة واضحة لاختبار البحث والتصفية ومسار التحكم. لا يتم إرسال أوامر فصل قبل ربط موصل RADIUS واعتماده.","The current records are clearly marked samples for testing search, filters and control review. No disconnect command is sent before an approved RADIUS connector is configured.")':
            'n("المعروض يأتي من جلسات RADIUS الفعلية للمزود. أوامر التحكم تمر عبر Backend v37 وSite Agent الموثق.","Displayed records come from the provider RADIUS sessions. Control commands pass through Backend v37 and the authenticated Site Agent.")',
        'n("عينة غير حية","Non-live sample")':
            'n("تحديث حي","Live refresh")',
        'session جلسة sample عينة':
            'session جلسة live مباشر',
        'n("السجلات المحفوظة تأتي من قاعدة المنصة. السجلات الموسومة SAMPLE توضيحية فقط، ولا تصبح الجلسة والاستهلاك بيانات حية قبل ربط موصل RADIUS.","Persisted records come from platform storage. SAMPLE records are illustrative only; session and usage data stay non-live until a RADIUS connector is configured.")':
            'n("السجلات تأتي من قاعدة المزود الفعلية، وحالة الجلسة تتحدث من RADIUS عند اتصال Site Agent.","Records come from the live provider database, and session state refreshes from RADIUS when the Site Agent is connected.")',
        'n("يمكنك استعراض عينات التصميم أثناء المزامنة.","You can inspect design samples while synchronization completes.")':
            'n("سيظهر آخر سجل محفوظ حتى تكتمل المزامنة.","The last persisted record remains visible while synchronization completes.")',
        'n("العينات ما زالت ظاهرة بوضوح؛ أعد المحاولة لاسترجاع السجلات الحقيقية.","Clearly labelled samples remain visible; retry to retrieve real records.")':
            'n("أعد المحاولة لاسترجاع سجلات المزود الحقيقية.","Retry to retrieve the provider records.")',
        'n("محفوظة + عينات واضحة","Persisted + labelled samples")':
            'n("سجلات المزود الفعلية","Live provider records")',
        'n("هوية وحالة المزود المحفوظتان تأتيان من قاعدة المنصة. أرقام المشتركين والجلسات والسعة والتحصيل في سجلات SAMPLE توضيحية حتى توصيل أنظمة RADIUS والفوترة.","Persisted provider identity and lifecycle status come from platform storage. Subscriber, session, capacity and collection figures on SAMPLE records remain illustrative until RADIUS and billing connectors are configured.")':
            'n("هوية المزود وبياناته تأتي من قاعدة التشغيل الفعلية، والقياسات غير المتصلة تظهر كحالة انتظار بدل بيانات وهمية.","Provider identity and data come from the live runtime database; unavailable metrics are shown as awaiting data instead of simulated values.")',
        'n("تبقى العينات متاحة أثناء المزامنة.","Clearly marked samples remain available during sync.")':
            'n("تبقى آخر البيانات المحفوظة ظاهرة أثناء المزامنة.","The last persisted data remains visible during synchronization.")',
        'n("أعد المحاولة لاسترجاع السجلات الحقيقية؛ لن تُعرض العينات كبيانات حية.","Retry to retrieve real records; samples will never be presented as live data.")':
            'n("أعد المحاولة لاسترجاع بيانات المزود الفعلية.","Retry to retrieve live provider data.")',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)

    marker = 'gl=window.__UCHIHA_RADIUS_SESSION_SEED__||(window.__UCHIHA_RADIUS_SESSION_SEED__=[])';
    if marker not in text:
        raise RuntimeError("live session seed marker missing")
    return text

def build(source: Path, runtime_js: Path, output: Path) -> dict[str, str | int]:
    before = sha256(source)
    text = source.read_text(encoding="utf-8")
    text = replace_demo_arrays(text)
    text = harden_runtime(text)
    text = live_provider_runtime(text)
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
