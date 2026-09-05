package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class LoginActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(15, 23, 35);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int BORDER = Color.rgb(42, 56, 76);

    private SessionStore sessionStore;
    private EditText usernameField;
    private EditText passwordField;
    private Button loginButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        sessionStore = new SessionStore(this);
        render();
    }

    private void render() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER_HORIZONTAL);
        page.setPadding(dp(22), dp(44), dp(22), dp(28));
        page.setLayoutDirection(LinearLayout.LAYOUT_DIRECTION_RTL);
        scroll.addView(page, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView brand = text("UCHIHA", 31, TEXT, true);
        brand.setGravity(Gravity.CENTER);
        page.addView(brand, matchWrap());

        TextView subtitle = text("Control Center", 14, MUTED, false);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleLp = matchWrap();
        subtitleLp.setMargins(0, dp(2), 0, dp(28));
        page.addView(subtitle, subtitleLp);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(20), dp(18), dp(18));
        card.setBackground(rounded(SURFACE, 22, BORDER, 1));
        page.addView(card, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text("🔐 دخول الفريق", 21, TEXT, true);
        card.addView(title);
        TextView hint = text("كل عضو يدخل بحسابه الخاص. كلمة المرور لا تُحفظ على الهاتف.", 13, MUTED, false);
        LinearLayout.LayoutParams hintLp = matchWrap();
        hintLp.setMargins(0, dp(5), 0, dp(18));
        card.addView(hint, hintLp);

        usernameField = field("اسم المستخدم");
        usernameField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        card.addView(usernameField);

        passwordField = field("كلمة المرور");
        passwordField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        card.addView(passwordField);

        loginButton = button("دخول", BLUE);
        loginButton.setOnClickListener(v -> login());
        LinearLayout.LayoutParams loginLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        loginLp.setMargins(0, dp(4), 0, 0);
        card.addView(loginButton, loginLp);

        AuthSession cached = sessionStore.load();
        if (cached != null) {
            TextView localLabel = text("لديك جلسة محفوظة لهذا الجهاز", 12, MUTED, false);
            LinearLayout.LayoutParams localLabelLp = matchWrap();
            localLabelLp.setMargins(0, dp(18), 0, dp(8));
            card.addView(localLabel, localLabelLp);

            Button offline = secondaryButton("📱 فتح محليًا باسم " + cached.displayName);
            offline.setOnClickListener(v -> openWorkspace());
            card.addView(offline, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        }

        TextView note = text("بدون إنترنت يمكنك فتح الواجهة والبيانات المخزنة محليًا فقط. النشر والسيرفر والدومين تبقى متوقفة حتى يعود الاتصال.", 12, MUTED, false);
        LinearLayout.LayoutParams noteLp = matchWrap();
        noteLp.setMargins(0, dp(20), 0, 0);
        page.addView(note, noteLp);

        setContentView(scroll);
    }

    private void login() {
        final String username = usernameField.getText().toString().trim();
        final String password = passwordField.getText().toString();
        if (username.length() < 3 || password.length() < 10) {
            Toast.makeText(this, "تحقق من اسم المستخدم وكلمة المرور.", Toast.LENGTH_SHORT).show();
            return;
        }

        loginButton.setEnabled(false);
        loginButton.setText("جاري الدخول…");

        new Thread(() -> {
            try {
                AuthSession session = ApiClient.login(username, password);
                sessionStore.save(session);
                runOnUiThread(this::openWorkspace);
            } catch (Exception error) {
                runOnUiThread(() -> {
                    loginButton.setEnabled(true);
                    loginButton.setText("دخول");
                    String message = error instanceof ApiClient.ApiException
                            && ((ApiClient.ApiException) error).status == 401
                            ? "بيانات الدخول غير صحيحة."
                            : "تعذر الاتصال بـ UCHIHA الآن.";
                    Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
                });
            }
        }, "uchiha-login").start();
    }

    private void openWorkspace() {
        startActivity(new Intent(this, WorkspaceActivity.class));
        finish();
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setTextSize(15);
        input.setSingleLine(true);
        input.setPadding(dp(15), 0, dp(15), 0);
        input.setBackground(rounded(BG, 14, BORDER, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.setMargins(0, 0, 0, dp(12));
        input.setLayoutParams(lp);
        return input;
    }

    private Button button(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(color, 15, color, 0));
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = button(label, SURFACE);
        button.setBackground(rounded(SURFACE, 15, BORDER, 1));
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
