package com.uchiha.radius;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.LinearLayout;

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
 * - router credentials are captured by a native prompt and referenced by an
 *   opaque, short-lived in-memory session id rather than returned to JavaScript;
 * - mutating router operations will be added only behind the staged backup/rollback flow.
 */
public final class NativeBridge {
    private static final String WHATSAPP_NUMBER = "963942586044";
    private final Activity activity;
    private final WebView webView;
    private final RouterDiscovery routerDiscovery;

    public NativeBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
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
            out.put("nativeDraftValidation", true);
            out.put("nativeCredentialVault", true);
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    @JavascriptInterface
    public String getInstallationId() {
        return DeviceIdentity.getOrCreate(activity);
    }

    @JavascriptInterface
    public String validateActivationCode(String code) {
        return ProviderSetupValidator.validateActivationCode(code);
    }

    @JavascriptInterface
    public String validateRouterSetup(String json) {
        return ProviderSetupValidator.validateRouterDraft(json);
    }

    @JavascriptInterface
    public String validatePlan(String json) {
        return ProviderSetupValidator.validatePlanDraft(json);
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

    /**
     * Opens a native credential prompt. The web UI receives only a credential
     * session id through the `uchiha-router-credentials` event, never the secret.
     */
    @JavascriptInterface
    public void requestRouterCredentials(String host) {
        final String normalized;
        try {
            normalized = normalizeHost(host);
            if (!isPrivateIpv4(normalized)) {
                dispatchCredentialEvent(false, normalized, "", "LOCAL_PRIVATE_IP_REQUIRED", false);
                return;
            }
        } catch (Exception e) {
            dispatchCredentialEvent(false, "", "", "LOCAL_PRIVATE_IP_REQUIRED", false);
            return;
        }

        activity.runOnUiThread(() -> {
            final EditText username = new EditText(activity);
            username.setHint("اسم مستخدم MikroTik");
            username.setSingleLine(true);
            username.setSaveEnabled(false);
            username.setPrivateImeOptions("noPersonalizedLearning");
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                username.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            }

            final EditText password = new EditText(activity);
            password.setHint("كلمة مرور MikroTik");
            password.setSingleLine(true);
            password.setSaveEnabled(false);
            password.setPrivateImeOptions("noPersonalizedLearning");
            password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            }

            LinearLayout form = new LinearLayout(activity);
            form.setOrientation(LinearLayout.VERTICAL);
            int pad = Math.round(20 * activity.getResources().getDisplayMetrics().density);
            form.setPadding(pad, Math.round(8 * activity.getResources().getDisplayMetrics().density), pad, 0);
            form.addView(username);
            form.addView(password);

            AlertDialog dialog = new AlertDialog.Builder(activity)
                    .setTitle("ربط MikroTik")
                    .setMessage("البيانات تستخدم لهذه الجلسة فقط ولا تُحفظ على الهاتف أو داخل الواجهة.")
                    .setView(form)
                    .setNegativeButton("إلغاء", (d, which) -> {
                        clearEditText(username);
                        clearEditText(password);
                        dispatchCredentialEvent(false, normalized, "", "", true);
                    })
                    .setPositiveButton("متابعة", null)
                    .create();

            dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                CharSequence user = username.getText();
                CharSequence pass = password.getText();
                if (user == null || user.length() == 0 || pass == null || pass.length() == 0) {
                    password.setError("أدخل بيانات الدخول");
                    return;
                }
                String sessionId = RouterCredentialVault.create(normalized, user, pass);
                clearEditText(username);
                clearEditText(password);
                dialog.dismiss();
                dispatchCredentialEvent(true, normalized, sessionId, "", false);
            }));
            dialog.setCanceledOnTouchOutside(false);
            dialog.setOnCancelListener(d -> {
                clearEditText(username);
                clearEditText(password);
                dispatchCredentialEvent(false, normalized, "", "", true);
            });
            dialog.show();
        });
    }

    @JavascriptInterface
    public boolean hasRouterCredentialSession(String sessionId) {
        return RouterCredentialVault.isValid(sessionId);
    }

    @JavascriptInterface
    public void clearRouterCredentialSession(String sessionId) {
        RouterCredentialVault.clear(sessionId);
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

    void clearSensitiveState() {
        RouterCredentialVault.clearAll();
    }

    private void dispatchCredentialEvent(boolean ok, String host, String sessionId, String error, boolean cancelled) {
        JSONObject detail = new JSONObject();
        try {
            detail.put("ok", ok);
            detail.put("host", host == null ? "" : host);
            detail.put("sessionId", sessionId == null ? "" : sessionId);
            detail.put("expiresInSeconds", ok ? RouterCredentialVault.TTL_MS / 1000L : 0);
            detail.put("cancelled", cancelled);
            if (error != null && !error.isEmpty()) detail.put("error", error);
        } catch (Exception ignored) {
        }
        String script = "window.dispatchEvent(new CustomEvent('uchiha-router-credentials',{detail:" + detail.toString() + "}));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private static void clearEditText(EditText editText) {
        try {
            if (editText != null && editText.getText() != null) editText.getText().clear();
        } catch (Exception ignored) {
        }
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
