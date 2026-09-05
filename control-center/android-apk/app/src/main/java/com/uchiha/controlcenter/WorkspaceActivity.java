package com.uchiha.controlcenter;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class WorkspaceActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int RED = Color.rgb(236, 91, 91);
    private static final int BORDER = Color.rgb(39, 54, 75);

    private SessionStore sessionStore;
    private AuthSession session;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        sessionStore = new SessionStore(this);
        session = sessionStore.load();
        if (session == null) {
            goLogin();
            return;
        }
        showProjects();
    }

    private void showProjects() {
        LinearLayout page = page();
        page.addView(header("UCHIHA", roleLabel(session.role), false));

        if (!hasNetwork()) {
            TextView offline = text("📴 وضع محلي — التعديل والنشر والاتصالات الخارجية متوقفة", 12, ORANGE, true);
            offline.setPadding(dp(18), dp(10), dp(18), dp(10));
            offline.setBackground(rounded(Color.rgb(38, 31, 19), 14, Color.rgb(92, 68, 29), 1));
            LinearLayout.LayoutParams offLp = matchWrap();
            offLp.setMargins(dp(16), dp(10), dp(16), 0);
            page.addView(offline, offLp);
        }

        TextView title = text("📦 المشاريع", 22, TEXT, true);
        title.setPadding(dp(18), dp(18), dp(18), dp(10));
        page.addView(title);

        // Phase 2 keeps the user's known projects as local workspace entries.
        // The project registry API will replace this local list in the next data-sync phase.
        page.addView(projectCard("🎮", "Game Zone"));
        page.addView(projectCard("🌐", "UCHIHA Radius"));

        if (session.can("team.manage")) {
            Button team = secondary("👥 الفريق");
            team.setOnClickListener(v -> startActivity(new Intent(this, TeamActivity.class)));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
            lp.setMargins(dp(16), dp(14), dp(16), 0);
            page.addView(team, lp);
        }

        Button logout = secondary("تسجيل الخروج");
        logout.setTextColor(RED);
        logout.setOnClickListener(v -> logout());
        LinearLayout.LayoutParams logoutLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        logoutLp.setMargins(dp(16), dp(10), dp(16), dp(20));
        page.addView(logout, logoutLp);

        setContentView(wrap(page));
    }

    private LinearLayout projectCard(String icon, String name) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(15), dp(16), dp(14));
        card.setBackground(rounded(SURFACE, 19, BORDER, 1));
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(dp(16), dp(8), dp(16), 0);
        card.setLayoutParams(cardLp);

        TextView nameView = text(icon + "  " + name, 18, TEXT, true);
        card.addView(nameView);
        TextView state = text("محفوظ في مساحة العمل المحلية", 12, MUTED, false);
        LinearLayout.LayoutParams stateLp = matchWrap();
        stateLp.setMargins(0, dp(4), 0, dp(12));
        card.addView(state, stateLp);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        Button open = primary("فتح", BLUE);
        open.setOnClickListener(v -> showProject(name));
        actions.addView(open, weighted(1f, false));

        Button preview = secondary("👁️ معاينة");
        preview.setOnClickListener(v -> showPreview(name));
        actions.addView(preview, weighted(1f, true));
        card.addView(actions);
        return card;
    }

    private void showProject(String projectName) {
        LinearLayout page = page();
        page.addView(header(projectName, "مساحة المشروع", true));

        TextView title = text("الأدوات", 20, TEXT, true);
        title.setPadding(dp(18), dp(18), dp(18), dp(10));
        page.addView(title);

        addTool(page, "👁️", "Preview", "معاينة نسخة الكود داخل بيئة منفصلة", BLUE, "preview.use", () -> showPreview(projectName));
        addTool(page, "🤖", "AI", "ChatGPT / Claude / Gemini حسب الربط", VIOLET, "ai.use", () -> networkFeature("AI"));
        addTool(page, "🐙", "GitHub", "المستودع والفرع والمزامنة", SURFACE_ALT, "github.use", () -> networkFeature("GitHub"));
        addTool(page, "💻", "Server", "ربط VPS وإدارة الاتصال", BLUE, "server.manage", () -> networkFeature("Server"));
        addTool(page, "🌐", "Domain", "ربط الدومين وHTTPS", GREEN, "domain.manage", () -> networkFeature("Domain"));
        addTool(page, "🚀", "Deploy", "تحضير النشر ثم الاعتماد حسب الصلاحية", ORANGE, "deploy.plan", () -> networkFeature("Deploy"));

        setContentView(wrap(page));
    }

    private void addTool(LinearLayout page, String icon, String name, String detail, int accent,
                         String capability, Runnable action) {
        if (!session.can(capability)) return;
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(12), dp(14), dp(12));
        row.setBackground(rounded(SURFACE, 17, BORDER, 1));
        LinearLayout.LayoutParams rowLp = matchWrap();
        rowLp.setMargins(dp(16), dp(7), dp(16), 0);
        row.setLayoutParams(rowLp);

        TextView iconView = text(icon, 24, accent, false);
        iconView.setGravity(Gravity.CENTER);
        row.addView(iconView, new LinearLayout.LayoutParams(dp(44), dp(44)));

        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        TextView nameView = text(name, 16, TEXT, true);
        TextView detailView = text(detail, 12, MUTED, false);
        labels.addView(nameView);
        labels.addView(detailView);
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, dp(10), 0);
        row.addView(labels, labelsLp);

        Button open = secondary("فتح");
        open.setOnClickListener(v -> action.run());
        row.addView(open, new LinearLayout.LayoutParams(dp(72), dp(42)));
        page.addView(row);
    }

    private void networkFeature(String feature) {
        if (!hasNetwork()) {
            Toast.makeText(this, feature + " يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show();
            return;
        }
        Toast.makeText(this, feature + " جاهز للربط بالـBackend في مرحلة الاتصالات.", Toast.LENGTH_SHORT).show();
    }

    private void showPreview(String projectName) {
        LinearLayout phone = new LinearLayout(this);
        phone.setOrientation(LinearLayout.VERTICAL);
        phone.setGravity(Gravity.CENTER);
        phone.setPadding(dp(18), dp(26), dp(18), dp(26));
        phone.setBackground(rounded(Color.rgb(9, 15, 24), 30, Color.rgb(78, 91, 111), 2));

        TextView status = text("10:42", 11, MUTED, false);
        status.setGravity(Gravity.CENTER);
        phone.addView(status, matchWrap());
        TextView name = text(projectName, 20, TEXT, true);
        name.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nameLp = matchWrap();
        nameLp.setMargins(0, dp(50), 0, dp(10));
        phone.addView(name, nameLp);
        TextView info = text("👁️ Preview Sandbox\nسيتم تشغيل Build المشروع هنا بدل Production الحقيقي.", 13, MUTED, false);
        info.setGravity(Gravity.CENTER);
        phone.addView(info, matchWrap());

        FrameContainer wrapper = new FrameContainer(this);
        wrapper.setPadding(dp(28), dp(12), dp(28), dp(12));
        wrapper.addView(phone, new FrameContainer.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(500)));

        new AlertDialog.Builder(this)
                .setTitle("معاينة")
                .setView(wrapper)
                .setPositiveButton("إغلاق", null)
                .show();
    }

    private LinearLayout header(String title, String subtitle, boolean back) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(14), dp(10), dp(14), dp(10));
        bar.setBackgroundColor(BG);

        if (back) {
            Button button = secondary("رجوع");
            button.setOnClickListener(v -> showProjects());
            bar.addView(button, new LinearLayout.LayoutParams(dp(72), dp(42)));
        }

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView main = text(title, 20, TEXT, true);
        TextView sub = text(session.displayName + " · " + subtitle, 11, MUTED, false);
        titles.addView(main);
        titles.addView(sub);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(10), 0, dp(10), 0);
        bar.addView(titles, titleLp);
        return bar;
    }

    private void logout() {
        final String token = session.token;
        sessionStore.clear();
        new Thread(() -> ApiClient.logout(token), "uchiha-logout").start();
        goLogin();
    }

    private boolean hasNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private String roleLabel(String role) {
        if ("OWNER".equals(role)) return "👑 Owner";
        if ("DEVELOPER".equals(role)) return "💻 Developer";
        return "🛠 Support";
    }

    private void goLogin() {
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    @Override
    public void onBackPressed() {
        showProjects();
    }

    private LinearLayout page() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return page;
    }

    private ScrollView wrap(LinearLayout page) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
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

    private Button secondary(String label) {
        Button button = primary(label, SURFACE_ALT);
        button.setBackground(rounded(SURFACE_ALT, 14, BORDER, 1));
        return button;
    }

    private LinearLayout.LayoutParams weighted(float weight, boolean marginRight) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(46), weight);
        if (marginRight) lp.setMargins(dp(8), 0, 0, 0);
        return lp;
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

    private static final class FrameContainer extends android.widget.FrameLayout {
        FrameContainer(Context context) { super(context); }
    }
}
