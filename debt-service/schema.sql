-- Additive service for Debt Store. Does not change stores, transactions, or app data.
-- The private schema is never exposed through PostgREST. Only the Edge Function
-- service role can execute the dispatcher; every operation checks an opaque session.
create schema debt_service;
revoke all on schema debt_service from public, anon, authenticated;
grant usage on schema debt_service to service_role;

create table debt_service.config (
  singleton boolean primary key default true check (singleton),
  encryption_key text not null
);
insert into debt_service.config values (true, encode(extensions.gen_random_bytes(32),'hex'));

create table debt_service.licenses (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('owner','customer')),
  label text not null check (char_length(label) between 1 and 120),
  phone text not null default '',
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  code_cipher bytea,
  code_hint text not null,
  active boolean not null default true,
  expires_at timestamptz,
  max_devices integer not null default 1 check (max_devices between 1 and 5),
  backup_consent boolean not null default false,
  consent_at timestamptz,
  consent_version text,
  created_by uuid references debt_service.licenses(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  check (kind <> 'owner' or code_cipher is null)
);
create unique index debt_service_single_owner on debt_service.licenses(kind) where kind='owner';
create index debt_service_license_created on debt_service.licenses(created_at desc);
create index debt_service_license_creator on debt_service.licenses(created_by);

create table debt_service.devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references debt_service.licenses(id),
  device_hash text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  label text not null default '',
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create unique index debt_service_active_device on debt_service.devices(license_id, device_hash) where released_at is null;

create table debt_service.sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references debt_service.devices(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  revoked_at timestamptz
);
create index debt_service_session_device on debt_service.sessions(device_id);

create table debt_service.backups (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references debt_service.licenses(id),
  device_id uuid not null references debt_service.devices(id),
  payload_cipher bytea not null,
  content_hash text not null,
  summary jsonb not null,
  app_version text not null,
  created_at timestamptz not null default now()
);
create index debt_service_backup_license_date on debt_service.backups(license_id,created_at desc);
create index debt_service_backup_device on debt_service.backups(device_id);

create table debt_service.audit (
  id bigint generated always as identity primary key,
  actor_license_id uuid references debt_service.licenses(id),
  target_license_id uuid references debt_service.licenses(id),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index debt_service_audit_actor on debt_service.audit(actor_license_id);
create index debt_service_audit_target on debt_service.audit(target_license_id);
create index debt_service_audit_date on debt_service.audit(created_at desc);

create table debt_service.rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null
);

alter table debt_service.config enable row level security;
alter table debt_service.licenses enable row level security;
alter table debt_service.devices enable row level security;
alter table debt_service.sessions enable row level security;
alter table debt_service.backups enable row level security;
alter table debt_service.audit enable row level security;
alter table debt_service.rate_limits enable row level security;
revoke all on all tables in schema debt_service from public, anon, authenticated;
revoke all on all sequences in schema debt_service from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema debt_service to service_role;
grant usage, select on all sequences in schema debt_service to service_role;

