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
    # The replacement already closes the return object; preserve only the
    # function-closing brace from the frozen source, not both original braces.
    text = text[:start] + safe + text[end + 1:]

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

def strict_live_runtime(text: str) -> str:
    # The Telegram provider build must never fall back to the frozen v101
    # illustrative catalog when the authoritative provider API is unavailable.
    fallback = (
        '}catch{}return{...fN,pageInfo:{provider:null,subscriber:null,incident:null,'
        'invoice:null,voucher:null,backup:null,node:null}}'
    )
    fail_closed = (
        '}catch{}return window.__UCHIHA_PROVIDER_RUNTIME__===true?'
        '{providers:[],subscribers:[],plans:[],incidents:[],invoices:[],voucherBatches:[],'
        'backupRuns:[],networkNodes:[],pageInfo:{provider:null,subscriber:null,incident:null,'
        'invoice:null,voucher:null,backup:null,node:null}}:'
        '{...fN,pageInfo:{provider:null,subscriber:null,incident:null,invoice:null,voucher:null,'
        'backup:null,node:null}}'
    )
    if text.count(fallback) != 1:
        raise RuntimeError("provider catalog fallback marker mismatch")
    text = text.replace(fallback, fail_closed, 1)

    # Missing provider-node ownership is a blocker in live mode, never an
    # unmanaged sample that is allowed to continue.
    node_sample = (
        'if(!t)return{allowed:!0,status:"unmanaged-sample",code:n?.nas||n?.authServer||"—",'
        'source:"sample",warning:!1};'
    )
    node_live = (
        'if(!t)return{allowed:!1,status:"unmanaged",code:n?.nas||n?.authServer||"—",'
        'source:"live",warning:!0};'
    )
    if text.count(node_sample) != 1:
        raise RuntimeError("node sample gate marker mismatch")
    text = text.replace(node_sample, node_live, 1)

    # Provider catalog cache now carries live plans as well.
    catalog_read_old = (
        'return{providers:Array.isArray(n.providers)?n.providers:[],'
        'subscribers:Array.isArray(n.subscribers)?n.subscribers:[],'
        'incidents:Array.isArray(n.incidents)?n.incidents:[],'
    )
    catalog_read_new = (
        'return{providers:Array.isArray(n.providers)?n.providers:[],'
        'subscribers:Array.isArray(n.subscribers)?n.subscribers:[],'
        'plans:Array.isArray(n.plans)?n.plans:[],'
        'incidents:Array.isArray(n.incidents)?n.incidents:[],'
    )
    if text.count(catalog_read_old) != 1:
        raise RuntimeError("catalog plan read marker mismatch")
    text = text.replace(catalog_read_old, catalog_read_new, 1)

    catalog_write_old = (
        'JSON.stringify({providers:n.providers??[],subscribers:n.subscribers??[],'
        'incidents:n.incidents??[]'
    )
    catalog_write_new = (
        'JSON.stringify({providers:n.providers??[],subscribers:n.subscribers??[],'
        'plans:n.plans??[],incidents:n.incidents??[]'
    )
    if text.count(catalog_write_old) != 1:
        raise RuntimeError("catalog plan write marker mismatch")
    text = text.replace(catalog_write_old, catalog_write_new, 1)

    # The frozen console starts in a national command-center view with static
    # design telemetry. The Telegram provider runtime starts on the real
    # provider directory and uses only server-fed records.
    root_state_old = (
        'function dS(){const[n,t]=(0,m.useState)("ar"),[o,u]=(0,m.useState)(!1),'
        '[c,p]=(0,m.useState)("command"),'
    )
    root_state_new = (
        'function dS(){const[n,t]=(0,m.useState)("ar"),[o,u]=(0,m.useState)(!1),'
        '[c,p]=(0,m.useState)("providers"),'
    )
    if text.count(root_state_old) != 1:
        raise RuntimeError("root provider view marker mismatch")
    text = text.replace(root_state_old, root_state_new, 1)

    initial_catalog_old = '[ke,es]=(0,m.useState)(fN)'
    initial_catalog_new = (
        '[ke,es]=(0,m.useState)(window.__UCHIHA_PROVIDER_RUNTIME__===true?'
        '{providers:[],subscribers:[],plans:[],incidents:[],invoices:[],voucherBatches:[],'
        'backupRuns:[],networkNodes:[],pageInfo:{provider:null,subscriber:null,incident:null,'
        'invoice:null,voucher:null,backup:null,node:null}}:fN)'
    )
    if text.count(initial_catalog_old) != 1:
        raise RuntimeError("initial catalog state marker mismatch")
    text = text.replace(initial_catalog_old, initial_catalog_new, 1)

    bottom_old = '[bottomIds,setBottomIds]=(0,m.useState)(["command","subscribers","sessions","billing"])'
    bottom_new = '[bottomIds,setBottomIds]=(0,m.useState)(["providers","subscribers","sessions","billing"])'
    if text.count(bottom_old) != 1:
        raise RuntimeError("bottom navigation marker mismatch")
    text = text.replace(bottom_old, bottom_new, 1)

    # Remove the static sample records appended to smart global search. Live
    # search remains available for provider/audit/subscriber/node/session/
    # invoice records coming from the authoritative runtime arrays.
    search_base = text.find('mc=(0,m.useMemo)(()=>[')
    if search_base < 0:
        raise RuntimeError("global search base marker missing")
    search_static = text.find(',{title:"Atlas Connect",subtitle:', search_base)
    search_end = text.find('}],[ke,ye,h]),lt=', search_static)
    if search_static < 0 or search_end < 0:
        raise RuntimeError("global search static suffix marker mismatch")
    text = text[:search_static] + text[search_end + 1:]

    text = text.replace(
        'subtitle:`${b.user} · ${b.ip} · ${b.kind} · SAMPLE`',
        'subtitle:`${b.user} · ${b.ip} · ${b.kind} · LIVE RADIUS`',
        1,
    )

    # The authentication tab in frozen v101 contained four illustrative rows.
    # Keep the visual component but start it empty until a real auth-log feed is
    # implemented; never render those identities as production records.
    auth_rows = (
        'const t=[["02:14:32.084","omar.mansour","Atlas Connect","Accept","18 ms","MTK-A06"],'
        '["02:14:31.991","guest-317","NovaLink","Reject","23 ms","AP-NL33"],'
        '["02:14:31.808","corp-0991","WaveGrid","Accept","14 ms","CCR-WG01"],'
        '["02:14:31.402","sara.rami","Atlas Connect","Reject","20 ms","MTK-A02"]];'
    )
    if text.count(auth_rows) != 1:
        raise RuntimeError("authentication sample rows marker mismatch")
    text = text.replace(auth_rows, 'const t=[];', 1)
    text = text.replace(
        'title:n("نموذج سجل المصادقة","Authentication log sample"),'
        'subtitle:n("بيانات توضيحية حتى ربط موصل RADIUS","Illustrative data until the RADIUS connector is configured")',
        'title:n("سجل المصادقة","Authentication log"),'
        'subtitle:n("لا تُعرض أي سجلات حتى تصل بيانات مصادقة فعلية","No records are shown until real authentication telemetry is available")',
        1,
    )
    text = text.replace(
        '(0,e.jsx)(V,{tone:"blue",children:"DEMO"})',
        '(0,e.jsx)(V,{tone:"slate",children:n("بانتظار البيانات","Awaiting data")})',
        1,
    )

    # Session data is populated only from /radius-provider/sessions in the
    # Telegram runtime. Remove the remaining sample wording from that surface.
    session_replacements = {
        'n("بانتظار موصل RADIUS","RADIUS connector pending")':
            'n("RADIUS متصل","RADIUS connected")',
        'n("متوسط العينة","Sample average")':
            'n("متوسط الجلسات","Session average")',
        'n("مصدر البيانات: عينة تصميم حتى اكتمال الربط","Data source: design sample until connector setup")':
            'n("مصدر البيانات: RADIUS الفعلي للمزود","Data source: live provider RADIUS")',
        'j.runtimeSource==="local"?"Preview control state":"Illustrative sample"':
            'j.runtimeSource==="local"?"Confirmed control state":"Live RADIUS"',
    }
    for old, new in session_replacements.items():
        text = text.replace(old, new)

    session_badge = (
        'n("المعروض يأتي من جلسات RADIUS الفعلية للمزود. أوامر التحكم تمر عبر Backend v37 وSite Agent الموثق.",'
        '"Displayed records come from the provider RADIUS sessions. Control commands pass through Backend v37 and the authenticated Site Agent.")'
        '})]}),(0,e.jsx)(V,{tone:"orange",dot:!1,children:"SAMPLE"})'
    )
    session_badge_live = (
        'n("المعروض يأتي من جلسات RADIUS الفعلية للمزود. أوامر التحكم تمر عبر Backend v37 وSite Agent الموثق.",'
        '"Displayed records come from the provider RADIUS sessions. Control commands pass through Backend v37 and the authenticated Site Agent.")'
        '})]}),(0,e.jsx)(V,{tone:"green",dot:!1,children:"LIVE RADIUS"})'
    )
    if text.count(session_badge) != 1:
        raise RuntimeError("session live badge marker mismatch")
    text = text.replace(session_badge, session_badge_live, 1)

    # Empty demo arrays are already enforced above. Clean their zero-count
    # source labels so the user sees only authoritative provider records.
    source_replacements = {
        'n("محفوظ","persisted")]}),(0,e.jsxs)("span",{children:[(0,e.jsx)("i",{className:"sample"}),(0,e.jsx)("b",{children:B}),"SAMPLE"]})':
            'n("سجلات فعلية","live records")]})',
        'n("محفوظ","persisted")]}),(0,e.jsxs)("span",{children:[(0,e.jsx)("i",{className:"sample"}),j," SAMPLE"]})':
            'n("سجلات فعلية","live records")]})',
        'U+" محفوظة فعليًا · "+B+" عينات توضيحية"':
            'U+" سجلات فعلية"',
        'U+" persisted · "+B+" illustrative samples"':
            'U+" live records"',
        'O+" محفوظة فعليًا · "+j+" عينات توضيحية"':
            'O+" سجلات فعلية"',
        'O+" persisted · "+j+" illustrative samples"':
            'O+" live records"',
    }
    for old, new in source_replacements.items():
        text = text.replace(old, new)

    # A zero-count illustrative branch badge remains in the provider heading.
    # No branch data is exposed by the provider API yet: omit the badge.
    branch_badge = (',(0,e.jsxs)("span",{children:[(0,e.jsx)("i",{className:"branches"}),'
                    '(0,e.jsx)("b",{children:ne}),n("فرع عينة","sample branches")]})')
    if text.count(branch_badge) != 1:
        raise RuntimeError("illustrative branch summary marker mismatch")
    text = text.replace(branch_badge, '', 1)

    # The provider promo opens a fully static Atlas sample workspace. The
    # Telegram runtime hides it in CSS/DOM; also make its copy explicitly
    # unavailable so accidental invocation can never be mistaken for live data.
    text = text.replace(
        'n("افتح مساحة Atlas Connect التجريبية","Open the Atlas Connect sample workspace")',
        'n("مساحة المزود غير متاحة من هذا المسار","Provider workspace unavailable from this route")',
        1,
    )
    text = text.replace(
        'n("معاينة الانتقال من النطاق الوطني إلى مزود واحد؛ قياساتها الحالية SAMPLE.",'
        '"Preview the platform-to-provider transition; its current telemetry is SAMPLE.")',
        'n("استخدم صفحات المزود الحية من القائمة الرئيسية.","Use the live provider pages from the main menu.")',
        1,
    )

    # Detail sheets for live records must not append design timelines or
    # hard-coded provider/session values.
    static_timeline = (
        'is=[[h("تم تحديث البيانات","Data refreshed"),h("الآن · المحرك التشغيلي","Now · Operations engine"),"info"],'
        '[h("اكتملت المزامنة","Synchronization completed"),h("منذ 4 دقائق · النظام","4 minutes ago · System"),"success"],'
        '[h("تم تسجيل مراجعة إدارية","Administrative review recorded"),h("منذ 26 دقيقة · سجل التدقيق","26 minutes ago · Audit log"),"warning"]];'
    )
    if text.count(static_timeline) != 1:
        raise RuntimeError("static detail timeline marker mismatch")
    text = text.replace(static_timeline, 'is=[];', 1)

    text = text.replace(
        'description:h("هوية المزود ودورة حياته مع فصل القياسات المتصلة عن العينات",'
        '"Provider identity and lifecycle with connected telemetry separated from samples")',
        'description:h("هوية المزود ودورة حياته من قاعدة التشغيل الفعلية",'
        '"Provider identity and lifecycle from the live runtime database")',
        1,
    )
    text = text.replace(
        'b?.telemetryReady?"6 / 6 · SAMPLE":h("بانتظار الموصل","Awaiting connector")',
        'h("بانتظار قياس RADIUS","Awaiting RADIUS telemetry")',
        1,
    )
    text = text.replace(
        '[h("المزود","Provider"),"Atlas Connect"]',
        '[h("المزود","Provider"),window.__UCHIHA_PROVIDER_CONTEXT__?.provider?.name??"—"]',
        1,
    )

    session_detail_replacements = {
        'category:h("سجل جلسة توضيحي","Illustrative session record")':
            'category:h("جلسة RADIUS حية","Live RADIUS session")',
        'description:h("لقطة مرجعية لاختبار واجهة العمليات قبل ربط القياسات الحية",'
        '"A reference snapshot for testing the operations workflow before live telemetry is connected")':
            'description:h("جلسة فعلية متزامنة من شبكة المزود","A real session synchronized from the provider network")',
        'ge?.state==="disconnected"?h("مفصولة محليًا · معاينة","Locally disconnected · preview")':
            'ge?.state==="disconnected"?h("مفصولة","Disconnected")',
        'ge?.state==="watch"?h("تحتاج متابعة · مثال","Needs attention · example")':
            'ge?.state==="watch"?h("تحتاج متابعة","Needs attention")',
        ':h("مثال مستقر","Stable example")':
            ':h("متصلة","Online")',
        'healthLabel:h("مؤشر المثال","Example indicator")':
            'healthLabel:h("حالة الجلسة","Session state")',
        '[h("بداية المثال","Example start"),ge?.startedAt??"—"]':
            '[h("بداية الجلسة","Session start"),ge?.startedAt??"—"]',
        'ge?.runtimeSource==="local"?h("مثال + حالة تحكم محلية","Example + local control state"):'
        'h("مثال تصميم · ليست قياسات حية","Design example · not live telemetry")':
            'ge?.runtimeSource==="local"?h("حالة تحكم مؤكدة","Confirmed control state"):'
            'h("RADIUS فعلي","Live RADIUS")',
        'timeline:[[h("تم تحميل سجل المثال","Example record loaded"),'
        'h("الآن · واجهة الجلسات","Now · Session workspace"),"info"],'
        '[h("موصل RADIUS غير مفعّل","RADIUS connector is not enabled"),'
        'h("لا تُرسل أوامر إلى الشبكة","No commands are sent to the network"),"warning"]]':
            'timeline:[[h("تم تحميل الجلسة الفعلية","Live session loaded"),'
            'h("الآن · RADIUS المزود","Now · Provider RADIUS"),"success"]]',
    }
    for old, new in session_detail_replacements.items():
        text = text.replace(old, new, 1)

    # Remove fake access-gateway credentials from the production-derived bundle.
    text = text.replace('defaultValue:"yamen.admin"', 'placeholder:"operator"', 1)
    text = text.replace('defaultValue:"UCHIHA-DEMO-2026"', 'defaultValue:""', 1)

    # Fail closed instead of reporting a preview connector mode on network/API
    # errors in Telegram production runtime.
    text = text.replace(
        'return lAuthCache={authenticated:!1,mode:"preview",role:"preview",csrfToken:null,cachedAt:Date.now()}',
        'return lAuthCache={authenticated:!1,mode:"backend-unavailable",role:"none",csrfToken:null,cachedAt:Date.now()}',
    )
    text = text.replace(
        'const p={ok:!1,mode:"preview",adapter:"preview",contractVersion:"1.0",checkedAt:new Date().toISOString(),endpoint:t,reason:',
        'const p={ok:!1,mode:"backend-unavailable",adapter:"unavailable",contractVersion:"1.0",checkedAt:new Date().toISOString(),endpoint:t,reason:',
    )

    forbidden = (
        "UCHIHA-DEMO-2026",
        "corp-0991",
        "sara.rami",
        "Open the Atlas Connect sample workspace",
        "These are not live RADIUS records yet",
        "Data source: design sample until connector setup",
        "Illustrative session record",
        "Design example · not live telemetry",
        "Example record loaded",
    )
    remaining = [value for value in forbidden if value in text]
    if remaining:
        raise RuntimeError("strict live Telegram markers remain: " + ", ".join(remaining))
    return text


