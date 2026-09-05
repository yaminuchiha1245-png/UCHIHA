const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  normalizeRevision,snapshotHash,snapshotHmac,verifySnapshotRecord,nextRevision,
  boundedHistoryLimit,boundedHistoryDays,boundedHistoryIntervalSeconds
}=require("./lib/stateSnapshot");
const {
  ensureFinancialMirrorSchema,verifyFinancialMirrorSchemaReadOnly,
  syncFinancialMirror,verifyFinancialMirror,readFinancialMirrorSummary
}=require("./lib/financialMirror");
const {
  ensureFinancialJournalSchema,verifyFinancialJournalSchemaReadOnly,
  backfillFinancialJournal,appendFinancialJournal,touchMeta,verifyFinancialJournal,deriveFinancialMutations
}=require("./lib/financialJournal");
const {
  ensureWalletAuthoritySchema,verifyWalletAuthoritySchemaReadOnly,
  bootstrapWalletAuthority,applyWalletAuthority,replaceWalletAuthorityFromState,
  verifyWalletAuthority
}=require("./lib/walletAuthority");
const {
  ensureBusinessAuthoritySchema,verifyBusinessAuthoritySchemaReadOnly,
  bootstrapBusinessAuthority,applyBusinessAuthority,replaceBusinessAuthorityFromState,
  verifyBusinessAuthority,deriveBusinessChanges
}=require("./lib/businessAuthority");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");
const STORAGE_DRIVER = String(process.env.STORAGE_DRIVER || "json").toLowerCase();
const STATE_HMAC_KEY = String(process.env.STATE_HMAC_KEY || "");
const STORE_READ_ONLY = String(process.env.STORE_READ_ONLY || "false").toLowerCase()==="true";
const FINANCIAL_MIRROR_ENABLED = STORAGE_DRIVER==="postgres" && String(process.env.PG_FINANCIAL_MIRROR || "true").toLowerCase()!=="false";
const FINANCIAL_JOURNAL_ENABLED = STORAGE_DRIVER==="postgres" && String(process.env.PG_FINANCIAL_JOURNAL || "true").toLowerCase()!=="false";
const FINANCIAL_JOURNAL_HMAC_KEY = String(process.env.FINANCIAL_JOURNAL_HMAC_KEY || "");
const WALLET_AUTHORITY_ENABLED = STORAGE_DRIVER==="postgres" && String(process.env.PG_WALLET_AUTHORITY || "true").toLowerCase()!=="false";
const WALLET_AUTHORITY_HMAC_KEY = String(process.env.WALLET_AUTHORITY_HMAC_KEY || "");
const BUSINESS_AUTHORITY_ENABLED = STORAGE_DRIVER==="postgres" && String(process.env.PG_BUSINESS_AUTHORITY || "true").toLowerCase()!=="false";
const BUSINESS_AUTHORITY_HMAC_KEY = String(process.env.BUSINESS_AUTHORITY_HMAC_KEY || "");

