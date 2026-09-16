package com.uchiha.radius;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Validates provider onboarding drafts before any backend/router mutation exists.
 *
 * Important: responses are sanitized. Passwords, PPPoE credentials and RADIUS
 * secrets are never echoed back or persisted by this class.
 */
public final class ProviderSetupValidator {
    // The backend owns the final activation-code policy. Native validation only
    // rejects obviously malformed input so it does not lock the product into an
    // invented prefix/length before the exact v37 contract is mapped.
    private static final Pattern ACTIVATION = Pattern.compile("^[A-Z0-9][A-Z0-9-]{6,62}[A-Z0-9]$");
    private static final Set<String> UPSTREAM_TYPES = setOf("dhcp", "pppoe", "static");
    private static final Set<String> SERVICE_MODES = setOf("pppoe", "hotspot", "both");
    private static final Set<String> QUOTA_PERIODS = setOf("none", "daily", "monthly");
    private static final Set<String> POST_QUOTA = setOf("block", "throttle", "addon");

    private ProviderSetupValidator() {
    }

    public static String validateActivationCode(String raw) {
        JSONObject out = new JSONObject();
        try {
            String normalized = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
            boolean valid = ACTIVATION.matcher(normalized).matches();
            out.put("ok", valid);
            out.put("normalized", valid ? normalized : "");
            if (!valid) out.put("error", "ACTIVATION_CODE_FORMAT_INVALID");
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    public static String validateRouterDraft(String rawJson) {
        JSONObject out = new JSONObject();
        JSONArray errors = new JSONArray();
        try {
            JSONObject in = parseObject(rawJson, errors);
            String name = text(in, "name", 80);
            String host = text(in, "host", 64);
            String upstreamType = lower(text(in.optJSONObject("upstream"), "type", 16));
            String wan = text(in, "wanInterface", 32);
            String serviceMode = lower(text(in, "serviceMode", 16));
            JSONArray lanInput = in.optJSONArray("lanInterfaces");
            JSONArray lan = new JSONArray();

            if (name.isEmpty()) errors.put("ROUTER_NAME_REQUIRED");
            if (!isPrivateIpv4(host)) errors.put("PRIVATE_ROUTER_IP_REQUIRED");
            if (!UPSTREAM_TYPES.contains(upstreamType)) errors.put("UPSTREAM_TYPE_INVALID");
            if (wan.isEmpty()) errors.put("WAN_INTERFACE_REQUIRED");
            if (!SERVICE_MODES.contains(serviceMode)) errors.put("SERVICE_MODE_INVALID");

            if (lanInput == null || lanInput.length() == 0) {
                errors.put("LAN_INTERFACE_REQUIRED");
            } else {
                Set<String> seen = new HashSet<>();
                for (int i = 0; i < lanInput.length() && i < 16; i++) {
                    String item = safeToken(lanInput.optString(i, ""), 32);
                    if (!item.isEmpty() && seen.add(item)) lan.put(item);
                }
                if (lan.length() == 0) errors.put("LAN_INTERFACE_REQUIRED");
                for (int i = 0; i < lan.length(); i++) {
                    if (wan.equalsIgnoreCase(lan.optString(i))) errors.put("WAN_LAN_INTERFACE_CONFLICT");
                }
            }

            JSONObject upstream = new JSONObject();
            upstream.put("type", upstreamType);
            if ("static".equals(upstreamType)) {
                String address = text(in.optJSONObject("upstream"), "address", 64);
                String gateway = text(in.optJSONObject("upstream"), "gateway", 64);
                if (address.isEmpty()) errors.put("STATIC_ADDRESS_REQUIRED");
                if (gateway.isEmpty()) errors.put("STATIC_GATEWAY_REQUIRED");
                upstream.put("address", address);
                upstream.put("gateway", gateway);
            } else if ("pppoe".equals(upstreamType)) {
                JSONObject u = in.optJSONObject("upstream");
                if (text(u, "username", 128).isEmpty()) errors.put("UPSTREAM_PPPOE_USERNAME_REQUIRED");
                if (text(u, "password", 256).isEmpty()) errors.put("UPSTREAM_PPPOE_PASSWORD_REQUIRED");
                // Credentials intentionally not returned.
                upstream.put("credentialsProvided", !text(u, "username", 128).isEmpty() && !text(u, "password", 256).isEmpty());
            }

            JSONObject normalized = new JSONObject();
            normalized.put("name", name);
            normalized.put("host", host);
            normalized.put("wanInterface", safeToken(wan, 32));
            normalized.put("lanInterfaces", lan);
            normalized.put("serviceMode", serviceMode);
            normalized.put("upstream", upstream);
            normalized.put("backupBeforeApply", true);
            normalized.put("stagedApplyRequired", true);
            normalized.put("rollbackRequired", true);

            out.put("ok", errors.length() == 0);
            out.put("errors", errors);
            out.put("normalized", normalized);
        } catch (Exception e) {
            try {
                errors.put("ROUTER_DRAFT_INVALID");
                out.put("ok", false);
                out.put("errors", errors);
            } catch (Exception ignored) {
            }
        }
        return out.toString();
    }

    public static String validatePlanDraft(String rawJson) {
        JSONObject out = new JSONObject();
        JSONArray errors = new JSONArray();
        try {
            JSONObject in = parseObject(rawJson, errors);
            String name = text(in, "name", 80);
            double download = number(in, "downloadMbps");
            double upload = number(in, "uploadMbps");
            double quota = number(in, "quotaGb");
            String quotaPeriod = lower(text(in, "quotaPeriod", 16));
            int durationDays = integer(in, "durationDays");
            double priceTry = number(in, "priceTry");
            String postQuota = lower(text(in, "postQuotaAction", 16));
            double throttleDown = number(in, "throttleDownloadMbps");
            double throttleUp = number(in, "throttleUploadMbps");

            if (name.isEmpty()) errors.put("PLAN_NAME_REQUIRED");
            if (download <= 0 || download > 10000) errors.put("DOWNLOAD_MBPS_INVALID");
            if (upload <= 0 || upload > 10000) errors.put("UPLOAD_MBPS_INVALID");
            if (quota < 0 || quota > 1000000) errors.put("QUOTA_GB_INVALID");
            if (!QUOTA_PERIODS.contains(quotaPeriod)) errors.put("QUOTA_PERIOD_INVALID");
            if (quota > 0 && "none".equals(quotaPeriod)) errors.put("QUOTA_PERIOD_REQUIRED");
            if (durationDays < 1 || durationDays > 3650) errors.put("DURATION_DAYS_INVALID");
            if (priceTry < 0 || priceTry > 1000000000) errors.put("PRICE_TRY_INVALID");
            if (!POST_QUOTA.contains(postQuota)) errors.put("POST_QUOTA_ACTION_INVALID");
            if ("throttle".equals(postQuota)) {
                if (throttleDown <= 0 || throttleDown >= download) errors.put("THROTTLE_DOWNLOAD_INVALID");
                if (throttleUp <= 0 || throttleUp >= upload) errors.put("THROTTLE_UPLOAD_INVALID");
            }

            JSONObject normalized = new JSONObject();
            normalized.put("name", name);
            normalized.put("downloadMbps", download);
            normalized.put("uploadMbps", upload);
            normalized.put("quotaGb", quota);
            normalized.put("quotaPeriod", quotaPeriod);
            normalized.put("durationDays", durationDays);
            normalized.put("priceTry", priceTry);
            normalized.put("currency", "TRY");
            normalized.put("postQuotaAction", postQuota);
            if ("throttle".equals(postQuota)) {
                normalized.put("throttleDownloadMbps", throttleDown);
                normalized.put("throttleUploadMbps", throttleUp);
            }
            normalized.put("resetTimezone", text(in, "resetTimezone", 64).isEmpty() ? "provider" : text(in, "resetTimezone", 64));

            out.put("ok", errors.length() == 0);
            out.put("errors", errors);
            out.put("normalized", normalized);
        } catch (Exception e) {
            try {
                errors.put("PLAN_DRAFT_INVALID");
                out.put("ok", false);
                out.put("errors", errors);
            } catch (Exception ignored) {
            }
        }
        return out.toString();
    }

    private static JSONObject parseObject(String raw, JSONArray errors) {
        try {
            if (raw == null || raw.trim().isEmpty()) throw new IllegalArgumentException();
            return new JSONObject(raw);
        } catch (Exception e) {
            errors.put("JSON_INVALID");
            return new JSONObject();
        }
    }

    private static String text(JSONObject o, String key, int max) {
        if (o == null) return "";
        String v = o.optString(key, "").trim();
        if (v.length() > max) v = v.substring(0, max);
        return v;
    }

    private static String safeToken(String value, int max) {
        String v = value == null ? "" : value.trim().replaceAll("[^A-Za-z0-9_.:/-]", "");
        return v.length() > max ? v.substring(0, max) : v;
    }

    private static String lower(String v) {
        return v == null ? "" : v.toLowerCase(Locale.ROOT);
    }

    private static double number(JSONObject o, String key) {
        if (o == null) return 0;
        Object v = o.opt(key);
        if (v instanceof Number) return ((Number) v).doubleValue();
        try { return Double.parseDouble(String.valueOf(v)); } catch (Exception ignored) { return 0; }
    }

    private static int integer(JSONObject o, String key) {
        return (int) Math.round(number(o, key));
    }

    private static Set<String> setOf(String... items) {
        Set<String> set = new HashSet<>();
        for (String item : items) set.add(item);
        return set;
    }

    private static boolean isPrivateIpv4(String ip) {
        if (ip == null || ip.isEmpty() || ip.contains(":")) return false;
        String[] p = ip.split("\\.");
        if (p.length != 4) return false;
        try {
            int a = Integer.parseInt(p[0]);
            int b = Integer.parseInt(p[1]);
            int c = Integer.parseInt(p[2]);
            int d = Integer.parseInt(p[3]);
            if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 1 || d > 254) return false;
            return a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
        } catch (Exception e) {
            return false;
        }
    }
}
