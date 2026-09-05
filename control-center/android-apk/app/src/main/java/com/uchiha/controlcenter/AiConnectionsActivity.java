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
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(143, 158, 180);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);

    private AuthSession session;
    private JSONArray projects = new JSONArray();
    private JSONObject selectedProject;
    private String selectedMode = "inspect";
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
        render();
        loadProjects();
    }

    private void render() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setPadding(dp(16), dp(12), dp(16), dp(28));
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = secondary("رجوع");
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(74), dp(44)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(text("UCHIHA AI", 22, TEXT, true));
        titles.addView(text("Task Engine · alpha17", 11, MUTED, false));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(12), 0, dp(12), 0);
        header.addView(titles, titleLp);
        page.addView(header);

        LinearLayout guard = card();
        guard.addView(text("مسار محمي", 14, GREEN, true));
        TextView flow = text("Explain / Inspect / Refactor Proposal  →  Diff  →  Preview  →  Owner Approval", 12, TEXT, true);
        flow.setPadding(0, dp(7), 0, dp(5));
        guard.addView(flow);
        guard.addView(text("لا يوجد أي مسار يسمح للذكاء الاصطناعي بالكتابة مباشرة إلى Production.", 11, MUTED, false));
        addCard(page, guard, 16);

        LinearLayout bridge = card();
        bridge.addView(text("AI Account Bridge", 14, VIOLET, true));
        bridge.addView(text("المهام الجديدة تُنشأ بوضع account bridge. ربط ChatGPT / Claude / Gemini بالحساب الرسمي سيكون طبقة مستقلة، بينما API يبقى خيارًا متقدمًا احتياطيًا فقط.", 11, MUTED, false));
        addCard(page, bridge, 10);

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

        sectionTitle(page, "ماذا تريد من AI؟");
        instructionInput = new EditText(this);
        instructionInput.setTextColor(TEXT);
        instructionInput.setHintTextColor(MUTED);
        instructionInput.setHint("مثال: افحص شاشة المشاريع واقترح تبسيط الواجهة بدون تعديل Production.");
        instructionInput.setTextSize(14);
        instructionInput.setGravity(Gravity.TOP | Gravity.START);
        instructionInput.setMinLines(4);
        instructionInput.setMaxLines(8);
        instructionInput.setPadding(dp(14), dp(13), dp(14), dp(13));
        instructionInput.setBackground(rounded(SURFACE, 16, BORDER, 1));
        LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(128));
        page.addView(instructionInput, inputLp);

        submitButton = primary("إنشاء مهمة آمنة", VIOLET);
        submitButton.setOnClickListener(v -> createTask());
        LinearLayout.LayoutParams submitLp = fullButtonLp();
        submitLp.setMargins(0, dp(10), 0, 0);
        page.addView(submitButton, submitLp);

        stateView = text("جارٍ تهيئة AI Task Engine…", 11, MUTED, false);
        stateView.setPadding(dp(2), dp(14), dp(2), dp(6));
        page.addView(stateView);

        sectionTitle(page, "آخر المهام");
        taskList = new LinearLayout(this);
        taskList.setOrientation(LinearLayout.VERTICAL);
        page.addView(taskList, matchWrap());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page);
        setContentView(scroll);
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
        styleMode(explainButton, "explain".equals(selectedMode));
        styleMode(inspectButton, "inspect".equals(selectedMode));
        styleMode(refactorButton, "refactor_proposal".equals(selectedMode));
    }

    private void styleMode(Button button, boolean active) {
        if (button == null) return;
        button.setTextColor(active ? Color.WHITE : MUTED);
        button.setBackground(rounded(active ? Color.rgb(53, 74, 115) : SURFACE_ALT, 13, active ? BLUE : BORDER, 1));
    }

    private void loadProjects() {
        if (busy) return;
        busy = true;
        stateView.setText("تحميل المشاريع…");
        new Thread(() -> {
            try {
                JSONArray items = ApiClient.listProjects(session.token);
                runOnUiThread(() -> {
                    busy = false;
                    projects = items == null ? new JSONArray() : items;
                    projectButton.setEnabled(projects.length() > 0);
                    if (projects.length() > 0) {
                        selectedProject = projects.optJSONObject(0);
                        updateProjectButton();
                        loadTasks();
                    } else {
                        projectButton.setText("لا توجد مشاريع");
                        stateView.setText("لا توجد مشاريع متاحة لهذا الحساب.");
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    stateView.setText("تعذر تحميل المشاريع.");
                    Toast.makeText(this, "تعذر تحميل المشاريع.", Toast.LENGTH_SHORT).show();
                });
            }
        }, "uchiha-ai-projects").start();
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
        stateView.setText("إنشاء المهمة خلف Guard…");
        new Thread(() -> {
            try {
                JSONObject response = AiTaskApiClient.create(session.token, projectId, selectedMode, instruction);
                JSONObject task = response.optJSONObject("task");
                runOnUiThread(() -> {
                    busy = false;
                    setControlsEnabled(true);
                    instructionInput.setText("");
                    stateView.setText(task == null
                            ? "تم إنشاء المهمة."
                            : "تم إنشاء المهمة · " + stageLabel(task.optString("status", "")));
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
        stateView.setText("تحديث مهام AI…");
        new Thread(() -> {
            try {
                JSONObject response = AiTaskApiClient.list(session.token, projectId);
                JSONArray items = response.optJSONArray("items");
                runOnUiThread(() -> {
                    busy = false;
                    renderTasks(items == null ? new JSONArray() : items);
                    stateView.setText("AI Task Engine جاهز.");
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
            TextView empty = text("لا توجد مهام AI لهذا المشروع بعد.", 12, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(12), dp(24), dp(12), dp(24));
            taskList.addView(empty, matchWrap());
            return;
        }
        int shown = Math.min(items.length(), 12);
        for (int i = 0; i < shown; i++) {
            JSONObject task = items.optJSONObject(i);
            if (task == null) continue;
            LinearLayout card = card();
            LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(Gravity.CENTER_VERTICAL);
            top.addView(text(modeLabel(task.optString("mode", "")), 14, TEXT, true),
                    new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            TextView badge = text(stageLabel(task.optString("status", "")), 10, ORANGE, true);
            badge.setPadding(dp(9), dp(4), dp(9), dp(4));
            badge.setBackground(rounded(Color.rgb(48, 36, 20), 11, Color.rgb(91, 65, 29), 1));
            top.addView(badge);
            card.addView(top);
            TextView instruction = text(task.optString("instruction", ""), 12, MUTED, false);
            instruction.setMaxLines(3);
            instruction.setPadding(0, dp(8), 0, dp(8));
            card.addView(instruction);
            card.addView(text("Diff → Preview → Owner Approval", 11, GREEN, true));
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
        stateView.setText(message);
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private String modeLabel(String mode) {
        if ("explain".equals(mode)) return "Explain";
        if ("inspect".equals(mode)) return "Inspect";
        if ("refactor_proposal".equals(mode)) return "Refactor Proposal";
        return "AI Task";
    }

    private String stageLabel(String status) {
        if ("awaiting_account_bridge".equals(status)) return "بانتظار الحساب";
        if ("queued".equals(status)) return "قيد الانتظار";
        if ("ready".equals(status)) return "جاهز";
        return status == null || status.isEmpty() ? "محمي" : status;
    }

    private void setControlsEnabled(boolean enabled) {
        projectButton.setEnabled(enabled && projects.length() > 0);
        explainButton.setEnabled(enabled);
        inspectButton.setEnabled(enabled);
        refactorButton.setEnabled(enabled);
        instructionInput.setEnabled(enabled);
        submitButton.setEnabled(enabled);
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(15), dp(14), dp(15), dp(14));
        card.setBackground(rounded(SURFACE, 17, BORDER, 1));
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

    private Button primary(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
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
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
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
