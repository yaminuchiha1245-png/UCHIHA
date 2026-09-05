const test=require('node:test');
const assert=require('node:assert/strict');
const {
  walletKey,accountBody,accountHmac,metaBody,metaHmac,
  projectWalletAccounts,walletAuthoritySummary,deriveWalletChanges,verifyAccountRow,verifyMetaRow
}=require('../lib/walletAuthority');

const key='wallet-authority-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function base(){
  return {
    users:[{telegramId:'100',balance:10,currency:'USD'},{telegramId:'200',balance:0,currency:'USD'}],
    transactions:[]
  };
}

test('wallet authority uses pseudonymous deterministic keys',()=>{
  const a=walletKey('100',key),b=walletKey('100',key),c=walletKey('200',key);
  assert.equal(a,b);assert.notEqual(a,c);assert.equal(a.length,64);
  assert.equal(a.includes('100'),false);
});

test('wallet account and meta HMACs change with financial values',()=>{
  const body=accountBody({walletKey:walletKey('100',key),balance:10,currency:'USD',active:true,lastStateRevision:7});
  const h1=accountHmac(body,key),h2=accountHmac({...body,balance:11},key);
  assert.equal(h1.length,64);assert.notEqual(h1,h2);
  const meta=metaBody({cutoverRevision:5,lastStateRevision:7,accountCount:2,activeAccountCount:2,totalBalance:10,digest:'abc'});
  assert.notEqual(metaHmac(meta,key),metaHmac({...meta,totalBalance:11},key));
});

test('wallet projection and summary are deterministic',()=>{
  const db=base(),rows=projectWalletAccounts(db,key),summary=walletAuthoritySummary(db,key);
  assert.equal(rows.length,2);assert.equal(summary.activeAccountCount,2);assert.equal(summary.totalBalance,10);assert.equal(summary.digest.length,64);
});

test('wallet authority accepts an explained balance mutation',()=>{
  const before=base(),after=base();
  after.users[0].balance=13;
  after.transactions.push({id:'txn1',telegramId:'100',type:'admin_credit',amount:3,currency:'USD',reference:'ADMIN'});
  const changes=deriveWalletChanges(before,after,key);
  assert.equal(changes.length,1);
  assert.equal(changes[0].beforeBalance,10);assert.equal(changes[0].afterBalance,13);assert.equal(changes[0].transactionDelta,3);
});

test('wallet authority rejects unexplained balances and nonzero account deletion',()=>{
  const before=base(),after=base();after.users[0].balance=12;
  assert.throws(()=>deriveWalletChanges(before,after,key),/wallet_authority_unexplained_balance_change/);
  const deleted=base();deleted.users=deleted.users.filter(x=>x.telegramId!=='100');
  assert.throws(()=>deriveWalletChanges(before,deleted,key),/wallet_authority_nonzero_account_deletion/);
});

test('zero-balance account deletion is representable as an inactive authority account',()=>{
  const before=base(),after=base();after.users=after.users.filter(x=>x.telegramId!=='200');
  const changes=deriveWalletChanges(before,after,key);
  assert.equal(changes.length,1);assert.equal(changes[0].beforeExists,true);assert.equal(changes[0].afterExists,false);assert.equal(changes[0].afterBalance,0);
});


test('wallet authority detects account-row HMAC tampering',()=>{
  const body=accountBody({walletKey:walletKey('100',key),balance:10,currency:'USD',active:true,lastStateRevision:9});
  const row={wallet_key:body.walletKey,balance:10,currency:'USD',active:true,last_state_revision:9,account_hmac:accountHmac(body,key)};
  assert.equal(verifyAccountRow(row,key).ok,true);
  assert.equal(verifyAccountRow({...row,balance:11},key).reason,'wallet_authority_account_hmac_mismatch');
});

test('wallet authority detects meta HMAC tampering',()=>{
  const body=metaBody({cutoverRevision:4,lastStateRevision:9,accountCount:2,activeAccountCount:2,totalBalance:10,digest:'abc'});
  const row={cutover_revision:4,last_state_revision:9,account_count:2,active_account_count:2,total_balance:10,digest:'abc',meta_hmac:metaHmac(body,key)};
  assert.equal(verifyMetaRow(row,key).ok,true);
  assert.equal(verifyMetaRow({...row,total_balance:12},key).reason,'wallet_authority_meta_hmac_mismatch');
});
