from pathlib import Path
import sys
root=Path(sys.argv[1])
js=root/'app/src/main/assets/app-v121.js'
s=js.read_text(encoding='utf-8')
if '/* v1.2.5 — partners have full owner-level control + live search without keyboard loss */' in s: raise SystemExit('v125 already applied')

# Search inputs: update only results containers, never rebuild focused input.
s=s.replace("oninput=\"deferSearchRenderV124('clients',this.value)\"","oninput=\"searchRenderV125('clients',this.value)\"",1)
s=s.replace("oninput=\"deferSearchRenderV124('ledger',this.value)\"","oninput=\"searchRenderV125('ledger',this.value)\"",1)

old_clients='<div class="card" style="padding:4px 12px">${items||`<div class="empty"><div class="emoji">👥</div><b>لا يوجد عملاء</b>أضف أول عميل للبدء</div>`}</div>'
new_clients='<div id="clientResultsV125" class="card" style="padding:4px 12px">${items||`<div class="empty"><div class="emoji">👥</div><b>لا يوجد عملاء</b>أضف أول عميل للبدء</div>`}</div>'
if old_clients not in s: raise SystemExit('client results marker missing')
s=s.replace(old_clients,new_clients,1)

old_ledger='<div class="form-group ledger-search-v112"><input class="input" placeholder="بحث داخل السجل" value="${esc(clientLedgerQuery)}" oninput="searchRenderV125(\'ledger\',this.value)"></div>${table}`;'
new_ledger='<div class="form-group ledger-search-v112"><input class="input" placeholder="بحث داخل السجل" value="${esc(clientLedgerQuery)}" oninput="searchRenderV125(\'ledger\',this.value)"></div><div id="ledgerResultsV125">${table}</div>`;'
if old_ledger not in s: raise SystemExit('ledger results marker missing')
s=s.replace(old_ledger,new_ledger,1)

extra=r'''

/* v1.2.5 — partners have full owner-level control + live search without keyboard loss */
(function(){
  // Product decision: every authenticated store member has full owner-level UI control.
  window.isOwner=function(){ return !!currentAccount(); };
  window.can=function(){ return !!currentAccount(); };

  // Hydrated legacy permission flags must never reduce a partner's access in this version.
  const oldHydrateV125=window.cloudHydrateStore;
  if(typeof oldHydrateV125==='function'){
    window.cloudHydrateStore=async function(){
      const ok=await oldHydrateV125.apply(this,arguments);
      const a=currentAccount();
      if(a){a.permissions={purchase:true,payment:true,clients:true,editPurchase:true,deletePurchase:true,deleteCustomer:true};}
      return ok;
    };
  }

  function replaceSearchResultsV125(kind){
    const targetId=kind==='clients'?'clientResultsV125':'ledgerResultsV125';
    const target=document.getElementById(targetId); if(!target)return;
    const tmp=document.createElement('div');
    tmp.innerHTML=kind==='clients'?renderClients():renderClient();
    const fresh=tmp.querySelector('#'+targetId);
    if(fresh) target.innerHTML=fresh.innerHTML;
  }

  window.searchRenderV125=function(kind,value){
    if(kind==='clients') clientSearch=value;
    else if(kind==='ledger') clientLedgerQuery=value;
    else return;
    // Only replace the result list/table. The focused input remains the same DOM node,
    // so Android keeps the IME open and the cursor stays in place.
    replaceSearchResultsV125(kind);
  };

  // Partner cards now reflect the product rule rather than stale per-member flags.
  const oldPartnersV125=window.renderPartners;
  window.renderPartners=function(){
    let html=oldPartnersV125();
    html=html.replace(/شراء [✓✕]/g,'شراء ✓')
             .replace(/دفعة [✓✕]/g,'دفعة ✓')
             .replace(/عملاء [✓✕]/g,'عملاء ✓')
             .replace(/تعديل [✓✕]/g,'تعديل ✓')
             .replace(/حذف شراء [✓✕]/g,'حذف شراء ✓');
    return html;
  };
})();
'''
s=s.rstrip()+extra+'\n'
js.write_text(s,encoding='utf-8')

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if "versionCode 12" not in g or "versionName '1.2.4'" not in g: raise SystemExit('v124 gradle marker missing')
g=g.replace('versionCode 12','versionCode 13').replace("versionName '1.2.4'","versionName '1.2.5'")
gradle.write_text(g,encoding='utf-8')
print('PATCH_V125_OK')
