-- v1.5.39: reject excess payments atomically. Existing financial rows are preserved.
begin;

create table if not exists app_private.debt_ledger_locks_v195 (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  store_id uuid not null,
  revision bigint not null default 0
);
alter table app_private.debt_ledger_locks_v195 enable row level security;
revoke all on app_private.debt_ledger_locks_v195 from public, anon, authenticated;

create or replace function app_private.debt_replay_v195(
  p_store uuid, p_customer uuid, p_currency text,
  p_replace_id uuid default null, p_replacement jsonb default null
)
returns table(balance numeric, invalid_ids uuid[], accepted_payments numeric)
language plpgsql volatile security invoker set search_path = ''
as $function$
declare r record;
begin
  balance := 0; invalid_ids := array[]::uuid[]; accepted_payments := 0;
  for r in
    select q.* from (
      select t.id,t.kind,t.original_amount,t.created_at,t.source_key
      from public.transactions t
      where t.store_id=p_store and t.customer_id=p_customer
        and t.original_currency=p_currency and not t.is_deleted
        and (p_replace_id is null or t.id<>p_replace_id)
      union all
      select (p_replacement->>'id')::uuid,p_replacement->>'kind',
        (p_replacement->>'original_amount')::numeric,
        (p_replacement->>'created_at')::timestamptz,p_replacement->>'source_key'
      where p_replacement is not null
        and p_replacement->>'original_currency'=p_currency
        and not coalesce((p_replacement->>'is_deleted')::boolean,false)
    ) q
    order by floor(extract(epoch from q.created_at)*1000),
      case when q.kind='payment' then 1 else 0 end,
      coalesce(nullif(q.source_key,''),q.id::text)
  loop
    if r.kind in ('purchase','opening_balance','correction') then
      balance := balance+r.original_amount;
    elsif r.kind='payment' then
      if r.original_amount>0 and r.original_amount<=balance then
        balance := balance-r.original_amount;
        accepted_payments := accepted_payments+r.original_amount;
      else
        invalid_ids := array_append(invalid_ids,r.id);
      end if;
    end if;
  end loop;
  return next;
