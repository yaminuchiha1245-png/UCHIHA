-- New registrations default to API-SSL. Preserve historical port values for audit.
ALTER TABLE network_devices ALTER COLUMN api_port SET DEFAULT 8729;
