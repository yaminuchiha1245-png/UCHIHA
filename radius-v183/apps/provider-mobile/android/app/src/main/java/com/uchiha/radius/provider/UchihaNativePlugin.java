package com.uchiha.radius.provider;

import android.content.Context;
import android.content.SharedPreferences;
import android.app.AlertDialog;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "UchihaNative")
public class UchihaNativePlugin extends Plugin {
    private static final String PREFERENCES = "uchiha_native_identity";
    private static final String INSTALLATION_ID = "installation_id";
    private final RouterCredentialVault credentials = new RouterCredentialVault();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void getInstallationId(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String value = preferences.getString(INSTALLATION_ID, null);
        if (value == null) {
            value = UUID.randomUUID().toString();
            preferences.edit().putString(INSTALLATION_ID, value).apply();
        }
        JSObject result = new JSObject();
        result.put("installationId", value);
        call.resolve(result);
    }

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        try {
            call.resolve(networkInfo());
        } catch (Exception error) {
            call.reject("تعذر قراءة شبكة Wi-Fi الحالية", "NETWORK_INFO_FAILED", error);
        }
    }

    @PluginMethod
    public void discoverRouters(PluginCall call) {
        executor.submit(() -> {
            try {
                JSObject network = networkInfo();
                Set<String> candidates = candidateAddresses(network);
                JSArray routers = new JSArray();
                for (String address : candidates) {
                    JSObject candidate = probe(address);
                    if (candidate != null) routers.put(candidate);
                }
                JSObject result = new JSObject();
                result.put("routers", routers);
                result.put("gateway", network.optString("gateway", ""));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("تعذر اكتشاف MikroTik على الشبكة الحالية", "DISCOVERY_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void holdRouterCredentials(PluginCall call) {
        String host = validIpv4(call.getString("host"));
        String username = trimmed(call.getString("username"));
        String password = call.getString("password");
        boolean tls = Boolean.TRUE.equals(call.getBoolean("tls", false));
        if (host == null || username == null || password == null || password.isEmpty()) {
            call.reject("بيانات MikroTik غير مكتملة", "INVALID_ROUTER_CREDENTIALS");
            return;
        }
        String handle = credentials.put(host, username, password, tls);
        JSObject result = new JSObject();
        result.put("credentialHandle", handle);
        call.resolve(result);
    }

    @PluginMethod
    public void requestRouterCredentials(PluginCall call) {
        String host = validIpv4(call.getString("host"));
        boolean tls = Boolean.TRUE.equals(call.getBoolean("tls", false));
        if (host == null) {
            call.reject("عنوان MikroTik غير صالح", "INVALID_ROUTER_HOST");
            return;
        }
        getActivity().runOnUiThread(() -> {
            int padding = Math.round(22 * getContext().getResources().getDisplayMetrics().density);
            LinearLayout fields = new LinearLayout(getActivity());
            fields.setOrientation(LinearLayout.VERTICAL);
            fields.setPadding(padding, padding / 2, padding, 0);
            EditText username = new EditText(getActivity());
            username.setHint("اسم مستخدم MikroTik");
            username.setSingleLine(true);
            username.setInputType(InputType.TYPE_CLASS_TEXT);
            EditText password = new EditText(getActivity());
            password.setHint("كلمة المرور");
            password.setSingleLine(true);
            password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            fields.addView(username);
            fields.addView(password);
            AlertDialog dialog = new AlertDialog.Builder(getActivity())
                .setTitle("تسجيل الدخول إلى " + host)
                .setMessage("تُحفظ البيانات مؤقتًا في ذاكرة التطبيق وتُمسح بعد التحقق.")
                .setView(fields)
                .setNegativeButton("إلغاء", (current, which) -> {
                    password.getText().clear();
                    call.reject("تم إلغاء تسجيل الدخول", "ROUTER_LOGIN_CANCELLED");
                })
                .setPositiveButton("تحقق", null)
                .create();
            dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                String login = trimmed(username.getText().toString());
                String secret = password.getText().toString();
                if (login == null || secret.isEmpty()) {
                    password.setError("أدخل اسم المستخدم وكلمة المرور");
                    return;
                }
                String handle = credentials.put(host, login, secret, tls);
                password.getText().clear();
                JSObject result = new JSObject();
                result.put("credentialHandle", handle);
                result.put("username", login);
                result.put("host", host);
                result.put("tls", tls);
                dialog.dismiss();
                call.resolve(result);
            }));
            dialog.setOnCancelListener(ignored -> {
                password.getText().clear();
                call.reject("تم إلغاء تسجيل الدخول", "ROUTER_LOGIN_CANCELLED");
            });
            dialog.show();
        });
    }

    @PluginMethod
    public void verifyRouter(PluginCall call) {
        String handle = call.getString("credentialHandle");
        RouterCredentialVault.Credentials entry = credentials.get(handle);
        if (entry == null) {
            call.reject("انتهت جلسة بيانات الدخول، أعد إدخالها", "CREDENTIAL_SESSION_EXPIRED");
            return;
        }
        executor.submit(() -> {
            try (RouterOsApiClient client = new RouterOsApiClient(entry.host, entry.tls)) {
                client.login(entry.username, entry.password);
                Map<String, String> identity = client.firstRecord("/system/identity/print");
                Map<String, String> resource = client.firstRecord("/system/resource/print");
                JSObject result = new JSObject();
                result.put("host", entry.host);
                result.put("identity", identity.getOrDefault("name", "MikroTik"));
                result.put("model", resource.getOrDefault("board-name", "RouterOS"));
                result.put("version", resource.getOrDefault("version", ""));
                result.put("architecture", resource.getOrDefault("architecture-name", ""));
                result.put("tls", entry.tls);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("تعذر التحقق من MikroTik: " + safeMessage(error), "ROUTER_VERIFY_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void clearRouterCredentials(PluginCall call) {
        String handle = call.getString("credentialHandle");
        if (handle == null) credentials.clear(); else credentials.remove(handle);
        call.resolve();
    }

    private JSObject networkInfo() {
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        Network active = manager.getActiveNetwork();
        if (active == null) throw new IllegalStateException("No active network");
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(active);
        LinkProperties properties = manager.getLinkProperties(active);
        if (properties == null) throw new IllegalStateException("No link properties");
        String gateway = "", address = "";
        int prefix = 0;
        for (RouteInfo route : properties.getRoutes()) {
            InetAddress candidate = route.getGateway();
            if (route.isDefaultRoute() && candidate instanceof Inet4Address) { gateway = candidate.getHostAddress(); break; }
        }
        for (LinkAddress link : properties.getLinkAddresses()) {
            if (link.getAddress() instanceof Inet4Address) { address = link.getAddress().getHostAddress(); prefix = link.getPrefixLength(); break; }
        }
        JSObject result = new JSObject();
        result.put("wifi", capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI));
        result.put("gateway", gateway);
        result.put("address", address);
        result.put("prefixLength", prefix);
        return result;
    }

    private Set<String> candidateAddresses(JSObject network) {
        Set<String> result = new LinkedHashSet<>();
        String gateway = validIpv4(network.optString("gateway", ""));
        String address = validIpv4(network.optString("address", ""));
        if (gateway != null) result.add(gateway);
        if (address != null) {
            int lastDot = address.lastIndexOf('.');
            if (lastDot > 0) {
                result.add(address.substring(0, lastDot + 1) + "1");
                result.add(address.substring(0, lastDot + 1) + "254");
            }
        }
        return result;
    }

    private JSObject probe(String address) {
        int[] ports = {8729, 8728, 443, 80};
        JSArray open = new JSArray();
        for (int port : ports) if (isOpen(address, port)) open.put(port);
        if (open.length() == 0) return null;
        JSObject result = new JSObject();
        result.put("host", address);
        result.put("ports", open);
        result.put("api", contains(open, 8728));
        result.put("apiSsl", contains(open, 8729));
        return result;
    }

    private boolean isOpen(String address, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(address, port), 450);
            return true;
        } catch (Exception ignored) { return false; }
    }

    private boolean contains(JSArray array, int value) {
        for (int index = 0; index < array.length(); index++) if (array.optInt(index) == value) return true;
        return false;
    }

    private String validIpv4(String value) {
        String text = trimmed(value);
        if (text == null || !text.matches("^(?:\\d{1,3}\\.){3}\\d{1,3}$")) return null;
        String[] parts = text.split("\\.");
        for (String part : parts) if (Integer.parseInt(part) > 255) return null;
        if (text.startsWith("0.") || text.startsWith("127.") || text.startsWith("224.") || text.equals("255.255.255.255")) return null;
        return text;
    }

    private String trimmed(String value) {
        if (value == null) return null;
        String result = value.trim();
        return result.isEmpty() ? null : result;
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? "لم يستجب الراوتر" : message.replaceAll("[\\r\\n]", " ");
    }

    @Override
    protected void handleOnDestroy() {
        credentials.clear();
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
