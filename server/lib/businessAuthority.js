const crypto=require("node:crypto");
const {stableStringify}=require("./backupFormat");

const EPS=0.000001;
const ORDER_STATUSES=new Set(["processing","pending","completed","failed","refunded","cancelled"]);
const TOPUP_STATUSES=new Set(["pending","approved","rejected"]);

function money(value){return Number(Number(value||0).toFixed(6))}
function sha(value){return crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}
function hmac(value,key){
  const secret=String(key||"");
  if(!secret)return null;
  return crypto.createHmac("sha256",secret).update(stableStringify(value)).digest("hex");
}
function subjectKey(telegramId,key){
  const secret=String(key||"");
  if(!secret)return null;
  return crypto.createHmac("sha256",secret).update(`business:${String(telegramId||"")}`).digest("hex");
}
function orderImmutable(order={},key=""){
  return {
    orderNo:String(order.orderNo||""),
    productId:String(order.productId||""),
    productName:String(order.productName||""),
    basePrice:money(order.basePrice),
    discount:money(order.discount),
    finalPrice:money(order.finalPrice),
    cost:money(order.cost),
    profit:money(order.profit),
    currency:String(order.currency||"USD"),
    couponCode:order.couponCode?String(order.couponCode):null,
    clientRequestId:String(order.clientRequestId||""),
    createdAt:String(order.createdAt||"")
  };
}
function topupImmutable(topup={},key=""){
  return {
    amount:money(topup.amount),
    currency:String(topup.currency||"USD"),
    method:String(topup.method||""),
    clientRequestId:String(topup.clientRequestId||""),
    createdAt:String(topup.createdAt||"")
  };
}
function orderBody(order={},revision=0,key=""){
  const immutable=orderImmutable(order,key);
  return {
    orderId:String(order.id||""),
    orderNo:immutable.orderNo,
    subjectKey:subjectKey(order.telegramId,key),
    productId:immutable.productId,
    status:String(order.status||""),
    finalPrice:immutable.finalPrice,
    currency:immutable.currency,
    providerOrderId:order.providerOrderId?String(order.providerOrderId):null,
    providerUsed:order.providerUsed?String(order.providerUsed):null,
    requiresManualReview:!!order.requiresManualReview,
    immutableDigest:sha(immutable),
    lastStateRevision:Number(revision||0)
  };
}
function topupBody(topup={},revision=0,key=""){
  const immutable=topupImmutable(topup,key);
  return {
    topupId:String(topup.id||""),
    subjectKey:subjectKey(topup.telegramId,key),
    amount:immutable.amount,
    currency:immutable.currency,
    method:immutable.method,
    status:String(topup.status||""),
    reference:topup.reference?String(topup.reference):null,
    immutableDigest:sha(immutable),
    lastStateRevision:Number(revision||0)
  };
}
function rowHmac(body,key){return hmac(body,key)}
function metaBody({cutoverRevision=0,lastStateRevision=0,orderCount=0,topupCount=0,orderDigest="",topupDigest=""}={}){
  return {
    cutoverRevision:Number(cutoverRevision||0),
    lastStateRevision:Number(lastStateRevision||0),
    orderCount:Number(orderCount||0),
    topupCount:Number(topupCount||0),
    orderDigest:String(orderDigest||""),
    topupDigest:String(topupDigest||"")
  };
}
function metaHmac(body,key){return hmac(metaBody(body),key)}

function projectOrders(db={},revision=0,key=""){
  const rows=(db.orders||[]).map(o=>orderBody(o,revision,key));
  rows.sort((a,b)=>a.orderId.localeCompare(b.orderId));
  return rows;
}
function projectTopups(db={},revision=0,key=""){
  const rows=(db.topups||[]).map(t=>topupBody(t,revision,key));
  rows.sort((a,b)=>a.topupId.localeCompare(b.topupId));
  return rows;
}
function businessSummary(db={},revision=0,key=""){
  const orders=projectOrders(db,revision,key),topups=projectTopups(db,revision,key);
  return {
    orderCount:orders.length,
    topupCount:topups.length,
    orderDigest:sha(orders.map(x=>[x.orderId,x.orderNo,x.status,x.providerOrderId,x.providerUsed,x.requiresManualReview,x.immutableDigest])),
    topupDigest:sha(topups.map(x=>[x.topupId,x.status,x.reference,x.immutableDigest]))
  };
}
function allowedOrderTransition(before,after){
  const a=String(before||""),b=String(after||"");
  if(a===b)return true;
  if(!ORDER_STATUSES.has(a)||!ORDER_STATUSES.has(b))return false;
  if(["processing","pending"].includes(a))return ["processing","pending","completed","failed","cancelled","refunded"].includes(b);
  if(a==="completed")return b==="refunded";
  if(a==="failed")return b==="refunded";
  if(a==="cancelled")return b==="refunded";
  return false;
}
function allowedTopupTransition(before,after){
  const a=String(before||""),b=String(after||"");
  if(a===b)return true;
  if(!TOPUP_STATUSES.has(a)||!TOPUP_STATUSES.has(b))return false;
  return a==="pending"&&["approved","rejected"].includes(b);
}
function mapById(rows=[]){return new Map(rows.map(x=>[String(x.id||""),x]))}

