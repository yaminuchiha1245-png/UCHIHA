-- Run with schema.sql inside BEGIN ... ROLLBACK on an isolated empty service schema.
-- All credentials and records in this file are synthetic and rolled back.
do $$begin
  assert not has_schema_privilege('anon','debt_service','USAGE');
  assert not has_schema_privilege('authenticated','debt_service','USAGE');
  assert not has_function_privilege('anon','public.debt_service_dispatch(text,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.debt_service_dispatch(text,jsonb)','EXECUTE');
end$$;
set local role service_role;
do $$
declare
  owner_id uuid;
  customer_id uuid;
  backup_id uuid;
  code text;
  r jsonb;
  owner_args jsonb:=jsonb_build_object('token_hash',repeat('1',64),'device_hash',repeat('2',64));
  customer_args jsonb:=jsonb_build_object('token_hash',repeat('3',64),'device_hash',repeat('4',64));
  data jsonb:='{"version":1,"setupDone":true,"accounts":[{"id":"TEST-OWNER","pinHash":"synthetic"}],"shop":{"name":"اختبار فقط"},"clients":[{"id":"TEST-C","name":"عميل تجريبي"}],"entries":[{"id":"TEST-E","originalAmount":125.75,"type":"purchase","note":"يجب أن تبقى كما هي"}],"products":[],"deferred":[],"shortages":[]}';
begin
  insert into debt_service.licenses(kind,label,code_hash,code_hint)
  values('owner','TEST OWNER',repeat('5',64),'TEST') returning id into owner_id;
  r:=public.debt_service_dispatch('activate',jsonb_build_object('code_hash',repeat('5',64),'new_token_hash',repeat('1',64),'device_hash',repeat('2',64)));
  assert r->>'role'='owner' and (r->>'ok')::boolean,'owner activation';
  r:=public.debt_service_dispatch('activate',jsonb_build_object('code_hash',repeat('5',64),'new_token_hash',repeat('6',64),'device_hash',repeat('7',64)));
  assert r->>'error'='DEVICE_LIMIT','owner cannot activate on another device';
  r:=public.debt_service_dispatch('owner_list','{}');
  assert r->>'error'='SESSION_REQUIRED','unauthenticated owner call';
  r:=public.debt_service_dispatch('owner_create',owner_args||'{"label":"TEST CUSTOMER","max_devices":1}');
  assert (r->>'ok')::boolean,'create code';code:=r->>'code';customer_id:=(r->>'license_id')::uuid;
  r:=public.debt_service_dispatch('activate',jsonb_build_object('code_hash',encode(extensions.digest(code,'sha256'),'hex'),'new_token_hash',repeat('3',64),'device_hash',repeat('4',64)));
  assert r->>'role'='customer' and (r->>'ok')::boolean,'customer activation';
  r:=public.debt_service_dispatch('owner_list',customer_args);
  assert r->>'error'='FORBIDDEN','customer role isolation';
  r:=public.debt_service_dispatch('owner_create',customer_args||'{"label":"intrusion","kind":"owner"}');
  assert r->>'error'='FORBIDDEN','customer cannot escalate';
  r:=public.debt_service_dispatch('backup',customer_args||jsonb_build_object('snapshot',data));
  assert r->>'error'='CONSENT_REQUIRED','backup must be opt in';
  r:=public.debt_service_dispatch('consent',customer_args||'{"enabled":true}');
  assert (r->>'ok')::boolean,'consent';
  r:=public.debt_service_dispatch('backup',customer_args||'{"snapshot":{"setupDone":true}}');
  assert r->>'error'='INVALID_BACKUP','missing arrays rejected';
  r:=public.debt_service_dispatch('backup',customer_args||jsonb_build_object('snapshot',data,'app_version','TEST'));
  assert (r->>'ok')::boolean,'backup write';backup_id:=(r->>'id')::uuid;
  r:=public.debt_service_dispatch('download',customer_args||jsonb_build_object('backup_id',backup_id));
  assert r->'snapshot'=data,'exact backup round trip';
  r:=public.debt_service_dispatch('backup',customer_args||jsonb_build_object('snapshot',data));
  assert (r->>'unchanged')::boolean,'duplicate backup does not consume history';
  r:=public.debt_service_dispatch('owner_download',owner_args||jsonb_build_object('backup_id',backup_id));
  assert r->>'error'='SUPPORT_REASON_REQUIRED','support reason required';
  r:=public.debt_service_dispatch('owner_download',owner_args||jsonb_build_object('backup_id',backup_id,'reason','Synthetic support test'));
  assert r->'snapshot'=data,'authorized support recovery';
  r:=public.debt_service_dispatch('download',owner_args||jsonb_build_object('backup_id',backup_id));
  assert r->>'error'='FORBIDDEN','own-download cannot bypass account scope';
  r:=public.debt_service_dispatch('owner_list',owner_args);
  assert r#>>'{licenses,0,code}'=code,'owner can review created code';
  r:=public.debt_service_dispatch('consent',customer_args||'{"enabled":false}');
  r:=public.debt_service_dispatch('owner_download',owner_args||jsonb_build_object('backup_id',backup_id,'reason','Synthetic support test'));
  assert r->>'error'='SUPPORT_REASON_REQUIRED','withdrawn consent blocks support';
  r:=public.debt_service_dispatch('owner_set_active',owner_args||jsonb_build_object('license_id',customer_id,'active',false));
  assert (r->>'ok')::boolean;
  r:=public.debt_service_dispatch('download',customer_args||jsonb_build_object('backup_id',backup_id));
  assert r->'snapshot'=data,'disabled customer can still export own data';
  r:=public.debt_service_dispatch('backup',customer_args||jsonb_build_object('snapshot',data));
  assert r->>'error'='LICENSE_INACTIVE','disabled write rejected';
  r:=public.debt_service_dispatch('owner_reset_device',owner_args||jsonb_build_object('license_id',customer_id,'reason','Replacement device support'));
  assert (r->>'ok')::boolean;
  r:=public.debt_service_dispatch('status',customer_args);
  assert r->>'error'='SESSION_REQUIRED','released device session invalid';
  assert (select count(*) from debt_service.backups where license_id=customer_id)=1,'release does not delete backup';
  assert (select count(*) from debt_service.audit where action='owner_download')=1,'support export audited';
end $$;
reset role;
select 'PASS: activation, owner isolation, device binding, consent, encrypted round trip, export rights, audit' as result;
