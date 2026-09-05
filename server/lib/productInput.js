const KEY_RE=/^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const TYPE_SET=new Set(["text","number","email","tel","select"]);

function cleanText(value,max=160){
  const s=String(value??"").trim();
  if(s.length>max)throw new Error("product_input_text_too_long");
  return s;
}
function normalizeField(field,index){
  if(!field||typeof field!=="object"||Array.isArray(field))throw new Error("invalid_product_input_schema");
  const key=String(field.key||"").trim();
  if(!KEY_RE.test(key))throw new Error("invalid_product_input_key");
  const label=cleanText(field.label||key,120);
  if(!label)throw new Error("product_input_label_required");
  const type=TYPE_SET.has(String(field.type||"text"))?String(field.type||"text"):"text";
  const placeholder=cleanText(field.placeholder||"",160);
  const help=cleanText(field.help||"",240);
  const required=field.required!==false;
  let minLength=Number.isFinite(Number(field.minLength))?Math.max(0,Math.floor(Number(field.minLength))):0;
  let maxLength=Number.isFinite(Number(field.maxLength))?Math.max(1,Math.floor(Number(field.maxLength))):500;
  maxLength=Math.min(maxLength,500);
  minLength=Math.min(minLength,maxLength);
  let min=Number.isFinite(Number(field.min))?Number(field.min):null;
  let max=Number.isFinite(Number(field.max))?Number(field.max):null;
  if(min!==null&&max!==null&&min>max)[min,max]=[max,min];
  let options=[];
  if(type==="select"){
    if(!Array.isArray(field.options)||!field.options.length||field.options.length>100)throw new Error("product_input_select_options_required");
    options=field.options.map((option,i)=>{
      if(typeof option==="string"){
        const value=cleanText(option,120);if(!value)throw new Error("invalid_product_input_option");
        return {value,label:value};
      }
      if(!option||typeof option!=="object"||Array.isArray(option))throw new Error("invalid_product_input_option");
      const value=cleanText(option.value,120),optionLabel=cleanText(option.label||option.value,120);
      if(!value||!optionLabel)throw new Error("invalid_product_input_option");
      return {value,label:optionLabel};
    });
    const unique=new Set(options.map(x=>x.value));
    if(unique.size!==options.length)throw new Error("duplicate_product_input_option");
  }
  return {key,label,type,required,placeholder,help,minLength,maxLength,min,max,options,sort:Number.isFinite(Number(field.sort))?Number(field.sort):index};
}
function sanitizeProductInputSchema(value,{fallbackLabel="بيانات الطلب",allowLegacyFallback=true}={}){
  if(value===undefined||value===null){
    if(!allowLegacyFallback)return [];
    return [{key:"value",label:cleanText(fallbackLabel||"بيانات الطلب",120)||"بيانات الطلب",type:"text",required:true,placeholder:"",help:"",minLength:1,maxLength:500,min:null,max:null,options:[],sort:0}];
  }
  if(!Array.isArray(value)||value.length>8)throw new Error("invalid_product_input_schema");
  const rows=value.map(normalizeField);
  const keys=new Set(rows.map(x=>x.key));
  if(keys.size!==rows.length)throw new Error("duplicate_product_input_key");
  rows.sort((a,b)=>a.sort-b.sort||a.key.localeCompare(b.key));
  return rows;
}
function sanitizeProviderInputMap(value,schema=[]){
  if(value===undefined||value===null||value==="")return {};
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_provider_input_map");
  const allowed=new Set((schema||[]).map(x=>x.key));
  const out={};
  for(const [key,targetRaw] of Object.entries(value)){
    if(!KEY_RE.test(key)||!allowed.has(key))throw new Error("invalid_provider_input_map_key");
    const target=cleanText(targetRaw,120);
    if(!target||/[\r\n]/.test(target))throw new Error("invalid_provider_input_map_target");
    out[key]=target;
  }
  return out;
}
function legacySchema(product={}){
  if(Array.isArray(product.inputSchema))return sanitizeProductInputSchema(product.inputSchema,{allowLegacyFallback:false});
  if(product.inputRequired===false)return [];
  return sanitizeProductInputSchema(undefined,{fallbackLabel:product.inputLabel||"بيانات الطلب"});
}
function normalizeValue(field,raw){
  if(raw===undefined||raw===null)return "";
  const value=String(raw).trim();
  if(!value)return "";
  if(value.length>field.maxLength)throw new Error(`customer_field_too_long:${field.key}`);
  if(value.length<field.minLength)throw new Error(`customer_field_too_short:${field.key}`);
  if(field.type==="number"){
    const n=Number(value);
    if(!Number.isFinite(n))throw new Error(`customer_field_invalid_number:${field.key}`);
    if(field.min!==null&&n<field.min)throw new Error(`customer_field_below_min:${field.key}`);
    if(field.max!==null&&n>field.max)throw new Error(`customer_field_above_max:${field.key}`);
    return value;
  }
  if(field.type==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error(`customer_field_invalid_email:${field.key}`);
  if(field.type==="tel"&&!/^[+0-9()\-\s]{4,40}$/.test(value))throw new Error(`customer_field_invalid_tel:${field.key}`);
  if(field.type==="select"&&!field.options.some(x=>x.value===value))throw new Error(`customer_field_invalid_option:${field.key}`);
  return value;
}
function validateCustomerData(product={},customerData,legacyCustomerInput=""){
  const schema=legacySchema(product);
  const supplied=customerData&&typeof customerData==="object"&&!Array.isArray(customerData)?customerData:{};
  const out={};
  for(let i=0;i<schema.length;i++){
    const field=schema[i];
    let raw=supplied[field.key];
    if((raw===undefined||raw===null||raw==="")&&i===0&&legacyCustomerInput!==undefined&&legacyCustomerInput!==null&&String(legacyCustomerInput).trim())raw=legacyCustomerInput;
    const value=normalizeValue(field,raw);
    if(field.required&&!value)throw new Error(`customer_field_required:${field.key}`);
    if(value)out[field.key]=value;
  }
  const known=new Set(schema.map(x=>x.key));
  for(const key of Object.keys(supplied))if(!known.has(key))throw new Error(`customer_field_unknown:${key}`);
  const primary=schema.length?String(out[schema[0].key]||""):"";
  return {schema,customerData:out,customerInput:primary};
}
function canonicalCustomerData(value){
  const obj=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  return Object.fromEntries(Object.keys(obj).sort().map(k=>[k,String(obj[k]??"").trim()]));
}
module.exports={sanitizeProductInputSchema,sanitizeProviderInputMap,validateCustomerData,canonicalCustomerData,legacySchema};