def enforce_live_finance_and_privacy(text: str) -> str:
    # In v101 the invoice view appends four showcase invoices to actual data.
    # Remove only the showcase suffix; preserve server-loaded invoice records.
    billing = text.find('function TN(')
    if billing < 0:
        raise RuntimeError("billing component marker missing")
    sample_first = 'persisted:!0}}),{id:"INV-82641"'
    start = text.find(sample_first, billing)
    end = text.find('}],[c,n]),O=', start if start >= 0 else billing)
    if start < 0 or end < 0 or end - start > 4000:
        raise RuntimeError("billing sample boundaries changed; refusing unsafe build")
    text = text[:start] + 'persisted:!0}})' + text[end + 1:]

    # A previous Telegram provider may have left data in the same browser's
    # localStorage. Never display that cache before or after a new login.
    catalog_read = 'function lC(){try{'
    if text.count(catalog_read) != 1:
        raise RuntimeError("provider cache boundary marker changed")
    empty = ('{providers:[],subscribers:[],plans:[],incidents:[],invoices:[],'
             'voucherBatches:[],backupRuns:[],networkNodes:[],'
             'pageInfo:{provider:null,subscriber:null,incident:null,invoice:null,'
             'voucher:null,backup:null,node:null}}')
    text = text.replace(
        catalog_read,
        'function lC(){if(window.__UCHIHA_PROVIDER_RUNTIME__===true)'
        'return ' + empty + ';try{',
        1,
    )

    # Production data and audit history belong in the provider database, not
    # unscoped browser storage shared by every provider using the same domain.
    # Retain offline local storage only in the original (non-Telegram) UI.
    for function_name in ('lS', 'lA', 'lAS', 'lB', 'lBS'):
        prefix = f'function {function_name}('
        start = text.find(prefix)
        opening = text.find('){', start)
        if start < 0 or opening < 0 or opening - start > 35:
            raise RuntimeError('local storage guard marker changed: ' + function_name)
        guard = ('return [];' if function_name in ('lA', 'lB') else 'return;')
        if text.find('window.__UCHIHA_PROVIDER_RUNTIME__===true', opening, opening + 120) >= 0:
            raise RuntimeError('local storage guard already applied: ' + function_name)
        text = (text[:opening + 2] +
                'if(window.__UCHIHA_PROVIDER_RUNTIME__===true)' + guard +
                text[opening + 2:])

    # Do not pretend that empty billing records have a historical timestamp.
    text = text.replace(
        'G=w[0]?.createdAt??"2026-09-01T00:00:00.000Z"',
        'G=w[0]?.createdAt??new Date().toISOString()',
        1,
    )
    forbidden = ('INV-82641', 'INV-82640', 'INV-82639', 'INV-82638')
    remaining = [value for value in forbidden if value in text]
    if remaining:
        raise RuntimeError("showcase billing records remain: " + ", ".join(remaining))
    return text


