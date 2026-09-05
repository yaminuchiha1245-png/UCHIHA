const crypto=require('node:crypto');
const {stableStringify}=require('./backupFormat');

const EPS=0.000001;
const ALLOWED_TYPES=new Set(['topup','refund','purchase','admin_credit','admin_debit']);

function money(value){return Number(Number(value||0).toFixed(6))}
function sha(value){return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}
function hmac(value,key){
  const secret=String(key||'');
  if(!secret)return null;
  return crypto.createHmac('sha256',secret).update(stableStringify(value)).digest('hex');
}
function walletKey(telegramId,key){
  const secret=String(key||'');
  if(!secret)return null;
  return crypto.createHmac('sha256',secret).update(`wallet:${String(telegramId||'')}`).digest('hex');
}
function accountBody({walletKey:wallet_key,balance,currency='USD',active=true,lastStateRevision=0}={}){
  return {
    walletKey:String(wallet_key||''),
    balance:money(balance),
    currency:String(currency||'USD'),
    active:!!active,
    lastStateRevision:Number(lastStateRevision||0)
  };
}
function accountHmac(body,key){return hmac(accountBody(body),key)}
function metaBody({cutoverRevision=0,lastStateRevision=0,accountCount=0,activeAccountCount=0,totalBalance=0,digest=''}={}){
  return {
    cutoverRevision:Number(cutoverRevision||0),
    lastStateRevision:Number(lastStateRevision||0),
    accountCount:Number(accountCount||0),
    activeAccountCount:Number(activeAccountCount||0),
    totalBalance:money(totalBalance),
    digest:String(digest||'')
  };
}
function metaHmac(body,key){return hmac(metaBody(body),key)}
function userMap(db={}){
  const out=new Map();
  for(const u of db.users||[])out.set(String(u.telegramId),u);
  return out;
}
function stateTransactionsByUser(beforeDb={},afterDb={}){
  const beforeIds=new Set((beforeDb.transactions||[]).map(x=>String(x.id)));
  const out=new Map();
  for(const txn of afterDb.transactions||[]){
    if(beforeIds.has(String(txn.id)))continue;
    const tid=String(txn.telegramId||'');
    if(!tid)throw new Error('wallet_authority_transaction_user_missing');
    if(!ALLOWED_TYPES.has(String(txn.type||'')))throw new Error('wallet_authority_transaction_type_unsupported');
    const amount=Number(txn.amount);
    if(!Number.isFinite(amount)||Math.abs(amount)<EPS)throw new Error('wallet_authority_transaction_amount_invalid');
    if(!out.has(tid))out.set(tid,[]);
    out.get(tid).push(txn);
  }
  return out;
}
function projectWalletAccounts(db={},key=''){
  const rows=[];
  for(const u of db.users||[]){
    const wk=walletKey(u.telegramId,key);
    if(!wk)throw new Error('wallet_authority_hmac_key_missing');
    rows.push({
      walletKey:wk,
      balance:money(u.balance),
      currency:String(u.currency||'USD'),
      active:true
    });
  }
  rows.sort((a,b)=>a.walletKey.localeCompare(b.walletKey));
  return rows;
}
function walletAuthoritySummary(db={},key=''){
  const rows=projectWalletAccounts(db,key);
  return {
    activeAccountCount:rows.length,
    totalBalance:money(rows.reduce((a,x)=>a+x.balance,0)),
    digest:sha(rows.map(x=>[x.walletKey,x.balance,x.currency]))
  };
}
function deriveWalletChanges(beforeDb={},afterDb={},key=''){
  const before=userMap(beforeDb),after=userMap(afterDb),newTxByUser=stateTransactionsByUser(beforeDb,afterDb);
  const ids=new Set([...before.keys(),...after.keys(),...newTxByUser.keys()]);
  const changes=[];
  for(const tid of ids){
    const b=before.get(tid)||null,a=after.get(tid)||null;
    const beforeBalance=b?money(b.balance):0,afterBalance=a?money(a.balance):0;
    const beforeCurrency=String(b?.currency||a?.currency||'USD'),afterCurrency=String(a?.currency||b?.currency||'USD');
    const txns=newTxByUser.get(tid)||[];
    const transactionDelta=money(txns.reduce((sum,x)=>sum+Number(x.amount||0),0));
    const balanceDelta=money(afterBalance-beforeBalance);
    if(!a&&Math.abs(beforeBalance)>EPS)throw new Error('wallet_authority_nonzero_account_deletion');
    if(Math.abs(balanceDelta-transactionDelta)>EPS){
      const e=new Error('wallet_authority_unexplained_balance_change');
      e.detail={beforeBalance,afterBalance,balanceDelta,transactionDelta,newTransactions:txns.map(x=>String(x.id))};
      throw e;
    }
    const presenceChanged=!!b!==!!a,currencyChanged=beforeCurrency!==afterCurrency;
    if(!presenceChanged&&!currencyChanged&&Math.abs(balanceDelta)<EPS)continue;
    const wk=walletKey(tid,key);
    if(!wk)throw new Error('wallet_authority_hmac_key_missing');
    changes.push({
      walletKey:wk,telegramId:tid,
      beforeExists:!!b,afterExists:!!a,
      beforeBalance,afterBalance,beforeCurrency,afterCurrency,
      transactionDelta,transactionIds:txns.map(x=>String(x.id))
    });
  }
  return changes;
}
function verifyAccountRow(row,key){
  if(!row)return {ok:false,reason:'wallet_authority_account_missing'};
  const body=accountBody({
    walletKey:row.wallet_key,balance:row.balance,currency:row.currency,
    active:row.active,lastStateRevision:row.last_state_revision
  });
  const expected=accountHmac(body,key);
  if(key&&!row.account_hmac)return {ok:false,reason:'wallet_authority_account_hmac_missing',body,expected};
  if(expected&&String(row.account_hmac)!==expected)return {ok:false,reason:'wallet_authority_account_hmac_mismatch',body,expected};
  return {ok:true,body,expected};
}
function verifyMetaRow(row,key){
  if(!row)return {ok:false,reason:'wallet_authority_meta_missing'};
  const body=metaBody({
    cutoverRevision:row.cutover_revision,lastStateRevision:row.last_state_revision,
    accountCount:row.account_count,activeAccountCount:row.active_account_count,
    totalBalance:row.total_balance,digest:row.digest
  });
  const expected=metaHmac(body,key);
  if(key&&!row.meta_hmac)return {ok:false,reason:'wallet_authority_meta_hmac_missing',body,expected};
  if(expected&&String(row.meta_hmac)!==expected)return {ok:false,reason:'wallet_authority_meta_hmac_mismatch',body,expected};
  return {ok:true,body,expected};
}

