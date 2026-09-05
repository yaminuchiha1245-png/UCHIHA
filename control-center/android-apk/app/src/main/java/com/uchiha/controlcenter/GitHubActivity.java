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

public final class GitHubActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int RED = Color.rgb(236, 91, 91);
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
        if (session == null || !session.can("github.use") || projectId == null || projectId.isEmpty()) {
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
        page.setPadding(dp(16), dp(16), dp(16), dp(24));
        scroll.addView(page, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text("🐙 GitHub", 25, TEXT, true);
        page.addView(title);
        TextView sub = text(projectName == null ? "ربط المشروع بالمستودع" : projectName, 13, MUTED, false);
        LinearLayout.LayoutParams subLp = matchWrap();
        subLp.setMargins(0, dp(3), 0, dp(14));
        page.addView(sub, subLp);

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        page.addView(content, matchWrap());
        setContentView(scroll);
    }

    private void loadState() {
        content.removeAllViews();
        TextView loading = text("🔄 جاري التحقق من GitHub…", 13, MUTED, false);
        loading.setPadding(0, dp(18), 0, dp(18));
        content.addView(loading);

        new Thread(() -> {
            try {
                JSONObject github = ApiClient.githubStatus(session.token);
                JSONObject projectStatus = ApiClient.projectGithubStatus(session.token, projectId);
                JSONArray repos = new JSONArray();
                if (github.optBoolean("connected", false) && session.can("team.manage")) {
                    repos = ApiClient.listGithubRepos(session.token);
                }
                JSONArray finalRepos = repos;
                runOnUiThread(() -> renderState(github, projectStatus, finalRepos));
            } catch (Exception error) {
                runOnUiThread(() -> handleError(error, "تعذر تحميل حالة GitHub."));
            }
        }, "uchiha-github-state").start();
    }

    private void renderState(JSONObject github, JSONObject projectStatus, JSONArray repos) {
        content.removeAllViews();
        boolean connected = github.optBoolean("connected", false);
        JSONObject account = github.optJSONObject("account");

        LinearLayout statusCard = card();
        statusCard.addView(text(connected ? "✅ GitHub متصل" : "غير متصل بـ GitHub", 18,
                connected ? GREEN : TEXT, true));
        if (connected && account != null) {
            String login = account.optString("login", "");
            if (!login.isEmpty()) {
                TextView accountView = text("@" + login, 13, MUTED, false);
                LinearLayout.LayoutParams lp = matchWrap();
                lp.setMargins(0, dp(4), 0, 0);
                statusCard.addView(accountView, lp);
            }
        }
        content.addView(statusCard);

        JSONObject binding = projectStatus.optJSONObject("binding");
        LinearLayout projectCard = card();
        LinearLayout.LayoutParams projectLp = matchWrap();
        projectLp.setMargins(0, dp(10), 0, 0);
        projectCard.setLayoutParams(projectLp);
        projectCard.addView(text("📦 مستودع المشروع", 17, TEXT, true));
        if (binding != null) {
            projectCard.addView(spacedText(binding.optString("repository", "—"), 14, TEXT, true));
            projectCard.addView(spacedText("Branch: " + binding.optString("branch", "—"), 12, MUTED, false));
        } else {
            projectCard.addView(spacedText("لم يتم ربط Repository بهذا المشروع بعد.", 13, MUTED, false));
        }
        content.addView(projectCard);

        if (connected && binding != null) {
            Button source = primary("📄 فتح Source", BLUE);
            source.setOnClickListener(v -> openSource());
            LinearLayout.LayoutParams sourceLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
            sourceLp.setMargins(0, dp(10), 0, 0);
            content.addView(source, sourceLp);
        }

        if (!session.can("team.manage")) {
            TextView note = text(connected
                            ? "يمكنك قراءة Source واستخدام GitHub حسب صلاحيتك. تغيير الربط متاح للـOwner فقط."
                            : "يجب أن يقوم الـOwner بربط GitHub أولًا.",
                    12, MUTED, false);
            LinearLayout.LayoutParams noteLp = matchWrap();
            noteLp.setMargins(0, dp(14), 0, 0);
            content.addView(note, noteLp);
            return;
        }

        if (!connected) {
            renderConnectForm();
            return;
        }

        renderRepoPicker(repos, binding);

        Button disconnect = secondary("فصل حساب GitHub");
        disconnect.setTextColor(RED);
        disconnect.setOnClickListener(v -> disconnectGithub(disconnect));
        LinearLayout.LayoutParams disLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        disLp.setMargins(0, dp(12), 0, 0);
        content.addView(disconnect, disLp);
    }

    private void openSource() {
        Intent intent = new Intent(this, SourceActivity.class);
        intent.putExtra("project_id", projectId);
        intent.putExtra("project_name", projectName == null ? "Project" : projectName);
        startActivity(intent);
    }

    private void renderConnectForm() {
        LinearLayout form = card();
        LinearLayout.LayoutParams formLp = matchWrap();
        formLp.setMargins(0, dp(10), 0, 0);
        form.setLayoutParams(formLp);
        form.addView(text("🔐 ربط GitHub", 17, TEXT, true));
        form.addView(spacedText("أدخل التوكن مرة واحدة. لن يظهر مرة أخرى داخل التطبيق.", 12, MUTED, false));

        EditText token = field("GitHub Token");
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        LinearLayout.LayoutParams tokenLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        tokenLp.setMargins(0, dp(12), 0, dp(10));
        form.addView(token, tokenLp);

        Button connect = primary("ربط GitHub", BLUE);
        connect.setOnClickListener(v -> {
            String value = token.getText().toString().trim();
            if (value.length() < 20) {
                Toast.makeText(this, "أدخل GitHub Token صالحًا.", Toast.LENGTH_SHORT).show();
                return;
            }
            connect.setEnabled(false);
            connect.setText("جاري التحقق…");
            new Thread(() -> {
                try {
                    ApiClient.connectGithub(session.token, value);
                    runOnUiThread(() -> {
                        token.setText("");
                        Toast.makeText(this, "تم ربط GitHub ✅", Toast.LENGTH_SHORT).show();
                        loadState();
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        connect.setEnabled(true);
                        connect.setText("ربط GitHub");
                        handleError(error, "تعذر ربط GitHub.");
                    });
                }
            }, "uchiha-github-connect").start();
        });
        form.addView(connect, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        content.addView(form);
    }

    private void renderRepoPicker(JSONArray repos, JSONObject binding) {
        LinearLayout picker = card();
        LinearLayout.LayoutParams pickerLp = matchWrap();
        pickerLp.setMargins(0, dp(10), 0, 0);
        picker.setLayoutParams(pickerLp);
        picker.addView(text("🔗 اختيار Repository", 17, TEXT, true));
        picker.addView(spacedText("نعتمد الـdefault branch تلقائيًا حتى لا نضيف إعدادات غير ضرورية.", 12, MUTED, false));

        List<String> repoNames = new ArrayList<>();
        int selectedIndex = 0;
        String current = binding == null ? "" : binding.optString("repository", "");
        for (int i = 0; i < repos.length(); i++) {
            JSONObject repo = repos.optJSONObject(i);
            if (repo == null || repo.optBoolean("archived", false)) continue;
            JSONObject permissions = repo.optJSONObject("permissions");
            boolean writable = permissions != null
                    && (permissions.optBoolean("push", false) || permissions.optBoolean("admin", false));
            if (!writable) continue;
            String fullName = repo.optString("fullName", "");
            if (fullName.isEmpty()) continue;
            if (fullName.equals(current)) selectedIndex = repoNames.size();
            repoNames.add(fullName);
        }

        if (repoNames.isEmpty()) {
            picker.addView(spacedText("لا توجد مستودعات قابلة للكتابة متاحة لهذا التوكن.", 13, MUTED, false));
            content.addView(picker);
            return;
        }

        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, repoNames);
        spinner.setAdapter(adapter);
        spinner.setSelection(Math.min(selectedIndex, repoNames.size() - 1));
        LinearLayout.LayoutParams spinnerLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(54));
        spinnerLp.setMargins(0, dp(10), 0, dp(10));
        picker.addView(spinner, spinnerLp);

        Button link = primary("ربط بالمشروع", BLUE);
        link.setOnClickListener(v -> {
            String repository = String.valueOf(spinner.getSelectedItem());
            link.setEnabled(false);
            link.setText("جاري الربط…");
            new Thread(() -> {
                try {
                    ApiClient.linkProjectGithub(session.token, projectId, repository);
                    runOnUiThread(() -> {
                        Toast.makeText(this, "تم ربط Repository بالمشروع ✅", Toast.LENGTH_SHORT).show();
                        loadState();
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        link.setEnabled(true);
                        link.setText("ربط بالمشروع");
                        handleError(error, "تعذر ربط Repository.");
                    });
                }
            }, "uchiha-github-project-link").start();
        });
        picker.addView(link, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        content.addView(picker);
    }

    private void disconnectGithub(Button button) {
        button.setEnabled(false);
        new Thread(() -> {
            try {
                ApiClient.disconnectGithub(session.token);
                runOnUiThread(() -> {
                    Toast.makeText(this, "تم فصل GitHub.", Toast.LENGTH_SHORT).show();
                    loadState();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    button.setEnabled(true);
                    handleError(error, "تعذر فصل GitHub.");
                });
            }
        }, "uchiha-github-disconnect").start();
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
            if ("github_invalid_token".equals(api.code)) fallback = "GitHub Token غير صالح أو انتهت صلاحيته.";
            if ("vault_not_configured".equals(api.code)) fallback = "Vault غير مهيأ على السيرفر بعد.";
            if ("github_repository_write_required".equals(api.code)) fallback = "المستودع يحتاج صلاحية كتابة.";
        }
        Toast.makeText(this, fallback, Toast.LENGTH_SHORT).show();
        if (content.getChildCount() == 1) {
            content.removeAllViews();
            content.addView(spacedText(fallback, 13, MUTED, false));
        }
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

    private Button secondary(String label) {
        Button button = primary(label, SURFACE_ALT);
        button.setBackground(rounded(SURFACE_ALT, 14, BORDER, 1));
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
        lp.setMargins(0, dp(6), 0, 0);
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
