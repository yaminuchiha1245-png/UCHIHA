-- UCHIHA Builder migration 017: keep new store experience records inside one tenant/store.
ALTER TABLE support_threads
  ADD CONSTRAINT support_threads_id_scope_key UNIQUE (id, tenant_id, store_id);

ALTER TABLE store_banners
  ADD CONSTRAINT banners_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE store_currency_settings
  ADD CONSTRAINT currencies_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE support_threads
  ADD CONSTRAINT support_threads_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT support_threads_customer_scope_fk
  FOREIGN KEY (customer_id, tenant_id, store_id)
  REFERENCES store_customers(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE support_messages
  ADD CONSTRAINT support_messages_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT support_messages_thread_scope_fk
  FOREIGN KEY (thread_id, tenant_id, store_id)
  REFERENCES support_threads(id, tenant_id, store_id) ON DELETE CASCADE;
