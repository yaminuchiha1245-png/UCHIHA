package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public final class DomainActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int BLUE = Color.rgb(74, 137, 255);

    private AuthSession session;
    private String projectId;
    private String projectName;
    private TextView stateView;
    private TextView detailView;
    private EditText domainInput;
    private Button primaryButton;
    private Button refreshButton;
    private boolean busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        session = new SessionStore(this).load();
        projectId = getIntent().getStringExtra("project_id");
        projectName = getIntent().getStringExtra("project_name");
        if (session == null) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        if (!session.can("domain.manage") || projectId == null || !projectId.matches("[a-zA-Z0-9._-]+")) {
            finish();
            return;
        }
        if (projectName == null || projectName.trim().isEmpty()) projectName = "Project";
        render();
        refreshState();
    }

    private void render() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setPadding(dp(16), dp(12), dp(16), dp(24));
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = secondary("رجوع");
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(76), dp(44)));
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(text("🌐 " + projectName, 20, TEXT, true));
        titles.addView(text("Domain / HTTPS", 11, MUTED, false));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(12), 0, dp(12), 0);
        header.addView(titles, titleLp);
        refreshButton = secondary("تحديث");
        refreshButton.setOnClickListener(v -> refreshState());
        header.addView(refreshButton, new LinearLayout.LayoutParams(dp(80), dp(44)));
        page.addView(header);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setBackground(rounded(SURFACE, 20, BORDER, 1));
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(0, dp(18), 0, 0);
        page.addView(card, cardLp);
        stateView = text("🔄 فحص الدومين…", 17, TEXT, true);
        card.addView(stateView);
        detailView = text("UCHIHA يتحقق من Server وDNS وTLS فقط.", 13, MUTED, false);
        detailView.setPadding(0, dp(10), 0, 0);
        card.addView(detailView);

        TextView label = text("الدومين", 13, MUTED, true);
        LinearLayout.LayoutParams labelLp = matchWrap();
        labelLp.setMargins(0, dp(18), 0, dp(7));
        page.addView(label, labelLp);

        domainInput = new EditText(this);
        domainInput.setHint("app.example.com");
        domainInput.setSingleLine(true);
        domainInput.setTextColor(TEXT);
        domainInput.setHintTextColor(MUTED);
        domainInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        domainInput.setPadding(dp(14), 0, dp(14), 0);
        domainInput.setBackground(rounded(SURFACE, 14, BORDER, 1));
        page.addView(domainInput, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        primaryButton = action("ربط الدومين", BLUE);
        primaryButton.setOnClickListener(v -> configureDomain());
        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        actionLp.setMargins(0, dp(14), 0, 0);
        page.addView(primaryButton, actionLp);

        TextView note = text("لا يتم إعطاء المشروع صلاحية على Nginx أو مزود DNS. إذا لم يكن مزود DNS مربوطًا، UCHIHA يعرض السجل المطلوب ويتحقق منه فقط.", 12, MUTED, false);
        note.setPadding(dp(4), dp(16), dp(4), 0);
        page.addView(note, matchWrap());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(page);
        setContentView(scroll);
    }

    private void refreshState() {
        if (busy) return;
        busy = true;
        setEnabled(false);
        new Thread(() -> {
            try {
                JSONObject response = DomainApiClient.status(session.token, projectId);
                runOnUiThread(() -> {
                    busy = false;
                    renderStatus(response);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    showError(error);
                });
            }
        }, "uchiha-domain-status").start();
    }

    private void renderStatus(JSONObject response) {
        setEnabled(true);
        boolean serverLinked = response != null && response.optBoolean("serverLinked", false);
        JSONObject domain = response == null ? null : response.optJSONObject("domain");
        if (!serverLinked) {
            stateView.setText("⚠️ اربط Server أولًا");
            detailView.setText("Domain يحتاج Server مرتبط بالمشروع حتى يعرف UCHIHA عنوان DNS الصحيح.");
            domainInput.setEnabled(false);
            primaryButton.setEnabled(false);
            return;
        }
        domainInput.setEnabled(true);
        if (domain == null) {
            stateView.setText("جاهز لربط الدومين");
            detailView.setText("اكتب اسم الدومين فقط. UCHIHA سيستخدم السيرفر المرتبط تلقائيًا.");
            primaryButton.setText("ربط الدومين");
            primaryButton.setOnClickListener(v -> configureDomain());
            return;
        }

        String name = domain.optString("domain", "");
        if (!name.isEmpty() && !name.equals(domainInput.getText().toString().trim())) domainInput.setText(name);
        JSONObject record = domain.optJSONObject("expectedRecord");
        String recordLine = "";
        if (record != null) {
            recordLine = record.optString("type", "A") + "  " + record.optString("name", "@") + "  →  " + record.optString("value", "");
        }
        String dns = domain.optString("dnsStatus", "pending");
        String https = domain.optString("httpsStatus", "pending");
        if ("verified".equals(dns) && "verified".equals(https)) {
            stateView.setText("✅ الدومين وHTTPS يعملان");
            String tls = domain.optString("tlsProtocol", "");
            String validTo = domain.optString("certificateValidTo", "");
            detailView.setText(name + "\n" + recordLine
                    + (tls.isEmpty() ? "" : "\n" + tls)
                    + (validTo.isEmpty() ? "" : "\nCertificate: " + validTo));
            primaryButton.setText("تحقق مرة أخرى");
            primaryButton.setBackground(rounded(GREEN, 14, GREEN, 0));
            primaryButton.setOnClickListener(v -> verifyDomain());
            return;
        }
        if ("verified".equals(dns)) {
            stateView.setText("✅ DNS صحيح · ⏳ HTTPS غير جاهز");
            detailView.setText(name + "\n" + recordLine + "\nDNS يصل للسيرفر الصحيح، لكن TLS/HTTPS لم يجتز التحقق بعد.");
        } else {
            stateView.setText("⏳ DNS يحتاج التحديث");
            detailView.setText(name + "\nأضف أو عدّل السجل التالي لدى مزود DNS:\n" + recordLine + "\nثم اضغط تحقق.");
        }
        primaryButton.setText("تحقق من DNS وHTTPS");
        primaryButton.setBackground(rounded(ORANGE, 14, ORANGE, 0));
        primaryButton.setOnClickListener(v -> verifyDomain());
    }

    private void configureDomain() {
        String domain = domainInput.getText().toString().trim();
        if (domain.isEmpty()) {
            Toast.makeText(this, "أدخل الدومين أولًا.", Toast.LENGTH_SHORT).show();
            return;
        }
        runAction("ربط الدومين…", () -> DomainApiClient.configure(session.token, projectId, domain));
    }

    private void verifyDomain() {
        runAction("التحقق من DNS وHTTPS…", () -> DomainApiClient.verify(session.token, projectId));
    }

    private interface JsonAction { JSONObject run() throws Exception; }

    private void runAction(String label, JsonAction action) {
        if (busy) return;
        busy = true;
        stateView.setText("🔄 " + label);
        setEnabled(false);
        new Thread(() -> {
            try {
                JSONObject response = action.run();
                runOnUiThread(() -> {
                    busy = false;
                    JSONObject wrapped = new JSONObject();
                    try {
                        wrapped.put("serverLinked", true);
                        wrapped.put("domain", response.optJSONObject("domain"));
                    } catch (Exception ignored) {}
                    renderStatus(wrapped);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    showError(error);
                });
            }
        }, "uchiha-domain-action").start();
    }

    private void showError(Exception error) {
        setEnabled(true);
        String message = "تعذر إكمال عملية الدومين.";
        if (error instanceof DomainApiClient.DomainException) {
            DomainApiClient.DomainException api = (DomainApiClient.DomainException) error;
            if ("domain_server_not_linked".equals(api.code)) message = "اربط Server بالمشروع أولًا.";
            else if ("domain_invalid".equals(api.code)) message = "اسم الدومين غير صالح. اكتب الاسم فقط بدون https:// أو مسار.";
            else if ("domain_not_configured".equals(api.code)) message = "اربط الدومين أولًا قبل التحقق.";
            else if ("server_private_address".equals(api.code)) message = "عنوان السيرفر ليس عنوانًا عامًا صالحًا للدومين.";
            else if (api.status == 401) message = "انتهت جلسة UCHIHA.";
        }
        stateView.setText("⚠️ لم تكتمل العملية");
        detailView.setText(message);
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void setEnabled(boolean enabled) {
        if (refreshButton != null) refreshButton.setEnabled(enabled);
        if (primaryButton != null) primaryButton.setEnabled(enabled);
        if (domainInput != null) domainInput.setEnabled(enabled);
    }

    private Button secondary(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(12);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(SURFACE, 13, BORDER, 1));
        return button;
    }

    private Button action(String label, int color) {
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
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
