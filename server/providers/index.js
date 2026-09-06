const manual = require("./manual");
const http = require("./http");

const staticProviders = { manual, http };

function getConfig(name, providerConfigs = []) {
  return providerConfigs.find(p => p.id === name) || { id:name, type:name, active:true };
}
function getAdapter(name, config) {
  return staticProviders[config?.type] || staticProviders[name];
}

async function runProvider(name, payload, providerConfigs = [], log = () => {}) {
  const config = getConfig(name, providerConfigs);
  if (!config.active) throw new Error(`provider_inactive:${name}`);
  const adapter = getAdapter(name, config);
  if (!adapter?.createOrder) throw new Error(`provider_not_configured:${name}`);
  const startedAt = Date.now();
  try {
    const result = await adapter.createOrder({ ...payload, config });
    log({providerId:name,orderNo:payload.order.orderNo,ok:true,durationMs:Date.now()-startedAt,status:result?.status||"processing",providerOrderId:result?.providerOrderId||null});
    return { ...result, providerUsed:name };
  } catch (e) {
    e.providerId=e.providerId||name;
    log({providerId:name,orderNo:payload.order.orderNo,ok:false,durationMs:Date.now()-startedAt,error:e.message,httpStatus:e.httpStatus||null,ambiguous:!!e.ambiguous});
    throw e;
  }
}

async function submitToProvider({ order, product, providerConfigs = [], log }) {
  const primary = product.providerPrimary || "manual";
  const backup = product.providerBackup || null;
  try {
    return await runProvider(primary, { order, product }, providerConfigs, log);
  } catch (primaryError) {
    const primaryConfig=getConfig(primary,providerConfigs);
    if(primaryError.ambiguous && primaryConfig.fallbackOnAmbiguous!==true){
      const err=new Error("provider_outcome_uncertain");
      err.code="provider_outcome_uncertain";err.providerId=primary;err.primaryError=primaryError.message;err.ambiguous=true;
      throw err;
    }
    if (!backup || backup === primary) throw primaryError;
    try {
      const result = await runProvider(backup, { order, product }, providerConfigs, log);
      return { ...result, fallbackFrom:primary };
    } catch (backupError) {
      if(backupError.ambiguous){
        const err=new Error("provider_outcome_uncertain");
        err.code="provider_outcome_uncertain";err.providerId=backup;err.primaryError=primaryError.message;err.backupError=backupError.message;err.ambiguous=true;
        throw err;
      }
      const err = new Error("all_providers_failed");
      err.primaryError = primaryError.message; err.backupError = backupError.message; throw err;
    }
  }
}

async function getProviderOrderStatus({ order, providerConfigs = [], log = () => {} }) {
  const name = order.providerUsed || order.providerPrimary;
  const config = getConfig(name, providerConfigs);
  const adapter = getAdapter(name, config);
  if (!adapter?.getOrderStatus) throw new Error("provider_status_not_supported");
  const startedAt = Date.now();
  try {
    const result = await adapter.getOrderStatus({ order, config });
    log({providerId:name,orderNo:order.orderNo,ok:true,durationMs:Date.now()-startedAt,status:result.status,operation:"status_sync"});
    return { ...result, providerUsed:name };
  } catch (e) {
    log({providerId:name,orderNo:order.orderNo,ok:false,durationMs:Date.now()-startedAt,error:e.message,httpStatus:e.httpStatus||null,operation:"status_sync"});
    throw e;
  }
}

module.exports = { submitToProvider, getProviderOrderStatus, staticProviders };
