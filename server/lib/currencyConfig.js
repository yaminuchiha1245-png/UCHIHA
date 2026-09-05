const DEFINITIONS=Object.freeze([
  Object.freeze({code:"USD",name:"دولار أمريكي",symbol:"$",rate:1,enabled:true}),
  Object.freeze({code:"EUR",name:"يورو",symbol:"€",rate:1,enabled:false}),
  Object.freeze({code:"TRY",name:"ليرة تركية",symbol:"₺",rate:1,enabled:false}),
  Object.freeze({code:"SYP",name:"ليرة سورية",symbol:"ل.س",rate:1,enabled:false})
]);
const allowed=new Map(DEFINITIONS.map(x=>[x.code,x]));

function defaults(){return DEFINITIONS.map(x=>({...x}))}
function sanitizeAdminCurrencies(value){
  if(!Array.isArray(value))throw new Error("invalid_currencies");
  const seen=new Set(),input=new Map();
  for(const raw of value){
    if(!raw||typeof raw!=="object")throw new Error("invalid_currency_entry");
    const code=String(raw.code||"").trim().toUpperCase();
    if(!allowed.has(code))throw new Error("unsupported_currency");
    if(seen.has(code))throw new Error("duplicate_currency");
    seen.add(code);
    const def=allowed.get(code);
    let enabled=raw.enabled===true;
    let rate=Number(raw.rate);
    if(code==="USD"){enabled=true;rate=1;}
    else if(!Number.isFinite(rate)||rate<=0||rate>1e9){
      if(enabled)throw new Error(`invalid_currency_rate_${code}`);
      rate=def.rate;
    }
    input.set(code,{...def,enabled,rate:Number(rate)});
  }
  return DEFINITIONS.map(def=>input.get(def.code)||({...def}));
}
function publicCurrencies(value){
  try{return sanitizeAdminCurrencies(Array.isArray(value)?value:defaults())}
  catch{return defaults()}
}
module.exports={DEFINITIONS,defaults,sanitizeAdminCurrencies,publicCurrencies};
