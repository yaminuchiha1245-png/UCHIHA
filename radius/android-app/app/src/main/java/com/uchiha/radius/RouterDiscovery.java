package com.uchiha.radius;

import android.app.Activity;
import android.content.Context;
import android.net.DhcpInfo;
import android.net.wifi.WifiManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Conservative local-network router discovery for provider onboarding.
 *
 * It never authenticates and never changes router state. Discovery only checks a
 * small set of likely private IPv4 router addresses and common RouterOS/web ports.
 */
public final class RouterDiscovery {
    private static final int CONNECT_TIMEOUT_MS = 260;
    private static final int[] PORTS = new int[]{8729, 8728, 443, 80};

    private final Activity activity;

    public RouterDiscovery(Activity activity) {
        this.activity = activity;
    }

    public String getLocalNetworkJson() {
        JSONObject out = new JSONObject();
        try {
            DhcpInfo info = getDhcpInfo();
            if (info == null) {
                out.put("ok", false);
                out.put("error", "WIFI_DHCP_UNAVAILABLE");
                return out.toString();
            }
            String ip = intToIpv4(info.ipAddress);
            String gateway = intToIpv4(info.gateway);
            out.put("ok", !ip.isEmpty() || !gateway.isEmpty());
            out.put("ip", ip);
            out.put("gateway", gateway);
            out.put("prefix", prefix24(ip));
            out.put("dns1", intToIpv4(info.dns1));
            out.put("dns2", intToIpv4(info.dns2));
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("error", "NETWORK_READ_FAILED");
            } catch (Exception ignored) {
            }
        }
        return out.toString();
    }

    public String discoverLikelyRouters() {
        JSONObject out = new JSONObject();
        JSONArray routers = new JSONArray();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            DhcpInfo info = getDhcpInfo();
            if (info == null) {
                out.put("ok", false);
                out.put("error", "WIFI_DHCP_UNAVAILABLE");
                out.put("routers", routers);
                return out.toString();
            }

            String localIp = intToIpv4(info.ipAddress);
            String gateway = intToIpv4(info.gateway);
            Set<String> candidates = buildCandidates(localIp, gateway);
            List<Future<JSONObject>> futures = new ArrayList<>();

            for (String host : candidates) {
                futures.add(pool.submit(new ProbeTask(host, gateway)));
            }

            for (Future<JSONObject> future : futures) {
                try {
                    JSONObject candidate = future.get(1400, TimeUnit.MILLISECONDS);
                    if (candidate.optBoolean("reachable", false)) routers.put(candidate);
                } catch (Exception ignored) {
                }
            }

            out.put("ok", true);
            out.put("networkIp", localIp);
            out.put("gateway", gateway);
            out.put("scanned", candidates.size());
            out.put("routers", routers);
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("error", "DISCOVERY_FAILED");
                out.put("routers", routers);
            } catch (Exception ignored) {
            }
        } finally {
            pool.shutdownNow();
        }
        return out.toString();
    }

    private Set<String> buildCandidates(String localIp, String gateway) {
        LinkedHashSet<String> hosts = new LinkedHashSet<>();
        if (isPrivateIpv4(gateway)) hosts.add(gateway);

        String prefix = prefix24(localIp);
        if (!prefix.isEmpty()) {
            hosts.add(prefix + ".1");
            hosts.add(prefix + ".254");
            hosts.add(prefix + ".2");
            hosts.add(prefix + ".10");
        }

        // MikroTik factory-default address is useful when the phone is connected
        // directly to a newly-reset router, but it is still limited to RFC1918.
        hosts.add("192.168.88.1");
        hosts.remove(localIp);
        hosts.remove("");
        return hosts;
    }

    private DhcpInfo getDhcpInfo() {
        WifiManager wifi = (WifiManager) activity.getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        return wifi == null ? null : wifi.getDhcpInfo();
    }

    private static final class ProbeTask implements Callable<JSONObject> {
        private final String host;
        private final String gateway;

        ProbeTask(String host, String gateway) {
            this.host = host;
            this.gateway = gateway;
        }

        @Override
        public JSONObject call() throws Exception {
            JSONObject result = new JSONObject();
            boolean tlsApi = canConnect(host, 8729);
            boolean api = canConnect(host, 8728);
            boolean https = canConnect(host, 443);
            boolean http = canConnect(host, 80);
            boolean reachable = tlsApi || api || https || http;

            int confidence = 0;
            if (host.equals(gateway)) confidence += 40;
            if (tlsApi) confidence += 35;
            if (api) confidence += 30;
            if (https) confidence += 12;
            if (http) confidence += 8;

            result.put("host", host);
            result.put("reachable", reachable);
            result.put("gateway", host.equals(gateway));
            result.put("routerOsApiTls", tlsApi);
            result.put("routerOsApi", api);
            result.put("https", https);
            result.put("http", http);
            result.put("confidence", Math.min(100, confidence));
            return result;
        }
    }

    private static boolean canConnect(String host, int port) {
        if (!isPrivateIpv4(host)) return false;
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String prefix24(String ip) {
        if (!isPrivateIpv4(ip)) return "";
        int dot = ip.lastIndexOf('.');
        return dot > 0 ? ip.substring(0, dot) : "";
    }

    private static String intToIpv4(int value) {
        if (value == 0) return "";
        return (value & 0xff) + "." +
                ((value >> 8) & 0xff) + "." +
                ((value >> 16) & 0xff) + "." +
                ((value >> 24) & 0xff);
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
            if (a == 10) return true;
            if (a == 192 && b == 168) return true;
            return a == 172 && b >= 16 && b <= 31;
        } catch (NumberFormatException e) {
            return false;
        }
    }
}
