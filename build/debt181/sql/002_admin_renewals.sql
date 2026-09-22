-- UCHIHA Debt Store Telegram admin v1.2: audited, idempotent subscription
-- renewals and customer device-limit adjustments. Existing finance data intact.
CREATE TABLE IF NOT EXISTS debt_service.telegram_admin_requests (
  request_id text PRIMARY KEY CHECK (request_id ~ '^[A-Za-z0-9:_-]{12,100}$'),
  actor_telegram_id bigint NOT NULL,
  action text NOT NULL,
  license_id uuid NOT NULL REFERENCES debt_service.licenses(id),
  request_args jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE debt_service.telegram_admin_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON debt_service.telegram_admin_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON debt_service.telegram_admin_requests TO service_role;

CREATE OR REPLACE FUNCTION public.debt_telegram_admin_license_action(
    p_secret text, p_telegram_id bigint, p_action text,
    p_args jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  cfg debt_service.telegram_admin_config%rowtype;
  owner_id uuid;
  target debt_service.licenses%rowtype;
  previous debt_service.telegram_admin_requests%rowtype;
  target_id uuid;
  requested_id text;
  args_fingerprint jsonb;
  days_to_add integer;
  device_max integer;
  device_count integer;
  next_expiry timestamptz;
  result_json jsonb;
BEGIN
  IF p_secret IS NULL OR p_secret !~ '^[a-f0-9]{64}$'
     OR p_telegram_id IS NULL OR p_telegram_id<=0
     OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok',false,'error','FORBIDDEN');
  END IF;
  SELECT * INTO cfg FROM debt_service.telegram_admin_config WHERE singleton;
  IF NOT FOUND OR cfg.telegram_id<>p_telegram_id
    OR cfg.key_hash<>encode(extensions.digest(p_secret,'sha256'),'hex') THEN
    RETURN jsonb_build_object('ok',false,'error','FORBIDDEN');
  END IF;
  SELECT id INTO owner_id FROM debt_service.licenses
    WHERE kind='owner' AND active
      AND (expires_at IS NULL OR expires_at>now())
    ORDER BY created_at,id LIMIT 1;
  IF owner_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','OWNER_INACTIVE');
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('renew_license','unlimited_license','set_max_devices') THEN
    RETURN jsonb_build_object('ok',false,'error','UNKNOWN_ACTION');
  END IF;
  requested_id:=p_args->>'request_id';
  IF requested_id IS NULL OR requested_id !~ '^[A-Za-z0-9:_-]{12,100}$' THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_REQUEST');
  END IF;
  BEGIN
    target_id:=(p_args->>'license_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_ID');
  END;
  IF target_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_ID');
  END IF;

  args_fingerprint:=p_args-'request_id';
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'debt:telegram:license:'||requested_id,0));

  SELECT * INTO previous FROM debt_service.telegram_admin_requests
    WHERE request_id=requested_id;
  IF FOUND THEN
    IF previous.actor_telegram_id<>p_telegram_id OR previous.action<>p_action
       OR previous.license_id<>target_id
       OR previous.request_args<>args_fingerprint THEN
      RETURN jsonb_build_object('ok',false,'error','REPLAY_CONFLICT');
    END IF;
    RETURN previous.result||jsonb_build_object('replayed',true);
  END IF;

  SELECT * INTO target FROM debt_service.licenses
    WHERE id=target_id AND kind='customer' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','NOT_FOUND');
  END IF;

  IF p_action='renew_license' THEN
    BEGIN
      days_to_add:=(p_args->>'days')::integer;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_DAYS');
    END;
    IF days_to_add IS NULL OR days_to_add NOT IN (30,90,365) THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_DAYS');
    END IF;
    IF target.expires_at IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','ALREADY_UNLIMITED');
    END IF;
    next_expiry:=greatest(target.expires_at,now())
      +make_interval(days=>days_to_add);
    UPDATE debt_service.licenses SET expires_at=next_expiry WHERE id=target_id;
    INSERT INTO debt_service.audit(actor_license_id,target_license_id,action,detail)
      VALUES(owner_id,target_id,'bot_license_renewed',
        jsonb_build_object('days',days_to_add,'previous_expiry',target.expires_at,
          'new_expiry',next_expiry,'request_id',requested_id));
    result_json:=jsonb_build_object('ok',true,'expires_at',next_expiry,
      'days_added',days_to_add,'replayed',false);
  ELSIF p_action='unlimited_license' THEN
    IF target.expires_at IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','ALREADY_UNLIMITED');
    END IF;
    UPDATE debt_service.licenses SET expires_at=NULL WHERE id=target_id;
    INSERT INTO debt_service.audit(actor_license_id,target_license_id,action,detail)
      VALUES(owner_id,target_id,'bot_license_unlimited',
        jsonb_build_object('previous_expiry',target.expires_at,'request_id',requested_id));
    result_json:=jsonb_build_object('ok',true,'expires_at',NULL,'replayed',false);
  ELSE
    BEGIN
      device_max:=(p_args->>'max_devices')::integer;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_DEVICES');
    END;
    IF device_max IS NULL OR device_max<1 OR device_max>5 THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_DEVICES');
    END IF;
    SELECT count(*) INTO device_count FROM debt_service.devices
      WHERE license_id=target_id AND released_at IS NULL;
    IF device_max<device_count THEN
      RETURN jsonb_build_object('ok',false,'error','TOO_MANY_ACTIVE_DEVICES',
        'active_devices',device_count);
    END IF;
    IF target.max_devices<>device_max THEN
      UPDATE debt_service.licenses SET max_devices=device_max WHERE id=target_id;
      INSERT INTO debt_service.audit(actor_license_id,target_license_id,action,detail)
        VALUES(owner_id,target_id,'bot_device_limit_updated',
          jsonb_build_object('previous_max_devices',target.max_devices,
            'new_max_devices',device_max,'request_id',requested_id));
    END IF;
    result_json:=jsonb_build_object('ok',true,'max_devices',device_max,
      'unchanged',target.max_devices=device_max,'replayed',false);
  END IF;

  INSERT INTO debt_service.telegram_admin_requests(
    request_id,actor_telegram_id,action,license_id,request_args,result
  ) VALUES (requested_id,p_telegram_id,p_action,target_id,args_fingerprint,result_json);
  RETURN result_json;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok',false,'error','INVALID_REQUEST');
END;
$$;
REVOKE ALL ON FUNCTION public.debt_telegram_admin_license_action(
  text,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.debt_telegram_admin_license_action(
  text,bigint,text,jsonb) TO anon,authenticated,service_role;
