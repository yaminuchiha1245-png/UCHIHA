#!/usr/bin/env python3
from __future__ import annotations
import hashlib, hmac, http.cookiejar, json, os, secrets, socket, socketserver, sqlite3, stat, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE=Path(__file__).resolve().parent
BACKEND=HERE/'RADIUS-A-Connector-Backend-v37.py'
PORT=18838
TOKEN='mikrotik-token-super-private'
VOUCHER_TOKEN='voucher-token-super-private'
BACKUP_TOKEN='offhost-backup-token-super-private'
LOG_TOKEN='remote-log-token-super-private-987654321'
RADIUS_SECRET_VALUE='radius-secret-super-private'
GATEWAY_HMAC_SECRET='gateway-hmac-current-super-private-2026'
GATEWAY_HMAC_PREVIOUS_SECRET='gateway-hmac-previous-super-private-2025'
GATEWAY_LEGACY_KEY='legacy-gateway-static-key-private'

class SilentTCP(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            self.request.settimeout(.2); self.request.recv(1)
        except Exception: pass

class Gateway(BaseHTTPRequestHandler):
    events=[]
    log_batches=[]
    log_fail_remaining=0
    delay_next=0.0
    voucher_return_codes=False
    backup_wrong_sha=False
    def log_message(self,*a): pass
    def do_HEAD(self):
        self.send_response(401); self.send_header('Content-Length','0'); self.end_headers()
    def do_POST(self):
        length=int(self.headers.get('Content-Length') or 0)
        raw=self.rfile.read(length)
        auth=self.headers.get('Authorization')
        idem=self.headers.get('Idempotency-Key')

        if self.path.endswith('/api/logs/batch'):
            body=json.loads(raw.decode() or '{}')
            Gateway.log_batches.append({'path':self.path,'auth':auth,'idem':idem,'body':body})
            if auth != f'Bearer {LOG_TOKEN}':
                payload={'error':'unauthorized'}; code=401
            elif Gateway.log_fail_remaining>0:
                Gateway.log_fail_remaining-=1
                payload={'error':'temporary'}; code=500
            else:
                records=body.get('records') if isinstance(body.get('records'),list) else []
                payload={
                    'status':'accepted',
                    'receiptId':f'LOG-RCP-{len(Gateway.log_batches):04d}',
                    'accepted':len(records)
                }; code=200
        elif self.path.endswith('/api/backups/objects'):
            actual_sha=hashlib.sha256(raw).hexdigest()
            event={
                'path':self.path,'auth':auth,'idem':idem,'rawBytes':len(raw),
                'rawSha256':actual_sha,
                'backupName':self.headers.get('X-Uchiha-Backup-Name'),
                'backupSha256':self.headers.get('X-Uchiha-Backup-SHA256'),
                'backupBytes':self.headers.get('X-Uchiha-Backup-Bytes'),
            }
            Gateway.events.append(event)
            if auth != f'Bearer {BACKUP_TOKEN}':
                payload={'error':'unauthorized'}; code=401
            else:
                remote_sha='0'*64 if Gateway.backup_wrong_sha else actual_sha
                count=len([e for e in Gateway.events if e['path'].endswith('/api/backups/objects')])
                payload={
                    'status':'stored',
                    'receiptId':f'BKP-RCP-{count:04d}',
                    'remoteObjectId':f'remote/db/{count:04d}.sqlite3',
                    'sha256':remote_sha,
                    'bytes':len(raw),
                }; code=200
        else:
            body=json.loads(raw.decode() or '{}')
            Gateway.events.append({'path':self.path,'auth':auth,'idem':idem,'body':body})
            if self.path.endswith('/api/vouchers/batches'):
                if auth != f'Bearer {VOUCHER_TOKEN}':
                    payload={'error':'unauthorized'}; code=401
                elif Gateway.voucher_return_codes:
                    payload={
                        'status':'provisioned',
                        'receiptId':'RCP-SECRET',
                        'batchId':body.get('sourceBatchId') or 'EXT-SECRET',
                        'provisionedCount':body.get('quantity'),
                        'codes':['SHOULD-NEVER-BE-PERSISTED']
                    }; code=200
                else:
                    count=len([e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')])
                    payload={
                        'status':'provisioned',
                        'receiptId':f'RCP-{count:04d}',
                        'batchId':body.get('sourceBatchId') or 'EXT-BATCH-001',
                        'provisionedCount':body.get('quantity'),
                        'externalReference':'mock-voucher-provider'
                    }; code=200
            elif auth != f'Bearer {TOKEN}':
                payload={'error':'unauthorized'}; code=401
            elif self.path.endswith('/session-command'):
                op=body.get('operation')
                delay=Gateway.delay_next
                Gateway.delay_next=0.0
                if delay>0: time.sleep(delay)
                payload={
                    'status':'completed',
                    'decision':'Operator-Disconnect' if op=='disconnect' else 'Access-Accept',
                    'effect':'disconnected' if op=='disconnect' else 'reauthenticated',
                    'reason':'Mock-Gateway'
                }; code=200
            elif self.path.endswith('/node-status'):
                payload={'status':'completed'}; code=200
            else:
                payload={'error':'not-found'}; code=404

        data=json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

class TelegramMock(BaseHTTPRequestHandler):
    events=[]
    fail_remaining=1
    token='123456789:TESTTOKEN_SUPER_PRIVATE_ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    def log_message(self,*a): pass
    def do_POST(self):
        length=int(self.headers.get('Content-Length') or 0)
        raw=self.rfile.read(length)
        body=json.loads(raw.decode() or '{}')
        TelegramMock.events.append({'path':self.path,'body':body})
        good=self.path==f'/bot{TelegramMock.token}/sendMessage'
        if good and TelegramMock.fail_remaining>0:
            TelegramMock.fail_remaining-=1
            payload={'ok':False,'description':'temporary mock failure'}
            code=500
        else:
            payload={'ok':True,'result':{'message_id':len(TelegramMock.events)}} if good else {'ok':False}
            code=200 if good else 404
        data=json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)

def tcp_server():
    srv=socketserver.ThreadingTCPServer(('127.0.0.1',0),SilentTCP); threading.Thread(target=srv.serve_forever,daemon=True).start(); return srv

def gateway_server():
    srv=ThreadingHTTPServer(('127.0.0.1',0),Gateway); threading.Thread(target=srv.serve_forever,daemon=True).start(); return srv

def telegram_server():
    srv=ThreadingHTTPServer(('127.0.0.1',0),TelegramMock); threading.Thread(target=srv.serve_forever,daemon=True).start(); return srv

def fake_radclient(path: Path, log_path: Path):
    script = """#!/bin/sh
attrs="$(cat)"
if [ -n "$UCHIHA_TEST_COA_LOG" ]; then
  printf 'ARGS=%s|%s\\n' "$1" "$2" >> "$UCHIHA_TEST_COA_LOG"
  printf '%s\\n--END--\\n' "$attrs" >> "$UCHIHA_TEST_COA_LOG"
fi
printf '%s\\n' 'Received Disconnect-ACK Id 7 from 127.0.0.1:3799 to 127.0.0.1:9999 length 20'
"""
    path.write_text(script,encoding='utf-8')
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path

def opener():
    jar=http.cookiejar.CookieJar(); return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def req(op,path,method='GET',body=None,headers=None,timeout=4):
    data=None if body is None else json.dumps(body).encode()
    r=urllib.request.Request(f'http://127.0.0.1:{PORT}{path}',data=data,method=method)
    r.add_header('Accept','application/json')
    if body is not None:r.add_header('Content-Type','application/json')
    for k,v in (headers or {}).items():r.add_header(k,v)
    try:
        with op.open(r,timeout=timeout) as x:return x.status,json.loads(x.read().decode())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read().decode())

def req_meta(op,path,method='GET',body=None,headers=None,timeout=4):
    data=None if body is None else json.dumps(body).encode()
    r=urllib.request.Request(f'http://127.0.0.1:{PORT}{path}',data=data,method=method)
    r.add_header('Accept','application/json')
    if body is not None:r.add_header('Content-Type','application/json')
    for k,v in (headers or {}).items():r.add_header(k,v)
    try:
        with op.open(r,timeout=timeout) as x:
            return x.status,json.loads(x.read().decode()),dict(x.headers.items())
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read().decode()),dict(e.headers.items())

