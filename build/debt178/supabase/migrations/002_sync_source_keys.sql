-- v1.5.28: ensure every shared customer and ledger row has a durable source key.

create or replace function public.debt_fill_sync_source_key()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.source_key is null or btrim(new.source_key)='' then
    if tg_table_name='transactions' then
      new.source_key='cloud-entry:'||new.id::text;
    elsif tg_table_name='customers' then
      new.source_key='cloud-client:'||new.id::text;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_fill_source_key on public.transactions;
create trigger transactions_fill_source_key
before insert on public.transactions
for each row execute function public.debt_fill_sync_source_key();

drop trigger if exists customers_fill_source_key on public.customers;
create trigger customers_fill_source_key
before insert on public.customers
for each row execute function public.debt_fill_sync_source_key();

-- Historical rows are backfilled without changing amounts, dates, customers or balances.
alter table public.transactions disable trigger trg_guard_transaction_update;
alter table public.customers disable trigger trg_guard_customer_update;

update public.transactions
set source_key='cloud-entry:'||id::text
where source_key is null or btrim(source_key)='';

update public.customers
set source_key='cloud-client:'||id::text
where source_key is null or btrim(source_key)='';

alter table public.transactions enable trigger trg_guard_transaction_update;
alter table public.customers enable trigger trg_guard_customer_update;

revoke all on function public.debt_fill_sync_source_key() from public;
