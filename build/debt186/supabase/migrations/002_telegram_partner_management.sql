CREATE OR REPLACE FUNCTION public.debt_telegram_partner_dispatch(p_secret text, p_telegram_id bigint, p_action text, p_args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg debt_service.telegram_admin_config%rowtype;
  owner_id uuid;
  store_row public.stores%rowtype;
  lic debt_service.licenses%rowtype;
  rows_json jsonb;
  members_json jsonb;
  codes_json jsonb;
  target_store uuid;
  target_license uuid;
  new_code text;
  key_text text;
  limit_n int;
  actual_partners int;
  pending_codes int;
  expiry_ts timestamptz;
begin
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

  if p_action='dashboard' then
    return jsonb_build_object(
      'ok',true,
      'stores',(select count(*) from public.stores),
      'partners',(select count(*) from public.store_members where role='partner'),
      'pending_codes',(select count(*) from debt_service.licenses
        where kind='partner' and active and auth_user_id is null
          and (expires_at is null or expires_at>now()))
    );

  elsif p_action='stores' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb)
      into rows_json
    from (
      select s.id,s.name,s.phone,s.village,s.partner_limit,s.created_at,
             (select count(*) from public.store_members m
                where m.store_id=s.id and m.role='partner') as partner_count,
             (select count(*) from debt_service.licenses l
                where l.store_id=s.id and l.kind='partner' and l.active
                  and l.auth_user_id is null
                  and (l.expires_at is null or l.expires_at>now())) as pending_codes
      from public.stores s
      order by s.created_at,s.id
    ) x;
    return jsonb_build_object('ok',true,'items',rows_json);

  elsif p_action='store' then
    begin target_store:=(p_args->>'store_id')::uuid;
    exception when others then return jsonb_build_object('ok',false,'error','INVALID_ID'); end;

    select * into store_row from public.stores where id=target_store;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;

    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb)
      into members_json
    from (
      select m.id,m.role,m.display_name,m.created_at,m.last_seen_at,m.app_version,
             m.can_record_purchases,m.can_record_payments,m.can_add_clients,
             case
               when m.role='partner'
                and not exists(select 1 from debt_service.licenses l
                  where l.kind='partner' and l.auth_user_id=m.user_id)
               then true else false
             end as legacy_partner
      from public.store_members m
      where m.store_id=target_store
      order by case when m.role='owner' then 0 else 1 end,m.created_at
    ) x;

    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
      into codes_json
    from (
      select l.id,l.label,l.active,l.created_at,l.activated_at,l.expires_at,l.code_hint,
             (l.auth_user_id is not null) as redeemed
      from debt_service.licenses l
      where l.store_id=target_store and l.kind='partner'
      order by l.created_at desc
    ) x;

    return jsonb_build_object(
      'ok',true,
      'store',jsonb_build_object(
        'id',store_row.id,'name',store_row.name,'phone',store_row.phone,
        'village',store_row.village,'partner_limit',store_row.partner_limit
      ),
      'members',members_json,
      'codes',codes_json
    );

  elsif p_action='set_limit' then
    begin
      target_store:=(p_args->>'store_id')::uuid;
      limit_n:=(p_args->>'limit')::int;
    exception when others then return jsonb_build_object('ok',false,'error','INVALID_REQUEST'); end;
    if limit_n<0 or limit_n>20 then
      return jsonb_build_object('ok',false,'error','INVALID_PARTNER_LIMIT');
    end if;

    select * into store_row from public.stores where id=target_store for update;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;

    select count(*)::int into actual_partners from public.store_members
      where store_id=target_store and role='partner';
    select count(*)::int into pending_codes from debt_service.licenses
      where store_id=target_store and kind='partner' and active
        and auth_user_id is null
        and (expires_at is null or expires_at>now());

    if limit_n < actual_partners + pending_codes then
      return jsonb_build_object(
        'ok',false,'error','LIMIT_BELOW_CURRENT',
        'minimum',actual_partners+pending_codes,
        'partners',actual_partners,'pending_codes',pending_codes
      );
    end if;

    update public.stores set partner_limit=limit_n where id=target_store;
    insert into debt_service.audit(actor_license_id,action,detail)
      values(owner_id,'bot_partner_limit',
        jsonb_build_object('store_id',target_store,'limit',limit_n));

    return jsonb_build_object('ok',true,'partner_limit',limit_n);

  elsif p_action='code_create' then
    begin target_store:=(p_args->>'store_id')::uuid;
    exception when others then return jsonb_build_object('ok',false,'error','INVALID_ID'); end;

    select * into store_row from public.stores where id=target_store for update;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;

    select count(*)::int into actual_partners from public.store_members
      where store_id=target_store and role='partner';
    select count(*)::int into pending_codes from debt_service.licenses
      where store_id=target_store and kind='partner' and active
        and auth_user_id is null
        and (expires_at is null or expires_at>now());

    if actual_partners + pending_codes >= store_row.partner_limit then
      return jsonb_build_object(
        'ok',false,'error','PARTNER_LIMIT',
        'partner_limit',store_row.partner_limit,
        'partners',actual_partners,'pending_codes',pending_codes
      );
    end if;

    if char_length(trim(coalesce(p_args->>'label','')))<1
       or char_length(trim(p_args->>'label'))>120 then
      return jsonb_build_object('ok',false,'error','INVALID_LABEL');
    end if;

    expiry_ts:=null;
    if coalesce(p_args->>'expires_on','')<>'' then
      if (p_args->>'expires_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        return jsonb_build_object('ok',false,'error','INVALID_EXPIRY');
      end if;
      begin expiry_ts:=(p_args->>'expires_on')::date+interval '1 day';
      exception when others then return jsonb_build_object('ok',false,'error','INVALID_EXPIRY'); end;
      if expiry_ts<=now() then return jsonb_build_object('ok',false,'error','INVALID_EXPIRY'); end if;
    end if;

    new_code:=upper(encode(extensions.gen_random_bytes(16),'hex'));
    select encryption_key into key_text from debt_service.config where singleton;

    insert into debt_service.licenses(
      kind,label,phone,code_hash,code_cipher,code_hint,max_devices,expires_at,created_by,store_id
    ) values (
      'partner',trim(p_args->>'label'),'',
      encode(extensions.digest(new_code,'sha256'),'hex'),
      extensions.pgp_sym_encrypt(new_code,key_text,'cipher-algo=aes256'),
      right(new_code,4),1,expiry_ts,owner_id,target_store
    ) returning * into lic;

    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(owner_id,lic.id,'bot_partner_code_created',
        jsonb_build_object('store_id',target_store,'store_name',store_row.name));

    return jsonb_build_object(
      'ok',true,'license_id',lic.id,'code',new_code,
      'store_id',target_store,'store_name',store_row.name,
      'remaining',store_row.partner_limit-actual_partners-pending_codes-1
    );

  elsif p_action='code_reveal' then
    begin target_license:=(p_args->>'license_id')::uuid;
    exception when others then return jsonb_build_object('ok',false,'error','INVALID_ID'); end;
    select * into lic from debt_service.licenses
      where id=target_license and kind='partner';
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;
    select encryption_key into key_text from debt_service.config where singleton;
    return jsonb_build_object(
      'ok',true,'license_id',lic.id,'label',lic.label,'active',lic.active,
      'redeemed',(lic.auth_user_id is not null),
      'code',extensions.pgp_sym_decrypt(lic.code_cipher,key_text)
    );

  elsif p_action='code_toggle' then
    begin target_license:=(p_args->>'license_id')::uuid;
    exception when others then return jsonb_build_object('ok',false,'error','INVALID_ID'); end;
    if jsonb_typeof(p_args->'active') is distinct from 'boolean' then
      return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
    end if;
    update debt_service.licenses
       set active=(p_args->>'active')::boolean
     where id=target_license and kind='partner'
     returning * into lic;
    if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;
    insert into debt_service.audit(actor_license_id,target_license_id,action,detail)
      values(owner_id,lic.id,'bot_partner_code_toggle',
        jsonb_build_object('active',lic.active,'store_id',lic.store_id));
    return jsonb_build_object('ok',true,'active',lic.active);

  end if;

  return jsonb_build_object('ok',false,'error','UNKNOWN_ACTION');
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
    return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
end;
$function$


revoke all on function public.debt_telegram_partner_dispatch(text,bigint,text,jsonb) from public;
grant execute on function public.debt_telegram_partner_dispatch(text,bigint,text,jsonb) to anon,authenticated,service_role;
