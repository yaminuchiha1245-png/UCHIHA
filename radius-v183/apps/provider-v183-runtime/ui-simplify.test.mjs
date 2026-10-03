import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
const ui=fs.readFileSync(path.join(root,'apps/provider-v183-runtime/ui-simplify.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/provider-v183-runtime/ui-simplify.css'),'utf8');

function harness(options={}){
 const nodes=new Map([['b',{textContent:''}],['small',{textContent:''}]]);
 const info={querySelector:s=>nodes.get(s),append:el=>nodes.set('.'+el.className,el)};
 const avatar={textContent:'',children:[],replaceChildren(...children){this.children=children},append(child){this.children.push(child)}};
 const profile={querySelector:s=>s==='.initials'?avatar:s==='div'?info:null};
 const nav={innerHTML:'',childElementCount:7};
 const result={nodes,avatar,nav,pages:[],opened:0,click:null};
 const controls={
  'drawer-nav':nav,'ops-pulse':options.pulse??null,'page-dashboard':options.dashboard??null,'add-form':{hidden:true},
  'add-toggle':{click:()=>{result.opened++}},
 };
 const ctx={URL,URLSearchParams,JSON,Number,String,document:{body:{dataset:{runtime:'preview'}},
  querySelector:s=>s==='.drawer-profile'?profile:null,
  createElement:tag=>({tagName:tag,className:'',textContent:'',title:'',src:'',alt:'',referrerPolicy:'',onerror:null}),
  addEventListener:(name,listener)=>{if(name==='click')result.click=listener},
 },
 window:{Telegram:{WebApp:{initDataUnsafe:{user:{id:999,username:'untrusted'}}}},matchMedia:()=>options.media??null},
 $:id=>controls[id],
 t:(ar)=>ar,
 art:name=>`<i class="art-${name}"></i>`,
 providerPages:{more:()=>'<section>Existing advanced sections</section>'},
 page:'dashboard',
 renderDrawer:()=>{nav.innerHTML='old'},
 navigate:route=>{result.pages.push(route);ctx.page=route},
 requestAnimationFrame:fn=>fn(),
 MutationObserver:class{observe(){}},
 };
 vm.createContext(ctx);
 vm.runInContext(ui+'\ninstallV183UiSimplify()',ctx);
 return Object.assign(result,{ctx});
}

test('compact menu preserves seven direct actions and real destination routes',()=>{
 const app=harness();
 assert.equal((app.nav.innerHTML.match(/class="drawer-link"/g)||[]).length,7);
 assert.ok(app.nav.innerHTML.includes('data-ui-add="mikrotik"'));
 assert.ok(app.nav.innerHTML.includes('data-ui-add="subscriber"'));
 assert.ok(app.nav.innerHTML.includes('data-page="more"'));
 assert.ok(!app.nav.innerHTML.includes('data-page="nas" data-ui-add'));
});
test('subscriber action opens subscribers form',()=>{
 const app=harness();
 app.click({target:{closest:()=>({dataset:{uiAdd:'subscriber'}})}});
 assert.equal(app.pages.at(-1),'subscribers');
 assert.equal(app.opened,1);
});
test('MikroTik shortcut opens NAS workspace',()=>{
 const app=harness();
 app.click({target:{closest:()=>({dataset:{uiAdd:'mikrotik'}})}});
 assert.equal(app.pages.at(-1),'nas');
});
test('account fallback is sourced from authenticated response',()=>{
 const app=harness();
 app.ctx.window.UCHIHA_V183_UI.updateProfile({user:{id:'usr-27',displayName:'Operator'}});
 assert.equal(app.nodes.get('b').textContent,'Operator');
 assert.match(app.nodes.get('.ui-account-id-uchiha').textContent,/usr-27/);
 assert.equal(app.avatar.textContent,'O');
});
test('verified profile appears after successful authentication',()=>{
 const app=harness();
 app.ctx.window.UCHIHA_V183_UI.updateProfile({user:{id:'usr-42',displayName:'Owner'}});
 const signed=new URLSearchParams({user:JSON.stringify({id:123456,username:'provider_account',first_name:'Provider'})}).toString();
 app.ctx.window.UCHIHA_V183_UI.setVerifiedTelegramProfile(signed);
 assert.equal(app.nodes.get('.ui-account-handle').textContent,'@provider_account');
});
test('advanced page keeps drawer-only features accessible',()=>{
 const app=harness();
 const html=app.ctx.providerPages.more();
 for(const route of ['team','integrations','telegram','support'])assert.ok(html.includes(`data-page="${route}"`));
 assert.ok(html.includes('Existing advanced sections'));
});

