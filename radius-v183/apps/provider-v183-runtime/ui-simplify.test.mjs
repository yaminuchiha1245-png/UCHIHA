import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
const ui=fs.readFileSync(path.join(root,'apps/provider-v183-runtime/ui-simplify.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/provider-v183-runtime/ui-simplify.css'),'utf8');

function harness(){
 const nodes=new Map([['b',{textContent:''}],['small',{textContent:''}]]);
 const info={querySelector:s=>nodes.get(s),append:el=>nodes.set('.'+el.className,el)};
 const avatar={textContent:'',children:[],replaceChildren(...children){this.children=children},append(child){this.children.push(child)}};
 const profile={querySelector:s=>s==='.initials'?avatar:s==='div'?info:null};
 const nav={innerHTML:'',childElementCount:7};
 const result={nodes,avatar,nav,pages:[],opened:0,click:null};
 const controls={
  'drawer-nav':nav,'ops-pulse':null,'add-form':{hidden:true},
  'add-toggle':{click:()=>{result.opened++}},
 };
 const ctx={URL,URLSearchParams,JSON,Number,String,document:{
  querySelector:s=>s==='.drawer-profile'?profile:null,
  createElement:tag=>({tagName:tag,className:'',textContent:'',title:'',src:'',alt:'',referrerPolicy:'',onerror:null}),
  addEventListener:(name,listener)=>{if(name==='click')result.click=listener},
 },
 window:{Telegram:{WebApp:{initDataUnsafe:{user:{id:999,username:'untrusted'}}}}},
 $:id=>controls[id],
 t:(ar)=>ar,
 art:name=>`<i class="art-${name}"></i>`,
 providerPages:{more:()=>'<section>Existing advanced sections</section>'},
 page:'dashboard',
 renderDrawer:()=>{nav.innerHTML='old'},
 navigate:route=>{result.pages.push(route);ctx.page=route},
 requestAnimationFrame:fn=>fn(),
 MutationObserver:class{},
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
