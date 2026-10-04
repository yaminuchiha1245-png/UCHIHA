-- v1.5.32 targeted repair for the eight confirmed legacy echo rows in "ماركت النصر".
-- Safety properties:
-- 1) Exact store only.
-- 2) Echo row must have source_key = 'cloud-entry:' || its own id.
-- 3) A separate canonical entry:* row must match every financial/identity field
--    and the exact created_at timestamp.
-- 4) Abort unless the candidate count is exactly 8.
-- 5) Full original rows are stored in debt_service.audit before soft-delete.

do $$
declare
  target_store uuid := 'f0badf63-b378-475a-9f6c-eb14cffdb935';
  ids uuid[];
  backup jsonb;
begin
  select array_agg(e.id order by e.created_at), jsonb_agg(to_jsonb(e) order by e.created_at)
    into ids,backup
  from public.transactions e
  where e.store_id=target_store
    and not e.is_deleted
    and e.source_key=('cloud-entry:'||e.id::text)
    and exists (
      select 1
      from public.transactions c
      where c.store_id=e.store_id
        and c.id<>e.id
        and not c.is_deleted
        and c.source_key like 'entry:%'
        and c.customer_id is not distinct from e.customer_id
        and c.kind=e.kind
        and c.original_currency=e.original_currency
        and c.original_amount=e.original_amount
        and c.usd_amount=e.usd_amount
        and c.description is not distinct from e.description
        and c.recorded_by_name is not distinct from e.recorded_by_name
        and c.created_at=e.created_at
    );

  if coalesce(cardinality(ids),0) <> 8 then
    raise exception 'v1.5.32 echo cleanup aborted: expected 8 exact rows, found %',coalesce(cardinality(ids),0);
  end if;

  insert into debt_service.audit(action,detail)
  values(
    'ledger_echo_cleanup_v188_backup',
    jsonb_build_object(
      'store_id',target_store,
      'row_count',cardinality(ids),
      'transaction_ids',to_jsonb(ids),
      'rows',backup
    )
  );

  -- Run the soft-delete through the store owner's normal authorization path.
  -- The transaction trigger still enforces membership and delete_purchase permission.
  perform set_config('request.jwt.claim.sub','58f44577-e97a-417a-b1c3-744b5282c23e',true);

  update public.transactions
     set is_deleted=true,
         deleted_at=now(),
         updated_at=now()
   where id=any(ids)
     and store_id=target_store
     and not is_deleted;
end $$;