let state = null;
let pgPool = null;
let pgAdvisoryClient = null;
let pgSingleInstanceLockAcquired = false;
let pgStateRevision = 0;
let pgStateSha256 = null;
let pgStateHmac = null;
let persistChain = Promise.resolve();
let initialized = false;
let lastPersistError = null;
let lastPersistAt = null;
let persistPending = 0;
let persistFailures = 0;
let pgPoolError = null;
let lastStateVerifyAt = null;
let lastStateVerifyError = null;
let stateHistoryPruned = 0;
let lastFinancialMirrorAt = null;
let lastFinancialMirrorVerifyAt = null;
let lastFinancialMirrorError = null;
let financialMirrorRevision = null;
let lastFinancialJournalVerifyAt = null;
let lastFinancialJournalError = null;
let financialJournalEntries = 0;
let financialJournalCutoverRevision = null;
let financialJournalLastStateRevision = null;
let lastWalletAuthorityVerifyAt = null;
let lastWalletAuthorityError = null;
let walletAuthorityCutoverRevision = null;
let walletAuthorityLastStateRevision = null;
let walletAuthorityAccountCount = 0;
let walletAuthorityActiveAccountCount = 0;
let walletAuthorityTotalBalance = 0;
let lastBusinessAuthorityVerifyAt = null;
let lastBusinessAuthorityError = null;
let businessAuthorityCutoverRevision = null;
let businessAuthorityLastStateRevision = null;
let businessAuthorityOrderCount = 0;
let businessAuthorityTopupCount = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function readJsonFile() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function writeJsonFile(db) {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}
function markStateVerified(hash,hmac=null) {
  pgStateSha256=hash||pgStateSha256;
  if(hmac)pgStateHmac=hmac;
  lastStateVerifyAt=new Date().toISOString();
  lastStateVerifyError=null;
}
function stateIntegrityError(message) {
  const e=new Error(message);
  e.code=message;
  lastStateVerifyError=message;
  return e;
}
async function ensurePostgresRuntimeSchema(){
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS game_zone_state (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      data JSONB NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1,
      data_sha256 TEXT,
      data_hmac TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query("ALTER TABLE game_zone_state ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1");
  await pgPool.query("ALTER TABLE game_zone_state ADD COLUMN IF NOT EXISTS data_sha256 TEXT");
  await pgPool.query("ALTER TABLE game_zone_state ADD COLUMN IF NOT EXISTS data_hmac TEXT");
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS game_zone_state_history (
      revision BIGINT PRIMARY KEY,
      data JSONB NOT NULL,
      data_sha256 TEXT NOT NULL,
      data_hmac TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query("ALTER TABLE game_zone_state_history ADD COLUMN IF NOT EXISTS data_hmac TEXT");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_game_zone_state_history_created ON game_zone_state_history(created_at DESC)");
  if(FINANCIAL_MIRROR_ENABLED)await ensureFinancialMirrorSchema(pgPool);
  if(FINANCIAL_JOURNAL_ENABLED)await ensureFinancialJournalSchema(pgPool);
  if(WALLET_AUTHORITY_ENABLED)await ensureWalletAuthoritySchema(pgPool);
  if(BUSINESS_AUTHORITY_ENABLED)await ensureBusinessAuthoritySchema(pgPool);
}
async function verifyPostgresRuntimeSchemaReadOnly(){
  // Utility processes (backup/state verify/history) must never mutate schema.
  // A missing/outdated schema is an operational error that the active Server/migration path must fix.
  await pgPool.query("SELECT id,data,revision,data_sha256,data_hmac,updated_at FROM game_zone_state LIMIT 0");
  await pgPool.query("SELECT revision,data,data_sha256,data_hmac,created_at FROM game_zone_state_history LIMIT 0");
  if(FINANCIAL_MIRROR_ENABLED)await verifyFinancialMirrorSchemaReadOnly(pgPool);
  if(FINANCIAL_JOURNAL_ENABLED)await verifyFinancialJournalSchemaReadOnly(pgPool);
  if(WALLET_AUTHORITY_ENABLED)await verifyWalletAuthoritySchemaReadOnly(pgPool);
  if(BUSINESS_AUTHORITY_ENABLED)await verifyBusinessAuthoritySchemaReadOnly(pgPool);
}
async function verifyFinancialMirrorState(){
  if(!FINANCIAL_MIRROR_ENABLED)return {ok:true,enabled:false,revision:null};
  if(!pgPool||!state)return {ok:false,enabled:true,error:"financial_mirror_store_uninitialized"};
  try{
    const result=await verifyFinancialMirror(pgPool,state,pgStateRevision);
    lastFinancialMirrorVerifyAt=new Date().toISOString();
    lastFinancialMirrorError=result.ok?null:(result.error||"financial_mirror_drift");
    if(result.actual?.stateRevision!==undefined)financialMirrorRevision=Number(result.actual.stateRevision);
    return {enabled:true,...result,verifiedAt:lastFinancialMirrorVerifyAt};
  }catch(e){
    lastFinancialMirrorVerifyAt=new Date().toISOString();
    lastFinancialMirrorError=e.message||"financial_mirror_verify_failed";
    return {ok:false,enabled:true,error:lastFinancialMirrorError,verifiedAt:lastFinancialMirrorVerifyAt};
  }
}
async function rebuildFinancialMirror(){
  if(!FINANCIAL_MIRROR_ENABLED)return {ok:true,enabled:false};
  if(STORE_READ_ONLY)throw new Error("store_read_only");
  if(!pgPool||!state)throw new Error("financial_mirror_store_uninitialized");
  await flushStore({throwOnError:true});
  const client=await pgPool.connect();
  let revision=null,committed=false;
  try{
    await client.query("BEGIN");
    const current=await client.query("SELECT revision,data,data_sha256,data_hmac FROM game_zone_state WHERE id=1 FOR UPDATE");
    if(!current.rows.length)throw new Error("postgres_state_row_missing");
    const row=current.rows[0],verified=verifySnapshotRecord({
      data:row.data,dataSha256:row.data_sha256,dataHmac:row.data_hmac,
      hmacKey:STATE_HMAC_KEY,requireHmac:!!STATE_HMAC_KEY
    });
    if(!verified.ok)throw new Error("postgres_state_integrity_mismatch");
    revision=normalizeRevision(row.revision,1);
    await syncFinancialMirror(client,row.data,revision);
    await client.query("COMMIT");
    committed=true;
    financialMirrorRevision=revision;
    lastFinancialMirrorAt=new Date().toISOString();
    lastFinancialMirrorError=null;
  }catch(e){
    if(!committed){try{await client.query("ROLLBACK")}catch{}}
    lastFinancialMirrorError=e.message;
    throw e;
  }finally{client.release()}

  // Verify only after releasing the transactional client so PG_POOL_MAX=1 cannot deadlock.
  const result=await verifyFinancialMirrorState();
  if(!result.ok){
    lastFinancialMirrorError=result.error||"financial_mirror_rebuild_verify_failed";
    throw new Error(lastFinancialMirrorError);
  }
  return {ok:true,enabled:true,revision,verifiedAt:result.verifiedAt};
}

async function verifyFinancialJournalState(){
  if(!FINANCIAL_JOURNAL_ENABLED)return {ok:true,enabled:false,entryCount:0};
  if(!pgPool||!state)return {ok:false,enabled:true,error:"financial_journal_store_uninitialized"};
  try{
    const result=await verifyFinancialJournal(pgPool,state,pgStateRevision,FINANCIAL_JOURNAL_HMAC_KEY,{limit:100000});
    lastFinancialJournalVerifyAt=new Date().toISOString();
    lastFinancialJournalError=result.ok?null:(result.error||"financial_journal_drift");
    financialJournalEntries=Number(result.entryCount||0);
    financialJournalCutoverRevision=result.cutoverRevision??financialJournalCutoverRevision;
    financialJournalLastStateRevision=result.lastStateRevision??financialJournalLastStateRevision;
    return {enabled:true,...result,verifiedAt:lastFinancialJournalVerifyAt};
  }catch(e){
    lastFinancialJournalVerifyAt=new Date().toISOString();
    lastFinancialJournalError=e.message||"financial_journal_verify_failed";
    return {ok:false,enabled:true,error:lastFinancialJournalError,verifiedAt:lastFinancialJournalVerifyAt};
  }
}

async function verifyWalletAuthorityState(){
  if(!WALLET_AUTHORITY_ENABLED)return {ok:true,enabled:false,accountCount:0};
  if(!pgPool||!state)return {ok:false,enabled:true,error:"wallet_authority_store_uninitialized"};
  try{
    const result=await verifyWalletAuthority(pgPool,state,pgStateRevision,WALLET_AUTHORITY_HMAC_KEY);
    lastWalletAuthorityVerifyAt=new Date().toISOString();
    lastWalletAuthorityError=result.ok?null:(result.error||"wallet_authority_drift");
    walletAuthorityCutoverRevision=result.cutoverRevision??walletAuthorityCutoverRevision;
    walletAuthorityLastStateRevision=result.stateRevision??walletAuthorityLastStateRevision;
    walletAuthorityAccountCount=Number(result.accountCount||0);
    walletAuthorityActiveAccountCount=Number(result.activeAccountCount||0);
    walletAuthorityTotalBalance=Number(result.totalBalance||0);
    return {enabled:true,...result,verifiedAt:lastWalletAuthorityVerifyAt};
  }catch(e){
    lastWalletAuthorityVerifyAt=new Date().toISOString();
    lastWalletAuthorityError=e.message||"wallet_authority_verify_failed";
    return {ok:false,enabled:true,error:lastWalletAuthorityError,verifiedAt:lastWalletAuthorityVerifyAt};
  }
}

async function verifyBusinessAuthorityState(){
  if(!BUSINESS_AUTHORITY_ENABLED)return {ok:true,enabled:false,orderCount:0,topupCount:0};
  if(!pgPool||!state)return {ok:false,enabled:true,error:"business_authority_store_uninitialized"};
  try{
    const result=await verifyBusinessAuthority(pgPool,state,pgStateRevision,BUSINESS_AUTHORITY_HMAC_KEY);
    lastBusinessAuthorityVerifyAt=new Date().toISOString();
    lastBusinessAuthorityError=result.ok?null:(result.error||"business_authority_drift");
    businessAuthorityCutoverRevision=result.cutoverRevision??businessAuthorityCutoverRevision;
    businessAuthorityLastStateRevision=result.stateRevision??businessAuthorityLastStateRevision;
    businessAuthorityOrderCount=Number(result.orderCount||0);
    businessAuthorityTopupCount=Number(result.topupCount||0);
    return {enabled:true,...result,verifiedAt:lastBusinessAuthorityVerifyAt};
  }catch(e){
    lastBusinessAuthorityVerifyAt=new Date().toISOString();
    lastBusinessAuthorityError=e.message||"business_authority_verify_failed";
    return {ok:false,enabled:true,error:lastBusinessAuthorityError,verifiedAt:lastBusinessAuthorityVerifyAt};
  }
}

async function initPostgres() {
  const { Pool } = require("pg");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  const requireSingleLock=String(process.env.PG_SINGLE_INSTANCE_LOCK||"false").toLowerCase()==="true";
  const requestedPoolMax=Math.max(1,Number(process.env.PG_POOL_MAX||5));
  const effectivePoolMax=requireSingleLock?Math.max(2,requestedPoolMax):requestedPoolMax;
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.PG_SSL || "false").toLowerCase() === "true" ? { rejectUnauthorized:false } : undefined,
    max: effectivePoolMax,
    idleTimeoutMillis: Math.max(1000, Number(process.env.PG_IDLE_TIMEOUT_MS || 30000)),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000))
  });
  pgPool.on("error", err => {
    pgPoolError = err.message;
    lastPersistError = err.message;
    console.error("Postgres pool error:", err.message);
  });

  if(STORE_READ_ONLY)await verifyPostgresRuntimeSchemaReadOnly();
  else await ensurePostgresRuntimeSchema();

  if(requireSingleLock){
    pgAdvisoryClient=await pgPool.connect();
    try{
      const lock=await pgAdvisoryClient.query("SELECT pg_try_advisory_lock(hashtext('game-zone-active-server')) AS locked");
      pgSingleInstanceLockAcquired=lock.rows?.[0]?.locked===true;
      if(!pgSingleInstanceLockAcquired)throw new Error("another_game_zone_server_is_active");
    }catch(e){
      pgAdvisoryClient.release();pgAdvisoryClient=null;
      throw e;
    }
  }

  const r = await pgPool.query("SELECT data,revision,data_sha256,data_hmac FROM game_zone_state WHERE id=1");
  if (r.rows.length) {
    const row=r.rows[0],verified=verifySnapshotRecord({
      data:row.data,dataSha256:row.data_sha256,dataHmac:row.data_hmac,
      hmacKey:STATE_HMAC_KEY,requireHmac:false
    });
    if(!verified.ok)throw stateIntegrityError(verified.reason==="state_hmac_mismatch"?"postgres_state_hmac_mismatch":"postgres_state_integrity_mismatch");
    state = row.data;
    pgStateRevision=normalizeRevision(row.revision,1);
    pgStateSha256=verified.actual;
    pgStateHmac=verified.actualHmac||row.data_hmac||null;
    if((!row.data_sha256||(STATE_HMAC_KEY&&!row.data_hmac))&&!STORE_READ_ONLY){
      await pgPool.query("UPDATE game_zone_state SET data_sha256=$1,data_hmac=$2 WHERE id=1",[verified.actual,verified.actualHmac]);
    }
    markStateVerified(verified.actual,verified.actualHmac);
  } else {
    state = readJsonFile();
    pgStateRevision=1;
    pgStateSha256=snapshotHash(state);
    pgStateHmac=snapshotHmac(state,STATE_HMAC_KEY);
    await pgPool.query(
      "INSERT INTO game_zone_state(id,data,revision,data_sha256,data_hmac,updated_at) VALUES(1,$1::jsonb,$2,$3,$4,NOW())",
      [JSON.stringify(state),pgStateRevision,pgStateSha256,pgStateHmac]
    );
    markStateVerified(pgStateSha256,pgStateHmac);
  }

  if(STATE_HMAC_KEY&&!STORE_READ_ONLY){
    const legacyHistory=await pgPool.query(
      "SELECT revision,data,data_sha256 FROM game_zone_state_history WHERE data_hmac IS NULL ORDER BY revision"
    );
    for(const row of legacyHistory.rows){
      const verified=verifySnapshotRecord({data:row.data,dataSha256:row.data_sha256,hmacKey:STATE_HMAC_KEY,requireHmac:false});
      if(!verified.ok)throw stateIntegrityError("postgres_history_integrity_mismatch");
      await pgPool.query("UPDATE game_zone_state_history SET data_hmac=$1 WHERE revision=$2",[verified.actualHmac,row.revision]);
    }
  }

  if(FINANCIAL_MIRROR_ENABLED&&!STORE_READ_ONLY){
    const mirror=await verifyFinancialMirrorState();
    if(!mirror.ok)await rebuildFinancialMirror();
  }

  if(FINANCIAL_JOURNAL_ENABLED){
    if(!FINANCIAL_JOURNAL_HMAC_KEY&&process.env.NODE_ENV==="production")throw new Error("FINANCIAL_JOURNAL_HMAC_KEY is required in production");
    if(!STORE_READ_ONLY){
      const client=await pgPool.connect();
      try{
        await client.query("BEGIN");
        const backfill=await backfillFinancialJournal(client,state,pgStateRevision,FINANCIAL_JOURNAL_HMAC_KEY);
        await client.query("COMMIT");
        if(backfill.inserted)console.log(`Financial journal backfilled: ${backfill.inserted} historical transactions`);
      }catch(e){try{await client.query("ROLLBACK")}catch{};throw e;}finally{client.release()}
    }
    const journal=await verifyFinancialJournalState();
    if(!journal.ok)throw new Error(journal.error||"financial_journal_verify_failed");
  }

  if(WALLET_AUTHORITY_ENABLED){
    if(!WALLET_AUTHORITY_HMAC_KEY&&process.env.NODE_ENV==="production")throw new Error("WALLET_AUTHORITY_HMAC_KEY is required in production");
    if(!STORE_READ_ONLY){
      const client=await pgPool.connect();
      try{
        await client.query("BEGIN");
        const boot=await bootstrapWalletAuthority(client,state,pgStateRevision,WALLET_AUTHORITY_HMAC_KEY);
        await client.query("COMMIT");
        if(boot.bootstrapped)console.log(`Wallet authority cut over at state revision ${boot.cutoverRevision}`);
      }catch(e){try{await client.query("ROLLBACK")}catch{};throw e;}finally{client.release()}
    }
    const wallet=await verifyWalletAuthorityState();
    if(!wallet.ok)throw new Error(wallet.error||"wallet_authority_verify_failed");
  }

  if(BUSINESS_AUTHORITY_ENABLED){
    if(!BUSINESS_AUTHORITY_HMAC_KEY&&process.env.NODE_ENV==="production")throw new Error("BUSINESS_AUTHORITY_HMAC_KEY is required in production");
    if(!STORE_READ_ONLY){
      const client=await pgPool.connect();
      try{
        await client.query("BEGIN");
        const boot=await bootstrapBusinessAuthority(client,state,pgStateRevision,BUSINESS_AUTHORITY_HMAC_KEY);
        await client.query("COMMIT");
        if(boot.bootstrapped)console.log(`Business authority cut over at state revision ${boot.cutoverRevision}`);
      }catch(e){try{await client.query("ROLLBACK")}catch{};throw e;}finally{client.release()}
    }
    const business=await verifyBusinessAuthorityState();
    if(!business.ok)throw new Error(business.error||"business_authority_verify_failed");
  }
}
async function initStore() {
  if (initialized) return getStoreInfo();
  if (STORAGE_DRIVER === "postgres") await initPostgres();
  else state = readJsonFile();
  initialized = true;
  return getStoreInfo();
}
function ensureState() {
  if (!state) state = readJsonFile();
}
function readDB() {
  ensureState();
  return clone(state);
}
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

