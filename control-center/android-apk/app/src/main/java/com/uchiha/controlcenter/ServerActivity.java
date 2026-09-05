package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class ServerActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int BORDER = Color.rgb(39, 54, 75);

    private AuthSession session;
    private String projectId;
    private String projectName;
    private LinearLayout content;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        session = new SessionStore(this).load();
        projectId = getIntent().getStringExtra("project_id");
        projectName = getIntent().getStringExtra("project_name");
        if (session == null || !session.can("server.manage") || projectId == null || projectId.isEmpty()) {
            finish();
            return;
        }
        renderShell();
        loadState();
    }

    private void renderShell() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setLayoutDirection(LinearLayout.LAYOUT_DIRECTION_RTL);
        page.setPadding(dp(16), dp(16), dp(16), dp(26));
        scroll.addView(page, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        page.addView(text("💻 Server", 25, TEXT, true));
        TextView subtitle = text(projectName == null ? "ربط VPS" : projectName, 13, MUTED, false);
        LinearLayout.LayoutParams subLp = matchWrap();
        subLp.setMargins(0, dp(3), 0, dp(14));
        page.addView(subtitle, subLp);

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        page.addView(content, matchWrap());
        setContentView(scroll);
    }

    private void loadState() {
        content.removeAllViews();
        content.addView(spacedText("🔄 جاري فحص اتصالات السيرفر…", 13, MUTED, false));
        new Thread(() -> {
            try {
                JSONObject projectStatus = ApiClient.projectServerStatus(session.token, projectId);
                JSONArray servers = ApiClient.listServers(session.token);
                runOnUiThread(() -> renderState(projectStatus.optJSONObject("binding"), servers));
            } catch (Exception error) {
                runOnUiThread(() -> handleError(error, "تعذر تحميل اتصالات السيرفر."));
            }
        }, "uchiha-server-state").start();
    }

    private void renderState(JSONObject binding, JSONArray servers) {
        content.removeAllViews();

        LinearLayout current = card();
        current.addView(text("🔗 سيرفر المشروع", 17, TEXT, true));
        JSONObject boundServer = binding == null ? null : binding.optJSONObject("server");
        if (boundServer == null) {
            current.addView(spacedText("لا يوجد VPS مربوط بهذا المشروع بعد.", 13, MUTED, false));
        } else {
            current.addView(spacedText("✅ " + boundServer.optString("label", "Server"), 15, GREEN, true));
            current.addView(spacedText(boundServer.optString("username", "") + "@"
                    + boundServer.optString("host", "") + ":" + boundServer.optInt("port", 22), 13, TEXT, false));
            String fingerprint = boundServer.optString("fingerprint", "");
            if (!fingerprint.isEmpty()) current.addView(spacedText("Fingerprint: " + shortFingerprint(fingerprint), 11, MUTED, false));

            Button test = primary("إعادة اختبار الاتصال", BLUE);
            test.setOnClickListener(v -> retest(boundServer.optString("id", ""), test));
            LinearLayout.LayoutParams testLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
            testLp.setMargins(0, dp(12), 0, 0);
            current.addView(test, testLp);
        }
        content.addView(current);

        renderExistingServers(servers, boundServer);
        renderNewServerForm();
    }

    private void renderExistingServers(JSONArray servers, JSONObject boundServer) {
        if (servers == null || servers.length() == 0) return;

        List<String> labels = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        String currentId = boundServer == null ? "" : boundServer.optString("id", "");
        int selectedIndex = 0;
        for (int i = 0; i < servers.length(); i++) {
            JSONObject server = servers.optJSONObject(i);
            if (server == null) continue;
            String id = server.optString("id", "");
            if (id.isEmpty()) continue;
            if (id.equals(currentId)) selectedIndex = ids.size();
            ids.add(id);
            labels.add(server.optString("label", "Server") + " — " + server.optString("host", ""));
        }
        if (ids.isEmpty()) return;

        LinearLayout card = card();
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(0, dp(10), 0, 0);
        card.setLayoutParams(cardLp);
        card.addView(text("السيرفرات المحفوظة", 17, TEXT, true));

        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, labels);
        spinner.setAdapter(adapter);
        spinner.setSelection(Math.min(selectedIndex, ids.size() - 1));
        LinearLayout.LayoutParams spinnerLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(54));
        spinnerLp.setMargins(0, dp(8), 0, dp(10));
        card.addView(spinner, spinnerLp);

        Button bind = primary("ربط هذا السيرفر بالمشروع", BLUE);
        bind.setOnClickListener(v -> {
            int position = spinner.getSelectedItemPosition();
            if (position < 0 || position >= ids.size()) return;
            bindExisting(ids.get(position), bind);
        });
        card.addView(bind, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        content.addView(card);
    }

    private void renderNewServerForm() {
        LinearLayout form = card();
        LinearLayout.LayoutParams formLp = matchWrap();
        formLp.setMargins(0, dp(10), 0, 0);
        form.setLayoutParams(formLp);
        form.addView(text("＋ إضافة VPS جديد", 17, TEXT, true));
        form.addView(spacedText("يتم اختبار SSH أولًا، وبعد النجاح فقط تحفظ كلمة المرور مشفّرة على السيرفر.", 12, MUTED, false));

        EditText label = field("اسم السيرفر — اختياري");
        EditText host = field("IP أو Host");
        EditText port = field("Port");
        port.setInputType(InputType.TYPE_CLASS_NUMBER);
        port.setText("22");
        EditText username = field("Username");
        EditText password = field("Password");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);

        addField(form, label);
        addField(form, host);
        addField(form, port);
        addField(form, username);
        addField(form, password);

        Button connect = primary("اتصال وربط بالمشروع", BLUE);
        connect.setOnClickListener(v -> {
            String hostValue = host.getText().toString().trim();
            String userValue = username.getText().toString().trim();
            String passValue = password.getText().toString();
            int portValue;
            try { portValue = Integer.parseInt(port.getText().toString().trim()); }
            catch (Exception ignored) { portValue = -1; }
            String labelValue = label.getText().toString().trim();
            if (labelValue.isEmpty()) labelValue = hostValue;

            if (hostValue.isEmpty() || userValue.isEmpty() || passValue.isEmpty() || portValue < 1 || portValue > 65535) {
                Toast.makeText(this, "أكمل معلومات السيرفر بشكل صحيح.", Toast.LENGTH_SHORT).show();
                return;
            }

            connect.setEnabled(false);
            connect.setText("جاري اختبار SSH…");
            final String finalLabel = labelValue;
            final int finalPort = portValue;
            new Thread(() -> {
                try {
                    ApiClient.createServer(session.token, projectId, finalLabel, hostValue,
                            finalPort, userValue, passValue);
                    runOnUiThread(() -> {
                        password.setText("");
                        Toast.makeText(this, "تم ربط VPS بنجاح ✅", Toast.LENGTH_SHORT).show();
                        loadState();
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        password.setText("");
                        connect.setEnabled(true);
                        connect.setText("اتصال وربط بالمشروع");
                        handleError(error, "تعذر الاتصال بالسيرفر.");
                    });
                }
            }, "uchiha-server-connect").start();
        });
        form.addView(connect, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        content.addView(form);
    }

    private void bindExisting(String serverId, Button button) {
        button.setEnabled(false);
        new Thread(() -> {
            try {
                ApiClient.bindProjectServer(session.token, projectId, serverId);
                runOnUiThread(() -> {
                    Toast.makeText(this, "تم ربط السيرفر بالمشروع ✅", Toast.LENGTH_SHORT).show();
                    loadState();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    button.setEnabled(true);
                    handleError(error, "تعذر ربط السيرفر بالمشروع.");
                });
            }
        }, "uchiha-server-bind").start();
    }

    private void retest(String serverId, Button button) {
        if (serverId.isEmpty()) return;
        button.setEnabled(false);
        button.setText("جاري الاختبار…");
        new Thread(() -> {
            try {
                ApiClient.testServer(session.token, serverId);
                runOnUiThread(() -> {
                    Toast.makeText(this, "اتصال SSH سليم ✅", Toast.LENGTH_SHORT).show();
                    loadState();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    button.setEnabled(true);
                    button.setText("إعادة اختبار الاتصال");
                    handleError(error, "فشل اختبار SSH.");
                });
            }
        }, "uchiha-server-test").start();
    }

    private void handleError(Exception error, String fallback) {
        if (error instanceof ApiClient.ApiException) {
            ApiClient.ApiException api = (ApiClient.ApiException) error;
            if (api.status == 401) {
                new SessionStore(this).clear();
                startActivity(new Intent(this, LoginActivity.class));
                finish();
                return;
            }
            if ("ssh_auth_failed".equals(api.code)) fallback = "اسم المستخدم أو كلمة مرور SSH غير صحيحة.";
            if ("ssh_host_key_changed".equals(api.code)) fallback = "⚠️ بصمة السيرفر تغيّرت. تم إيقاف الاتصال للحماية.";
            if ("server_private_address".equals(api.code)) fallback = "لا يمكن ربط عنوان داخلي أو محلي.";
            if ("server_dns_failed".equals(api.code)) fallback = "تعذر العثور على عنوان السيرفر.";
            if ("vault_not_configured".equals(api.code)) fallback = "Vault غير مهيأ على السيرفر بعد.";
            if ("ssh_connection_failed".equals(api.code)) fallback = "تعذر فتح اتصال SSH بالسيرفر.";
        }
        Toast.makeText(this, fallback, Toast.LENGTH_SHORT).show();
    }

    private String shortFingerprint(String value) {
        if (value.length() <= 20) return value;
        return value.substring(0, 10) + "…" + value.substring(value.length() - 8);
    }

    private void addField(LinearLayout parent, EditText field) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        lp.setMargins(0, dp(9), 0, 0);
        parent.addView(field, lp);
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(15), dp(14), dp(15), dp(14));
        card.setBackground(rounded(SURFACE, 18, BORDER, 1));
        return card;
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setTextSize(14);
        input.setSingleLine(true);
        input.setPadding(dp(13), 0, dp(13), 0);
        input.setBackground(rounded(BG, 13, BORDER, 1));
        return input;
    }

    private Button primary(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(color, 14, color, 0));
        return button;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(sp);
        if (bold) view.setTypeface(null, Typeface.BOLD);
        view.setLineSpacing(0f, 1.15f);
        return view;
    }

    private TextView spacedText(String value, int sp, int color, boolean bold) {
        TextView view = text(value, sp, color, bold);
        LinearLayout.LayoutParams lp = matchWrap();
        lp.setMargins(0, dp(7), 0, 0);
        view.setLayoutParams(lp);
        return view;
    }

    private GradientDrawable rounded(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(strokeDp), strokeColor);
        return drawable;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
