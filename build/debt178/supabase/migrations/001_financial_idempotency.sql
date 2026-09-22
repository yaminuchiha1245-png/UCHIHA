-- v1.5.28: durable request IDs for monetary actions.

alter table debt_service.digital_orders
  add column if not exists client_request_id text;
alter table debt_service.digital_topups
  add column if not exists client_request_id text;
alter table debt_service.digital_wallet_ledger
  add column if not exists client_request_id text;

create unique index if not exists digital_orders_license_request_uidx
  on debt_service.digital_orders(license_id,client_request_id)
  where client_request_id is not null and client_request_id<>'';
create unique index if not exists digital_topups_license_request_uidx
  on debt_service.digital_topups(license_id,client_request_id)
  where client_request_id is not null and client_request_id<>'';
create unique index if not exists digital_wallet_ledger_actor_request_uidx
  on debt_service.digital_wallet_ledger(actor_license_id,client_request_id)
  where client_request_id is not null and client_request_id<>'';

create or replace function public.debt_digital_purchase_begin_idempotent(
  p_actor uuid,p_request_id text,p_product_id bigint,p_product_name text,
  p_amount numeric,p_quantity integer,p_fields jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  _lic debt_service.licenses%rowtype;
  _wallet debt_service.digital_wallets%rowtype;
  _order debt_service.digital_orders%rowtype;
  _balance numeric(18,4);
begin
  if p_actor is null or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9:_-]{12,100}$'
     or p_product_id is null or p_product_id<=0
     or p_amount is null or p_amount<=0 or p_amount>1000000
     or p_quantity is null or p_quantity<1 or p_quantity>1000000
     or p_fields is null or jsonb_typeof(p_fields)<>'object' then
    return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
  end if;

  select * into _lic from debt_service.licenses
  where id=p_actor and active and (expires_at is null or expires_at>now());
  if not found then return jsonb_build_object('ok',false,'error','LICENSE_INACTIVE'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':purchase:'||p_request_id,0));

  select * into _order from debt_service.digital_orders
  where license_id=p_actor and client_request_id=p_request_id limit 1;
  if found then
    select balance into _balance from debt_service.digital_wallets where license_id=p_actor;
    return jsonb_build_object(
      'ok',true,'order_id',_order.id,'request_uuid',_order.id::text,
      'balance',coalesce(_balance,0),'replayed',true,'status',_order.status,
      'provider_order_id',coalesce(_order.provider_order_id,''),
      'provider_uuid',coalesce(_order.provider_uuid,'')
    );
  end if;

  insert into debt_service.digital_wallets(license_id) values(p_actor)
    on conflict(license_id) do nothing;
  select * into _wallet from debt_service.digital_wallets
    where license_id=p_actor for update;
  if _wallet.balance<p_amount then
    return jsonb_build_object('ok',false,'error','INSUFFICIENT_BALANCE','balance',_wallet.balance);
  end if;

  update debt_service.digital_wallets set balance=balance-p_amount,updated_at=now()
    where license_id=p_actor returning balance into _balance;

  insert into debt_service.digital_orders(
    license_id,client_request_id,product_id,product_name,amount,quantity,fields,request_data,
    provider_order_id,provider_uuid,provider_status,status
  ) values(
    p_actor,p_request_id,p_product_id,left(coalesce(p_product_name,'منتج رقمي'),250),
    round(p_amount,4),p_quantity,p_fields,p_fields,'','','PENDING','pending'
  ) returning * into _order;

  insert into debt_service.digital_wallet_ledger(
    license_id,amount,kind,reference_id,note,actor_license_id
  ) values(p_actor,-round(p_amount,4),'purchase',_order.id,'شراء: '||_order.product_name,p_actor);

  return jsonb_build_object(
    'ok',true,'order_id',_order.id,'request_uuid',_order.id::text,
    'balance',_balance,'replayed',false,'status',_order.status,
    'provider_order_id','','provider_uuid',''
  );
end;
$$;