create function public.debt_service_dispatch(p_action text, p_args jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  lic debt_service.licenses%rowtype;
  dev debt_service.devices%rowtype;
  sess debt_service.sessions%rowtype;
  bkp debt_service.backups%rowtype;
  target debt_service.licenses%rowtype;
  result jsonb;
  rows_json jsonb;
  key_text text;
  code text;
  plain text;
  snapshot jsonb;
  summary jsonb;
  new_id uuid;
  n integer;
  is_active boolean;
  reason text;
begin
  if p_args is null or jsonb_typeof(p_args)<>'object' then
    return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
  end if;
  -- Called only by the function, never granted to a client role.
  if p_action='rate_limit' then
    if coalesce(p_args->>'bucket','') !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
    end if;
    insert into debt_service.rate_limits as r(bucket,window_start,attempts)
    values(p_args->>'bucket',now(),1)
    on conflict(bucket) do update set
      attempts=case when r.window_start < now()-interval '1 minute' then 1 else r.attempts+1 end,
      window_start=case when r.window_start < now()-interval '1 minute' then now() else r.window_start end
    returning attempts into n;
    -- Bound ephemeral metadata without touching customer data.
    delete from debt_service.rate_limits where window_start < now()-interval '2 days';
    return jsonb_build_object('ok',n<=least(200,greatest(1,coalesce((p_args->>'limit')::int,20))));
  end if;

  if p_action='activate' then
    if coalesce(p_args->>'code_hash','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_args->>'device_hash','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_args->>'new_token_hash','') !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('ok',false,'error','INVALID_CODE');
    end if;
    select * into lic from debt_service.licenses where code_hash=p_args->>'code_hash' for update;
    if not found or not lic.active or (lic.expires_at is not null and lic.expires_at<=now()) then
      return jsonb_build_object('ok',false,'error','INVALID_CODE');
    end if;
    select * into dev from debt_service.devices where license_id=lic.id
      and device_hash=p_args->>'device_hash' and released_at is null;
    if not found then
      select count(*) into n from debt_service.devices where license_id=lic.id and released_at is null;
      if n>=lic.max_devices then return jsonb_build_object('ok',false,'error','DEVICE_LIMIT'); end if;
      insert into debt_service.devices(license_id,device_hash,label)
      values(lic.id,p_args->>'device_hash',left(coalesce(p_args->>'device_label','Android'),80)) returning * into dev;
    end if;
    update debt_service.sessions set revoked_at=now() where device_id=dev.id and revoked_at is null;
    insert into debt_service.sessions(device_id,token_hash)
    values(dev.id,p_args->>'new_token_hash') returning * into sess;
    update debt_service.licenses set activated_at=coalesce(activated_at,now()) where id=lic.id;
    insert into debt_service.audit(actor_license_id,target_license_id,action)
      values(lic.id,lic.id,'activated');
    return jsonb_build_object('ok',true,'license_id',lic.id,'role',lic.kind,'label',lic.label,
      'active',true,'expires_at',lic.expires_at,'backup_consent',lic.backup_consent,'session_expires_at',sess.expires_at);
  end if;

  select * into sess from debt_service.sessions where token_hash=p_args->>'token_hash'
    and revoked_at is null and expires_at>now();
  if not found then return jsonb_build_object('ok',false,'error','SESSION_REQUIRED'); end if;
  select * into dev from debt_service.devices where id=sess.device_id
    and device_hash=p_args->>'device_hash' and released_at is null;
  if not found then return jsonb_build_object('ok',false,'error','SESSION_REQUIRED'); end if;
  select * into lic from debt_service.licenses where id=dev.license_id;
  is_active:=lic.active and (lic.expires_at is null or lic.expires_at>now());
  update debt_service.sessions set last_seen_at=now(),expires_at=now()+interval '90 days' where id=sess.id;

  if p_action='status' then
    return jsonb_build_object('ok',true,'license_id',lic.id,'role',lic.kind,'label',lic.label,
      'active',is_active,'expires_at',lic.expires_at,'backup_consent',lic.backup_consent,
      'session_expires_at',now()+interval '90 days',
      'last_backup_at',(select max(created_at) from debt_service.backups where license_id=lic.id));
  end if;

  -- A stopped subscription keeps read/export access to its own saved backups.
  if p_action not in ('backups','download','consent') and not is_active then
    return jsonb_build_object('ok',false,'error','LICENSE_INACTIVE');
  end if;
  if p_action like 'owner_%' and (lic.kind<>'owner' or not is_active) then
    return jsonb_build_object('ok',false,'error','FORBIDDEN');
  end if;

  if p_action='consent' then
    if jsonb_typeof(p_args->'enabled') is distinct from 'boolean' then return jsonb_build_object('ok',false,'error','INVALID_REQUEST'); end if;
    update debt_service.licenses set backup_consent=(p_args->>'enabled')::boolean,
      consent_at=now(),consent_version='backup-support-v1' where id=lic.id;
    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(lic.id,lic.id,'backup_consent',jsonb_build_object('enabled',p_args->'enabled','version','backup-support-v1'));
    return jsonb_build_object('ok',true,'backup_consent',p_args->'enabled');
  elsif p_action='backup' then
    -- Serialize consent changes with uploads; no cross-account identifiers accepted.
    select * into lic from debt_service.licenses where id=lic.id for update;
    if not lic.backup_consent then return jsonb_build_object('ok',false,'error','CONSENT_REQUIRED'); end if;
    snapshot=p_args->'snapshot';
    if jsonb_typeof(snapshot) is distinct from 'object' or jsonb_typeof(snapshot->'clients') is distinct from 'array'
      or jsonb_typeof(snapshot->'entries') is distinct from 'array' or jsonb_typeof(snapshot->'accounts') is distinct from 'array'
      or not coalesce((snapshot->>'setupDone')::boolean,false)
      or octet_length(snapshot::text)>5242880 then
      return jsonb_build_object('ok',false,'error','INVALID_BACKUP');
    end if;
    plain:=snapshot::text;
    select * into bkp from debt_service.backups where license_id=lic.id order by created_at desc limit 1;
    if found and bkp.content_hash=encode(extensions.digest(plain,'sha256'),'hex') then
      return jsonb_build_object('ok',true,'id',bkp.id,'created_at',bkp.created_at,'unchanged',true);
    end if;
    select encryption_key into key_text from debt_service.config where singleton;
    summary=jsonb_build_object('shop',left(coalesce(snapshot#>>'{shop,name}','دفتر الديون'),120),
      'clients',jsonb_array_length(snapshot->'clients'),'entries',jsonb_array_length(snapshot->'entries'),
      'products',case when jsonb_typeof(snapshot->'products')='array' then jsonb_array_length(snapshot->'products') else 0 end);
    insert into debt_service.backups(license_id,device_id,payload_cipher,content_hash,summary,app_version)
    values(lic.id,dev.id,extensions.pgp_sym_encrypt(plain,key_text,'cipher-algo=aes256,compress-algo=1'),
      encode(extensions.digest(plain,'sha256'),'hex'),summary,left(coalesce(p_args->>'app_version','unknown'),30)) returning * into bkp;
    -- Documented rolling history: newest twenty successful snapshots, no ledger deletion.
    delete from debt_service.backups where license_id=lic.id and id in (
      select id from debt_service.backups where license_id=lic.id order by created_at desc,id desc offset 20);
    return jsonb_build_object('ok',true,'id',bkp.id,'created_at',bkp.created_at,'summary',summary);
  elsif p_action in ('backups','owner_backups') then
    if p_action='owner_backups' then
      select * into target from debt_service.licenses where id=(p_args->>'license_id')::uuid and kind='customer';
      if not found or not target.backup_consent then return jsonb_build_object('ok',false,'error','CONSENT_REQUIRED'); end if;
    else target:=lic; end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) into rows_json from
      (select id,created_at,summary,app_version from debt_service.backups where license_id=target.id order by created_at desc limit 20) t;
    return jsonb_build_object('ok',true,'backups',rows_json);
  elsif p_action in ('download','owner_download') then
    select * into bkp from debt_service.backups where id=(p_args->>'backup_id')::uuid;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;
    if p_action='download' and bkp.license_id<>lic.id then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
    select * into target from debt_service.licenses where id=bkp.license_id;
    reason=left(trim(coalesce(p_args->>'reason','')),300);
    if p_action='owner_download' and (not target.backup_consent or target.kind<>'customer' or char_length(reason)<5) then
      return jsonb_build_object('ok',false,'error','SUPPORT_REASON_REQUIRED');
    end if;
    select encryption_key into key_text from debt_service.config where singleton;
    plain=extensions.pgp_sym_decrypt(bkp.payload_cipher,key_text);
    if encode(extensions.digest(plain,'sha256'),'hex')<>bkp.content_hash then
      return jsonb_build_object('ok',false,'error','BACKUP_INTEGRITY');
    end if;
    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(lic.id,bkp.license_id,p_action,jsonb_build_object('backup_id',bkp.id,'reason',reason));
    return jsonb_build_object('ok',true,'snapshot',plain::jsonb,'summary',bkp.summary,'created_at',bkp.created_at);
  elsif p_action='owner_create' then
    if char_length(trim(coalesce(p_args->>'label','')))<1 or char_length(p_args->>'label')>120 then
      return jsonb_build_object('ok',false,'error','LABEL_REQUIRED'); end if;
    if p_args ? 'expires_at' and (p_args->>'expires_at')::timestamptz<=now() then
      return jsonb_build_object('ok',false,'error','INVALID_EXPIRY'); end if;
    code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
    select encryption_key into key_text from debt_service.config where singleton;
    insert into debt_service.licenses(kind,label,phone,code_hash,code_cipher,code_hint,max_devices,expires_at,created_by)
    values('customer',trim(p_args->>'label'),left(coalesce(p_args->>'phone',''),30),
      encode(extensions.digest(code,'sha256'),'hex'),extensions.pgp_sym_encrypt(code,key_text,'cipher-algo=aes256'),
      right(code,4),least(5,greatest(1,coalesce((p_args->>'max_devices')::int,1))),
      (p_args->>'expires_at')::timestamptz,lic.id) returning id into new_id;
    insert into debt_service.audit(actor_license_id,target_license_id,action) values(lic.id,new_id,'code_created');
    return jsonb_build_object('ok',true,'license_id',new_id,'code',code);
  elsif p_action='owner_list' then
    select encryption_key into key_text from debt_service.config where singleton;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) into rows_json from (
      select l.id,l.label,l.phone,l.active,l.expires_at,l.max_devices,l.created_at,l.activated_at,l.backup_consent,
        extensions.pgp_sym_decrypt(l.code_cipher,key_text) as code,
        (select count(*) from debt_service.devices where license_id=l.id and released_at is null) as devices,
        (select max(created_at) from debt_service.backups where license_id=l.id) as last_backup_at
      from debt_service.licenses l where l.kind='customer'
        and (coalesce(p_args->>'search','')='' or l.label ilike '%'||(p_args->>'search')||'%' or l.phone ilike '%'||(p_args->>'search')||'%')
      order by l.created_at desc limit 100 offset greatest(0,coalesce((p_args->>'offset')::int,0))
    )t;
    return jsonb_build_object('ok',true,'licenses',rows_json);
  elsif p_action in ('owner_set_active','owner_reset_device') then
    select * into target from debt_service.licenses where id=(p_args->>'license_id')::uuid and kind='customer' for update;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;
    if p_action='owner_set_active' then
      if jsonb_typeof(p_args->'active') is distinct from 'boolean' then return jsonb_build_object('ok',false,'error','INVALID_REQUEST'); end if;
      update debt_service.licenses set active=(p_args->>'active')::boolean where id=target.id;
    else
      reason=left(trim(coalesce(p_args->>'reason','')),300);
      if char_length(reason)<5 then return jsonb_build_object('ok',false,'error','SUPPORT_REASON_REQUIRED'); end if;
      update debt_service.sessions set revoked_at=now() where device_id in (select id from debt_service.devices where license_id=target.id);
      update debt_service.devices set released_at=now() where license_id=target.id and released_at is null;
    end if;
    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(lic.id,target.id,p_action,jsonb_build_object('active',p_args->'active','reason',reason));
    return jsonb_build_object('ok',true);
  elsif p_action='owner_audit' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) into rows_json from (
      select a.id,a.action,a.created_at,a.detail,l.label from debt_service.audit a
      left join debt_service.licenses l on l.id=a.target_license_id order by a.created_at desc limit 100)t;
    return jsonb_build_object('ok',true,'events',rows_json);
  end if;
  return jsonb_build_object('ok',false,'error','INVALID_ACTION');
end;
$$;
revoke all on function public.debt_service_dispatch(text,jsonb) from public, anon, authenticated;
grant execute on function public.debt_service_dispatch(text,jsonb) to service_role;
comment on function public.debt_service_dispatch(text,jsonb) is
  'Server-only Debt Store activation and consent-based encrypted backup service. SECURITY INVOKER; no client EXECUTE.';
