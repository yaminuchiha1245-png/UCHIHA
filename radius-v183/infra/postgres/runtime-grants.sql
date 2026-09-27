\set ON_ERROR_STOP on

GRANT USAGE ON SCHEMA public, app TO uchiha_runtime, uchiha_platform, uchiha_backup;
GRANT EXECUTE ON FUNCTION app.has_tenant_access(TEXT) TO uchiha_runtime, uchiha_platform, uchiha_backup;

GRANT SELECT, INSERT, UPDATE ON users, auth_sessions TO uchiha_runtime;
GRANT DELETE ON auth_sessions TO uchiha_runtime;
GRANT SELECT ON tenants, subscription_products TO uchiha_runtime;
GRANT SELECT, INSERT, UPDATE ON memberships, tenant_subscriptions TO uchiha_runtime;
GRANT SELECT, UPDATE ON activation_codes TO uchiha_runtime;
GRANT SELECT, INSERT, UPDATE ON app_installations TO uchiha_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON plans, subscribers, network_devices, radius_sessions, invoices, payments, alerts, integrations,
  network_sites, ip_pools, radius_policies, subscriber_access_profiles, resellers, voucher_batches, vouchers, support_tickets,
  support_ticket_events, radius_accounting_events, radius_auth_events, radius_nodes TO uchiha_runtime;
GRANT SELECT, INSERT ON audit_logs, webhook_events TO uchiha_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_records, connector_nonces, outbox TO uchiha_runtime;

GRANT SELECT, INSERT, UPDATE ON users, tenants, memberships, tenant_subscriptions TO uchiha_platform;
GRANT SELECT, DELETE ON auth_sessions TO uchiha_platform;
GRANT SELECT ON subscription_products TO uchiha_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON activation_codes, app_installations TO uchiha_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON plans, subscribers, network_devices, radius_sessions, invoices, payments, alerts, integrations,
  network_sites, ip_pools, radius_policies, subscriber_access_profiles, resellers, voucher_batches, vouchers, support_tickets,
  support_ticket_events, radius_accounting_events, radius_auth_events, radius_nodes TO uchiha_platform;
GRANT SELECT, INSERT ON audit_logs TO uchiha_platform;
GRANT SELECT, INSERT, DELETE ON webhook_events TO uchiha_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_records, connector_nonces, outbox TO uchiha_platform;

REVOKE ALL ON schema_migrations FROM uchiha_runtime, uchiha_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO uchiha_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE uchiha_migrator IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uchiha_migrator IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uchiha_migrator IN SCHEMA public GRANT SELECT ON TABLES TO uchiha_backup;
