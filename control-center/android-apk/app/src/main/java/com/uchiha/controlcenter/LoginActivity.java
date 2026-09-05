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

import org.json.JSONObject;

public final class LoginActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(15, 23, 35);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int BORDER = Color.rgb(42, 56, 76);

    private SessionStore sessionStore;
    private EditText usernameField;
    private EditText passwordField;
    private Button loginButton;

    private EditText setupCodeField;
    private EditText displayNameField;
    private EditText setupUsernameField;
    private EditText setupPasswordField;
    private EditText confirmPasswordField;
    private Button setupButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        sessionStore = new SessionStore(this);

        AuthSession cached = sessionStore.load();
        if (cached != null) {
            renderLogin(cached, null);
        } else {
            renderChecking();
            checkSetup();
        }
    }

    private void checkSetup() {
        new Thread(() -> {
            try {
                JSONObject status = ApiClient.setupStatus();
                boolean needsOwner = status.optBoolean("needsOwner", false);
                boolean setupReady = status.optBoolean("setupReady", false);
                runOnUiThread(() -> {
                    if (needsOwner) renderSetup(setupReady);
                    else renderLogin(null, null);
                });
            } catch (Exception error) {
                runOnUiThread(() -> renderLogin(null,
                        "تعذر التحقق من حالة الإعداد. يمكنك المحاولة بالدخول أو إعادة الفحص."));
            }
        }, "uchiha-setup-status").start();
    }

    private void renderChecking() {
        LinearLayout page = basePage();
        TextView brand = brand(page);
        TextView status = text("🔄 التحقق من مساحة UCHIHA…", 14, MUTED, false);
        status.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = matchWrap();
        lp.setMargins(0, dp(36), 0, 0);
        page.addView(status, lp);
        setContentView(wrap(page));
    }

    private void renderSetup(boolean setupReady) {
        LinearLayout page = basePage();
        brand(page);

        LinearLayout card = card();
        page.addView(card, matchWrap());

        TextView title = text("👑 إنشاء مساحة UCHIHA", 21, TEXT, true);
        card.addView(title);
        TextView hint = text(
                "هذه الخطوة تظهر مرة واحدة فقط. أنشئ حساب المالك، وبعدها تضيف بقية الفريق من داخل التطبيق.",
                13, MUTED, false);
        LinearLayout.LayoutParams hintLp = matchWrap();
        hintLp.setMargins(0, dp(5), 0, dp(18));
        card.addView(hint, hintLp);

        if (!setupReady) {
            TextView warning = text(
                    "⚠️ إعداد المالك غير مفعّل على السيرفر بعد. يجب تفعيل رمز الإعداد الآمن مرة واحدة ثم إعادة الفحص.",
                    13, ORANGE, true);
            warning.setPadding(dp(12), dp(12), dp(12), dp(12));
            warning.setBackground(rounded(Color.rgb(38, 31, 19), 14, Color.rgb(92, 68, 29), 1));
            LinearLayout.LayoutParams warningLp = matchWrap();
            warningLp.setMargins(0, 0, 0, dp(14));
            card.addView(warning, warningLp);

            Button retry = secondaryButton("🔄 إعادة الفحص");
            retry.setOnClickListener(v -> {
                renderChecking();
                checkSetup();
            });
            card.addView(retry, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
            setContentView(wrap(page));
            return;
        }

        setupCodeField = field("رمز الإعداد لمرة واحدة");
        setupCodeField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        card.addView(setupCodeField);

        displayNameField = field("اسمك الظاهر");
        displayNameField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        card.addView(displayNameField);

        setupUsernameField = field("اسم المستخدم");
        setupUsernameField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        card.addView(setupUsernameField);

        setupPasswordField = field("كلمة المرور");
        setupPasswordField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        card.addView(setupPasswordField);

        confirmPasswordField = field("تأكيد كلمة المرور");
        confirmPasswordField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        card.addView(confirmPasswordField);

        setupButton = button("إنشاء حساب المالك", GREEN);
        setupButton.setOnClickListener(v -> createOwner());
        LinearLayout.LayoutParams setupLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        setupLp.setMargins(0, dp(4), 0, 0);
        card.addView(setupButton, setupLp);

        TextView security = text(
                "🔐 رمز الإعداد وكلمة المرور لا يُحفظان على الهاتف. بعد نجاح التأسيس يُغلق مسار إنشاء المالك تلقائيًا.",
                12, MUTED, false);
        LinearLayout.LayoutParams securityLp = matchWrap();
        securityLp.setMargins(0, dp(15), 0, 0);
        card.addView(security, securityLp);

        setContentView(wrap(page));
    }

    private void createOwner() {
        final String setupCode = setupCodeField.getText().toString().trim();
        final String displayName = displayNameField.getText().toString().trim();
        final String username = setupUsernameField.getText().toString().trim();
        final String password = setupPasswordField.getText().toString();
        final String confirm = confirmPasswordField.getText().toString();

        if (setupCode.length() < 8) {
            Toast.makeText(this, "تحقق من رمز الإعداد.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (displayName.isEmpty() || username.length() < 3) {
            Toast.makeText(this, "أدخل الاسم واسم المستخدم.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (password.length() < 10) {
            Toast.makeText(this, "كلمة المرور يجب أن تكون 10 أحرف على الأقل.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!password.equals(confirm)) {
            Toast.makeText(this, "كلمتا المرور غير متطابقتين.", Toast.LENGTH_SHORT).show();
            return;
        }

        setupButton.setEnabled(false);
        setupButton.setText("جاري إنشاء المساحة…");

        new Thread(() -> {
            try {
                AuthSession session = ApiClient.createInitialOwner(setupCode, username, displayName, password);
                sessionStore.save(session);
                runOnUiThread(() -> {
                    clearSetupSecrets();
                    Toast.makeText(this, "✅ تم إنشاء مساحة UCHIHA", Toast.LENGTH_SHORT).show();
                    openWorkspace();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    clearSetupSecrets();
                    setupButton.setEnabled(true);
                    setupButton.setText("إنشاء حساب المالك");
                    if (error instanceof ApiClient.ApiException) {
                        ApiClient.ApiException api = (ApiClient.ApiException) error;
                        if (api.status == 401 && "invalid_setup_code".equals(api.code)) {
                            Toast.makeText(this, "رمز الإعداد غير صحيح.", Toast.LENGTH_SHORT).show();
                            return;
                        }
                        if (api.status == 409 && "setup_complete".equals(api.code)) {
                            Toast.makeText(this, "تم إعداد UCHIHA مسبقًا. سجّل الدخول.", Toast.LENGTH_SHORT).show();
                            renderLogin(null, null);
                            return;
                        }
                        if (api.status == 503 && "setup_not_configured".equals(api.code)) {
                            renderSetup(false);
                            return;
                        }
                    }
                    Toast.makeText(this, "تعذر إنشاء حساب المالك الآن.", Toast.LENGTH_SHORT).show();
                });
            }
        }, "uchiha-owner-setup").start();
    }

    private void clearSetupSecrets() {
        if (setupCodeField != null) setupCodeField.setText("");
        if (setupPasswordField != null) setupPasswordField.setText("");
        if (confirmPasswordField != null) confirmPasswordField.setText("");
    }

    private void renderLogin(AuthSession cached, String notice) {
        LinearLayout page = basePage();
        brand(page);

        LinearLayout card = card();
        page.addView(card, matchWrap());

        TextView title = text("🔐 دخول الفريق", 21, TEXT, true);
        card.addView(title);
        TextView hint = text("كل عضو يدخل بحسابه الخاص. كلمة المرور لا تُحفظ على الهاتف.", 13, MUTED, false);
        LinearLayout.LayoutParams hintLp = matchWrap();
        hintLp.setMargins(0, dp(5), 0, dp(18));
        card.addView(hint, hintLp);

        if (notice != null && !notice.isEmpty()) {
            TextView noticeView = text(notice, 12, ORANGE, false);
            LinearLayout.LayoutParams noticeLp = matchWrap();
            noticeLp.setMargins(0, 0, 0, dp(12));
            card.addView(noticeView, noticeLp);
        }

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

        if (cached != null) {
            TextView localLabel = text("لديك جلسة محفوظة لهذا الجهاز", 12, MUTED, false);
            LinearLayout.LayoutParams localLabelLp = matchWrap();
            localLabelLp.setMargins(0, dp(18), 0, dp(8));
            card.addView(localLabel, localLabelLp);

            Button offline = secondaryButton("📱 فتح محليًا باسم " + cached.displayName);
            offline.setOnClickListener(v -> openWorkspace());
            card.addView(offline, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        } else {
            Button setupCheck = secondaryButton("👑 فحص إعداد المالك");
            setupCheck.setOnClickListener(v -> {
                renderChecking();
                checkSetup();
            });
            LinearLayout.LayoutParams setupCheckLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
            setupCheckLp.setMargins(0, dp(12), 0, 0);
            card.addView(setupCheck, setupCheckLp);
        }

        TextView note = text(
                "بدون إنترنت يمكنك فتح الواجهة والبيانات المخزنة محليًا فقط. النشر والسيرفر والدومين تبقى متوقفة حتى يعود الاتصال.",
                12, MUTED, false);
        LinearLayout.LayoutParams noteLp = matchWrap();
        noteLp.setMargins(0, dp(20), 0, 0);
        page.addView(note, noteLp);

        setContentView(wrap(page));
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
                passwordField.setText("");
                runOnUiThread(this::openWorkspace);
            } catch (Exception error) {
                runOnUiThread(() -> {
                    passwordField.setText("");
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

    private LinearLayout basePage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER_HORIZONTAL);
        page.setPadding(dp(22), dp(44), dp(22), dp(28));
        page.setLayoutDirection(LinearLayout.LAYOUT_DIRECTION_RTL);
        return page;
    }

    private ScrollView wrap(LinearLayout page) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private TextView brand(LinearLayout page) {
        TextView brand = text("UCHIHA", 31, TEXT, true);
        brand.setGravity(Gravity.CENTER);
        page.addView(brand, matchWrap());

        TextView subtitle = text("Control Center", 14, MUTED, false);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleLp = matchWrap();
        subtitleLp.setMargins(0, dp(2), 0, dp(28));
        page.addView(subtitle, subtitleLp);
        return brand;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(20), dp(18), dp(18));
        card.setBackground(rounded(SURFACE, 22, BORDER, 1));
        return card;
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
