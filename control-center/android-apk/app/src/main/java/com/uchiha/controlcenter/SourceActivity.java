package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.Intent;
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
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class SourceActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int BORDER = Color.rgb(39, 54, 75);

    private AuthSession session;
    private String projectId;
    private String projectName;
    private final List<SourceRow> rows = new ArrayList<>();
    private LinearLayout listContainer;
    private TextView statusView;
    private EditText searchField;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        session = new SessionStore(this).load();
        projectId = getIntent().getStringExtra("project_id");
        projectName = getIntent().getStringExtra("project_name");
        if (session == null || !session.can("github.use")) {
            finish();
            return;
        }
        if (projectId == null || !projectId.matches("[a-zA-Z0-9._-]+")) {
            Toast.makeText(this, "معرّف المشروع غير صالح.", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        if (projectName == null || projectName.trim().isEmpty()) projectName = "Project";

        renderListShell();
        loadTree();
    }

    private void renderListShell() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout page = page();
        page.setPadding(dp(16), dp(12), dp(16), dp(24));
        scroll.addView(page, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        page.addView(header("📄 Source", projectName));

        searchField = new EditText(this);
        searchField.setHint("بحث في الملفات…");
        searchField.setHintTextColor(MUTED);
        searchField.setTextColor(TEXT);
        searchField.setTextSize(14);
        searchField.setSingleLine(true);
        searchField.setPadding(dp(14), 0, dp(14), 0);
        searchField.setBackground(rounded(SURFACE, 14, BORDER, 1));
        LinearLayout.LayoutParams searchLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        searchLp.setMargins(0, dp(12), 0, dp(8));
        page.addView(searchField, searchLp);
        searchField.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                renderRows(s == null ? "" : s.toString());
            }
            @Override public void afterTextChanged(Editable s) {}
        });

        statusView = text("🔄 تحميل Source…", 11, MUTED, false);
        LinearLayout.LayoutParams statusLp = matchWrap();
        statusLp.setMargins(0, 0, 0, dp(4));
        page.addView(statusView, statusLp);

        listContainer = new LinearLayout(this);
        listContainer.setOrientation(LinearLayout.VERTICAL);
        page.addView(listContainer, matchWrap());

        TextView note = text("🔒 ملفات credentials و.env ومفاتيح التوقيع محجوبة. التعديل سيُفعّل فقط مع Diff/Review Gate.", 11, MUTED, false);
        LinearLayout.LayoutParams noteLp = matchWrap();
        noteLp.setMargins(0, dp(14), 0, 0);
        page.addView(note, noteLp);

        setContentView(scroll);
    }

    private void loadTree() {
        new Thread(() -> {
            try {
                JSONObject tree = ApiClient.sourceTree(session.token, projectId);
                JSONArray items = tree.optJSONArray("items");
                List<SourceRow> loaded = new ArrayList<>();
                if (items != null) {
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject row = items.optJSONObject(i);
                        if (row == null) continue;
                        String path = row.optString("path", "");
                        if (path.isEmpty()) continue;
                        loaded.add(new SourceRow(path, row.optLong("size", -1)));
                    }
                }
                boolean truncated = tree.optBoolean("truncated", false);
                runOnUiThread(() -> {
                    rows.clear();
                    rows.addAll(loaded);
                    statusView.setText((truncated ? "⚠️ عرض أول الملفات المسموحة · " : "✅ ")
                            + rows.size() + " ملف نصي");
                    renderRows(searchField == null ? "" : searchField.getText().toString());
                });
            } catch (Exception error) {
                runOnUiThread(() -> handleError(error, "تعذر تحميل Source."));
            }
        }, "uchiha-source-tree").start();
    }

    private void renderRows(String filter) {
        if (listContainer == null) return;
        listContainer.removeAllViews();
        String needle = filter == null ? "" : filter.trim().toLowerCase(Locale.ROOT);
        int shown = 0;
        for (SourceRow row : rows) {
            if (!needle.isEmpty() && !row.path.toLowerCase(Locale.ROOT).contains(needle)) continue;
            TextView file = text("📄  " + row.path + sizeSuffix(row.size), 13, TEXT, false);
            file.setGravity(Gravity.CENTER_VERTICAL);
            file.setPadding(dp(13), dp(11), dp(13), dp(11));
            file.setBackground(rounded(SURFACE, 14, BORDER, 1));
            file.setOnClickListener(v -> openFile(row.path));
            LinearLayout.LayoutParams lp = matchWrap();
            lp.setMargins(0, dp(5), 0, 0);
            listContainer.addView(file, lp);
            shown += 1;
            if (shown >= 300) break;
        }
        if (shown == 0) {
            TextView empty = text(rows.isEmpty() ? "لا توجد ملفات نصية متاحة." : "لا توجد نتائج للبحث.", 13, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, dp(30), 0, dp(30));
            listContainer.addView(empty, matchWrap());
        } else if (shown >= 300) {
            TextView limit = text("يتم عرض أول 300 نتيجة. استخدم البحث للوصول للملف بسرعة.", 11, MUTED, false);
            LinearLayout.LayoutParams lp = matchWrap();
            lp.setMargins(0, dp(8), 0, 0);
            listContainer.addView(limit, lp);
        }
    }

    private void openFile(String path) {
        statusView.setText("🔄 فتح " + path + "…");
        new Thread(() -> {
            try {
                JSONObject file = ApiClient.sourceFile(session.token, projectId, path);
                runOnUiThread(() -> renderFile(file));
            } catch (Exception error) {
                runOnUiThread(() -> handleError(error, "تعذر فتح الملف."));
            }
        }, "uchiha-source-file").start();
    }

    private void renderFile(JSONObject file) {
        final String filePath = file.optString("path", "file");
        final String content = file.optString("content", "");

        LinearLayout root = page();
        root.setPadding(dp(12), dp(10), dp(12), dp(12));
        root.addView(header("📄 " + shortName(filePath), filePath));

        TextView mode = text("Read-only · Diff/Review قبل أي تعديل", 11, MUTED, false);
        LinearLayout.LayoutParams modeLp = matchWrap();
        modeLp.setMargins(dp(4), dp(6), dp(4), dp(8));
        root.addView(mode, modeLp);

        ScrollView codeScroll = new ScrollView(this);
        codeScroll.setFillViewport(true);
        codeScroll.setBackground(rounded(Color.rgb(5, 9, 15), 16, BORDER, 1));
        TextView code = text(content, 12, Color.rgb(224, 232, 244), false);
        code.setTypeface(Typeface.MONOSPACE);
        code.setTextIsSelectable(true);
        code.setPadding(dp(14), dp(14), dp(14), dp(18));
        code.setHorizontallyScrolling(true);
        codeScroll.addView(code, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams codeLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(codeScroll, codeLp);

        Button back = secondary("رجوع للملفات");
        back.setOnClickListener(v -> renderListShellAndRestore());
        LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        backLp.setMargins(0, dp(10), 0, 0);
        root.addView(back, backLp);

        setContentView(root);
    }

    private void renderListShellAndRestore() {
        renderListShell();
        statusView.setText("✅ " + rows.size() + " ملف نصي");
        renderRows("");
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
            if ("source_github_not_linked".equals(api.code)) fallback = "اربط Repository بالمشروع أولًا.";
            if ("source_sensitive_blocked".equals(api.code)) fallback = "هذا الملف محجوب لحماية الأسرار.";
            if ("source_file_too_large".equals(api.code)) fallback = "الملف أكبر من حد Source Browser.";
        }
        if (statusView != null) statusView.setText("⚠️ " + fallback);
        Toast.makeText(this, fallback, Toast.LENGTH_SHORT).show();
    }

    private LinearLayout header(String titleValue, String subtitleValue) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        Button close = secondary("رجوع");
        close.setOnClickListener(v -> finish());
        bar.addView(close, new LinearLayout.LayoutParams(dp(72), dp(42)));

        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(text(titleValue, 18, TEXT, true));
        labels.addView(text(subtitleValue, 10, MUTED, false));
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, 0, 0);
        bar.addView(labels, labelsLp);
        return bar;
    }

    private LinearLayout page() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return page;
    }

    private Button secondary(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(12);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(SURFACE_ALT, 13, BORDER, 1));
        return button;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(sp);
        if (bold) view.setTypeface(null, Typeface.BOLD);
        return view;
    }

    private GradientDrawable rounded(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(strokeDp), strokeColor);
        return drawable;
    }

    private String shortName(String path) {
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    private String sizeSuffix(long size) {
        if (size < 0) return "";
        if (size < 1024) return "  ·  " + size + " B";
        return "  ·  " + Math.max(1, size / 1024) + " KB";
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class SourceRow {
        final String path;
        final long size;

        SourceRow(String path, long size) {
            this.path = path;
            this.size = size;
        }
    }
}
