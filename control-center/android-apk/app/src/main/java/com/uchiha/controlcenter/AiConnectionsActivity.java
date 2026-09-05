package com.uchiha.controlcenter;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

public final class AiConnectionsActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int SURFACE_SOFT = Color.rgb(17, 27, 41);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(143, 158, 180);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int CYAN = Color.rgb(80, 205, 220);
    private static final int RED = Color.rgb(236, 91, 91);

    private AuthSession session;
    private JSONArray projects = new JSONArray();
    private JSONObject selectedProject;
    private String selectedMode = "inspect";
    private String requestedProjectId;
    private Button projectButton;
    private Button explainButton;
    private Button inspectButton;
    private Button refactorButton;
    private Button submitButton;
    private EditText instructionInput;
    private TextView stateView;
    private LinearLayout taskList;
    private boolean busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        session = new SessionStore(this).load();
        if (session == null) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        if (!session.can("ai.use")) {
            finish();
            return;
        }
        requestedProjectId = getIntent().getStringExtra("project_id");
        render();
        loadProjects();
    }

    private void render() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        root.addView(header(), matchWrap());

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setPadding(dp(16), dp(10), dp(16), dp(18));
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout guard = card(SURFACE, 18);
        LinearLayout guardTop = new LinearLayout(this);
        guardTop.setOrientation(LinearLayout.HORIZONTAL);
        guardTop.setGravity(Gravity.CENTER_VERTICAL);
        guardTop.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        UchihaIconView security = new UchihaIconView(this, UchihaIconView.SECURITY, GREEN);
        guardTop.addView(security, new LinearLayout.LayoutParams(dp(46), dp(46)));
        LinearLayout guardText = new LinearLayout(this);
        guardText.setOrientation(LinearLayout.VERTICAL);
        guardText.addView(text("مسار AI محمي", 15, TEXT, true));
        guardText.addView(text("لا كتابة مباشرة إلى Production", 11, GREEN, true));
        LinearLayout.LayoutParams guardTextLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        guardTextLp.setMargins(dp(10), 0, dp(10), 0);
        guardTop.addView(guardText, guardTextLp);
        guardTop.addView(pill("Guard ON", GREEN));
        guard.addView(guardTop);
        TextView flow = text("Explain / Inspect / Refactor Proposal  →  Diff  →  Preview  →  Owner Approval", 11, MUTED, false);
        flow.setPadding(dp(56), dp(9), 0, 0);
        guard.addView(flow);
        addCard(page, guard, 0);

        LinearLayout bridge = card(SURFACE_SOFT, 18);
        LinearLayout bridgeTop = new LinearLayout(this);
        bridgeTop.setOrientation(LinearLayout.HORIZONTAL);
        bridgeTop.setGravity(Gravity.CENTER_VERTICAL);
        bridgeTop.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        UchihaIconView aiIcon = new UchihaIconView(this, UchihaIconView.AI, VIOLET);
        bridgeTop.addView(aiIcon, new LinearLayout.LayoutParams(dp(46), dp(46)));
        LinearLayout bridgeText = new LinearLayout(this);
        bridgeText.setOrientation(LinearLayout.VERTICAL);
        bridgeText.addView(text("AI Account Bridge", 14, TEXT, true));
        bridgeText.addView(text("ChatGPT · Claude · Gemini", 11, MUTED, false));
        LinearLayout.LayoutParams bridgeTextLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bridgeTextLp.setMargins(dp(10), 0, dp(10), 0);
        bridgeTop.addView(bridgeText, bridgeTextLp);
        bridgeTop.addView(pill("بانتظار الربط", ORANGE));
        bridge.addView(bridgeTop);
        TextView bridgeNote = text("الحسابات ستُربط فقط عبر تدفق رسمي مدعوم. لا نستخدم Cookies أو جلسات منسوخة. API يبقى خيارًا متقدمًا احتياطيًا فقط.", 11, MUTED, false);
        bridgeNote.setPadding(dp(56), dp(9), 0, 0);
        bridge.addView(bridgeNote);
        addCard(page, bridge, 9);

        sectionTitle(page, "المشروع");
        projectButton = secondary("تحميل المشاريع…");
        projectButton.setEnabled(false);
        projectButton.setOnClickListener(v -> chooseProject());
        page.addView(projectButton, fullButtonLp());

        sectionTitle(page, "نوع المهمة");
        LinearLayout modes = new LinearLayout(this);
        modes.setOrientation(LinearLayout.HORIZONTAL);
        modes.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        explainButton = modeButton("شرح", "explain");
        inspectButton = modeButton("فحص", "inspect");
        refactorButton = modeButton("Refactor", "refactor_proposal");
        modes.addView(explainButton, weightedButton(false));
        modes.addView(inspectButton, weightedButton(true));
        modes.addView(refactorButton, weightedButton(true));
        page.addView(modes, matchWrap());
        refreshModeButtons();

        stateView = text("جارٍ تهيئة AI Task Engine…", 11, MUTED, false);
        stateView.setPadding(dp(2), dp(14), dp(2), dp(2));
        page.addView(stateView);

        sectionTitle(page, "آخر المهام");
        taskList = new LinearLayout(this);
        taskList.setOrientation(LinearLayout.VERTICAL);
        page.addView(taskList, matchWrap());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        root.addView(composer(), matchWrap());
        setContentView(root);
    }

    private LinearLayout header() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        bar.setPadding(dp(16), dp(9), dp(16), dp(9));
        bar.setBackgroundColor(BG);

        UchihaIconView mark = new UchihaIconView(this, UchihaIconView.AI, VIOLET);
        bar.addView(mark, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(text("UCHIHA AI", 19, TEXT, true));
        titles.addView(text("Task Engine · alpha17", 10, MUTED, false));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(10), 0, dp(10), 0);
        bar.addView(titles, titleLp);
        Button back = secondary("رجوع");
        back.setOnClickListener(v -> finish());
        bar.addView(back, new LinearLayout.LayoutParams(dp(72), dp(42)));
        return bar;
    }

    private LinearLayout composer() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(10), dp(16), dp(12));
        box.setBackgroundColor(SURFACE_SOFT);
        box.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        titleRow.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        titleRow.addView(text("المهمة الجديدة", 12, TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        titleRow.addView(text("Diff + Preview أولًا", 10, GREEN, true));
        box.addView(titleRow);

        instructionInput = new EditText(this);
        instructionInput.setTextColor(TEXT);
        instructionInput.setHintTextColor(MUTED);
        instructionInput.setHint("اكتب ما تريد فحصه أو شرحه أو اقتراح تحسينه…");
        instructionInput.setTextSize(13);
        instructionInput.setGravity(Gravity.TOP | Gravity.START);
        instructionInput.setMinLines(2);
        instructionInput.setMaxLines(4);
        instructionInput.setPadding(dp(13), dp(10), dp(13), dp(10));
        instructionInput.setBackground(rounded(BG, 14, BORDER, 1));
        LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(78));
        inputLp.setMargins(0, dp(8), 0, 0);
        box.addView(instructionInput, inputLp);

        submitButton = primary("إنشاء مهمة آمنة", VIOLET);
        submitButton.setOnClickListener(v -> createTask());
        LinearLayout.LayoutParams submitLp = fullButtonLp();
        submitLp.setMargins(0, dp(8), 0, 0);
        box.addView(submitButton, submitLp);
        return box;
    }

    private Button modeButton(String label, String mode) {
        Button button = secondary(label);
        button.setOnClickListener(v -> {
            selectedMode = mode;
            refreshModeButtons();
        });
        return button;
    }

    private void refreshModeButtons() {
        styleMode(explainButton, "explain".equals(selectedMode), BLUE);
        styleMode(inspectButton, "inspect".equals(selectedMode), CYAN);
        styleMode(refactorButton, "refactor_proposal".equals(selectedMode), VIOLET);
    }

    private void styleMode(Button button, boolean active, int accent) {
        if (button == null) return;
        button.setTextColor(active ? Color.WHITE : MUTED);
        button.setBackground(rounded(active ? darkAccent(accent) : SURFACE_ALT, 13, active ? accent : BORDER, 1));
    }

    private void loadProjects() {
        if (busy) return;
        busy = true;
        state("تحميل المشاريع…", BLUE);
        new Thread(() -> {
            try {
                JSONArray items = ApiClient.listProjects(session.token);
                runOnUiThread(() -> {
                    busy = false;
                    projects = items == null ? new JSONArray() : items;
                    projectButton.setEnabled(projects.length() > 0);
                    if (projects.length() > 0) {
                        selectedProject = preferredProject(projects, requestedProjectId);
                        if (selectedProject == null) selectedProject = projects.optJSONObject(0);
                        updateProjectButton();
                        loadTasks();
                    } else {
                        projectButton.setText("لا توجد مشاريع");
                        state("لا توجد مشاريع متاحة لهذا الحساب.", MUTED);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    state("تعذر تحميل المشاريع.", RED);
                    Toast.makeText(this, "تعذر تحميل المشاريع.", Toast.LENGTH_SHORT).show();
                });
            }
        }, "uchiha-ai-projects").start();
    }

    private JSONObject preferredProject(JSONArray items, String projectId) {
        if (projectId == null || projectId.isEmpty()) return null;
        for (int i = 0; i < items.length(); i++) {
            JSONObject project = items.optJSONObject(i);
            if (project != null && projectId.equals(project.optString("id", ""))) return project;
        }
        return null;
    }

    private void chooseProject() {
        if (projects.length() == 0 || busy) return;
        String[] labels = new String[projects.length()];
        for (int i = 0; i < projects.length(); i++) {
            JSONObject project = projects.optJSONObject(i);
            labels[i] = project == null ? "Project" : project.optString("name", project.optString("id", "Project"));
        }
        new AlertDialog.Builder(this)
                .setTitle("اختر المشروع")
                .setItems(labels, (dialog, which) -> {
                    selectedProject = projects.optJSONObject(which);
                    updateProjectButton();
                    loadTasks();
                })
                .show();
    }

    private void updateProjectButton() {
        if (selectedProject == null) {
            projectButton.setText("اختر المشروع");
            return;
        }
        String name = selectedProject.optString("name", selectedProject.optString("id", "Project"));
        String environment = selectedProject.optString("environment", "");
        projectButton.setText(environment.isEmpty() ? name : name + " · " + environment);
    }

    private void createTask() {
        if (busy || selectedProject == null) return;
        String projectId = selectedProject.optString("id", "");
        String instruction = instructionInput.getText().toString().trim();
        if (instruction.length() < 4) {
            instructionInput.setError("اكتب طلبًا واضحًا.");
            return;
        }
        if (instruction.length() > 4000) {
            instructionInput.setError("الطلب طويل جدًا.");
            return;
        }
        busy = true;
        setControlsEnabled(false);
        state("إنشاء المهمة خلف Guard…", VIOLET);
        new Thread(() -> {
            try {
                JSONObject response = AiTaskApiClient.create(session.token, projectId, selectedMode, instruction);
                JSONObject task = response.optJSONObject("task");
                runOnUiThread(() -> {
                    busy = false;
                    setControlsEnabled(true);
                    instructionInput.setText("");
                    state(task == null ? "تم إنشاء المهمة." : "تم إنشاء المهمة · " + stageLabel(task.optString("status", "")), GREEN);
                    Toast.makeText(this, "تمت إضافة المهمة إلى المسار المحمي.", Toast.LENGTH_SHORT).show();
                    loadTasks();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    setControlsEnabled(true);
                    showTaskError(error);
                });
            }
        }, "uchiha-ai-task-create").start();
    }

    private void loadTasks() {
        if (busy || selectedProject == null) return;
        String projectId = selectedProject.optString("id", "");
        if (projectId.isEmpty()) return;
        busy = true;
        state("تحديث مهام AI…", BLUE);
        new Thread(() -> {
            try {
                JSONObject response = AiTaskApiClient.list(session.token, projectId);
                JSONArray items = response.optJSONArray("items");
                runOnUiThread(() -> {
                    busy = false;
                    renderTasks(items == null ? new JSONArray() : items);
                    state("AI Task Engine جاهز.", GREEN);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    renderTasks(new JSONArray());
                    showTaskError(error);
                });
            }
        }, "uchiha-ai-task-list").start();
    }

    private void renderTasks(JSONArray items) {
        taskList.removeAllViews();
        if (items.length() == 0) {
            LinearLayout empty = card(SURFACE, 17);
            UchihaIconView icon = new UchihaIconView(this, UchihaIconView.AI, MUTED);
            LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(dp(50), dp(50));
            iconLp.gravity = Gravity.CENTER_HORIZONTAL;
            empty.addView(icon, iconLp);
            TextView message = text("لا توجد مهام AI لهذا المشروع بعد.", 12, MUTED, false);
            message.setGravity(Gravity.CENTER);
            message.setPadding(dp(10), dp(8), dp(10), dp(6));
            empty.addView(message);
            addCard(taskList, empty, 6);
            return;
        }
        int shown = Math.min(items.length(), 12);
        for (int i = 0; i < shown; i++) {
            JSONObject task = items.optJSONObject(i);
            if (task == null) continue;
            int accent = modeAccent(task.optString("mode", ""));
            int stage = stageAccent(task.optString("status", ""));
            LinearLayout card = card(SURFACE, 17);

            LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(Gravity.CENTER_VERTICAL);
            top.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
            UchihaIconView icon = new UchihaIconView(this, UchihaIconView.AI, accent);
            top.addView(icon, new LinearLayout.LayoutParams(dp(44), dp(44)));
            LinearLayout labels = new LinearLayout(this);
            labels.setOrientation(LinearLayout.VERTICAL);
            labels.addView(text(modeLabel(task.optString("mode", "")), 14, TEXT, true));
            labels.addView(text("AI Task · Guarded", 10, MUTED, false));
            LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            labelsLp.setMargins(dp(9), 0, dp(9), 0);
            top.addView(labels, labelsLp);
            top.addView(pill(stageLabel(task.optString("status", "")), stage));
            card.addView(top);

            TextView instruction = text(task.optString("instruction", ""), 12, MUTED, false);
            instruction.setMaxLines(3);
            instruction.setPadding(dp(53), dp(8), 0, dp(8));
            card.addView(instruction);

            TextView flow = text("Diff  •  Preview  •  Owner Approval", 11, GREEN, true);
            flow.setPadding(dp(53), 0, 0, 0);
            card.addView(flow);
            addCard(taskList, card, 7);
        }
    }

    private void showTaskError(Exception error) {
        String message = "تعذر إكمال مهمة AI.";
        if (error instanceof AiTaskApiClient.AiTaskException) {
            AiTaskApiClient.AiTaskException api = (AiTaskApiClient.AiTaskException) error;
            if ("ai_task_mode_invalid".equals(api.code)) message = "نوع المهمة غير صالح.";
            else if ("ai_task_instruction_invalid".equals(api.code)) message = "طلب AI غير صالح.";
            else if ("project_not_found".equals(api.code)) message = "المشروع غير موجود.";
            else if (api.status == 401) message = "انتهت جلسة UCHIHA.";
        }
        state(message, RED);
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void state(String message, int color) {
        if (stateView == null) return;
        stateView.setText(message);
        stateView.setTextColor(color);
    }

    private String modeLabel(String mode) {
        if ("explain".equals(mode)) return "Explain";
        if ("inspect".equals(mode)) return "Inspect";
        if ("refactor_proposal".equals(mode)) return "Refactor Proposal";
        return "AI Task";
    }

    private int modeAccent(String mode) {
        if ("explain".equals(mode)) return BLUE;
        if ("inspect".equals(mode)) return CYAN;
        if ("refactor_proposal".equals(mode)) return VIOLET;
        return VIOLET;
    }

    private String stageLabel(String status) {
        if ("awaiting_account_bridge".equals(status)) return "بانتظار الحساب";
        if ("queued".equals(status)) return "قيد الانتظار";
        if ("ready".equals(status)) return "جاهز للمراجعة";
        return status == null || status.isEmpty() ? "محمي" : status;
    }

    private int stageAccent(String status) {
        if ("ready".equals(status)) return GREEN;
        if ("awaiting_account_bridge".equals(status)) return ORANGE;
        if ("queued".equals(status)) return BLUE;
        return MUTED;
    }

    private void setControlsEnabled(boolean enabled) {
        if (projectButton != null) projectButton.setEnabled(enabled && projects.length() > 0);
        if (explainButton != null) explainButton.setEnabled(enabled);
        if (inspectButton != null) inspectButton.setEnabled(enabled);
        if (refactorButton != null) refactorButton.setEnabled(enabled);
        if (instructionInput != null) instructionInput.setEnabled(enabled);
        if (submitButton != null) submitButton.setEnabled(enabled);
    }

    private LinearLayout card(int color, int radius) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(15), dp(14), dp(15), dp(14));
        card.setBackground(rounded(color, radius, BORDER, 1));
        return card;
    }

    private void addCard(LinearLayout parent, View card, int topDp) {
        LinearLayout.LayoutParams lp = matchWrap();
        lp.setMargins(0, dp(topDp), 0, 0);
        parent.addView(card, lp);
    }

    private void sectionTitle(LinearLayout page, String label) {
        TextView title = text(label, 13, TEXT, true);
        title.setPadding(dp(2), dp(18), dp(2), dp(8));
        page.addView(title);
    }

    private TextView pill(String value, int accent) {
        TextView view = text(value == null || value.isEmpty() ? "—" : value, 10, accent, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(8), dp(5), dp(8), dp(5));
        view.setBackground(rounded(SURFACE_ALT, 11, accent, 1));
        return view;
    }

    private int darkAccent(int color) {
        return Color.rgb(Math.max(10, Color.red(color) / 3), Math.max(14, Color.green(color) / 3), Math.max(20, Color.blue(color) / 3));
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

    private Button secondary(String label) {
        Button button = primary(label, SURFACE_ALT);
        button.setTextColor(TEXT);
        button.setBackground(rounded(SURFACE_ALT, 13, BORDER, 1));
        return button;
    }

    private LinearLayout.LayoutParams fullButtonLp() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
    }

    private LinearLayout.LayoutParams weightedButton(boolean margin) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(46), 1f);
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
