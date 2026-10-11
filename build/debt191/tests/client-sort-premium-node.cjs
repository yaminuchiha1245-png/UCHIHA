const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const ui=fs.readFileSync(path.join(root,'app-v121.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'client-sort-v191.css'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const n of [
  'client-sort-trigger-v191','client-sort-sheet-v191','client-sort-grid-v191',
  'client-sort-option-v191','client-sort-current-v191','client-sort-sheet-open'
]) assert(ui.includes(n)||css.includes(n),'missing '+n);
assert(index.includes('client-sort-v191.css'),'premium sort css not linked');
assert(app.includes("classList.remove('client-sort-sheet-open')"),'modal cleanup missing');
assert(ui.includes("onclick=\"openClientSortV190()\""),'premium sort trigger missing');
assert(ui.includes("client-sort-sheet-open"),'bottom sheet activation missing');
console.log('PASS v1.5.35 premium customer sort UI');
