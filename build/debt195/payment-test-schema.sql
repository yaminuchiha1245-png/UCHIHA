-- Isolated CI database only. No real users, account keys, or customer records.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema app_private;
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
create table public.stores(id uuid primary key,name text,owner_user_id uuid);
create table public.customers(id uuid primary key,store_id uuid not null references public.stores(id),name text,is_deleted boolean not null default false);
create table public.store_members(store_id uuid references public.stores(id),user_id uuid,role text,display_name text,
  can_record_payments boolean default true,can_record_purchases boolean default true,
  can_edit_purchases boolean default true,can_delete_purchases boolean default true,
  can_add_clients boolean default true,primary key(store_id,user_id));
create table public.transactions(
  id uuid primary key,store_id uuid not null references public.stores(id),customer_id uuid not null references public.customers(id),
  source_key text,kind text not null,description text,original_currency text not null,original_amount numeric(18,2) not null,
  usd_amount numeric(18,4) not null,rate_to_usd numeric,rate_usd_try numeric,rate_usd_syp numeric,
  paid_from_row_usd numeric not null default 0,remaining_usd numeric not null default 0,
  recorded_by uuid,recorded_by_name text,auth_method text,invoice_id uuid,
  is_deleted boolean not null default false,deleted_at timestamptz,deleted_by uuid,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(store_id,source_key)
);
create index on public.transactions(store_id,customer_id,created_at);
create function app_private.is_store_member(p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.store_members where store_id=p_store and user_id=auth.uid())
$$;
create function app_private.member_can(p_store uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select case when role='owner' then true
    when p_permission='record_payment' then can_record_payments
    when p_permission='record_purchase' then can_record_purchases
    when p_permission='edit_purchase' then can_edit_purchases
    when p_permission='delete_purchase' then can_delete_purchases
    when p_permission='add_client' then can_add_clients else false end
    from public.store_members where store_id=p_store and user_id=auth.uid()),false)
$$;
grant usage on schema public,auth,app_private to authenticated;
grant execute on function auth.uid(),app_private.is_store_member(uuid),app_private.member_can(uuid,text) to authenticated;
grant select,insert,update on public.transactions to authenticated;
grant select on public.customers,public.stores,public.store_members to authenticated;
alter table public.transactions enable row level security;
alter table public.customers enable row level security;
alter table public.store_members enable row level security;
create policy tx_select on public.transactions for select to authenticated using(app_private.is_store_member(store_id));
create policy tx_insert on public.transactions for insert to authenticated with check(app_private.member_can(store_id,case when kind='payment' then 'record_payment' else 'record_purchase' end));
create policy tx_update on public.transactions for update to authenticated using(app_private.is_store_member(store_id)) with check(app_private.is_store_member(store_id));
create policy customer_select on public.customers for select to authenticated using(app_private.is_store_member(store_id));
create policy member_select on public.store_members for select to authenticated using(app_private.is_store_member(store_id));

insert into public.stores values
 ('10000000-0000-4000-8000-000000000001','CI store','30000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','Other store','30000000-0000-4000-8000-000000000003');
insert into public.store_members(store_id,user_id,role,display_name,can_record_payments) values
 ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','owner','CI owner',true),
 ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','partner','Disabled payer',false);
insert into public.customers values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Legacy fixture',false);
insert into public.transactions(id,store_id,customer_id,source_key,kind,original_currency,original_amount,usd_amount,created_at) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture:purchase','purchase','TRY',6189,154.725,'2026-10-18'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture:payment-a','payment','TRY',6188,154.7,'2026-10-19 10:03:25Z'),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture:payment-b','payment','TRY',1,.025,'2026-10-19 10:03:39Z'),
 ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture:invalid','payment','TRY',6100,152.5,'2026-10-19 12:03:18Z'),
 ('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture:later','purchase','TRY',400,10,'2026-10-23');
