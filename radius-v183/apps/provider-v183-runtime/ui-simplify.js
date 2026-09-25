/* Optional presentation-only companion to the immutable V1-83 reference. */
function installV183UiSimplify(){
 const entries=[
  ['dashboard','dashboard','الرئيسية','Home',null],
  ['nas','router','إضافة MikroTik','Add MikroTik','mikrotik'],
  ['subscribers','user-add','إضافة مشترك','Add subscriber','subscriber'],
  ['subscribers','people','المشتركون','Subscribers',null],
  ['plans','plans','الباقات والأسعار','Plans & pricing',null],
  ['billing','receipt','التحصيل والدفعات','Collection & payments',null],
  ['more','network-tools','الإدارة المتقدمة','Advanced management',null]
 ];
 let verifiedAccount=null;
 let signedTelegramProfile=null;
 const originalRenderDrawer=renderDrawer;
 // The former drawer-only features remain reachable in Advanced management.
 const baseAdvancedPage=providerPages.more;
 providerPages.more=()=>baseAdvancedPage()+`<section class="panel tool-group"><header>${art('shield')}<h2>${t('الحساب والتكاملات','Account & integrations')}</h2></header><div class="tool-links">${[
  ['team','shield','الفريق والصلاحيات','Team & permissions'],
  ['integrations','link','التكاملات والربط','Integrations & connections'],
  ['telegram','bot','بوت التنبيهات','Telegram notification bot'],
  ['support','support','الحوادث والدعم','Incidents & support']
 ].map(([route,artwork,ar,en])=>`<button class="tool-link" data-page="${route}">${art(artwork)}<span>${t(ar,en)}</span></button>`).join('')}</div></section>`;
 function compactDrawer(){
  const nav=$('drawer-nav');if(!nav)return;
  const mainPages=['dashboard','nas','subscribers','plans','billing'];
  nav.innerHTML=entries.map(([route,artwork,ar,en,add])=>{
   const active=!add&&(page===route||(route==='more'&&!mainPages.includes(page)));
   return `<button type="button" class="drawer-link" ${add?`data-ui-add="${add}"`:`data-page="${route}"`} ${active?'aria-current="page"':''}><span class="art art-${artwork}" aria-hidden="true"></span><span>${t(ar,en)}</span></button>`;
  }).join('');
 }
 renderDrawer=function(){originalRenderDrawer();compactDrawer();if(verifiedAccount)updateProfile(verifiedAccount)};
 function safePhoto(raw){
  try{const url=new URL(String(raw||''));return url.protocol==='https:'?url.href:null}catch{return null}
 }
 function updateProfile(me){
  if(!me?.user)return;
  verifiedAccount=me;
  const user=me.user,linked=me.telegram||user.telegram||{};
  const fromSigned=signedTelegramProfile?.userId===user.id?signedTelegramProfile.profile:null;
  const apiTelegramId=user.telegramUserId??me.telegramUserId??linked.id??null;
  // Client-only initDataUnsafe must never supply an identity or photo.
  const matched=fromSigned&&(apiTelegramId==null||String(apiTelegramId)===String(fromSigned.id))?fromSigned:null;
  const telegramId=apiTelegramId??matched?.id??null;
  const rawHandle=user.telegramUsername??me.telegramUsername??linked.username??matched?.username??null;
  const handle=rawHandle?('@'+String(rawHandle).replace(/^@/,'')):null;
  const name=String(user.telegramDisplayName||me.telegramDisplayName||(matched?[matched.first_name,matched.last_name].filter(Boolean).join(' '):'')||user.displayName||user.name||'').trim()||t('الحساب الموثق','Verified account');
  const uchihaId=user.uchihaId??me.uchihaId??user.id??null;
  const profile=document.querySelector('.drawer-profile');if(!profile)return;
  const avatar=profile.querySelector('.initials');const info=profile.querySelector('div');
  const displayName=info.querySelector('b');
  displayName.removeAttribute?.('data-ar');displayName.removeAttribute?.('data-en');
  displayName.textContent=name;
  const tenantLabel=info.querySelector('small');
  tenantLabel?.removeAttribute?.('data-ar');tenantLabel?.removeAttribute?.('data-en');
  if(tenantLabel)tenantLabel.textContent=String(me.tenantName||'');
  const detail=(cls,text)=>{let el=info.querySelector('.'+cls);if(!el){el=document.createElement('small');el.className=cls;info.append(el)}el.textContent=text;el.title=text;return el};
  detail('ui-account-handle',handle||t('اسم Telegram غير متاح','Telegram username unavailable'));
  detail('ui-account-id',`Telegram ID: ${telegramId??'—'}`);
  detail('ui-account-id-uchiha',`UCHIHA ID: ${uchihaId??'—'}`);
  // A generic account/Google avatar must not be presented as a Telegram photo.
  const photo=safePhoto(user.telegramPhotoUrl??me.telegramPhotoUrl??linked.photoUrl??matched?.photo_url);
  if(avatar){avatar.replaceChildren();if(photo){const img=document.createElement('img');img.src=photo;img.alt='';img.referrerPolicy='no-referrer';img.onerror=()=>{avatar.replaceChildren(name[0]||'U')};avatar.append(img)}else avatar.textContent=name[0]||'U'}
 }
 document.addEventListener('click',event=>{
  const choice=event.target.closest?.('#drawer-nav [data-ui-add]');if(!choice)return;
  const action=choice.dataset.uiAdd;
  navigate(action==='subscriber'?'subscribers':'nas',true);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(action==='subscriber'&&page==='subscribers'&&$('add-form')?.hidden){$('add-toggle')?.click()}
   if(action==='mikrotik'&&page==='nas'){
    (document.querySelector('[data-v183-direct-choose]')||document.querySelector('[data-v183-create="device"]'))?.click();
   }
  }));
 });
 function compactAlerts(){
  if(document.body.dataset.runtime!=='live')return;
  const host=$('ops-pulse');if(!host||host.querySelector(':scope > .v183-alert-details'))return;
  const alerts=host.querySelectorAll(':scope > article');if(!alerts.length)return;
  const details=document.createElement('details');details.className='v183-alert-details';
  const summary=document.createElement('summary');summary.textContent=t(`عرض التنبيهات (${alerts.length})`,`View alerts (${alerts.length})`);
  details.append(summary);alerts.forEach(alert=>details.append(alert));host.append(details);
 }
 const pulse=$('ops-pulse');
 if(pulse){new MutationObserver(()=>compactAlerts()).observe(pulse,{childList:true});compactAlerts()}
 function setVerifiedTelegramProfile(verifiedInitData){
  // Called only after /auth/telegram accepted this exact signed initData.
  if(!verifiedAccount?.user?.id)return;
  try{
   const raw=new URLSearchParams(verifiedInitData).get('user');
   const profile=raw?JSON.parse(raw):null;
   if(!profile||!Number.isSafeInteger(Number(profile.id)))return;
   signedTelegramProfile={userId:verifiedAccount.user.id,profile};
   updateProfile(verifiedAccount);
  }catch{/* Keep verified account fields when Telegram omitted user data. */}
 }
 window.UCHIHA_V183_UI=Object.freeze({updateProfile,setVerifiedTelegramProfile});
 // On phones put the existing session chart before the collapsible alerts,
 // without removing any advanced panel or changing the desktop hierarchy.
 const smallScreen=window.matchMedia?.('(max-width:760px)');
 function arrangeDashboard(){
  const host=$('page-dashboard'),alerts=$('ops-pulse'),chart=host?.querySelector('.dashboard-grid');
  if(!host||!alerts||!chart)return;
  if(smallScreen?.matches&&alerts.previousElementSibling!==chart)host.insertBefore(chart,alerts);
  else if(!smallScreen?.matches&&chart.previousElementSibling!==alerts)host.insertBefore(alerts,chart);
 }
 smallScreen?.addEventListener?.('change',arrangeDashboard);
 arrangeDashboard();
 compactDrawer();
}
