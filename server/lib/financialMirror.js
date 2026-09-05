const crypto=require("node:crypto");
const {stableStringify}=require("./backupFormat");

function sha(value){
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}
function num(value){
  const n=Number(value||0);
  return Number.isFinite(n)?n:0;
}
function text(value){
  return value===undefined||value===null?"":String(value);
}
function projectFinancialState(db={}){
  const users=(db.users||[]).map(u=>({
    telegramId:text(u.telegramId),
    balance:num(u.balance),
    currency:text(u.currency||"USD"),
    payload:u,
    payloadSha256:sha(u)
  })).sort((a,b)=>a.telegramId.localeCompare(b.telegramId));

  const orders=(db.orders||[]).map(o=>({
    id:text(o.id),
    orderNo:text(o.orderNo),
    telegramId:text(o.telegramId),
    status:text(o.status),
    finalPrice:num(o.finalPrice),
    profit:num(o.profit),
    refundedAt:o.refundedAt||null,
    payload:o,
    payloadSha256:sha(o)
  })).sort((a,b)=>a.id.localeCompare(b.id));

  const transactions=(db.transactions||[]).map(t=>({
    id:text(t.id),
    telegramId:text(t.telegramId),
    type:text(t.type),
    amount:num(t.amount),
    currency:text(t.currency||"USD"),
    reference:t.reference===undefined||t.reference===null?null:text(t.reference),
    payload:t,
    payloadSha256:sha(t)
  })).sort((a,b)=>a.id.localeCompare(b.id));

  const topups=(db.topups||[]).map(t=>({
    id:text(t.id),
    telegramId:text(t.telegramId),
    amount:num(t.amount),
    currency:text(t.currency||"USD"),
    method:text(t.method),
    status:text(t.status),
    reference:t.reference===undefined||t.reference===null?null:text(t.reference),
    payload:t,
    payloadSha256:sha(t)
  })).sort((a,b)=>a.id.localeCompare(b.id));

  return {users,orders,transactions,topups};
}
function collectionDigest(rows,key){
  return sha(rows.map(r=>[text(r[key]),r.payloadSha256]));
}
function financialMirrorSummary(db={}){
  const p=projectFinancialState(db);
  return {
    counts:{
      users:p.users.length,orders:p.orders.length,
      transactions:p.transactions.length,topups:p.topups.length
    },
    totals:{
      userBalances:Number(p.users.reduce((a,x)=>a+x.balance,0).toFixed(6)),
      transactionAmounts:Number(p.transactions.reduce((a,x)=>a+x.amount,0).toFixed(6)),
      topupAmounts:Number(p.topups.reduce((a,x)=>a+x.amount,0).toFixed(6)),
      orderRevenue:Number(p.orders.reduce((a,x)=>a+x.finalPrice,0).toFixed(6))
    },
    digests:{
      users:collectionDigest(p.users,"telegramId"),
      orders:collectionDigest(p.orders,"id"),
      transactions:collectionDigest(p.transactions,"id"),
      topups:collectionDigest(p.topups,"id")
    }
  };
}
function verifyFinancialMirrorSummary(expected,actual){
  const errors=[];
  for(const section of ["counts","totals","digests"]){
    const a=expected?.[section]||{},b=actual?.[section]||{};
    for(const key of Object.keys(a)){
      if(String(a[key])!==String(b[key]))errors.push({section,key,expected:a[key],actual:b[key]});
    }
  }
  return {ok:errors.length===0,errors};
}

