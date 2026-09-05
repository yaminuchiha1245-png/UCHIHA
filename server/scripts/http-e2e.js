const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {spawn}=require("node:child_process");

const root=path.join(__dirname,"..");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function makeTelegramInitData(botToken,user){
  const params=new URLSearchParams();
  params.set("auth_date",String(Math.floor(Date.now()/1000)));
  params.set("query_id","AAE2E");
  params.set("user",JSON.stringify(user));
  const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=crypto.createHmac("sha256","WebAppData").update(botToken).digest();
  params.set("hash",crypto.createHmac("sha256",secret).update(check).digest("hex"));
  return params.toString();
}

async function json(baseUrl,url,{method="GET",token,headers={},body}={}){
  const r=await fetch(baseUrl+url,{
    method,
    headers:{
      ...(body!==undefined?{"content-type":"application/json"}:{}),
      ...(token?{authorization:`Bearer ${token}`}:{ }),
      ...headers
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const data=await r.json().catch(()=>({}));
  return {status:r.status,ok:r.ok,data,headers:r.headers};
}

async function waitFor(baseUrl,url,timeoutMs=15000){
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){
    try{const r=await fetch(baseUrl+url);if(r.ok)return;}catch{}
    await sleep(100);
  }
  throw new Error(`timeout_waiting_for:${url}`);
}

async function main(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"game-zone-http-e2e-"));
  const dbPath=path.join(tmp,"db.json"),backupDir=path.join(tmp,"backups");
  fs.copyFileSync(path.join(root,"data","db.json"),dbPath);
  const port=33000+crypto.randomInt(1000);
  const baseUrl=`http://127.0.0.1:${port}`;
  const botToken=["123456","TEST_BOT_TOKEN_FOR_E2E_ONLY"].join(":");
  const keyA=Buffer.alloc(32,31).toString("base64");
  const keyB=Buffer.alloc(32,32).toString("base64");
  const env={
    ...process.env,
    NODE_ENV:"development",
    PORT:String(port),
    STORAGE_DRIVER:"json",
    DB_PATH:dbPath,
    BACKUP_DIR:backupDir,
    BOT_TOKEN:botToken,
    BOT_USERNAME:"GameZoneE2EBot",
    INTERNAL_BOT_SECRET:"e2e-internal-bot-secret-aaaaaaaa",
    INTERNAL_BOT_ADMIN_SECRET:"e2e-bot-admin-secret-bbbbbbbbbbbb",
    ADMIN_PASSWORD:"e2e-admin-password-strong",
    ADMIN_SESSION_SECRET:"e2e-admin-session-cccccccccccccccccccc",
    USER_SESSION_SECRET:"e2e-user-session-ddddddddddddddddddd",
    PAYMENT_WEBHOOK_SECRET:"e2e-payment-webhook-eeeeeeeeeeeeeeee",
    PROVIDER_WEBHOOK_SECRET:"e2e-provider-webhook-ffffffffffffffff",
    AUDIT_HMAC_KEY:"e2e-audit-hmac-gggggggggggggggggggggggggggggggg",
    INVENTORY_ENCRYPTION_KEY:keyA,
    BACKUP_ENCRYPTION_KEY:keyB,
    PUBLIC_BASE_URL:baseUrl,
    ALLOWED_ORIGINS:baseUrl,
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS:"3600"
  };

  const child=spawn(process.execPath,["server.js"],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let logs="";
  child.stdout.on("data",d=>logs+=d);
  child.stderr.on("data",d=>logs+=d);

  try{
    await waitFor(baseUrl,"/api/health/live");

    let r=await json(baseUrl,"/api/health/live");
    if(!r.ok||r.data.ok!==true)throw new Error("health_live_failed");
    r=await json(baseUrl,"/api/health/ready");
    if(!r.ok||r.data.ok!==true)throw new Error("health_ready_failed");

    const telegramId="9001001";
    const initData=makeTelegramInitData(botToken,{id:Number(telegramId),username:"gamezone_e2e",first_name:"E2E"});
    r=await json(baseUrl,"/api/auth/telegram",{method:"POST",body:{initData}});
    if(!r.ok||!r.data.sessionToken)throw new Error(`telegram_auth_failed:${r.status}`);
    const userToken=r.data.sessionToken;

    const botReadHeaders={"x-bot-secret":env.INTERNAL_BOT_SECRET};
    r=await json(baseUrl,`/api/me?telegramId=${telegramId}`,{headers:botReadHeaders});
    if(!r.ok||String(r.data.telegramId)!==telegramId)throw new Error("bot_customer_read_failed");
    r=await json(baseUrl,"/api/orders",{method:"POST",headers:botReadHeaders,body:{telegramId,productId:"offer-starter",customerInput:"BOT-IMPERSONATION",clientRequestId:"bot-must-not-buy"}});
    if(r.status!==403||r.data.error!=="bot_customer_mutation_forbidden")throw new Error("bot_customer_mutation_not_blocked");

    r=await json(baseUrl,"/api/admin/login",{method:"POST",body:{password:env.ADMIN_PASSWORD}});
    if(!r.ok||!r.data.token)throw new Error(`admin_login_failed:${r.status}`);
    const adminToken=r.data.token;

    const automationHeaders={
      "x-bot-secret":env.INTERNAL_BOT_SECRET,
      "x-bot-admin-secret":env.INTERNAL_BOT_ADMIN_SECRET
    };
    r=await json(baseUrl,"/api/admin/dashboard",{headers:automationHeaders});
    if(!r.ok)throw new Error("automation_dashboard_access_failed");
    r=await json(baseUrl,"/api/admin/broadcast",{method:"POST",headers:automationHeaders,body:{title:"E2E",message:"must require confirmation",audience:"all"}});
    if(r.status!==400||r.data.error!=="broadcast_confirmation_required")throw new Error("broadcast_backend_confirmation_missing");
    r=await json(baseUrl,"/api/admin/backup",{headers:automationHeaders});
    if(r.status!==403||r.data.error!=="admin_automation_forbidden")throw new Error("automation_owner_route_not_blocked");
    r=await json(baseUrl,"/api/admin/storage/financial-mirror",{headers:automationHeaders});
    if(r.status!==403||r.data.error!=="admin_automation_forbidden")throw new Error("automation_financial_mirror_route_not_blocked");
    r=await json(baseUrl,"/api/admin/storage/financial-journal",{headers:automationHeaders});
    if(r.status!==403||r.data.error!=="admin_automation_forbidden")throw new Error("automation_financial_journal_route_not_blocked");
    r=await json(baseUrl,"/api/admin/storage/wallet-authority",{headers:automationHeaders});
    if(r.status!==403||r.data.error!=="admin_automation_forbidden")throw new Error("automation_wallet_authority_route_not_blocked");
    r=await json(baseUrl,"/api/admin/storage/business-authority",{headers:automationHeaders});
    if(r.status!==403||r.data.error!=="admin_automation_forbidden")throw new Error("automation_business_authority_route_not_blocked");

    const creditRequest="e2e-credit-1";
    r=await json(baseUrl,`/api/admin/users/${telegramId}/balance`,{method:"POST",token:adminToken,body:{amount:20,clientRequestId:creditRequest}});
    if(!r.ok||Number(r.data.user?.balance)!==20)throw new Error("admin_credit_failed");
    r=await json(baseUrl,`/api/admin/users/${telegramId}/balance`,{method:"POST",token:adminToken,body:{amount:20,clientRequestId:creditRequest}});
    if(!r.ok||r.data.idempotent!==true||Number(r.data.user?.balance)!==20)throw new Error("admin_credit_idempotency_failed");

    const orderRequest="e2e-order-1";
    const orderBody={productId:"offer-starter",customerInput:"E2E-ACCOUNT",couponCode:"",clientRequestId:orderRequest};
    r=await json(baseUrl,"/api/orders",{method:"POST",token:userToken,body:orderBody});
    if(!r.ok||!r.data.order?.orderNo)throw new Error(`order_create_failed:${r.status}:${JSON.stringify(r.data)}`);
    const orderNo=r.data.order.orderNo;
    const balanceAfterOrder=Number(r.data.balance);

    r=await json(baseUrl,"/api/orders",{method:"POST",token:userToken,body:orderBody});
    if(!r.ok||r.data.idempotent!==true||r.data.order?.orderNo!==orderNo||Number(r.data.balance)!==balanceAfterOrder)throw new Error("order_idempotency_failed");

    r=await json(baseUrl,"/api/orders",{method:"POST",token:userToken,body:{...orderBody,customerInput:"DIFFERENT"}});
    if(r.status!==409||r.data.error!=="idempotency_conflict")throw new Error("order_idempotency_conflict_missing");

    r=await json(baseUrl,`/api/orders/${encodeURIComponent(orderNo)}/cancel`,{method:"POST",token:userToken,body:{}});
    if(!r.ok||Number(r.data.balance)!==20)throw new Error(`order_cancel_refund_failed:${JSON.stringify(r.data)}`);

    const topupBody={amount:5,method:"manual",reference:"E2E-TX-001",clientRequestId:"e2e-topup-1"};
    r=await json(baseUrl,"/api/wallet/topup-intents",{method:"POST",token:userToken,body:topupBody});
    if(!r.ok||!r.data.topup?.id)throw new Error("topup_create_failed");
    const topupId=r.data.topup.id;

    r=await json(baseUrl,`/api/admin/topups/${encodeURIComponent(topupId)}/approve`,{method:"POST",headers:automationHeaders,body:{}});
    if(r.status!==400||r.data.error!=="topup_approval_confirmation_required")throw new Error("automation_topup_backend_confirmation_missing");

    r=await json(baseUrl,"/api/wallet/topup-intents",{method:"POST",token:userToken,body:topupBody});
    if(!r.ok||r.data.idempotent!==true||r.data.topup?.id!==topupId)throw new Error("topup_idempotency_failed");

    r=await json(baseUrl,"/api/wallet/topup-intents",{method:"POST",token:userToken,body:{...topupBody,clientRequestId:"e2e-topup-2"}});
    if(r.status!==409||r.data.error!=="payment_reference_already_used")throw new Error("duplicate_payment_reference_not_blocked");

    const paymentHeaders={"x-payment-webhook-secret":env.PAYMENT_WEBHOOK_SECRET};
    r=await json(baseUrl,"/api/payment-webhook/manual",{method:"POST",headers:paymentHeaders,body:{topupId,status:"paid",amount:5,reference:"E2E-TX-001"}});
    if(!r.ok||r.data.idempotent!==false)throw new Error(`payment_webhook_failed:${JSON.stringify(r.data)}`);
    r=await json(baseUrl,"/api/payment-webhook/manual",{method:"POST",headers:paymentHeaders,body:{topupId,status:"paid",amount:5,reference:"E2E-TX-001"}});
    if(!r.ok||r.data.idempotent!==true)throw new Error("payment_webhook_replay_failed");

    r=await json(baseUrl,"/api/me",{token:userToken});
    if(!r.ok||Number(r.data.balance)!==25)throw new Error(`wallet_final_balance_wrong:${JSON.stringify(r.data)}`);

    // Account deletion must never silently destroy a non-zero customer wallet.
    r=await json(baseUrl,"/api/me/delete",{method:"POST",token:userToken,body:{confirmation:"DELETE"}});
    if(r.status!==409||r.data.error!=="balance_must_be_zero_before_deletion")throw new Error("nonzero_wallet_account_deletion_not_blocked");

    r=await json(baseUrl,"/api/admin/backup",{token:adminToken});
    if(!r.ok||r.data.format!=="game-zone-encrypted-backup"||r.headers.get("x-game-zone-backup-encrypted")!=="yes")throw new Error("admin_encrypted_backup_failed");

    r=await json(baseUrl,"/api/me/sessions/revoke-all",{method:"POST",token:userToken,body:{confirmation:"REVOKE_ALL_USER_SESSIONS"}});
    if(!r.ok||r.data.reauthRequired!==true)throw new Error("customer_session_revoke_failed");
    r=await json(baseUrl,"/api/me",{token:userToken});
    if(r.status!==401||r.data.error!=="user_session_revoked")throw new Error("revoked_customer_token_still_valid");

    r=await json(baseUrl,"/api/admin/session/revoke-all",{method:"POST",token:adminToken,body:{confirmation:"REVOKE_ALL_ADMIN_SESSIONS"}});
    if(!r.ok||r.data.reauthRequired!==true)throw new Error("admin_session_revoke_failed");
    r=await json(baseUrl,"/api/admin/dashboard",{token:adminToken});
    if(r.status!==401||r.data.error!=="admin_session_revoked")throw new Error("revoked_admin_token_still_valid");

    console.log("Game Zone HTTP E2E PASS");
    console.log("Verified: health, Telegram auth, Bot read-only customer scope, Admin auth, least-privilege Bot automation/broadcast confirmation, wallet idempotency, order idempotency/conflict/cancel refund, top-up reference/idempotency/backend confirmation, payment webhook replay, non-zero-wallet deletion protection, encrypted Admin backup, customer/Admin session revocation.");
  }finally{
    if(child.exitCode===null)child.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve=>child.once("exit",resolve)),
      sleep(12000).then(()=>{if(child.exitCode===null)child.kill("SIGKILL")})
    ]);
    if(child.exitCode!==0&&child.signalCode!=="SIGTERM"){
      console.error(logs);
    }
  }
}

main().catch(e=>{console.error(e.stack||e);process.exit(1)});
