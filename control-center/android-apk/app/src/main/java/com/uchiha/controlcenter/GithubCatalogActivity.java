package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public final class GithubCatalogActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int RED = Color.rgb(236, 91, 91);
    private static final int BORDER = Color.rgb(39, 54, 75);

    private AuthSession session;
    private LinearLayout body;
    private LinearLayout repoList;
    private EditText search;
    private JSONArray repositories = new JSONArray();
    private Set<String> importedSlugs = new HashSet<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        session = new SessionStore(this).load();
        if (session == null || !session.can("github.use")) {
            finish();
            return;
        }
        renderShell();
        loadCatalog();
    }

    private void renderShell() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setLayoutDirection(LinearLayout.LAYOUT_DIRECTION_RTL);
        page.setPadding(dp(16), dp(16), dp(16), dp(28));
        scroll.addView(page, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        Button back = secondary("الرئيسية");
        back.setOnClickListener(v -> finish());
        top.addView(back, new LinearLayout.LayoutParams(dp(92), dp(44)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setGravity(Gravity.END);
        TextView title = text("مشاريع GitHub", 24, TEXT, true);
        title.setGravity(Gravity.END);
        TextView sub = text("اعثر على المستودعات وأضفها مباشرة إلى UCHIHA", 12, MUTED, false);
        sub.setGravity(Gravity.END);
        titles.addView(title);
        titles.addView(sub);
        LinearLayout.LayoutParams titlesLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titlesLp.setMargins(dp(10), 0, dp(10), 0);
        top.addView(titles, titlesLp);
        page.addView(top);

        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams bodyLp = matchWrap();
        bodyLp.setMargins(0, dp(14), 0, 0);
        page.addView(body, bodyLp);

        setContentView(scroll);
    }

    private void loadCatalog() {
        body.removeAllViews();
        TextView loading = text("جاري مزامنة GitHub…", 13, MUTED, false);
        loading.setPadding(0, dp(18), 0, dp(18));
        body.addView(loading);

        new Thread(() -> {
            try {
                JSONObject status = ApiClient.githubStatus(session.token);
                if (!status.optBoolean("connected", false)) {
                    runOnUiThread(this::renderConnect);
                    return;
                }
                JSONArray repos = ApiClient.listGithubRepos(session.token);
                JSONArray projects = ApiClient.listProjects(session.token);
                Set<String> imported = new HashSet<>();
                for (int i = 0; i < projects.length(); i++) {
                    JSONObject p = projects.optJSONObject(i);
                    if (p != null) imported.add(p.optString("id", ""));
                }
                runOnUiThread(() -> {
                    repositories = repos;
                    importedSlugs = imported;
                    renderConnected();
                });
            } catch (Exception error) {
                runOnUiThread(() -> handleError(error, "تعذر تحميل مشاريع GitHub."));
            }
        }, "uchiha-github-catalog").start();
    }

    private void renderConnect() {
        body.removeAllViews();
        LinearLayout card = card();
        card.addView(text("ربط GitHub", 18, TEXT, true));
        card.addView(spacedText("أدخل GitHub Token مرة واحدة. يتم التحقق منه وحفظه مشفرًا على السيرفر ولا يظهر مجددًا في التطبيق.", 12, MUTED, false));

        EditText token = field("GitHub Token");
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        LinearLayout.LayoutParams tokenLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        tokenLp.setMargins(0, dp(12), 0, dp(10));
        card.addView(token, tokenLp);

        Button connect = primary("ربط GitHub", BLUE);
        card.addView(connect, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        connect.setOnClickListener(v -> {
            if (!session.can("team.manage")) {
                Toast.makeText(this, "ربط الحساب متاح للمالك فقط.", Toast.LENGTH_SHORT).show();
                return;
            }
            String value = token.getText().toString().trim();
            if (value.length() < 20) {
                Toast.makeText(this, "أدخل GitHub Token صالحًا.", Toast.LENGTH_SHORT).show();
                return;
            }
            connect.setEnabled(false);
            connect.setText("جاري الربط…");
            new Thread(() -> {
                try {
                    ApiClient.connectGithub(session.token, value);
                    runOnUiThread(() -> {
                        token.setText("");
                        Toast.makeText(this, "تم ربط GitHub ✅", Toast.LENGTH_SHORT).show();
                        loadCatalog();
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        connect.setEnabled(true);
                        connect.setText("ربط GitHub");
                        handleError(error, "تعذر ربط GitHub.");
                    });
                }
            }, "uchiha-github-catalog-connect").start();
        });
        body.addView(card);
    }

    private void renderConnected() {
        body.removeAllViews();

        search = field("بحث باسم المشروع أو المستودع");
        search.setInputType(InputType.TYPE_CLASS_TEXT);
        body.addView(search, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        TextView info = text(repositories.length() + " مستودع متاح", 12, MUTED, false);
        LinearLayout.LayoutParams infoLp = matchWrap();
        infoLp.setMargins(0, dp(10), 0, dp(8));
        body.addView(info, infoLp);

        repoList = new LinearLayout(this);
        repoList.setOrientation(LinearLayout.VERTICAL);
        body.addView(repoList, matchWrap());
        renderRepos("");

        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                renderRepos(s == null ? "" : s.toString());
            }
            @Override public void afterTextChanged(Editable s) {}
        });
    }

    private void renderRepos(String query) {
        if (repoList == null) return;
        repoList.removeAllViews();
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        int shown = 0;

        for (int i = 0; i < repositories.length(); i++) {
            JSONObject repo = repositories.optJSONObject(i);
            if (repo == null) continue;
            String name = repo.optString("name", "");
            String fullName = repo.optString("fullName", "");
            if (!q.isEmpty() && !name.toLowerCase(Locale.ROOT).contains(q)
                    && !fullName.toLowerCase(Locale.ROOT).contains(q)) continue;
            repoList.addView(repoRow(repo));
            shown++;
        }

        if (shown == 0) {
            TextView empty = text("لا توجد نتائج مطابقة.", 13, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, dp(28), 0, dp(28));
            repoList.addView(empty, matchWrap());
        }
    }

    private LinearLayout repoRow(JSONObject repo) {
        String name = repo.optString("name", "Repository");
        String fullName = repo.optString("fullName", name);
        String slug = slug(name);
        boolean imported = importedSlugs.contains(slug);
        boolean writable = false;
        JSONObject permissions = repo.optJSONObject("permissions");
        if (permissions != null) {
            writable = permissions.optBoolean("push", false) || permissions.optBoolean("admin", false);
        }
        boolean archived = repo.optBoolean("archived", false);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(10), dp(12), dp(10));
        row.setBackground(rounded(SURFACE, 17, BORDER, 1));
        LinearLayout.LayoutParams rowLp = matchWrap();
        rowLp.setMargins(0, 0, 0, dp(8));
        row.setLayoutParams(rowLp);

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.project_tile_icon);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        icon.setPadding(dp(4), dp(4), dp(4), dp(4));
        icon.setBackground(rounded(SURFACE_ALT, 15, BORDER, 1));
        row.addView(icon, new LinearLayout.LayoutParams(dp(58), dp(58)));

        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.setPadding(dp(10), 0, dp(10), 0);
        labels.addView(text(name, 15, TEXT, true));
        labels.addView(text(fullName, 11, MUTED, false));
        String state = imported ? "موجود ضمن المشاريع" : (repo.optBoolean("private", false) ? "Private" : "Public");
        labels.addView(text(state, 11, imported ? GREEN : MUTED, false));
        row.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button action = imported ? secondary("موجود") : primary("إضافة", BLUE);
        action.setEnabled(!imported && writable && !archived && session.can("team.manage"));
        if (!writable || archived) action.setText(archived ? "مؤرشف" : "قراءة");
        action.setOnClickListener(v -> importRepo(repo, action));
        row.addView(action, new LinearLayout.LayoutParams(dp(78), dp(44)));
        return row;
    }

    private void importRepo(JSONObject repo, Button button) {
        String fullName = repo.optString("fullName", "");
        if (fullName.isEmpty()) return;
        button.setEnabled(false);
        button.setText("…");
        new Thread(() -> {
            try {
                ApiClient.importGithubRepository(session.token, fullName);
                runOnUiThread(() -> {
                    Toast.makeText(this, "تمت إضافة المشروع إلى UCHIHA ✅", Toast.LENGTH_SHORT).show();
                    setResult(RESULT_OK);
                    loadCatalog();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    button.setEnabled(true);
                    button.setText("إضافة");
                    handleError(error, "تعذر إضافة المستودع إلى المشاريع.");
                });
            }
        }, "uchiha-github-import").start();
    }

    private String slug(String value) {
        String s = value == null ? "" : value.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9-]+", "-")
                .replaceAll("^-+|-+$", "");
        return s.length() > 49 ? s.substring(0, 49) : s;
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
            if (api.status == 403) fallback = "هذه العملية متاحة للمالك فقط.";
            if ("github_invalid_token".equals(api.code)) fallback = "GitHub Token غير صالح أو انتهت صلاحيته.";
            if ("github_repository_write_required".equals(api.code)) fallback = "المستودع لا يملك صلاحية كتابة.";
        }
        Toast.makeText(this, fallback, Toast.LENGTH_SHORT).show();
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