async function ensureFinancialMirrorSchema(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_financial_users (
      telegram_id TEXT PRIMARY KEY,
      balance NUMERIC(18,6) NOT NULL,
      currency TEXT NOT NULL,
      payload JSONB NOT NULL,
      payload_sha256 TEXT NOT NULL,
      mirror_revision BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_financial_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT,
      telegram_id TEXT NOT NULL,
      status TEXT NOT NULL,
      final_price NUMERIC(18,6) NOT NULL,
      profit NUMERIC(18,6) NOT NULL,
      refunded_at TIMESTAMPTZ,
      payload JSONB NOT NULL,
      payload_sha256 TEXT NOT NULL,
      mirror_revision BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_gz_financial_orders_order_no ON game_zone_financial_orders(order_no) WHERE order_no IS NOT NULL AND order_no<>''");
  await client.query("CREATE INDEX IF NOT EXISTS idx_gz_financial_orders_user ON game_zone_financial_orders(telegram_id)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_financial_transactions (
      id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount NUMERIC(18,6) NOT NULL,
      currency TEXT NOT NULL,
      reference TEXT,
      payload JSONB NOT NULL,
      payload_sha256 TEXT NOT NULL,
      mirror_revision BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("CREATE INDEX IF NOT EXISTS idx_gz_financial_transactions_user ON game_zone_financial_transactions(telegram_id)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_financial_topups (
      id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      amount NUMERIC(18,6) NOT NULL,
      currency TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      reference TEXT,
      payload JSONB NOT NULL,
      payload_sha256 TEXT NOT NULL,
      mirror_revision BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("CREATE INDEX IF NOT EXISTS idx_gz_financial_topups_user ON game_zone_financial_topups(telegram_id)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_financial_mirror_meta (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
      state_revision BIGINT NOT NULL,
      counts JSONB NOT NULL,
      totals JSONB NOT NULL,
      digests JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
async function verifyFinancialMirrorSchemaReadOnly(client){
  await client.query("SELECT telegram_id,balance,currency,payload,payload_sha256,mirror_revision FROM game_zone_financial_users LIMIT 0");
  await client.query("SELECT id,order_no,telegram_id,status,final_price,profit,refunded_at,payload,payload_sha256,mirror_revision FROM game_zone_financial_orders LIMIT 0");
  await client.query("SELECT id,telegram_id,type,amount,currency,reference,payload,payload_sha256,mirror_revision FROM game_zone_financial_transactions LIMIT 0");
  await client.query("SELECT id,telegram_id,amount,currency,method,status,reference,payload,payload_sha256,mirror_revision FROM game_zone_financial_topups LIMIT 0");
  await client.query("SELECT state_revision,counts,totals,digests FROM game_zone_financial_mirror_meta WHERE id=1");
}
async function upsertJsonRecordset(client,{table,columns,rows,revision}){
  if(!rows.length)return;
  const json=JSON.stringify(rows);
  const defs=columns.map(c=>`"${c.json}" ${c.type}`).join(",");
  const insertCols=[...columns.map(c=>c.db),"payload","payload_sha256","mirror_revision"].join(",");
  const selectCols=[...columns.map(c=>`x."${c.json}"`),"x.payload","x.\"payloadSha256\"","$2::bigint"].join(",");
  const updateCols=[
    ...columns.map(c=>`${c.db}=EXCLUDED.${c.db}`),
    "payload=EXCLUDED.payload","payload_sha256=EXCLUDED.payload_sha256",
    "mirror_revision=EXCLUDED.mirror_revision","updated_at=NOW()"
  ].join(",");
  await client.query(
    `INSERT INTO ${table}(${insertCols})
     SELECT ${selectCols}
     FROM jsonb_to_recordset($1::jsonb) AS x(${defs},payload jsonb,"payloadSha256" text)
     ON CONFLICT(${columns[0].db}) DO UPDATE SET ${updateCols}`,
    [json,revision]
  );
}
async function syncFinancialMirror(client,db,revision){
  const p=projectFinancialState(db),summary=financialMirrorSummary(db);

  await upsertJsonRecordset(client,{
    table:"game_zone_financial_users",
    columns:[
      {db:"telegram_id",json:"telegramId",type:"text"},
      {db:"balance",json:"balance",type:"numeric"},
      {db:"currency",json:"currency",type:"text"}
    ],rows:p.users,revision
  });
  await upsertJsonRecordset(client,{
    table:"game_zone_financial_orders",
    columns:[
      {db:"id",json:"id",type:"text"},
      {db:"order_no",json:"orderNo",type:"text"},
      {db:"telegram_id",json:"telegramId",type:"text"},
      {db:"status",json:"status",type:"text"},
      {db:"final_price",json:"finalPrice",type:"numeric"},
      {db:"profit",json:"profit",type:"numeric"},
      {db:"refunded_at",json:"refundedAt",type:"timestamptz"}
    ],rows:p.orders,revision
  });
  await upsertJsonRecordset(client,{
    table:"game_zone_financial_transactions",
    columns:[
      {db:"id",json:"id",type:"text"},
      {db:"telegram_id",json:"telegramId",type:"text"},
      {db:"type",json:"type",type:"text"},
      {db:"amount",json:"amount",type:"numeric"},
      {db:"currency",json:"currency",type:"text"},
      {db:"reference",json:"reference",type:"text"}
    ],rows:p.transactions,revision
  });
  await upsertJsonRecordset(client,{
    table:"game_zone_financial_topups",
    columns:[
      {db:"id",json:"id",type:"text"},
      {db:"telegram_id",json:"telegramId",type:"text"},
      {db:"amount",json:"amount",type:"numeric"},
      {db:"currency",json:"currency",type:"text"},
      {db:"method",json:"method",type:"text"},
      {db:"status",json:"status",type:"text"},
      {db:"reference",json:"reference",type:"text"}
    ],rows:p.topups,revision
  });

  for(const table of [
    "game_zone_financial_users","game_zone_financial_orders",
    "game_zone_financial_transactions","game_zone_financial_topups"
  ]){
    await client.query(`DELETE FROM ${table} WHERE mirror_revision<>$1`,[revision]);
  }

  await client.query(
    `INSERT INTO game_zone_financial_mirror_meta(id,state_revision,counts,totals,digests,updated_at)
     VALUES(1,$1,$2::jsonb,$3::jsonb,$4::jsonb,NOW())
     ON CONFLICT(id) DO UPDATE SET
       state_revision=EXCLUDED.state_revision,counts=EXCLUDED.counts,
       totals=EXCLUDED.totals,digests=EXCLUDED.digests,updated_at=NOW()`,
    [revision,JSON.stringify(summary.counts),JSON.stringify(summary.totals),JSON.stringify(summary.digests)]
  );
  return summary;
}
async function readFinancialMirrorSummary(client){
  // Run sequentially so this works identically with a Pool and a single transaction Client.
  const meta=await client.query("SELECT state_revision,counts,totals,digests,updated_at FROM game_zone_financial_mirror_meta WHERE id=1");
  const users=await client.query("SELECT telegram_id,balance,payload_sha256,mirror_revision FROM game_zone_financial_users ORDER BY telegram_id");
  const orders=await client.query("SELECT id,final_price,payload_sha256,mirror_revision FROM game_zone_financial_orders ORDER BY id");
  const transactions=await client.query("SELECT id,amount,payload_sha256,mirror_revision FROM game_zone_financial_transactions ORDER BY id");
  const topups=await client.query("SELECT id,amount,payload_sha256,mirror_revision FROM game_zone_financial_topups ORDER BY id");
  if(!meta.rows.length)return null;
  const row=meta.rows[0];
  const current={
    counts:{
      users:users.rows.length,orders:orders.rows.length,
      transactions:transactions.rows.length,topups:topups.rows.length
    },
    totals:{
      userBalances:Number(users.rows.reduce((a,x)=>a+Number(x.balance||0),0).toFixed(6)),
      transactionAmounts:Number(transactions.rows.reduce((a,x)=>a+Number(x.amount||0),0).toFixed(6)),
      topupAmounts:Number(topups.rows.reduce((a,x)=>a+Number(x.amount||0),0).toFixed(6)),
      orderRevenue:Number(orders.rows.reduce((a,x)=>a+Number(x.final_price||0),0).toFixed(6))
    },
    digests:{
      users:sha(users.rows.map(x=>[text(x.telegram_id),text(x.payload_sha256)])),
      orders:sha(orders.rows.map(x=>[text(x.id),text(x.payload_sha256)])),
      transactions:sha(transactions.rows.map(x=>[text(x.id),text(x.payload_sha256)])),
      topups:sha(topups.rows.map(x=>[text(x.id),text(x.payload_sha256)]))
    }
  };
  const revisions=[
    ...users.rows.map(x=>Number(x.mirror_revision)),
    ...orders.rows.map(x=>Number(x.mirror_revision)),
    ...transactions.rows.map(x=>Number(x.mirror_revision)),
    ...topups.rows.map(x=>Number(x.mirror_revision))
  ];
  return {
    stateRevision:Number(row.state_revision),
    counts:current.counts,totals:current.totals,digests:current.digests,
    metaCounts:row.counts||{},metaTotals:row.totals||{},metaDigests:row.digests||{},
    rowRevisionMin:revisions.length?Math.min(...revisions):Number(row.state_revision),
    rowRevisionMax:revisions.length?Math.max(...revisions):Number(row.state_revision),
    updatedAt:row.updated_at instanceof Date?row.updated_at.toISOString():row.updated_at
  };
}
async function verifyFinancialMirror(client,db,stateRevision){
  const expected=financialMirrorSummary(db),actual=await readFinancialMirrorSummary(client);
  if(!actual)return {ok:false,error:"financial_mirror_meta_missing",expected,actual:null};
  const compare=verifyFinancialMirrorSummary(expected,actual);
  const metaCompare=verifyFinancialMirrorSummary({
    counts:actual.counts,totals:actual.totals,digests:actual.digests
  },{
    counts:actual.metaCounts,totals:actual.metaTotals,digests:actual.metaDigests
  });
  if(!metaCompare.ok){
    compare.ok=false;
    for(const e of metaCompare.errors)compare.errors.push({...e,section:`meta_${e.section}`});
  }
  if(Number(actual.stateRevision)!==Number(stateRevision)){
    compare.ok=false;compare.errors.push({section:"meta",key:"stateRevision",expected:Number(stateRevision),actual:Number(actual.stateRevision)});
  }
  if(Number(actual.rowRevisionMin)!==Number(stateRevision)||Number(actual.rowRevisionMax)!==Number(stateRevision)){
    compare.ok=false;compare.errors.push({section:"rows",key:"mirrorRevision",expected:Number(stateRevision),actual:`${actual.rowRevisionMin}..${actual.rowRevisionMax}`});
  }
  return {ok:compare.ok,error:compare.ok?null:"financial_mirror_drift",errors:compare.errors,expected,actual};
}

module.exports={
  projectFinancialState,financialMirrorSummary,verifyFinancialMirrorSummary,
  ensureFinancialMirrorSchema,verifyFinancialMirrorSchemaReadOnly,
  syncFinancialMirror,readFinancialMirrorSummary,verifyFinancialMirror
};