async function persistPostgresSnapshot(snapshot) {
  const retries=Math.max(1,Number(process.env.PG_PERSIST_RETRIES||3));
  const historyLimit=boundedHistoryLimit(process.env.PG_STATE_HISTORY_MAX||200);
  const historyDays=boundedHistoryDays(process.env.PG_STATE_HISTORY_RETENTION_DAYS||90);
  const historyMinInterval=boundedHistoryIntervalSeconds(process.env.PG_STATE_HISTORY_MIN_INTERVAL_SECONDS||300);
  const newHash=snapshotHash(snapshot),newHmac=snapshotHmac(snapshot,STATE_HMAC_KEY);
  let lastError=null;

  for(let attempt=1;attempt<=retries;attempt++){
    const client=await pgPool.connect();
    try{
      await client.query("BEGIN");
      const current=await client.query("SELECT data,revision,data_sha256,data_hmac FROM game_zone_state WHERE id=1 FOR UPDATE");
      if(!current.rows.length)throw stateIntegrityError("postgres_state_row_missing");
      const row=current.rows[0],verified=verifySnapshotRecord({
        data:row.data,dataSha256:row.data_sha256,dataHmac:row.data_hmac,
        hmacKey:STATE_HMAC_KEY,requireHmac:!!STATE_HMAC_KEY
      });
      if(!verified.ok)throw stateIntegrityError(verified.reason==="state_hmac_mismatch"||verified.reason==="state_hmac_missing"?"postgres_state_hmac_mismatch":"postgres_state_integrity_mismatch");

      const currentRevision=normalizeRevision(row.revision,1);
      if(pgStateRevision&&currentRevision!==pgStateRevision){
        throw stateIntegrityError("postgres_state_revision_conflict");
      }

      await client.query(
        `INSERT INTO game_zone_state_history(revision,data,data_sha256,data_hmac,created_at)
         SELECT $1,$2::jsonb,$3,$4,NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM game_zone_state_history
           WHERE created_at >= NOW() - ($5::int * INTERVAL '1 second')
         )
         ON CONFLICT(revision) DO NOTHING`,
        [currentRevision,JSON.stringify(row.data),verified.actual,verified.actualHmac,historyMinInterval]
      );

      const newRevision=nextRevision(currentRevision);
      let journalResult={entries:[],entryCount:financialJournalEntries};
      if(FINANCIAL_JOURNAL_ENABLED){
        journalResult=await appendFinancialJournal(client,row.data,snapshot,newRevision,FINANCIAL_JOURNAL_HMAC_KEY);
      }
      let walletResult={changes:[],meta:null};
      if(WALLET_AUTHORITY_ENABLED){
        walletResult=await applyWalletAuthority(client,row.data,snapshot,newRevision,WALLET_AUTHORITY_HMAC_KEY);
      }
      let businessResult={changes:{orders:[],topups:[]},meta:null};
      if(BUSINESS_AUTHORITY_ENABLED){
        businessResult=await applyBusinessAuthority(client,row.data,snapshot,newRevision,BUSINESS_AUTHORITY_HMAC_KEY);
      }
      await client.query(
        `UPDATE game_zone_state
         SET data=$1::jsonb,revision=$2,data_sha256=$3,data_hmac=$4,updated_at=NOW()
         WHERE id=1`,
        [JSON.stringify(snapshot),newRevision,newHash,newHmac]
      );

      if(FINANCIAL_MIRROR_ENABLED)await syncFinancialMirror(client,snapshot,newRevision);

      const prunedByAge=await client.query(
        `DELETE FROM game_zone_state_history
         WHERE created_at < NOW() - make_interval(days => $1::int)`,
        [historyDays]
      );
      const prunedByCount=await client.query(
        `DELETE FROM game_zone_state_history
         WHERE revision IN (
           SELECT revision FROM game_zone_state_history
           ORDER BY revision DESC
           OFFSET $1
         )`,
        [historyLimit]
      );

      await client.query("COMMIT");
      pgStateRevision=newRevision;
      pgStateSha256=newHash;
      pgStateHmac=newHmac;
      if(FINANCIAL_MIRROR_ENABLED){
        financialMirrorRevision=newRevision;
        lastFinancialMirrorAt=new Date().toISOString();
        lastFinancialMirrorError=null;
      }
      if(FINANCIAL_JOURNAL_ENABLED){
        financialJournalEntries=Number(journalResult.entryCount||financialJournalEntries);
        financialJournalLastStateRevision=newRevision;
        lastFinancialJournalError=null;
      }
      if(WALLET_AUTHORITY_ENABLED){
        walletAuthorityLastStateRevision=newRevision;
        walletAuthorityAccountCount=Number(walletResult.meta?.accountCount||walletAuthorityAccountCount);
        walletAuthorityActiveAccountCount=Number(walletResult.meta?.activeAccountCount||walletAuthorityActiveAccountCount);
        walletAuthorityTotalBalance=Number(walletResult.meta?.totalBalance||0);
        lastWalletAuthorityError=null;
      }
      if(BUSINESS_AUTHORITY_ENABLED){
        businessAuthorityLastStateRevision=newRevision;
        businessAuthorityOrderCount=Number(businessResult.meta?.orderCount||businessAuthorityOrderCount);
        businessAuthorityTopupCount=Number(businessResult.meta?.topupCount||businessAuthorityTopupCount);
        lastBusinessAuthorityError=null;
      }
      stateHistoryPruned+=Number(prunedByAge.rowCount||0)+Number(prunedByCount.rowCount||0);
      lastPersistError=null;pgPoolError=null;lastPersistAt=new Date().toISOString();
      markStateVerified(newHash,newHmac);
      client.release();
      return;
    }catch(e){
      try{await client.query("ROLLBACK");}catch{}
      client.release();
      lastError=e;lastPersistError=e.message;persistFailures++;
      if(["postgres_state_integrity_mismatch","postgres_state_hmac_mismatch","postgres_state_revision_conflict","postgres_state_row_missing"].includes(e.code||e.message)||String(e.code||e.message||"").startsWith("wallet_authority_")||String(e.code||e.message||"").startsWith("business_authority_"))break;
      if(attempt<retries)await sleep(Math.min(250*attempt,1000));
    }
  }
  console.error("Postgres persistence failed after retries:", lastError?.message||"unknown_error");
  throw lastError||new Error("postgres_persist_failed");
}
function queuePostgresPersist(snapshot) {
  persistPending++;
  persistChain = persistChain
    .catch(()=>{})
    .then(()=>persistPostgresSnapshot(snapshot))
    .catch(e=>{
      lastPersistError=e.message;
      if(process.env.NODE_ENV==="production"&&String(process.env.STORAGE_FAIL_FAST||"true").toLowerCase()!=="false"){
        setTimeout(()=>process.exit(1),150);
      }
    })
    .finally(()=>{persistPending=Math.max(0,persistPending-1);});
}
function validateStateTransition(nextState) {
  if(STORE_READ_ONLY)throw new Error("store_read_only");
  ensureState();
  // Financial guard: no wallet balance may change unless new transaction rows explain the exact delta.
  // This runs synchronously before the in-memory state is replaced. Disaster-recovery code uses
  // the direct PostgreSQL recovery layer; the override exists only for explicit JSON-dev restore.
  if(String(process.env.ALLOW_UNJOURNALED_STATE_REPLACE||"false").toLowerCase()!=="true"){
    deriveFinancialMutations(state,nextState,FINANCIAL_JOURNAL_HMAC_KEY);
  }
  if(BUSINESS_AUTHORITY_ENABLED&&String(process.env.ALLOW_UNGUARDED_BUSINESS_STATE_REPLACE||"false").toLowerCase()!=="true"){
    deriveBusinessChanges(state,nextState,BUSINESS_AUTHORITY_HMAC_KEY);
  }
}
function writeDB(db) {
  validateStateTransition(db);
  state = clone(db);
  if (STORAGE_DRIVER === "postgres" && pgPool) queuePostgresPersist(clone(state));
  else writeJsonFile(state);
}
async function writeDBDurable(db) {
  // Critical mutations use an explicit durable acknowledgement boundary: the in-process state is
  // updated immediately so later requests cannot read an older snapshot, but this promise resolves
  // only after the PostgreSQL transaction (or JSON file replacement) has completed successfully.
  // In production, a failed PostgreSQL commit remains fail-fast and no HTTP success should be sent.
  validateStateTransition(db);
  const next=clone(db);
  state=next;
  if(STORAGE_DRIVER==="postgres"&&pgPool){
    queuePostgresPersist(clone(next));
    await flushStore({throwOnError:true});
  }else{
    writeJsonFile(next);
  }
  return clone(state);
}
async function flushStore({throwOnError=false}={}) {
  await persistChain;
  if(throwOnError && lastPersistError){
    const err=new Error("storage_persist_failed");
    err.causeMessage=lastPersistError;
    throw err;
  }
  return getStoreInfo();
}
async function verifyPersistedState(){
  if(STORAGE_DRIVER!=="postgres"||!pgPool)return {ok:true,driver:STORAGE_DRIVER,revision:null,dataSha256:null};
  try{
    await flushStore({throwOnError:true});
    const r=await pgPool.query("SELECT data,revision,data_sha256,data_hmac FROM game_zone_state WHERE id=1");
    if(!r.rows.length)throw stateIntegrityError("postgres_state_row_missing");
    const row=r.rows[0],verified=verifySnapshotRecord({
      data:row.data,dataSha256:row.data_sha256,dataHmac:row.data_hmac,
      hmacKey:STATE_HMAC_KEY,requireHmac:!!STATE_HMAC_KEY
    });
    if(!verified.ok)throw stateIntegrityError(verified.reason==="state_hmac_mismatch"||verified.reason==="state_hmac_missing"?"postgres_state_hmac_mismatch":"postgres_state_integrity_mismatch");
    const revision=normalizeRevision(row.revision,1);
    if(pgStateRevision&&revision!==pgStateRevision)throw stateIntegrityError("postgres_state_revision_conflict");
    pgStateRevision=revision;pgStateHmac=verified.actualHmac||row.data_hmac||null;markStateVerified(verified.actual,verified.actualHmac);
    const mirror=await verifyFinancialMirrorState();
    if(!mirror.ok)throw stateIntegrityError(mirror.error||"financial_mirror_drift");
    const journal=await verifyFinancialJournalState();
    if(!journal.ok)throw stateIntegrityError(journal.error||"financial_journal_drift");
    const walletAuthority=await verifyWalletAuthorityState();
    if(!walletAuthority.ok)throw stateIntegrityError(walletAuthority.error||"wallet_authority_drift");
    const businessAuthority=await verifyBusinessAuthorityState();
    if(!businessAuthority.ok)throw stateIntegrityError(businessAuthority.error||"business_authority_drift");
    return {ok:true,driver:"postgres",revision,dataSha256:verified.actual,hmacVerified:!!STATE_HMAC_KEY,financialMirror:mirror,financialJournal:journal,walletAuthority,businessAuthority,verifiedAt:lastStateVerifyAt};
  }catch(e){
    lastStateVerifyError=e.code||e.message||"postgres_state_verify_failed";
    return {ok:false,driver:"postgres",error:lastStateVerifyError,revision:pgStateRevision||null,dataSha256:pgStateSha256};
  }
}
async function listStoreHistory(limit=20){
  if(STORAGE_DRIVER!=="postgres"||!pgPool)return [];
  const n=Math.max(1,Math.min(100,Number(limit||20)));
  const r=await pgPool.query(
    `SELECT revision,data_sha256,(data_hmac IS NOT NULL) AS hmac_present,created_at,
            pg_column_size(data) AS data_bytes
     FROM game_zone_state_history
     ORDER BY revision DESC
     LIMIT $1`,
    [n]
  );
  return r.rows.map(row=>({
    revision:Number(row.revision),
    dataSha256:row.data_sha256,
    hmacPresent:row.hmac_present===true,
    createdAt:row.created_at instanceof Date?row.created_at.toISOString():row.created_at,
    dataBytes:Number(row.data_bytes||0)
  }));
}
async function verifyStoreHistory(limit=100){
  if(STORAGE_DRIVER!=="postgres"||!pgPool)return {ok:true,driver:STORAGE_DRIVER,checked:0,errors:[]};
  const n=Math.max(1,Math.min(500,Number(limit||100)));
  const r=await pgPool.query(
    `SELECT revision,data,data_sha256,data_hmac
     FROM game_zone_state_history
     ORDER BY revision DESC
     LIMIT $1`,
    [n]
  );
  const errors=[];
  for(const row of r.rows){
    const verified=verifySnapshotRecord({
      data:row.data,dataSha256:row.data_sha256,dataHmac:row.data_hmac,
      hmacKey:STATE_HMAC_KEY,requireHmac:!!STATE_HMAC_KEY
    });
    if(!verified.ok)errors.push({revision:Number(row.revision),reason:verified.reason});
  }
  return {ok:errors.length===0,driver:"postgres",checked:r.rows.length,errors};
}
async function rollbackStoreRevision(revision,{confirmation=""}={}){
  if(STORAGE_DRIVER!=="postgres"||!pgPool)throw new Error("postgres_required");
  const targetRevision=normalizeRevision(revision,0);
  if(!targetRevision||String(confirmation)!==`ROLLBACK_TO_REVISION_${targetRevision}`)throw new Error("state_rollback_confirmation_required");
  await flushStore({throwOnError:true});

  const client=await pgPool.connect();
  try{
    await client.query("BEGIN");
    const target=await client.query("SELECT data,data_sha256,data_hmac FROM game_zone_state_history WHERE revision=$1 FOR SHARE",[targetRevision]);
    if(!target.rows.length)throw new Error("state_revision_not_found");
    const targetVerified=verifySnapshotRecord({
      data:target.rows[0].data,dataSha256:target.rows[0].data_sha256,dataHmac:target.rows[0].data_hmac,
      hmacKey:STATE_HMAC_KEY,requireHmac:!!STATE_HMAC_KEY
    });
    if(!targetVerified.ok)throw new Error("state_history_integrity_mismatch");

    const current=await client.query("SELECT data,revision,data_sha256,data_hmac FROM game_zone_state WHERE id=1 FOR UPDATE");
    if(!current.rows.length)throw new Error("postgres_state_row_missing");
    const currentRow=current.rows[0],currentVerified=verifySnapshotRecord({
      data:currentRow.data,dataSha256:currentRow.data_sha256,dataHmac:currentRow.data_hmac,
      hmacKey:STATE_HMAC_KEY,requireHmac:!!STATE_HMAC_KEY
    });
    if(!currentVerified.ok)throw new Error("postgres_state_integrity_mismatch");
    const currentRevision=normalizeRevision(currentRow.revision,1);

    await client.query(
      `INSERT INTO game_zone_state_history(revision,data,data_sha256,data_hmac,created_at)
       VALUES($1,$2::jsonb,$3,$4,NOW())
       ON CONFLICT(revision) DO NOTHING`,
      [currentRevision,JSON.stringify(currentRow.data),currentVerified.actual,currentVerified.actualHmac]
    );
    const newRevision=nextRevision(currentRevision);
    await client.query(
      `UPDATE game_zone_state SET data=$1::jsonb,revision=$2,data_sha256=$3,data_hmac=$4,updated_at=NOW() WHERE id=1`,
      [JSON.stringify(target.rows[0].data),newRevision,targetVerified.actual,targetVerified.actualHmac]
    );
    if(FINANCIAL_MIRROR_ENABLED)await syncFinancialMirror(client,target.rows[0].data,newRevision);
    if(FINANCIAL_JOURNAL_ENABLED)await touchMeta(client,newRevision);
    if(WALLET_AUTHORITY_ENABLED)await replaceWalletAuthorityFromState(client,target.rows[0].data,newRevision,WALLET_AUTHORITY_HMAC_KEY);
    if(BUSINESS_AUTHORITY_ENABLED)await replaceBusinessAuthorityFromState(client,target.rows[0].data,newRevision,BUSINESS_AUTHORITY_HMAC_KEY);
    await client.query("COMMIT");

    state=clone(target.rows[0].data);
    pgStateRevision=newRevision;
    pgStateSha256=targetVerified.actual;
    pgStateHmac=targetVerified.actualHmac||target.rows[0].data_hmac||null;
    if(FINANCIAL_MIRROR_ENABLED){
      financialMirrorRevision=newRevision;
      lastFinancialMirrorAt=new Date().toISOString();
      lastFinancialMirrorError=null;
    }
    if(FINANCIAL_JOURNAL_ENABLED){
      financialJournalLastStateRevision=newRevision;
      lastFinancialJournalError=null;
    }
    if(WALLET_AUTHORITY_ENABLED){
      walletAuthorityLastStateRevision=newRevision;
      lastWalletAuthorityError=null;
    }
    if(BUSINESS_AUTHORITY_ENABLED){
      businessAuthorityLastStateRevision=newRevision;
      businessAuthorityOrderCount=(target.rows[0].data.orders||[]).length;
      businessAuthorityTopupCount=(target.rows[0].data.topups||[]).length;
      lastBusinessAuthorityError=null;
    }
    lastPersistAt=new Date().toISOString();
    markStateVerified(targetVerified.actual,targetVerified.actualHmac);
    return {ok:true,restoredFromRevision:targetRevision,newRevision,dataSha256:targetVerified.actual};
  }catch(e){
    try{await client.query("ROLLBACK");}catch{}
    throw e;
  }finally{client.release()}
}
async function closeStore() {
  await flushStore();
  if(pgAdvisoryClient){
    try{await pgAdvisoryClient.query("SELECT pg_advisory_unlock(hashtext('game-zone-active-server'))");}catch{}
    try{pgAdvisoryClient.release();}catch{}
    pgAdvisoryClient=null;pgSingleInstanceLockAcquired=false;
  }
  if (pgPool) await pgPool.end();
}
function getStoreInfo() {
  return {
    driver: STORAGE_DRIVER,
    durableAcknowledgementAvailable:true,
    initialized,
    postgresConnected: !!pgPool,
    lastPersistAt,
    lastPersistError,
    persistPending,
    persistFailures,
    pgPoolError,
    pgPoolMax:pgPool?.options?.max||null,
    singleInstanceLockRequired:String(process.env.PG_SINGLE_INSTANCE_LOCK||"false").toLowerCase()==="true",
    singleInstanceLockAcquired:pgSingleInstanceLockAcquired,
    stateRevision:STORAGE_DRIVER==="postgres"?(pgStateRevision||null):null,
    stateDataSha256:STORAGE_DRIVER==="postgres"?pgStateSha256:null,
    stateHmacPresent:STORAGE_DRIVER==="postgres"?!!pgStateHmac:false,
    lastStateVerifyAt,
    lastStateVerifyError,
    stateHistoryPruned,
    financialMirrorEnabled:FINANCIAL_MIRROR_ENABLED,
    financialMirrorRevision,
    lastFinancialMirrorAt,
    lastFinancialMirrorVerifyAt,
    lastFinancialMirrorError,
    financialJournalEnabled:FINANCIAL_JOURNAL_ENABLED,
    financialJournalEntries,
    financialJournalCutoverRevision,
    financialJournalLastStateRevision,
    lastFinancialJournalVerifyAt,
    lastFinancialJournalError,
    walletAuthorityEnabled:WALLET_AUTHORITY_ENABLED,
    walletAuthorityCutoverRevision,
    walletAuthorityLastStateRevision,
    walletAuthorityAccountCount,
    walletAuthorityActiveAccountCount,
    walletAuthorityTotalBalance,
    lastWalletAuthorityVerifyAt,
    lastWalletAuthorityError,
    businessAuthorityEnabled:BUSINESS_AUTHORITY_ENABLED,
    businessAuthorityCutoverRevision,
    businessAuthorityLastStateRevision,
    businessAuthorityOrderCount,
    businessAuthorityTopupCount,
    lastBusinessAuthorityVerifyAt,
    lastBusinessAuthorityError,
    readOnly:STORE_READ_ONLY
  };
}
function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}
function ensureUser(telegramUser = {}) {
  const db = readDB();
  const tid = String(telegramUser.id || telegramUser.telegramId || "");
  if (!tid) throw new Error("telegram user id is required");
  let user = db.users.find(u => String(u.telegramId) === tid);
  if (!user) {
    user = {
      id: id("usr"), telegramId: tid, username: telegramUser.username || "",
      firstName: telegramUser.first_name || telegramUser.firstName || "",
      lastName: telegramUser.last_name || telegramUser.lastName || "",
      balance: 0, currency: "USD", sessionVersion:1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    db.users.push(user);
  } else {
    user.username = telegramUser.username ?? user.username;
    user.firstName = telegramUser.first_name ?? telegramUser.firstName ?? user.firstName;
    user.lastName = telegramUser.last_name ?? telegramUser.lastName ?? user.lastName;
    if(user.sessionVersion===undefined)user.sessionVersion=1;
    user.updatedAt = new Date().toISOString();
  }
  writeDB(db);
  return user;
}
function getUser(telegramId) {
  return readDB().users.find(u => String(u.telegramId) === String(telegramId)) || null;
}

module.exports = {
  initStore, readDB, writeDB, writeDBDurable, flushStore, closeStore, getStoreInfo,
  verifyPersistedState,listStoreHistory,verifyStoreHistory,rollbackStoreRevision,
  verifyFinancialMirrorState,rebuildFinancialMirror,verifyFinancialJournalState,verifyWalletAuthorityState,verifyBusinessAuthorityState,
  id, ensureUser, getUser
};