create or replace function public.debt_digital_topup_create_idempotent(
  p_actor uuid,p_request_id text,p_amount numeric,p_proof_data text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  _lic debt_service.licenses%rowtype;
  _topup debt_service.digital_topups%rowtype;
begin
  if p_actor is null or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9:_-]{12,100}$'
     or p_amount is null or p_amount<=0 or p_amount>1000000
     or coalesce(p_proof_data,'') !~ '^data:image/(png|jpeg|jpg|webp);base64,'
     or octet_length(coalesce(p_proof_data,''))>3500000 then
    return jsonb_build_object('ok',false,'error',
      case when p_amount is null or p_amount<=0 or p_amount>1000000 then 'INVALID_AMOUNT'
           when coalesce(p_proof_data,'') !~ '^data:image/(png|jpeg|jpg|webp);base64,'
             or octet_length(coalesce(p_proof_data,''))>3500000 then 'INVALID_PROOF'
           else 'INVALID_REQUEST' end);
  end if;

  select * into _lic from debt_service.licenses
  where id=p_actor and active and (expires_at is null or expires_at>now());
  if not found then return jsonb_build_object('ok',false,'error','LICENSE_INACTIVE'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':topup:'||p_request_id,0));

  select * into _topup from debt_service.digital_topups
  where license_id=p_actor and client_request_id=p_request_id limit 1;
  if found then
    return jsonb_build_object(
      'ok',true,'id',_topup.id,'status',_topup.status,
      'created_at',_topup.created_at,'replayed',true
    );
  end if;

  insert into debt_service.digital_topups(
    license_id,client_request_id,amount_requested,proof_data,amount_credited
  ) values(p_actor,p_request_id,round(p_amount,4),p_proof_data,0)
  returning * into _topup;

  return jsonb_build_object(
    'ok',true,'id',_topup.id,'status',_topup.status,
    'created_at',_topup.created_at,'replayed',false
  );
end;
$$;

create or replace function public.debt_digital_wallet_adjust_idempotent(
  p_actor uuid,p_target uuid,p_request_id text,p_amount numeric,p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  _actor debt_service.licenses%rowtype;
  _target debt_service.licenses%rowtype;
  _existing bigint;
  _balance numeric(18,4);
begin
  if p_actor is null or p_target is null or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9:_-]{12,100}$'
     or p_amount is null or p_amount=0 or abs(p_amount)>1000000 then
    return jsonb_build_object('ok',false,'error','INVALID_REQUEST');
  end if;

  select * into _actor from debt_service.licenses
  where id=p_actor and kind='owner' and active
    and (expires_at is null or expires_at>now());
  if not found then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;

  select * into _target from debt_service.licenses where id=p_target and kind='customer';
  if not found then return jsonb_build_object('ok',false,'error','NOT_FOUND'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':wallet:'||p_request_id,0));

  select id into _existing from debt_service.digital_wallet_ledger
  where actor_license_id=p_actor and client_request_id=p_request_id limit 1;
  if found then
    select coalesce(balance,0) into _balance from debt_service.digital_wallets where license_id=p_target;
    return jsonb_build_object('ok',true,'balance',coalesce(_balance,0),'replayed',true);
  end if;

  insert into debt_service.digital_wallets(license_id) values(p_target)
    on conflict(license_id) do nothing;
  select balance into _balance from debt_service.digital_wallets
    where license_id=p_target for update;

  if _balance+p_amount<0 then
    return jsonb_build_object('ok',false,'error','INSUFFICIENT_BALANCE');
  end if;

  update debt_service.digital_wallets set balance=balance+p_amount,updated_at=now()
    where license_id=p_target returning balance into _balance;

  insert into debt_service.digital_wallet_ledger(
    license_id,amount,kind,note,actor_license_id,client_request_id
  ) values(
    p_target,p_amount,'manual',left(coalesce(p_reason,'تعديل يدوي'),300),p_actor,p_request_id
  );

  return jsonb_build_object('ok',true,'balance',_balance,'replayed',false);
end;
$$;

revoke execute on function public.debt_digital_purchase_begin_idempotent(uuid,text,bigint,text,numeric,integer,jsonb)
  from public,anon,authenticated;
revoke execute on function public.debt_digital_topup_create_idempotent(uuid,text,numeric,text)
  from public,anon,authenticated;
revoke execute on function public.debt_digital_wallet_adjust_idempotent(uuid,uuid,text,numeric,text)
  from public,anon,authenticated;

grant execute on function public.debt_digital_purchase_begin_idempotent(uuid,text,bigint,text,numeric,integer,jsonb)
  to service_role;
grant execute on function public.debt_digital_topup_create_idempotent(uuid,text,numeric,text)
  to service_role;
grant execute on function public.debt_digital_wallet_adjust_idempotent(uuid,uuid,text,numeric,text)
  to service_role;