def start(db, auth_port, acct_port, gw_port, extra=None):
    bootstrap=Path(db).parent/f'{Path(db).stem}-bootstrap-owner-password'
    bootstrap.write_text('Owner-Test-Password-2026!\n',encoding='utf-8')
    bootstrap.chmod(0o600)
    env=os.environ.copy(); env.update({
      'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1','UCHIHA_LOG_FORMAT':'json','UCHIHA_LOG_LEVEL':'INFO','UCHIHA_LOG_HTTP':'0','UCHIHA_CONNECTOR_PORT':str(PORT),'UCHIHA_CONNECTOR_DB':str(db),
      'UCHIHA_CONNECTOR_AUTH_MODE':'operator-session','UCHIHA_BOOTSTRAP_OWNER_USERNAME':'owner','UCHIHA_BOOTSTRAP_OWNER_PASSWORD_FILE':str(bootstrap),'UCHIHA_CONNECTOR_ADAPTER':'production-live',
      'UCHIHA_CONNECTOR_ENABLE_LIVE':'1','UCHIHA_CONNECTOR_LIVE_ACK':'I_UNDERSTAND_LIVE_NETWORK_COMMANDS',
      'UCHIHA_CONNECTOR_LIVE_DRIVER':'mikrotik-gateway','UCHIHA_CONNECTOR_ALLOW_INSECURE_MIKROTIK':'1',
      'UCHIHA_RADIUS_HOST':'127.0.0.1','UCHIHA_RADIUS_AUTH_PORT':str(auth_port),'UCHIHA_RADIUS_ACCT_PORT':str(acct_port),
      'UCHIHA_RADIUS_SECRET':RADIUS_SECRET_VALUE,'UCHIHA_MIKROTIK_BASE_URL':f'http://127.0.0.1:{gw_port}',
      'UCHIHA_MIKROTIK_TOKEN':TOKEN,'UCHIHA_PRODUCTION_SITE':'test-site','UCHIHA_VOUCHER_PROVISION_ENABLE':'1','UCHIHA_VOUCHER_PROVISION_ACK':'I_UNDERSTAND_VOUCHER_PROVISIONING','UCHIHA_VOUCHER_GATEWAY_URL':f'http://127.0.0.1:{gw_port}','UCHIHA_VOUCHER_GATEWAY_TOKEN':VOUCHER_TOKEN,'UCHIHA_VOUCHER_GATEWAY_PATH':'/api/vouchers/batches','UCHIHA_VOUCHER_GATEWAY_TIMEOUT':'2','UCHIHA_VOUCHER_MAX_BATCH':'500','UCHIHA_VOUCHER_ALLOW_INSECURE':'1','UCHIHA_RADIUS_PROBE_MODE':'tcp',
      'UCHIHA_REQUIRE_CONNECTIVITY_PREFLIGHT':'1','UCHIHA_QUEUE_POLL_SECONDS':'0.05','UCHIHA_QUEUE_RETRY_BASE_SECONDS':'0.05',
      'UCHIHA_QUEUE_MAX_ATTEMPTS':'2','UCHIHA_CONNECTOR_RATE_LIMIT':'1000','UCHIHA_BACKUP_DIR':str(Path(db).parent/'backups'),'UCHIHA_BACKUP_RETENTION':'3','UCHIHA_BACKUP_OFFHOST_ENABLE':'1','UCHIHA_BACKUP_OFFHOST_ACK':'I_UNDERSTAND_OFFHOST_BACKUP_REPLICATION','UCHIHA_BACKUP_OFFHOST_GATEWAY_URL':f'http://127.0.0.1:{gw_port}','UCHIHA_BACKUP_OFFHOST_GATEWAY_TOKEN':BACKUP_TOKEN,'UCHIHA_BACKUP_OFFHOST_GATEWAY_PATH':'/api/backups/objects','UCHIHA_BACKUP_OFFHOST_TIMEOUT':'2','UCHIHA_BACKUP_OFFHOST_ALLOW_INSECURE':'1','UCHIHA_BACKUP_OFFHOST_AUTO_REPLICATE':'0','UCHIHA_METRICS_PUBLIC':'0','UCHIHA_ALERT_MONITOR_ENABLED':'0','UCHIHA_ALERT_HTTP_5XX_THRESHOLD':'50','UCHIHA_DRAIN_MAX_WAIT_SECONDS':'2','UCHIHA_DRAIN_POLL_SECONDS':'0.03','UCHIHA_GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS':'2','UCHIHA_GRACEFUL_SHUTDOWN_POLL_SECONDS':'0.03','UCHIHA_LAUNCH_REQUIRE_HTTPS':'0','UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
        'UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION':'0','UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION':'1','UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0',
        'UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'0',
        'UCHIHA_RELEASE_INTEGRITY_REQUIRED':'0','UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'0','UCHIHA_RELEASE_INTEGRITY_REQUIRED':'0'
    });
    if extra:env.update(extra)
    return subprocess.Popen([sys.executable,'-S','-B',str(BACKEND)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

def wait_ready(op):
    for _ in range(70):
        try:
            s,p=req(op,'/api/connectors/radius/health')
            if s==200 and p.get('ok'):return p
        except Exception:pass
        time.sleep(.1)
    raise RuntimeError('backend not ready')

def stop(p):
    p.terminate()
    try:p.wait(timeout=5)
    except subprocess.TimeoutExpired:p.kill()

def auth(op):
    s,p=req(op,'/api/connectors/radius/auth-context')
    if s==200 and p.get('authenticated'):
        return p['csrfToken']
    assert s==401 and p.get('loginRequired') is True
    body={
        'contractVersion':'1.0',
        'requestId':f'LOGIN-{int(time.time()*1000)}-{secrets.token_hex(4)}',
        'operation':'operator-login',
        'username':'owner',
        'password':'Owner-Test-Password-2026!'
    }
    s,p=req(op,'/api/connectors/radius/session/login','POST',body,{'X-Uchiha-Contract':'1.0'})
    assert s==200 and p['authenticated'] is True and p['role']=='owner'
    return p['csrfToken']

def poll(op,cid,timeout=6):
    end=time.time()+timeout; last=None
    while time.time()<end:
        s,last=req(op,f'/api/connectors/radius/commands/{cid}'); assert s==200
        if last['status'] in {'completed','failed','dead-letter','canceled'}:return last
        time.sleep(.07)
    raise AssertionError(last)

def wait_running(op,timeout=3):
    end=time.time()+timeout; last=None
    while time.time()<end:
        s,last=req(op,'/api/connectors/radius/runtime-control'); assert s==200
        if last['queue']['running']>0:return last
        time.sleep(.03)
    raise AssertionError(last)

def wait_outbox(op,timeout=6):
    end=time.time()+timeout; last=None
    while time.time()<end:
        s,last=req(op,'/api/connectors/radius/alert-outbox'); assert s==200
        stats=last['stats']
        if stats['pending']==0:return last
        time.sleep(.07)
    raise AssertionError(last)

def wait_log_shipping(op,timeout=8):
    end=time.time()+timeout; last=None
    while time.time()<end:
        s,last=req(op,'/api/connectors/radius/log-shipping'); assert s==200
        state=last['remoteLogShipping']
        if state['sent']>0 and state['pending']==0:return last
        time.sleep(.07)
    raise AssertionError(last)

def session_payload(rid,operation):
    return {'contractVersion':'1.0','requestId':rid,'operation':operation,'session':{'id':'SESSION-1','user':'omar.mansour','ip':'10.0.0.11','nas':'NAS-A1','authServer':'RAD-A','kind':'PPPoE'},'client':{'product':'RADIUS-A','version':'Master v101','schemaVersion':101}}

def headers(csrf,rid):
    return {'X-Uchiha-Contract':'1.0','Idempotency-Key':rid,'X-Uchiha-CSRF':csrf}

def gateway_signed_headers(secret,key_id,method,path,body=None,actor='gateway-admin',role='owner',nonce=None,timestamp=None):
    nonce=nonce or ('NONCE-'+secrets.token_urlsafe(18))
    timestamp=int(time.time()) if timestamp is None else int(timestamp)
    raw=b'' if body is None else json.dumps(body).encode()
    body_sha=hashlib.sha256(raw).hexdigest()
    canonical='\n'.join(['UCHIHA-GATEWAY-HMAC-V1',method.upper(),path,actor,role,str(timestamp),nonce,body_sha])
    signature=hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
    return {
        'X-Forwarded-Proto':'https','X-Forwarded-For':'203.0.113.90',
        'X-Uchiha-Gateway-Signature':'sha256='+signature,
        'X-Uchiha-Gateway-Key-Id':key_id,
        'X-Uchiha-Gateway-Timestamp':str(timestamp),
        'X-Uchiha-Gateway-Nonce':nonce,
        'X-Uchiha-Actor':actor,'X-Uchiha-Role':role,
    }

def main():
    # Startup configuration self-check must bind no server and perform no network call.
    check_env=os.environ.copy()
    check_env.update({
        'PYTHONDONTWRITEBYTECODE':'1',
        'PYTHONUNBUFFERED':'1',
        'UCHIHA_CONNECTOR_ADAPTER':'preview',
        'UCHIHA_CONNECTOR_AUTH_MODE':'local-preview',
        'UCHIHA_LAUNCH_REQUIRE_HTTPS':'0',
        'UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
        'UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0',
    })
    check=subprocess.run(
        [sys.executable,'-S','-B',str(BACKEND),'--check-config'],
        env=check_env,capture_output=True,text=True,timeout=6
    )
    assert check.returncode==0, check.stderr
    check_payload=json.loads(check.stdout.strip().splitlines()[-1])
    assert check_payload['ok'] is True
    assert check_payload['backendBuild']=='v37' and check_payload['uiBuild']=='v101'
    assert check_payload['databaseSchemaExpected']==30
    assert check_payload['networkCallsPerformed'] is False
    assert check_payload['serverSocketBound'] is False
    assert check_payload['secretsExposed'] is False
    assert check_payload['edgeProtection']['ready'] is True
    assert check_payload['edgeProtection']['boundedConcurrency'] is True
    assert check_payload['edgeProtection']['gatewayPreAuthRateLimit'] is True
    assert check_payload['instanceLease']['supported'] is True
    assert check_payload['instanceLease']['available'] is True
    assert check_payload['instanceLease']['held'] is False
    assert check_payload['hostPreflight']['ready'] is True
    assert check_payload['hostPreflight']['deepProbe'] is True
    assert check_payload['hostPreflight']['linux'] is True
    assert check_payload['hostPreflight']['pythonSupported'] is True
    assert check_payload['hostPreflight']['sqliteSupported'] is True
    assert check_payload['hostPreflight']['flockSupported'] is True
    assert check_payload['hostPreflight']['databaseDirectoryWritable'] is True
    assert check_payload['hostPreflight']['backupDirectoryWritable'] is True
    assert check_payload['hostPreflight']['databaseFsync'] is True
    assert check_payload['hostPreflight']['databaseAtomicRename'] is True
    assert check_payload['hostPreflight']['backupFsync'] is True
    assert check_payload['hostPreflight']['backupAtomicRename'] is True
    assert check_payload['hostPreflight']['networkCallsPerformed'] is False
    assert check_payload['hostPreflight']['serverSocketBound'] is False

    # Host-only preflight performs storage/fsync/atomic-rename checks with no network/socket.
    with tempfile.TemporaryDirectory() as host_td:
        host_td=Path(host_td)
        host_env=os.environ.copy()
        host_env.update({
            'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
            'UCHIHA_CONNECTOR_DB':str(host_td/'connector.sqlite3'),
            'UCHIHA_BACKUP_DIR':str(host_td/'backups'),
            'UCHIHA_INSTANCE_LOCK_PATH':str(host_td/'connector.lock'),
            'UCHIHA_HOST_MIN_FREE_BYTES':'1',
        })
        host_check=subprocess.run(
            [sys.executable,'-S','-B',str(BACKEND),'--check-host'],
            env=host_env,capture_output=True,text=True,timeout=6
        )
        assert host_check.returncode==0, host_check.stderr
        host_payload=json.loads(host_check.stdout.strip().splitlines()[-1])
        assert host_payload['ready'] is True
        assert host_payload['deepProbe'] is True
        assert host_payload['databaseFsync'] is True
        assert host_payload['databaseAtomicRename'] is True
        assert host_payload['backupFsync'] is True
        assert host_payload['backupAtomicRename'] is True
        assert host_payload['networkCallsPerformed'] is False
        assert host_payload['serverSocketBound'] is False

        low_env=host_env.copy()
        low_env['UCHIHA_HOST_MIN_FREE_BYTES']='999999999999999999'
        host_low=subprocess.run(
            [sys.executable,'-S','-B',str(BACKEND),'--check-host'],
            env=low_env,capture_output=True,text=True,timeout=6
        )
        assert host_low.returncode==2
        low_payload=json.loads(host_low.stdout.strip().splitlines()[-1])
        assert low_payload['ready'] is False
        assert 'database-filesystem-low-space' in low_payload['blockers']
        assert 'backup-filesystem-low-space' in low_payload['blockers']

    auth_tcp=tcp_server(); acct_tcp=tcp_server(); gw=gateway_server(); tg=telegram_server()
    try:
      with tempfile.TemporaryDirectory() as td:
        # Missing explicit ACK must block startup.
        db0=Path(td)/'blocked.sqlite3'
        env=os.environ.copy(); env.update({'PYTHONDONTWRITEBYTECODE':'1','UCHIHA_CONNECTOR_PORT':str(PORT+1),'UCHIHA_CONNECTOR_DB':str(db0),'UCHIHA_CONNECTOR_AUTH_MODE':'operator-session','UCHIHA_CONNECTOR_ADAPTER':'production-live','UCHIHA_CONNECTOR_ENABLE_LIVE':'1','UCHIHA_CONNECTOR_LIVE_ACK':'','UCHIHA_CONNECTOR_LIVE_DRIVER':'mikrotik-gateway','UCHIHA_MIKROTIK_BASE_URL':f'http://127.0.0.1:{gw.server_address[1]}','UCHIHA_MIKROTIK_TOKEN':TOKEN,'UCHIHA_CONNECTOR_ALLOW_INSECURE_MIKROTIK':'1'})
        blocked=subprocess.run([sys.executable,'-S','-B',str(BACKEND)],env=env,capture_output=True,text=True,timeout=5)
        assert blocked.returncode!=0 and 'UCHIHA_CONNECTOR_LIVE_ACK' in (blocked.stderr+blocked.stdout)

        # A database created by a newer backend must be refused before any schema mutation.
        future_db=Path(td)/'future-schema.sqlite3'
        future_conn=sqlite3.connect(future_db); future_conn.execute('PRAGMA user_version=999'); future_conn.close()
        future_env=os.environ.copy(); future_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','UCHIHA_CONNECTOR_PORT':str(PORT+2),
          'UCHIHA_CONNECTOR_DB':str(future_db),'UCHIHA_CONNECTOR_ADAPTER':'preview'
        })
        future=subprocess.run([sys.executable,'-S','-B',str(BACKEND)],env=future_env,capture_output=True,text=True,timeout=5)
        assert future.returncode!=0
        assert 'database schema version 999 is newer than supported 30' in (future.stderr+future.stdout)

        # Schema 26 audit table is upgraded in-place with trace/correlation columns before schema 27 promotion.
        legacy_db=Path(td)/'legacy-schema-29.sqlite3'
        lc=sqlite3.connect(legacy_db)
        lc.execute('''CREATE TABLE audit_events(
            event_id TEXT PRIMARY KEY, actor TEXT NOT NULL, role TEXT NOT NULL,
            action TEXT NOT NULL, outcome TEXT NOT NULL, request_id TEXT,
            detail_json TEXT NOT NULL, created_at TEXT NOT NULL
        )''')
        lc.execute('PRAGMA user_version=29'); lc.commit(); lc.close()
        legacy_env=os.environ.copy(); legacy_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
          'UCHIHA_LOG_FORMAT':'json','UCHIHA_LOG_HTTP':'0',
          'UCHIHA_CONNECTOR_PORT':str(PORT+3),'UCHIHA_CONNECTOR_DB':str(legacy_db),
          'UCHIHA_CONNECTOR_ADAPTER':'preview'
        })
        legacy_proc=subprocess.Popen([sys.executable,'-S','-B',str(BACKEND)],env=legacy_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        time.sleep(.45)
        assert legacy_proc.poll() is None
        legacy_proc.terminate(); legacy_proc.wait(timeout=5)
        lc=sqlite3.connect(legacy_db)
        legacy_version=lc.execute('PRAGMA user_version').fetchone()[0]
        legacy_cols={r[1] for r in lc.execute('PRAGMA table_info(audit_events)').fetchall()}
        legacy_migration=lc.execute('SELECT source_version,target_version,backend_build FROM schema_migrations ORDER BY applied_at DESC LIMIT 1').fetchone()
        lc.close()
        assert legacy_version==30
        assert {'trace_id','correlation_id'} <= legacy_cols
        assert legacy_migration and legacy_migration[0]==29 and legacy_migration[1]==30 and legacy_migration[2]=='v37'

        coa_log=Path(td)/'coa.log'; coa_bin=fake_radclient(Path(td)/'radclient-fake',coa_log)
        direct_extra={
          'UCHIHA_RADIUS_COA_ENABLE':'1',
          'UCHIHA_RADIUS_COA_ACK':'I_UNDERSTAND_DIRECT_RADIUS_DISCONNECT',
          'UCHIHA_RADIUS_COA_BIN':str(coa_bin),
          'UCHIHA_RADIUS_COA_SECRET':'coa-secret-super-private',
          'UCHIHA_RADIUS_COA_ALLOWED_HOSTS':'127.0.0.1',
          'UCHIHA_RADIUS_COA_PORT':'3799',
          'UCHIHA_TEST_COA_LOG':str(coa_log),
          'UCHIHA_TELEGRAM_ALERTS_ENABLED':'1',
          'UCHIHA_TELEGRAM_BOT_TOKEN':TelegramMock.token,
          'UCHIHA_TELEGRAM_CHAT_ID':'-1001234567890',
          'UCHIHA_TELEGRAM_API_BASE_URL':f'http://127.0.0.1:{tg.server_address[1]}',
          'UCHIHA_TELEGRAM_ALLOW_INSECURE':'1',
          'UCHIHA_TELEGRAM_ALERT_MIN_SEVERITY':'warning',
          'UCHIHA_TELEGRAM_NOTIFY_RESOLVED':'1',
          'UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'1',
          'UCHIHA_TELEGRAM_DELIVERY_POLL_SECONDS':'0.05',
          'UCHIHA_TELEGRAM_DELIVERY_MAX_ATTEMPTS':'3',
          'UCHIHA_TELEGRAM_DELIVERY_RETRY_BASE_SECONDS':'0.05',
          'UCHIHA_TELEGRAM_DELIVERY_MIN_INTERVAL_SECONDS':'0.01',
          'UCHIHA_TELEGRAM_DELIVERY_STALE_RUNNING_SECONDS':'5',
          'UCHIHA_TELEGRAM_DELIVERY_BACKLOG_WARNING':'10',
          'UCHIHA_TELEGRAM_DELIVERY_SENT_RETENTION_SECONDS':'60',
          'UCHIHA_TELEGRAM_DELIVERY_DEAD_RETENTION_SECONDS':'60',
        }
        Gateway.events.clear(); Gateway.voucher_return_codes=False; TelegramMock.events.clear(); TelegramMock.fail_remaining=1; db=Path(td)/'live.sqlite3'; op=opener(); p=start(db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],direct_extra)
        try:
          h=wait_ready(op)
          assert h['adapterMode']=='production-live' and h['realNetworkCommands'] is True
          s,live_probe=req(op,'/api/connectors/radius/health/live'); assert s==200 and live_probe['alive'] is True
          s,pre_ready=req(op,'/api/connectors/radius/health/ready'); assert s==503 and pre_ready['ready'] is False
          assert h['liveDriver']['ready'] is True and h['liveDriver']['secretsExposed'] is False
          csrf=auth(op)
          s,conn=req(op,'/api/connectors/radius/connectivity-check'); assert s==200 and conn['overallReachable'] is True
          s,service_ready=req(op,'/api/connectors/radius/health/ready'); assert s==200 and service_ready['ready'] is True
          s,host_state=req(op,'/api/connectors/radius/host-preflight'); assert s==200
          assert host_state['hostPreflight']['ready'] is True
          assert host_state['hostPreflight']['networkCallsPerformed'] is False
          s,launch_pre=req(op,'/api/connectors/radius/launch-readiness'); assert s==200
          assert launch_pre['launchReadiness']['readyForCheckpoint'] is True
          assert launch_pre['launchReadiness']['safeToServe'] is False
          assert launch_pre['launchReadiness']['status']=='READY_FOR_CHECKPOINT'
          assert launch_pre['launchReadiness']['policy']['requireReleaseIntegrity'] is False
          assert launch_pre['launchReadiness']['policy']['requireEdgeProtection'] is True
          assert launch_pre['launchReadiness']['checks']['configuration']['edgeProtectionReady'] is True
          assert launch_pre['launchReadiness']['policy']['requireInstanceLock'] is True
          assert launch_pre['launchReadiness']['checks']['configuration']['singleInstanceLeaseHeld'] is True
          assert launch_pre['launchReadiness']['policy']['requireHostPreflight'] is True
          assert launch_pre['launchReadiness']['checks']['configuration']['hostEnvironmentReady'] is True
          assert launch_pre['launchReadiness']['hostPreflight']['ready'] is True
          assert launch_pre['launchReadiness']['policy']['requireOperatorSession'] is True
          assert launch_pre['launchReadiness']['checks']['configuration']['operatorSessionReady'] is True
          assert 'create-deployment-checkpoint' in launch_pre['launchReadiness']['nextActions']

          # Runtime maintenance toggles immediately without process restart.
          runtime_on_rid='REQ-V37-RUNTIME-MAINT-ON'
          runtime_on={'contractVersion':'1.0','requestId':runtime_on_rid,'operation':'set-maintenance','enabled':True,'reason':'runtime-upgrade'}
          s,runtime_on_resp=req(op,'/api/connectors/radius/runtime-control/maintenance','POST',runtime_on,headers(csrf,runtime_on_rid)); assert s==200
          assert runtime_on_resp['maintenance']['enabled'] is True
          assert runtime_on_resp['maintenance']['source']=='runtime'
          assert runtime_on_resp['maintenance']['runtimeEnabled'] is True
          s,runtime_state=req(op,'/api/connectors/radius/runtime-control'); assert s==200
          assert runtime_state['maintenance']['reason']=='runtime-upgrade'
          s,runtime_ready=req(op,'/api/connectors/radius/health/ready'); assert s==503 and 'maintenance-mode' in runtime_ready['blockers']
          before_runtime_events=len(Gateway.events)
          block_rid='REQ-V37-RUNTIME-BLOCK'
          s,blocked_runtime=req(op,'/api/connectors/radius','POST',session_payload(block_rid,'disconnect'),headers(csrf,block_rid))
          assert s==503 and blocked_runtime['error']['code']=='maintenance_mode'
          time.sleep(.15); assert len(Gateway.events)==before_runtime_events

          runtime_off_rid='REQ-V37-RUNTIME-MAINT-OFF'
          runtime_off={'contractVersion':'1.0','requestId':runtime_off_rid,'operation':'set-maintenance','enabled':False,'reason':''}
          s,runtime_off_resp=req(op,'/api/connectors/radius/runtime-control/maintenance','POST',runtime_off,headers(csrf,runtime_off_rid)); assert s==200
          assert runtime_off_resp['maintenance']['enabled'] is False
          assert runtime_off_resp['maintenance']['source']=='none'
          s,runtime_ready2=req(op,'/api/connectors/radius/health/ready'); assert s==200 and runtime_ready2['ready'] is True

          # Deployment drain must wait for an already-running command, while preventing new claims.
          Gateway.delay_next=0.55
          slow_rid='REQ-V37-DRAIN-SLOW'
          s,slow_q=req(op,'/api/connectors/radius','POST',session_payload(slow_rid,'disconnect'),headers(csrf,slow_rid)); assert s==202
          wait_running(op)
          drain_rid='REQ-V37-DRAIN'
          drain_body={'contractVersion':'1.0','requestId':drain_rid,'operation':'enter-maintenance-and-drain','reason':'deploy-v20','timeoutSeconds':1.5}
          started=time.time()
          s,drained=req(op,'/api/connectors/radius/runtime-control/drain','POST',drain_body,headers(csrf,drain_rid),timeout=3)
          elapsed=time.time()-started
          assert s==200 and drained['drain']['drained'] is True and drained['drain']['phase']=='drained'
          assert drained['drain']['running']==0 and drained['maintenance']['enabled'] is True
          assert elapsed >= .25
          # queued/retry items are allowed to remain; drain safety is about in-flight commands.
          slow_done=poll(op,slow_q['commandId']); assert slow_done['status']=='completed'
          off2_rid='REQ-V37-DRAIN-OFF'
          off2={'contractVersion':'1.0','requestId':off2_rid,'operation':'set-maintenance','enabled':False,'reason':''}
          s,off2_resp=req(op,'/api/connectors/radius/runtime-control/maintenance','POST',off2,headers(csrf,off2_rid)); assert s==200
          assert off2_resp['maintenance']['enabled'] is False

          # One guarded Deployment Checkpoint performs Drain + Backup + Restore Drill.
          chk_rid='REQ-V37-CHECKPOINT'
          chk_body={'contractVersion':'1.0','requestId':chk_rid,'operation':'create-deployment-checkpoint','reason':'pre-deploy-v21','timeoutSeconds':1.5}
          s,checkpoint=req(op,'/api/connectors/radius/deployment-checkpoint','POST',chk_body,headers(csrf,chk_rid),timeout=8)
          assert s==201 and checkpoint['safeForDeployment'] is True
          assert checkpoint['checkpoint']['status']=='verified'
          assert checkpoint['checkpoint']['drain']['drained'] is True
          assert checkpoint['checkpoint']['backupName']
          assert checkpoint['checkpoint']['backupSha256']
          assert checkpoint['checkpoint']['restoreDrillPassed'] is True
          assert checkpoint['maintenanceRemainsEnabled'] is True
          s,checkpoint_list=req(op,'/api/connectors/radius/deployment-checkpoints'); assert s==200
          assert checkpoint_list['readiness']['safeForDeployment'] is True
          assert any(x['checkpointId']==checkpoint['checkpoint']['checkpointId'] for x in checkpoint_list['items'])
          s,release_checkpoint=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          assert release_checkpoint['deploymentCheckpoint']['safeForDeployment'] is True
          s,launch_checkpoint=req(op,'/api/connectors/radius/launch-readiness'); assert s==200
          assert launch_checkpoint['launchReadiness']['safeToDeploy'] is True
          assert launch_checkpoint['launchReadiness']['safeToServe'] is False
          assert launch_checkpoint['launchReadiness']['status']=='READY_TO_DEPLOY'
          assert 'run-post-deploy-verification' in launch_checkpoint['launchReadiness']['nextActions']

          # Build mismatch must fail verification and keep maintenance enabled.
          bad_verify_rid='REQ-V37-VERIFY-BAD-BUILD'
          bad_verify={'contractVersion':'1.0','requestId':bad_verify_rid,'operation':'verify-deployment',
                      'checkpointId':checkpoint['checkpoint']['checkpointId'],
                      'expectedBackendBuild':'v999','expectedUiBuild':'v101','resumeIfPassed':True}
          s,bad_verification=req(op,'/api/connectors/radius/deployment-verification','POST',bad_verify,headers(csrf,bad_verify_rid),timeout=8)
          assert s==202 and bad_verification['verification']['passed'] is False
          assert 'backendBuildMatches' in bad_verification['verification']['blockers']
          assert bad_verification['resumed'] is False
          s,still_maint=req(op,'/api/connectors/radius/runtime-control'); assert s==200 and still_maint['maintenance']['enabled'] is True

          # Correct post-deploy verification checks connectivity + checkpoint backup and resumes only after all gates pass.
          verify_rid='REQ-V37-VERIFY-GOOD'
          verify_body={'contractVersion':'1.0','requestId':verify_rid,'operation':'verify-deployment',
                       'checkpointId':checkpoint['checkpoint']['checkpointId'],
                       'expectedBackendBuild':'v37','expectedUiBuild':'v101','resumeIfPassed':True}
          s,verification=req(op,'/api/connectors/radius/deployment-verification','POST',verify_body,headers(csrf,verify_rid),timeout=8)
          assert s==200 and verification['verification']['passed'] is True
          assert verification['verification']['status']=='verified-resumed'
          assert verification['verification']['resumed'] is True
          assert verification['verification']['backupIntegrityVerified'] is True
          assert verification['verification']['backupHashMatches'] is True
          assert verification['verification']['connectivityReachable'] is True
          assert verification['verification']['databaseReady'] is True
          assert verification['verification']['queueRunning']==0
          assert verification['verification']['observedBackendBuild']=='v37'
          assert verification['verification']['observedUiBuild']=='v101'
          assert verification['maintenance']['enabled'] is False

          s,verification_list=req(op,'/api/connectors/radius/deployment-verifications'); assert s==200
          assert verification_list['readiness']['passed'] is True and verification_list['readiness']['resumed'] is True
          assert len(verification_list['items']) >= 2
          s,release_verified=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          assert release_verified['postDeployVerification']['latest']['passed'] is True
          assert release_verified['postDeployVerification']['latest']['resumed'] is True
          s,launch_go=req(op,'/api/connectors/radius/launch-readiness'); assert s==200
          assert launch_go['launchReadiness']['go'] is True
          assert launch_go['launchReadiness']['safeToLaunch'] is True
          assert launch_go['launchReadiness']['safeToServe'] is True
          assert launch_go['launchReadiness']['status']=='READY_TO_SERVE'
          assert launch_go['launchReadiness']['score']==100
          assert launch_go['launchReadiness']['blockers']==[]
          assert launch_go['launchReadiness']['backendBuild']=='v37'
          assert launch_go['launchReadiness']['uiBuild']=='v101'

          s,ops=req(op,'/api/connectors/radius/ops-summary'); assert s==200 and ops['secretsExposed'] is False and ops['readiness']['ready'] is True
          s,ready=req(op,'/api/connectors/radius/production-readiness'); assert s==200 and ready['connectivityVerified'] is True and ready['liveDriver']['ready'] is True
          s,release=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          assert release['releaseState']=='live-ready' and release['uiBuild']=='v101' and release['backendBuild']=='v37'
          assert release['realNetworkCommands'] is True and release['liveReady'] is True
          assert release['serviceReady'] is True and release['maintenanceMode'] is False
          assert release['capabilities']['operationalAlerts'] is True
          assert release['operationalAlerts']['monitorEnabled'] is False
          assert release['alertNotificationDelivery']['enabled'] is True
          assert release['alertNotificationDelivery']['ready'] is True
          assert release['alertNotificationDelivery']['secretsExposed'] is False
          assert release['capabilities']['telegramAlertDelivery'] is True
          assert release['capabilities']['persistentAlertDeliveryOutbox'] is True
          assert release['capabilities']['alertDeliveryManualRetry'] is True
          assert release['capabilities']['alertDeliveryRestartRecovery'] is True
          assert release['capabilities']['alertDeliveryRetentionCleanup'] is True
          assert release['capabilities']['runtimeMaintenanceControl'] is True
          assert release['capabilities']['runtimeMaintenancePersistent'] is True
          assert release['capabilities']['environmentMaintenanceOverride'] is True
          assert release['capabilities']['deploymentDrain'] is True
          assert release['capabilities']['deploymentDrainWait'] is True
          assert release['capabilities']['deploymentCheckpoint'] is True
          assert release['capabilities']['deploymentCheckpointPersists'] is True
          assert release['capabilities']['postDeployVerification'] is True
          assert release['capabilities']['guardedResume'] is True
          assert release['capabilities']['gracefulShutdown'] is True
          assert release['capabilities']['sigtermDrain'] is True
          assert release['capabilities']['voucherNetworkProvisioning'] is True
          assert release['capabilities']['voucherReceiptOnlyContract'] is True
          assert release['voucherProvisioning']['ready'] is True
          assert release['voucherProvisioning']['codesReturned'] is False
          assert release['voucherProvisioning']['credentialsStored'] is False
          assert release['voucherProvisioning']['secretsExposed'] is False
          assert release['capabilities']['databaseSchemaVersioning'] is True
          assert release['capabilities']['databaseMigrationLedger'] is True
          assert release['capabilities']['structuredJsonLogging'] is True
          assert release['capabilities']['requestTracing'] is True
          assert release['capabilities']['auditTraceLinking'] is True
          assert release['capabilities']['remoteLogShipping'] is True
          assert release['capabilities']['remoteLogShippingDurableOutbox'] is True
          assert release['capabilities']['openApi31Contract'] is True
          assert release['capabilities']['apiContractChecksum'] is True
          assert release['capabilities']['apiContractEtag'] is True
          assert release['capabilities']['transportSecurityBoundary'] is True
          assert release['capabilities']['trustedProxyValidation'] is True
          assert release['capabilities']['httpsEnforcement'] is True
          assert release['capabilities']['secureCookies'] is True
          assert release['capabilities']['hsts'] is True
          assert release['capabilities']['gatewayHmacSigning'] is True
          assert release['capabilities']['gatewayReplayProtection'] is True
          assert release['capabilities']['gatewayKeyRotationWindow'] is True
          assert release['capabilities']['gatewayBodyHashBinding'] is True
          assert release['capabilities']['launchGate'] is True
          assert release['capabilities']['launchGateGoBlocked'] is True
          assert release['capabilities']['launchSmokeTest'] is True
          assert release['capabilities']['releaseIntegrity'] is True
          assert release['capabilities']['releaseIntegritySha256'] is True
          assert release['capabilities']['releaseIntegrityFailClosed'] is True
          assert release['capabilities']['rollbackSafeDeployment'] is True
          assert release['capabilities']['boundedHttpConcurrency'] is True
          assert release['capabilities']['gatewayPreAuthRateLimit'] is True
          assert release['capabilities']['socketSlowClientTimeout'] is True
          assert release['capabilities']['edgeAbuseProtection'] is True
          assert release['capabilities']['singleInstanceDatabaseLease'] is True
          assert release['capabilities']['splitBrainPrevention'] is True
          assert release['capabilities']['kernelReleasedInstanceLock'] is True
          assert release['capabilities']['hostPreflight'] is True
          assert release['capabilities']['hostFilesystemFsyncProbe'] is True
          assert release['capabilities']['hostAtomicRenameProbe'] is True
          assert release['hostPreflight']['ready'] is True
          assert release['hostPreflight']['linux'] is True
          assert release['hostPreflight']['databaseDirectoryWritable'] is True
          assert release['hostPreflight']['backupDirectoryWritable'] is True
          assert release['instanceLease']['held'] is True
          assert release['instanceLease']['ready'] is True
          assert release['capabilities']['productionOperatorSessions'] is True
          assert release['capabilities']['operatorPasswordScrypt'] is True
          assert release['capabilities']['operatorCsrfSessions'] is True
          assert release['capabilities']['hybridBrowserAndGatewayAuth'] is True
          assert release['capabilities']['operatorAccountManagement'] is True
          assert release['operatorAuthentication']['active'] is True
          assert release['operatorAuthentication']['ready'] is True
          assert release['operatorAuthentication']['enabledOwners'] >= 1
          assert release['operatorAuthentication']['passwordHashesExposed'] is False
          assert release['edgeProtection']['ready'] is True
          assert release['edgeProtection']['boundedConcurrency'] is True
          assert release['gatewayAuthentication']['supported'] is True
          assert release['gatewayAuthentication']['active'] is False
          assert release['gatewayAuthentication']['replayProtection'] is True
          assert release['gatewayAuthentication']['noncePersistence'] is True
          assert release['launchReadiness']['safeToServe'] is True
          assert release['launchReadiness']['status']=='READY_TO_SERVE'
          assert release['launchReadiness']['score']==100
          assert release['transportSecurity']['supported'] is True
          assert release['transportSecurity']['publicHttpsRequired'] is False
          assert release['transportSecurity']['httpsEnforcementReady'] is True
          assert release['apiContract']['valid'] is True
          assert release['apiContract']['openapiVersion']=='3.1.0'
          assert release['apiContract']['databaseSchemaVersion']==30
          assert release['apiContract']['operationIdsUnique'] is True
          assert release['apiContract']['pathCount'] >= 40
          assert release['apiContract']['operationCount'] >= 45
          assert release['remoteLogShipping']['enabled'] is False
          assert release['remoteLogShipping']['ready'] is False
          assert release['requestTracing']['enabled'] is True
          assert release['requestTracing']['requestHeader']=='X-Request-ID'
          assert release['requestTracing']['correlationHeader']=='X-Correlation-ID'
          assert release['requestTracing']['requestBodiesLogged'] is False
          assert release['requestTracing']['secretsRedacted'] is True
          assert release['databaseSchema']['compatible'] is True
          assert release['databaseSchema']['currentVersion']==30
          assert release['databaseSchema']['expectedVersion']==30
          assert release['databaseSchema']['migrationCount'] >= 1
          s,schema_api=req(op,'/api/connectors/radius/database-schema'); assert s==200
          assert schema_api['databaseSchema']['compatible'] is True
          assert schema_api['databaseSchema']['latestMigration']['targetVersion']==30
          assert release['operationalMetrics']['requestsTotal'] > 0
          assert release['capabilities']['directRadiusCoARequest'] is False and release['secretsExposed'] is False
          assert release['capabilities']['directRadiusDisconnectRequest'] is True
          assert release['directRadiusDynamicAuthorization']['ready'] is True
          assert release['directRadiusDynamicAuthorization']['supportedPacket']=='Disconnect-Request'
          assert release['directRadiusDynamicAuthorization']['reauthenticateSupported'] is False

          # OpenAPI 3.1 contract is authenticated, deterministic, secret-free and cacheable by ETag.
          s,contract_summary,contract_headers=req_meta(op,'/api/connectors/radius/api-contract')
          assert s==200
          api_summary=contract_summary['apiContract']
          assert api_summary['valid'] is True
          assert api_summary['openapiVersion']=='3.1.0'
          assert api_summary['backendBuild']=='v37' and api_summary['uiBuild']=='v101'
          assert api_summary['databaseSchemaVersion']==30
          assert api_summary['sha256']==release['apiContract']['sha256']
          assert contract_headers.get('X-API-Contract-SHA256')==api_summary['sha256']
          assert contract_headers.get('X-API-Contract-Version')=='1.8.0'

          s,openapi_doc,openapi_headers=req_meta(op,'/api/connectors/radius/openapi.json')
          assert s==200 and openapi_doc['openapi']=='3.1.0'
          assert openapi_doc['info']['version']=='1.8.0'
          assert openapi_doc['x-uchiha-backend-build']=='v37'
          assert openapi_doc['x-uchiha-ui-build']=='v101'
          assert openapi_doc['x-uchiha-database-schema-version']==30
          assert openapi_headers.get('ETag')==api_summary['etag']
          canonical=json.dumps(openapi_doc,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
          assert hashlib.sha256(canonical).hexdigest()==api_summary['sha256']

          operation_ids=[]
          for path_item in openapi_doc['paths'].values():
            for method,spec in path_item.items():
              if method in {'get','post','put','patch','delete','options','head'} and isinstance(spec,dict):
                operation_ids.append(spec.get('operationId'))
          assert None not in operation_ids and len(operation_ids)==len(set(operation_ids))
          assert openapi_doc['x-uchiha-gateway-hmac-v1']['algorithm']=='HMAC-SHA256'
          assert openapi_doc['x-uchiha-gateway-hmac-v1']['legacyPlainGatewayKeyDefault'] is False
          assert 'gatewaySignature' in openapi_doc['components']['securitySchemes']
          assert openapi_doc['x-uchiha-auth-modes']['recommendedProduction']=='hybrid'
          assert 'operator-session' in openapi_doc['x-uchiha-auth-modes']['supported']
          assert openapi_doc['components']['schemas']['OperatorLoginRequest']['allOf'][1]['properties']['password']['writeOnly'] is True
          assert 'gatewayKey' not in openapi_doc['components']['securitySchemes']
          for critical_path in [
              '/api/connectors/radius',
              '/api/connectors/radius/health/ready',
              '/api/connectors/radius/backups/{name}/replicate',
              '/api/connectors/radius/voucher-batches',
              '/api/connectors/radius/log-shipping',
              '/api/connectors/radius/deployment-verification',
              '/api/connectors/radius/openapi.json',
              '/api/connectors/radius/transport-security',
              '/api/connectors/radius/gateway-authentication',
              '/api/connectors/radius/launch-readiness',
              '/api/connectors/radius/release-integrity',
              '/api/connectors/radius/edge-protection',
              '/api/connectors/radius/instance-lock',
              '/api/connectors/radius/host-preflight',
              '/api/connectors/radius/session/login',
              '/api/connectors/radius/session/logout',
              '/api/connectors/radius/operator-accounts',
          ]:
              assert critical_path in openapi_doc['paths']

          openapi_text=json.dumps(openapi_doc)
          assert TOKEN not in openapi_text and VOUCHER_TOKEN not in openapi_text
          assert BACKUP_TOKEN not in openapi_text and LOG_TOKEN not in openapi_text
          assert RADIUS_SECRET_VALUE not in openapi_text and TelegramMock.token not in openapi_text
          assert 'coa-secret-super-private' not in openapi_text

          # Conditional GET returns 304 with the same contract hash/ETag and no document body.
          etag_req=urllib.request.Request(f'http://127.0.0.1:{PORT}/api/connectors/radius/openapi.json',method='GET')
          etag_req.add_header('Accept','application/json')
          etag_req.add_header('If-None-Match',api_summary['etag'])
          try:
              op.open(etag_req,timeout=4)
              raise AssertionError('expected 304')
          except urllib.error.HTTPError as e:
              assert e.code==304
              assert e.headers.get('ETag')==api_summary['etag']
              assert e.headers.get('X-API-Contract-SHA256')==api_summary['sha256']
              assert e.read()==b''

          # Normal JSON responses advertise the active API contract hash.
          s,metric_for_contract,metric_contract_headers=req_meta(op,'/api/connectors/radius/metrics')
          assert s==200
          assert metric_contract_headers.get('X-API-Contract-SHA256')==api_summary['sha256']
          assert metric_contract_headers.get('X-API-Contract-Version')=='1.8.0'

          # Voucher network provisioning: the UI-shaped nested batch contract is accepted directly.
          s,vready=req(op,'/api/connectors/radius/voucher-provisioning'); assert s==200
          assert vready['readiness']['ready'] is True
          assert vready['readiness']['codesReturned'] is False
          assert vready['readiness']['credentialsStored'] is False

          voucher_before=len([e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')])
          vrid='REQ-V37-VOUCHER-OK'
          voucher_body={
              'contractVersion':'1.0','requestId':vrid,'operation':'provision-voucher-batch',
              'batch':{'id':'VCH-LIVE-001','plan':'Home 50','quantity':25,'validity':'30 days'},
              'scope':'Atlas Connect','requestedAt':'2026-09-12T12:00:00Z'
          }
          s,vresult=req(op,'/api/connectors/radius/voucher-batches','POST',voucher_body,headers(csrf,vrid),timeout=5)
          assert s==201 and vresult['networkProvisioned'] is True
          assert vresult['status']=='provisioned' and vresult['provisionedCount']==25
          assert vresult['receiptId'].startswith('RCP-')
          assert vresult['codesReturned'] is False and vresult['credentialsStored'] is False
          voucher_events=[e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')]
          assert len(voucher_events)==voucher_before+1
          assert voucher_events[-1]['auth']==f'Bearer {VOUCHER_TOKEN}'
          assert voucher_events[-1]['idem']==vrid
          assert voucher_events[-1]['body']['sourceBatchId']=='VCH-LIVE-001'
          assert voucher_events[-1]['body']['planId']=='Home 50'
          assert voucher_events[-1]['body']['quantity']==25

          # Completed replay must not contact gateway twice.
          s,vreplay=req(op,'/api/connectors/radius/voucher-batches','POST',voucher_body,headers(csrf,vrid)); assert s==200
          assert vreplay['idempotentReplay'] is True and vreplay['networkProvisioned'] is True
          assert vreplay['receiptId']==vresult['receiptId']
          time.sleep(.12)
          assert len([e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')])==voucher_before+1

          # Same request ID with a changed payload is rejected.
          conflict_body={**voucher_body,'batch':{**voucher_body['batch'],'quantity':26}}
          s,vconflict=req(op,'/api/connectors/radius/voucher-batches','POST',conflict_body,headers(csrf,vrid))
          assert s==409 and vconflict['error']['code']=='voucher_idempotency_conflict'

          # Bounds are rejected synchronously before network I/O.
          bad_vrid='REQ-V37-VOUCHER-TOO-LARGE'
          bad_voucher={
              **voucher_body,'requestId':bad_vrid,
              'batch':{**voucher_body['batch'],'id':'VCH-LIVE-BIG','quantity':501}
          }
          before_bad=len([e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')])
          s,bad_v=req(op,'/api/connectors/radius/voucher-batches','POST',bad_voucher,headers(csrf,bad_vrid))
          assert s==400 and bad_v['error']['code']=='voucher_quantity_out_of_range'
          assert len([e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')])==before_bad

          # Refuse gateway payloads that attempt to return credential/code arrays.
          Gateway.voucher_return_codes=True
          secret_vrid='REQ-V37-VOUCHER-SECRET'
          secret_body={
              **voucher_body,'requestId':secret_vrid,
              'batch':{**voucher_body['batch'],'id':'VCH-LIVE-SECRET','quantity':2}
          }
          s,secret_v=req(op,'/api/connectors/radius/voucher-batches','POST',secret_body,headers(csrf,secret_vrid))
          assert s==502 and secret_v['error']['code']=='voucher_gateway_credential_payload_rejected'
          Gateway.voucher_return_codes=False

          s,voucher_list=req(op,'/api/connectors/radius/voucher-batches'); assert s==200
          assert any(x['requestId']==vrid and x['status']=='provisioned' for x in voucher_list['items'])
          assert 'SHOULD-NEVER-BE-PERSISTED' not in json.dumps(voucher_list)
          assert VOUCHER_TOKEN not in json.dumps(voucher_list)

          assert release['capabilities']['databaseBackup'] is True
          assert release['capabilities']['offHostBackupReplication'] is True
          assert release['capabilities']['offHostBackupGatewayReady'] is True
          assert release['capabilities']['databaseRestoreLive'] is False
          assert release['databaseBackup']['supported'] is True
          assert release['offHostBackup']['ready'] is True
          assert release['offHostBackup']['latestProtected'] is False
          assert release['offHostBackup']['secretsExposed'] is False

          # Create a real SQLite snapshot and verify it.
          backup_rid='REQ-V37-BACKUP'
          backup_body={'contractVersion':'1.0','requestId':backup_rid,'operation':'create-backup'}
          s,bcreate=req(op,'/api/connectors/radius/backups','POST',backup_body,headers(csrf,backup_rid)); assert s==201
          assert bcreate['backup']['integrityVerified'] is True and bcreate['restorePerformed'] is False
          backup_name=bcreate['backup']['name']
          backup_path=Path(td)/'backups'/backup_name
          assert backup_path.exists() and backup_path.stat().st_size > 0
          s,blist=req(op,'/api/connectors/radius/backups'); assert s==200
          assert any(x['name']==backup_name for x in blist['items'])
          verify_rid='REQ-V37-BACKUP-VERIFY'
          verify_body={'contractVersion':'1.0','requestId':verify_rid,'operation':'verify-backup'}
          s,bverify=req(op,f'/api/connectors/radius/backups/{backup_name}/verify','POST',verify_body,headers(csrf,verify_rid)); assert s==200
          assert bverify['backup']['integrityVerified'] is True and bverify['restorePerformed'] is False
          s,release_after_backup=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          assert release_after_backup['databaseBackup']['latestVerified'] is True

          # Replicate the verified snapshot off-host as raw SQLite bytes and verify echoed hash/size.
          offhost_before=len([e for e in Gateway.events if e['path'].endswith('/api/backups/objects')])
          repl_rid='REQ-V37-BACKUP-REPLICATE'
          repl_body={'contractVersion':'1.0','requestId':repl_rid,'operation':'replicate-backup'}
          s,brepl=req(op,f'/api/connectors/radius/backups/{backup_name}/replicate','POST',repl_body,headers(csrf,repl_rid),timeout=8)
          assert s==201 and brepl['offHostCopied'] is True and brepl['remoteVerified'] is True
          assert brepl['replication']['status']=='replicated'
          assert brepl['replication']['checksumVerified'] is True and brepl['replication']['sizeVerified'] is True
          assert brepl['replication']['backupSha256']==bcreate['backup']['sha256']
          backup_events=[e for e in Gateway.events if e['path'].endswith('/api/backups/objects')]
          assert len(backup_events)==offhost_before+1
          be=backup_events[-1]
          assert be['auth']==f'Bearer {BACKUP_TOKEN}'
          assert be['backupName']==backup_name
          assert be['backupSha256']==bcreate['backup']['sha256']
          assert be['rawSha256']==bcreate['backup']['sha256']
          assert int(be['backupBytes'])==bcreate['backup']['bytes']==be['rawBytes']

          # A second replication of the same verified snapshot replays its receipt without another upload.
          s,brepl_replay=req(op,f'/api/connectors/radius/backups/{backup_name}/replicate','POST',repl_body,headers(csrf,repl_rid),timeout=5)
          assert s==200 and brepl_replay['idempotentReplay'] is True
          assert len([e for e in Gateway.events if e['path'].endswith('/api/backups/objects')])==offhost_before+1
          s,repls=req(op,'/api/connectors/radius/backups/replications'); assert s==200
          assert repls['readiness']['latestProtected'] is True
          assert any(x['backupName']==backup_name and x['status']=='replicated' for x in repls['items'])
          s,release_offhost=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          assert release_offhost['offHostBackup']['latestProtected'] is True
          assert release_offhost['capabilities']['offHostBackupLatestProtected'] is True

          # A remote checksum mismatch is rejected, persisted as failed metadata, then can be retried safely.
          second_rid='REQ-V37-BACKUP-SECOND'
          second_body={'contractVersion':'1.0','requestId':second_rid,'operation':'create-backup'}
          s,bsecond=req(op,'/api/connectors/radius/backups','POST',second_body,headers(csrf,second_rid)); assert s==201
          second_name=bsecond['backup']['name']
          Gateway.backup_wrong_sha=True
          mismatch_rid='REQ-V37-BACKUP-MISMATCH'
          mismatch_body={'contractVersion':'1.0','requestId':mismatch_rid,'operation':'replicate-backup'}
          s,mismatch=req(op,f'/api/connectors/radius/backups/{second_name}/replicate','POST',mismatch_body,headers(csrf,mismatch_rid),timeout=8)
          assert s==502 and mismatch['error']['code']=='offhost_backup_checksum_mismatch'
          Gateway.backup_wrong_sha=False
          s,retry_rep=req(op,f'/api/connectors/radius/backups/{second_name}/replicate','POST',mismatch_body,headers(csrf,mismatch_rid),timeout=8)
          assert s==201 and retry_rep['remoteVerified'] is True
          s,repls_after=req(op,'/api/connectors/radius/backups/replications'); assert s==200
          assert repls_after['readiness']['latestProtected'] is True
          assert any(x['backupName']==second_name and x['status']=='rejected' for x in repls_after['items'])
          assert any(x['backupName']==second_name and x['status']=='replicated' for x in repls_after['items'])

          # Prove recoverability by restoring the snapshot into a temporary SQLite DB.
          drill_rid='REQ-V37-RESTORE-DRILL'
          drill_body={'contractVersion':'1.0','requestId':drill_rid,'operation':'restore-drill'}
          s,drill=req(op,f'/api/connectors/radius/backups/{backup_name}/restore-drill','POST',drill_body,headers(csrf,drill_rid)); assert s==200
          assert drill['passed'] is True and drill['integrityVerified'] is True
          assert drill['missingTables']==[] and drill['temporaryDatabaseRemoved'] is True
          assert drill['productionDatabaseReplaced'] is False and drill['liveRestorePerformed'] is False
          assert drill['restoredBytes'] > 0
          assert not list((Path(td)/'backups').glob('.restore-drill-*.tmp'))
          s,drills=req(op,'/api/connectors/radius/backups/restore-drills'); assert s==200
          assert drills['readiness']['latestRestoreDrillPassed'] is True
          assert any(x['drillId']==drill['drillId'] and x['passed'] for x in drills['items'])
          s,release_after_drill=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          assert release_after_drill['capabilities']['databaseRestoreDrill'] is True
          assert release_after_drill['capabilities']['databaseRestoreLive'] is False
          assert release_after_drill['databaseRecoveryDrill']['latestRestoreDrillPassed'] is True

          # Targeted direct RADIUS Disconnect-Request is queued and ACKed exactly once.
          direct_rid='REQ-V37-DIRECT'
          direct_body=session_payload(direct_rid,'disconnect')
          direct_body['session']['acctSessionId']='ACCT-0001'
          direct_body['session']['coaHost']='127.0.0.1'
          s,dq=req(op,'/api/connectors/radius/direct-disconnect','POST',direct_body,headers(csrf,direct_rid)); assert s==202
          dd=poll(op,dq['commandId']); assert dd['status']=='completed'
          dr=dd['result']; assert dr['protocol']=='RADIUS-Disconnect-Request' and dr['effect']=='disconnected' and dr['realNetworkCommandSent'] is True
          direct_log=coa_log.read_text(encoding='utf-8')
          assert direct_log.count('ARGS=')==1 and 'ACCT-0001' in direct_log and 'omar.mansour' in direct_log
          assert 'coa-secret-super-private' not in direct_log

          # Direct RADIUS is idempotent: same request does not call radclient twice.
          s,dreplay=req(op,'/api/connectors/radius/direct-disconnect','POST',direct_body,headers(csrf,direct_rid)); assert s==200 and dreplay['idempotentReplay'] is True
          time.sleep(.15); assert coa_log.read_text(encoding='utf-8').count('ARGS=')==1

          # Non-allowlisted NAS target is blocked before radclient.
          bad_rid='REQ-V37-DIRECT-BLOCK'
          bad=session_payload(bad_rid,'disconnect'); bad['session']['acctSessionId']='ACCT-0002'; bad['session']['coaHost']='nas-not-allowed.example'
          s,bq=req(op,'/api/connectors/radius/direct-disconnect','POST',bad,headers(csrf,bad_rid)); assert s==202
          bd=poll(op,bq['commandId']); assert bd['status']=='failed' and bd['error']['code']=='coa_host_not_allowed'
          assert coa_log.read_text(encoding='utf-8').count('ARGS=')==1

          # Missing Acct-Session-Id is blocked to prevent broad disconnect requests.
          noid_rid='REQ-V37-DIRECT-NOID'
          noid=session_payload(noid_rid,'disconnect'); noid['session']['coaHost']='127.0.0.1'
          s,nq=req(op,'/api/connectors/radius/direct-disconnect','POST',noid,headers(csrf,noid_rid)); assert s==202
          nd=poll(op,nq['commandId']); assert nd['status']=='failed' and nd['error']['code']=='acct_session_id_required'
          assert coa_log.read_text(encoding='utf-8').count('ARGS=')==1

          # Operational alert engine detects failed commands and supports acknowledgement without resolving the condition.
          s,alerts=req(op,'/api/connectors/radius/alerts?status=active'); assert s==200
          failed_alert=next((x for x in alerts['items'] if x['key']=='command-failures'),None)
          assert failed_alert and failed_alert['severity']=='warning' and failed_alert['status']=='active'
          assert alerts['summary']['active'] >= 1 and alerts['summary']['warning'] >= 1
          ack_rid='REQ-V37-ALERT-ACK'
          ack_body={'contractVersion':'1.0','requestId':ack_rid,'operation':'acknowledge-alert'}
          s,acked=req(op,f"/api/connectors/radius/alerts/{failed_alert['alertId']}/ack",'POST',ack_body,headers(csrf,ack_rid)); assert s==200
          assert acked['alert']['acknowledged'] is True and acked['alert']['status']=='active'
          s,release_alert=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          assert release_alert['operationalAlerts']['active'] >= 1
          assert release_alert['operationalAlerts']['acknowledgedActive'] >= 1
          outbox=wait_outbox(op)
          assert outbox['stats']['pending']==0 and outbox['stats']['sent'] >= 1
          assert outbox['stats']['health']=='healthy'
          assert len(TelegramMock.events) >= 2  # first mock send fails, worker retries
          assert any('Failed commands present' in e['body'].get('text','') for e in TelegramMock.events)
          s,deliveries=req(op,'/api/connectors/radius/alert-deliveries'); assert s==200
          assert deliveries['readiness']['ready'] is True
          assert any(x['channel']=='telegram' and x['status']=='failed' for x in deliveries['items'])
          assert any(x['channel']=='telegram' and x['status']=='sent' for x in deliveries['items'])
          # Re-evaluation must not enqueue duplicate transition messages.
          before_count=len(TelegramMock.events)
          s,_=req(op,'/api/connectors/radius/release-readiness'); assert s==200
          time.sleep(.2)
          assert len(TelegramMock.events)==before_count
          assert TelegramMock.token not in json.dumps(deliveries)
          assert TelegramMock.token not in json.dumps(outbox)

          # Disconnect reaches gateway exactly once and queue completes.
          gateway_before=len(Gateway.events)
          rid='REQ-V37-DISCONNECT'; s,q=req(op,'/api/connectors/radius','POST',session_payload(rid,'disconnect'),headers(csrf,rid)); assert s==202
          done=poll(op,q['commandId']); assert done['status']=='completed'; r=done['result']; assert r['effect']=='disconnected' and r['realNetworkCommandSent'] is True
          assert len(Gateway.events)==gateway_before+1 and Gateway.events[-1]['path'].endswith('/session-command') and Gateway.events[-1]['auth']==f'Bearer {TOKEN}'

          # Idempotent replay does not hit gateway twice.
          s,replay=req(op,'/api/connectors/radius','POST',session_payload(rid,'disconnect'),headers(csrf,rid)); assert s==200 and replay['idempotentReplay'] is True
          time.sleep(.15); assert len(Gateway.events)==gateway_before+1

          # Reauthenticate live command.
          rid2='REQ-V37-REAUTH'; s,q2=req(op,'/api/connectors/radius','POST',session_payload(rid2,'reauthenticate'),headers(csrf,rid2)); assert s==202
          d2=poll(op,q2['commandId']); assert d2['status']=='completed' and d2['result']['effect']=='reauthenticated'; assert len(Gateway.events)==gateway_before+2

          # Review-only is processed without gateway network command.
          rid3='REQ-V37-REVIEW'; s,q3=req(op,'/api/connectors/radius','POST',session_payload(rid3,'review'),headers(csrf,rid3)); assert s==202
          d3=poll(op,q3['commandId']); assert d3['status']=='completed' and d3['result']['realNetworkCommandSent'] is False; assert len(Gateway.events)==gateway_before+2

          # Node status reaches dedicated gateway path.
          rid4='REQ-V37-NODE'; node={'contractVersion':'1.0','requestId':rid4,'operation':'node-status','node':{'code':'NAS-A1','status':'maintenance'},'impact':{'affectedSessions':1,'disconnectedSessions':1},'client':{'product':'RADIUS-A','version':'Master v101','schemaVersion':101}}
          s,q4=req(op,'/api/connectors/radius/node-status','POST',node,headers(csrf,rid4)); assert s==202
          d4=poll(op,q4['commandId']); assert d4['status']=='completed' and d4['result']['realNetworkCommandSent'] is True; assert Gateway.events[-1]['path'].endswith('/node-status')

          # Authenticated metrics are aggregate-only; public Prometheus stays off by default.
          s,metrics=req(op,'/api/connectors/radius/metrics'); assert s==200
          assert metrics['summary']['requestsTotal'] > 0 and metrics['summary']['ledgerRequests'] >= 1
          assert metrics['summary']['http5xx'] >= 0 and metrics['summary']['queueHealth'] in {'healthy','warning','degraded'}
          assert 'omar.mansour' not in json.dumps(metrics)
          s,metrics_disabled=req(op,'/metrics'); assert s==404

          # Secrets must never appear in health/readiness/audit/ledger payloads.
          s,audit=req(op,'/api/connectors/radius/audit?limit=100'); assert s==200
          s,ledger=req(op,'/api/connectors/radius/requests?limit=100'); assert s==200
          schema_conn=sqlite3.connect(db)
          user_version=schema_conn.execute('PRAGMA user_version').fetchone()[0]
          migration_rows=schema_conn.execute('SELECT source_version,target_version,backend_build FROM schema_migrations').fetchall()
          schema_conn.close()
          assert user_version==30
          assert len(migration_rows)==1 and migration_rows[0][1]==30 and migration_rows[0][2]=='v37'
          schema_conn=sqlite3.connect(db)
          audit_cols={r[1] for r in schema_conn.execute('PRAGMA table_info(audit_events)').fetchall()}
          schema_conn.close()
          assert {'trace_id','correlation_id'} <= audit_cols
          schema_conn=sqlite3.connect(db)
          log_cols={r[1] for r in schema_conn.execute('PRAGMA table_info(log_delivery_outbox)').fetchall()}
          schema_conn.close()
          assert {'log_id','event_name','record_json','status','attempts'} <= log_cols
          schema_conn=sqlite3.connect(db)
          nonce_cols={r[1] for r in schema_conn.execute('PRAGMA table_info(gateway_auth_nonces)').fetchall()}
          schema_conn.close()
          assert {'nonce','key_id','actor','used_at','expires_at','trace_id'} <= nonce_cols
          schema_conn=sqlite3.connect(db)
          operator_cols={r[1] for r in schema_conn.execute('PRAGMA table_info(operator_accounts)').fetchall()}
          schema_conn.close()
          assert {'username','password_salt','password_hash','role','enabled','last_login_at','password_changed_at'} <= operator_cols

          dump=json.dumps({'h':h,'ready':ready,'release':release,'launchPre':launch_pre,'launchCheckpoint':launch_checkpoint,'launchGo':launch_go,'apiContract':contract_summary,'openapi':openapi_doc,'voucherReady':vready,'voucherResult':vresult,'voucherReplay':vreplay,'voucherList':voucher_list,'backupReplication':brepl,'backupReplicationReplay':brepl_replay,'backupReplications':repls_after,'alerts':alerts,'alertAck':acked,'outbox':outbox,'deliveries':deliveries,'ops':ops,'metrics':metrics,'backup':bcreate,'backupVerify':bverify,'restoreDrill':drill,'audit':audit,'ledger':ledger})
          assert TOKEN not in dump and VOUCHER_TOKEN not in dump and BACKUP_TOKEN not in dump and LOG_TOKEN not in dump and GATEWAY_HMAC_SECRET not in dump and GATEWAY_HMAC_PREVIOUS_SECRET not in dump and RADIUS_SECRET_VALUE not in dump
          assert 'coa-secret-super-private' not in dump and TelegramMock.token not in dump
          assert 'SHOULD-NEVER-BE-PERSISTED' not in dump
        finally: stop(p)

        # Release integrity: exact v37 backend + v101 UI + API-contract hash are pinned by SHA-256.
        integrity_dir=Path(td)/'integrity'
        integrity_dir.mkdir()
        # Ask the same backend for its deterministic contract hash with the runtime guard disabled.
        integrity_probe_env=os.environ.copy()
        integrity_probe_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
          'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'local-preview',
          'UCHIHA_LAUNCH_REQUIRE_HTTPS':'0','UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
          'UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0','UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'0',
          'UCHIHA_RELEASE_INTEGRITY_REQUIRED':'0'
        })
        integrity_probe=subprocess.run(
            [sys.executable,'-S','-B',str(BACKEND),'--check-config'],
            env=integrity_probe_env,capture_output=True,text=True,timeout=6
        )
        assert integrity_probe.returncode==0
        integrity_probe_payload=json.loads(integrity_probe.stdout.strip().splitlines()[-1])
        integrity_contract_sha=integrity_probe_payload['apiContract']['sha256']

        integrity_manifest=integrity_dir/'integrity.json'
        integrity_payload={
          'product':'UCHIHA RADIUS-A',
          'backendBuild':'v37','uiBuild':'v101','databaseSchemaVersion':30,
          'apiContractSha256':integrity_contract_sha,
          'protectedFiles':[
            {'name':BACKEND.name,'bytes':BACKEND.stat().st_size,
             'sha256':hashlib.sha256(BACKEND.read_bytes()).hexdigest()},
            {'name':'RADIUS-A-Master-v101.html',
             'bytes':(HERE/'RADIUS-A-Master-v101.html').stat().st_size,
             'sha256':hashlib.sha256((HERE/'RADIUS-A-Master-v101.html').read_bytes()).hexdigest()}
          ]
        }
        integrity_manifest.write_text(json.dumps(integrity_payload,sort_keys=True),encoding='utf-8')
        integrity_manifest_sha=hashlib.sha256(integrity_manifest.read_bytes()).hexdigest()

        integrity_db=Path(td)/'integrity.sqlite3'
        integrity_env=os.environ.copy()
        integrity_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
          'UCHIHA_CONNECTOR_PORT':str(PORT+8),'UCHIHA_CONNECTOR_DB':str(integrity_db),
          'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'local-preview',
          'UCHIHA_LAUNCH_REQUIRE_HTTPS':'0','UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
          'UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0','UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'1',
          'UCHIHA_RELEASE_INTEGRITY_REQUIRED':'1',
          'UCHIHA_RELEASE_INTEGRITY_MANIFEST':str(integrity_manifest),
          'UCHIHA_RELEASE_INTEGRITY_MANIFEST_SHA256':integrity_manifest_sha,
          'UCHIHA_ALERT_MONITOR_ENABLED':'0','UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0'
        })
        integrity_proc=subprocess.Popen(
            [sys.executable,'-S','-B',str(BACKEND)],
            env=integrity_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True
        )
        try:
          int_op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
          integrity_up=False
          for _ in range(40):
            try:
              with int_op.open(f'http://127.0.0.1:{PORT+8}/api/connectors/radius/health/live',timeout=1) as ir:
                body=json.loads(ir.read().decode())
                if ir.status==200 and body['alive'] is True:
                  integrity_up=True; break
            except Exception: pass
            time.sleep(.1)
          assert integrity_up
          with int_op.open(f'http://127.0.0.1:{PORT+8}/api/connectors/radius/auth-context?role=owner',timeout=2) as ir:
            iauth=json.loads(ir.read().decode())
          assert iauth['authenticated'] is True
          with int_op.open(f'http://127.0.0.1:{PORT+8}/api/connectors/radius/release-integrity',timeout=2) as ir:
            istate=json.loads(ir.read().decode())
          ri=istate['releaseIntegrity']
          assert ri['required'] is True and ri['verified'] is True
          assert ri['manifestPinned'] is True and ri['manifestSha256Matches'] is True
          assert ri['verifiedFiles']==2 and ri['protectedFiles']==2
          assert ri['backendBuildMatches'] is True and ri['uiBuildMatches'] is True
          assert ri['databaseSchemaMatches'] is True and ri['apiContractMatches'] is True
          assert ri['blockers']==[]
        finally:
          integrity_proc.terminate()
          try: integrity_proc.wait(timeout=5)
          except subprocess.TimeoutExpired: integrity_proc.kill()

        # Wrong file hash fails closed before the HTTP socket binds.
        bad_payload=json.loads(integrity_manifest.read_text())
        bad_payload['protectedFiles'][1]['sha256']='0'*64
        bad_manifest=integrity_dir/'bad-integrity.json'
        bad_manifest.write_text(json.dumps(bad_payload,sort_keys=True),encoding='utf-8')
        bad_env=integrity_env.copy()
        bad_env.update({
          'UCHIHA_CONNECTOR_PORT':str(PORT+9),
          'UCHIHA_RELEASE_INTEGRITY_MANIFEST':str(bad_manifest),
          'UCHIHA_RELEASE_INTEGRITY_MANIFEST_SHA256':hashlib.sha256(bad_manifest.read_bytes()).hexdigest()
        })
        bad_integrity=subprocess.run(
            [sys.executable,'-S','-B',str(BACKEND)],
            env=bad_env,capture_output=True,text=True,timeout=6
        )
        assert bad_integrity.returncode!=0
        assert 'release-integrity-file-mismatch:RADIUS-A-Master-v101.html' in (bad_integrity.stdout+bad_integrity.stderr)

        # Correct file manifest with the wrong pinned manifest SHA also fails closed.
        pin_env=integrity_env.copy()
        pin_env.update({
          'UCHIHA_CONNECTOR_PORT':str(PORT+10),
          'UCHIHA_RELEASE_INTEGRITY_MANIFEST_SHA256':'f'*64
        })
        bad_pin=subprocess.run(
            [sys.executable,'-S','-B',str(BACKEND)],
            env=pin_env,capture_output=True,text=True,timeout=6
        )
        assert bad_pin.returncode!=0
        assert 'release-integrity-manifest-sha-mismatch' in (bad_pin.stdout+bad_pin.stderr)

        # Single-instance SQLite lease blocks a second active backend on the same DB, even on another port.
        lease_db=Path(td)/'single-instance.sqlite3'
        lease_p1=start(lease_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1])
        lease_op=opener()
        try:
          wait_ready(lease_op); lease_csrf=auth(lease_op)
          s,lease_state=req(lease_op,'/api/connectors/radius/instance-lock'); assert s==200
          il=lease_state['instanceLease']
          assert il['held'] is True and il['ready'] is True and il['ownerPid']==lease_p1.pid
          second_env=os.environ.copy(); second_env.update({
            'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
            'UCHIHA_CONNECTOR_PORT':str(PORT+11),'UCHIHA_CONNECTOR_DB':str(lease_db),
            'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'local-preview',
            'UCHIHA_RELEASE_INTEGRITY_REQUIRED':'0','UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'0',
            'UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION':'0','UCHIHA_LAUNCH_REQUIRE_HTTPS':'0','UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
            'UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0','UCHIHA_INSTANCE_LOCK_REQUIRED':'1','UCHIHA_LAUNCH_REQUIRE_INSTANCE_LOCK':'1'
          })
          second=subprocess.run([sys.executable,'-S','-B',str(BACKEND)],env=second_env,capture_output=True,text=True,timeout=6)
          assert second.returncode!=0
          assert 'database instance lock is already held' in (second.stdout+second.stderr)
          assert str(lease_p1.pid) in (second.stdout+second.stderr)
          check_locked=subprocess.run([sys.executable,'-S','-B',str(BACKEND),'--check-config'],env=second_env,capture_output=True,text=True,timeout=6)
          assert check_locked.returncode==2
          locked=json.loads(check_locked.stdout.strip().splitlines()[-1])
          assert locked['instanceLease']['available'] is False and locked['instanceLease']['ownerPid']==lease_p1.pid
        finally:
          stop(lease_p1)

        # Kernel releases flock when the owner exits; replacement process can start on the same DB.
        restart_env=os.environ.copy(); restart_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1','UCHIHA_CONNECTOR_PORT':str(PORT+11),
          'UCHIHA_CONNECTOR_DB':str(lease_db),'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'local-preview',
          'UCHIHA_RELEASE_INTEGRITY_REQUIRED':'0','UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'0',
          'UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION':'0','UCHIHA_LAUNCH_REQUIRE_HTTPS':'0','UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
          'UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0','UCHIHA_INSTANCE_LOCK_REQUIRED':'1','UCHIHA_LAUNCH_REQUIRE_INSTANCE_LOCK':'1'
        })
        lease_p2=subprocess.Popen([sys.executable,'-S','-B',str(BACKEND)],env=restart_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
          ready=False
          for _ in range(60):
            try:
              with urllib.request.urlopen(f'http://127.0.0.1:{PORT+11}/api/connectors/radius/health',timeout=1) as rr:
                if rr.status==200: ready=True; break
            except Exception: pass
            time.sleep(.1)
          assert ready
        finally: stop(lease_p2)

        # Edge concurrency ceiling rejects excess connections before creating more request threads.
        edge_db=Path(td)/'edge-capacity.sqlite3'
        edge_env=os.environ.copy()
        edge_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
          'UCHIHA_CONNECTOR_PORT':str(PORT),'UCHIHA_CONNECTOR_DB':str(edge_db),
          'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'local-preview',
          'UCHIHA_LAUNCH_REQUIRE_HTTPS':'0','UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
          'UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0','UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'0',
          'UCHIHA_RELEASE_INTEGRITY_REQUIRED':'0',
          'UCHIHA_EDGE_MAX_CONCURRENT_REQUESTS':'2',
          'UCHIHA_EDGE_SOCKET_TIMEOUT_SECONDS':'2',
          'UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_LIMIT':'3',
          'UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS':'1',
          'UCHIHA_ALERT_MONITOR_ENABLED':'0','UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0'
        })
        ep=subprocess.Popen(
            [sys.executable,'-S','-B',str(BACKEND)],
            env=edge_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True
        )
        edge_op=opener()
        blockers=[]
        try:
          wait_ready(edge_op)
          # Two deliberately incomplete header blocks occupy the complete server capacity.
          for _ in range(2):
              sock=socket.create_connection(('127.0.0.1',PORT),timeout=2)
              sock.sendall(b'GET /api/connectors/radius/health/live HTTP/1.1\r\nHost: localhost\r\n')
              blockers.append(sock)
          time.sleep(.15)

          third=socket.create_connection(('127.0.0.1',PORT),timeout=2)
          third.sendall(b'GET /api/connectors/radius/health/live HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
          third.settimeout(2)
          raw=b''
          while True:
              try:
                  part=third.recv(4096)
              except socket.timeout:
                  break
              if not part: break
              raw+=part
          third.close()
          assert b'503 Service Unavailable' in raw
          assert b'server_capacity_exceeded' in raw

          for sock in blockers:
              sock.close()
          blockers.clear()
          time.sleep(.15)

          ecsrf=auth(edge_op)
          s,edge_state=req(edge_op,'/api/connectors/radius/edge-protection'); assert s==200
          edge=edge_state['edgeProtection']
          assert edge['ready'] is True
          assert edge['maxConcurrentRequests']==2
          assert edge['peakActiveRequests']>=2
          assert edge['capacityRejectedTotal']>=1
          assert edge['socketTimeoutSeconds']==2.0
          assert edge['gatewayAuthFailureLimit']==3
        finally:
          for sock in blockers:
              try: sock.close()
              except Exception: pass
          stop(ep)

        # Production operator session: bootstrap owner, scrypt password, CSRF, RBAC and logout.
        operator_db=Path(td)/'operator-session.sqlite3'
        operator_password_file=Path(td)/'operator-owner-password'
        operator_password='Operator-Session-Secret-2026!'
        operator_password_file.write_text(operator_password+'\n',encoding='utf-8')
        operator_password_file.chmod(0o600)
        operator_op=opener()
        operator_extra={
            **direct_extra,
            'UCHIHA_CONNECTOR_AUTH_MODE':'hybrid',
            'UCHIHA_BOOTSTRAP_OWNER_USERNAME':'root.owner',
            'UCHIHA_BOOTSTRAP_OWNER_PASSWORD_FILE':str(operator_password_file),
            'UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET':GATEWAY_HMAC_SECRET,
            'UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID':'primary-2026',
            'UCHIHA_GATEWAY_REQUIRE_HTTPS':'0',
            'UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
            'UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION':'1',
            'UCHIHA_OPERATOR_LOGIN_FAILURE_LIMIT':'3',
            'UCHIHA_OPERATOR_LOGIN_FAILURE_WINDOW_SECONDS':'1',
        }
        op_proc=start(operator_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],operator_extra)
        operator_stdout=''
        try:
          wait_ready(operator_op)

          # Browser has no automatic preview session in production/hybrid auth mode.
          s,ctx,_=req_meta(operator_op,'/api/connectors/radius/auth-context')
          assert s==401 and ctx['authenticated'] is False
          assert ctx['loginRequired'] is True and ctx['mode']=='hybrid'

          # Bad password is generic and never reveals whether the user exists.
          bad_login={
              'contractVersion':'1.0','requestId':'LOGIN-V35-BAD-001',
              'operation':'operator-login','username':'root.owner','password':'wrong-password-value'
          }
          s,bad,_=req_meta(operator_op,'/api/connectors/radius/session/login','POST',bad_login,{'X-Uchiha-Contract':'1.0'})
          assert s==401 and bad['error']['code']=='invalid_credentials'

          # Login failures are independently rate-limited by peer + username.
          for idx in range(3):
              bad_unknown={
                  'contractVersion':'1.0',
                  'requestId':f'LOGIN-V35-RATE-{idx:03d}',
                  'operation':'operator-login','username':'locked.user',
                  'password':'not-the-right-password'
              }
              s,_,_=req_meta(operator_op,'/api/connectors/radius/session/login','POST',bad_unknown,{'X-Uchiha-Contract':'1.0'})
              assert s==401
          rate_limited={
              'contractVersion':'1.0','requestId':'LOGIN-V35-RATE-LIMIT',
              'operation':'operator-login','username':'locked.user','password':'still-wrong-password'
          }
          s,limited_login,_=req_meta(operator_op,'/api/connectors/radius/session/login','POST',rate_limited,{'X-Uchiha-Contract':'1.0'})
          assert s==429 and limited_login['error']['code']=='operator_login_rate_limited'

          login={
              'contractVersion':'1.0','requestId':'LOGIN-V35-GOOD-001',
              'operation':'operator-login','username':'root.owner','password':operator_password
          }
          s,logged,login_headers=req_meta(operator_op,'/api/connectors/radius/session/login','POST',login,{'X-Uchiha-Contract':'1.0'})
          assert s==200 and logged['authenticated'] is True and logged['role']=='owner'
          assert logged['mode']=='hybrid'
          cookie=login_headers.get('Set-Cookie','')
          assert 'HttpOnly' in cookie and 'SameSite=Strict' in cookie
          # This local test is plain HTTP with HTTPS policy relaxed, so Secure is not required here.
          csrf=logged['csrfToken']

          s,ctx,_=req_meta(operator_op,'/api/connectors/radius/auth-context')
          assert s==200 and ctx['actor']=='root.owner' and ctx['role']=='owner'
          assert ctx['csrfToken']==csrf

          # Account listing never exposes password hash/salt.
          s,accounts,_=req_meta(operator_op,'/api/connectors/radius/operator-accounts')
          assert s==200 and accounts['passwordHashesExposed'] is False
          assert any(x['username']=='root.owner' and x['role']=='owner' for x in accounts['items'])
          account_dump=json.dumps(accounts)
          assert operator_password not in account_dump
          assert 'password_hash' not in account_dump and 'password_salt' not in account_dump

          # Owner creates a support account; request password is write-only and not returned.
          support_password='Support-Account-Secret-2026!'
          set_support={
              'contractVersion':'1.0','requestId':'REQ-V37-OPERATOR-SUPPORT',
              'operation':'set-operator-account','username':'support.one',
              'role':'support','enabled':True,'password':support_password
          }
          s,support_resp,_=req_meta(
              operator_op,'/api/connectors/radius/operator-accounts','POST',set_support,
              {'X-Uchiha-Contract':'1.0','X-Uchiha-CSRF':csrf}
          )
          assert s==200 and support_resp['item']['username']=='support.one'
          assert support_resp['item']['role']=='support' and support_resp['passwordHashExposed'] is False
          assert support_password not in json.dumps(support_resp)

          # Missing/wrong CSRF cannot mutate operator accounts.
          bad_csrf={**set_support,'requestId':'REQ-V37-OPERATOR-CSRF','enabled':False}
          s,csrf_denied,_=req_meta(
              operator_op,'/api/connectors/radius/operator-accounts','POST',bad_csrf,
              {'X-Uchiha-Contract':'1.0','X-Uchiha-CSRF':'wrong-csrf-token'}
          )
          assert s==403 and csrf_denied['error']['code']=='csrf_invalid'

          # Last enabled owner cannot be disabled.
          disable_owner={
              'contractVersion':'1.0','requestId':'REQ-V37-LAST-OWNER',
              'operation':'set-operator-account','username':'root.owner',
              'role':'owner','enabled':False
          }
          s,last_owner,_=req_meta(
              operator_op,'/api/connectors/radius/operator-accounts','POST',disable_owner,
              {'X-Uchiha-Contract':'1.0','X-Uchiha-CSRF':csrf}
          )
          assert s==409 and last_owner['error']['code']=='last_owner_required'

          # Hybrid mode still accepts a correctly signed server-to-server Gateway request.
          gateway_path='/api/connectors/radius/auth-context'
          hybrid_h=gateway_signed_headers(
              GATEWAY_HMAC_SECRET,'primary-2026','GET',gateway_path,
              nonce='NONCE-HYBRID-GATEWAY-0001'
          )
          # HTTPS boundary is disabled in this local hybrid test, so forwarded headers are harmless.
          hybrid_h.pop('X-Forwarded-Proto',None); hybrid_h.pop('X-Forwarded-For',None)
          s,hybrid_ctx,_=req_meta(operator_op,gateway_path,headers=hybrid_h)
          assert s==200 and hybrid_ctx['mode']=='gateway'
          assert hybrid_ctx['actor']=='gateway-admin' and hybrid_ctx['role']=='owner'

          # Logout requires CSRF and revokes the cookie session.
          logout_body={
              'contractVersion':'1.0','requestId':'LOGOUT-V35-001','operation':'operator-logout'
          }
          s,logout_resp,logout_headers=req_meta(
              operator_op,'/api/connectors/radius/session/logout','POST',logout_body,
              {'X-Uchiha-Contract':'1.0','X-Uchiha-CSRF':csrf}
          )
          assert s==200 and logout_resp['authenticated'] is False
          assert 'Max-Age=0' in logout_headers.get('Set-Cookie','')
          s,ctx_after,_=req_meta(operator_op,'/api/connectors/radius/auth-context')
          assert s==401 and ctx_after['loginRequired'] is True

          # Persistent DB stores only salt/hash, not plaintext password.
          oc=sqlite3.connect(operator_db)
          owner_row=oc.execute(
              "SELECT username,password_salt,password_hash,role,enabled FROM operator_accounts WHERE username='root.owner'"
          ).fetchone()
          oc.close()
          assert owner_row and owner_row[3]=='owner' and owner_row[4]==1
          assert owner_row[1] != operator_password and owner_row[2] != operator_password
          assert len(owner_row[1])==32 and len(owner_row[2])==64
        finally:
          stop(op_proc)
          if op_proc.stdout:
              operator_stdout=op_proc.stdout.read()
          if op_proc.stderr:
              operator_stdout+=op_proc.stderr.read()
        assert operator_password not in operator_stdout
        assert 'Support-Account-Secret-2026!' not in operator_stdout

        # Insecure bootstrap password-file permissions fail closed before binding.
        insecure_db=Path(td)/'operator-insecure-bootstrap.sqlite3'
        insecure_file=Path(td)/'operator-insecure-password'
        insecure_file.write_text('Insecure-Bootstrap-Password-2026!\\n',encoding='utf-8')
        insecure_file.chmod(0o644)
        insecure_env=os.environ.copy(); insecure_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
          'UCHIHA_CONNECTOR_PORT':str(PORT+11),'UCHIHA_CONNECTOR_DB':str(insecure_db),
          'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'operator-session',
          'UCHIHA_BOOTSTRAP_OWNER_USERNAME':'owner',
          'UCHIHA_BOOTSTRAP_OWNER_PASSWORD_FILE':str(insecure_file),
          'UCHIHA_LAUNCH_REQUIRE_HTTPS':'0','UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC':'0',
          'UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION':'1',
          'UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP':'0',
          'UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY':'0','UCHIHA_RELEASE_INTEGRITY_REQUIRED':'0'
        })
        insecure_boot=subprocess.run(
            [sys.executable,'-S','-B',str(BACKEND)],
            env=insecure_env,capture_output=True,text=True,timeout=6
        )
        assert insecure_boot.returncode!=0
        assert 'secure bootstrap password file' in (insecure_boot.stdout+insecure_boot.stderr)

        # Gateway mode fails closed unless HMAC signing and HTTPS trust boundaries are configured.
        missing_gateway_db=Path(td)/'gateway-missing-secret.sqlite3'
        missing_gateway_env=os.environ.copy(); missing_gateway_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
          'UCHIHA_CONNECTOR_PORT':str(PORT+7),'UCHIHA_CONNECTOR_DB':str(missing_gateway_db),
          'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'gateway',
          'UCHIHA_PUBLIC_HTTPS_REQUIRED':'1','UCHIHA_TRUST_PROXY_HEADERS':'1',
          'UCHIHA_TRUSTED_PROXY_CIDRS':'127.0.0.1/32','UCHIHA_COOKIE_SECURE':'1','UCHIHA_HSTS_ENABLED':'1'
        })
        missing_gateway=subprocess.run([sys.executable,'-S','-B',str(BACKEND)],env=missing_gateway_env,capture_output=True,text=True,timeout=5)
        assert missing_gateway.returncode!=0
        assert 'gateway-hmac-secret-required' in (missing_gateway.stdout+missing_gateway.stderr)

        gateway_db=Path(td)/'gateway-hmac.sqlite3'; gop=opener()
        gateway_extra={
            **direct_extra,
            'UCHIHA_CONNECTOR_ADAPTER':'preview','UCHIHA_CONNECTOR_AUTH_MODE':'gateway',
            'UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET':GATEWAY_HMAC_SECRET,
            'UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID':'primary-2026',
            'UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_SECRET':GATEWAY_HMAC_PREVIOUS_SECRET,
            'UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_KEY_ID':'previous-2025',
            'UCHIHA_CONNECTOR_GATEWAY_HMAC_MAX_SKEW':'120','UCHIHA_CONNECTOR_GATEWAY_NONCE_RETENTION':'600',
            'UCHIHA_GATEWAY_REQUIRE_HTTPS':'1','UCHIHA_GATEWAY_LEGACY_KEY_AUTH':'0',
            'UCHIHA_CONNECTOR_GATEWAY_KEY':GATEWAY_LEGACY_KEY,
            'UCHIHA_PUBLIC_HTTPS_REQUIRED':'1','UCHIHA_TRUST_PROXY_HEADERS':'1',
            'UCHIHA_TRUSTED_PROXY_CIDRS':'127.0.0.1/32','UCHIHA_REJECT_UNTRUSTED_PROXY_HEADERS':'1',
            'UCHIHA_COOKIE_SECURE':'1','UCHIHA_HSTS_ENABLED':'1',
            'UCHIHA_ALERT_MONITOR_ENABLED':'0','UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0','UCHIHA_LOG_REMOTE_ENABLE':'0',
        }
        gp=start(gateway_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],gateway_extra)
        gateway_persist_nonce='NONCE-PERSIST-0000000001'; gateway_persist_headers=None
        try:
          live_ok=False
          for _ in range(40):
            try:
              s,glive,_=req_meta(gop,'/api/connectors/radius/health/live',headers={'X-Forwarded-Proto':'https','X-Forwarded-For':'203.0.113.90'})
              if s==200: live_ok=True; assert glive['alive'] is True; break
            except Exception: pass
            time.sleep(.1)
          assert live_ok
          auth_path='/api/connectors/radius/auth-context'
          gh=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','GET',auth_path,nonce='NONCE-AUTH-VALID-000001')
          s,gctx,ghdr=req_meta(gop,auth_path,headers=gh)
          assert s==200 and gctx['authenticated'] is True and gctx['mode']=='gateway' and gctx['role']=='owner'
          assert ghdr.get('X-Transport-Security')=='https'
          s,replayed,_=req_meta(gop,auth_path,headers=gh); assert s==409 and replayed['error']['code']=='gateway_replay_detected'

          tamper_h=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','GET',auth_path,role='owner',nonce='NONCE-TAMPER-ROLE-00001')
          tamper_h['X-Uchiha-Role']='auditor'
          s,tampered,_=req_meta(gop,auth_path,headers=tamper_h); assert s==401 and tampered['error']['code']=='gateway_signature_invalid'

          expired_h=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','GET',auth_path,nonce='NONCE-EXPIRED-000000001',timestamp=int(time.time())-1000)
          s,expired,_=req_meta(gop,auth_path,headers=expired_h); assert s==401 and expired['error']['code']=='gateway_signature_expired'

          previous_h=gateway_signed_headers(GATEWAY_HMAC_PREVIOUS_SECRET,'previous-2025','GET',auth_path,nonce='NONCE-PREVIOUS-00000001')
          s,previous_ctx,_=req_meta(gop,auth_path,headers=previous_h); assert s==200 and previous_ctx['authenticated'] is True

          legacy_h={'X-Forwarded-Proto':'https','X-Forwarded-For':'203.0.113.90','X-Uchiha-Gateway-Key':GATEWAY_LEGACY_KEY,'X-Uchiha-Actor':'gateway-admin','X-Uchiha-Role':'owner'}
          s,legacy_resp,_=req_meta(gop,auth_path,headers=legacy_h); assert s==401 and legacy_resp['error']['code']=='gateway_signature_required'

          maint_path='/api/connectors/radius/runtime-control/maintenance'
          maint_body={'contractVersion':'1.0','requestId':'REQ-V37-GATEWAY-MAINT-ON','operation':'set-maintenance','enabled':True,'reason':'signed-maintenance'}
          maint_h=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','POST',maint_path,body=maint_body,nonce='NONCE-MAINT-VALID-000001')
          s,gmaint,_=req_meta(gop,maint_path,'POST',maint_body,maint_h); assert s==200 and gmaint['maintenance']['enabled'] is True

          signed_original={'contractVersion':'1.0','requestId':'REQ-V37-GATEWAY-TAMPER','operation':'set-maintenance','enabled':False,'reason':'original'}
          tampered_body={**signed_original,'reason':'modified-after-signing'}
          body_h=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','POST',maint_path,body=signed_original,nonce='NONCE-BODY-TAMPER-000001')
          s,body_tamper,_=req_meta(gop,maint_path,'POST',tampered_body,body_h); assert s==401 and body_tamper['error']['code']=='gateway_signature_invalid'

          off_body={'contractVersion':'1.0','requestId':'REQ-V37-GATEWAY-MAINT-OFF','operation':'set-maintenance','enabled':False,'reason':''}
          off_h=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','POST',maint_path,body=off_body,nonce='NONCE-MAINT-OFF-0000001')
          s,goff,_=req_meta(gop,maint_path,'POST',off_body,off_h); assert s==200 and goff['maintenance']['enabled'] is False

          gateway_state_path='/api/connectors/radius/gateway-authentication'
          state_h=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','GET',gateway_state_path,nonce='NONCE-GATEWAY-STATE-0001')
          s,gstate,_=req_meta(gop,gateway_state_path,headers=state_h); assert s==200
          ga=gstate['gatewayAuthentication']
          assert ga['active'] is True and ga['ready'] is True and ga['scheme']=='hmac-sha256-v1'
          assert ga['currentKeyId']=='primary-2026' and ga['previousKeyId']=='previous-2025'
          assert ga['replayProtection'] is True and ga['noncePersistence'] is True
          assert GATEWAY_HMAC_SECRET not in json.dumps(gstate) and GATEWAY_HMAC_PREVIOUS_SECRET not in json.dumps(gstate)

          gateway_persist_headers=gateway_signed_headers(GATEWAY_HMAC_SECRET,'primary-2026','GET',auth_path,nonce=gateway_persist_nonce)
          s,persist_first,_=req_meta(gop,auth_path,headers=gateway_persist_headers); assert s==200
        finally: stop(gp)

        gop2=opener(); gp2=start(gateway_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],gateway_extra)
        try:
          live_ok=False
          for _ in range(40):
            try:
              s,_,_=req_meta(gop2,'/api/connectors/radius/health/live',headers={'X-Forwarded-Proto':'https','X-Forwarded-For':'203.0.113.90'})
              if s==200: live_ok=True; break
            except Exception: pass
            time.sleep(.1)
          assert live_ok
          s,persist_replay,_=req_meta(gop2,'/api/connectors/radius/auth-context',headers=gateway_persist_headers)
          assert s==409 and persist_replay['error']['code']=='gateway_replay_detected'
          gc=sqlite3.connect(gateway_db); nonce_rows=gc.execute('SELECT nonce,key_id,actor FROM gateway_auth_nonces WHERE nonce=?',(gateway_persist_nonce,)).fetchall(); gc.close()
          assert len(nonce_rows)==1 and nonce_rows[0][1]=='primary-2026'
        finally: stop(gp2)

        # Failed HMAC attempts are rate-limited before RBAC/normal authenticated request accounting.
        rate_db=Path(td)/'gateway-rate-limit.sqlite3'
        rate_op=opener()
        rate_extra={
            **gateway_extra,
            'UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_LIMIT':'3',
            'UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS':'1',
        }
        rp=start(rate_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],rate_extra)
        try:
          live_ok=False
          for _ in range(40):
            try:
              s,_,_=req_meta(
                  rate_op,'/api/connectors/radius/health/live',
                  headers={'X-Forwarded-Proto':'https','X-Forwarded-For':'203.0.113.90'}
              )
              if s==200: live_ok=True; break
            except Exception: pass
            time.sleep(.1)
          assert live_ok

          rate_path='/api/connectors/radius/auth-context'
          for idx in range(3):
              bad_h=gateway_signed_headers(
                  GATEWAY_HMAC_SECRET,'primary-2026','GET',rate_path,
                  nonce=f'NONCE-RATE-BAD-{idx:08d}-X'
              )
              bad_h['X-Uchiha-Gateway-Signature']='sha256='+'0'*64
              s,bad_resp,_=req_meta(rate_op,rate_path,headers=bad_h)
              assert s==401 and bad_resp['error']['code']=='gateway_signature_invalid'

          fourth=gateway_signed_headers(
              GATEWAY_HMAC_SECRET,'primary-2026','GET',rate_path,
              nonce='NONCE-RATE-BLOCKED-00001'
          )
          fourth['X-Uchiha-Gateway-Signature']='sha256='+'0'*64
          s,limited,_=req_meta(rate_op,rate_path,headers=fourth)
          assert s==429 and limited['error']['code']=='gateway_auth_rate_limited'

          time.sleep(1.2)
          valid_h=gateway_signed_headers(
              GATEWAY_HMAC_SECRET,'primary-2026','GET',rate_path,
              nonce='NONCE-RATE-RECOVER-00001'
          )
          s,recovered,_=req_meta(rate_op,rate_path,headers=valid_h)
          assert s==200 and recovered['authenticated'] is True

          edge_path='/api/connectors/radius/edge-protection'
          edge_h=gateway_signed_headers(
              GATEWAY_HMAC_SECRET,'primary-2026','GET',edge_path,
              nonce='NONCE-RATE-EDGE-STATE-001'
          )
          s,rate_state,_=req_meta(rate_op,edge_path,headers=edge_h)
          assert s==200
          assert rate_state['edgeProtection']['gatewayAuthFailureLimit']==3
          assert rate_state['edgeProtection']['gatewayAuthFailureRecordedTotal']>=3
          assert rate_state['edgeProtection']['gatewayPreAuthRateLimit'] is True
        finally: stop(rp)

        # Transport-security boundary behind a trusted reverse proxy.
        transport_db=Path(td)/'transport-security.sqlite3'
        top=opener()
        transport_extra={
            **direct_extra,
            'UCHIHA_PUBLIC_HTTPS_REQUIRED':'1',
            'UCHIHA_TRUST_PROXY_HEADERS':'1',
            'UCHIHA_TRUSTED_PROXY_CIDRS':'127.0.0.1/32',
            'UCHIHA_REJECT_UNTRUSTED_PROXY_HEADERS':'1',
            'UCHIHA_COOKIE_SECURE':'1',
            'UCHIHA_HSTS_ENABLED':'1',
            'UCHIHA_HSTS_MAX_AGE':'31536000',
            'UCHIHA_ALERT_MONITOR_ENABLED':'0',
            'UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0',
            'UCHIHA_LOG_REMOTE_ENABLE':'0',
        }
        tp=start(transport_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],transport_extra)
        proxy_headers={
            'X-Forwarded-Proto':'https',
            'X-Forwarded-For':'203.0.113.77',
        }
        try:
          # Direct backend HTTP is refused when public HTTPS is required.
          direct_ready=False
          for _ in range(40):
            try:
              s,blocked,_=req_meta(top,'/api/connectors/radius/health/live')
              if s==426:
                direct_ready=True
                assert blocked['error']['code']=='https_required'
                break
            except Exception:
              pass
            time.sleep(.1)
          assert direct_ready

          # Same request from the configured trusted proxy with https is accepted.
          s,secure_ready,secure_headers=req_meta(top,'/api/connectors/radius/health/live',headers=proxy_headers)
          assert s==200 and secure_ready['alive'] is True
          assert secure_headers.get('X-Transport-Security')=='https'
          assert secure_headers.get('X-Trusted-Proxy')=='1'
          assert secure_headers.get('Strict-Transport-Security','').startswith('max-age=31536000')

          # Production operator-session cookie becomes Secure on a trusted HTTPS request.
          transport_login={
              'contractVersion':'1.0','requestId':'LOGIN-V35-TRANSPORT-001',
              'operation':'operator-login','username':'owner','password':'Owner-Test-Password-2026!'
          }
          s,tauth,tauth_headers=req_meta(
              top,'/api/connectors/radius/session/login','POST',transport_login,
              {**proxy_headers,'X-Uchiha-Contract':'1.0'}
          )
          assert s==200 and tauth['authenticated'] is True
          set_cookie=tauth_headers.get('Set-Cookie','')
          assert 'HttpOnly' in set_cookie and 'SameSite=Strict' in set_cookie and 'Secure' in set_cookie
          cookie_pair=set_cookie.split(';',1)[0]

          secure_auth_headers={**proxy_headers,'Cookie':cookie_pair}
          s,tstate,tstate_headers=req_meta(
              top,'/api/connectors/radius/transport-security',headers=secure_auth_headers
          )
          assert s==200
          ts=tstate['transportSecurity']
          assert ts['publicHttpsRequired'] is True
          assert ts['trustProxyHeaders'] is True and ts['trustedProxyCount']==1
          assert ts['httpsEnforcementReady'] is True
          assert ts['secureCookiePolicy'] is True and ts['hstsEnabled'] is True
          assert tstate['request']['secure'] is True
          assert tstate['request']['trustedProxy'] is True
          assert tstate['request']['clientIp']=='203.0.113.77'
          assert tstate['request']['forwardedProto']=='https'
          assert tstate_headers.get('Strict-Transport-Security','').startswith('max-age=31536000')

          # A trusted proxy explicitly forwarding http is still refused.
          s,http_forwarded,_=req_meta(
              top,'/api/connectors/radius/health/live',
              headers={'X-Forwarded-Proto':'http','X-Forwarded-For':'203.0.113.77'}
          )
          assert s==426 and http_forwarded['error']['code']=='https_required'
        finally:
          stop(tp)

        # Forwarded headers from a peer outside the trusted CIDR are never honored.
        spoof_db=Path(td)/'transport-spoof.sqlite3'
        sopx=opener()
        spoof_extra={
            **direct_extra,
            'UCHIHA_PUBLIC_HTTPS_REQUIRED':'1',
            'UCHIHA_TRUST_PROXY_HEADERS':'1',
            'UCHIHA_TRUSTED_PROXY_CIDRS':'10.0.0.0/8',
            'UCHIHA_REJECT_UNTRUSTED_PROXY_HEADERS':'1',
            'UCHIHA_COOKIE_SECURE':'1',
            'UCHIHA_HSTS_ENABLED':'1',
            'UCHIHA_ALERT_MONITOR_ENABLED':'0',
            'UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0',
        }
        spx=start(spoof_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],spoof_extra)
        try:
          spoof_seen=False
          for _ in range(40):
            try:
              s,spoofed,_=req_meta(
                  sopx,'/api/connectors/radius/health/live',
                  headers={'X-Forwarded-Proto':'https','X-Forwarded-For':'198.51.100.8'}
              )
              if s==403:
                spoof_seen=True
                assert spoofed['error']['code']=='untrusted_proxy_headers'
                break
            except Exception:
              pass
            time.sleep(.1)
          assert spoof_seen
        finally:
          stop(spx)

        # Invalid trusted-proxy CIDR fails closed before the service binds.
        invalid_proxy_db=Path(td)/'invalid-proxy.sqlite3'
        invalid_env=os.environ.copy(); invalid_env.update({
          'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
          'UCHIHA_CONNECTOR_PORT':str(PORT+6),
          'UCHIHA_CONNECTOR_DB':str(invalid_proxy_db),
          'UCHIHA_CONNECTOR_ADAPTER':'preview',
          'UCHIHA_TRUST_PROXY_HEADERS':'1',
          'UCHIHA_TRUSTED_PROXY_CIDRS':'definitely-not-a-cidr',
        })
        invalid_proxy=subprocess.run(
            [sys.executable,'-S','-B',str(BACKEND)],
            env=invalid_env,capture_output=True,text=True,timeout=5
        )
        assert invalid_proxy.returncode!=0
        assert 'invalid UCHIHA_TRUSTED_PROXY_CIDRS' in (invalid_proxy.stdout+invalid_proxy.stderr)

        # Dedicated observability run: trace/correlation headers, audit linking and structured JSON logs.
        log_db=Path(td)/'trace-log.sqlite3'
        lop=opener()
        log_extra={**direct_extra,'UCHIHA_LOG_FORMAT':'json','UCHIHA_LOG_LEVEL':'INFO','UCHIHA_LOG_HTTP':'1',
                   'UCHIHA_QUEUE_WORKER_ENABLED':'1','UCHIHA_ALERT_MONITOR_ENABLED':'0',
                   'UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0'}
        lp=start(log_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],log_extra)
        trace_id='TRACE-OBS-0001'; correlation_id='COR-OBS-0001'
        command_trace='TRACE-CMD-0001'; command_corr='COR-CMD-0001'
        try:
          wait_ready(lop); lcsrf=auth(lop)
          s,lconn=req(lop,'/api/connectors/radius/connectivity-check'); assert s==200 and lconn['overallReachable'] is True
          s,traced,traced_headers=req_meta(
              lop,'/api/connectors/radius/metrics',
              headers={'X-Request-ID':trace_id,'X-Correlation-ID':correlation_id}
          )
          assert s==200
          assert traced['traceId']==trace_id and traced['correlationId']==correlation_id
          assert traced_headers.get('X-Request-ID')==trace_id
          assert traced_headers.get('X-Correlation-ID')==correlation_id

          # Invalid caller trace IDs are not reflected.
          s,generated,generated_headers=req_meta(
              lop,'/api/connectors/radius/metrics',
              headers={'X-Request-ID':'bad trace id with spaces'}
          )
          assert s==200 and generated_headers.get('X-Request-ID','').startswith('HTTP-')
          assert generated['traceId']==generated_headers.get('X-Request-ID')

          # Body/header correlation follows a queued command and is echoed in response headers.
          crid='REQ-V37-TRACE-COMMAND'
          cbody=session_payload(crid,'review'); cbody['correlationId']=command_corr
          ch={**headers(lcsrf,crid),'X-Request-ID':command_trace,'X-Correlation-ID':command_corr}
          s,cq,chdr=req_meta(lop,'/api/connectors/radius','POST',cbody,ch,timeout=4)
          assert s==202 and cq['correlationId']==command_corr and cq['traceId']==command_trace
          assert chdr.get('X-Request-ID')==command_trace and chdr.get('X-Correlation-ID')==command_corr
          cdone=poll(lop,cq['commandId']); assert cdone['status']=='completed'

          s,trace_audit=req(lop,'/api/connectors/radius/audit?limit=100'); assert s==200
          metrics_audit=next(x for x in trace_audit['items'] if x['action']=='metrics.read' and x['traceId']==trace_id)
          assert metrics_audit['correlationId']==correlation_id
          queue_audit=next(x for x in trace_audit['items'] if x['action']=='queue.review' and x['requestId']==crid and x['outcome']=='queued')
          assert queue_audit['traceId']==command_trace and queue_audit['correlationId']==command_corr
        finally:
          stop(lp)

        log_stdout=(lp.stdout.read() if lp.stdout else '')
        log_stderr=(lp.stderr.read() if lp.stderr else '')
        json_logs=[]
        for line in log_stdout.splitlines():
          line=line.strip()
          if line.startswith('{'):
            try: json_logs.append(json.loads(line))
            except Exception: pass
        assert any(x.get('event')=='service.start' and x.get('backendBuild')=='v37' for x in json_logs)
        traced_log=next(x for x in json_logs if x.get('event')=='http.response' and x.get('traceId')==trace_id)
        assert traced_log['correlationId']==correlation_id and traced_log['route']=='/api/connectors/radius/metrics'
        command_log=next(x for x in json_logs if x.get('event')=='http.response' and x.get('traceId')==command_trace)
        assert command_log['correlationId']==command_corr
        all_logs=log_stdout+'\n'+log_stderr
        assert TOKEN not in all_logs and VOUCHER_TOKEN not in all_logs and BACKUP_TOKEN not in all_logs and LOG_TOKEN not in all_logs and GATEWAY_HMAC_SECRET not in all_logs and GATEWAY_HMAC_PREVIOUS_SECRET not in all_logs
        assert RADIUS_SECRET_VALUE not in all_logs and TelegramMock.token not in all_logs and 'coa-secret-super-private' not in all_logs

        # Durable remote log shipping: first gateway attempt fails, retry succeeds, records stay sanitized.
        rlog_db=Path(td)/'remote-log.sqlite3'
        rlog_op=opener()
        Gateway.log_batches.clear(); Gateway.log_fail_remaining=1
        rlog_extra={
            **direct_extra,
            'UCHIHA_LOG_FORMAT':'json','UCHIHA_LOG_LEVEL':'INFO','UCHIHA_LOG_HTTP':'1',
            'UCHIHA_LOG_REMOTE_ENABLE':'1',
            'UCHIHA_LOG_REMOTE_ACK':'I_UNDERSTAND_REMOTE_LOG_SHIPPING',
            'UCHIHA_LOG_REMOTE_URL':f'http://127.0.0.1:{gw.server_address[1]}',
            'UCHIHA_LOG_REMOTE_TOKEN':LOG_TOKEN,
            'UCHIHA_LOG_REMOTE_PATH':'/api/logs/batch',
            'UCHIHA_LOG_REMOTE_ALLOW_INSECURE':'1',
            'UCHIHA_LOG_REMOTE_WORKER_ENABLED':'1',
            'UCHIHA_LOG_REMOTE_POLL_SECONDS':'0.05',
            'UCHIHA_LOG_REMOTE_BATCH_SIZE':'10',
            'UCHIHA_LOG_REMOTE_MAX_ATTEMPTS':'3',
            'UCHIHA_LOG_REMOTE_RETRY_BASE_SECONDS':'0.05',
            'UCHIHA_LOG_REMOTE_SENT_RETENTION_SECONDS':'60',
            'UCHIHA_LOG_REMOTE_DEAD_RETENTION_SECONDS':'60',
            'UCHIHA_ALERT_MONITOR_ENABLED':'0',
            'UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0'
        }
        rlp=start(rlog_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],rlog_extra)
        remote_trace='TRACE-REMOTE-LOG-01'; remote_corr='COR-REMOTE-LOG-01'
        try:
          wait_ready(rlog_op); rlog_csrf=auth(rlog_op)
          s,rlog_conn=req(rlog_op,'/api/connectors/radius/connectivity-check'); assert s==200 and rlog_conn['overallReachable'] is True
          s,remote_metric,remote_hdr=req_meta(
              rlog_op,'/api/connectors/radius/metrics',
              headers={'X-Request-ID':remote_trace,'X-Correlation-ID':remote_corr}
          )
          assert s==200 and remote_metric['traceId']==remote_trace and remote_metric['correlationId']==remote_corr
          shipped=wait_log_shipping(rlog_op,timeout=10)
          state=shipped['remoteLogShipping']
          assert state['ready'] is True and state['sent']>0 and state['pending']==0
          assert len(Gateway.log_batches)>=2  # intentional first 500 + retry
          successful_batch=Gateway.log_batches[-1]
          assert successful_batch['auth']==f'Bearer {LOG_TOKEN}'
          records=successful_batch['body']['records']
          assert isinstance(records,list) and records
          assert all(isinstance(x,dict) and 'event' in x and 'level' in x for x in records)
          assert any(x.get('traceId')==remote_trace and x.get('correlationId')==remote_corr for batch in Gateway.log_batches for x in batch['body'].get('records',[]))
          shipped_text=json.dumps([batch['body'] for batch in Gateway.log_batches])
          assert TOKEN not in shipped_text and VOUCHER_TOKEN not in shipped_text and BACKUP_TOKEN not in shipped_text and GATEWAY_HMAC_SECRET not in shipped_text and GATEWAY_HMAC_PREVIOUS_SECRET not in shipped_text
          assert LOG_TOKEN not in shipped_text and RADIUS_SECRET_VALUE not in shipped_text
          assert TelegramMock.token not in shipped_text and 'coa-secret-super-private' not in shipped_text

          s,lout=req(rlog_op,'/api/connectors/radius/log-delivery-outbox?limit=100'); assert s==200
          assert lout['recordsExposed'] is False and lout['secretsExposed'] is False
          assert all(x['recordExposed'] is False for x in lout['items'])
          assert all('record' not in x and 'recordJson' not in x for x in lout['items'])
        finally:
          stop(rlp)

        # Simulate a process crash after an outbox item was claimed (status=running).
        conn=sqlite3.connect(db)
        conn.row_factory=sqlite3.Row
        alert_row=conn.execute("SELECT alert_id, alert_key FROM operational_alerts ORDER BY first_seen_at LIMIT 1").fetchone()
        assert alert_row
        crash_outbox='OUT-RESTART-RECOVERY'
        now_text='2026-01-01T00:00:00+00:00'
        conn.execute(
          '''INSERT INTO operational_alert_outbox(
               outbox_id,dedup_key,alert_id,alert_key,event_type,channel,status,
               attempts,max_attempts,next_attempt_at,last_error_code,created_at,updated_at,sent_at
             ) VALUES (?,?,?,?,?,'telegram','running',1,3,NULL,NULL,?,?,NULL)''',
          (crash_outbox,'dedup-restart-recovery',alert_row['alert_id'],alert_row['alert_key'],'active',now_text,now_text)
        )
        # Also insert old terminal rows so cleanup can be proven.
        conn.execute(
          '''INSERT INTO operational_alert_outbox(
               outbox_id,dedup_key,alert_id,alert_key,event_type,channel,status,
               attempts,max_attempts,next_attempt_at,last_error_code,created_at,updated_at,sent_at
             ) VALUES (?,?,?,?,?,'telegram','sent',1,3,NULL,NULL,?,?,?)''',
          ('OUT-OLD-SENT','dedup-old-sent',alert_row['alert_id'],alert_row['alert_key'],'active',now_text,now_text,now_text)
        )
        conn.commit(); conn.close()

        # Restart with delivery worker disabled: init_db must recover running -> retry.
        rop=opener()
        r_extra={**direct_extra,'UCHIHA_TELEGRAM_DELIVERY_WORKER_ENABLED':'0'}
        rp=start(db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],r_extra)
        try:
          wait_ready(rop); rcsrf=auth(rop)
          rconn=sqlite3.connect(db)
          assert rconn.execute('PRAGMA user_version').fetchone()[0]==30
          assert rconn.execute('SELECT COUNT(*) FROM schema_migrations').fetchone()[0]==1
          rconn.close()
          s,rout=req(rop,'/api/connectors/radius/alert-outbox'); assert s==200
          recovered=next(x for x in rout['items'] if x['outboxId']==crash_outbox)
          assert recovered['status']=='retry' and recovered['lastErrorCode']=='recovered_after_restart'
          assert rout['stats']['workerEnabled'] is False
          cleanup_rid='REQ-V37-OUTBOX-CLEANUP'
          cleanup_body={'contractVersion':'1.0','requestId':cleanup_rid,'operation':'cleanup-alert-outbox'}
          s,cleaned=req(rop,'/api/connectors/radius/alert-outbox/cleanup','POST',cleanup_body,headers(rcsrf,cleanup_rid)); assert s==200
          assert cleaned['cleanup']['sentRemoved'] >= 1
        finally: stop(rp)

        # SIGTERM graceful shutdown: stop new commands, readiness -> 503, wait for in-flight command, then exit.
        sig_db=Path(td)/'sigterm.sqlite3'
        sop=opener()
        Gateway.delay_next=0.0
        sp=start(sig_db,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],direct_extra)
        try:
          wait_ready(sop); scsrf=auth(sop)
          s,sconn=req(sop,'/api/connectors/radius/connectivity-check'); assert s==200 and sconn['overallReachable'] is True
          Gateway.delay_next=.60
          srid='REQ-V37-SIGTERM-SLOW'
          s,sq=req(sop,'/api/connectors/radius','POST',session_payload(srid,'disconnect'),headers(scsrf,srid)); assert s==202
          wait_running(sop)
          shutdown_started=time.time()
          sp.terminate()

          lifecycle_seen=None
          for _ in range(25):
            try:
              s,life=req(sop,'/api/connectors/radius/process-lifecycle',timeout=1)
              if s==200 and life['processLifecycle']['terminating']:
                lifecycle_seen=life['processLifecycle']; break
            except Exception:
              pass
            time.sleep(.02)
          assert lifecycle_seen and lifecycle_seen['signal']=='SIGTERM'
          assert lifecycle_seen['acceptingNetworkCommands'] is False
          s,sready=req(sop,'/api/connectors/radius/health/ready',timeout=1)
          assert s==503 and 'process-terminating' in sready['blockers']

          blocked_rid='REQ-V37-SIGTERM-BLOCK'
          s,sblocked=req(sop,'/api/connectors/radius','POST',session_payload(blocked_rid,'disconnect'),headers(scsrf,blocked_rid),timeout=1)
          assert s==503 and sblocked['error']['code']=='process_terminating'

          sp.wait(timeout=4)
          shutdown_elapsed=time.time()-shutdown_started
          assert shutdown_elapsed >= .25 and sp.returncode==0

          conn=sqlite3.connect(sig_db)
          status=conn.execute("SELECT status FROM connector_commands WHERE request_id=?",(srid,)).fetchone()
          audit_shutdown=conn.execute("SELECT outcome FROM audit_events WHERE action='process.graceful-shutdown' ORDER BY created_at DESC LIMIT 1").fetchone()
          conn.close()
          assert status and status[0]=='completed'
          assert audit_shutdown and audit_shutdown[0]=='success'
        finally:
          if sp.poll() is None: stop(sp)

        # Maintenance mode: liveness remains up, readiness is 503, and network commands are blocked before queueing.
        mdb=Path(td)/'maintenance.sqlite3'; mop=opener()
        m_extra={**direct_extra,'UCHIHA_MAINTENANCE_MODE':'1','UCHIHA_MAINTENANCE_REASON':'upgrade-window'}
        mp=start(mdb,auth_tcp.server_address[1],acct_tcp.server_address[1],gw.server_address[1],m_extra)
        try:
          mh=wait_ready(mop)
          mcsrf=auth(mop)
          s,mlive=req(mop,'/api/connectors/radius/health/live'); assert s==200 and mlive['alive'] is True
          s,mready=req(mop,'/api/connectors/radius/health/ready'); assert s==503 and mready['ready'] is False and 'maintenance-mode' in mready['blockers']
          s,mrelease=req(mop,'/api/connectors/radius/release-readiness'); assert s==200
          assert mrelease['releaseState']=='maintenance' and mrelease['maintenanceMode'] is True and mrelease['realNetworkCommands'] is False
          s,mops=req(mop,'/api/connectors/radius/ops-summary'); assert s==200 and mops['maintenance']['enabled'] is True and mops['maintenance']['source']=='environment' and mops['secretsExposed'] is False
          force_off_rid='REQ-V37-ENV-FORCED-OFF'
          force_off={'contractVersion':'1.0','requestId':force_off_rid,'operation':'set-maintenance','enabled':False,'reason':''}
          s,force_off_resp=req(mop,'/api/connectors/radius/runtime-control/maintenance','POST',force_off,headers(mcsrf,force_off_rid))
          assert s==409 and force_off_resp['error']['code']=='maintenance_env_forced'
          before_events=len(Gateway.events)
          before_voucher_events=len([e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')])
          mvrid='REQ-V37-MAINT-VOUCHER'
          mvbody={
              'contractVersion':'1.0','requestId':mvrid,'operation':'provision-voucher-batch',
              'batch':{'id':'VCH-MAINT','plan':'Home 50','quantity':5,'validity':'30 days'},
              'scope':'Atlas Connect'
          }
          s,mvblocked=req(mop,'/api/connectors/radius/voucher-batches','POST',mvbody,headers(mcsrf,mvrid))
          assert s==503 and mvblocked['error']['code']=='maintenance_mode'
          assert len([e for e in Gateway.events if e['path'].endswith('/api/vouchers/batches')])==before_voucher_events
          mrid='REQ-V37-MAINT-BLOCK'
          s,mblocked=req(mop,'/api/connectors/radius','POST',session_payload(mrid,'disconnect'),headers(mcsrf,mrid))
          assert s==503 and mblocked['error']['code']=='maintenance_mode'
          time.sleep(.15); assert len(Gateway.events)==before_events
        finally: stop(mp)
      print('PASS v37: host preflight/fsync/atomic-rename/disk-space gate + operator-session auth + schema30 + single-instance SQLite flock + edge/HMAC limits + release integrity + launch gate + backup/logging/vouchers/deployment/Telegram/MikroTik/Direct RADIUS')
    finally:
      auth_tcp.shutdown(); auth_tcp.server_close(); acct_tcp.shutdown(); acct_tcp.server_close(); gw.shutdown(); gw.server_close(); tg.shutdown(); tg.server_close()

if __name__=='__main__':main()
