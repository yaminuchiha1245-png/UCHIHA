from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old,new,1)

p=Path('miniapp/app.js')
s=p.read_text()

# Let native controls expose both length bounds where applicable.
old='''    const type=["number","email","tel"].includes(f.type)?f.type:"text";
    const min=f.min!=null?` min="${esc(f.min)}"`:"",max=f.max!=null?` max="${esc(f.max)}"`:"",maxlength=f.maxLength?` maxlength="${Number(f.maxLength)}"`:"";
    return `<div class="field"><label>${label}${f.required!==false?" *":""}</label><input id="orderField_${key}" type="${type}" placeholder="${placeholder}"${min}${max}${maxlength}>${help}</div>`;
'''
new='''    const type=["number","email","tel"].includes(f.type)?f.type:"text";
    const min=f.min!=null?` min="${esc(f.min)}"`:"",max=f.max!=null?` max="${esc(f.max)}"`:"",minlength=f.minLength?` minlength="${Number(f.minLength)}"`:"",maxlength=f.maxLength?` maxlength="${Number(f.maxLength)}"`:"";
    return `<div class="field"><label>${label}${f.required!==false?" *":""}</label><input id="orderField_${key}" type="${type}" placeholder="${placeholder}"${min}${max}${minlength}${maxlength}>${help}</div>`;
'''
s=replace_once(s,old,new,'product input native constraints')

start=s.index('function collectProductInputs(p){')
end=s.index('function customerDataLines(p,data){',start)
new_block=r'''function clientProductInputError(f,value){
  const label=String(f.label||f.key||"بيانات الطلب");
  if(f.required!==false&&!value)return `أدخل ${label}`;
  if(!value)return "";
  const maxLength=Number.isFinite(Number(f.maxLength))?Number(f.maxLength):500;
  const minLength=Number.isFinite(Number(f.minLength))?Number(f.minLength):0;
  if(value.length>maxLength)return `${label}: الحد الأقصى ${maxLength} حرفًا`;
  if(value.length<minLength)return `${label}: الحد الأدنى ${minLength} أحرف`;
  if(f.type==="number"){
    const n=Number(value);
    if(!Number.isFinite(n))return `${label}: أدخل رقمًا صحيحًا`;
    if(f.min!=null&&n<Number(f.min))return `${label}: القيمة أقل من الحد المسموح`;
    if(f.max!=null&&n>Number(f.max))return `${label}: القيمة أكبر من الحد المسموح`;
  }
  if(f.type==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return `${label}: البريد الإلكتروني غير صحيح`;
  if(f.type==="tel"&&!/^[+0-9()\-\s]{4,40}$/.test(value))return `${label}: رقم الهاتف غير صحيح`;
  if(f.type==="select"&&!(f.options||[]).some(o=>String(o.value)===value))return `${label}: اختر قيمة صحيحة`;
  return "";
}
function collectProductInputs(p){
  const data={};
  for(const f of productInputSchema(p)){
    const el=$("#orderField_"+f.key);if(!el){if(f.required!==false){toast(`تعذر العثور على حقل ${f.label||"بيانات الطلب"}`);return null}continue}
    const value=String(el.value||"").trim();
    const error=clientProductInputError(f,value);
    if(error){toast(error);el.focus();return null}
    if(value)data[f.key]=value;
  }
  return data;
}
'''
s=s[:start]+new_block+s[end:]
p.write_text(s)

# Pin the client/server validation parity into the production audit.
p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='if(!mini.includes("/api/verification"))failures.push("dedicated verification API missing from Mini App");\n'
check='if(!mini.includes("function clientProductInputError")||!mini.includes("customerData")||!mini.includes("البريد الإلكتروني غير صحيح")||!mini.includes("رقم الهاتف غير صحيح"))failures.push("client product input validation missing");\n'
if check not in s:
    s=replace_once(s,anchor,check+anchor,'client product input audit')
p.write_text(s)

print('Client product input validation prepared')
