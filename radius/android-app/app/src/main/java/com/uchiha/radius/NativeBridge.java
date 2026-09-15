package com.uchiha.radius;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Locale;

/**
 * Narrow native bridge for the existing v101 web UI.
 *
 * Security rules:
 * - no MikroTik/RADIUS secrets are persisted here;
 * - router probing is limited to RFC1918 private IPv4 addresses;
 * - mutating router operations will be added only behind the staged backup/rollback flow.
 */
public final class NativeBridge {
    private static final String WHATSAPP_NUMBER = "963942586044";
    private final Activity activity;
    private final RouterDiscovery routerDiscovery;

    public NativeBridge(Activity activity) {
        this.activity = activity;
        this.routerDiscovery = new RouterDiscovery(activity);
    }

    @JavascriptInterface
    public String getEnvironment() {
        JSONObject out = new JSONObject();
        try {
            out.put("platform", "android");
            out.put("appVersion", BuildConfig.VERSION_NAME);
            out.put("installationId", DeviceIdentity.getOrCreate(activity));
            out.put("online", isOnline());
            out.put("gateway", getGatewayAddressInternal());
            out.put("providerMode", true);
            out.put("nativeRouterDiscovery", true);
            out.put("nativeRouterMutation", false);
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    @JavascriptInterface
    public String getInstallationId() {
        return DeviceIdentity.getOrCreate(activity);
    }

    @JavascriptInterface
    public String getGatewayAddress() {
        return getGatewayAddressInternal();
    }

    @JavascriptInterface
    public String getLocalNetwork() {
        return routerDiscovery.getLocalNetworkJson();
    }

    @JavascriptInterface
    public String discoverLocalRouters() {
        return routerDiscovery.discoverLikelyRouters();
    }

    @JavascriptInterface
    public String probeLocalRouter(String host) {
        JSONObject out = new JSONObject();
        try {
            String normalized = normalizeHost(host);
            if (!isPrivateIpv4(normalized)) {
                out.put("ok", false);
                out.put("error", "LOCAL_PRIVATE_IP_REQUIRED");
                return out.toString();
            }

            boolean api = canConnect(normalized, 8728, 650);
            boolean apiTls = canConnect(normalized, 8729, 650);
            boolean web = canConnect(normalized, 80, 450);
            boolean webTls = canConnect(normalized, 443, 450);

            out.put("ok", api || apiTls || web || webTls);
            out.put("host", normalized);
            out.put("routerOsApi", api);
            out.put("routerOsApiTls", apiTls);
            out.put("http", web);
            out.put("https", webTls);
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("error", "PROBE_FAILED");
            } catch (Exception ignored) {
            }
        }
        return out.toString();
    }

    @JavascriptInterface
    public void openWifiSettings() {
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void requestActivationOnWhatsApp() {
        String text = "مرحبا، أريد طلب كود تفعيل UCHIHA RADIUS";
        Uri uri = Uri.parse("https://wa.me/" + WHATSAPP_NUMBER + "?text=" + Uri.encode(text));
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
            } catch (Exception ignored) {
            }
        });
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private String getGatewayAddressInternal() {
        try {
            WifiManager wifi = (WifiManager) activity.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return "";
            DhcpInfo info = wifi.getDhcpInfo();
            if (info == null || info.gateway == 0) return "";
            int g = info.gateway;
            return String.format(Locale.US, "%d.%d.%d.%d", g & 0xff, (g >> 8) & 0xff, (g >> 16) & 0xff, (g >> 24) & 0xff);
        } catch (Exception ignored) {
            return "";
        }
    }

    private static boolean canConnect(String host, int port, int timeoutMs) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String normalizeHost(String host) throws Exception {
        if (host == null) return "";
        String value = host.trim();
        if (value.isEmpty()) return "";
        return InetAddress.getByName(value).getHostAddress();
    }

    private static boolean isPrivateIpv4(String ip) {
        if (ip == null || ip.isEmpty() || ip.contains(":")) return false;
        String[] p = ip.split("\\.");
        if (p.length != 4) return false;
        try {
            int a = Integer.parseInt(p[0]);
            int b = Integer.parseInt(p[1]);
            if (a == 10) return true;
            if (a == 192 && b == 168) return true;
            return a == 172 && b >= 16 && b <= 31;
        } catch (NumberFormatException e) {
            return false;
        }
    }
}
