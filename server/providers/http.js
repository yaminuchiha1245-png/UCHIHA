const { assertSafeOutboundUrl } = require("../lib/outboundPolicy");

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 12000);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function getPath(obj, path, fallback = undefined) {
  if (!path) return fallback;
  const value = String(path).split(".").reduce((cur,key)=>cur==null?undefined:cur[key], obj);
  return value === undefined ? fallback : value;
}

function authFor(config, rawUrl) {
  const token = config?.secretEnv ? process.env[config.secretEnv] : "";
  const headers = { "content-type":"application/json" };
  const url = new URL(rawUrl);
  if (!token) return { url:url.toString(), headers };

  const mode = String(config.authMode || "bearer").toLowerCase();
  if (mode === "query") {
    url.searchParams.set(config.authQuery || "api_key", token);
  } else if (mode === "header") {
    headers[config.authHeader || "x-api-key"] = `${config.authPrefix || ""}${token}`;
  } else if (mode !== "none") {
    headers[config.authHeader || "authorization"] = `${config.authPrefix ?? "Bearer "}${token}`;
  }
  return { url:url.toString(), headers };
}

function setPath(obj,path,value){
  const parts=String(path||"").split(".").filter(Boolean);
  if(!parts.length)return;
  let cur=obj;
  for(let i=0;i<parts.length-1;i++){
    const key=parts[i];
    if(!cur[key]||typeof cur[key]!=="object"||Array.isArray(cur[key]))cur[key]={};
    cur=cur[key];
  }
  cur[parts[parts.length-1]]=value;
}
function logicalValue(logical,values){
  if(Object.prototype.hasOwnProperty.call(values,logical))return values[logical];
  if(String(logical).startsWith("customerData.")){
    const key=String(logical).slice("customerData.".length);
    return values.customerData?.[key];
  }
  return undefined;
}
function buildCreatePayload(order, product, config) {
  const fields = {
    clientOrderId:"clientOrderId",
    productId:"productId",
    quantity:"quantity",
    customerInput:"customerInput",
    ...(config.requestFields || {})
  };
  const values = {
    clientOrderId:order.orderNo,
    productId:product.providerProductId || product.id,
    quantity:Number(order.quantity||1),
    customerInput:order.customerInput,
    customerData:order.customerData&&typeof order.customerData==="object"?order.customerData:{}
  };
  const body = { ...(config.fixedPayload || {}) };
  for (const [logical, providerField] of Object.entries(fields)) {
    if(!providerField)continue;
    const value=logicalValue(logical,values);
    if(value===undefined||value===null||value==="")continue;
    setPath(body,providerField,value);
  }
  for(const [customerKey,providerField] of Object.entries(product.providerInputMap||{})){
    const value=values.customerData?.[customerKey];
    if(value===undefined||value===null||value==="")continue;
    setPath(body,providerField,value);
  }
  return body;
}

function buildStatusPayload(order, config, method="GET") {
  const configured=config.statusRequestFields && typeof config.statusRequestFields==="object"
    ? config.statusRequestFields
    : (method==="GET" ? {} : {providerOrderId:"providerOrderId"});
  const values={
    providerOrderId:order.providerOrderId,
    clientOrderId:order.orderNo,
    productId:order.productId
  };
  const body={...(config.statusFixedPayload||{})};
  for(const [logical,providerField] of Object.entries(configured)){
    if(providerField)body[providerField]=values[logical];
  }
  return body;
}
function addQuery(url, values) {
  const u=new URL(url);
  for(const [key,value] of Object.entries(values||{})){
    if(value===undefined||value===null)continue;
    u.searchParams.set(key,typeof value==="object"?JSON.stringify(value):String(value));
  }
  return u.toString();
}

