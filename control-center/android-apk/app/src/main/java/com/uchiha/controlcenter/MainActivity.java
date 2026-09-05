package com.uchiha.controlcenter;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * UCHIHA Control Center - Native Phase 1.
 *
 * This Activity intentionally does not embed panel.uchiha-builder.com or any remote page.
 * The shell, navigation, project cards and preview container are rendered locally so the
 * application stays responsive even when the device is offline.
 */
public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int BORDER = Color.rgb(39, 54, 75);

    private final List<ProjectSummary> projects = new ArrayList<>();
    private LinearLayout projectList;
    private String activeQuery = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        // Development seed only. The next data phase replaces this with cached workspace data.
        projects.add(new ProjectSummary("Game Zone", "جاهز للربط", GREEN));
        projects.add(new ProjectSummary("UCHIHA Radius", "قيد التطوير", ORANGE));

        showDashboard();
    }

    private void showDashboard() {
        LinearLayout page = basePage();
        page.addView(topBar("UCHIHA", "مساحة عمل الفريق", false));

        TextView intro = text("مشاريعك في مكان واحد", 22, TEXT, true);
        intro.setPadding(dp(20), dp(16), dp(20), dp(4));
        page.addView(intro);

        TextView sub = text("واجهة محلية سريعة. الاتصال بالإنترنت يُستخدم فقط عند تنفيذ وظيفة تحتاج السيرفر.", 13, MUTED, false);
        sub.setPadding(dp(20), 0, dp(20), dp(16));
        page.addView(sub);

        EditText search = new EditText(this);
        search.setHint("بحث عن مشروع");
        search.setHintTextColor(MUTED);
        search.setTextColor(TEXT);
        search.setTextSize(15);
        search.setSingleLine(true);
        search.setPadding(dp(16), 0, dp(16), 0);
        search.setBackground(rounded(SURFACE, 16, BORDER, 1));
        LinearLayout.LayoutParams searchLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        searchLp.setMargins(dp(20), 0, dp(20), dp(18));
        page.addView(search, searchLp);

        TextView label = text("المشاريع", 16, TEXT, true);
        label.setPadding(dp(20), 0, dp(20), dp(10));
        page.addView(label);

        projectList = new LinearLayout(this);
        projectList.setOrientation(LinearLayout.VERTICAL);
        projectList.setPadding(dp(20), 0, dp(20), dp(96));
        page.addView(projectList, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        renderProjects();

        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                activeQuery = s == null ? "" : s.toString().trim().toLowerCase(Locale.ROOT);
                renderProjects();
            }
            @Override public void afterTextChanged(Editable s) { }
        });

        FrameLayout shell = new FrameLayout(this);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.addView(page);
        shell.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout bottom = bottomBar();
        FrameLayout.LayoutParams bottomLp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(70), Gravity.BOTTOM);
        bottomLp.setMargins(dp(12), 0, dp(12), dp(10));
        shell.addView(bottom, bottomLp);

        setContentView(shell);
    }

    private void renderProjects() {
        if (projectList == null) return;
        projectList.removeAllViews();
        boolean any = false;
        for (ProjectSummary project : projects) {
            if (!activeQuery.isEmpty() && !project.name.toLowerCase(Locale.ROOT).contains(activeQuery)) {
                continue;
            }
            any = true;
            projectList.addView(projectCard(project));
        }
        if (!any) {
            TextView empty = text("لا يوجد مشروع مطابق للبحث", 14, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(12), dp(36), dp(12), dp(36));
            projectList.addView(empty);
        }
    }

    private View projectCard(ProjectSummary project) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(14));
        card.setBackground(rounded(SURFACE, 20, BORDER, 1));
        card.setOnClickListener(v -> showProject(project));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = text(project.name, 18, TEXT, true);
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView status = text(project.status, 12, project.statusColor, true);
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(10), dp(6), dp(10), dp(6));
        status.setBackground(rounded(withAlpha(project.statusColor, 35), 20, withAlpha(project.statusColor, 100), 1));
        header.addView(status);
        card.addView(header);

        TextView hint = text("الكود + المعاينة + الربط", 12, MUTED, false);
        hint.setPadding(0, dp(8), 0, dp(14));
        card.addView(hint);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setWeightSum(2f);

        Button preview = smallButton("معاينة", BLUE);
        preview.setOnClickListener(v -> showPreview(project));
        actions.addView(preview, weightedButtonParams(1f, true));

        Button edit = smallButton("فتح المشروع", SURFACE_ALT);
        edit.setOnClickListener(v -> showProject(project));
        actions.addView(edit, weightedButtonParams(1f, false));
        card.addView(actions);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(12));
        card.setLayoutParams(lp);
        return card;
    }

    private void showProject(ProjectSummary project) {
        LinearLayout page = basePage();
        page.addView(topBar(project.name, "المشروع", true));

        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(dp(18), dp(18), dp(18), dp(18));
        hero.setBackground(rounded(SURFACE, 22, BORDER, 1));
        LinearLayout.LayoutParams heroLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        heroLp.setMargins(dp(20), dp(18), dp(20), dp(14));
        page.addView(hero, heroLp);

        TextView title = text(project.name, 22, TEXT, true);
        hero.addView(title);
        TextView state = text(project.status, 13, project.statusColor, true);
        state.setPadding(0, dp(6), 0, dp(16));
        hero.addView(state);

        Button preview = primaryButton("معاينة المشروع", BLUE);
        preview.setOnClickListener(v -> showPreview(project));
        hero.addView(preview, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        TextView toolsTitle = text("الأدوات المستخدمة", 16, TEXT, true);
        toolsTitle.setPadding(dp(20), dp(4), dp(20), dp(10));
        page.addView(toolsTitle);

        LinearLayout tools = new LinearLayout(this);
        tools.setOrientation(LinearLayout.VERTICAL);
        tools.setPadding(dp(20), 0, dp(20), dp(28));
        page.addView(tools);

        tools.addView(toolRow("AI", "ChatGPT / Claude / Gemini", VIOLET, () -> notConnectedYet("AI")));
        tools.addView(toolRow("GitHub", "المستودع والكود", TEXT, () -> notConnectedYet("GitHub")));
        tools.addView(toolRow("Server", "ربط VPS وإدارة الاتصال", BLUE, this::showServerForm));
        tools.addView(toolRow("Domain", "ربط الدومين بالمشروع", GREEN, () -> notConnectedYet("Domain")));
        tools.addView(toolRow("Deploy", "نشر بعد مراجعة المعاينة", ORANGE, () -> notConnectedYet("Deploy")));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.addView(page);
        setContentView(scroll);
    }

    private View toolRow(String title, String subtitle, int accent, Runnable action) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(15), dp(14), dp(15), dp(14));
        row.setBackground(rounded(SURFACE, 18, BORDER, 1));
        row.setOnClickListener(v -> action.run());

        View mark = new View(this);
        mark.setBackground(rounded(accent, 8, accent, 0));
        LinearLayout.LayoutParams markLp = new LinearLayout.LayoutParams(dp(8), dp(42));
        markLp.setMargins(0, 0, dp(14), 0);
        row.addView(mark, markLp);

        LinearLayout textBox = new LinearLayout(this);
        textBox.setOrientation(LinearLayout.VERTICAL);
        TextView t = text(title, 16, TEXT, true);
        TextView s = text(subtitle, 12, MUTED, false);
        s.setPadding(0, dp(3), 0, 0);
        textBox.addView(t);
        textBox.addView(s);
        row.addView(textBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView arrow = text("‹", 26, MUTED, false);
        row.addView(arrow);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(10));
        row.setLayoutParams(lp);
        return row;
    }

    private void showPreview(ProjectSummary project) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(18), dp(18), dp(18));
        content.setBackgroundColor(BG);

        TextView title = text("Preview Sandbox", 18, TEXT, true);
        content.addView(title);
        TextView info = text("هذه الحاوية محلية الآن. محرك بناء وتشغيل كود المشروع سيُربط في المرحلة التالية حتى تكون المعاينة من الكود وليست من Production.", 13, MUTED, false);
        info.setPadding(0, dp(6), 0, dp(16));
        content.addView(info);

        FrameLayout phone = new FrameLayout(this);
        phone.setBackground(rounded(Color.rgb(3, 6, 11), 30, Color.rgb(63, 77, 98), 2));
        phone.setPadding(dp(10), dp(18), dp(10), dp(18));

        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setGravity(Gravity.CENTER);
        screen.setPadding(dp(18), dp(18), dp(18), dp(18));
        screen.setBackground(rounded(SURFACE, 22, BORDER, 1));
        TextView projectName = text(project.name, 20, TEXT, true);
        projectName.setGravity(Gravity.CENTER);
        TextView message = text("المعاينة المحلية جاهزة كواجهة.\nتشغيل كود المشروع داخل Sandbox هو الخطوة التالية.", 13, MUTED, false);
        message.setGravity(Gravity.CENTER);
        message.setPadding(0, dp(10), 0, 0);
        screen.addView(projectName);
        screen.addView(message);
        phone.addView(screen, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        content.addView(phone, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(420)));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setView(content)
                .setPositiveButton("إغلاق", null)
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(BLUE));
        dialog.show();
    }

    private void showServerForm() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20), dp(8), dp(20), dp(4));

        EditText host = field("IP / Hostname");
        EditText port = field("Port - افتراضي 22");
        EditText user = field("Username");
        EditText password = field("Password / SSH Key في المرحلة القادمة");
        password.setInputType(0x00000081);
        form.addView(host);
        form.addView(port);
        form.addView(user);
        form.addView(password);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("ربط VPS")
                .setView(form)
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("متابعة", null)
                .create();
        dialog.setOnShowListener(d -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(BLUE);
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(MUTED);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                if (host.getText().toString().trim().isEmpty() || user.getText().toString().trim().isEmpty()) {
                    Toast.makeText(this, "أدخل عنوان السيرفر واسم المستخدم", Toast.LENGTH_SHORT).show();
                    return;
                }
                Toast.makeText(this, "الواجهة جاهزة. موصل SSH الآمن سيُضاف في مرحلة الربط.", Toast.LENGTH_LONG).show();
                dialog.dismiss();
            });
        });
        dialog.show();
    }

    private void showTeam() {
        LinearLayout page = basePage();
        page.addView(topBar("Team", "أعضاء مساحة العمل", true));

        TextView title = text("الفريق", 22, TEXT, true);
        title.setPadding(dp(20), dp(20), dp(20), dp(6));
        page.addView(title);
        TextView info = text("نبدأ بثلاثة أدوار فقط: Owner / Developer / Support. نظام تسجيل الدخول والصلاحيات الفعلية سيُربط بالـBackend بدون إضافة خيارات غير مستخدمة.", 13, MUTED, false);
        info.setPadding(dp(20), 0, dp(20), dp(16));
        page.addView(info);

        LinearLayout roleBox = new LinearLayout(this);
        roleBox.setOrientation(LinearLayout.VERTICAL);
        roleBox.setPadding(dp(20), 0, dp(20), dp(30));
        roleBox.addView(roleCard("Owner", "إدارة كاملة لمساحة العمل", VIOLET));
        roleBox.addView(roleCard("Developer", "الكود + AI + Preview + GitHub", BLUE));
        roleBox.addView(roleCard("Support", "متابعة المشروع والحالة المسموحة", GREEN));
        page.addView(roleBox);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(page);
        setContentView(scroll);
    }

    private View roleCard(String role, String description, int color) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(16), dp(14), dp(16), dp(14));
        row.setBackground(rounded(SURFACE, 18, BORDER, 1));
        TextView name = text(role, 16, color, true);
        TextView desc = text(description, 12, MUTED, false);
        desc.setPadding(0, dp(4), 0, 0);
        row.addView(name);
        row.addView(desc);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(10));
        row.setLayoutParams(lp);
        return row;
    }

    private LinearLayout bottomBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(dp(8), dp(7), dp(8), dp(7));
        bar.setBackground(rounded(Color.rgb(12, 20, 31), 24, BORDER, 1));

        Button projectsButton = smallButton("المشاريع", BLUE);
        projectsButton.setOnClickListener(v -> showDashboard());
        bar.addView(projectsButton, weightedButtonParams(1f, true));

        Button teamButton = smallButton("الفريق", SURFACE_ALT);
        teamButton.setOnClickListener(v -> showTeam());
        bar.addView(teamButton, weightedButtonParams(1f, false));

        Button addButton = smallButton("مشروع جديد", SURFACE_ALT);
        addButton.setOnClickListener(v -> Toast.makeText(this, "إضافة المشروع ستُربط بـGitHub في مرحلة الاتصال.", Toast.LENGTH_SHORT).show());
        bar.addView(addButton, weightedButtonParams(1f, false));
        return bar;
    }

    private LinearLayout topBar(String title, String subtitle, boolean back) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(12), dp(16), dp(12));

        if (back) {
            Button backButton = smallButton("رجوع", SURFACE_ALT);
            backButton.setOnClickListener(v -> showDashboard());
            LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(dp(82), dp(42));
            backLp.setMargins(0, 0, dp(12), 0);
            bar.addView(backButton, backLp);
        }

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView main = text(title, 19, TEXT, true);
        TextView sub = text(subtitle, 11, MUTED, false);
        titles.addView(main);
        titles.addView(sub);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView local = text("LOCAL", 10, GREEN, true);
        local.setPadding(dp(9), dp(5), dp(9), dp(5));
        local.setBackground(rounded(withAlpha(GREEN, 28), 18, withAlpha(GREEN, 90), 1));
        bar.addView(local);
        return bar;
    }

    private LinearLayout basePage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        page.setPadding(0, dp(6), 0, dp(16));
        return page;
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setTextSize(14);
        input.setSingleLine(true);
        input.setPadding(dp(14), 0, dp(14), 0);
        input.setBackground(rounded(SURFACE, 14, BORDER, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        lp.setMargins(0, 0, 0, dp(10));
        input.setLayoutParams(lp);
        return input;
    }

    private Button primaryButton(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(color, 16, color, 0));
        return button;
    }

    private Button smallButton(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(12);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setBackground(rounded(color, 14, color == SURFACE_ALT ? BORDER : color, color == SURFACE_ALT ? 1 : 0));
        return button;
    }

    private LinearLayout.LayoutParams weightedButtonParams(float weight, boolean first) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(46), weight);
        if (first) lp.setMargins(0, 0, dp(8), 0);
        return lp;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(sp);
        if (bold) view.setTypeface(null, Typeface.BOLD);
        view.setLineSpacing(0f, 1.12f);
        return view;
    }

    private GradientDrawable rounded(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(strokeDp), strokeColor);
        return drawable;
    }

    private int withAlpha(int color, int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void notConnectedYet(String feature) {
        Toast.makeText(this, feature + " جاهز في الواجهة؛ الربط الفعلي سيأتي في مرحلة الاتصال.", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onBackPressed() {
        showDashboard();
    }

    private static final class ProjectSummary {
        final String name;
        final String status;
        final int statusColor;

        ProjectSummary(String name, String status, int statusColor) {
            this.name = name;
            this.status = status;
            this.statusColor = statusColor;
        }
    }
}
