-- Run ONLY on an isolated disposable PostgreSQL database after migrations/grants.
-- A single rolled-back transaction verifies access-profile RLS and composite tenant FK.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO tenants (id,name,slug,currency,time_zone,status,created_at,updated_at)
VALUES ('ten_core_rls_a','Isolation A','core-rls-a','USD','UTC','active',NOW(),NOW()),
       ('ten_core_rls_b','Isolation B','core-rls-b','TRY','UTC','active',NOW(),NOW());
INSERT INTO subscribers (id,tenant_id,username,full_name,status,created_at,updated_at)
VALUES ('cus_core_rls_a','ten_core_rls_a','rls-a','Isolation A','active',NOW(),NOW()),
       ('cus_core_rls_b','ten_core_rls_b','rls-b','Isolation B','active',NOW(),NOW());
INSERT INTO subscriber_access_profiles
 (tenant_id,subscriber_id,speed_down_mbps,speed_up_mbps,daily_quota_bytes,daily_quota_unit,
  price_currency,prices_json,created_at,updated_at)
VALUES ('ten_core_rls_a','cus_core_rls_a',40,8,1000000000,'GB','USD',
        '{"USD":"10.00","TRY":"500.00"}'::jsonb,NOW(),NOW()),
       ('ten_core_rls_b','cus_core_rls_b',30,6,500000000,'MB','TRY',
        '{"TRY":"450.00"}'::jsonb,NOW(),NOW());
SET LOCAL ROLE uchiha_runtime;
SELECT set_config('app.tenant_id','ten_core_rls_a',true);
DO $test$ DECLARE visible_rows INTEGER; BEGIN
  SELECT COUNT(*) INTO visible_rows FROM subscriber_access_profiles;
  IF visible_rows <> 1 THEN RAISE EXCEPTION 'RLS leaked or hid tenant A profile'; END IF;
  IF EXISTS (SELECT 1 FROM subscriber_access_profiles WHERE subscriber_id='cus_core_rls_b')
    THEN RAISE EXCEPTION 'RLS allowed cross-tenant profile read'; END IF;
END $test$;
DO $test$ BEGIN
  BEGIN
    INSERT INTO subscriber_access_profiles
      (tenant_id,subscriber_id,speed_down_mbps,speed_up_mbps,price_currency,prices_json,created_at,updated_at)
    VALUES ('ten_core_rls_b','cus_core_rls_b',99,99,'TRY','{"TRY":"1.00"}',NOW(),NOW());
    RAISE EXCEPTION 'cross-tenant write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO subscriber_access_profiles
      (tenant_id,subscriber_id,speed_down_mbps,speed_up_mbps,price_currency,prices_json,created_at,updated_at)
    VALUES ('ten_core_rls_a','cus_core_rls_b',99,99,'USD','{"USD":"1.00"}',NOW(),NOW());
    RAISE EXCEPTION 'cross-tenant subscriber reference unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $test$;
SELECT set_config('app.tenant_id','ten_core_rls_b',true);
DO $test$ DECLARE visible_rows INTEGER; BEGIN
  SELECT COUNT(*) INTO visible_rows FROM subscriber_access_profiles;
  IF visible_rows <> 1 THEN RAISE EXCEPTION 'RLS leaked or hid tenant B profile'; END IF;
  IF EXISTS (SELECT 1 FROM subscriber_access_profiles WHERE subscriber_id='cus_core_rls_a')
    THEN RAISE EXCEPTION 'RLS leaked tenant A profile to tenant B'; END IF;
END $test$;
SET LOCAL ROLE uchiha_platform;
DO $test$ DECLARE visible_rows INTEGER; BEGIN
  SELECT COUNT(*) INTO visible_rows FROM subscriber_access_profiles;
  IF visible_rows <> 2 THEN RAISE EXCEPTION 'platform role missing expected policy access'; END IF;
END $test$;
SET LOCAL ROLE uchiha_backup;
DO $test$ BEGIN
  IF has_table_privilege(current_user,'subscriber_access_profiles','INSERT')
    THEN RAISE EXCEPTION 'backup role unexpectedly has insert privilege'; END IF;
END $test$;
ROLLBACK;
\echo 'PASS: tenant RLS, cross-tenant composite FK, platform visibility, backup read-only'
