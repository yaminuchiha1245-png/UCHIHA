const {
  normalizeRevision,nextRevision,snapshotHash,snapshotHmac,verifySnapshotRecord
}=require("./stateSnapshot");
const {ensureFinancialMirrorSchema,syncFinancialMirror,verifyFinancialMirror}=require("./financialMirror");
const {ensureFinancialJournalSchema,backfillFinancialJournal,touchMeta,verifyFinancialJournal}=require("./financialJournal");
const {ensureWalletAuthoritySchema,replaceWalletAuthorityFromState,verifyWalletAuthority}=require("./walletAuthority");
const {ensureBusinessAuthoritySchema,replaceBusinessAuthorityFromState,verifyBusinessAuthority}=require("./businessAuthority");

function pgSsl(){
  return String(process.env.PG_SSL||"false").toLowerCase()==="true"?{rejectUnauthorized:false}:undefined;
}
async function openPostgresRecovery(){
  const {Pool}=require("pg");
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");
  if(process.env.NODE_ENV==="production"&&String(process.env.STATE_HMAC_KEY||"").length<32)throw new Error("STATE_HMAC_KEY is required for production recovery");
  if(process.env.NODE_ENV==="production"&&String(process.env.PG_FINANCIAL_JOURNAL||"true").toLowerCase()!=="false"&&String(process.env.FINANCIAL_JOURNAL_HMAC_KEY||"").length<32)throw new Error("FINANCIAL_JOURNAL_HMAC_KEY is required for production recovery");
  if(process.env.NODE_ENV==="production"&&String(process.env.PG_WALLET_AUTHORITY||"true").toLowerCase()!=="false"&&String(process.env.WALLET_AUTHORITY_HMAC_KEY||"").length<32)throw new Error("WALLET_AUTHORITY_HMAC_KEY is required for production recovery");
  if(process.env.NODE_ENV==="production"&&String(process.env.PG_BUSINESS_AUTHORITY||"true").toLowerCase()!=="false"&&String(process.env.BUSINESS_AUTHORITY_HMAC_KEY||"").length<32)throw new Error("BUSINESS_AUTHORITY_HMAC_KEY is required for production recovery");
  const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:pgSsl(),
    max:1,
    connectionTimeoutMillis:Math.max(1000,Number(process.env.PG_CONNECT_TIMEOUT_MS||10000))
  });
  const client=await pool.connect();
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(hashtext('game-zone-active-server')) AS locked");
    if(lock.rows?.[0]?.locked!==true)throw new Error("another_game_zone_server_is_active");
    await ensureRecoverySchema(client);
    return {pool,client,locked:true};
  }catch(e){
    try{client.release()}catch{}
    try{await pool.end()}catch{}
    throw e;
  }
}
async function closePostgresRecovery(ctx){
  if(!ctx)return;
  if(ctx.client){
    try{await ctx.client.query("SELECT pg_advisory_unlock(hashtext('game-zone-active-server'))")}catch{}
    try{ctx.client.release()}catch{}
  }
  try{await ctx.pool?.end()}catch{}
}
async function ensureRecoverySchema(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_state (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
      data JSONB NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1,
      data_sha256 TEXT,
      data_hmac TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("ALTER TABLE game_zone_state ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1");
  await client.query("ALTER TABLE game_zone_state ADD COLUMN IF NOT EXISTS data_sha256 TEXT");
  await client.query("ALTER TABLE game_zone_state ADD COLUMN IF NOT EXISTS data_hmac TEXT");
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_state_history (
      revision BIGINT PRIMARY KEY,
      data JSONB NOT NULL,
      data_sha256 TEXT NOT NULL,
      data_hmac TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("ALTER TABLE game_zone_state_history ADD COLUMN IF NOT EXISTS data_hmac TEXT");
  if(String(process.env.PG_FINANCIAL_MIRROR||"true").toLowerCase()!=="false")await ensureFinancialMirrorSchema(client);
  if(String(process.env.PG_FINANCIAL_JOURNAL||"true").toLowerCase()!=="false")await ensureFinancialJournalSchema(client);
  if(String(process.env.PG_WALLET_AUTHORITY||"true").toLowerCase()!=="false")await ensureWalletAuthoritySchema(client);
  if(String(process.env.PG_BUSINESS_AUTHORITY||"true").toLowerCase()!=="false")await ensureBusinessAuthoritySchema(client);
}
function verifyRecoveryRecord(row,{requireHmac=!!process.env.STATE_HMAC_KEY}={}){
  if(!row)return {ok:false,reason:"state_row_missing"};
  return verifySnapshotRecord({
    data:row.data,dataSha256:row.data_sha256,dataHmac:row.data_hmac,
    hmacKey:String(process.env.STATE_HMAC_KEY||""),requireHmac
  });
}
async function readActiveState(client,{forUpdate=false}={}){
  const suffix=forUpdate?" FOR UPDATE":"";
  const r=await client.query(`SELECT data,revision,data_sha256,data_hmac,updated_at FROM game_zone_state WHERE id=1${suffix}`);
  if(!r.rows.length)return null;
  const row=r.rows[0];
  return {
    data:row.data,revision:normalizeRevision(row.revision,1),
    dataSha256:row.data_sha256,dataHmac:row.data_hmac,updatedAt:row.updated_at,
    verification:verifyRecoveryRecord(row,{requireHmac:!!process.env.STATE_HMAC_KEY})
  };
}
async function readHistoryState(client,revision){
  const rev=normalizeRevision(revision,0);
  if(!rev)return null;
  const r=await client.query("SELECT data,revision,data_sha256,data_hmac,created_at FROM game_zone_state_history WHERE revision=$1",[rev]);
  if(!r.rows.length)return null;
  const row=r.rows[0];
  return {
    data:row.data,revision:rev,dataSha256:row.data_sha256,dataHmac:row.data_hmac,createdAt:row.created_at,
    verification:verifyRecoveryRecord(row,{requireHmac:!!process.env.STATE_HMAC_KEY})
  };
}
async function replaceActiveState(client,newData,{allowCorruptCurrent=false,preserveValidCurrent=true}={}){
  const newHash=snapshotHash(newData),newHmac=snapshotHmac(newData,String(process.env.STATE_HMAC_KEY||""));
  await client.query("BEGIN");
  try{
    const current=await readActiveState(client,{forUpdate:true});
    const currentRevision=current?.revision||0;
    if(current&&!current.verification.ok&&!allowCorruptCurrent)throw new Error(current.verification.reason||"current_state_integrity_failed");

    if(current&&current.verification.ok&&preserveValidCurrent){
      await client.query(
        `INSERT INTO game_zone_state_history(revision,data,data_sha256,data_hmac,created_at)
         VALUES($1,$2::jsonb,$3,$4,NOW())
         ON CONFLICT(revision) DO NOTHING`,
        [currentRevision,JSON.stringify(current.data),current.verification.actual,current.verification.actualHmac]
      );
    }

    const newRevision=current?nextRevision(currentRevision):1;
    await client.query(
      `INSERT INTO game_zone_state(id,data,revision,data_sha256,data_hmac,updated_at)
       VALUES(1,$1::jsonb,$2,$3,$4,NOW())
       ON CONFLICT(id) DO UPDATE SET
         data=EXCLUDED.data,revision=EXCLUDED.revision,data_sha256=EXCLUDED.data_sha256,
         data_hmac=EXCLUDED.data_hmac,updated_at=NOW()`,
      [JSON.stringify(newData),newRevision,newHash,newHmac]
    );
    if(String(process.env.PG_FINANCIAL_MIRROR||"true").toLowerCase()!=="false"){
      await syncFinancialMirror(client,newData,newRevision);
    }
    if(String(process.env.PG_FINANCIAL_JOURNAL||"true").toLowerCase()!=="false"){
      await backfillFinancialJournal(client,newData,newRevision,String(process.env.FINANCIAL_JOURNAL_HMAC_KEY||""));
      await touchMeta(client,newRevision);
    }
    if(String(process.env.PG_WALLET_AUTHORITY||"true").toLowerCase()!=="false"){
      await replaceWalletAuthorityFromState(client,newData,newRevision,String(process.env.WALLET_AUTHORITY_HMAC_KEY||""));
    }
    if(String(process.env.PG_BUSINESS_AUTHORITY||"true").toLowerCase()!=="false"){
      await replaceBusinessAuthorityFromState(client,newData,newRevision,String(process.env.BUSINESS_AUTHORITY_HMAC_KEY||""));
    }
    await client.query("COMMIT");
    return {
      ok:true,newRevision,dataSha256:newHash,dataHmac:newHmac,
      priorRevision:currentRevision||null,priorStateValid:current?current.verification.ok:null,
      priorStateReason:current&&!current.verification.ok?current.verification.reason:null
    };
  }catch(e){
    try{await client.query("ROLLBACK")}catch{}
    throw e;
  }
}
async function verifyActiveRecoveryState(client){
  const current=await readActiveState(client);
  if(!current)return {ok:false,error:"state_row_missing"};
  if(!current.verification.ok)return {ok:false,revision:current.revision,error:current.verification.reason};
  let financialMirror={ok:true,enabled:false};
  if(String(process.env.PG_FINANCIAL_MIRROR||"true").toLowerCase()!=="false"){
    financialMirror=await verifyFinancialMirror(client,current.data,current.revision);
    if(!financialMirror.ok)return {ok:false,revision:current.revision,error:financialMirror.error||"financial_mirror_drift",financialMirror};
  }
  let financialJournal={ok:true,enabled:false};
  if(String(process.env.PG_FINANCIAL_JOURNAL||"true").toLowerCase()!=="false"){
    financialJournal=await verifyFinancialJournal(client,current.data,current.revision,String(process.env.FINANCIAL_JOURNAL_HMAC_KEY||""),{limit:100000});
    if(!financialJournal.ok)return {ok:false,revision:current.revision,error:financialJournal.error||"financial_journal_drift",financialJournal};
  }
  let walletAuthority={ok:true,enabled:false};
  if(String(process.env.PG_WALLET_AUTHORITY||"true").toLowerCase()!=="false"){
    walletAuthority=await verifyWalletAuthority(client,current.data,current.revision,String(process.env.WALLET_AUTHORITY_HMAC_KEY||""));
    if(!walletAuthority.ok)return {ok:false,revision:current.revision,error:walletAuthority.error||"wallet_authority_drift",walletAuthority};
  }
  let businessAuthority={ok:true,enabled:false};
  if(String(process.env.PG_BUSINESS_AUTHORITY||"true").toLowerCase()!=="false"){
    businessAuthority=await verifyBusinessAuthority(client,current.data,current.revision,String(process.env.BUSINESS_AUTHORITY_HMAC_KEY||""));
    if(!businessAuthority.ok)return {ok:false,revision:current.revision,error:businessAuthority.error||"business_authority_drift",businessAuthority};
  }
  return {ok:true,revision:current.revision,dataSha256:current.verification.actual,hmacVerified:!!process.env.STATE_HMAC_KEY,financialMirror,financialJournal,walletAuthority,businessAuthority};
}

module.exports={
  openPostgresRecovery,closePostgresRecovery,ensureRecoverySchema,
  verifyRecoveryRecord,readActiveState,readHistoryState,replaceActiveState,verifyActiveRecoveryState
};