test('mobile CSS uses five-button navigation and safe areas',()=>{
 assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(css,/var\(--sab\)/);
 assert.match(css,/width:min\(364px,calc\(100vw - 18px\)\)/);
});

test('unverified Telegram WebApp data cannot supply profile name or photo',()=>{
 const app=harness();
 app.ctx.window.Telegram.WebApp.initDataUnsafe.user={id:999,username:'forged',photo_url:'https://example.test/forged.png'};
 app.ctx.window.UCHIHA_V183_UI.updateProfile({tenantName:'Real network',user:{id:'usr-9',displayName:'Verified owner',telegramUserId:999}});
 assert.equal(app.nodes.get('b').textContent,'Verified owner');
 assert.equal(app.nodes.get('small').textContent,'Real network');
 assert.match(app.nodes.get('.ui-account-handle').textContent,/غير متاح/);
 assert.equal(app.avatar.textContent,'V');
});

test('verified Telegram ID mismatch never supplies a second user profile',()=>{
 const app=harness(),ui=app.ctx.window.UCHIHA_V183_UI;
 ui.updateProfile({user:{id:'usr-23',displayName:'Member',telegramUserId:123}});
 ui.setVerifiedTelegramProfile(new URLSearchParams({user:JSON.stringify({id:999,username:'someone_else',first_name:'Wrong'})}).toString());
 assert.equal(app.nodes.get('b').textContent,'Member');
 assert.equal(app.nodes.get('.ui-account-id').textContent,'Telegram ID: 123');
 assert.match(app.nodes.get('.ui-account-handle').textContent,/غير متاح/);
});

test('phone layout moves the same chart before alerts and restores desktop order',()=>{
 const alerts={},chart={},order=[alerts,chart];
 for(const item of order)Object.defineProperty(item,'previousElementSibling',{get(){return order[order.indexOf(item)-1]??null}});
 const dashboard={querySelector:s=>s==='.dashboard-grid'?chart:null,insertBefore(item,before){
  order.splice(order.indexOf(item),1);order.splice(order.indexOf(before),0,item);
 }};
 let changed=null;
 const media={matches:true,addEventListener:(event,callback)=>{changed=callback}};
 harness({dashboard,pulse:alerts,media});
 assert.deepEqual(order,[chart,alerts]);
 media.matches=false;changed();
 assert.deepEqual(order,[alerts,chart]);
});

test('generic Google account avatar never masquerades as Telegram photo',()=>{
 const app=harness();
 app.ctx.window.UCHIHA_V183_UI.updateProfile({user:{id:'usr-45',displayName:'Network owner',avatarUrl:'https://accounts.google.com/profile-image.jpg'}});
 assert.equal(app.avatar.textContent,'N');
 assert.equal(app.avatar.children.length,0);
});

test('live network health keeps all three authenticated diagnostics visible on phones',()=>{
 assert.doesNotMatch(css,/body\[data-runtime=["']live["']\]\s*#page-dashboard\s*\.health-row:last-child\s*\{\s*display:none/);
 assert.match(css,/body\[data-runtime=["']live["']\]\s*#page-dashboard\s*\.health\s*\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
});

test('integrated mobile health and custom subscriber form coexist',()=>{
 assert.match(css,/\.v183-basic-subscriber-fields\{display:grid/);
 assert.match(css,/\.v183-subscriber-help\{/);
 assert.doesNotMatch(css,/\.health-row:last-child\s*\{display:none/);
});