async function ensureWalletAuthoritySchema(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_wallet_accounts (
      wallet_key TEXT PRIMARY KEY,
      balance NUMERIC(18,6) NOT NULL,
      currency TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_state_revision BIGINT NOT NULL,
      account_hmac TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_gz_wallet_accounts_active ON game_zone_wallet_accounts(active)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_zone_wallet_authority_meta (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
      cutover_revision BIGINT NOT NULL,
      last_state_revision BIGINT NOT NULL,
      account_count BIGINT NOT NULL,
      active_account_count BIGINT NOT NULL,
      total_balance NUMERIC(18,6) NOT NULL,
      digest TEXT NOT NULL,
      meta_hmac TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
async function verifyWalletAuthoritySchemaReadOnly(client){
  await client.query('SELECT wallet_key,balance,currency,active,last_state_revision,account_hmac FROM game_zone_wallet_accounts LIMIT 0');
  await client.query('SELECT cutover_revision,last_state_revision,account_count,active_account_count,total_balance,digest,meta_hmac FROM game_zone_wallet_authority_meta WHERE id=1');
}
async function readWalletMeta(client){
  return (await client.query('SELECT cutover_revision,last_state_revision,account_count,active_account_count,total_balance,digest,meta_hmac,updated_at FROM game_zone_wallet_authority_meta WHERE id=1')).rows[0]||null;
}
async function writeMeta(client,db,revision,key,{cutoverRevision=null}={}){
  const expected=walletAuthoritySummary(db,key);
  const accountCount=Number((await client.query('SELECT COUNT(*)::bigint AS count FROM game_zone_wallet_accounts')).rows[0]?.count||0);
  const previous=await readWalletMeta(client);
  const body=metaBody({
    cutoverRevision:cutoverRevision??previous?.cutover_revision??revision,
    lastStateRevision:revision,
    accountCount,
    activeAccountCount:expected.activeAccountCount,
    totalBalance:expected.totalBalance,
    digest:expected.digest
  });
  await client.query(`
    INSERT INTO game_zone_wallet_authority_meta(
      id,cutover_revision,last_state_revision,account_count,active_account_count,total_balance,digest,meta_hmac,updated_at
    ) VALUES(1,$1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT(id) DO UPDATE SET
      cutover_revision=EXCLUDED.cutover_revision,last_state_revision=EXCLUDED.last_state_revision,
      account_count=EXCLUDED.account_count,active_account_count=EXCLUDED.active_account_count,
      total_balance=EXCLUDED.total_balance,digest=EXCLUDED.digest,meta_hmac=EXCLUDED.meta_hmac,updated_at=NOW()`,[
      body.cutoverRevision,body.lastStateRevision,body.accountCount,body.activeAccountCount,
      body.totalBalance,body.digest,metaHmac(body,key)
    ]);
  return body;
}
async function bootstrapWalletAuthority(client,db,revision,key){
  const meta=await readWalletMeta(client);
  if(meta)return {bootstrapped:false,cutoverRevision:Number(meta.cutover_revision)};
  const rows=projectWalletAccounts(db,key);
  for(const row of rows){
    const body=accountBody({...row,lastStateRevision:revision});
    await client.query(`
      INSERT INTO game_zone_wallet_accounts(wallet_key,balance,currency,active,last_state_revision,account_hmac,updated_at)
      VALUES($1,$2,$3,TRUE,$4,$5,NOW())
      ON CONFLICT(wallet_key) DO NOTHING`,[
      body.walletKey,body.balance,body.currency,body.lastStateRevision,accountHmac(body,key)
    ]);
  }
  await writeMeta(client,db,revision,key,{cutoverRevision:revision});
  return {bootstrapped:true,cutoverRevision:revision};
}
async function applyWalletAuthority(client,beforeDb,afterDb,revision,key){
  const meta=await readWalletMeta(client);
  if(!meta)throw new Error('wallet_authority_not_bootstrapped');
  const metaVerified=verifyMetaRow(meta,key);
  if(!metaVerified.ok)throw new Error(metaVerified.reason);
  const changes=deriveWalletChanges(beforeDb,afterDb,key);

  for(const change of changes){
    const current=(await client.query(`
      SELECT wallet_key,balance,currency,active,last_state_revision,account_hmac
      FROM game_zone_wallet_accounts WHERE wallet_key=$1 FOR UPDATE`,[change.walletKey])).rows[0]||null;

    if(change.beforeExists){
      const verified=verifyAccountRow(current,key);
      if(!verified.ok)throw new Error(verified.reason);
      if(!current.active)throw new Error('wallet_authority_account_inactive');
      if(Math.abs(money(current.balance)-change.beforeBalance)>EPS)throw new Error('wallet_authority_balance_conflict');
      if(String(current.currency||'USD')!==change.beforeCurrency)throw new Error('wallet_authority_currency_conflict');
    }else if(current){
      const verified=verifyAccountRow(current,key);
      if(!verified.ok)throw new Error(verified.reason);
      if(current.active)throw new Error('wallet_authority_unexpected_active_account');
      if(Math.abs(money(current.balance))>EPS)throw new Error('wallet_authority_reactivation_nonzero');
    }

    const authoritativeBefore=current?money(current.balance):0;
    const authoritativeAfter=money(authoritativeBefore+change.transactionDelta);
    if(Math.abs(authoritativeAfter-change.afterBalance)>EPS)throw new Error('wallet_authority_after_balance_conflict');

    const body=accountBody({
      walletKey:change.walletKey,
      balance:change.afterExists?authoritativeAfter:0,
      currency:change.afterCurrency,
      active:change.afterExists,
      lastStateRevision:revision
    });
    await client.query(`
      INSERT INTO game_zone_wallet_accounts(wallet_key,balance,currency,active,last_state_revision,account_hmac,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT(wallet_key) DO UPDATE SET
        balance=EXCLUDED.balance,currency=EXCLUDED.currency,active=EXCLUDED.active,
        last_state_revision=EXCLUDED.last_state_revision,account_hmac=EXCLUDED.account_hmac,updated_at=NOW()`,[
        body.walletKey,body.balance,body.currency,body.active,body.lastStateRevision,accountHmac(body,key)
      ]);
  }
  const body=await writeMeta(client,afterDb,revision,key);
  return {changes,meta:body};
}
async function replaceWalletAuthorityFromState(client,db,revision,key){
  const expected=projectWalletAccounts(db,key),keys=new Set(expected.map(x=>x.walletKey));
  const existing=(await client.query('SELECT wallet_key,balance,currency,active,last_state_revision,account_hmac FROM game_zone_wallet_accounts FOR UPDATE')).rows;
  for(const row of existing){
    if(keys.has(String(row.wallet_key)))continue;
    const body=accountBody({walletKey:row.wallet_key,balance:0,currency:row.currency||'USD',active:false,lastStateRevision:revision});
    await client.query(`UPDATE game_zone_wallet_accounts SET balance=0,active=FALSE,last_state_revision=$2,account_hmac=$3,updated_at=NOW() WHERE wallet_key=$1`,[
      body.walletKey,revision,accountHmac(body,key)
    ]);
  }
  for(const row of expected){
    const body=accountBody({...row,lastStateRevision:revision});
    await client.query(`
      INSERT INTO game_zone_wallet_accounts(wallet_key,balance,currency,active,last_state_revision,account_hmac,updated_at)
      VALUES($1,$2,$3,TRUE,$4,$5,NOW())
      ON CONFLICT(wallet_key) DO UPDATE SET
        balance=EXCLUDED.balance,currency=EXCLUDED.currency,active=TRUE,
        last_state_revision=EXCLUDED.last_state_revision,account_hmac=EXCLUDED.account_hmac,updated_at=NOW()`,[
        body.walletKey,body.balance,body.currency,revision,accountHmac(body,key)
      ]);
  }
  const previous=await readWalletMeta(client);
  await writeMeta(client,db,revision,key,{cutoverRevision:previous?.cutover_revision??revision});
  return {ok:true,activeAccounts:expected.length,revision};
}
async function verifyWalletAuthority(client,db,revision,key){
  const errors=[];
  const expectedRows=projectWalletAccounts(db,key),expectedMap=new Map(expectedRows.map(x=>[x.walletKey,x]));
  const actual=(await client.query(`
    SELECT wallet_key,balance,currency,active,last_state_revision,account_hmac
    FROM game_zone_wallet_accounts ORDER BY wallet_key`)).rows;
  const activeRows=actual.filter(x=>x.active===true),activeMap=new Map(activeRows.map(x=>[String(x.wallet_key),x]));

  for(const row of actual){
    const checked=verifyAccountRow(row,key);
    if(!checked.ok)errors.push({type:checked.reason,walletKey:String(row.wallet_key).slice(0,16)});
  }
  for(const [wk,expected] of expectedMap){
    const row=activeMap.get(wk);
    if(!row){errors.push({type:'wallet_authority_account_missing',walletKey:wk.slice(0,16)});continue;}
    if(Math.abs(money(row.balance)-expected.balance)>EPS)errors.push({type:'wallet_authority_balance_drift',walletKey:wk.slice(0,16),expected:expected.balance,actual:money(row.balance)});
    if(String(row.currency||'USD')!==expected.currency)errors.push({type:'wallet_authority_currency_drift',walletKey:wk.slice(0,16)});
  }
  for(const row of activeRows){
    if(!expectedMap.has(String(row.wallet_key)))errors.push({type:'wallet_authority_unexpected_active_account',walletKey:String(row.wallet_key).slice(0,16)});
  }

  const expectedSummary=walletAuthoritySummary(db,key),actualSummary={
    activeAccountCount:activeRows.length,
    totalBalance:money(activeRows.reduce((a,x)=>a+Number(x.balance||0),0)),
    digest:sha(activeRows.map(x=>[String(x.wallet_key),money(x.balance),String(x.currency||'USD')]))
  };
  if(expectedSummary.activeAccountCount!==actualSummary.activeAccountCount)errors.push({type:'wallet_authority_account_count_drift',expected:expectedSummary.activeAccountCount,actual:actualSummary.activeAccountCount});
  if(Math.abs(expectedSummary.totalBalance-actualSummary.totalBalance)>EPS)errors.push({type:'wallet_authority_total_balance_drift',expected:expectedSummary.totalBalance,actual:actualSummary.totalBalance});
  if(expectedSummary.digest!==actualSummary.digest)errors.push({type:'wallet_authority_digest_drift'});

  const meta=await readWalletMeta(client),metaChecked=verifyMetaRow(meta,key);
  if(!metaChecked.ok)errors.push({type:metaChecked.reason});
  else{
    const b=metaChecked.body;
    if(Number(b.lastStateRevision)!==Number(revision))errors.push({type:'wallet_authority_revision_drift',expected:Number(revision),actual:Number(b.lastStateRevision)});
    if(Number(b.activeAccountCount)!==actualSummary.activeAccountCount)errors.push({type:'wallet_authority_meta_active_count_drift'});
    if(Math.abs(money(b.totalBalance)-actualSummary.totalBalance)>EPS)errors.push({type:'wallet_authority_meta_total_drift'});
    if(String(b.digest)!==actualSummary.digest)errors.push({type:'wallet_authority_meta_digest_drift'});
  }
  return {
    ok:errors.length===0,
    error:errors.length?'wallet_authority_drift':null,
    errors,
    stateRevision:Number(revision),
    cutoverRevision:meta?Number(meta.cutover_revision):null,
    accountCount:actual.length,
    activeAccountCount:activeRows.length,
    totalBalance:actualSummary.totalBalance,
    digest:actualSummary.digest,
    updatedAt:meta?.updated_at instanceof Date?meta.updated_at.toISOString():meta?.updated_at||null
  };
}

module.exports={
  money,walletKey,accountBody,accountHmac,metaBody,metaHmac,
  projectWalletAccounts,walletAuthoritySummary,deriveWalletChanges,
  verifyAccountRow,verifyMetaRow,
  ensureWalletAuthoritySchema,verifyWalletAuthoritySchemaReadOnly,
  bootstrapWalletAuthority,applyWalletAuthority,replaceWalletAuthorityFromState,
  verifyWalletAuthority,readWalletMeta
};
