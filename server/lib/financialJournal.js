const crypto=require('node:crypto');
const {stableStringify}=require('./backupFormat');

const EPS=0.000001;
const ALLOWED_TYPES=new Set(['topup','refund','purchase','admin_credit','admin_debit']);

function sha(value){return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}
function hmac(value,key){
  const secret=String(key||'');
  if(!secret)return null;
  return crypto.createHmac('sha256',secret).update(stableStringify(value)).digest('hex');
}
function money(value){return Number(Number(value||0).toFixed(6))}
function subjectKey(telegramId,key){
  const secret=String(key||'');
  if(!secret)return null;
  return crypto.createHmac('sha256',secret).update(String(telegramId||'')).digest('hex');
}
function transactionFingerprint(txn={}){
  return {
    id:String(txn.id||''),
    type:String(txn.type||''),
    amount:money(txn.amount),
    currency:String(txn.currency||'USD'),
    reference:txn.reference===undefined||txn.reference===null?null:String(txn.reference),
    adminRequestId:txn.adminRequestId===undefined||txn.adminRequestId===null?null:String(txn.adminRequestId),
    createdAt:txn.createdAt?String(txn.createdAt):null
  };
}
function transactionPayloadSha256(txn){return sha(transactionFingerprint(txn))}
function operationKey(txn){return `txn:${String(txn?.id||'')}`}
function balanceMap(db={}){
  const out=new Map();
  for(const u of db.users||[])out.set(String(u.telegramId),money(u.balance));
  return out;
}
function deriveFinancialMutations(beforeDb={},afterDb={},key=''){
  const beforeBalances=balanceMap(beforeDb),afterBalances=balanceMap(afterDb);
  const beforeTx=new Set((beforeDb.transactions||[]).map(x=>String(x.id)));
  const newTx=(afterDb.transactions||[]).filter(x=>!beforeTx.has(String(x.id)));
  const byUser=new Map();
  for(const txn of newTx){
    const tid=String(txn.telegramId||'');
    if(!tid)throw new Error('financial_transaction_user_missing');
    if(!ALLOWED_TYPES.has(String(txn.type||'')))throw new Error('financial_transaction_type_unsupported');
    const amount=Number(txn.amount);
    if(!Number.isFinite(amount)||Math.abs(amount)<EPS)throw new Error('financial_transaction_amount_invalid');
    if(!byUser.has(tid))byUser.set(tid,[]);
    byUser.get(tid).push(txn);
  }

  const ids=new Set([...beforeBalances.keys(),...afterBalances.keys(),...byUser.keys()]);
  const entries=[];
  for(const tid of ids){
    const before=beforeBalances.has(tid)?beforeBalances.get(tid):0;
    const after=afterBalances.has(tid)?afterBalances.get(tid):0;
    const txns=byUser.get(tid)||[];
    const sum=money(txns.reduce((a,x)=>a+Number(x.amount||0),0));
    const delta=money(after-before);
    if(Math.abs(delta-sum)>EPS){
      const e=new Error('financial_balance_change_unjournaled');
      e.detail={telegramId:tid,before,after,delta,transactionSum:sum,newTransactions:txns.map(x=>x.id)};
      throw e;
    }
    let running=before;
    for(const txn of txns){
      const next=money(running+Number(txn.amount));
      const payloadSha256=transactionPayloadSha256(txn);
      const body={
        operationKey:operationKey(txn),
        sourceTransactionId:String(txn.id),
        subjectKey:subjectKey(txn.id,key),
        type:String(txn.type),amount:money(txn.amount),
        balanceBefore:running,balanceAfter:next,
        currency:String(txn.currency||'USD'),
        reference:txn.reference===undefined||txn.reference===null?null:String(txn.reference),
        payloadSha256,legacyBackfill:false
      };
      entries.push({...body,entryHmac:hmac(body,key)});
      running=next;
    }
    if(Math.abs(running-after)>EPS)throw new Error('financial_balance_projection_mismatch');
  }
  return entries;
}
function legacyJournalEntry(txn,key){
  const body={
    operationKey:operationKey(txn),sourceTransactionId:String(txn.id),
    subjectKey:subjectKey(txn.id,key),type:String(txn.type||''),
    amount:money(txn.amount),balanceBefore:null,balanceAfter:null,
    currency:String(txn.currency||'USD'),
    reference:txn.reference===undefined||txn.reference===null?null:String(txn.reference),
    payloadSha256:transactionPayloadSha256(txn),legacyBackfill:true
  };
  return {...body,entryHmac:hmac(body,key)};
}
function rowBody(row){
  return {
    operationKey:String(row.operation_key),sourceTransactionId:String(row.source_transaction_id),
    subjectKey:row.subject_key||null,type:String(row.type),amount:money(row.amount),
    balanceBefore:row.balance_before===null?null:money(row.balance_before),
    balanceAfter:row.balance_after===null?null:money(row.balance_after),
    currency:String(row.currency||'USD'),reference:row.reference===null?null:String(row.reference),
    payloadSha256:String(row.payload_sha256),legacyBackfill:row.legacy_backfill===true
  };
}
function verifyJournalRow(row,key){
  const body=rowBody(row),actual=hmac(body,key);
  if(key&&!row.entry_hmac)return {ok:false,reason:'financial_journal_hmac_missing',body};
  if(key&&actual!==String(row.entry_hmac))return {ok:false,reason:'financial_journal_hmac_mismatch',body};
  return {ok:true,body,actualHmac:actual};
}
async function ensureFinancialJournalSchema(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_financial_journal (
      id BIGSERIAL PRIMARY KEY,
      operation_key TEXT NOT NULL UNIQUE,
      source_transaction_id TEXT NOT NULL UNIQUE,
      subject_key TEXT,
      type TEXT NOT NULL CHECK(type IN ('topup','refund','purchase','admin_credit','admin_debit')),
      amount NUMERIC(18,6) NOT NULL CHECK(amount<>0),
      balance_before NUMERIC(18,6) CHECK(balance_before IS NULL OR balance_before>=0),
      balance_after NUMERIC(18,6) CHECK(balance_after IS NULL OR balance_after>=0),
      currency TEXT NOT NULL,
      reference TEXT,
      payload_sha256 TEXT NOT NULL,
      state_revision BIGINT NOT NULL,
      legacy_backfill BOOLEAN NOT NULL DEFAULT FALSE,
      entry_hmac TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_gz_financial_journal_revision ON game_zone_financial_journal(state_revision)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_gz_financial_journal_subject ON game_zone_financial_journal(subject_key)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_financial_journal_meta (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
      cutover_revision BIGINT NOT NULL,
      last_state_revision BIGINT NOT NULL,
      entry_count BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
async function verifyFinancialJournalSchemaReadOnly(client){
  await client.query('SELECT operation_key,source_transaction_id,subject_key,type,amount,balance_before,balance_after,currency,reference,payload_sha256,state_revision,legacy_backfill,entry_hmac FROM game_zone_financial_journal LIMIT 0');
  await client.query('SELECT cutover_revision,last_state_revision,entry_count FROM game_zone_financial_journal_meta WHERE id=1');
}
async function insertEntry(client,entry,revision){
  const inserted=await client.query(`
    INSERT INTO game_zone_financial_journal(
      operation_key,source_transaction_id,subject_key,type,amount,balance_before,balance_after,
      currency,reference,payload_sha256,state_revision,legacy_backfill,entry_hmac,created_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT(source_transaction_id) DO NOTHING
    RETURNING source_transaction_id`,[
      entry.operationKey,entry.sourceTransactionId,entry.subjectKey,entry.type,entry.amount,
      entry.balanceBefore,entry.balanceAfter,entry.currency,entry.reference,entry.payloadSha256,
      revision,entry.legacyBackfill,entry.entryHmac
    ]);
  if(inserted.rows.length)return {inserted:true};

  const existing=(await client.query(`SELECT operation_key,source_transaction_id,subject_key,type,amount,balance_before,balance_after,currency,reference,payload_sha256,state_revision,legacy_backfill,entry_hmac FROM game_zone_financial_journal WHERE source_transaction_id=$1`,[entry.sourceTransactionId])).rows[0];
  if(!existing)throw new Error('financial_journal_operation_key_conflict');
  const body=rowBody(existing);
  if(
    body.operationKey!==entry.operationKey||body.type!==entry.type||
    money(body.amount)!==money(entry.amount)||body.currency!==entry.currency||
    body.reference!==entry.reference||body.payloadSha256!==entry.payloadSha256
  )throw new Error('financial_journal_transaction_conflict');
  return {inserted:false};
}
async function touchMeta(client,revision,{cutoverRevision=null}={}){
  const count=await client.query('SELECT COUNT(*)::bigint AS count FROM game_zone_financial_journal');
  const entryCount=Number(count.rows[0]?.count||0);
  await client.query(`
    INSERT INTO game_zone_financial_journal_meta(id,cutover_revision,last_state_revision,entry_count,updated_at)
    VALUES(1,$1,$2,$3,NOW())
    ON CONFLICT(id) DO UPDATE SET
      last_state_revision=EXCLUDED.last_state_revision,
      entry_count=EXCLUDED.entry_count,
      updated_at=NOW()`,[cutoverRevision||revision,revision,entryCount]);
  return entryCount;
}
async function backfillFinancialJournal(client,db,revision,key){
  const existingRows=(await client.query('SELECT source_transaction_id FROM game_zone_financial_journal')).rows;
  const existing=new Set(existingRows.map(x=>String(x.source_transaction_id)));
  let inserted=0;
  for(const txn of db.transactions||[]){
    if(existing.has(String(txn.id)))continue;
    const entry=legacyJournalEntry(txn,key);
    const result=await insertEntry(client,entry,revision);
    if(result.inserted)inserted++;
  }
  await touchMeta(client,revision,{cutoverRevision:revision});
  return {inserted};
}
async function appendFinancialJournal(client,beforeDb,afterDb,revision,key){
  const entries=deriveFinancialMutations(beforeDb,afterDb,key);
  for(const entry of entries)await insertEntry(client,entry,revision);
  const entryCount=await touchMeta(client,revision);
  return {entries,entryCount};
}
async function verifyFinancialJournal(client,db,revision,key,{limit=10000}={}){
  const rows=(await client.query(`SELECT operation_key,source_transaction_id,subject_key,type,amount,balance_before,balance_after,currency,reference,payload_sha256,state_revision,legacy_backfill,entry_hmac FROM game_zone_financial_journal ORDER BY id DESC LIMIT $1`,[Math.max(1,Math.min(100000,Number(limit||10000)))] )).rows;
  const errors=[];
  const byTxn=new Map();
  for(const row of rows){
    const v=verifyJournalRow(row,key);
    if(!v.ok)errors.push({type:v.reason,sourceTransactionId:row.source_transaction_id});
    byTxn.set(String(row.source_transaction_id),row);
  }
  for(const txn of db.transactions||[]){
    const row=byTxn.get(String(txn.id));
    if(!row){errors.push({type:'financial_journal_transaction_missing',sourceTransactionId:String(txn.id)});continue;}
    const expected=transactionPayloadSha256(txn);
    if(String(row.payload_sha256)!==expected)errors.push({type:'financial_journal_payload_drift',sourceTransactionId:String(txn.id)});
  }
  const meta=(await client.query('SELECT cutover_revision,last_state_revision,entry_count,updated_at FROM game_zone_financial_journal_meta WHERE id=1')).rows[0]||null;
  const total=Number((await client.query('SELECT COUNT(*)::bigint AS count FROM game_zone_financial_journal')).rows[0]?.count||0);
  if(!meta)errors.push({type:'financial_journal_meta_missing'});
  else{
    if(Number(meta.entry_count)!==total)errors.push({type:'financial_journal_meta_count_drift',expected:total,actual:Number(meta.entry_count)});
    if(Number(meta.last_state_revision)!==Number(revision))errors.push({type:'financial_journal_revision_drift',expected:Number(revision),actual:Number(meta.last_state_revision)});
  }
  return {
    ok:errors.length===0,error:errors.length?'financial_journal_drift':null,errors,
    entryCount:total,currentStateTransactions:(db.transactions||[]).length,
    cutoverRevision:meta?Number(meta.cutover_revision):null,
    lastStateRevision:meta?Number(meta.last_state_revision):null,
    updatedAt:meta?.updated_at instanceof Date?meta.updated_at.toISOString():meta?.updated_at||null
  };
}

module.exports={
  transactionFingerprint,transactionPayloadSha256,subjectKey,operationKey,
  deriveFinancialMutations,legacyJournalEntry,verifyJournalRow,
  ensureFinancialJournalSchema,verifyFinancialJournalSchemaReadOnly,
  backfillFinancialJournal,appendFinancialJournal,touchMeta,verifyFinancialJournal
};
