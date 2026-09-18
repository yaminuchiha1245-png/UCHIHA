CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_revoked_idx ON auth_sessions(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS connector_nonces_expires_idx ON connector_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idempotency_records_expires_idx ON idempotency_records(expires_at);
CREATE INDEX IF NOT EXISTS webhook_events_processed_idx ON webhook_events(processed_at);
CREATE INDEX IF NOT EXISTS outbox_sent_updated_idx ON outbox(updated_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS radius_auth_received_idx ON radius_auth_events(received_at);
CREATE INDEX IF NOT EXISTS radius_accounting_received_idx ON radius_accounting_events(received_at);
