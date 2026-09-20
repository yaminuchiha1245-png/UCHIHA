-- UCHIHA Builder migration 014: enforce tenant/store ownership across relational links.
-- Application predicates remain required; these constraints make cross-tenant references
-- impossible at the PostgreSQL layer even if a future code path supplies a wrong UUID.

ALTER TABLE stores
  ADD CONSTRAINT stores_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE categories
  ADD CONSTRAINT categories_id_tenant_store_key UNIQUE (id, tenant_id, store_id);
ALTER TABLE products
  ADD CONSTRAINT products_id_tenant_key UNIQUE (id, tenant_id),
  ADD CONSTRAINT products_id_tenant_store_key UNIQUE (id, tenant_id, store_id);
ALTER TABLE orders
  ADD CONSTRAINT orders_id_tenant_key UNIQUE (id, tenant_id),
  ADD CONSTRAINT orders_id_tenant_store_key UNIQUE (id, tenant_id, store_id);
ALTER TABLE provider_orders
  ADD CONSTRAINT provider_orders_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE store_customers
  ADD CONSTRAINT store_customers_id_scope_key UNIQUE (id, tenant_id, store_id);
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_id_scope_key UNIQUE (id, tenant_id, store_id);

ALTER TABLE store_design_tokens
  ADD CONSTRAINT design_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE domains
  ADD CONSTRAINT domains_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE bot_connections
  ADD CONSTRAINT bots_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE categories
  ADD CONSTRAINT categories_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT categories_parent_scope_fk
  FOREIGN KEY (parent_id, tenant_id, store_id)
  REFERENCES categories(id, tenant_id, store_id);
ALTER TABLE products
  ADD CONSTRAINT products_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT products_category_scope_fk
  FOREIGN KEY (category_id, tenant_id, store_id)
  REFERENCES categories(id, tenant_id, store_id);
ALTER TABLE store_imported_services
  ADD CONSTRAINT imported_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT imported_product_scope_fk
  FOREIGN KEY (product_id, tenant_id, store_id)
  REFERENCES products(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE store_programming_services
  ADD CONSTRAINT programming_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT programming_product_scope_fk
  FOREIGN KEY (product_id, tenant_id, store_id)
  REFERENCES products(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE orders
  ADD CONSTRAINT orders_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT orders_customer_scope_fk
  FOREIGN KEY (customer_id, tenant_id, store_id)
  REFERENCES store_customers(id, tenant_id, store_id);
ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_scope_fk
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT order_items_product_scope_fk
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id);
ALTER TABLE provider_orders
  ADD CONSTRAINT provider_orders_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT provider_orders_order_scope_fk
  FOREIGN KEY (order_id, tenant_id, store_id)
  REFERENCES orders(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE provider_order_attempts
  ADD CONSTRAINT provider_attempts_order_scope_fk
  FOREIGN KEY (provider_order_id, tenant_id)
  REFERENCES provider_orders(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE provisioning_jobs
  ADD CONSTRAINT provisioning_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;

ALTER TABLE store_customers
  ADD CONSTRAINT customers_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE customer_wallets
  ADD CONSTRAINT wallets_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT wallets_customer_scope_fk
  FOREIGN KEY (customer_id, tenant_id, store_id)
  REFERENCES store_customers(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE deposit_requests
  ADD CONSTRAINT deposits_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT deposits_customer_scope_fk
  FOREIGN KEY (customer_id, tenant_id, store_id)
  REFERENCES store_customers(id, tenant_id, store_id) ON DELETE CASCADE,
  ADD CONSTRAINT deposits_method_scope_fk
  FOREIGN KEY (payment_method_id, tenant_id, store_id)
  REFERENCES payment_methods(id, tenant_id, store_id);
ALTER TABLE wallet_ledger
  ADD CONSTRAINT ledger_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT ledger_customer_scope_fk
  FOREIGN KEY (customer_id, tenant_id, store_id)
  REFERENCES store_customers(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE customer_idempotency_records
  ADD CONSTRAINT customer_idempotency_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT customer_idempotency_customer_scope_fk
  FOREIGN KEY (customer_id, tenant_id, store_id)
  REFERENCES store_customers(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE customer_notifications
  ADD CONSTRAINT customer_notifications_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT customer_notifications_customer_scope_fk
  FOREIGN KEY (customer_id, tenant_id, store_id)
  REFERENCES store_customers(id, tenant_id, store_id) ON DELETE CASCADE;
ALTER TABLE admin_idempotency_records
  ADD CONSTRAINT admin_idempotency_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE store_admin_notifications
  ADD CONSTRAINT admin_notifications_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE product_input_analyses
  ADD CONSTRAINT product_analysis_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT product_analysis_product_scope_fk
  FOREIGN KEY (product_id, tenant_id, store_id)
  REFERENCES products(id, tenant_id, store_id) ON DELETE CASCADE;
