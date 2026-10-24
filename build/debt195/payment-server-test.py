"""Concurrency and RLS tests against the isolated CI PostgreSQL service."""
import json
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor

URL=os.environ['DEBT_TEST_DATABASE_URL']
STORE='10000000-0000-4000-8000-000000000001'
USER='30000000-0000-4000-8000-000000000001'
LEGACY='20000000-0000-4000-8000-000000000001'

def quote(value):
    return "'"+str(value).replace("'","''")+"'"

def sql(query,ok=True):
    result=subprocess.run(['psql',URL,'-X','-v','ON_ERROR_STOP=1','-Atc',query],capture_output=True,text=True)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result

def authenticated(body,user=USER,isolation='READ COMMITTED',delay=False):
    claims=quote(json.dumps({'sub':user,'role':'authenticated'}))
    return (f'begin isolation level {isolation}; set local request.jwt.claims={claims}; set local role authenticated; '
        +('select count(*) from public.transactions; select pg_sleep(0.3); ' if delay else '')
        +body+(' select pg_sleep(0.35); ' if delay else '')+' commit;')

def rpc(customer,amount=60,operation=None,key=None,currency='TRY'):
    operation=operation or str(uuid.uuid4());key=key or 'ci:'+operation
    return f"select public.debt_record_payment_v195({quote(STORE)},{quote(customer)},{quote(operation)},{quote(key)},{quote(currency)},{amount},40,'test');"

def customer(amount=100,currency='TRY',store=STORE):
    cid=str(uuid.uuid4());tid=str(uuid.uuid4())
    sql(f'insert into public.customers values({quote(cid)},{quote(store)},\'CI fixture\',false)')
    if amount:
        body=f"insert into public.transactions(id,store_id,customer_id,source_key,kind,original_currency,original_amount,usd_amount,recorded_by,created_at) values({quote(tid)},{quote(store)},{quote(cid)},{quote('ci:'+tid)},'purchase',{quote(currency)},{amount},{amount/40},{quote(USER)},'2026-10-01');"
        sql(authenticated(body))
    return cid,tid

def balance(cid,cur='TRY'):
    return float(sql(f'select balance from app_private.debt_replay_v195({quote(STORE)},{quote(cid)},{quote(cur)})').stdout.strip())

def rejected(query,expected):
    result=sql(authenticated(query),ok=False)
    assert result.returncode and expected in result.stderr,result.stderr

passed=[]
def check(name,fn):
    fn();passed.append(name);print('PASS '+name,flush=True)

def legacy_case():
    assert balance(LEGACY)==400
    rejected(rpc(LEGACY,6100,'40000000-0000-4000-8000-000000000004','fixture:invalid'),'PAYMENT_EXISTING_REVIEW')
    invalid=sql(f"select array_to_json(invalid_ids) from app_private.debt_replay_v195('{STORE}','{LEGACY}','TRY')").stdout.strip()
    assert json.loads(invalid)==['40000000-0000-4000-8000-000000000004']
    assert sql(f"select count(*) from public.transactions where customer_id='{LEGACY}'").stdout.strip()=='5'

def excess_case():
    cid,_=customer();rejected(rpc(cid,101),'PAYMENT_EXCEEDS_DEBT');assert balance(cid)==100

def idempotency_case():
    cid,_=customer();operation=str(uuid.uuid4());request=rpc(cid,60,operation)
    sql(authenticated(request));sql(authenticated(request));assert balance(cid)==40
    assert sql(f"select count(*) from public.transactions where id='{operation}'").stdout.strip()=='1'
    rejected(rpc(cid,50,operation),'PAYMENT_KEY_CONFLICT')

def race_case(isolation,same=False):
    cid,_=customer();op=str(uuid.uuid4());a=rpc(cid,60,op);b=a if same else rpc(cid,60)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda query:sql(authenticated(query,isolation=isolation,delay=True),ok=False),[a,b]))
    successes=sum(r.returncode==0 for r in results)
    if same:
        assert successes>=1,[r.stderr for r in results]
        sql(authenticated(a));assert balance(cid)==40
    else:
        assert successes==1,[r.stderr for r in results]
        assert all(not r.returncode or 'PAYMENT_EXCEEDS_DEBT' in r.stderr or 'could not serialize' in r.stderr for r in results),[r.stderr for r in results]
        assert balance(cid)==40
    count=sql(f"select count(*) from public.transactions where customer_id='{cid}' and kind='payment'").stdout.strip();assert count=='1',count

def currency_case():
    cid,_=customer(100,'USD');rejected(rpc(cid,1,currency='TRY'),'PAYMENT_EXCEEDS_DEBT');assert balance(cid,'USD')==100

def permissions_case():
    cid,_=customer()
    for user in ['30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003']:
        result=sql(authenticated(rpc(cid,1),user=user),ok=False);assert result.returncode and 'PAYMENT_NOT_AUTHORIZED' in result.stderr,result.stderr

def cross_store_case():
    cid,_=customer(0,store='10000000-0000-4000-8000-000000000002');rejected(rpc(cid,1),'PAYMENT_CUSTOMER_MISMATCH')

def raw_insert_case():
    cid,_=customer();tid=str(uuid.uuid4())
    body=f"insert into public.transactions(id,store_id,customer_id,source_key,kind,original_currency,original_amount,usd_amount,recorded_by) values('{tid}','{STORE}','{cid}','raw:{tid}','payment','TRY',101,2.525,'{USER}');"
    rejected(body,'PAYMENT_EXCEEDS_DEBT');assert balance(cid)==100

def stale_case():
    cid,_=customer();tid=str(uuid.uuid4())
    body=f"insert into public.transactions(id,store_id,customer_id,source_key,kind,original_currency,original_amount,usd_amount,recorded_by,created_at) values('{tid}','{STORE}','{cid}','stale:{tid}','payment','TRY',10,.25,'{USER}','2026-09-01');"
    rejected(body,'PAYMENT_STALE_SNAPSHOT')

def edit_case():
    cid,purchase=customer();sql(authenticated(rpc(cid,60)));rejected(f"update public.transactions set original_amount=50 where id='{purchase}';",'PAYMENT_WOULD_BECOME_INVALID');assert balance(cid)==40

check('legacy invalid payment is preserved for review and leaves 400 due',legacy_case)
check('new excess payment is rejected',excess_case)
check('network retry is idempotent and cannot change an operation amount',idempotency_case)
check('two devices cannot pay 60 each against 100',lambda:race_case('READ COMMITTED'))
check('repeatable-read snapshots cannot bypass the balance guard',lambda:race_case('REPEATABLE READ'))
check('simultaneous retry of the same operation records once',lambda:race_case('READ COMMITTED',True))
check('repeatable-read idempotent retry stays safe',lambda:race_case('REPEATABLE READ',True))
check('TRY payment cannot consume USD debt',currency_case)
check('revoked payer and non-member are denied',permissions_case)
check('customer and store must match',cross_store_case)
check('old raw REST insert cannot bypass the guard',raw_insert_case)
check('backdated offline payment requires review',stale_case)
check('purchase edits cannot invalidate accepted payments',edit_case)
print(json.dumps({'passed':len(passed),'tests':passed}))