function deriveBusinessChanges(beforeDb={},afterDb={},key=""){
  const beforeOrders=mapById(beforeDb.orders||[]),afterOrders=mapById(afterDb.orders||[]);
  const beforeTopups=mapById(beforeDb.topups||[]),afterTopups=mapById(afterDb.topups||[]);
  const orders=[],topups=[];

  for(const [id,before] of beforeOrders){
    if(!afterOrders.has(id))throw new Error("business_authority_order_deletion_forbidden");
    const after=afterOrders.get(id);
    if(sha(orderImmutable(before,key))!==sha(orderImmutable(after,key)))throw new Error("business_authority_order_immutable_change");
    const beforeSubject=subjectKey(before.telegramId,key),afterSubject=subjectKey(after.telegramId,key);
    const subjectChanged=beforeSubject!==afterSubject;
    if(subjectChanged&&!(after.deletedAccount===true&&before.deletedAccount!==true))throw new Error("business_authority_order_subject_change");
    if(!allowedOrderTransition(before.status,after.status))throw new Error("business_authority_order_status_transition_invalid");
    if(before.providerOrderId&&String(before.providerOrderId)!==String(after.providerOrderId||""))throw new Error("business_authority_provider_order_id_change");
    if(before.providerUsed&&String(before.providerUsed)!==String(after.providerUsed||""))throw new Error("business_authority_provider_used_change");
    const changed=stableStringify({
      status:before.status,providerOrderId:before.providerOrderId||null,providerUsed:before.providerUsed||null,requiresManualReview:!!before.requiresManualReview,subjectKey:beforeSubject
    })!==stableStringify({
      status:after.status,providerOrderId:after.providerOrderId||null,providerUsed:after.providerUsed||null,requiresManualReview:!!after.requiresManualReview,subjectKey:afterSubject
    });
    if(changed)orders.push({kind:"update",before,after});
  }
  for(const [id,after] of afterOrders){
    if(beforeOrders.has(id))continue;
    if(!id||!after.orderNo)throw new Error("business_authority_order_identity_missing");
    if(String(after.status)!=="processing")throw new Error("business_authority_new_order_status_invalid");
    if(!subjectKey(after.telegramId,key))throw new Error("business_authority_hmac_key_missing");
    orders.push({kind:"create",before:null,after});
  }

  for(const [id,before] of beforeTopups){
    if(!afterTopups.has(id))throw new Error("business_authority_topup_deletion_forbidden");
    const after=afterTopups.get(id);
    if(sha(topupImmutable(before,key))!==sha(topupImmutable(after,key)))throw new Error("business_authority_topup_immutable_change");
    const beforeSubject=subjectKey(before.telegramId,key),afterSubject=subjectKey(after.telegramId,key);
    const subjectChanged=beforeSubject!==afterSubject;
    if(subjectChanged&&!(after.deletedAccount===true&&before.deletedAccount!==true))throw new Error("business_authority_topup_subject_change");
    if(!allowedTopupTransition(before.status,after.status))throw new Error("business_authority_topup_status_transition_invalid");
    if(before.reference&&String(before.reference)!==String(after.reference||""))throw new Error("business_authority_topup_reference_change");
    const changed=String(before.status)!==String(after.status)||String(before.reference||"")!==String(after.reference||"")||subjectChanged;
    if(changed)topups.push({kind:"update",before,after});
  }
  for(const [id,after] of afterTopups){
    if(beforeTopups.has(id))continue;
    if(!id)throw new Error("business_authority_topup_identity_missing");
    if(String(after.status)!=="pending")throw new Error("business_authority_new_topup_status_invalid");
    if(!subjectKey(after.telegramId,key))throw new Error("business_authority_hmac_key_missing");
    topups.push({kind:"create",before:null,after});
  }
  return {orders,topups};
}
function verifyOrderRow(row,key){
  if(!row)return {ok:false,reason:"business_authority_order_missing"};
  const body={
    orderId:String(row.order_id||""),orderNo:String(row.order_no||""),subjectKey:String(row.subject_key||""),
    productId:String(row.product_id||""),status:String(row.status||""),finalPrice:money(row.final_price),
    currency:String(row.currency||"USD"),providerOrderId:row.provider_order_id?String(row.provider_order_id):null,
    providerUsed:row.provider_used?String(row.provider_used):null,requiresManualReview:!!row.requires_manual_review,
    immutableDigest:String(row.immutable_digest||""),lastStateRevision:Number(row.last_state_revision||0)
  };
  const expected=rowHmac(body,key);
  if(key&&!row.row_hmac)return {ok:false,reason:"business_authority_order_hmac_missing",body,expected};
  if(expected&&String(row.row_hmac)!==expected)return {ok:false,reason:"business_authority_order_hmac_mismatch",body,expected};
  return {ok:true,body,expected};
}
function verifyTopupRow(row,key){
  if(!row)return {ok:false,reason:"business_authority_topup_missing"};
  const body={
    topupId:String(row.topup_id||""),subjectKey:String(row.subject_key||""),amount:money(row.amount),
    currency:String(row.currency||"USD"),method:String(row.method||""),status:String(row.status||""),
    reference:row.reference?String(row.reference):null,immutableDigest:String(row.immutable_digest||""),
    lastStateRevision:Number(row.last_state_revision||0)
  };
  const expected=rowHmac(body,key);
  if(key&&!row.row_hmac)return {ok:false,reason:"business_authority_topup_hmac_missing",body,expected};
  if(expected&&String(row.row_hmac)!==expected)return {ok:false,reason:"business_authority_topup_hmac_mismatch",body,expected};
  return {ok:true,body,expected};
}
function verifyMetaRow(row,key){
  if(!row)return {ok:false,reason:"business_authority_meta_missing"};
  const body=metaBody({
    cutoverRevision:row.cutover_revision,lastStateRevision:row.last_state_revision,
    orderCount:row.order_count,topupCount:row.topup_count,
    orderDigest:row.order_digest,topupDigest:row.topup_digest
  });
  const expected=metaHmac(body,key);
  if(key&&!row.meta_hmac)return {ok:false,reason:"business_authority_meta_hmac_missing",body,expected};
  if(expected&&String(row.meta_hmac)!==expected)return {ok:false,reason:"business_authority_meta_hmac_mismatch",body,expected};
  return {ok:true,body,expected};
}

