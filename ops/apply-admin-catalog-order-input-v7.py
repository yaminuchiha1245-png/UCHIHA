from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label):
    out, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f"regex anchor failed ({n}): {label}")
    return out

# ---------- Server input schema: support masked password fields ----------
p = Path("server/lib/productInput.js")
s = p.read_text()
s = replace_once(s,
    'const TYPE_SET=new Set(["text","number","email","tel","select"]);',
    'const TYPE_SET=new Set(["text","number","email","tel","password","select"]);',
    "product input password type")
p.write_text(s)

# ---------- Mini App: render password as password and never echo it in confirmation ----------
p = Path("miniapp/app.js")
s = p.read_text()
s = replace_once(s,
    'const type=["number","email","tel"].includes(f.type)?f.type:"text";',
    'const type=["number","email","tel","password"].includes(f.type)?f.type:"text";',
    "miniapp input type")
s = replace_once(s,
    'return schema.map(f=>`<div class="confirm-line"><span>${esc(f.label||f.key)}</span><strong>${esc(data[f.key]||"-")}</strong></div>`).join("");',
    'return schema.map(f=>`<div class="confirm-line"><span>${esc(f.label||f.key)}</span><strong>${f.type==="password"&&data[f.key]?"••••••••":esc(data[f.key]||"-")}</strong></div>`).join("");',
    "miniapp password confirmation mask")
p.write_text(s)

# ---------- Native Android source: honor schema keyboard/password types ----------
p = Path("android/handoff/client/src/main/java/com/gamezone/store/MainActivity.java")
s = p.read_text()
if "import android.text.InputType;" not in s:
    s = replace_once(s, "import android.util.Base64;\n", "import android.util.Base64;\nimport android.text.InputType;\n", "android InputType import")
old = 'EditText e=new EditText(this);e.setTextColor(TEXT);e.setHintTextColor(MUTED);e.setHint(f.optString("placeholder",""));e.setSingleLine(true);e.setBackground(box(CARD2,12));'
new = 'EditText e=new EditText(this);e.setTextColor(TEXT);e.setHintTextColor(MUTED);e.setHint(f.optString("placeholder",""));e.setSingleLine(true);String fieldType=f.optString("type","text");if("password".equals(fieldType))e.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);else if("email".equals(fieldType))e.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);else if("tel".equals(fieldType))e.setInputType(InputType.TYPE_CLASS_PHONE);else if("number".equals(fieldType))e.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);e.setBackground(box(CARD2,12));'
s = replace_once(s, old, new, "android schema input type")
p.write_text(s)

# ---------- Admin HTML ----------
p = Path("admin/index.html")
s = p.read_text()
old = '<select id="ordersStatusFilter"><option value="">كل الحالات</option><option value="review">مراجعة المورد</option><option value="pending">pending</option><option value="processing">processing</option><option value="completed">completed</option><option value="failed">failed</option><option value="refunded">refunded</option><option value="cancelled">cancelled</option></select>'
new = '<select id="ordersStatusFilter"><option value="">كل الحالات</option><option value="review">مراجعة المورد</option><option value="pending">⏳ قيد الانتظار</option><option value="processing">✅ مقبول / قيد التنفيذ</option><option value="completed">✅ مكتمل</option><option value="failed">❌ مرفوض</option><option value="refunded">↩️ مسترد</option><option value="cancelled">🚫 ملغي</option></select>'
s = replace_once(s, old, new, "orders filter Arabic")
old = '<div class="panel"><div class="panel-head"><h2>أقسام المتجر</h2><button id="addCategoryBtn">＋ قسم</button></div><div id="categoriesTable" class="table-wrap"></div></div>'
new = '<div class="panel"><div class="panel-head"><h2>أقسام المتجر</h2><div class="panel-tools"><button id="addCategoryBtn">＋ قسم رئيسي</button><button id="addSubCategoryBtn">＋ قسم فرعي</button><button id="addNestedCategoryBtn">＋ فرع فرعي</button></div></div><div id="categoriesTable" class="table-wrap"></div></div>'
s = replace_once(s, old, new, "category buttons")
p.write_text(s)

# ---------- Admin JS ----------
p = Path("admin/admin.js")
s = p.read_text()

