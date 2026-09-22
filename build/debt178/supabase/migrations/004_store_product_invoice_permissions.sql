-- v1.5.28: protect store settings/catalog and honor purchase permissions for invoices.

drop policy if exists stores_update_members on public.stores;
create policy stores_update_members
on public.stores for update to authenticated
using (app_private.is_store_owner(id))
with check (app_private.is_store_owner(id));

drop policy if exists products_insert_members on public.products;
create policy products_insert_members
on public.products for insert to authenticated
with check (app_private.is_store_owner(store_id));

drop policy if exists products_update_members on public.products;
create policy products_update_members
on public.products for update to authenticated
using (app_private.is_store_owner(store_id))
with check (app_private.is_store_owner(store_id));

drop policy if exists products_select_members on public.products;
create policy products_select_members
on public.products for select to authenticated
using (app_private.is_store_member(store_id));

drop policy if exists invoices_insert_members on public.invoices;
create policy invoices_insert_members
on public.invoices for insert to authenticated
with check (app_private.member_can(store_id,'record_purchase'));

drop policy if exists invoices_update_members on public.invoices;
create policy invoices_update_members
on public.invoices for update to authenticated
using (app_private.member_can(store_id,'edit_purchase'))
with check (app_private.member_can(store_id,'edit_purchase'));

drop policy if exists invoices_select_members on public.invoices;
create policy invoices_select_members
on public.invoices for select to authenticated
using (app_private.is_store_member(store_id));

drop policy if exists invoice_items_insert_members on public.invoice_items;
create policy invoice_items_insert_members
on public.invoice_items for insert to authenticated
with check (app_private.member_can(store_id,'record_purchase'));

drop policy if exists invoice_items_update_members on public.invoice_items;
create policy invoice_items_update_members
on public.invoice_items for update to authenticated
using (app_private.member_can(store_id,'edit_purchase'))
with check (app_private.member_can(store_id,'edit_purchase'));

drop policy if exists invoice_items_select_members on public.invoice_items;
create policy invoice_items_select_members
on public.invoice_items for select to authenticated
using (app_private.is_store_member(store_id));
