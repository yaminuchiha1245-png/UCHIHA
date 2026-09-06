const {backfillAuditChain}=require("./auditChain");
const {sanitizeDeliveryText}=require("./deliveryPromise");
const {hardenLegacyDemoState}=require("./productionPolicy");
const CURRENT_SCHEMA_VERSION=10;
const REQUIRED_COLLECTIONS=[
  "users","categories","products","orders","transactions","topups","coupons","providers",
  "providerLogs","adminAudit","favorites","notifications","paymentMethods","announcements",
  "broadcasts","supportTickets","orderEvents","inventoryCodes","securityEvents","devicePairs",
  "deletedAccounts","couponUsages","verificationRequests"
];

function ensureArray(db,key,changes){
  if(!Array.isArray(db[key])){db[key]=[];changes.push(`collection:${key}`);}
}

function migrateDatabase(db){
  if(!db||typeof db!=="object"||Array.isArray(db))throw new Error("invalid_database_state");
  const changes=[];
  const from=Number.isInteger(Number(db.schemaVersion))?Number(db.schemaVersion):0;

  for(const key of REQUIRED_COLLECTIONS)ensureArray(db,key,changes);
  if(!db.settings||typeof db.settings!=="object"||Array.isArray(db.settings)){db.settings={};changes.push("settings");}
  if(!db.storageMeta||typeof db.storageMeta!=="object"||Array.isArray(db.storageMeta)){db.storageMeta={};changes.push("storageMeta");}

  const defaults={
    storeName:"Game Zone",
    currency:"USD",
    maintenance:false,
    maintenanceMessage:"المتجر تحت الصيانة",
    orderSyncEnabled:true,
    orderSyncIntervalMs:60000,
    orderSyncBatchSize:10,
    inventoryLowStockThreshold:3,
    notificationRetentionDays:180,
    providerLogRetentionDays:90,
    auditRetentionDays:365,
    allowAccountDeletion:true,
    customerDataExportEnabled:true,
    devicePairExpiryMinutes:10,
    deviceSessionDays:30,
    adminSessionHours:12,
    adminSessionVersion:1
  };
  for(const [key,value] of Object.entries(defaults)){
    if(db.settings[key]===undefined){db.settings[key]=value;changes.push(`settings:${key}`);}
  }

  for(const user of db.users){
    if(user.balance===undefined){user.balance=0;changes.push(`user:${user.telegramId}:balance`);}
    if(!user.currency){user.currency=db.settings.currency||"USD";changes.push(`user:${user.telegramId}:currency`);}
    if(user.sessionVersion===undefined){user.sessionVersion=1;changes.push(`user:${user.telegramId}:sessionVersion`);}
  }

  for(const order of db.orders){
    if(!order.currency){order.currency=db.settings.currency||"USD";changes.push(`order:${order.orderNo}:currency`);}
    if(order.requiresManualReview===undefined)order.requiresManualReview=false;
    if(!order.deliveryText){
      const product=db.products.find(p=>p.id===order.productId);
      order.deliveryText=sanitizeDeliveryText(product?.deliveryText,product?.delivery||"manual");
      changes.push(`order:${order.orderNo}:deliveryText`);
    }
  }

  for(const product of db.products){
    if(product.inputSchema===undefined){
      product.inputSchema=product.delivery==="inventory"?[]:[{key:"value",label:product.inputLabel||"بيانات الطلب",type:"text",required:product.inputRequired!==false,placeholder:"",help:"",minLength:product.inputRequired===false?0:1,maxLength:500,min:null,max:null,options:[],sort:0}];
      changes.push(`product:${product.id}:inputSchema`);
    }
    if(product.providerInputMap===undefined){product.providerInputMap={};changes.push(`product:${product.id}:providerInputMap`);}
    if(!product.deliveryText){product.deliveryText=sanitizeDeliveryText("",product.delivery);changes.push(`product:${product.id}:deliveryText`);}
  }

  for(const coupon of db.coupons){
    if(coupon.maxUsesPerUser===undefined)coupon.maxUsesPerUser=1;
    if(coupon.uses===undefined)coupon.uses=0;
  }

  for(const provider of db.providers){
    if(provider.fallbackOnAmbiguous===undefined)provider.fallbackOnAmbiguous=false;
    if(provider.allowPrivateNetwork===undefined)provider.allowPrivateNetwork=false;
    if(provider.allowInsecureHttp===undefined)provider.allowInsecureHttp=false;
    if(provider.webhookSecretEnv===undefined)provider.webhookSecretEnv=null;
  }

  if(from<10){
    const hardened=hardenLegacyDemoState(db);
    for(const change of hardened.changes)changes.push(`production:${change}`);
  }

  const auditRows=db.adminAudit||[];
  const legacyAuditChain=auditRows.length>0&&auditRows.every(x=>!x.hash&&!x.prevHash);
  if(legacyAuditChain){
    const auditBackfill=backfillAuditChain(auditRows);
    if(auditBackfill.changed)changes.push(`auditChainLegacyBackfill:${auditBackfill.count}`);
  }else if(auditRows.length&&process.env.AUDIT_HMAC_KEY){
    // Upgrade only a chain that is provably valid under the old unkeyed SHA-256 scheme.
    // A chain that is invalid under both schemes remains untouched so integrity scanning can block startup/readiness.
    const {verifyAuditChain}=require("./auditChain");
    const current=verifyAuditChain(auditRows);
    if(!current.ok){
      const legacySha=verifyAuditChain(auditRows,{secret:""});
      if(legacySha.ok){
        const upgraded=backfillAuditChain(auditRows,{secret:process.env.AUDIT_HMAC_KEY});
        if(upgraded.changed)changes.push(`auditChainShaToHmac:${upgraded.count}`);
      }
    }
  }

  if(from!==CURRENT_SCHEMA_VERSION||changes.length){
    db.schemaVersion=CURRENT_SCHEMA_VERSION;
    changes.push(`schemaVersion:${from}->${CURRENT_SCHEMA_VERSION}`);
    db.storageMeta.schemaMigratedAt=new Date().toISOString();
    db.storageMeta.schemaMigratedFrom=from;
  }

  return {
    changed:changes.length>0,
    from,
    to:CURRENT_SCHEMA_VERSION,
    changes,
    db
  };
}

module.exports={CURRENT_SCHEMA_VERSION,REQUIRED_COLLECTIONS,migrateDatabase};
