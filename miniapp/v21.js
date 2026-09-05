/* Game Zone v2.1 production UX layer */
(()=>{
  const VERSION="2.1.0";
  const BOT_USERNAME="gamezone1store_bot";
  const $q=s=>document.querySelector(s);
  const $qa=s=>[...document.querySelectorAll(s)];
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  let pairingBootPromise=null;
  let kycCache=null;

  function safeState(){try{return state}catch{return null}}
  function safeToast(message){try{toast(message)}catch{console.log(message)}}
  function currentCurrency(){
    try{return String(localStorage.getItem("gamezone_display_currency")||safeState()?.user?.currency||"USD").toUpperCase()}catch{return "USD"}
  }
  function setCurrentCurrency(code){
    try{localStorage.setItem("gamezone_display_currency",code)}catch{}
  }

  const defaultCurrencies=[
    {code:"USD",name:"دولار أمريكي",symbol:"$",rate:1,enabled:true},
    {code:"EUR",name:"يورو",symbol:"€",rate:1,enabled:false},
    {code:"TRY",name:"ليرة تركية",symbol:"₺",rate:1,enabled:false},
    {code:"SYP",name:"ليرة سورية",symbol:"ل.س",rate:1,enabled:false}
  ];
  function currencyList(){
    const remote=safeState()?.config?.currencies;
    return Array.isArray(remote)&&remote.length?remote.map(x=>({code:String(x.code||"USD").toUpperCase(),name:String(x.name||x.code||""),symbol:String(x.symbol||""),rate:Number(x.rate||1),enabled:x.enabled===true})):defaultCurrencies;
  }

  function moneyRaw(value){return Number(value||0).toFixed(2)}
  function refreshBalanceChip(){
    const s=safeState(),btn=$q("#currencyBtn");if(!s||!btn)return;
    const code=currentCurrency();
    const cfg=currencyList().find(c=>c.code===code)||currencyList()[0];
    const shown=Number(s.user?.balance||0)*Number(cfg?.rate||1);
    btn.classList.add("gz21-balance-chip");
    btn.setAttribute("aria-label","فتح المحفظة");
    btn.innerHTML=`<span class="gz21-balance-amount">${moneyRaw(shown)} ${code}</span><span class="gz21-balance-label">رصيدك</span>`;
    btn.onclick=()=>{try{go("wallet")}catch{location.hash="#wallet"}};
    const hero=$q("#gz21WalletAmount");if(hero)hero.textContent=`${moneyRaw(shown)} ${code}`;
  }

  function paymentIcon(name=""){
    const x=String(name).toLowerCase();
    if(x.includes("binance")||x.includes("usdt"))return "₮";
    if(x.includes("cash")||x.includes("شام"))return "◈";
    if(x.includes("card")||x.includes("بطاق"))return "▰";
    if(x.includes("bank")||x.includes("بنك"))return "▦";
    return "+";
  }

  function renderCurrencyCards(){
    const host=$q("#gz21CurrencyGrid");if(!host)return;
    const selected=currentCurrency();
    const list=currencyList();
    host.innerHTML=list.map(c=>`<button class="gz21-currency-card ${selected===c.code?"active":""} ${c.enabled?"":"disabled"}" data-gz21-currency="${c.code}" ${c.enabled?"":"disabled"}>
      <span class="gz21-currency-status">${c.enabled?(selected===c.code?"الحالية":"متاحة"):"تفعيل الإدارة"}</span>
      <div class="code">${c.symbol} ${c.code}</div><b>${c.name}</b><small>${c.code==="USD"?"عملة المحفظة الأساسية":c.enabled?`1 USD = ${Number(c.rate).toLocaleString("en-US")} ${c.code}`:"غير مفعلة من الإدارة"}</small>
    </button>`).join("");
    $qa("[data-gz21-currency]").forEach(b=>b.onclick=()=>{
      if(b.disabled)return;
      setCurrentCurrency(b.dataset.gz21Currency);renderCurrencyCards();refreshBalanceChip();
      safeToast(`تم اختيار ${b.dataset.gz21Currency} كعملة العرض`);
    });
  }

  function renderPaymentCards(){
    const host=$q("#gz21PaymentGrid"),s=safeState();if(!host||!s)return;
    const methods=Array.isArray(s.config?.paymentMethods)?s.config.paymentMethods:[];
    if(!methods.length){host.innerHTML=`<div class="gz21-pay-card"><div class="gz21-card-icon">＋</div><b>إضافة رصيد</b><small>ستظهر طرق الدفع التي يفعّلها مدير المتجر هنا.</small></div>`;return}
    host.innerHTML=methods.map(m=>`<button class="gz21-pay-card" data-gz21-pay="${String(m.id).replace(/"/g,"&quot;")}">
      <div class="gz21-card-icon">${paymentIcon(m.name)}</div><b>${String(m.name||"طريقة دفع").replace(/[<>]/g,"")}</b><small>${m.minAmount?`من $${Number(m.minAmount).toFixed(2)}`:"اضغط لإنشاء طلب شحن"}</small>
    </button>`).join("");
    $qa("[data-gz21-pay]").forEach(btn=>btn.onclick=()=>{
      const topup=$q("#topupBtn");if(!topup)return;
      topup.click();
      setTimeout(()=>{
        const target=$qa("[data-payment-method]").find(x=>String(x.dataset.paymentMethod)===String(btn.dataset.gz21Pay));
        if(target)target.click();
      },40);
    });
  }

  function installWallet(){
    const screen=$q('.screen[data-screen="wallet"]');if(!screen||$q("#gz21WalletHero"))return;
    const head=screen.querySelector(".page-head");
    const hero=document.createElement("div");hero.id="gz21WalletHero";hero.className="gz21-wallet-hero";
    hero.innerHTML=`<div class="gz21-wallet-top"><div class="gz21-wallet-copy"><span>الرصيد المتاح</span><strong id="gz21WalletAmount">0.00 USD</strong><small>نفس الرصيد في Telegram والتطبيق</small></div></div>
      <div class="gz21-wallet-actions"><button class="primary" id="gz21TopupNow">＋ إضافة رصيد</button><button class="ghost" id="gz21WalletRefresh">تحديث</button></div>`;
    head?.insertAdjacentElement("afterend",hero);
    const legacy=screen.querySelector(".wallet-card");legacy?.classList.add("gz21-hide-legacy");
    hero.insertAdjacentHTML("afterend",`<div class="gz21-block"><div class="gz21-block-head"><h3>طرق إضافة الرصيد</h3><small>اختر الطريقة</small></div><div id="gz21PaymentGrid" class="gz21-grid"></div></div>
      <div class="gz21-block"><div class="gz21-block-head"><h3>العملات</h3><small>بدون أسعار صرف وهمية</small></div><div id="gz21CurrencyGrid" class="gz21-grid"></div></div>`);
    $q("#gz21TopupNow").onclick=()=>$q("#topupBtn")?.click();
    $q("#gz21WalletRefresh").onclick=async()=>{
      try{await loadWallet();if(!safeState()?.preview){const me=await api("/api/me");state.user=me;renderUser()}safeToast("تم تحديث الرصيد")}
      catch{safeToast("تعذر التحديث الآن")}
    };
    refreshBalanceChip();renderPaymentCards();renderCurrencyCards();
  }

  function kycTicket(){
    const s=safeState();
    const list=Array.isArray(s?.supportTickets)?s.supportTickets:[];
    return list.filter(t=>String(t.subject||"").startsWith("[KYC]")).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null;
  }
  function kycStatus(){
    const t=kycTicket();
    if(!t)return {key:"none",label:"غير موثق",ticket:null};
    const reply=String(t.reply||"");
    if(t.status==="closed"&&reply.includes("KYC_VERIFIED"))return {key:"verified",label:"موثق",ticket:t};
    if(t.status==="closed"&&reply.includes("KYC_REJECTED"))return {key:"rejected",label:"مرفوض",ticket:t};
    return {key:"pending",label:"قيد المراجعة",ticket:t};
  }
  function refreshKycBadge(){
    const pill=$q("#gz21KycStatus");if(!pill)return;
    const st=kycStatus();pill.className=`gz21-status-pill ${st.key}`;pill.textContent=st.label;
  }
  async function ensurePrivateLists(){
    const s=safeState();if(!s||s.preview||!s.sessionToken)return;
    try{s.supportTickets=await api("/api/support/tickets")}catch{}
  }
  function kycSheetBody(st){
    if(st.key==="verified")return `<h3>تحقق KYC</h3><div class="gz21-kyc-box"><h4>✅ الحساب موثق</h4><p>تمت مراجعة طلب التحقق واعتماده من إدارة Game Zone.</p></div><button data-sheet-close class="gz21-sheet-action">تم</button>`;
    if(st.key==="pending")return `<h3>تحقق KYC</h3><div class="gz21-kyc-box"><h4>⏳ الطلب قيد المراجعة</h4><p>تم استلام بيانات التحقق. قد تتواصل الإدارة معك عبر Telegram لإكمال مطابقة الوثيقة.</p></div><div class="gz21-privacy-note">لا ترسل كلمات مرور أو رموز دخول أو بيانات بطاقة دفع داخل طلب التحقق.</div><button data-sheet-close class="gz21-sheet-action">إغلاق</button>`;
    const rejected=st.key==="rejected"?`<div class="gz21-kyc-box"><h4>تعذر اعتماد الطلب السابق</h4><p>يمكنك إرسال طلب جديد ببيانات صحيحة. إن احتجت تفاصيل أكثر راجع رد الدعم.</p></div>`:"";
    return `<h3>تحقق KYC</h3>${rejected}<div class="gz21-kyc-box"><h4>توثيق الحساب</h4><p>أدخل البيانات الأساسية. لن نطلب كلمة مرور أو معلومات دفع. إذا احتاجت الإدارة مطابقة وثيقة فسيتم التواصل معك عبر Telegram.</p></div>
      <div class="gz21-field"><label>الاسم القانوني الكامل</label><input id="gz21KycName" maxlength="120" autocomplete="name"></div>
      <div class="gz21-field"><label>الدولة</label><input id="gz21KycCountry" maxlength="80" autocomplete="country-name"></div>
      <div class="gz21-field"><label>تاريخ الميلاد</label><input id="gz21KycDob" type="date"></div>
      <div class="gz21-field"><label>نوع الوثيقة</label><select id="gz21KycDoc"><option value="national_id">هوية وطنية</option><option value="passport">جواز سفر</option><option value="residence">إقامة</option><option value="other">أخرى</option></select></div>
      <div class="gz21-privacy-note">لخصوصيتك لا تدخل رقم الوثيقة الكامل هنا. هذه الخطوة تنشئ طلب تحقق فقط، ثم تجري الإدارة المطابقة عند الحاجة عبر قناة الدعم الرسمية.</div>
      <button id="gz21SubmitKyc" class="gz21-sheet-action">إرسال طلب التحقق</button>`;
  }
  async function openKyc(){
    const s=safeState();if(!s)return;
    if(s.preview)return openSheet(`<h3>تحقق KYC</h3><p>يظهر التحقق الحقيقي بعد ربط حساب Telegram.</p>`);
    await ensurePrivateLists();const st=kycStatus();kycCache=st;
    openSheet(kycSheetBody(st));
    const submit=$q("#gz21SubmitKyc");if(!submit)return;
    submit.onclick=async()=>{
      const fullName=String($q("#gz21KycName")?.value||"").trim();
      const country=String($q("#gz21KycCountry")?.value||"").trim();
      const dob=String($q("#gz21KycDob")?.value||"").trim();
      const docType=String($q("#gz21KycDoc")?.value||"").trim();
      if(fullName.length<3)return safeToast("أدخل الاسم الكامل");
      if(country.length<2)return safeToast("أدخل الدولة");
      if(!dob)return safeToast("أدخل تاريخ الميلاد");
      submit.disabled=true;submit.textContent="جارٍ الإرسال...";
      const message=["طلب تحقق KYC","الاسم: "+fullName,"الدولة: "+country,"تاريخ الميلاد: "+dob,"نوع الوثيقة: "+docType,"Telegram ID: "+String(s.user?.telegramId||"")].join("\n");
      try{
        await api("/api/support/tickets",{method:"POST",body:JSON.stringify({subject:`[KYC] ${fullName}`,message})});
        await ensurePrivateLists();refreshKycBadge();closeSheet();safeToast("تم إرسال طلب KYC للمراجعة");
      }catch{submit.disabled=false;submit.textContent="إرسال طلب التحقق";safeToast("تعذر إرسال طلب التحقق")}
    };
  }
  function installKyc(){
    const settings=$q('.screen[data-screen="account"] .settings');if(!settings||$q("#gz21KycBtn"))return;
    const button=document.createElement("button");button.id="gz21KycBtn";button.className="gz21-kyc-row";
    button.innerHTML=`تحقق KYC <span id="gz21KycStatus" class="gz21-status-pill">...</span>`;
    const anchor=$q("#privacyBtn");settings.insertBefore(button,anchor||settings.firstChild);
    button.onclick=openKyc;refreshKycBadge();
  }

  function renderPairUpgrade(){
    const gate=$q("#authGate"),card=gate?.querySelector(".auth-card");if(!card)return;
    if(!card.dataset.gz21){
      card.dataset.gz21="1";
      card.innerHTML=`<img src="/assets/game-zone-logo.png" alt="Game Zone">
        <h2>ربط حساب Game Zone</h2>
        <p class="gz21-auth-copy">احصل على كود الربط من بوت Game Zone، ثم اكتبه هنا. بعدها سيظهر نفس الرصيد والطلبات في البوت والتطبيق.</p>
        <div class="gz21-pair-input-wrap"><input id="gz21PairCode" class="gz21-pair-input" inputmode="text" maxlength="12" autocomplete="one-time-code" placeholder="CODE"></div>
        <button id="gz21OpenBot" class="gz21-telegram-btn">فتح @${BOT_USERNAME} والحصول على الكود</button>
        <button id="gz21VerifyPair" class="gz21-verify-btn">تحقق من الكود</button>
        <div id="gz21PairStatus" class="gz21-pair-state">سيتم تجهيز جلسة ربط آمنة عند فتح البوت.</div>
        <div class="gz21-auth-steps"><div class="gz21-auth-step"><b>1</b>افتح البوت</div><div class="gz21-auth-step"><b>2</b>انسخ الكود</div><div class="gz21-auth-step"><b>3</b>اكتبه هنا</div></div>`;
      $q("#gz21OpenBot").onclick=openBotForPair;
      $q("#gz21VerifyPair").onclick=verifyPairCode;
      $q("#gz21PairCode").addEventListener("keydown",e=>{if(e.key==="Enter")verifyPairCode()});
    }
    ensurePairSession().catch(()=>{});
  }
  function pairStatusText(text){const el=$q("#gz21PairStatus");if(el)el.textContent=text}
  async function ensurePairSession(){
    if(pairingBootPromise)return pairingBootPromise;
    pairingBootPromise=(async()=>{
      try{
        if(typeof restorePairState==="function"&&!pairState)pairState=restorePairState();
        if(pairState?.id&&pairState?.secret&&pairState?.code)return pairState;
        if(!API_BASE)return null;
        const r=await api("/api/device/pair/start",{method:"POST",body:"{}"});
        pairState={...r.pair,telegramDeepLink:r.telegramDeepLink};
        if(typeof savePairState==="function")savePairState();
        pairStatusText("جلسة الربط جاهزة — افتح البوت لتحصل على الكود.");
        return pairState;
      }catch(e){pairStatusText("تعذر تجهيز الربط. اضغط زر Telegram للمحاولة مجددًا.");return null}
      finally{pairingBootPromise=null}
    })();
    return pairingBootPromise;
  }
  async function openBotForPair(){
    const p=await ensurePairSession();
    if(!p)return safeToast("تعذر إنشاء جلسة الربط");
    const link=p.telegramDeepLink||`https://t.me/${BOT_USERNAME}?start=pair_${encodeURIComponent(p.code||"")}`;
    pairStatusText("بعد الضغط على Start سيعطيك البوت الكود. ارجع واكتبه هنا.");
    try{if(window.Telegram?.WebApp?.openTelegramLink)window.Telegram.WebApp.openTelegramLink(link);else location.href=link}catch{location.href=link}
  }
  async function verifyPairCode(){
    const input=$q("#gz21PairCode"),entered=String(input?.value||"").trim().toUpperCase().replace(/\s+/g,"");
    const p=await ensurePairSession();if(!p)return;
    const expected=String(p.code||"").trim().toUpperCase();
    if(!entered)return safeToast("أدخل الكود الذي أرسله البوت");
    if(entered!==expected){pairStatusText("الكود لا يطابق جلسة هذا الجهاز. افتح البوت من الزر الموجود هنا للحصول على الكود الصحيح.");return safeToast("الكود غير صحيح")}
    pairStatusText("جارٍ التحقق من Telegram...");
    try{
      const r=await api("/api/device/pair/status",{method:"POST",body:JSON.stringify({pairId:p.id,secret:p.secret})});
      if(r.status!=="approved"||!r.sessionToken){pairStatusText("لم يؤكد البوت الربط بعد. اضغط Start في Telegram ثم حاول مجددًا.");return}
      clearTimeout(pairTimer);saveSession(r.sessionToken,r.user);pairState=null;savePairState();hideAuthGate();
      await loadPrivateData();renderUser();renderHome();loadOrders();loadWallet();startLiveRefresh();
      refreshBalanceChip();renderPaymentCards();refreshKycBadge();safeToast("تم ربط حساب Telegram بنجاح");
    }catch{pairStatusText("تعذر التحقق الآن. حاول مرة أخرى.")}
  }

  function hookCore(){
    try{
      const originalRenderUser=renderUser;
      renderUser=function(){originalRenderUser();refreshBalanceChip();refreshKycBadge()};
    }catch{}
    try{
      const originalRenderConfig=renderConfig;
      renderConfig=function(){originalRenderConfig();renderPaymentCards()};
    }catch{}
    try{
      const originalShowAuthGate=showAuthGate;
      showAuthGate=function(){originalShowAuthGate();setTimeout(renderPairUpgrade,0)};
    }catch{}
    try{
      const originalHideAuthGate=hideAuthGate;
      hideAuthGate=function(){originalHideAuthGate();refreshBalanceChip()};
    }catch{}
    try{
      const originalLoadWallet=loadWallet;
      loadWallet=async function(){const out=await originalLoadWallet();refreshBalanceChip();renderPaymentCards();renderCurrencyCards();return out};
    }catch{}
    try{
      const originalLoadSupport=loadSupportTickets;
      loadSupportTickets=async function(){const out=await originalLoadSupport();refreshKycBadge();return out};
    }catch{}
  }

  function install(){
    hookCore();installWallet();installKyc();refreshBalanceChip();renderPairUpgrade();renderPaymentCards();renderCurrencyCards();
    document.documentElement.dataset.gameZoneVersion=VERSION;
    const observer=new MutationObserver(()=>{refreshBalanceChip();if(!$q("#gz21WalletHero"))installWallet();if(!$q("#gz21KycBtn"))installKyc();if($q("#authGate:not(.hidden)"))renderPairUpgrade()});
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(install,0));else setTimeout(install,0);
})();