async function ensureBusinessAuthoritySchema(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_order_authority (
      order_id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      subject_key TEXT NOT NULL,
      product_id TEXT NOT NULL,
      status TEXT NOT NULL,
      final_price NUMERIC(18,6) NOT NULL,
      currency TEXT NOT NULL,
      provider_order_id TEXT,
      provider_used TEXT,
      requires_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
      immutable_digest TEXT NOT NULL,
      last_state_revision BIGINT NOT NULL,
      row_hmac TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("CREATE INDEX IF NOT EXISTS idx_gz_order_authority_subject ON game_zone_order_authority(subject_key)");
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_gz_order_authority_provider_order ON game_zone_order_authority(provider_used,provider_order_id) WHERE provider_used IS NOT NULL AND provider_order_id IS NOT NULL");
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_topup_authority (
      topup_id TEXT PRIMARY KEY,
      subject_key TEXT NOT NULL,
      amount NUMERIC(18,6) NOT NULL,
      currency TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      reference TEXT,
      immutable_digest TEXT NOT NULL,
      last_state_revision BIGINT NOT NULL,
      row_hmac TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("CREATE INDEX IF NOT EXISTS idx_gz_topup_authority_subject ON game_zone_topup_authority(subject_key)");
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_gz_topup_authority_payment_ref ON game_zone_topup_authority(lower(method),lower(reference)) WHERE reference IS NOT NULL AND reference<>''");
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_business_authority_meta (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
      cutover_revision BIGINT NOT NULL,
      last_state_revision BIGINT NOT NULL,
      order_count BIGINT NOT NULL,
      topup_count BIGINT NOT NULL,
      order_digest TEXT NOT NULL,
      topup_digest TEXT NOT NULL,
      meta_hmac TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
async function verifyBusinessAuthoritySchemaReadOnly(client){
  await client.query("SELECT order_id,order_no,subject_key,product_id,status,final_price,currency,provider_order_id,provider_used,requires_manual_review,immutable_digest,last_state_revision,row_hmac FROM game_zone_order_authority LIMIT 0");
  await client.query("SELECT topup_id,subject_key,amount,currency,method,status,reference,immutable_digest,last_state_revision,row_hmac FROM game_zone_topup_authority LIMIT 0");
  await client.query("SELECT cutover_revision,last_state_revision,order_count,topup_count,order_digest,topup_digest,meta_hmac FROM game_zone_business_authority_meta WHERE id=1");
}
async function readMeta(client){
  return (await client.query("SELECT cutover_revision,last_state_revision,order_count,topup_count,order_digest,topup_digest,meta_hmac,updated_at FROM game_zone_business_authority_meta WHERE id=1")).rows[0]||null;
}
async function writeMeta(client,db,revision,key,{cutoverRevision=null}={}){
  const summary=businessSummary(db,revision,key),previous=await readMeta(client);
  const body=metaBody({
    cutoverRevision:cutoverRevision??previous?.cutover_revision??revision,lastStateRevision:revision,
    ...summary
  });
  await client.query(`
    INSERT INTO game_zone_business_authority_meta(
      id,cutover_revision,last_state_revision,order_count,topup_count,order_digest,topup_digest,meta_hmac,updated_at
    ) VALUES(1,$1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT(id) DO UPDATE SET
      cutover_revision=EXCLUDED.cutover_revision,last_state_revision=EXCLUDED.last_state_revision,
      order_count=EXCLUDED.order_count,topup_count=EXCLUDED.topup_count,
      order_digest=EXCLUDED.order_digest,topup_digest=EXCLUDED.topup_digest,
      meta_hmac=EXCLUDED.meta_hmac,updated_at=NOW()`,[
        body.cutoverRevision,body.lastStateRevision,body.orderCount,body.topupCount,
        body.orderDigest,body.topupDigest,metaHmac(body,key)
      ]);
  return body;
}
async function upsertOrder(client,order,revision,key){
  const body=orderBody(order,revision,key);
  await client.query(`
    INSERT INTO game_zone_order_authority(
      order_id,order_no,subject_key,product_id,status,final_price,currency,
      provider_order_id,provider_used,requires_manual_review,immutable_digest,last_state_revision,row_hmac,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT(order_id) DO UPDATE SET
      subject_key=EXCLUDED.subject_key,status=EXCLUDED.status,provider_order_id=EXCLUDED.provider_order_id,provider_used=EXCLUDED.provider_used,
      requires_manual_review=EXCLUDED.requires_manual_review,last_state_revision=EXCLUDED.last_state_revision,
      row_hmac=EXCLUDED.row_hmac,updated_at=NOW()`,[
        body.orderId,body.orderNo,body.subjectKey,body.productId,body.status,body.finalPrice,body.currency,
        body.providerOrderId,body.providerUsed,body.requiresManualReview,body.immutableDigest,
        body.lastStateRevision,rowHmac(body,key)
      ]);
  return body;
}
async function upsertTopup(client,topup,revision,key){
  const body=topupBody(topup,revision,key);
  await client.query(`
    INSERT INTO game_zone_topup_authority(
      topup_id,subject_key,amount,currency,method,status,reference,immutable_digest,last_state_revision,row_hmac,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    ON CONFLICT(topup_id) DO UPDATE SET
      subject_key=EXCLUDED.subject_key,status=EXCLUDED.status,reference=EXCLUDED.reference,last_state_revision=EXCLUDED.last_state_revision,
      row_hmac=EXCLUDED.row_hmac,updated_at=NOW()`,[
        body.topupId,body.subjectKey,body.amount,body.currency,body.method,body.status,body.reference,
        body.immutableDigest,body.lastStateRevision,rowHmac(body,key)
      ]);
  return body;
}
async function bootstrapBusinessAuthority(client,db,revision,key){
  const meta=await readMeta(client);
  if(meta)return {bootstrapped:false,cutoverRevision:Number(meta.cutover_revision)};
  for(const order of db.orders||[])await upsertOrder(client,order,revision,key);
  for(const topup of db.topups||[])await upsertTopup(client,topup,revision,key);
  await writeMeta(client,db,revision,key,{cutoverRevision:revision});
  return {bootstrapped:true,cutoverRevision:revision};
}
async function applyBusinessAuthority(client,beforeDb,afterDb,revision,key){
  const meta=await readMeta(client),metaCheck=verifyMetaRow(meta,key);
  if(!metaCheck.ok)throw new Error(metaCheck.reason);
  const changes=deriveBusinessChanges(beforeDb,afterDb,key);

  for(const change of changes.orders){
    const id=String(change.after.id);
    const current=(await client.query(`
      SELECT order_id,order_no,subject_key,product_id,status,final_price,currency,provider_order_id,provider_used,
             requires_manual_review,immutable_digest,last_state_revision,row_hmac
      FROM game_zone_order_authority WHERE order_id=$1 FOR UPDATE`,[id])).rows[0]||null;
    if(change.kind==="create"){
      if(current)throw new Error("business_authority_order_already_exists");
    }else{
      const checked=verifyOrderRow(current,key);
      if(!checked.ok)throw new Error(checked.reason);
      const expectedBefore=orderBody(change.before,Number(current.last_state_revision||0),key);
      for(const field of ["orderId","orderNo","subjectKey","productId","status","finalPrice","currency","providerOrderId","providerUsed","requiresManualReview","immutableDigest"]){
        if(String(checked.body[field]??"")!==String(expectedBefore[field]??""))throw new Error("business_authority_order_state_conflict");
      }
    }
    await upsertOrder(client,change.after,revision,key);
  }

  for(const change of changes.topups){
    const id=String(change.after.id);
    const current=(await client.query(`
      SELECT topup_id,subject_key,amount,currency,method,status,reference,immutable_digest,last_state_revision,row_hmac
      FROM game_zone_topup_authority WHERE topup_id=$1 FOR UPDATE`,[id])).rows[0]||null;
    if(change.kind==="create"){
      if(current)throw new Error("business_authority_topup_already_exists");
    }else{
      const checked=verifyTopupRow(current,key);
      if(!checked.ok)throw new Error(checked.reason);
      const expectedBefore=topupBody(change.before,Number(current.last_state_revision||0),key);
      for(const field of ["topupId","subjectKey","amount","currency","method","status","reference","immutableDigest"]){
        if(String(checked.body[field]??"")!==String(expectedBefore[field]??""))throw new Error("business_authority_topup_state_conflict");
      }
    }
    await upsertTopup(client,change.after,revision,key);
  }

  const body=await writeMeta(client,afterDb,revision,key);
  return {changes,meta:body};
}
async function replaceBusinessAuthorityFromState(client,db,revision,key){
  await client.query("DELETE FROM game_zone_order_authority");
  await client.query("DELETE FROM game_zone_topup_authority");
  for(const order of db.orders||[])await upsertOrder(client,order,revision,key);
  for(const topup of db.topups||[])await upsertTopup(client,topup,revision,key);
  const previous=await readMeta(client);
  await writeMeta(client,db,revision,key,{cutoverRevision:previous?.cutover_revision??revision});
  return {ok:true,orderCount:(db.orders||[]).length,topupCount:(db.topups||[]).length,revision};
}
async function verifyBusinessAuthority(client,db,revision,key){
  const errors=[];
  const expectedOrders=projectOrders(db,revision,key),expectedOrderMap=new Map(expectedOrders.map(x=>[x.orderId,x]));
  const expectedTopups=projectTopups(db,revision,key),expectedTopupMap=new Map(expectedTopups.map(x=>[x.topupId,x]));
  const actualOrders=(await client.query(`
    SELECT order_id,order_no,subject_key,product_id,status,final_price,currency,provider_order_id,provider_used,
           requires_manual_review,immutable_digest,last_state_revision,row_hmac
    FROM game_zone_order_authority ORDER BY order_id`)).rows;
  const actualTopups=(await client.query(`
    SELECT topup_id,subject_key,amount,currency,method,status,reference,immutable_digest,last_state_revision,row_hmac
    FROM game_zone_topup_authority ORDER BY topup_id`)).rows;

  for(const row of actualOrders){
    const checked=verifyOrderRow(row,key);
    if(!checked.ok){errors.push({type:checked.reason,id:String(row.order_id)});continue;}
    const expected=expectedOrderMap.get(String(row.order_id));
    if(!expected){errors.push({type:"business_authority_unexpected_order",id:String(row.order_id)});continue;}
    for(const field of ["orderNo","subjectKey","productId","status","finalPrice","currency","providerOrderId","providerUsed","requiresManualReview","immutableDigest"]){
      if(String(checked.body[field]??"")!==String(expected[field]??""))errors.push({type:"business_authority_order_drift",id:String(row.order_id),field});
    }
    if(Number(checked.body.lastStateRevision)>Number(revision))errors.push({type:"business_authority_order_revision_future",id:String(row.order_id)});
  }
  for(const expected of expectedOrders){
    if(!actualOrders.some(x=>String(x.order_id)===expected.orderId))errors.push({type:"business_authority_order_missing",id:expected.orderId});
  }

  for(const row of actualTopups){
    const checked=verifyTopupRow(row,key);
    if(!checked.ok){errors.push({type:checked.reason,id:String(row.topup_id)});continue;}
    const expected=expectedTopupMap.get(String(row.topup_id));
    if(!expected){errors.push({type:"business_authority_unexpected_topup",id:String(row.topup_id)});continue;}
    for(const field of ["subjectKey","amount","currency","method","status","reference","immutableDigest"]){
      if(String(checked.body[field]??"")!==String(expected[field]??""))errors.push({type:"business_authority_topup_drift",id:String(row.topup_id),field});
    }
    if(Number(checked.body.lastStateRevision)>Number(revision))errors.push({type:"business_authority_topup_revision_future",id:String(row.topup_id)});
  }
  for(const expected of expectedTopups){
    if(!actualTopups.some(x=>String(x.topup_id)===expected.topupId))errors.push({type:"business_authority_topup_missing",id:expected.topupId});
  }

  const summary=businessSummary(db,revision,key);
  const actualSummary={
    orderCount:actualOrders.length,
    topupCount:actualTopups.length,
    orderDigest:sha(actualOrders.map(row=>{
      const x=verifyOrderRow(row,key).body||{};
      return [x.orderId,x.orderNo,x.status,x.providerOrderId,x.providerUsed,x.requiresManualReview,x.immutableDigest];
    })),
    topupDigest:sha(actualTopups.map(row=>{
      const x=verifyTopupRow(row,key).body||{};
      return [x.topupId,x.status,x.reference,x.immutableDigest];
    }))
  };
  if(summary.orderCount!==actualSummary.orderCount)errors.push({type:"business_authority_order_count_drift"});
  if(summary.topupCount!==actualSummary.topupCount)errors.push({type:"business_authority_topup_count_drift"});
  if(summary.orderDigest!==actualSummary.orderDigest)errors.push({type:"business_authority_order_digest_drift"});
  if(summary.topupDigest!==actualSummary.topupDigest)errors.push({type:"business_authority_topup_digest_drift"});

  const meta=await readMeta(client),metaCheck=verifyMetaRow(meta,key);
  if(!metaCheck.ok)errors.push({type:metaCheck.reason});
  else{
    const body=metaCheck.body;
    if(Number(body.lastStateRevision)!==Number(revision))errors.push({type:"business_authority_revision_drift"});
    for(const field of ["orderCount","topupCount","orderDigest","topupDigest"]){
      if(String(body[field])!==String(actualSummary[field]))errors.push({type:`business_authority_meta_${field}_drift`});
    }
  }

  return {
    ok:errors.length===0,error:errors.length?"business_authority_drift":null,errors,
    stateRevision:Number(revision),cutoverRevision:meta?Number(meta.cutover_revision):null,
    orderCount:actualOrders.length,topupCount:actualTopups.length,
    orderDigest:actualSummary.orderDigest,topupDigest:actualSummary.topupDigest,
    updatedAt:meta?.updated_at instanceof Date?meta.updated_at.toISOString():meta?.updated_at||null
  };
}

module.exports={
  money,subjectKey,orderImmutable,topupImmutable,orderBody,topupBody,rowHmac,
  metaBody,metaHmac,projectOrders,projectTopups,businessSummary,
  allowedOrderTransition,allowedTopupTransition,deriveBusinessChanges,
  verifyOrderRow,verifyTopupRow,verifyMetaRow,
  ensureBusinessAuthoritySchema,verifyBusinessAuthoritySchemaReadOnly,
  bootstrapBusinessAuthority,applyBusinessAuthority,replaceBusinessAuthorityFromState,
  verifyBusinessAuthority,readMeta
};
