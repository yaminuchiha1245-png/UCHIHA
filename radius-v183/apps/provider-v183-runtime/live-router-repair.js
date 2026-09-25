/* Guided repair for legacy duplicate device registrations.
 * Separating sites fixes ambiguous records, never claims hardware is online.
 * A human must confirm that the records represent different actual routers. */
function v183RepairCandidates(state) {
 const rows=state.diagnostics?.items||[];
 // Offer one-click repair for the two-record case only, including a safe retry
 // after one record was already moved before a network interruption.
 if(rows.length!==2 || !rows.some(row=>!row.siteId) ||
    rows.some(row=>row.verifiedOnline||row.agentOnline))return null;
 const [a,b]=rows;
 if(a.host!==b.host||a.port!==b.port)return null;
 if(!state.devices?.some(device=>device.id===a.id)||
    !state.devices?.some(device=>device.id===b.id))return null;
 for(const row of rows){
  if(!row.siteId && row.issues?.includes('DUPLICATE_IN_SITE'))continue;
  if(!row.siteId && rows.some(other=>other.siteId))continue;
  if(row.siteId && state.sites.some(site=>site.id===row.siteId &&
      site.code===v183RepairCode(row.id)))continue;
  return null;
 }
 return rows;
}
function v183RepairCode(id) {
 return 'R'+String(id).replace(/[^A-Za-z0-9]/g,'').slice(-18).toUpperCase();
}
function installV183RouterRepair(state,apiRequest,refresh,reportError,setBusy){
 if(state.routerRepairInstalled)return;
 state.routerRepairInstalled=true;
 const tr=(ar,en)=>t(ar,en);
 const safe=value=>esc(String(value??''));
 document.addEventListener('click',async event=>{
  const button=event.target.closest?.('[data-v183-repair-duplicates],[data-v183-repair-two-sites],[data-v183-repair-uncertain],[data-v183-single-router]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!v183CanCreate(state,'device')){
   reportError(Error(tr('لا تملك صلاحية تعديل الشبكة.','Router administration permission required.')));return;
  }
  const pair=v183RepairCandidates(state);
  if(!pair){
   reportError(Error(tr('تغيّرت بيانات الأجهزة؛ حدّث الصفحة وافحص الجهازين قبل المتابعة.',
     'Device records changed. Refresh and verify both routers first.')));return;
  }
  if('v183RepairDuplicates' in button.dataset){
   workspaceDialog(tr('معالجة العنوان المتكرر','Resolve duplicate router addresses'),
    '<p class="membership-callout">'+
      tr('السجلان لهما IP ومنفذ متطابقان. لا يمكن للتطبيق معرفة إن كانا راوترين مختلفين أم أن الراوتر نفسه أُضيف مرتين.',
         'Both records share an IP and port. The app cannot determine whether these are separate routers or an accidental duplicate.')+
    '</p><div class="workspace-form">'+
    pair.map((r,i)=>'<p>'+safe(String(i+1)+'. '+r.name)+' · <span dir="ltr">'+safe(r.host)+':'+safe(r.port)+'</span></p>').join('')+
    '<button type="button" class="btn btn-primary" data-v183-single-router>'+
      tr('إنه راوتر المزود الرئيسي؛ أضفته مرتين أثناء المحاولة','This is ONE main ISP router registered twice')+'</button>'+
    '<button type="button" class="btn btn-plain" data-v183-repair-two-sites>'+
      tr('هما راوتران مختلفان في شبكتين منفصلتين','Two separate routers on independent sites')+'</button>'+
    '<button type="button" class="btn btn-plain" data-v183-repair-uncertain>'+
      tr('قد يكون نفس الراوتر أو لست متأكدًا','May be the same router / I am unsure')+'</button>'+
    '</div>');
   return;
  }
  if('v183SingleRouter' in button.dataset){
   workspaceDialog(tr('اختر السجل الأصلي لراوتر المزود','Select the original ISP router record'),
    '<p class="membership-callout">'+
      tr('هذان سجلّان في التطبيق، وليس دليلًا على وجود جهازين. اختر سجلًا واحدًا لربطه؛ الآخر سيبقى محفوظًا للمراجعة، ولن ننشئ موقعًا ثانيًا أو نغيّر IP تلقائيًا.',
         'These are two application records, not proof of two physical routers. Pick ONE device ID for real enrollment; keep the other for audit. No second site or IP change.')+
    '</p><div class="workspace-form">'+pair.map(r=>
      '<p><b>'+safe(r.name)+'</b> · '+safe(r.id.slice(0,12))+'</p>'+
      '<button type="button" class="btn btn-primary" data-v183-direct-connect="'+safe(r.id)+'">'+
        tr('ربط مباشر مع الراوتر الرئيسي','Directly connect main ISP router')+'</button>'+
      '<button type="button" class="btn btn-plain" data-v183-agent-template data-v183-device-id="'+safe(r.id)+'">'+
        tr('بديل: ربط عبر Site Agent','Alternative: Site Agent')+'</button>').join('')+
      '</div><p class="provider-note">'+
      tr('يجب التأكد أن العنوان والمنفذ يخصان الراوتر الحقيقي. لا نطلب كلمة المرور داخل تيليغرام.',
         'Confirm this is the real RouterOS endpoint. Never enter the password in Telegram.')+'</p>');
   return;
  }
  if('v183RepairUncertain' in button.dataset){
   workspaceDialog(tr('تحقق قبل تعديل بيانات الأجهزة','Verify before changing devices'),
    '<p class="membership-callout">'+
     tr('لن نحذف أي جهاز أو نفصل أي اتصال تلقائيًا. إذا كان السجلان لنفس الراوتر، صحّح الجهاز الثاني أو احتفظ به حتى تتأكد من السجلات.',
        'No record is removed automatically. If both entries represent one router, correct the second entry or leave it until its history is confirmed.')+
    '</p><button class="btn btn-primary" data-page="nas">'+
      tr('مراجعة الأجهزة','Review devices')+'</button>');
   return;
  }
  if(!window.confirm(tr('هل تأكدت أن هذين راوتران مختلفان في شبكتين منفصلتين؟ سيتم إنشاء موقع لكل جهاز دون تغيير IP أو المنفذ. لن يظهر أي راوتر متصلاً حتى ينجح فحص Site Agent الحقيقي.',
    'Are these definitely two routers on separate networks? A site will be created for each without changing IP or port. Neither will be marked online before a real Site Agent probe.')))return;
  setBusy(button,true,tr('جارٍ تنظيم الموقعين…','Separating router sites…'));
  try{
   for(const router of pair){
    // Deterministic codes let a retry resume after a partial network failure.
    const code=v183RepairCode(router.id);
    const name='شبكة '+router.name; // Stable across UI language switches for safe retries.
    let site=state.sites.find(item=>item.code===code);
    if(site && site.name!==name)throw Error(tr('رمز موقع مستخدم؛ يلزم فحص المواقع أولاً.',
      'Site code collision: review existing sites.'));
    if(!site){
     site=await apiRequest('/sites',{method:'POST',
      body:{name,code},idempotent:true});
     if(!site?.id)throw Error(tr('تعذّر إنشاء الموقع.','Could not create site.'));
     state.sites.push(site);
    }
    await apiRequest('/devices/'+encodeURIComponent(router.id),{method:'PATCH',
     body:{siteId:site.id,reason:'Separate verified independent network registrations; RouterOS not yet connected'},
     idempotent:true});
   }
   await refresh();
   $('workspace-dialog')?.close();
   workspaceDialog(tr('اكتمل تنظيم السجلين','Device records separated'),
    '<p class="membership-callout">'+tr('أُنشئ موقع مستقل لكل جهاز. لم نغيّر العنوان أو المنفذ، ولا تزال الأجهزة غير متصلة حتى يُثبت Site Agent الوصول الحقيقي لكل شبكة.',
      'Each router now has its own site. IP and port were not changed, and both remain unverified until on-site connectivity is confirmed.')+'</p>'+
    '<button class="btn btn-primary" type="button" data-page="radius">'+
      tr('الانتقال إلى إعداد الربط الفعلي','Continue to real Site Agent pairing')+'</button>');
  }catch(error){
   try{await refresh()}catch{/* show original error, retry remains safe */}
   reportError(error);
  }finally{setBusy(button,false)}
 },true);
}