# Order status display + requested actions while keeping backend safety semantics.
render_orders = r'''function renderOrders(){
 let os=data.orders||[];
 const q=norm(filters.orders);if(q)os=os.filter(o=>norm(`${o.orderNo} ${o.telegramId} ${o.productName}`).includes(q));
 if(filters.orderStatus==="review")os=os.filter(o=>o.requiresManualReview);
 else if(filters.orderStatus)os=os.filter(o=>o.status===filters.orderStatus);
 const label=s=>({pending:"⏳ قيد الانتظار",processing:"✅ مقبول",completed:"✅ مكتمل",failed:"❌ مرفوض",refunded:"↩️ مسترد",cancelled:"🚫 ملغي"}[s]||s);
 const statePill=s=>{const cls=["completed"].includes(s)?"ok":["failed","cancelled"].includes(s)?"bad":"warn";return `<span class="pill ${cls}">${esc(label(s))}</span>`};
 $("#ordersTable").innerHTML=`<table><thead><tr><th>الطلب</th><th>المستخدم</th><th>المنتج</th><th>المبلغ</th><th>الربح</th><th>المزود</th><th>الحالة</th><th>قرار الإدارة</th></tr></thead><tbody>${os.map(o=>{
   const terminal=["completed","failed","refunded","cancelled"].includes(o.status);
   const actions=terminal?'<span class="gz-order-locked">تم إغلاق الطلب</span>':`<div class="actions gz-order-decisions"><button class="primary" data-action="set-order" data-id="${attr(o.id)}" data-status="processing">✅ مقبول</button><button data-action="set-order" data-id="${attr(o.id)}" data-status="pending">⏳ قيد الانتظار</button><button class="danger" data-action="set-order" data-id="${attr(o.id)}" data-status="failed">❌ مرفوض</button>${(o.providerUsed==="manual"||o.providerPrimary==="manual")&&["pending","processing"].includes(o.status)&&!o.manualFulfillmentStartedAt?`<button data-action="manual-start" data-id="${attr(o.id)}">بدء التنفيذ اليدوي</button>`:""}${o.providerOrderId?`<button data-action="sync-order" data-id="${attr(o.id)}">مزامنة</button>`:""}</div>`;
   return `<tr><td><button data-action="order-detail" data-id="${attr(o.id)}">${esc(o.orderNo)}</button></td><td>${esc(o.telegramId)}</td><td>${esc(o.productName)}</td><td>${money(o.finalPrice)}</td><td>${money(o.profit)}</td><td>${esc(o.providerUsed||"-")}</td><td>${statePill(o.status)}${o.requiresManualReview?'<br><span class="review-flag">⚠ مراجعة المورد</span>':""}</td><td>${actions}</td></tr>`;
 }).join("")||rowEmpty(8)}</tbody></table>`;
}
'''
s = regex_once(s, r'function renderOrders\(\)\{.*?\n\}\nfunction renderProducts\(\)\{', render_orders + 'function renderProducts(){', "renderOrders")

# Hierarchical category helpers.
old = 'function categoryOptions(selected,{excludeId=null,includeRoot=false}={}){const rows=(data.categories||[]).filter(c=>c.id!==excludeId);return `${includeRoot?`<option value="">قسم رئيسي</option>`:""}${rows.map(c=>`<option value="${attr(c.id)}" ${c.id===selected?"selected":""}>${esc(c.name)}</option>`).join("")}`;}'
new = r'''function categoryDepth(id){let depth=0,current=(data.categories||[]).find(c=>c.id===id),seen=new Set();while(current?.parentId&&!seen.has(current.id)&&depth<20){seen.add(current.id);depth++;current=(data.categories||[]).find(c=>c.id===current.parentId)}return depth}
function categoryOptions(selected,{excludeId=null,includeRoot=false,exactDepth=null,maxDepth=null}={}){let rows=(data.categories||[]).filter(c=>c.id!==excludeId);if(exactDepth!==null)rows=rows.filter(c=>categoryDepth(c.id)===exactDepth);if(maxDepth!==null)rows=rows.filter(c=>categoryDepth(c.id)<=maxDepth);rows.sort((a,b)=>categoryDepth(a.id)-categoryDepth(b.id)||Number(a.sort||0)-Number(b.sort||0));return `${includeRoot?`<option value="">— قسم رئيسي —</option>`:""}${rows.map(c=>{const d=categoryDepth(c.id),prefix=d===0?"رئيسي":d===1?"↳ فرعي":"↳↳ فرع فرعي";return `<option value="${attr(c.id)}" ${c.id===selected?"selected":""}>${prefix} — ${esc(c.name)}</option>`}).join("")}`;}
function inputPresetSchema(name){
 if(name==="none")return [];
 if(name==="phone")return [{key:"phone",label:"رقم الهاتف",type:"tel",required:true,placeholder:"مثال: +963...",minLength:4,maxLength:40}];
 if(name==="id")return [{key:"accountId",label:"ID / معرف الحساب",type:"text",required:true,placeholder:"أدخل الـ ID",minLength:1,maxLength:120}];
 if(name==="wallet")return [{key:"walletAddress",label:"عنوان المحفظة",type:"text",required:true,placeholder:"أدخل عنوان المحفظة",minLength:4,maxLength:200}];
 if(name==="email_password")return [{key:"email",label:"البريد الإلكتروني",type:"email",required:true,placeholder:"name@example.com",minLength:3,maxLength:160},{key:"password",label:"كلمة المرور",type:"password",required:true,placeholder:"أدخل كلمة المرور",minLength:1,maxLength:160}];
 return null;
}
function inputPresetOptions(selected="id",includeCustom=false){return `<option value="none" ${selected==="none"?"selected":""}>لا يحتاج بيانات</option><option value="phone" ${selected==="phone"?"selected":""}>رقم هاتف</option><option value="id" ${selected==="id"?"selected":""}>ID / معرف</option><option value="wallet" ${selected==="wallet"?"selected":""}>عنوان محفظة</option><option value="email_password" ${selected==="email_password"?"selected":""}>بريد إلكتروني + كلمة مرور</option>${includeCustom?`<option value="custom" ${selected==="custom"?"selected":""}>مخصص متقدم</option>`:""}`}
function inferInputPreset(schema){const rows=Array.isArray(schema)?schema:[];if(!rows.length)return "none";const keys=rows.map(x=>x.key).join(",");if(rows.length===1&&rows[0].type==="tel")return "phone";if(rows.length===1&&rows[0].key==="walletAddress")return "wallet";if(rows.length===2&&keys==="email,password")return "email_password";if(rows.length===1&&(rows[0].key==="accountId"||rows[0].key==="playerId"||rows[0].key==="value"))return "id";return "custom";}
'''
s = replace_once(s, old, new, "category and input preset helpers")