function normalizeCreateResponse(data, config) {
  return {
    ok:true,
    providerOrderId:String(
      getPath(data, config.responseOrderIdPath, data.orderId ?? data.id ?? "")
    ),
    status:String(
      getPath(data, config.responseStatusPath, data.status ?? data.state ?? "processing")
    ),
    message:String(
      getPath(data, config.responseMessagePath, data.message ?? data.note ?? "Provider accepted order")
    ),
    deliveryValue:getPath(data, config.responseDeliveryPath, null),
    raw:data
  };
}
function normalizeStatusResponse(data, config) {
  return {
    ok:true,
    status:String(getPath(data, config.responseStatusPath, data.status ?? data.state ?? "processing")),
    message:String(getPath(data, config.responseMessagePath, data.message ?? data.note ?? "Provider status synced")),
    deliveryValue:getPath(data, config.responseDeliveryPath, null),
    raw:data
  };
}

async function createOrder({ order, product, config }) {
  if (!config?.baseUrl || !config?.orderPath) throw new Error("http_provider_not_configured");
  const rawUrl = new URL(config.orderPath, config.baseUrl).toString();
  const safeUrl = await assertSafeOutboundUrl(rawUrl,{allowPrivateNetwork:config.allowPrivateNetwork===true,allowInsecureHttp:config.allowInsecureHttp===true});
  const auth = authFor(config, safeUrl);
  const body = buildCreatePayload(order, product, config);
  const method=String(config.orderMethod || "POST").toUpperCase();
  const t = timeoutSignal(config.timeoutMs || 12000);
  try {
    const request={method,headers:auth.headers,signal:t.signal,redirect:"manual"};
    const url=method==="GET"?addQuery(auth.url,body):auth.url;
    if(method!=="GET")request.body=JSON.stringify(body);
    const r = await fetch(url, request);
    if(r.status>=300&&r.status<400){
      const err=new Error("provider_redirect_forbidden");
      err.httpStatus=r.status;err.ambiguous=true;
      throw err;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(
        getPath(data, config.responseMessagePath, data.message) || `provider_http_${r.status}`
      );
      err.httpStatus = r.status;err.providerResponse = data;
      err.ambiguous = r.status>=500 || [408,425,429].includes(r.status);
      throw err;
    }
    return normalizeCreateResponse(data, config);
  } catch(e) {
    if(e.ambiguous===undefined)e.ambiguous=e.name==="AbortError"||e.name==="TypeError";
    throw e;
  } finally { t.cancel(); }
}

async function getOrderStatus({ order, config }) {
  if (!config?.baseUrl || !config?.statusPath) throw new Error("provider_status_not_configured");
  if (!order?.providerOrderId) throw new Error("provider_order_id_missing");
  const rel = String(config.statusPath)
    .replaceAll("{id}", encodeURIComponent(order.providerOrderId))
    .replaceAll("{providerOrderId}", encodeURIComponent(order.providerOrderId));
  const rawUrl = new URL(rel, config.baseUrl).toString();
  const safeUrl = await assertSafeOutboundUrl(rawUrl,{allowPrivateNetwork:config.allowPrivateNetwork===true,allowInsecureHttp:config.allowInsecureHttp===true});
  const auth = authFor(config, safeUrl);
  const method=String(config.statusMethod || "GET").toUpperCase();
  const payload=buildStatusPayload(order,config,method);
  const t = timeoutSignal(config.timeoutMs || 12000);
  try {
    const request={method,headers:auth.headers,signal:t.signal,redirect:"manual"};
    const url=method==="GET"?addQuery(auth.url,payload):auth.url;
    if(method!=="GET")request.body=JSON.stringify(payload);
    const r = await fetch(url, request);
    if(r.status>=300&&r.status<400){
      const err=new Error("provider_redirect_forbidden");
      err.httpStatus=r.status;err.ambiguous=true;
      throw err;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(
        getPath(data, config.responseMessagePath, data.message) || `provider_status_http_${r.status}`
      );
      err.httpStatus = r.status;err.providerResponse = data;
      err.ambiguous = r.status>=500 || [408,425,429].includes(r.status);
      throw err;
    }
    return normalizeStatusResponse(data, config);
  } catch(e) {
    if(e.ambiguous===undefined)e.ambiguous=e.name==="AbortError"||e.name==="TypeError";
    throw e;
  } finally { t.cancel(); }
}

module.exports = {
  createOrder, getOrderStatus, buildCreatePayload, buildStatusPayload, addQuery, normalizeCreateResponse,
  normalizeStatusResponse, getPath, setPath, logicalValue
};
