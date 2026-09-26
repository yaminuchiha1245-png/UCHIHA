import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('./',import.meta.url);
const css=fs.readFileSync(new URL('ui-simplify.css',root),'utf8');
const connect=fs.readFileSync(new URL('live-direct-connect.js',root),'utf8');

test('existing direct router form uses a compact explicit ownership checkbox',()=>{
 assert.match(connect,/<label class="v183-direct-confirm"><input type="checkbox" name="owned" required><span>/);
 assert.match(connect,/\+'<\/span><\/label>'\+/);
 assert.match(css,/#v183-direct-connect-form \.v183-direct-confirm\{display:flex/);
 assert.match(css,/input\[type="checkbox"\]\{appearance:auto;flex:0 0 18px/);
});

test('MikroTik sheet is bounded to mobile viewport and leaves other dialogs alone',()=>{
 assert.match(css,/#workspace-dialog:has\(#v183-direct-connect-form\)/);
 assert.match(css,/max-height:min\(84dvh,calc\(100dvh - 48px\)\)/);
 assert.match(css,/overflow-x:hidden;overflow-y:auto/);
 assert.match(css,/padding:12px 12px calc\(28px \+ var\(--sab\)\)/);
 assert.doesNotMatch(css,/^\.workspace-dialog\{[^}]*width:100%/m);
});

test('router form inputs, long device ids and help actions must not widen the layout',()=>{
 assert.match(css,/#v183-direct-connect-form\{width:100%;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/#v183-direct-connect-form :is\(input:not\(\[type="checkbox"\]\),select,textarea\)\{display:block;width:100%;min-width:0;max-width:100%/);
 assert.match(css,/#v183-direct-connect-form>\.btn\{display:flex;[^}]*white-space:normal;overflow-wrap:anywhere/);
 assert.match(css,/#v183-direct-connect-form>\.btn>\.action-art\{flex:0 0 23px/);
});

test('TLS preflight, existing-router identity and approval remain unchanged',()=>{
 assert.match(connect,/const row=state\.devices\.find\(device=>device\.id===id\)/);
 assert.match(connect,/direct-preflight/);
 assert.match(connect,/direct-connect/);
 assert.match(connect,/if\(!data\.has\('owned'\)\)/);
 assert.match(connect,/if\(form\.dataset\.preflightChecked!=='yes'\)/);
 assert.match(connect,/data-v183-device-id/);
});