# Category creation: main/sub/sub-sub with constrained parent choices.
category_block = r'''function openCategoryCreate(level=0){
 const titles=["إضافة قسم رئيسي","إضافة قسم فرعي","إضافة قسم فرع فرعي"],parentDepth=level-1;
 const parentHtml=level===0?'<option value="">لا يوجد — قسم رئيسي</option>':categoryOptions(null,{exactDepth:parentDepth});
 if(level>0&&!parentHtml.trim()){toast(level===1?"أضف قسمًا رئيسيًا أولًا":"أضف قسمًا فرعيًا أولًا");return;}
 modal(`<h3>${titles[level]||titles[0]}</h3><div class="form-grid">
  <div class="field"><label>ID</label><input id="catId" placeholder="gift-cards"></div>
  <div class="field"><label>الاسم</label><input id="catName" placeholder="اسم القسم"></div>
  <div class="field full"><label>${level===0?"المستوى":"القسم الأب"}</label><select id="catParent" ${level===0?"disabled":""}>${parentHtml}</select></div>
  <div class="field"><label>الترتيب</label><input id="catSort" type="number" value="10"></div>
  <div class="field full"><label>الصورة</label><input id="catImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
  <div class="field full"><label>الوصف الداخلي</label><input id="catDesc"></div>
 </div><button class="save" id="catSave">إضافة</button>`);
 $("#catSave").onclick=async()=>{
  try{
   const imageUrl=await uploadAdminImage($("#catImage").files?.[0]||null,"category");
   const c={id:$("#catId").value.trim(),name:$("#catName").value.trim(),parentId:level===0?null:($("#catParent").value||null),imageUrl,icon:"",sort:Number($("#catSort").value),description:$("#catDesc").value,active:true};
   if(!c.id||!c.name)return toast("ID والاسم مطلوبان");
   if(level>0&&!c.parentId)return toast("اختر القسم الأب");
   if(preview){mock.categories.push(c);data.categories=mock.categories;$("#modal").classList.remove("show");renderCategories();return toast("تمت إضافة القسم")}
   await api("/api/admin/categories",{method:"POST",body:JSON.stringify(c)});$("#modal").classList.remove("show");await load();toast("تمت إضافة القسم");
  }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر إضافة القسم")}
 };
}
$("#addCategoryBtn").onclick=()=>openCategoryCreate(0);
$("#addSubCategoryBtn").onclick=()=>openCategoryCreate(1);
$("#addNestedCategoryBtn").onclick=()=>openCategoryCreate(2);
'''
s = regex_once(s, r'\$\("#addCategoryBtn"\)\.onclick=.*?\n\}\}\);\n\n(?=\$\("#addAnnouncementBtn"\))', category_block + '\n', "category create block")