end;
$function$;
revoke all on function app_private.debt_replay_v195(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function app_private.debt_replay_v195(uuid,uuid,text,uuid,jsonb) to authenticated;

create or replace function app_private.debt_guard_transaction_v195()
returns trigger language plpgsql volatile security definer set search_path = ''
as $function$
declare
  existing public.transactions%rowtype;
  previous_state record;
  next_state record;
  currency text;
  latest_at timestamptz;
begin
  if auth.uid() is null or not app_private.is_store_member(new.store_id) then
    raise exception using errcode='42501',message='PAYMENT_NOT_AUTHORIZED';
  end if;
  if not exists(select 1 from public.customers c where c.id=new.customer_id and c.store_id=new.store_id and not c.is_deleted) then
    raise exception using errcode='23514',message='PAYMENT_CUSTOMER_MISMATCH';
  end if;
  if tg_op='INSERT' and not app_private.member_can(new.store_id,
      case when new.kind='payment' then 'record_payment' else 'record_purchase' end) then
    raise exception using errcode='42501',message='PAYMENT_NOT_AUTHORIZED';
  end if;
  if new.original_amount<0 or new.original_amount::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='23514',message='PAYMENT_INVALID_AMOUNT';
  end if;
  if tg_op='UPDATE' then
    if new.store_id<>old.store_id or new.customer_id<>old.customer_id or new.kind<>old.kind then
      raise exception using errcode='23514',message='PAYMENT_IMMUTABLE_SCOPE';
    end if;
    if new.original_amount is not distinct from old.original_amount
      and new.original_currency is not distinct from old.original_currency
      and new.is_deleted is not distinct from old.is_deleted
      and new.created_at is not distinct from old.created_at then return new; end if;
  end if;

  -- A real write, rather than an advisory/read lock, also makes REPEATABLE READ
  -- contenders fail serialization instead of validating an old MVCC snapshot.
  insert into app_private.debt_ledger_locks_v195 as locks(customer_id,store_id,revision)
    values(new.customer_id,new.store_id,1)
    on conflict(customer_id) do update set revision=locks.revision+1
    where locks.store_id=excluded.store_id;
  if not found then raise exception using errcode='23514',message='PAYMENT_CUSTOMER_MISMATCH'; end if;

  if tg_op='INSERT' then
    select t.* into existing from public.transactions t
    where t.id=new.id or (t.store_id=new.store_id and t.source_key=new.source_key)
    order by (t.id=new.id) desc limit 1;
    if found then
      if new.kind='payment' and (
        existing.store_id<>new.store_id or existing.customer_id<>new.customer_id
        or existing.kind<>new.kind or existing.original_currency<>new.original_currency
        or existing.original_amount<>new.original_amount
      ) then raise exception using errcode='23514',message='PAYMENT_KEY_CONFLICT'; end if;
      -- ON CONFLICT DO NOTHING in the RPC returns the original receipt.
      -- Old merge-upserts still pass through the existing immutable-update guard.
      return new;
    end if;
    if new.kind='payment' then
      if new.original_amount<=0 or new.original_currency not in ('USD','TRY') then
        raise exception using errcode='23514',message='PAYMENT_INVALID_AMOUNT';
      end if;
      select max(t.created_at) into latest_at from public.transactions t
      where t.store_id=new.store_id and t.customer_id=new.customer_id
        and t.original_currency=new.original_currency and not t.is_deleted;
      if new.created_at>clock_timestamp()+interval '5 minutes'
        or (latest_at is not null and new.created_at<latest_at) then
        raise exception using errcode='23514',message='PAYMENT_STALE_SNAPSHOT';
      end if;
      select * into previous_state from app_private.debt_replay_v195(new.store_id,new.customer_id,new.original_currency);
      if new.original_amount>previous_state.balance then
        raise exception using errcode='23514',message='PAYMENT_EXCEEDS_DEBT',
          detail=jsonb_build_object('available',previous_state.balance,'currency',new.original_currency)::text;
      end if;
    end if;
    return new;
  end if;

  -- Editing/removing a purchase must not invalidate an already valid payment.
  for currency in select distinct x from unnest(array[old.original_currency,new.original_currency]) x loop
    select * into previous_state from app_private.debt_replay_v195(old.store_id,old.customer_id,currency);
    select * into next_state from app_private.debt_replay_v195(new.store_id,new.customer_id,currency,old.id,to_jsonb(new));
    if exists(select 1 from unnest(next_state.invalid_ids) x where not(x=any(previous_state.invalid_ids))) then
      raise exception using errcode='23514',message='PAYMENT_WOULD_BECOME_INVALID';
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function app_private.debt_guard_transaction_v195() from public, anon, authenticated;
drop trigger if exists trg_ledger_balance_guard_v195 on public.transactions;
create trigger trg_ledger_balance_guard_v195 before insert or update on public.transactions
for each row execute function app_private.debt_guard_transaction_v195();

create or replace function public.debt_record_payment_v195(
  p_store uuid,p_customer uuid,p_operation_id uuid,p_source_key text,
  p_currency text,p_amount numeric,p_rate_usd_try numeric,p_auth_method text
)
returns jsonb language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  receipt public.transactions%rowtype;
  display text;
  invalid_receipts uuid[];
begin
  if auth.uid() is null or not app_private.member_can(p_store,'record_payment') then
    raise exception using errcode='42501',message='PAYMENT_NOT_AUTHORIZED';
  end if;
  if p_operation_id is null or p_source_key is null or btrim(p_source_key)=''
    or length(p_source_key)>160 or p_amount is null or p_amount<=0
    or p_amount<>round(p_amount,2) or p_currency is null or p_currency not in ('USD','TRY')
    or p_rate_usd_try is null or p_rate_usd_try<=0
    or p_rate_usd_try::text in ('NaN','Infinity','-Infinity')
    or p_amount::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='23514',message='PAYMENT_INVALID_AMOUNT';
  end if;
  select t.* into receipt from public.transactions t
  where t.store_id=p_store and (t.id=p_operation_id or t.source_key=p_source_key) limit 1;
  if found then
    if receipt.customer_id<>p_customer or receipt.kind<>'payment'
      or receipt.original_currency<>p_currency or receipt.original_amount<>p_amount or receipt.is_deleted then
      raise exception using errcode='23514',message='PAYMENT_KEY_CONFLICT';
    end if;
    select invalid_ids into invalid_receipts from app_private.debt_replay_v195(p_store,p_customer,p_currency);
    if receipt.id=any(invalid_receipts) then raise exception using errcode='23514',message='PAYMENT_EXISTING_REVIEW'; end if;
    return to_jsonb(receipt);
  end if;
  select m.display_name into display from public.store_members m
    where m.store_id=p_store and m.user_id=auth.uid();
  insert into public.transactions(id,store_id,customer_id,source_key,kind,description,
    original_currency,original_amount,usd_amount,rate_to_usd,rate_usd_try,
    paid_from_row_usd,remaining_usd,recorded_by,recorded_by_name,auth_method,created_at,updated_at)
  values(p_operation_id,p_store,p_customer,p_source_key,'payment','دفعة',
    p_currency,p_amount,case when p_currency='USD' then p_amount else round(p_amount/p_rate_usd_try,4) end,
    case when p_currency='USD' then 1 else 1/p_rate_usd_try end,p_rate_usd_try,
    case when p_currency='USD' then p_amount else round(p_amount/p_rate_usd_try,4) end,0,
    auth.uid(),coalesce(display,''),left(coalesce(p_auth_method,'pin'),32),clock_timestamp(),clock_timestamp())
  on conflict do nothing returning * into receipt;
  if not found then
    select t.* into receipt from public.transactions t
      where t.store_id=p_store and (t.id=p_operation_id or t.source_key=p_source_key) limit 1;
  end if;
  if receipt.id is null or receipt.customer_id<>p_customer or receipt.kind<>'payment'
    or receipt.original_currency<>p_currency or receipt.original_amount<>p_amount or receipt.is_deleted then
    raise exception using errcode='23514',message='PAYMENT_KEY_CONFLICT';
  end if;
  select invalid_ids into invalid_receipts from app_private.debt_replay_v195(p_store,p_customer,p_currency);
  if receipt.id=any(invalid_receipts) then raise exception using errcode='23514',message='PAYMENT_EXISTING_REVIEW'; end if;
  return to_jsonb(receipt);
end;
$function$;
revoke all on function public.debt_record_payment_v195(uuid,uuid,uuid,text,text,numeric,numeric,text) from public, anon;
grant execute on function public.debt_record_payment_v195(uuid,uuid,uuid,text,text,numeric,numeric,text) to authenticated;
notify pgrst,'reload schema';
commit;
