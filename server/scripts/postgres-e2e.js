try{require("dotenv").config();}catch{}
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const {Pool}=require("pg");
const {dataSha256,makeBackup}=require("../lib/backupFormat");
const {encodeBackupFile}=require("../lib/backupCrypto");

if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required for postgres-e2e");
process.env.STORAGE_DRIVER="postgres";
process.env.PG_SINGLE_INSTANCE_LOCK="true";
process.env.STORAGE_FAIL_FAST="false";
if(!process.env.DB_PATH){
  const seed=JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","db.json"),"utf8"));
  seed.users=seed.users||[];seed.orders=seed.orders||[];seed.topups=seed.topups||[];seed.transactions=seed.transactions||[];
  seed.users.push({id:"usr_pg_e2e",telegramId:"900001",username:"pg_e2e",firstName:"PG",lastName:"E2E",balance:0,currency:"USD",sessionVersion:1,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"});
  seed.orders.push({
    id:"ord_pg_e2e_seed",orderNo:"GZ-PG-E2E-1",telegramId:"900001",productId:"offer-starter",productName:"Seed Product",customerInput:"SEED",
    basePrice:0,discount:0,finalPrice:0,cost:0,profit:0,currency:"USD",status:"processing",
    providerPrimary:"manual",providerBackup:null,providerUsed:null,providerOrderId:null,requiresManualReview:false,
    couponCode:null,clientRequestId:"pg-e2e-seed-order",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"
  });
  seed.topups.push({
    id:"topup_pg_e2e_seed",telegramId:"900001",amount:10,currency:"USD",method:"manual",reference:null,
    clientRequestId:"pg-e2e-seed-topup",status:"pending",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"
  });
  const seedDir=fs.mkdtempSync(path.join(os.tmpdir(),"game-zone-pg-e2e-seed-"));
  process.env.DB_PATH=path.join(seedDir,"db.json");
  fs.writeFileSync(process.env.DB_PATH,JSON.stringify(seed,null,2));
}
process.env.PG_STATE_HISTORY_MAX=process.env.PG_STATE_HISTORY_MAX||"50";
process.env.PG_STATE_HISTORY_RETENTION_DAYS=process.env.PG_STATE_HISTORY_RETENTION_DAYS||"30";
process.env.PG_STATE_HISTORY_MIN_INTERVAL_SECONDS=process.env.PG_STATE_HISTORY_MIN_INTERVAL_SECONDS||"30";
process.env.PG_FINANCIAL_MIRROR="true";
process.env.PG_FINANCIAL_JOURNAL="true";
process.env.PG_WALLET_AUTHORITY="true";
process.env.PG_BUSINESS_AUTHORITY="true";
process.env.FINANCIAL_JOURNAL_HMAC_KEY=process.env.FINANCIAL_JOURNAL_HMAC_KEY||"postgres-e2e-financial-journal-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
process.env.WALLET_AUTHORITY_HMAC_KEY=process.env.WALLET_AUTHORITY_HMAC_KEY||"postgres-e2e-wallet-authority-cccccccccccccccccccccccccccccccc";
process.env.BUSINESS_AUTHORITY_HMAC_KEY=process.env.BUSINESS_AUTHORITY_HMAC_KEY||"postgres-e2e-business-authority-dddddddddddddddddddddddddddddddd";
process.env.STATE_HMAC_KEY=process.env.STATE_HMAC_KEY||"postgres-e2e-state-hmac-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.BACKUP_ENCRYPTION_KEY=process.env.BACKUP_ENCRYPTION_KEY||Buffer.alloc(32,44).toString("base64");
process.env.BACKUP_DIR=process.env.BACKUP_DIR||fs.mkdtempSync(path.join(os.tmpdir(),"game-zone-pg-e2e-backups-"));

const adminPool=new Pool({connectionString:process.env.DATABASE_URL});
let store=null;

function must(condition,message){if(!condition)throw new Error(message)}

(async()=>{
  await adminPool.query("DROP TABLE IF EXISTS game_zone_business_authority_meta");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_topup_authority");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_order_authority");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_wallet_authority_meta");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_wallet_accounts");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_financial_journal_meta");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_financial_journal");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_financial_mirror_meta");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_financial_topups");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_financial_transactions");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_financial_orders");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_financial_users");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_state_history");
  await adminPool.query("DROP TABLE IF EXISTS game_zone_state");

  store=require("../store");
  const init=await store.initStore();
  must(init.driver==="postgres"&&init.postgresConnected,"postgres_store_init_failed");
  must(init.singleInstanceLockAcquired===true,"postgres_writer_lock_missing");
  must(init.stateRevision===1,"initial_revision_must_be_1");
  must(/^[a-f0-9]{64}$/.test(String(init.stateDataSha256||"")),"initial_state_hash_missing");
  let walletAuthority=await store.verifyWalletAuthorityState();
  must(walletAuthority.ok&&Number(walletAuthority.stateRevision)===1,"wallet_authority_initial_verify_failed");
  let businessAuthority=await store.verifyBusinessAuthorityState();
  must(businessAuthority.ok&&Number(businessAuthority.stateRevision)===1&&businessAuthority.orderCount===1&&businessAuthority.topupCount===1,"business_authority_initial_verify_failed");

  let db=store.readDB();
  db.settings={...(db.settings||{}),postgresE2E:"mutation-one"};
  store.writeDB(db);
  await store.flushStore({throwOnError:true});
  let info=store.getStoreInfo();
  must(info.stateRevision===2,"first_persist_revision_wrong");
  // Age the first recovery point so the next mutation creates another retained history snapshot.
  await adminPool.query("UPDATE game_zone_state_history SET created_at=NOW()-INTERVAL '60 seconds'");

  db=store.readDB();
  db.settings.postgresE2E="mutation-two";
  store.writeDB(db);
  await store.flushStore({throwOnError:true});
  info=store.getStoreInfo();
  must(info.stateRevision===3,"second_persist_revision_wrong");

  const history=await store.listStoreHistory(10);
  must(history.some(x=>x.revision===1)&&history.some(x=>x.revision===2),"state_history_missing_revisions");
  must(history.every(x=>/^[a-f0-9]{64}$/.test(String(x.dataSha256||""))),"state_history_hash_missing");
  let historyVerify=await store.verifyStoreHistory(10);
  must(historyVerify.ok&&historyVerify.checked>=2,"state_history_verify_failed");

  // Recovery history corruption is detectable independently of the active state.
  const historyRow=await adminPool.query("SELECT data FROM game_zone_state_history WHERE revision=1");
  await adminPool.query("UPDATE game_zone_state_history SET data_sha256='broken-history-hash' WHERE revision=1");
  historyVerify=await store.verifyStoreHistory(10);
  must(historyVerify.ok===false&&historyVerify.errors.some(x=>x.revision===1),"history_corruption_not_detected");
  await adminPool.query("UPDATE game_zone_state_history SET data_sha256=$1 WHERE revision=1",[dataSha256(historyRow.rows[0].data)]);
  historyVerify=await store.verifyStoreHistory(10);
  must(historyVerify.ok===true,"history_hash_repair_verify_failed");

  let verify=await store.verifyPersistedState();
  must(verify.ok&&verify.revision===3,"persisted_state_verify_failed");
  let mirror=await store.verifyFinancialMirrorState();
  must(mirror.ok&&Number(mirror.actual.stateRevision)===3,"financial_mirror_initial_verify_failed");
  walletAuthority=await store.verifyWalletAuthorityState();
  must(walletAuthority.ok&&Number(walletAuthority.stateRevision)===3,"wallet_authority_revision3_failed");

  businessAuthority=await store.verifyBusinessAuthorityState();
  must(businessAuthority.ok&&Number(businessAuthority.stateRevision)===3,"business_authority_revision3_failed");
  const orderAuthorityRow=(await adminPool.query("SELECT * FROM game_zone_order_authority WHERE order_id='ord_pg_e2e_seed'")).rows[0];
  must(!!orderAuthorityRow&&String(orderAuthorityRow.subject_key)!=="900001","business_authority_subject_not_pseudonymous");
  await adminPool.query("UPDATE game_zone_order_authority SET status='completed' WHERE order_id='ord_pg_e2e_seed'");
  businessAuthority=await store.verifyBusinessAuthorityState();
  must(businessAuthority.ok===false&&businessAuthority.error==="business_authority_drift","business_authority_tamper_not_detected");
  await adminPool.query("UPDATE game_zone_order_authority SET status=$1,row_hmac=$2 WHERE order_id='ord_pg_e2e_seed'",[orderAuthorityRow.status,orderAuthorityRow.row_hmac]);
  businessAuthority=await store.verifyBusinessAuthorityState();
  must(businessAuthority.ok===true,"business_authority_tamper_repair_verify_failed");

  // Direct normalized-table drift must be detected against the trusted snapshot.
  await adminPool.query(`UPDATE game_zone_financial_users
    SET balance=balance+1
    WHERE telegram_id=(SELECT telegram_id FROM game_zone_financial_users ORDER BY telegram_id LIMIT 1)`);
  mirror=await store.verifyFinancialMirrorState();
  must(mirror.ok===false&&mirror.error==="financial_mirror_drift","financial_mirror_drift_not_detected");
  const rebuilt=await store.rebuildFinancialMirror();
  must(rebuilt.ok&&rebuilt.revision===3,"financial_mirror_rebuild_failed");
  mirror=await store.verifyFinancialMirrorState();
  must(mirror.ok===true,"financial_mirror_rebuild_verify_failed");

  // RC13: a legitimate balance mutation is accepted only with a matching new transaction,
  // and the pseudonymous HMAC-protected journal is committed atomically.
  let financial=store.readDB();
  const walletUser=financial.users[0];
  must(!!walletUser,"financial_journal_test_user_missing");
  const walletBefore=Number(walletUser.balance||0);
  walletUser.balance=Number((walletBefore+1).toFixed(6));
  financial.transactions.push({
    id:"txn_pg_e2e_journal_1",telegramId:String(walletUser.telegramId),type:"admin_credit",amount:1,
    currency:walletUser.currency||"USD",reference:"ADMIN",adminRequestId:"pg-e2e-journal-1",createdAt:new Date().toISOString()
  });
  store.writeDB(financial);
  await store.flushStore({throwOnError:true});
  info=store.getStoreInfo();
  must(info.stateRevision===4,"financial_journal_persist_revision_wrong");
  let journal=await store.verifyFinancialJournalState();
  must(journal.ok&&Number(journal.lastStateRevision)===4,"financial_journal_verify_failed");
  const journalRow=(await adminPool.query("SELECT * FROM game_zone_financial_journal WHERE source_transaction_id='txn_pg_e2e_journal_1'")).rows[0];
  must(!!journalRow&&journalRow.subject_key!==String(walletUser.telegramId),"financial_journal_subject_not_pseudonymous");
  must(Number(journalRow.balance_before)===walletBefore&&Number(journalRow.balance_after)===walletBefore+1,"financial_journal_balances_wrong");

  // RC13: the authoritative PostgreSQL wallet row must move with the same transaction/revision.
  walletAuthority=await store.verifyWalletAuthorityState();
  must(walletAuthority.ok&&Number(walletAuthority.stateRevision)===4,"wallet_authority_financial_mutation_failed");
  const authorityRow=(await adminPool.query("SELECT * FROM game_zone_wallet_accounts WHERE active=TRUE ORDER BY wallet_key LIMIT 1")).rows[0];
  must(!!authorityRow&&Number(authorityRow.balance)===walletBefore+1,"wallet_authority_balance_wrong");
  must(String(authorityRow.wallet_key)!==String(walletUser.telegramId),"wallet_authority_raw_telegram_id_exposed");

  // Direct wallet-authority tampering is independently detected by account HMAC + state comparison.
  await adminPool.query("UPDATE game_zone_wallet_accounts SET balance=balance+7 WHERE wallet_key=$1",[authorityRow.wallet_key]);
  walletAuthority=await store.verifyWalletAuthorityState();
  must(walletAuthority.ok===false&&walletAuthority.error==="wallet_authority_drift","wallet_authority_tamper_not_detected");
  await adminPool.query("UPDATE game_zone_wallet_accounts SET balance=$1,account_hmac=$2 WHERE wallet_key=$3",[authorityRow.balance,authorityRow.account_hmac,authorityRow.wallet_key]);
  walletAuthority=await store.verifyWalletAuthorityState();
  must(walletAuthority.ok===true,"wallet_authority_tamper_repair_verify_failed");

  // A silent balance edit is rejected synchronously before it can replace in-memory state.
  const unexplained=store.readDB();
  unexplained.users[0].balance=Number(unexplained.users[0].balance)+1;
  let guardBlocked=false;
  try{store.writeDB(unexplained)}catch(e){guardBlocked=e.message==="financial_balance_change_unjournaled"}
  must(guardBlocked,"unexplained_balance_change_not_blocked");
  must(Number(store.readDB().users[0].balance)===walletBefore+1,"guard_changed_in_memory_state");

  // Direct journal tampering is detected by the dedicated journal HMAC.
  await adminPool.query("UPDATE game_zone_financial_journal SET amount=amount+1 WHERE source_transaction_id='txn_pg_e2e_journal_1'");
  journal=await store.verifyFinancialJournalState();
  must(journal.ok===false&&journal.errors.some(x=>x.type==="financial_journal_hmac_mismatch"),"financial_journal_hmac_tamper_not_detected");
  await adminPool.query("UPDATE game_zone_financial_journal SET amount=$1,entry_hmac=$2 WHERE source_transaction_id='txn_pg_e2e_journal_1'",[journalRow.amount,journalRow.entry_hmac]);
  journal=await store.verifyFinancialJournalState();
  must(journal.ok===true,"financial_journal_tamper_repair_verify_failed");

  // A second active Server writer must fail while this process owns the advisory lock.
  const blocked=spawnSync(process.execPath,["scripts/postgres-lock-probe.js"],{
    cwd:path.join(__dirname,".."),env:{...process.env},encoding:"utf8",timeout:15000
  });
  must(blocked.status===23&&/another_game_zone_server_is_active/.test(blocked.stderr),"second_writer_was_not_blocked");

  // Roll back to revision 1 while preserving monotonic active revision numbering.
  const rollback=await store.rollbackStoreRevision(1,{confirmation:"ROLLBACK_TO_REVISION_1"});
  must(rollback.restoredFromRevision===1&&rollback.newRevision===5,"state_rollback_revision_wrong");
  must(store.readDB().settings?.postgresE2E===undefined,"state_rollback_data_wrong");

  verify=await store.verifyPersistedState();
  must(verify.ok&&verify.revision===5,"rollback_readback_verify_failed");
  mirror=await store.verifyFinancialMirrorState();
  must(mirror.ok&&Number(mirror.actual.stateRevision)===5,"rollback_financial_mirror_not_aligned");
  walletAuthority=await store.verifyWalletAuthorityState();
  must(walletAuthority.ok&&Number(walletAuthority.stateRevision)===5,"rollback_wallet_authority_not_aligned");
  businessAuthority=await store.verifyBusinessAuthorityState();
  must(businessAuthority.ok&&Number(businessAuthority.stateRevision)===5,"rollback_business_authority_not_aligned");

  // Simulate out-of-band checksum corruption and ensure verification detects it.
  await adminPool.query("UPDATE game_zone_state SET data_sha256='corrupted-hash' WHERE id=1");
  const broken=await store.verifyPersistedState();
  must(broken.ok===false&&broken.error==="postgres_state_integrity_mismatch","state_hash_corruption_not_detected");

  const current=await adminPool.query("SELECT data FROM game_zone_state WHERE id=1");
  const repairedHash=dataSha256(current.rows[0].data);
  await adminPool.query("UPDATE game_zone_state SET data_sha256=$1 WHERE id=1",[repairedHash]);
  verify=await store.verifyPersistedState();
  must(verify.ok===true&&verify.hmacVerified===true,"state_hash_repair_verify_failed");

  // Simulate a stronger tamper: change data and its plain SHA together, but not the server-secret HMAC.
  const beforeTamper=await adminPool.query("SELECT data,data_sha256,data_hmac FROM game_zone_state WHERE id=1");
  const malicious=JSON.parse(JSON.stringify(beforeTamper.rows[0].data));
  malicious.settings={...(malicious.settings||{}),maliciousDbEdit:true};
  await adminPool.query("UPDATE game_zone_state SET data=$1::jsonb,data_sha256=$2 WHERE id=1",[JSON.stringify(malicious),dataSha256(malicious)]);
  const hmacBroken=await store.verifyPersistedState();
  must(hmacBroken.ok===false&&hmacBroken.error==="postgres_state_hmac_mismatch","state_hmac_tamper_not_detected");
  await adminPool.query("UPDATE game_zone_state SET data=$1::jsonb,data_sha256=$2,data_hmac=$3 WHERE id=1",[
    JSON.stringify(beforeTamper.rows[0].data),beforeTamper.rows[0].data_sha256,beforeTamper.rows[0].data_hmac
  ]);
  verify=await store.verifyPersistedState();
  must(verify.ok===true&&verify.hmacVerified===true,"state_hmac_repair_verify_failed");

  await store.closeStore();

  // Disaster recovery path: corrupt the active HMAC while the Server is down,
  // then restore a verified historical revision using the standalone recovery CLI.
  const afterClose=await adminPool.query("SELECT data FROM game_zone_state WHERE id=1");
  const corruptAfterClose=JSON.parse(JSON.stringify(afterClose.rows[0].data));
  corruptAfterClose.settings={...(corruptAfterClose.settings||{}),corruptAfterClose:true};
  await adminPool.query("UPDATE game_zone_state SET data=$1::jsonb,data_sha256=$2,data_hmac='invalid-hmac' WHERE id=1",[
    JSON.stringify(corruptAfterClose),dataSha256(corruptAfterClose)
  ]);
  const recovery=spawnSync(process.execPath,["scripts/state-rollback.js","2","ROLLBACK_TO_REVISION_2"],{
    cwd:path.join(__dirname,".."),
    env:{...process.env,ALLOW_STATE_ROLLBACK:"true",STORAGE_DRIVER:"postgres",PG_SINGLE_INSTANCE_LOCK:"true"},
    encoding:"utf8",timeout:20000
  });
  must(recovery.status===0,`direct_state_recovery_failed:${recovery.stderr||recovery.stdout}`);
  const recovered=await adminPool.query("SELECT data,revision,data_sha256,data_hmac FROM game_zone_state WHERE id=1");
  must(Number(recovered.rows[0].revision)===6,"direct_recovery_revision_wrong");
  must(recovered.rows[0].data.settings?.postgresE2E==="mutation-one","direct_recovery_data_wrong");
  let walletMeta=(await adminPool.query("SELECT last_state_revision FROM game_zone_wallet_authority_meta WHERE id=1")).rows[0];
  must(Number(walletMeta?.last_state_revision)===6,"direct_recovery_wallet_authority_revision_wrong");
  let businessMeta=(await adminPool.query("SELECT last_state_revision FROM game_zone_business_authority_meta WHERE id=1")).rows[0];
  must(Number(businessMeta?.last_state_revision)===6,"direct_recovery_business_authority_revision_wrong");

  // Full backup restore must also recover a corrupted active PostgreSQL row without booting the normal store.
  const restoreTarget=JSON.parse(JSON.stringify(recovered.rows[0].data));
  restoreTarget.settings={...(restoreTarget.settings||{}),postgresRestoreE2E:"restored"};
  const incomingFile=path.join(process.env.BACKUP_DIR,"incoming-postgres-e2e.json");
  fs.writeFileSync(incomingFile,JSON.stringify(encodeBackupFile(makeBackup(restoreTarget,{version:"1.0.0-rc.20"})),null,2));
  const corruptForRestore=JSON.parse(JSON.stringify(recovered.rows[0].data));
  corruptForRestore.settings={...(corruptForRestore.settings||{}),corruptBeforeRestore:true};
  await adminPool.query("UPDATE game_zone_state SET data=$1::jsonb,data_sha256=$2,data_hmac='invalid-hmac-again' WHERE id=1",[
    JSON.stringify(corruptForRestore),dataSha256(corruptForRestore)
  ]);
  const restore=spawnSync(process.execPath,["scripts/restore.js",incomingFile],{
    cwd:path.join(__dirname,".."),
    env:{...process.env,ALLOW_RESTORE:"true",STORAGE_DRIVER:"postgres",PG_SINGLE_INSTANCE_LOCK:"true"},
    encoding:"utf8",timeout:20000
  });
  must(restore.status===0,`direct_postgres_restore_failed:${restore.stderr||restore.stdout}`);
  const restored=await adminPool.query("SELECT data,revision,data_sha256,data_hmac FROM game_zone_state WHERE id=1");
  must(Number(restored.rows[0].revision)===7,"direct_restore_revision_wrong");
  must(restored.rows[0].data.settings?.postgresRestoreE2E==="restored","direct_restore_data_wrong");
  const mirrorMeta=await adminPool.query("SELECT state_revision FROM game_zone_financial_mirror_meta WHERE id=1");
  must(Number(mirrorMeta.rows[0]?.state_revision)===7,"restore_financial_mirror_revision_wrong");
  walletMeta=(await adminPool.query("SELECT last_state_revision FROM game_zone_wallet_authority_meta WHERE id=1")).rows[0];
  must(Number(walletMeta?.last_state_revision)===7,"restore_wallet_authority_revision_wrong");
  businessMeta=(await adminPool.query("SELECT last_state_revision FROM game_zone_business_authority_meta WHERE id=1")).rows[0];
  must(Number(businessMeta?.last_state_revision)===7,"restore_business_authority_revision_wrong");

  // Exclusive CLI rebuild repairs normalized drift without changing the active state revision.
  await adminPool.query(`UPDATE game_zone_financial_transactions
    SET payload_sha256='tampered-mirror-hash'
    WHERE id=(SELECT id FROM game_zone_financial_transactions ORDER BY id LIMIT 1)`);
  const mirrorRebuild=spawnSync(process.execPath,["scripts/financial-mirror-rebuild.js"],{
    cwd:path.join(__dirname,".."),
    env:{...process.env,ALLOW_FINANCIAL_MIRROR_REBUILD:"true",STORAGE_DRIVER:"postgres",PG_SINGLE_INSTANCE_LOCK:"true"},
    encoding:"utf8",timeout:20000
  });
  must(mirrorRebuild.status===0,`financial_mirror_cli_rebuild_failed:${mirrorRebuild.stderr||mirrorRebuild.stdout}`);
  const afterMirrorRebuild=await adminPool.query("SELECT revision FROM game_zone_state WHERE id=1");
  must(Number(afterMirrorRebuild.rows[0].revision)===7,"financial_mirror_rebuild_changed_state_revision");

  // The lock must be released after recovery and a new writer can start.
  const allowed=spawnSync(process.execPath,["scripts/postgres-lock-probe.js"],{
    cwd:path.join(__dirname,".."),env:{...process.env},encoding:"utf8",timeout:15000
  });
  must(allowed.status===0,`writer_lock_not_released:${allowed.stderr||allowed.stdout}`);

  console.log("Game Zone PostgreSQL E2E PASS");
  console.log("Verified: state SHA/HMAC and revisions, normalized financial mirror drift/rebuild, pseudonymous immutable financial journal, authoritative HMAC-protected wallet rows, HMAC-protected order/top-up authority, unexplained-balance blocking, wallet/journal/business-authority tamper detection, retained-history recovery, second-writer exclusion, corrupt-state rollback/restore, and graceful advisory-lock release.");
})().catch(async e=>{
  console.error(e.stack||e);
  try{if(store)await store.closeStore()}catch{}
  process.exitCode=1;
}).finally(async()=>{
  try{await adminPool.end()}catch{}
});
