-- UCHIHA Debt Store v1.5.30
-- Additive partner-code compatibility. Existing stores, store_members and debt rows are preserved.

alter table public.stores
  add column if not exists partner_limit integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='stores_partner_limit_check'
      and conrelid='public.stores'::regclass
  ) then
    alter table public.stores
      add constraint stores_partner_limit_check check (partner_limit between 0 and 20);
  end if;
end $$;

update public.stores s
set partner_limit=greatest(
  s.partner_limit,
  (select count(*)::int from public.store_members m where m.store_id=s.id and m.role='partner')
);

alter table debt_service.licenses
  add column if not exists store_id uuid references public.stores(id) on delete set null,
  add column if not exists parent_license_id uuid references debt_service.licenses(id) on delete set null,
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists cloud_email_cipher bytea,
  add column if not exists cloud_password_cipher bytea;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='debt_service.licenses'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table debt_service.licenses drop constraint %I',c.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint
    where conname='licenses_kind_check'
      and conrelid='debt_service.licenses'::regclass
  ) then
    alter table debt_service.licenses
      add constraint licenses_kind_check check (kind in ('owner','customer','partner'));
  end if;
end $$;

create unique index if not exists debt_service_partner_auth_user
  on debt_service.licenses(auth_user_id)
  where kind='partner' and auth_user_id is not null;
create index if not exists debt_service_partner_store
  on debt_service.licenses(store_id,created_at desc)
  where kind='partner';
create index if not exists debt_service_partner_parent
  on debt_service.licenses(parent_license_id);

create or replace function public.debt_partner_probe(p_code_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare lic debt_service.licenses%rowtype; s public.stores%rowtype; key_text text; partner_count int;
begin
  if coalesce(p_code_hash,'') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'error','INVALID_CODE');
  end if;
  select * into lic from debt_service.licenses
    where code_hash=p_code_hash and kind='partner' for update;
  if not found or not lic.active or (lic.expires_at is not null and lic.expires_at<=now()) then
    return jsonb_build_object('ok',false,'error','INVALID_CODE');
  end if;
  select * into s from public.stores where id=lic.store_id;
  if not found then return jsonb_build_object('ok',false,'error','STORE_NOT_FOUND'); end if;
  select count(*)::int into partner_count from public.store_members
    where store_id=s.id and role='partner';
  if lic.auth_user_id is null and partner_count>=s.partner_limit then
    return jsonb_build_object('ok',false,'error','PARTNER_LIMIT');
  end if;
  if lic.auth_user_id is not null then
    select encryption_key into key_text from debt_service.config where singleton;
    return jsonb_build_object('ok',true,'provisioned',true,
      'license_id',lic.id,'store_id',s.id,'store_name',s.name,
      'partner_limit',s.partner_limit,'partner_count',partner_count,'label',lic.label,
      'cloud_email',extensions.pgp_sym_decrypt(lic.cloud_email_cipher,key_text),
      'cloud_password',extensions.pgp_sym_decrypt(lic.cloud_password_cipher,key_text));
  end if;
  return jsonb_build_object('ok',true,'provisioned',false,
    'license_id',lic.id,'store_id',s.id,'store_name',s.name,
    'partner_limit',s.partner_limit,'partner_count',partner_count,'label',lic.label);
end $$;

create or replace function public.debt_partner_bind(
  p_code_hash text,p_auth_user_id uuid,p_cloud_email text,p_cloud_password text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare lic debt_service.licenses%rowtype; s public.stores%rowtype; key_text text; partner_count int;
begin
  if coalesce(p_code_hash,'') !~ '^[a-f0-9]{64}$' or p_auth_user_id is null
     or char_length(coalesce(p_cloud_email,''))<3 or char_length(coalesce(p_cloud_password,''))<16 then
    return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
  end if;
  select * into lic from debt_service.licenses
    where code_hash=p_code_hash and kind='partner' for update;
  if not found or not lic.active or (lic.expires_at is not null and lic.expires_at<=now()) then
    return jsonb_build_object('ok',false,'error','INVALID_CODE');
  end if;
  select * into s from public.stores where id=lic.store_id for update;
  if not found then return jsonb_build_object('ok',false,'error','STORE_NOT_FOUND'); end if;
  if lic.auth_user_id is not null then
    if lic.auth_user_id<>p_auth_user_id then return jsonb_build_object('ok',false,'error','ALREADY_BOUND'); end if;
    return jsonb_build_object('ok',true,'store_id',s.id,'store_name',s.name);
  end if;
  select count(*)::int into partner_count from public.store_members
    where store_id=s.id and role='partner';
  if partner_count>=s.partner_limit then return jsonb_build_object('ok',false,'error','PARTNER_LIMIT'); end if;

  insert into public.store_members(
    store_id,user_id,role,display_name,
    can_record_purchases,can_record_payments,can_add_clients,
    can_edit_purchases,can_delete_purchases,can_delete_customers
  ) values (
    s.id,p_auth_user_id,'partner',coalesce(nullif(trim(lic.label),''),'شريك'),
    true,true,true,true,false,false
  ) on conflict(store_id,user_id) do update set display_name=excluded.display_name;

  select encryption_key into key_text from debt_service.config where singleton;
  update debt_service.licenses set
    auth_user_id=p_auth_user_id,
    cloud_email_cipher=extensions.pgp_sym_encrypt(p_cloud_email,key_text,'cipher-algo=aes256'),
    cloud_password_cipher=extensions.pgp_sym_encrypt(p_cloud_password,key_text,'cipher-algo=aes256'),
    activated_at=coalesce(activated_at,now())
  where id=lic.id;

  insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
  values(coalesce(lic.parent_license_id,(select id from debt_service.licenses where kind='owner' order by created_at limit 1)),
         lic.id,'partner_bound',jsonb_build_object('store_id',s.id,'auth_user_id',p_auth_user_id));
  return jsonb_build_object('ok',true,'store_id',s.id,'store_name',s.name);
end $$;

revoke all on function public.debt_partner_probe(text) from public,anon,authenticated;
revoke all on function public.debt_partner_bind(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.debt_partner_probe(text) to service_role;
grant execute on function public.debt_partner_bind(text,uuid,text,text) to service_role;
