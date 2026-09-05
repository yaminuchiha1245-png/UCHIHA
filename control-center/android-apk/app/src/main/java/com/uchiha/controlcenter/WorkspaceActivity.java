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
    private static final int SURFACE_SOFT = Color.rgb(17, 27, 41);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(143, 158, 180);
    private static final int BORDER = Color.rgb(39, 54, 75);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int CYAN = Color.rgb(80, 205, 220);
    private static final int RED = Color.rgb(236, 91, 91);

    private SessionStore sessionStore;
    private ProjectCache projectCache;
    private AuthSession session;
    private LinearLayout projectList;
    private TextView syncLabel;
    private TextView projectCount;
    private boolean syncing;
    private boolean detailOpen;

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
        detailOpen = false;
        LinearLayout root = screen();
        root.addView(topBar(false, "UCHIHA Control Center", roleLabel(session.role)), matchWrap());

        LinearLayout page = page();
        page.setPadding(dp(16), dp(12), dp(16), dp(26));

        LinearLayout hero = card(SURFACE, 22);
        LinearLayout heroTop = new LinearLayout(this);
        heroTop.setOrientation(LinearLayout.HORIZONTAL);
        heroTop.setGravity(Gravity.CENTER_VERTICAL);
        heroTop.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        UchihaIconView mark = new UchihaIconView(this, UchihaIconView.BRAND);
        heroTop.addView(mark, new LinearLayout.LayoutParams(dp(56), dp(56)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.addView(text("مساحة العمل", 22, TEXT, true));
        copy.addView(text("مشاريعك وأدواتك الأساسية في مكان واحد.", 12, MUTED, false));
        LinearLayout.LayoutParams copyLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        copyLp.setMargins(dp(12), 0, dp(12), 0);
        heroTop.addView(copy, copyLp);

        TextView live = pill(hasNetwork() ? "متصل" : "محلي", hasNetwork() ? GREEN : ORANGE);
        heroTop.addView(live);
        hero.addView(heroTop);

        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        quick.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        Button ai = compact("فتح AI", VIOLET);
        ai.setOnClickListener(v -> openAi(null));
        quick.addView(ai, weighted(1f, false));
        if (session.can("team.manage")) {
            Button team = compact("الفريق", BLUE);
            team.setOnClickListener(v -> startActivity(new Intent(this, TeamActivity.class)));
            quick.addView(team, weighted(1f, true));
        }
        Button refresh = compact("تحديث", SURFACE_ALT);
        refresh.setOnClickListener(v -> syncProjects(true));
        quick.addView(refresh, weighted(1f, true));
        LinearLayout.LayoutParams quickLp = matchWrap();
        quickLp.setMargins(0, dp(15), 0, 0);
        hero.addView(quick, quickLp);
        addCard(page, hero, 0);

        LinearLayout sectionHead = new LinearLayout(this);
        sectionHead.setOrientation(LinearLayout.HORIZONTAL);
        sectionHead.setGravity(Gravity.CENTER_VERTICAL);
        sectionHead.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        TextView projectsTitle = text("المشاريع", 18, TEXT, true);
        sectionHead.addView(projectsTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        projectCount = text("", 11, MUTED, true);
        sectionHead.addView(projectCount);
        LinearLayout.LayoutParams sectionLp = matchWrap();
        sectionLp.setMargins(dp(2), dp(20), dp(2), dp(6));
        page.addView(sectionHead, sectionLp);

        syncLabel = text("", 11, MUTED, false);
        syncLabel.setPadding(dp(2), 0, dp(2), dp(4));
        page.addView(syncLabel);

        projectList = new LinearLayout(this);
        projectList.setOrientation(LinearLayout.VERTICAL);
        page.addView(projectList, matchWrap());

        JSONArray cached = projectCache.load();
        renderProjects(cached);
        if (cached.length() > 0) {
            syncLabel.setText(hasNetwork() ? "آخر نسخة محفوظة · جارٍ التحقق من التحديثات" : "يتم عرض آخر نسخة محفوظة");
        }

        LinearLayout account = card(SURFACE_SOFT, 18);
        LinearLayout accountRow = new LinearLayout(this);
        accountRow.setOrientation(LinearLayout.HORIZONTAL);
        accountRow.setGravity(Gravity.CENTER_VERTICAL);
        accountRow.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        UchihaIconView teamIcon = new UchihaIconView(this, UchihaIconView.TEAM, BLUE);
        accountRow.addView(teamIcon, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout accountText = new LinearLayout(this);
        accountText.setOrientation(LinearLayout.VERTICAL);
        accountText.addView(text(session.displayName, 14, TEXT, true));
        accountText.addView(text(roleLabel(session.role) + " · جلسة الجهاز مشفرة", 11, MUTED, false));
        LinearLayout.LayoutParams accountTextLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        accountTextLp.setMargins(dp(10), 0, dp(10), 0);
        accountRow.addView(accountText, accountTextLp);
        Button logout = quietDanger("خروج");
        logout.setOnClickListener(v -> logout());
        accountRow.addView(logout, new LinearLayout.LayoutParams(dp(74), dp(42)));
        account.addView(accountRow);
        addCard(page, account, 18);

        root.addView(bodyScroll(page), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        if (hasNetwork()) syncProjects(false);
    }

    private void syncProjects(boolean userRequested) {
        if (syncing || !hasNetwork()) return;
        syncing = true;
        if (syncLabel != null) {
            syncLabel.setText("مزامنة المشاريع…");
            syncLabel.setTextColor(BLUE);
        }
        new Thread(() -> {
            try {
                JSONArray items = ApiClient.listProjects(session.token);
                projectCache.save(items);
                runOnUiThread(() -> {
                    syncing = false;
                    renderProjects(items);
                    if (syncLabel != null) {
                        syncLabel.setText("محدّث الآن من UCHIHA Backend");
                        syncLabel.setTextColor(GREEN);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    syncing = false;
                    if (error instanceof ApiClient.ApiException && ((ApiClient.ApiException) error).status == 401) {
                        sessionStore.clear();
                        goLogin();
                        return;
                    }
                    if (syncLabel != null) {
                        syncLabel.setText(projectCache.load().length() > 0 ? "تعذر التحديث · النسخة المحفوظة متاحة" : "تعذر تحميل المشاريع");
                        syncLabel.setTextColor(ORANGE);
                    }
                    if (userRequested) Toast.makeText(this, "تعذر تحديث المشاريع.", Toast.LENGTH_SHORT).show();
                });
            }
        }, "uchiha-project-sync").start();
    }

    private void renderProjects(JSONArray items) {
        if (projectList == null) return;
        projectList.removeAllViews();
        int count = items == null ? 0 : items.length();
        if (projectCount != null) projectCount.setText(count + " مشروع");
        if (count == 0) {
            LinearLayout empty = card(SURFACE, 18);
            UchihaIconView icon = new UchihaIconView(this, UchihaIconView.PROJECT, MUTED);
            LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(dp(54), dp(54));
            iconLp.gravity = Gravity.CENTER_HORIZONTAL;
            empty.addView(icon, iconLp);
            TextView message = text(hasNetwork() ? "لا توجد مشاريع متاحة لهذا الحساب." : "لا توجد مشاريع محفوظة على الجهاز بعد.", 13, MUTED, false);
            message.setGravity(Gravity.CENTER);
            message.setPadding(dp(8), dp(10), dp(8), dp(8));
            empty.addView(message);
            addCard(projectList, empty, 6);
            return;
        }
        for (int i = 0; i < count; i++) {
            JSONObject project = items.optJSONObject(i);
            if (project != null) projectList.addView(projectCard(project));
        }
    }

    private View projectCard(JSONObject project) {
        String name = project.optString("name", "Project");
        String status = project.optString("statusLabel", project.optString("status", ""));
        String environment = project.optString("environment", "");
        String domain = project.optString("domain", "");
        int health = project.has("healthScore") && !project.isNull("healthScore") ? project.optInt("healthScore", -1) : -1;
        int accent = projectColor(project);

        LinearLayout card = card(SURFACE, 19);
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(0, dp(7), 0, 0);
        card.setLayoutParams(cardLp);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        UchihaIconView projectIcon = new UchihaIconView(this, UchihaIconView.PROJECT, accent);
        top.addView(projectIcon, new LinearLayout.LayoutParams(dp(48), dp(48)));

        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(text(name, 17, TEXT, true));
        String meta = joinMeta(status, environment);
        labels.addView(text(meta.isEmpty() ? "UCHIHA Project" : meta, 11, MUTED, false));
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, dp(10), 0);
        top.addView(labels, labelsLp);
        if (health >= 0) top.addView(pill(health + "%", health >= 90 ? GREEN : ORANGE));
        card.addView(top);

        if (!domain.isEmpty()) {
            TextView domainView = text(domain, 11, MUTED, false);
            domainView.setPadding(dp(58), dp(8), 0, 0);
            card.addView(domainView);
        }

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        Button open = primary("فتح المشروع", BLUE);
        open.setOnClickListener(v -> showProject(project));
        actions.addView(open, weighted(2f, false));
        if (session.can("ai.use")) {
            Button ai = secondary("AI");
            ai.setOnClickListener(v -> openAi(project));
            actions.addView(ai, weighted(1f, true));
        }
        LinearLayout.LayoutParams actionsLp = matchWrap();
        actionsLp.setMargins(0, dp(13), 0, 0);
        card.addView(actions, actionsLp);
        return card;
    }

    private void showProject(JSONObject project) {
        detailOpen = true;
        String projectId = project.optString("id", "");
        String projectName = project.optString("name", "Project");
        LinearLayout root = screen();
        root.addView(topBar(true, projectName, "مساحة المشروع"), matchWrap());

        LinearLayout page = page();
        page.setPadding(dp(16), dp(12), dp(16), dp(28));

        LinearLayout summary = card(SURFACE, 21);
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        UchihaIconView icon = new UchihaIconView(this, UchihaIconView.PROJECT, projectColor(project));
        top.addView(icon, new LinearLayout.LayoutParams(dp(54), dp(54)));
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.addView(text(projectName, 21, TEXT, true));
        copy.addView(text(joinMeta(project.optString("statusLabel", project.optString("status", "")), project.optString("environment", "")), 11, MUTED, false));
        LinearLayout.LayoutParams copyLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        copyLp.setMargins(dp(11), 0, dp(11), 0);
        top.addView(copy, copyLp);
        top.addView(pill(project.optString("statusLabel", "نشط"), projectColor(project)));
        summary.addView(top);

        String domain = project.optString("domain", "");
        if (!domain.isEmpty()) {
            TextView domainView = text(domain, 12, MUTED, false);
            domainView.setPadding(dp(64), dp(9), 0, 0);
            summary.addView(domainView);
        }
        addCard(page, summary, 0);

        sectionTitle(page, "العمل");
        addTool(page, UchihaIconView.AI, "AI Task Engine", "شرح · فحص · Refactor Proposal عبر Guard", VIOLET, "ai.use", () -> openAi(project));
        addTool(page, UchihaIconView.PREVIEW, "Preview", "معاينة معزولة قبل أي نشر", BLUE, "preview.use", () -> openPreview(project));
        addTool(page, UchihaIconView.SOURCE, "Source", "قراءة الملفات وإنشاء Draft ثم Diff", GREEN, "github.use", () -> openSource(projectId, projectName));
        addTool(page, UchihaIconView.REPOSITORY, "GitHub", "المستودع والفرع والمزامنة", CYAN, "github.use", () -> openGithub(projectId, projectName));

        sectionTitle(page, "التشغيل");
        addTool(page, UchihaIconView.SERVER, "Server", "حالة VPS وربط السيرفر", BLUE, "server.manage", () -> openServer(projectId, projectName));
        addTool(page, UchihaIconView.DOMAIN, "Domain", "DNS وTLS والتحقق", GREEN, "domain.manage", () -> openDomain(projectId, projectName));
        addTool(page, UchihaIconView.DEPLOY, "Deploy", "خطة → موافقة Owner → نشر محمي", ORANGE, "deploy.plan", () -> openDeploy(projectId, projectName));

        root.addView(bodyScroll(page), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private void addTool(LinearLayout page, int iconType, String name, String detail, int accent,
                         String capability, Runnable action) {
        if (!session.can(capability)) return;
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        row.setPadding(dp(13), dp(12), dp(13), dp(12));
        row.setBackground(rounded(SURFACE, 17, BORDER, 1));
        LinearLayout.LayoutParams rowLp = matchWrap();
        rowLp.setMargins(0, dp(7), 0, 0);
        row.setLayoutParams(rowLp);

        UchihaIconView icon = new UchihaIconView(this, iconType, accent);
        row.addView(icon, new LinearLayout.LayoutParams(dp(48), dp(48)));

        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(text(name, 15, TEXT, true));
        labels.addView(text(detail, 11, MUTED, false));
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, dp(10), 0);
        row.addView(labels, labelsLp);

        Button open = secondary("فتح");
        open.setOnClickListener(v -> action.run());
        row.addView(open, new LinearLayout.LayoutParams(dp(70), dp(42)));
        page.addView(row);
    }

    private void openAi(JSONObject project) {
        if (!hasNetwork()) {
            Toast.makeText(this, "AI يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(this, AiConnectionsActivity.class);
        if (project != null) {
            intent.putExtra("project_id", project.optString("id", ""));
            intent.putExtra("project_name", project.optString("name", "Project"));
        }
        startActivity(intent);
    }

    private void openPreview(JSONObject project) {
        if (!hasNetwork()) { Toast.makeText(this, "Preview يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show(); return; }
        String id = project.optString("id", "");
        if (id.isEmpty()) return;
        Intent intent = new Intent(this, PreviewActivity.class);
        intent.putExtra("project_id", id);
        intent.putExtra("project_name", project.optString("name", "Project"));
        startActivity(intent);
    }

    private void openSource(String projectId, String projectName) {
        if (!hasNetwork()) { Toast.makeText(this, "Source يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show(); return; }
        if (projectId == null || projectId.isEmpty()) return;
        Intent intent = new Intent(this, SourceActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void openGithub(String projectId, String projectName) {
        if (!hasNetwork()) { Toast.makeText(this, "GitHub يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show(); return; }
        if (projectId == null || projectId.isEmpty()) return;
        Intent intent = new Intent(this, GitHubActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void openServer(String projectId, String projectName) {
        if (!hasNetwork()) { Toast.makeText(this, "Server يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show(); return; }
        if (projectId == null || projectId.isEmpty()) return;
        Intent intent = new Intent(this, ServerActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void openDomain(String projectId, String projectName) {
        if (!hasNetwork()) { Toast.makeText(this, "Domain يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show(); return; }
        if (projectId == null || projectId.isEmpty()) return;
        Intent intent = new Intent(this, DomainActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private void openDeploy(String projectId, String projectName) {
        if (!hasNetwork()) { Toast.makeText(this, "Deploy يحتاج اتصالًا بالإنترنت.", Toast.LENGTH_SHORT).show(); return; }
        if (projectId == null || projectId.isEmpty()) return;
        Intent intent = new Intent(this, DeployActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName);
        startActivity(intent);
    }

    private LinearLayout topBar(boolean back, String title, String subtitle) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        bar.setPadding(dp(16), dp(9), dp(16), dp(9));
        bar.setBackgroundColor(BG);

        UchihaIconView brand = new UchihaIconView(this, UchihaIconView.BRAND);
        bar.addView(brand, new LinearLayout.LayoutParams(dp(44), dp(44)));

        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(text(title, 18, TEXT, true));
        labels.addView(text(session.displayName + " · " + subtitle, 10, MUTED, false));
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, dp(10), 0);
        bar.addView(labels, labelsLp);

        if (back) {
            Button backButton = secondary("رجوع");
            backButton.setOnClickListener(v -> showProjects());
            bar.addView(backButton, new LinearLayout.LayoutParams(dp(72), dp(42)));
        }
        return bar;
    }

    private LinearLayout screen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return root;
    }

    private LinearLayout page() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return page;
    }

    private ScrollView bodyScroll(LinearLayout page) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private LinearLayout card(int color, int radius) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(15), dp(14), dp(15), dp(14));
        card.setBackground(rounded(color, radius, BORDER, 1));
        return card;
    }

    private void addCard(LinearLayout parent, View card, int top) {
        LinearLayout.LayoutParams lp = matchWrap();
        lp.setMargins(0, dp(top), 0, 0);
        parent.addView(card, lp);
    }

    private void sectionTitle(LinearLayout page, String title) {
        TextView view = text(title, 16, TEXT, true);
        view.setPadding(dp(2), dp(20), dp(2), dp(6));
        page.addView(view);
    }

    private TextView pill(String value, int accent) {
        TextView pill = text(value == null || value.isEmpty() ? "—" : value, 10, accent, true);
        pill.setGravity(Gravity.CENTER);
        pill.setPadding(dp(9), dp(5), dp(9), dp(5));
        pill.setBackground(rounded(SURFACE_ALT, 12, accent, 1));
        return pill;
    }

    private String joinMeta(String a, String b) {
        String left = a == null ? "" : a.trim();
        String right = b == null ? "" : b.trim();
        if (left.isEmpty()) return right;
        if (right.isEmpty()) return left;
        return left + " · " + right;
    }

    private int projectColor(JSONObject project) {
        String status = project.optString("status", "").toLowerCase();
        String environment = project.optString("environment", "").toLowerCase();
        if (status.contains("error") || status.contains("down") || status.contains("failed")) return RED;
        if (environment.contains("preview") || environment.contains("staging")) return VIOLET;
        return GREEN;
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
        if ("OWNER".equals(role)) return "Owner";
        if ("DEVELOPER".equals(role)) return "Developer";
        return "Support";
    }

    private void goLogin() {
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    @Override
    public void onBackPressed() {
        if (detailOpen) showProjects();
        else super.onBackPressed();
    }

    private Button primary(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setBackground(rounded(color, 14, color, 0));
        return button;
    }

    private Button compact(String label, int color) {
        Button button = primary(label, color);
        if (color == SURFACE_ALT) button.setBackground(rounded(SURFACE_ALT, 13, BORDER, 1));
        return button;
    }

    private Button secondary(String label) {
        Button button = primary(label, SURFACE_ALT);
        button.setTextColor(TEXT);
        button.setBackground(rounded(SURFACE_ALT, 13, BORDER, 1));
        return button;
    }

    private Button quietDanger(String label) {
        Button button = primary(label, SURFACE_ALT);
        button.setTextColor(RED);
        button.setBackground(rounded(SURFACE_ALT, 13, Color.rgb(88, 48, 58), 1));
        return button;
    }

    private LinearLayout.LayoutParams weighted(float weight, boolean margin) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(46), weight);
        if (margin) lp.setMargins(dp(7), 0, 0, 0);
        return lp;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(sp);
        if (bold) view.setTypeface(null, Typeface.BOLD);
        view.setLineSpacing(0f, 1.14f);
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
