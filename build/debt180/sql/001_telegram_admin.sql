-- UCHIHA Debt Store: dedicated Telegram admin gateway.
-- Existing app tables and functions are preserved; no data rows are altered.
-- The bot credential is provisioned once with service_role and NEVER uses
-- the service_role key at runtime. Only a SHA256 hash persists in the database.
create table if not exists debt_service.telegram_admin_config (
    singleton boolean primary key default true check (singleton),
    key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
    telegram_id bigint not null check (telegram_id>0),
    rotated_at timestamptz not null default now()
);
alter table debt_service.telegram_admin_config enable row level security;
revoke all on debt_service.telegram_admin_config from public, anon, authenticated;
grant select,insert,update on debt_service.telegram_admin_config to service_role;

create or replace function public.debt_telegram_admin_provision(
    p_secret text, p_telegram_id bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$'
     or p_telegram_id is null or p_telegram_id<1 then
    return jsonb_build_object('ok',false,'error','INVALID_INPUT');
  end if;
  insert into debt_service.telegram_admin_config(singleton,key_hash,telegram_id)
    values(true,encode(extensions.digest(p_secret,'sha256'),'hex'),p_telegram_id)
    on conflict(singleton) do update
      set key_hash=excluded.key_hash,telegram_id=excluded.telegram_id,rotated_at=now();
  return jsonb_build_object('ok',true,'telegram_id',p_telegram_id);
end;
$$;
revoke all on function public.debt_telegram_admin_provision(text,bigint) from public,anon,authenticated;
grant execute on function public.debt_telegram_admin_provision(text,bigint) to service_role;

create or replace function public.debt_telegram_admin_dispatch(
    p_secret text, p_telegram_id bigint, p_action text, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  cfg debt_service.telegram_admin_config%rowtype;
  owner_id uuid;
  target_id uuid;
  lic debt_service.licenses%rowtype;
  topup debt_service.digital_topups%rowtype;
  rows_json jsonb;
  result_json jsonb;
  search_term text;
  action_text text;
  reason_text text;
  amount_n numeric(18,4);
  expiry_ts timestamptz;
  new_code text;
  device_n int;
  total_n bigint;
  offset_n int;
begin
  -- An anonymous caller can reach this RPC but cannot pass this 256-bit gate.
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$'
     or p_telegram_id is null or p_telegram_id < 1 then
    return jsonb_build_object('ok',false,'error','FORBIDDEN');
  end if;
  select * into cfg from debt_service.telegram_admin_config where singleton;
  if not found or cfg.telegram_id<>p_telegram_id
     or cfg.key_hash<>encode(extensions.digest(p_secret,'sha256'),'hex') then
    return jsonb_build_object('ok',false,'error','FORBIDDEN');
  end if;
  select id into owner_id from debt_service.licenses
   where kind='owner' and active and (expires_at is null or expires_at>now())
   order by created_at,id limit 1;
  if owner_id is null then
    return jsonb_build_object('ok',false,'error','OWNER_INACTIVE');
  end if;
  p_args:=coalesce(p_args,'{}'::jsonb);
  search_term:=left(trim(coalesce(p_args->>'search','')),80);
  offset_n:=least(5000,greatest(0,coalesce((p_args->>'offset')::int,0)));
  if p_action='ping' then
    return jsonb_build_object('ok',true,'service','UCHIHA Debt Store Telegram Admin');
  elsif p_action='dashboard' then
    return jsonb_build_object(
      'ok',true,
      'users',(select count(*) from debt_service.licenses where kind='customer'),
      'active_users',(select count(*) from debt_service.licenses where kind='customer' and active and (expires_at is null or expires_at>now())),
      'wallet_total',(select coalesce(sum(dw.balance),0) from debt_service.digital_wallets dw join debt_service.licenses l on l.id=dw.license_id where l.kind='customer'),
      'pending_topups',(select count(*) from debt_service.digital_topups where status='pending'),
      'pending_orders',(select count(*) from debt_service.digital_orders where status in ('pending','processing','unknown'))
    );
  elsif p_action in ('users','wallets') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows_json
      from (
        select l.id,l.label,l.phone,l.active,l.max_devices,l.created_at,l.activated_at,
               l.expires_at,l.code_hint,
               coalesce(dw.balance,0)::numeric as balance,
               (select count(*) from debt_service.devices d where d.license_id=l.id and d.released_at is null) as devices
          from debt_service.licenses l
          left join debt_service.digital_wallets dw on dw.license_id=l.id
         where l.kind='customer'
           and (search_term='' or l.label ilike '%'||search_term||'%' or l.phone ilike '%'||search_term||'%' or l.code_hint=search_term)
         order by l.created_at desc,l.id
         limit 15 offset offset_n
      )x;
    select count(*) into total_n from debt_service.licenses l
      where l.kind='customer'
        and (search_term='' or l.label ilike '%'||search_term||'%' or l.phone ilike '%'||search_term||'%' or l.code_hint=search_term);
    return jsonb_build_object('ok',true,'items',rows_json,'total',total_n,'offset',offset_n);
  elsif p_action='user' then
    begin target_id:=(p_args->>'license_id')::uuid;exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    select * into lic from debt_service.licenses where id=target_id and kind='customer';
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND');end if;
    return jsonb_build_object('ok',true,
      'user',jsonb_build_object('id',lic.id,'label',lic.label,'phone',lic.phone,
        'active',lic.active,'expires_at',lic.expires_at,'max_devices',lic.max_devices,
        'created_at',lic.created_at,'activated_at',lic.activated_at,'code_hint',lic.code_hint,
        'backup_consent',lic.backup_consent,
        'balance',(select coalesce(balance,0) from debt_service.digital_wallets where license_id=lic.id),
        'devices',(select count(*) from debt_service.devices where license_id=lic.id and released_at is null))
    );
  elsif p_action='user_code' then
    begin target_id:=(p_args->>'license_id')::uuid;exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    select * into lic from debt_service.licenses where id=target_id and kind='customer';
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND');end if;
    return jsonb_build_object('ok',true,'label',lic.label,
      'code',(select extensions.pgp_sym_decrypt(lic.code_cipher,c.encryption_key)
                from debt_service.config c where c.singleton));
  elsif p_action='code_create' then
    if char_length(trim(coalesce(p_args->>'label','')))<2
       or char_length(trim(p_args->>'label'))>100 then
       return jsonb_build_object('ok',false,'error','INVALID_LABEL');end if;
    device_n:=coalesce((p_args->>'max_devices')::int,1);
    if device_n<1 or device_n>5 then
       return jsonb_build_object('ok',false,'error','INVALID_DEVICES');end if;
    expiry_ts:=null;
    if coalesce(p_args->>'expires_on','')<>'' then
      if (p_args->>'expires_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        return jsonb_build_object('ok',false,'error','INVALID_EXPIRY');end if;
      begin expiry_ts:=(p_args->>'expires_on')::date+interval '1 day';
      exception when others then
        return jsonb_build_object('ok',false,'error','INVALID_EXPIRY');end;
      if expiry_ts<=now() then
        return jsonb_build_object('ok',false,'error','INVALID_EXPIRY');end if;
    end if;
    new_code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
    insert into debt_service.licenses(
      kind,label,phone,code_hash,code_cipher,code_hint,max_devices,expires_at,created_by
    ) values (
      'customer',trim(p_args->>'label'),left(trim(coalesce(p_args->>'phone','')),30),
      encode(extensions.digest(new_code,'sha256'),'hex'),
      extensions.pgp_sym_encrypt(new_code,(select encryption_key from debt_service.config where singleton),'cipher-algo=aes256'),
      right(new_code,4),device_n,expiry_ts,owner_id
    ) returning id into target_id;
    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(owner_id,target_id,'bot_code_created',jsonb_build_object('max_devices',device_n));
    return jsonb_build_object('ok',true,'license_id',target_id,'code',new_code);
  elsif p_action='user_toggle' then
    begin target_id:=(p_args->>'license_id')::uuid;exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    if jsonb_typeof(p_args->'active') is distinct from 'boolean' then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');end if;
    update debt_service.licenses set active=(p_args->>'active')::boolean
      where id=target_id and kind='customer' returning * into lic;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND');end if;
    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(owner_id,target_id,'bot_user_toggle',jsonb_build_object('active',lic.active));
    return jsonb_build_object('ok',true,'active',lic.active);
  elsif p_action='user_reset_devices' then
    reason_text:=left(trim(coalesce(p_args->>'reason','')),300);
    if char_length(reason_text)<5 then return jsonb_build_object('ok',false,'error','REASON_REQUIRED');end if;
    begin target_id:=(p_args->>'license_id')::uuid;exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    perform 1 from debt_service.licenses where id=target_id and kind='customer';
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND');end if;
    update debt_service.sessions set revoked_at=now()
      where revoked_at is null and device_id in (
        select id from debt_service.devices where license_id=target_id and released_at is null
      );
    update debt_service.devices set released_at=now()
      where license_id=target_id and released_at is null;
    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(owner_id,target_id,'bot_reset_devices',jsonb_build_object('reason',reason_text));
    return jsonb_build_object('ok',true);
  elsif p_action='wallet_adjust' then
    begin target_id:=(p_args->>'license_id')::uuid;
      amount_n:=round((p_args->>'amount')::numeric,4);
    exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');end;
    reason_text:=left(trim(coalesce(p_args->>'reason','')),300);
    if p_args->>'request_id' !~ '^[A-Za-z0-9:_-]{12,100}$'
       or amount_n=0 or abs(amount_n)>1000000 or char_length(reason_text)<3 then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');end if;
    result_json:=public.debt_digital_wallet_adjust_idempotent(
      owner_id,target_id,p_args->>'request_id',amount_n,reason_text);
    if coalesce((result_json->>'ok')::boolean,false)
       and not coalesce((result_json->>'replayed')::boolean,false) then
      insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
        values(owner_id,target_id,'bot_wallet_adjust',
          jsonb_build_object('amount',amount_n,'reason',reason_text,'request_id',p_args->>'request_id'));
    end if;
    return result_json;
  elsif p_action='wallet_ledger' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows_json
      from (
        select lg.id,lg.license_id,l.label,lg.amount,lg.kind,lg.note,lg.created_at,lg.reference_id
        from debt_service.digital_wallet_ledger lg
        left join debt_service.licenses l on l.id=lg.license_id
        order by lg.created_at desc,lg.id desc limit 20 offset offset_n
      ) x;
    return jsonb_build_object('ok',true,'items',rows_json,'offset',offset_n);
  elsif p_action='topups' then
    action_text:=coalesce(p_args->>'filter','pending');
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows_json
      from (
        select t.id,t.license_id,l.label,l.phone,t.amount_requested,t.amount_credited,
               t.status,t.created_at,t.reviewed_at,t.owner_note
        from debt_service.digital_topups t
        join debt_service.licenses l on l.id=t.license_id
        where action_text='all' or t.status='pending'
        order by t.created_at desc limit 15 offset offset_n
      ) x;
    return jsonb_build_object('ok',true,'items',rows_json,'filter',action_text,'offset',offset_n);
  elsif p_action='topup_detail' then
    begin target_id:=(p_args->>'topup_id')::uuid;exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    select to_jsonb(x) into rows_json from (
      select t.id,t.license_id,l.label,l.phone,t.amount_requested,t.amount_credited,
             t.status,t.created_at,t.reviewed_at,t.owner_note
      from debt_service.digital_topups t
      join debt_service.licenses l on l.id=t.license_id
      where t.id=target_id
    ) x;
    if rows_json is null then return jsonb_build_object('ok',false,'error','NOT_FOUND');end if;
    return jsonb_build_object('ok',true,'item',rows_json);
  elsif p_action='topup_proof' then
    begin target_id:=(p_args->>'topup_id')::uuid;exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    select * into topup from debt_service.digital_topups where id=target_id;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND');end if;
    return jsonb_build_object('ok',true,'proof_data',topup.proof_data);
  elsif p_action='topup_review' then
    begin target_id:=(p_args->>'topup_id')::uuid;
      amount_n:=round((p_args->>'amount')::numeric,4);
    exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');end;
    action_text:=p_args->>'decision';
    if action_text not in ('approved','rejected') or amount_n<0 or amount_n>1000000 then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');end if;
    reason_text:=left(trim(coalesce(p_args->>'note','')),300);
    result_json:=public.debt_digital_dispatch('owner_digital_topup_review',owner_id,'owner',
       jsonb_build_object('topup_id',target_id,'decision',action_text,'amount',amount_n,'note',reason_text));
    if coalesce((result_json->>'ok')::boolean,false) then
      insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
        values(owner_id,(select license_id from debt_service.digital_topups where id=target_id),
         'bot_topup_review',jsonb_build_object('topup_id',target_id,'decision',action_text,'amount',amount_n));
    end if;
    return result_json;
  elsif p_action='orders' then
    action_text:=coalesce(p_args->>'filter','open');
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows_json
      from (
        select o.id,o.license_id,l.label,o.product_name,o.amount,o.quantity,
               o.provider_status,o.status,o.created_at,o.updated_at,o.owner_note
        from debt_service.digital_orders o
        join debt_service.licenses l on l.id=o.license_id
        where action_text='all' or o.status in ('pending','processing','unknown')
        order by o.created_at desc limit 15 offset offset_n
      )x;
    return jsonb_build_object('ok',true,'items',rows_json,'filter',action_text,'offset',offset_n);
  elsif p_action='order_detail' then
    begin target_id:=(p_args->>'order_id')::uuid;exception when others then
      return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    select to_jsonb(x) into rows_json from (
      select o.id,o.license_id,l.label,o.product_name,o.amount,o.quantity,
             o.provider_status,o.status,o.created_at,o.updated_at,o.owner_note
      from debt_service.digital_orders o
      join debt_service.licenses l on l.id=o.license_id
      where o.id=target_id
    ) x;
    if rows_json is null then return jsonb_build_object('ok',false,'error','NOT_FOUND');end if;
    return jsonb_build_object('ok',true,'item',rows_json);
  elsif p_action='order_status' then
    begin target_id:=(p_args->>'order_id')::uuid;
    exception when others then return jsonb_build_object('ok',false,'error','INVALID_ID');end;
    action_text:=p_args->>'status';
    if action_text not in ('pending','processing','accepted','completed','rejected','unknown') then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');end if;
    reason_text:=left(trim(coalesce(p_args->>'note','')),300);
    result_json:=public.debt_digital_dispatch('owner_digital_order_update',owner_id,'owner',
       jsonb_build_object('order_id',target_id,'status',action_text,'note',reason_text));
    if coalesce((result_json->>'ok')::boolean,false) then
      insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(owner_id,(select license_id from debt_service.digital_orders where id=target_id),
        'bot_order_status',jsonb_build_object('order_id',target_id,'status',action_text,'note',reason_text));
    end if;
    return result_json;
  elsif p_action='audit' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows_json
      from (
        select a.action,a.created_at,l.label,a.detail
        from debt_service.audit a left join debt_service.licenses l on l.id=a.target_license_id
        order by a.created_at desc limit 15 offset offset_n
      )x;
    return jsonb_build_object('ok',true,'items',rows_json,'offset',offset_n);
  end if;
  return jsonb_build_object('ok',false,'error','UNKNOWN_ACTION');
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
    return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
end;
$$;
revoke all on function public.debt_telegram_admin_dispatch(text,bigint,text,jsonb) from public;
grant execute on function public.debt_telegram_admin_dispatch(text,bigint,text,jsonb)
  to anon,authenticated,service_role;
