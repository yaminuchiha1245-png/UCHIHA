(function(){'use strict';
window.DebtDataGuard={
  valid(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.__read_error)return false;
    if(typeof value.setupDone!=='boolean')return false;
    for(const key of ['clients','entries','accounts'])if(!Array.isArray(value[key]))return false;
    for(const key of ['products','invoices','deferred','shortages','audit'])if(value[key]!==undefined&&!Array.isArray(value[key]))return false;
    for(const key of ['clients','entries','accounts']){
      const seen=new Set();for(const row of value[key]){
        if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||seen.has(row.id))return false;
        seen.add(row.id);
      }
    }
    if(!value.setupDone&&(value.clients.length||value.entries.length||value.accounts.length))return false;
    return !value.setupDone||value.accounts.length>0;
  },
  recovery(){
    const app=document.getElementById('app');if(!app)return;
    app.innerHTML='<main class="debt-activation"><h1>بياناتك تحتاج إلى استرجاع</h1><p>تعذّر قراءة الحفظ الحالي، لذلك أوقفنا الكتابة فوقه واحتفظنا بالنسخ الموجودة.</p><button class="btn primary full" onclick="pickBackup()">اختيار نسخة احتياطية</button><button class="btn ghost full" onclick="window.DebtUI&&DebtUI.openActivation()">التفعيل واستعادة النسخ السحابية</button><a class="btn ghost full" href="https://wa.me/963942586044">تواصل مع الإدارة</a></main>';
  }
};
window.addEventListener('DOMContentLoaded',()=>{if(window.__stateReadFailed)window.DebtDataGuard.recovery();});
})();