def enforce_measurement_integrity(text: str) -> str:
    # The provider sessions endpoint has no latency metric. Render missing
    # measurements as unknown, rather than fabricating zero-millisecond RTT.
    changes = {
        'A=Math.round(S.filter(j=>j.state!=="disconnected").reduce((j,k)=>j+k.latencyMs,0)/Math.max(S.filter(j=>j.state!=="disconnected").length,1))':
            'A=(()=>{const valid=S.filter(j=>j.state!=="disconnected"&&Number.isFinite(j.latencyMs));return valid.length?Math.round(valid.reduce((sum,item)=>sum+item.latencyMs,0)/valid.length):null})()',
        'String(j.latencyMs),j.runtimeSource':
            'j.latencyMs==null?"":String(j.latencyMs),j.runtimeSource',
        'children:[A," ms"]':
            'children:A==null?"—":[A," ms"]',
        '[j.latencyMs," ms"]':
            'j.latencyMs==null?"—":[j.latencyMs," ms"]',
        'health:ge?Math.max(20,100-ge.latencyMs):70':
            'health:ge?.state==="healthy"?100:0',
        'ge?`${ge.latencyMs} ms`:"—"':
            'ge?.latencyMs==null?"—":`${ge.latencyMs} ms`',
        '`${j.latencyMs} ms`':
            'j.latencyMs==null?"—":`${j.latencyMs} ms`',
        'children:n("RADIUS متصل","RADIUS connected")':
            'children:S.length?n("جلسات مزامنة","Synced sessions"):n("بانتظار ربط المزود","Awaiting provider link")',
    }
    for old, new in changes.items():
        if text.count(old) != 1:
            raise RuntimeError("latency integrity marker changed: " + old[:80])
        text = text.replace(old, new, 1)
    return text


def build(source: Path, runtime_js: Path, output: Path) -> dict[str, str | int]:
    before = sha256(source)
    text = source.read_text(encoding="utf-8")
    text = replace_demo_arrays(text)
    text = harden_runtime(text)
    text = live_provider_runtime(text)
    text = strict_live_runtime(text)
    text = enforce_live_finance_and_privacy(text)
    text = enforce_measurement_integrity(text)
    body_index = text.lower().find("<body")
    body_close = text.find(">", body_index)
    if body_index < 0 or body_close < 0:
        raise RuntimeError("body tag not found")
    boot = BOOTSTRAP.replace('telegram-runtime-v101.js', 'telegram-runtime-v101.js?v=' + sha256(runtime_js)[:12])
    text = text[:body_close + 1] + boot + text[body_close + 1:]
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