# Product edit form with simple preset selector and advanced fallback.
edit_product = r'''function editProduct(id){
 const p=(data.products||[]).find(x=>x.id===id);if(!p)return;
 const preset=inferInputPreset(p.inputSchema);
 modal(`<h3>تعديل المنتج</h3><div class="form-grid">
  <div class="field full"><label>الاسم</label><input id="epName" value="${attr(p.name)}"></div>
  <div class="field"><label>القسم الذي يحتوي المنتج</label><select id="epCategory">${categoryOptions(p.categoryId)}</select></div>
  <div class="field full"><label>الصورة</label><input id="epImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
  <div class="field full"><label>الوصف — يظهر داخل التفاصيل فقط</label><textarea id="epDescription" rows="4">${esc(p.description||"")}</textarea></div>
  <div class="field"><label>السعر</label><input id="epPrice" type="number" step=".01" value="${Number(p.price||0)}"></div>
  <div class="field"><label>التكلفة</label><input id="epCost" type="number" step=".01" value="${Number(p.cost||0)}"></div>
  <div class="field"><label>العملة</label><input id="epCurrency" value="${attr(p.currency||"USD")}"></div>
  <div class="field full"><label>بيانات مطلوبة من العميل</label><select id="epInputPreset">${inputPresetOptions(preset,true)}</select><small>اختر نوع الحقل، وسيظهر تلقائيًا في البوت والتطبيق عند شراء هذا المنتج.</small></div>
  <div class="field full" id="epAdvancedWrap" style="${preset==="custom"?"":"display:none"}"><label>حقول مخصصة متقدمة — JSON</label><textarea id="epInputSchema" rows="6">${esc(JSON.stringify(Array.isArray(p.inputSchema)?p.inputSchema:[],null,2))}</textarea></div>
  <div class="field full"><label>ربط حقول العميل مع API — JSON</label><textarea id="epProviderInputMap" rows="4" placeholder='{"accountId":"player_id"}'>${esc(JSON.stringify(p.providerInputMap||{},null,2))}</textarea></div>
  <div class="field"><label>طريقة التنفيذ الداخلية</label><select id="epDelivery"><option value="auto" ${p.delivery==="auto"?"selected":""}>مزود API</option><option value="manual" ${p.delivery==="manual"?"selected":""}>يدوي</option><option value="inventory" ${p.delivery==="inventory"?"selected":""}>مخزون أكواد</option></select></div>
  <div class="field"><label>نص التسليم الظاهر للعميل</label><input id="epDeliveryText" maxlength="120" value="${attr(p.deliveryText||"")}" placeholder="فوري / خلال 30 دقيقة"></div>
  <div class="field"><label>Provider Product ID</label><input id="epProviderProductId" value="${attr(p.providerProductId||"")}"></div>
  <div class="field"><label>المزود الأساسي</label><select id="epPrimary">${providerOptions(p.providerPrimary)}</select></div>
  <div class="field"><label>المزود الاحتياطي</label><select id="epBackup"><option value="">بدون</option>${providerOptions(p.providerBackup)}</select></div>
  <div class="field"><label>الحالة</label><select id="epActive"><option value="true" ${p.active?"selected":""}>فعال</option><option value="false" ${!p.active?"selected":""}>متوقف</option></select></div>
 </div><button class="save" id="epSave">حفظ التغييرات</button>`);
 $("#epInputPreset").onchange=()=>{$("#epAdvancedWrap").style.display=$("#epInputPreset").value==="custom"?"":"none"};
 $("#epSave").onclick=async()=>{
  try{
   const file=$("#epImage").files?.[0]||null,imageUrl=file?await uploadAdminImage(file,"product"):p.imageUrl||null;
   const chosen=$("#epInputPreset").value;
   const inputSchema=chosen==="custom"?jsonArrayOrNull($("#epInputSchema").value):inputPresetSchema(chosen);
   const providerInputMap=jsonObjectOrNull($("#epProviderInputMap").value)||{};
   if(inputSchema===null)return toast("حقول بيانات العميل غير صالحة");
   const inputLabel=inputSchema[0]?.label||"بيانات الطلب";
   const patch={name:$("#epName").value,categoryId:$("#epCategory").value,imageUrl,icon:"",description:$("#epDescription").value,price:Number($("#epPrice").value),cost:Number($("#epCost").value),currency:$("#epCurrency").value,inputLabel,inputSchema,providerInputMap,delivery:$("#epDelivery").value,deliveryText:$("#epDeliveryText").value,providerProductId:$("#epProviderProductId").value||null,providerPrimary:$("#epPrimary").value,providerBackup:$("#epBackup").value||null,active:$("#epActive").value==="true",featured:false};
   if(preview){Object.assign(p,patch);p.profit=p.price-p.cost;$("#modal").classList.remove("show");renderProducts();return toast("تم الحفظ في المعاينة")}
   await api(`/api/admin/products/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(patch)});$("#modal").classList.remove("show");await load();toast("تم حفظ المنتج");
  }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر حفظ المنتج")}
 };
}
'''
s = regex_once(s, r'function editProduct\(id\)\{.*?\n\}\n(?=\$\("#addProductBtn"\))', edit_product, "edit product")

