-- v1.5.28: enforce partner permissions server-side.
-- Existing permission values are preserved; this changes enforcement, not user data.

create or replace function app_private.is_store_owner(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public','auth'
as $$
  select exists(
    select 1
    from public.stores s
    where s.id=p_store and s.owner_user_id=auth.uid()
  );
$$;

create or replace function app_private.member_can(p_store uuid,p_permission text)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public','auth'
as $$
  select coalesce((
    select case
      when m.role='owner' then true
      when p_permission='record_purchase' then m.can_record_purchases
      when p_permission='record_payment' then m.can_record_payments
      when p_permission='add_client' then m.can_add_clients
      when p_permission='edit_purchase' then m.can_edit_purchases
      when p_permission='delete_purchase' then m.can_delete_purchases
      when p_permission='delete_customer' then m.can_delete_customers
      else false
    end
    from public.store_members m
    where m.store_id=p_store and m.user_id=auth.uid()
    limit 1
  ),false);
$$;

create or replace function app_private.guard_member_presence_update()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','auth','app_private'
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if new.store_id is distinct from old.store_id
     or new.user_id is distinct from old.user_id
     or new.role is distinct from old.role then
    raise exception 'immutable member identity';
  end if;

  if app_private.is_store_owner(old.store_id) then return new; end if;

  if old.user_id is distinct from auth.uid() then raise exception 'not allowed'; end if;

  if new.display_name is distinct from old.display_name
     or new.can_record_purchases is distinct from old.can_record_purchases
     or new.can_record_payments is distinct from old.can_record_payments
     or new.can_add_clients is distinct from old.can_add_clients
     or new.can_edit_purchases is distinct from old.can_edit_purchases
     or new.can_delete_purchases is distinct from old.can_delete_purchases
     or new.can_delete_customers is distinct from old.can_delete_customers
     or new.created_at is distinct from old.created_at then
    raise exception 'self update may only change presence';
  end if;

  return new;
end;
$$;

drop policy if exists members_update_members on public.store_members;
create policy members_update_members
on public.store_members
for update
to authenticated
using (app_private.is_store_owner(store_id))
with check (app_private.is_store_owner(store_id));

drop policy if exists members_delete_members on public.store_members;
create policy members_delete_members
on public.store_members
for delete
to authenticated
using (app_private.is_store_owner(store_id) and role <> 'owner');

create or replace function public.join_store(p_invite_code text,p_display_name text default '')
returns public.store_members
language plpgsql
security definer
set search_path='pg_catalog','public','auth'
as $$
declare
  s public.stores;
  m public.store_members;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into s from public.stores
  where invite_code=upper(trim(p_invite_code));
  if s.id is null then raise exception 'invalid invite code'; end if;

  insert into public.store_members(
    store_id,user_id,role,display_name,
    can_record_purchases,can_record_payments,can_add_clients,
    can_edit_purchases,can_delete_purchases,can_delete_customers
  ) values(
    s.id,auth.uid(),'partner',coalesce(nullif(trim(p_display_name),''),'شريك'),
    true,true,true,true,false,false
  )
  on conflict(store_id,user_id) do update set display_name=excluded.display_name
  returning * into m;

  return m;
end;
$$;
