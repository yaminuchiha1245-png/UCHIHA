/* UCHIHA Debt Store v1.4.0 — functional motion engine (WAAPI + spring sampling) */
(()=>{
'use strict';
const root=document.documentElement, app=document.getElementById('app'), toastEl=document.getElementById('toast');
if(!app || !Element.prototype.animate) return;

const M={
  reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,
  navBusy:false,
  renderSeq:0,
  modalSeq:0,
  lastNavIndex:-1,
  lastView:'',
  observer:null,
  theme:localStorage.getItem('uchiha:theme')||'dark'
};
window.UCHIHA_MOTION=M;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function springSamples(from,to,{stiffness=250,damping=24,mass=1,frames=28}={}){
  if(M.reduce) return [to];
  const dt=1/60;let x=from,v=0;const out=[];
  for(let i=0;i<frames;i++){
    const force=-stiffness*(x-to), drag=-damping*v;
    const a=(force+drag)/mass;v+=a*dt;x+=v*dt;out.push(x);
  }
  out[out.length-1]=to;return out;
}
function springTransform(el,{y=14,x=0,scale=.985,duration=430,delay=0,opacity=true,stiffness=270,damping=25}={}){
  if(!el) return Promise.resolve();
  if(M.reduce){el.style.opacity='';el.style.transform='';return Promise.resolve();}
  const ys=springSamples(y,0,{stiffness,damping,frames:30});
  const xs=springSamples(x,0,{stiffness,damping,frames:30});
  const ss=springSamples(scale,1,{stiffness,damping,frames:30});
  const frames=ys.map((yy,i)=>({transform:`translate3d(${xs[i]}px,${yy}px,0) scale(${ss[i]})`,opacity:opacity?clamp(i/9,0,1):1}));
  const a=el.animate(frames,{duration,delay,easing:'linear',fill:'both'});
  return a.finished.catch(()=>{}).then(()=>{try{a.cancel();}catch(_e){} el.style.opacity='';el.style.transform='';});
}
function fadeSlide(el,{x=0,y=0,opacity=.0,duration=180,easing='cubic-bezier(.4,0,1,1)'}={}){
  if(!el||M.reduce)return Promise.resolve();
  const a=el.animate([{transform:'translate3d(0,0,0) scale(1)',opacity:1},{transform:`translate3d(${x}px,${y}px,0) scale(.99)`,opacity}],{duration,easing,fill:'forwards'});
  return a.finished.catch(()=>{});
}
function selectableChildren(scope){
  if(!scope)return[];
  return [...scope.querySelectorAll(':scope > .hero,:scope > .primary-actions,:scope > .quick-grid,:scope > .rate-strip,:scope > .notice,:scope > .section-title,:scope > .card,:scope > .sync-mini-v120,:scope > .barcode-hero-v130,:scope > .product-actions-v130,:scope > .product-list-v130,:scope > .scan-panel-v130,:scope > .cart-list-v130,:scope > .invoice-totals-v130,:scope > .mobile-ledger-wrap,:scope > .form-group,:scope > .client-stats-v121,:scope > .client-actions-v112,:scope > .empty')].slice(0,18);
}
function routeProgress(show=true){
  let el=document.querySelector('.motion-route-progress');
  if(show){if(!el){el=document.createElement('div');el.className='motion-route-progress';document.body.appendChild(el);}return el;}
  if(el){el.animate([{opacity:1},{opacity:0}],{duration:140,fill:'forwards'}).finished.catch(()=>{}).then(()=>el.remove());}
}
function skeleton(screen){
  if(M.reduce||!screen)return;
  const layer=document.createElement('div');layer.className='motion-skeleton-layer';layer.innerHTML='<div class="motion-skeleton"></div><div class="motion-skeleton"></div><div class="motion-skeleton"></div>';
  screen.appendChild(layer);
  layer.animate([{opacity:0},{opacity:1}],{duration:80,fill:'both'});
  setTimeout(()=>{if(layer.isConnected)layer.animate([{opacity:1},{opacity:0}],{duration:100,fill:'forwards'}).finished.catch(()=>{}).then(()=>layer.remove());},130);
}
function countText(el){
  if(M.reduce||!el||el.dataset.motionCounted==='1')return;
  const raw=el.textContent||'',m=raw.match(/-?[\d,.]+/);if(!m)return;
  const end=Number(m[0].replace(/,/g,''));if(!Number.isFinite(end)||Math.abs(end)>1e10)return;
  el.dataset.motionCounted='1';const prefix=raw.slice(0,m.index),suffix=raw.slice((m.index||0)+m[0].length),start=performance.now(),dur=520;
  function tick(t){const p=clamp((t-start)/dur,0,1),e=1-Math.pow(1-p,3),n=end*e;el.textContent=prefix+(Math.abs(end)>=100?new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n):n.toFixed(2))+suffix;if(p<1)requestAnimationFrame(tick);else el.textContent=raw;}
  requestAnimationFrame(tick);
}
function animateCounters(scope){
  if(!scope)return;scope.querySelectorAll('.hero .big,.summary-box strong,.client-stats-v121 strong,.stats-multi-v121 strong,.invoice-totals-v130 b').forEach(countText);
}
function installThemeButton(){
  const bar=document.querySelector('.topbar');if(!bar||bar.querySelector('.motion-theme-toggle'))return;
  const b=document.createElement('button');b.className='icon-btn motion-theme-toggle motion-focus-ring';b.type='button';b.setAttribute('aria-label','تبديل الوضع الفاتح والداكن');b.textContent=M.theme==='light'?'☀':'☾';b.onclick=()=>setTheme(M.theme==='light'?'dark':'light',true);bar.insertBefore(b,bar.querySelector('.account'));
}
function setTheme(theme,animate=false){
  M.theme=theme==='light'?'light':'dark';localStorage.setItem('uchiha:theme',M.theme);
  if(animate)document.body.classList.add('motion-changing-theme');
  root.dataset.theme=M.theme;
  document.querySelectorAll('.motion-theme-toggle').forEach(b=>b.textContent=M.theme==='light'?'☀':'☾');
  const meta=document.querySelector('meta[name=theme-color]');if(meta)meta.content=M.theme==='light'?'#eef3f9':'#080b10';
  if(animate)setTimeout(()=>document.body.classList.remove('motion-changing-theme'),380);
}
setTheme(M.theme,false);

function activeNavPill(){
  const nav=document.querySelector('.bottom-nav'),buttons=nav?[...nav.querySelectorAll('button')]:[];if(!nav||!buttons.length)return;
  const idx=buttons.findIndex(b=>b.classList.contains('active'));if(idx<0)return;
  let pill=nav.querySelector('.motion-nav-pill');if(!pill){pill=document.createElement('span');pill.className='motion-nav-pill';nav.appendChild(pill);}
  const active=buttons[idx];pill.style.left=active.offsetLeft+'px';pill.style.width=active.offsetWidth+'px';
  if(M.lastNavIndex>=0&&M.lastNavIndex<buttons.length&&M.lastNavIndex!==idx&&!M.reduce){
    const oldLeft=buttons[M.lastNavIndex].offsetLeft,delta=oldLeft-active.offsetLeft;
    pill.animate([{transform:`translateX(${delta}px) scale(.92)`,opacity:.55},{transform:'translateX(0) scale(1)',opacity:1}],{duration:390,easing:'cubic-bezier(.2,.9,.18,1.12)'});
  }
  M.lastNavIndex=idx;
  if(!M.reduce)active.querySelector('b')?.animate([{transform:'translateY(2px) scale(.84)'},{transform:'translateY(-2px) scale(1.12)'},{transform:'translateY(0) scale(1)'}],{duration:360,easing:'cubic-bezier(.2,.85,.25,1)'});
}
function animateDrawer(){
  const drawer=document.querySelector('.drawer'),back=document.querySelector('.drawer-backdrop');if(!drawer||drawer.dataset.motionIn)return;drawer.dataset.motionIn='1';
  if(M.reduce)return;
  back?.animate([{opacity:0},{opacity:1}],{duration:190,easing:'ease-out'});
  springTransform(drawer,{x:72,y:0,scale:.99,duration:440,stiffness:285,damping:27});
  [...drawer.querySelectorAll('.drawer-item')].forEach((el,i)=>springTransform(el,{x:18,y:0,scale:.99,duration:340,delay:Math.min(i,8)*24,stiffness:300,damping:28}));
}
function animateScreenIn(){
  const seq=++M.renderSeq,bar=document.querySelector('.topbar'),screen=document.querySelector('.screen'),setup=document.querySelector('.setup-card,.lock-card');
  routeProgress(false);installThemeButton();activeNavPill();animateDrawer();
  if(setup){springTransform(setup,{y:24,scale:.965,duration:520,stiffness:250,damping:23});return;}
  if(bar&&!M.reduce)bar.animate([{transform:'translateY(-9px)',opacity:.4},{transform:'translateY(0)',opacity:1}],{duration:250,easing:'cubic-bezier(.2,.8,.2,1)'});
  if(!screen)return;
  selectableChildren(screen).forEach((el,i)=>{if(seq!==M.renderSeq)return;springTransform(el,{y:16,scale:.982,duration:420,delay:Math.min(i,12)*28,stiffness:275,damping:26});});
  const bottom=document.querySelector('.bottom-nav');if(bottom&&!M.reduce)springTransform(bottom,{y:22,scale:.995,duration:410,delay:45,stiffness:290,damping:28});
  animateCounters(screen);
}
function animateMutation(node){
  if(M.reduce||!(node instanceof HTMLElement)||node.dataset.motionObserved)return;
  const match=node.matches?.('.client-item,.product-card-v130,.cart-item-v130,.invoice-line-v130,.notice,.card,.empty,.mobile-ledger tbody tr')?node:node.querySelector?.('.client-item,.product-card-v130,.cart-item-v130,.invoice-line-v130,.notice,.card,.empty,.mobile-ledger tbody tr');
  if(match&&!match.dataset.motionObserved){match.dataset.motionObserved='1';springTransform(match,{y:9,scale:.992,duration:310,stiffness:320,damping:29});}
}
function observeContent(){
  if(M.observer)M.observer.disconnect();
  M.observer=new MutationObserver(muts=>muts.forEach(m=>m.addedNodes.forEach(animateMutation)));
  M.observer.observe(app,{childList:true,subtree:true});
  const card=document.getElementById('modalCard');if(card)M.observer.observe(card,{childList:true,subtree:true});
}
observeContent();

const oldRender=window.render;
if(typeof oldRender==='function'){
  window.render=function(){const r=oldRender.apply(this,arguments);requestAnimationFrame(()=>requestAnimationFrame(animateScreenIn));return r;};
}
const oldNav=window.nav;
if(typeof oldNav==='function'){
  window.nav=function(target){
    if(M.navBusy)return;if(M.reduce){return oldNav.call(this,target);}M.navBusy=true;routeProgress(true);
    const screen=document.querySelector('.screen'),bar=document.querySelector('.topbar');skeleton(screen);
    Promise.all([fadeSlide(screen,{x:-8,y:4,opacity:.05,duration:145}),fadeSlide(bar,{y:-5,opacity:.2,duration:125})]).finally(()=>{
      oldNav.call(this,target);M.lastView=String(target||'');setTimeout(()=>{M.navBusy=false;},120);
    });
  };
}

const oldToggleDrawer=window.toggleDrawer;
if(typeof oldToggleDrawer==='function'){
  window.toggleDrawer=function(){
    const d=document.querySelector('.drawer'),b=document.querySelector('.drawer-backdrop');
    if(d&&!M.reduce){Promise.all([fadeSlide(d,{x:55,opacity:.1,duration:160}),fadeSlide(b,{opacity:0,duration:140})]).finally(()=>oldToggleDrawer.apply(this,arguments));return;}
    const r=oldToggleDrawer.apply(this,arguments);requestAnimationFrame(animateDrawer);return r;
  };
}

const oldOpenModal=window.openModal,oldCloseModal=window.closeModal;
if(typeof oldOpenModal==='function'){
  window.openModal=function(html){M.modalSeq++;const r=oldOpenModal.call(this,html);const modal=document.getElementById('modal'),card=document.getElementById('modalCard');if(!M.reduce){modal?.animate([{opacity:0},{opacity:1}],{duration:180,easing:'ease-out'});springTransform(card,{y:52,scale:.975,duration:470,stiffness:275,damping:26});}return r;};
}
if(typeof oldCloseModal==='function'){
  window.closeModal=function(){
    const token=++M.modalSeq,modal=document.getElementById('modal'),card=document.getElementById('modalCard');
    if(!modal||modal.classList.contains('hidden')||M.reduce)return oldCloseModal.apply(this,arguments);
    modal.style.pointerEvents='none';
    Promise.all([fadeSlide(card,{y:42,opacity:.15,duration:155}),fadeSlide(modal,{opacity:0,duration:160})]).finally(()=>{if(token===M.modalSeq){oldCloseModal.call(this);modal.style.pointerEvents='';}});
  };
}

const oldToast=window.toast;
if(typeof oldToast==='function'){
  window.toast=function(){const r=oldToast.apply(this,arguments);requestAnimationFrame(()=>{if(!toastEl||M.reduce)return;toastEl.animate([{transform:'translateX(-50%) translateY(18px) scale(.94)',opacity:0},{transform:'translateX(-50%) translateY(-3px) scale(1.025)',opacity:1,offset:.72},{transform:'translateX(-50%) translateY(0) scale(1)',opacity:1}],{duration:310,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});});return r;};
}

function ripple(ev){
  const target=ev.target.closest('button,.btn,.quick,.rate-strip,.notice,.drawer-item,.account-choice,.product-card-v130,.sync-mini-v120');if(!target||target.disabled)return;
  const r=target.getBoundingClientRect(),size=Math.max(r.width,r.height)*1.25,span=document.createElement('span');span.className='motion-ripple';span.style.width=span.style.height=size+'px';span.style.left=(ev.clientX-r.left)+'px';span.style.top=(ev.clientY-r.top)+'px';target.appendChild(span);target.classList.add('motion-pressed');
  if(!M.reduce){const a=span.animate([{transform:'translate(-50%,-50%) scale(.08)',opacity:.32},{transform:'translate(-50%,-50%) scale(1)',opacity:0}],{duration:520,easing:'cubic-bezier(.18,.72,.25,1)',fill:'forwards'});a.finished.catch(()=>{}).then(()=>span.remove());target.animate([{transform:'scale(1)'},{transform:'scale(.972)'},{transform:'scale(1)'}],{duration:240,easing:'cubic-bezier(.2,.75,.2,1)'});}else span.remove();
  setTimeout(()=>target.classList.remove('motion-pressed'),250);
}
document.addEventListener('pointerdown',ripple,{passive:true});

document.addEventListener('focusin',e=>{const el=e.target;if(el?.matches?.('.input,.select,.textarea')&&!M.reduce)el.animate([{transform:'scale(.994)'},{transform:'scale(1)'}],{duration:190,easing:'ease-out'});});
document.addEventListener('change',e=>{const el=e.target;if(el?.matches?.('input[type=checkbox],input[type=radio],select')&&!M.reduce)el.animate([{transform:'scale(.86)'},{transform:'scale(1.1)'},{transform:'scale(1)'}],{duration:280,easing:'cubic-bezier(.2,.8,.2,1)'});});

window.addEventListener('resize',()=>requestAnimationFrame(activeNavPill),{passive:true});
requestAnimationFrame(()=>requestAnimationFrame(animateScreenIn));
})();
