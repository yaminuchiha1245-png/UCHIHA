-- UCHIHA Debt: owner-only brief account report for Telegram PDF.
-- Does NOT decrypt or return customer debt registers or backup payloads.
-- An app customer's aggregate backup summary is visible ONLY with consent.
create or replace function public.debt_telegram_admin_user_report(
    p_secret text, p_telegram_id bigint, p_license_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  cfg debt_service.telegram_admin_config%rowtype;
  owner_id uuid;
  customer debt_service.licenses%rowtype;
  latest_summary jsonb;
  latest_at timestamptz;
  latest_app_version text;
  recent_items jsonb;
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$'
     or p_telegram_id is null or p_telegram_id<=0
     or p_license_id is null then
    return jsonb_build_object('ok',false,'error','FORBIDDEN');
  end if;
  select * into cfg from debt_service.telegram_admin_config where singleton;
  if not found or cfg.telegram_id<>p_telegram_id
    or cfg.key_hash<>encode(extensions.digest(p_secret,'sha256'),'hex') then
    return jsonb_build_object('ok',false,'error','FORBIDDEN');
  end if;
  select id into owner_id from debt_service.licenses
   where kind='owner' and active
     and (expires_at is null or expires_at>now())
   order by created_at,id limit 1;
  if owner_id is null then
    return jsonb_build_object('ok',false,'error','OWNER_INACTIVE');
  end if;
  select * into customer from debt_service.licenses
   where id=p_license_id and kind='customer';
  if not found then
    return jsonb_build_object('ok',false,'error','NOT_FOUND');
  end if;

  if customer.backup_consent is true then
    select b.summary,b.created_at,b.app_version
      into latest_summary,latest_at,latest_app_version
    from debt_service.backups b
    where b.license_id=customer.id
    order by b.created_at desc,b.id desc limit 1;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb)
    into recent_items from (
      select id,amount::text as amount,kind,
             left(coalesce(note,''),110) as note,created_at
      from debt_service.digital_wallet_ledger
      where license_id=customer.id
      order by created_at desc,id desc limit 6
    )x;

  -- No customer's full activation code, encrypted backup payload,
  -- debt rows, card data, provider request fields or secrets are returned.
  return jsonb_build_object(
    'ok',true,'generated_at',now(),
    'user',jsonb_build_object(
      'id',customer.id,
      'label',left(customer.label,100),
      'phone',left(coalesce(customer.phone,''),30),
      'active',customer.active,
      'expires_at',customer.expires_at,
      'created_at',customer.created_at,
      'activated_at',customer.activated_at,
      'max_devices',customer.max_devices,
      'devices',(select count(*) from debt_service.devices
         where license_id=customer.id and released_at is null)
    ),
    'wallet',jsonb_build_object(
      'balance',coalesce((select balance::text from debt_service.digital_wallets
                         where license_id=customer.id),'0'),
      'recent',recent_items
    ),
    'orders',jsonb_build_object(
      'total',(select count(*) from debt_service.digital_orders
                where license_id=customer.id),
      'open',(select count(*) from debt_service.digital_orders
                where license_id=customer.id
                  and status in ('pending','processing','unknown'))
    ),
    'backup',case
      when customer.backup_consent is distinct from true
        then jsonb_build_object('status','no_consent')
      when latest_at is null
        then jsonb_build_object('status','not_found')
      else jsonb_build_object(
         'status','available',
         'created_at',latest_at,
         'app_version',latest_app_version,
         'shop',left(coalesce(latest_summary->>'shop',''),80),
         'clients',latest_summary->>'clients',
         'entries',latest_summary->>'entries',
         'products',latest_summary->>'products'
       )
    end
  );
end;
$$;

revoke all on function public.debt_telegram_admin_user_report(
  text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.debt_telegram_admin_user_report(
  text,bigint,uuid) to anon,authenticated,service_role;
