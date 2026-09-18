\set ON_ERROR_STOP on
\getenv runtime_password RUNTIME_DATABASE_PASSWORD
\getenv platform_password PLATFORM_DATABASE_PASSWORD
\getenv migrator_password MIGRATOR_DATABASE_PASSWORD
\getenv backup_password BACKUP_DATABASE_PASSWORD

DO $$ BEGIN
  CREATE ROLE uchiha_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE uchiha_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE uchiha_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE uchiha_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER ROLE uchiha_runtime PASSWORD :'runtime_password';
ALTER ROLE uchiha_platform PASSWORD :'platform_password';
ALTER ROLE uchiha_migrator PASSWORD :'migrator_password';
ALTER ROLE uchiha_backup PASSWORD :'backup_password';

SELECT current_database() AS target_database \gset
GRANT CONNECT ON DATABASE :"target_database" TO uchiha_runtime, uchiha_platform, uchiha_migrator, uchiha_backup;
GRANT CREATE ON DATABASE :"target_database" TO uchiha_migrator;
GRANT USAGE ON SCHEMA public TO uchiha_runtime, uchiha_platform;
GRANT USAGE, CREATE ON SCHEMA public TO uchiha_migrator;