add_product = r'''$("#addProductBtn").onclick=()=>{
 modal(`<h3>إضافة منتج</h3><div class="form-grid">
  <div class="field full"><label>الاسم</label><input id="apName"></div>
  <div class="field"><label>القسم الذي يحتوي المنتج</label><select id="apCategory">${categoryOptions()}</select></div>
  <div class="field full"><label>الصورة</label><input id="apImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
  <div class="field full"><label>الوصف — داخل التفاصيل فقط</label><textarea id="apDescription" rows="4"></textarea></div>
  <div class="field"><label>السعر</label><input id="apPrice" type="number" step=".01"></div>
  <div class="field"><label>التكلفة</label><input id="apCost" type="number" step=".01"></div>
  <div class="field"><label>العملة</label><input id="apCurrency" value="USD"></div>
  <div class="field full"><label>بيانات مطلوبة من العميل</label><select id="apInputPreset">${inputPresetOptions("id",false)}</select><small>رقم الهاتف / ID / عنوان المحفظة / البريد الإلكتروني وكلمة المرور ستظهر تلقائيًا للعميل.</small></div>
  <div class="field full"><label>ربط الحقول مع API — اختياري JSON</label><textarea id="apProviderInputMap" rows="3">{}</textarea></div>
  <div class="field"><label>طريقة التنفيذ الداخلية</label><select id="apDelivery"><option value="manual">يدوي</option><option value="auto">مزود API</option><option value="inventory">مخزون أكواد</option></select></div>
  <div class="field"><label>نص التسليم الظاهر للعميل</label><input id="apDeliveryText" maxlength="120" value="فوري" placeholder="فوري / خلال 30 دقيقة"></div>
  <div class="field"><label>Provider Product ID</label><input id="apProviderProductId"></div>
  <div class="field"><label>المزود الأساسي</label><select id="apPrimary">${providerOptions("manual")}</select></div>
  <div class="field"><label>الاحتياطي</label><select id="apBackup"><option value="">بدون</option>${providerOptions()}</select></div>
 </div><button class="save" id="apSave">إضافة المنتج</button>`);
};
document.addEventListener("click",async e=>{if(e.target.id==="apSave"){
 try{
  const imageUrl=await uploadAdminImage($("#apImage").files?.[0]||null,"product");
  const inputSchema=inputPresetSchema($("#apInputPreset").value),providerInputMap=jsonObjectOrNull($("#apProviderInputMap").value)||{};
  if(inputSchema===null)return toast("اختر نوع بيانات العميل");
  const item={name:$("#apName").value.trim(),categoryId:$("#apCategory").value,imageUrl,icon:"",description:$("#apDescription").value,price:Number($("#apPrice").value),cost:Number($("#apCost").value),currency:$("#apCurrency").value,inputLabel:inputSchema[0]?.label||"بيانات الطلب",inputSchema,providerInputMap,delivery:$("#apDelivery").value,deliveryText:$("#apDeliveryText").value,providerProductId:$("#apProviderProductId").value||null,providerPrimary:$("#apPrimary").value,providerBackup:$("#apBackup").value||null,featured:false,active:true};
  if(!item.name)return toast("اسم المنتج مطلوب");if(!item.categoryId)return toast("اختر القسم الذي يحتوي المنتج");
  if(preview){item.id="preview_"+Date.now();item.profit=item.price-item.cost;mock.products.push(item);data.products=mock.products;$("#modal").classList.remove("show");renderProducts();return toast("تمت الإضافة في المعاينة")}
  await api("/api/admin/products",{method:"POST",body:JSON.stringify(item)});$("#modal").classList.remove("show");await load();toast("تمت إضافة المنتج");
 }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر إضافة المنتج")}
}});
'''
s = regex_once(s, r'\$\("#addProductBtn"\)\.onclick=.*?\n\}\}\);\n\n(?=\$\("#addCouponBtn"\))', add_product + '\n', "add product")

p.write_text(s)
print("GAME_ZONE_ADMIN_CATALOG_ORDER_INPUT_V7=PATCHED")
