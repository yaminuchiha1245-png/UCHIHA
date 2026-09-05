package com.uchiha.controlcenter;

import android.app.Activity;
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

import org.json.JSONArray;
import org.json.JSONObject;

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
    private ProjectCache projectCache;
    private AuthSession session;
    private LinearLayout projectList;
    private TextView syncLabel;
    private boolean syncing;

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
        projectCache = new ProjectCache(this, session.userId);
        showProjects();
    }

    private void showProjects() {
        LinearLayout page = page();
        page.addView(header("UCHIHA", roleLabel(session.role), false));

        if (!hasNetwork()) {
            TextView offline = text("📴 وضع محلي — يتم عرض آخر نسخة محفوظة من المشاريع", 12, ORANGE, true);
            offline.setPadding(dp(18), dp(10), dp(18), dp(10));
            offline.setBackground(rounded(Color.rgb(38, 31, 19), 14, Color.rgb(92, 68, 29), 1));
            LinearLayout.LayoutParams offLp = matchWrap();
            offLp.setMargins(dp(16), dp(10), dp(16), 0);
            page.addView(offline, offLp);
        }

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        titleRow.setPadding(dp(18), dp(18), dp(18), dp(8));
        TextView title = text("📦 المشاريع", 22, TEXT, true);
        titleRow.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (hasNetwork()) {
            Button refresh = secondary("تحديث");
            refresh.setOnClickListener(v -> syncProjects(true));
            titleRow.addView(refresh, new LinearLayout.LayoutParams(dp(78), dp(42)));
        }
        page.addView(titleRow);

        syncLabel = text("", 11, MUTED, false);
        syncLabel.setPadding(dp(18), 0, dp(18), dp(4));
        page.addView(syncLabel);

        projectList = new LinearLayout(this);
        projectList.setOrientation(LinearLayout.VERTICAL);
        page.addView(projectList, matchWrap());

        JSONArray cached = projectCache.load();
        renderProjects(cached);
        if (cached.length() > 0) {
            syncLabel.setText(hasNetwork()
                    ? "آخر نسخة محفوظة — جارٍ التحقق من التحديثات"
                    : "آخر نسخة محفوظة على هذا الجهاز");
        }

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
        if (hasNetwork()) syncProjects(false);
    }

    private void syncProjects(boolean userRequested) {
        if (syncing || !hasNetwork()) return;
        syncing = true;
        if (syncLabel != null) syncLabel.setText("🔄 مزامنة المشاريع…");
        new Thread(() -> {
            try {
                JSONArray items = ApiClient.listProjects(session.token);
                projectCache.save(items);
                runOnUiThread(() -> {
                    syncing = false;
                    renderProjects(items);
                    if (syncLabel != null) syncLabel.setText("✅ المشاريع محدثة من UCHIHA Control Center");
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    syncing = false;
                    if (error instanceof ApiClient.ApiException
                            && ((ApiClient.ApiException) error).status == 401) {
                        sessionStore.clear();
                        Toast.makeText(this, "انتهت الجلسة. سجّل الدخول من جديد.", Toast.LENGTH_SHORT).show();
                        goLogin();
                        return;
                    }
                    if (syncLabel != null) {
                        syncLabel.setText(projectCache.load().length() > 0
                                ? "تعذر التحديث — يتم عرض النسخة المحفوظة"
                                : "تعذر تحميل المشاريع الآن");
                    }
                    if (userRequested) Toast.makeText(this, "تعذر مزامنة المشاريع.", Toast.LENGTH_SHORT).show();
                });
            }
        }, "uchiha-project-sync").start();
    }

    private void renderProjects(JSONArray items) {
        if (projectList == null) return;
        projectList.removeAllViews();
        if (items == null || items.length() == 0) {
            TextView empty = text(hasNetwork()
                            ? "لا توجد مشاريع متاحة لهذا الحساب حاليًا."
                            : "لا توجد مشاريع محفوظة على هذا الجهاز بعد.",
                    13, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(18), dp(34), dp(18), dp(34));
            projectList.addView(empty, matchWrap());
            return;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject project = items.optJSONObject(i);
            if (project != null) projectList.addView(projectCard(project));
        }
    }

    private LinearLayout projectCard(JSONObject project) {
        String name = project.optString("name", "Project");
        String status = project.optString("statusLabel", project.optString("status", ""));
        String environment = project.optString("environment", "");
        String domain = project.optString("domain", "");

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(15), dp(16), dp(14));
        card.setBackground(rounded(SURFACE, 19, BORDER, 1));
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(dp(16), dp(8), dp(16), 0);
        card.setLayoutParams(cardLp);
        card.addView(text(projectIcon(project) + "  " + name, 18, TEXT, true));

        StringBuilder meta = new StringBuilder();
        if (!status.isEmpty()) meta.append(status);
        if (!environment.isEmpty()) {
            if (meta.length() > 0) meta.append(" · ");
            meta.append(environment);
        }
        if (!domain.isEmpty()) {
            if (meta.length() > 0) meta.append("\n");
            meta.append(domain);
        }
        TextView state = text(meta.length() == 0 ? "مشروع UCHIHA" : meta.toString(), 12, MUTED, false);
        LinearLayout.LayoutParams stateLp = matchWrap();
        stateLp.setMargins(0, dp(4), 0, dp(12));
        card.addView(state, stateLp);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        Button open = primary("فتح", BLUE);
        open.setOnClickListener(v -> showProject(project));
        actions.addView(open, weighted(1f, false));
        if (session.can("preview.use")) {
            Button preview = secondary("👁️ معاينة");
            preview.setOnClickListener(v -> openPreview(project));
            actions.addView(preview, weighted(1f, true));
        }
        card.addView(actions);
        return card;
    }

    private String projectIcon(JSONObject project) {
        String environment = project.optString("environment", "").toLowerCase();
        String status = project.optString("status", "").toLowerCase();
        if (status.contains("error") || status.contains("down") || status.contains("failed")) return "🔴";
        if (environment.contains("production") || environment.contains("إنتاج")) return "🟢";
        if (environment.contains("preview") || environment.contains("staging")) return "🧪";
        return "📦";
    }

    private void showProject(JSONObject project) {
        String projectId = project.optString("id", "");
        String projectName = project.optString("name", "Project");
        LinearLayout page = page();
        page.addView(header(projectName, "مساحة المشروع", true));

        LinearLayout summary = new LinearLayout(this);
        summary.setOrientation(LinearLayout.VERTICAL);
        summary.setPadding(dp(15), dp(14), dp(15), dp(14));
        summary.setBackground(rounded(SURFACE, 18, BORDER, 1));
        LinearLayout.LayoutParams summaryLp = matchWrap();
        summaryLp.setMargins(dp(16), dp(14), dp(16), dp(5));
        page.addView(summary, summaryLp);
        addProjectValue(summary, "الحالة", project.optString("statusLabel", project.optString("status", "—")));
        addProjectValue(summary, "البيئة", project.optString("environment", "—"));
        addProjectValue(summary, "الدومين", project.optString("domain", "—"));
        addProjectValue(summary, "السيرفر", project.optString("server", "—"));
        addProjectValue(summary, "الإصدار", project.optString("release", "—"));
        if (project.has("healthScore") && !project.isNull("healthScore")) {
            addProjectValue(summary, "Health", project.optInt("healthScore", 0) + "%");
        }
        String lastDeploy = project.optString("lastDeploy", "");
        if (!lastDeploy.isEmpty()) addProjectValue(summary, "آخر نشر", lastDeploy);

        TextView title = text("الأدوات", 20, TEXT, true);
        title.setPadding(dp(18), dp(18), dp(18), dp(10));
        page.addView(title);
        addTool(page, "👁️", "Preview", "معاينة Source داخل هاتف معزول", BLUE, "preview.use", () -> openPreview(project));
        addTool(page, "🤖", "AI", "ChatGPT / Claude / Gemini حسب الربط", VIOLET, "ai.use", () -> networkFeature("AI"));
        addTool(page, "🐙", "GitHub", "المستودع والفرع والمزامنة", SURFACE_ALT, "github.use", () -> openGithub(projectId, projectName));
        addTool(page, "💻", "Server", "ربط VPS واختبار SSH", BLUE, "server.manage", () -> openServer(projectId, projectName));
        addTool(page, "🌐", "Domain", "سجل DNS وحالة HTTPS", GREEN, "domain.manage", () -> openDomain(projectId, projectName));
        addTool(page, "🚀", "Deploy", "خطة → موافقة المالك → نشر محمي", ORANGE, "deploy.plan", () -> openDeploy(projectId, projectName));
        setContentView(wrap(page));
    }

    private void addProjectValue(LinearLayout parent, String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(4), 0, dp(4));
        TextView labelView = text(label, 12, MUTED, false);
        TextView valueView = text(value == null || value.isEmpty() ? "—" : value, 13, TEXT, true);
        valueView.setGravity(Gravity.END);
        row.addView(labelView, new LinearLayout.LayoutParams(dp(92), ViewGroup.LayoutParams.WRAP_CONTENT));
        row.addView(valueView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        parent.addView(row, matchWrap());
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
        labels.addView(text(name, 16, TEXT, true));
        labels.addView(text(detail, 12, MUTED, false));
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, dp(10), 0);
        row.addView(labels, labelsLp);
        Button open = secondary("فتح");
        open.setOnClickListener(v -> action.run());
        row.addView(open, new LinearLayout.LayoutParams(dp(72), dp(42)));
        page.addView(row);
    }

    private void openPreview(JSONObject project) {
        if (!hasNetwork()) {
            Toast.makeText(this, "Source Preview يحتاج اتصالًا بالإنترنت حاليًا.", Toast.LENGTH_SHORT).show();
            return;
        }
        String projectId = project.optString("id", "");
        if (projectId.isEmpty()) {
            Toast.makeText(this, "معرّف المشروع غير متاح.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(this, PreviewActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", project.optString("name", "Project"));
        startActivity(intent);
    }

    private void openGithub(String projectId, String projectName) {
        if (!hasNetwork()) {
            Toast.makeText(this, "GitHub يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (projectId == null || projectId.isEmpty()) {
            Toast.makeText(this, "معرّف المشروع غير متاح.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(this, GitHubActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void openServer(String projectId, String projectName) {
        if (!hasNetwork()) {
            Toast.makeText(this, "Server يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (projectId == null || projectId.isEmpty()) {
            Toast.makeText(this, "معرّف المشروع غير متاح.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(this, ServerActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void openDomain(String projectId, String projectName) {
        if (!hasNetwork()) {
            Toast.makeText(this, "Domain يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (projectId == null || projectId.isEmpty()) {
            Toast.makeText(this, "معرّف المشروع غير متاح.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(this, DomainActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void openDeploy(String projectId, String projectName) {
        if (!hasNetwork()) {
            Toast.makeText(this, "Deploy يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (projectId == null || projectId.isEmpty()) {
            Toast.makeText(this, "معرّف المشروع غير متاح.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(this, DeployActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void networkFeature(String feature) {
        if (!hasNetwork()) {
            Toast.makeText(this, feature + " يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show();
            return;
        }
        Toast.makeText(this, feature + " سيُربط بالمحرك الحقيقي في مرحلة الاتصالات.", Toast.LENGTH_SHORT).show();
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
        titles.addView(text(title, 20, TEXT, true));
        titles.addView(text(session.displayName + " · " + subtitle, 11, MUTED, false));
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
}
