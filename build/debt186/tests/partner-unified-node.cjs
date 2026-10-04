const fs=require('fs'), path=require('path');
const root=process.argv[2];
if(!root)throw new Error('asset root required');
function read(name){return fs.readFileSync(path.join(root,name),'utf8')}
const app=read('app.js'), v145=read('app-v145.js'), partner=read('partner-entry-v186.js'), index=read('index.html');
const must=[
  [v145,'كود التفعيل أو كود الشريك'],
  [app,'إضافة الشركاء وإصدار أكوادهم تتم من لوحة الإدارة فقط'],
  [partner,"result?.role==='partner'"],
  [partner,"Android.cloudAuth('signin'"],
  [partner,"fresh.shop.name=String(info.store_name"],
  [partner,"cloudPartner:true"],
  [partner,"PartnerV186.setPin"],
  [index,'partner-entry-v186.js']
];
for(const [text,needle] of must){if(!text.includes(needle))throw new Error('missing '+needle)}
if(app.includes('onclick="openPartnerAdd()">＋ شريك</button>'))throw new Error('legacy in-app add partner button still visible');
console.log('partner unified activation regression: ok');
