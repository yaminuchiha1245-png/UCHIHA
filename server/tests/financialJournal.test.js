const test=require('node:test');
const assert=require('node:assert/strict');
const {
  transactionPayloadSha256,subjectKey,deriveFinancialMutations,
  legacyJournalEntry,verifyJournalRow
}=require('../lib/financialJournal');

const key='financial-journal-hmac-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function db(balance=10,transactions=[]){return {users:[{telegramId:'123',balance,currency:'USD'}],transactions}}

test('financial journal derives a purchase from balance delta plus transaction',()=>{
  const txn={id:'t1',telegramId:'123',type:'purchase',amount:-3,currency:'USD',reference:'GZ-1',createdAt:'2026-08-30T00:00:00.000Z'};
  const rows=deriveFinancialMutations(db(10,[]),db(7,[txn]),key);
  assert.equal(rows.length,1);
  assert.equal(rows[0].balanceBefore,10);
  assert.equal(rows[0].balanceAfter,7);
  assert.equal(rows[0].subjectKey,subjectKey('t1',key));
  assert.equal(rows[0].entryHmac.length,64);
});

test('financial journal rejects a balance mutation without a new ledger transaction',()=>{
  assert.throws(()=>deriveFinancialMutations(db(10,[]),db(9,[]),key),/financial_balance_change_unjournaled/);
});

test('financial journal rejects a transaction that does not explain the balance delta',()=>{
  const txn={id:'t1',telegramId:'123',type:'admin_debit',amount:-2,currency:'USD',reference:'ADMIN'};
  assert.throws(()=>deriveFinancialMutations(db(10,[]),db(9,[txn]),key),/financial_balance_change_unjournaled/);
});

test('transaction fingerprint deliberately ignores direct account identifier rewrites',()=>{
  const a={id:'t1',telegramId:'123',type:'refund',amount:5,currency:'USD',reference:'GZ-1'};
  const b={...a,telegramId:'anon_deleted'};
  assert.equal(transactionPayloadSha256(a),transactionPayloadSha256(b));
});

test('journal HMAC detects row tampering',()=>{
  const txn={id:'t1',telegramId:'123',type:'topup',amount:5,currency:'USD',reference:'tp1'};
  const entry=legacyJournalEntry(txn,key);
  const row={
    operation_key:entry.operationKey,source_transaction_id:entry.sourceTransactionId,
    subject_key:entry.subjectKey,type:entry.type,amount:entry.amount,
    balance_before:null,balance_after:null,currency:entry.currency,reference:entry.reference,
    payload_sha256:entry.payloadSha256,legacy_backfill:true,entry_hmac:entry.entryHmac
  };
  assert.equal(verifyJournalRow(row,key).ok,true);
  row.amount=6;
  assert.equal(verifyJournalRow(row,key).reason,'financial_journal_hmac_mismatch');
});

test('zero-balance account removal is not treated as money movement',()=>{
  const before={users:[{telegramId:'123',balance:0,currency:'USD'}],transactions:[]};
  const after={users:[],transactions:[]};
  assert.deepEqual(deriveFinancialMutations(before,after,key),[]);
});
