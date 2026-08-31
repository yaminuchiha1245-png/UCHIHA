from pathlib import Path
import sys
root=Path(sys.argv[1])
js=root/'app/src/main/assets/app-v121.js'
s=js.read_text(encoding='utf-8')
old1='oninput="clientSearch=this.value;render()"'
old2='oninput="clientLedgerQuery=this.value;render()"'
if old1 not in s: raise SystemExit('client search marker missing')
if old2 not in s: raise SystemExit('ledger search marker missing')
s=s.replace(old1,'oninput="deferSearchRenderV124(\'clients\',this.value)"',1)
s=s.replace(old2,'oninput="deferSearchRenderV124(\'ledger\',this.value)"',1)
extra=r'''

/* v1.2.4 — keyboard focus stability during realtime/background sync */
(function(){
  let pendingUiRefreshV124=false;
  let pendingTimerV124=null;
  const rawRenderV124=window.render;

  function textInputFocusedV124(){
    const el=document.activeElement;
    if(!el)return false;
    if(el.isContentEditable)return true;
    const tag=(el.tagName||'').toLowerCase();
    if(tag==='textarea')return true;
    if(tag!=='input')return false;
    const t=(el.type||'text').toLowerCase();
    return !['button','submit','reset','checkbox','radio','range','color','file','hidden'].includes(t);
  }
  window.textInputFocusedV124=textInputFocusedV124;

  window.render=function(){
    if(textInputFocusedV124()){
      pendingUiRefreshV124=true;
      return;
    }
    pendingUiRefreshV124=false;
    return rawRenderV124();
  };

  function flushDeferredUiV124(){
    clearTimeout(pendingTimerV124);
    pendingTimerV124=setTimeout(()=>{
      if(!pendingUiRefreshV124||textInputFocusedV124())return;
      pendingUiRefreshV124=false;
      rawRenderV124();
    },120);
  }
  document.addEventListener('focusout',flushDeferredUiV124,true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)flushDeferredUiV124();});

  window.deferSearchRenderV124=function(kind,value){
    if(kind==='clients')clientSearch=value;
    else if(kind==='ledger')clientLedgerQuery=value;
    pendingUiRefreshV124=true;
  };
})();
'''
if 'textInputFocusedV124' in s: raise SystemExit('v124 already applied')
s=s.rstrip()+extra+'\n'
js.write_text(s,encoding='utf-8')

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if "versionCode 11" not in g or "versionName '1.2.3'" not in g: raise SystemExit('v123 gradle marker missing')
g=g.replace('versionCode 11','versionCode 12').replace("versionName '1.2.3'","versionName '1.2.4'")
gradle.write_text(g,encoding='utf-8')
print('PATCH_V124_OK')
