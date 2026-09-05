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
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int BORDER = Color.rgb(39, 54, 75);
    private static final int MAX_EDIT_CHARS = 200 * 1024;
    private static final int MAX_DIFF_LINES = 3000;

    private AuthSession session;
    private String projectId;
    private String projectName;
    private final List<SourceRow> rows = new ArrayList<>();
    private LinearLayout listContainer;
    private TextView statusView;
    private EditText searchField;
    private String draftPath;
    private String draftOriginal;
    private String draftCurrent;

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

        page.addView(header("📄 Source", projectName, this::finish));

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

        TextView note = text("🔒 ملفات credentials و.env ومفاتيح التوقيع محجوبة. أي تعديل يبقى Draft محليًا حتى يمر عبر Diff/Review Gate.", 11, MUTED, false);
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
        if (statusView != null) statusView.setText("🔄 فتح " + path + "…");
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
        root.addView(header("📄 " + shortName(filePath), filePath, this::renderListShellAndRestore));

        TextView mode = text("Source الأصلي · Read-only", 11, MUTED, false);
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

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        Button edit = primary(content.length() <= MAX_EDIT_CHARS ? "✏️ إنشاء Draft" : "الملف كبير للتعديل", BLUE);
        edit.setEnabled(content.length() <= MAX_EDIT_CHARS);
        edit.setOnClickListener(v -> renderEditor(filePath, content, content));
        actions.addView(edit, new LinearLayout.LayoutParams(0, dp(48), 1f));
        Button back = secondary("رجوع");
        back.setOnClickListener(v -> renderListShellAndRestore());
        LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(0, dp(48), 1f);
        backLp.setMargins(dp(8), 0, 0, 0);
        actions.addView(back, backLp);
        LinearLayout.LayoutParams actionsLp = matchWrap();
        actionsLp.setMargins(0, dp(10), 0, 0);
        root.addView(actions, actionsLp);

        setContentView(root);
    }

    private void renderEditor(String filePath, String original, String draft) {
        draftPath = filePath;
        draftOriginal = original;
        draftCurrent = draft;

        LinearLayout root = page();
        root.setPadding(dp(12), dp(10), dp(12), dp(12));
        root.addView(header("✏️ Draft", filePath, () -> renderFileObject(filePath, original)));

        TextView warning = text("🧪 Draft محلي فقط — لن يتم إرسال أي شيء إلى GitHub.", 11, ORANGE, true);
        LinearLayout.LayoutParams warningLp = matchWrap();
        warningLp.setMargins(dp(4), dp(6), dp(4), dp(8));
        root.addView(warning, warningLp);

        EditText editor = new EditText(this);
        editor.setText(draft);
        editor.setTextColor(Color.rgb(224, 232, 244));
        editor.setHintTextColor(MUTED);
        editor.setTextSize(12);
        editor.setTypeface(Typeface.MONOSPACE);
        editor.setGravity(Gravity.TOP | Gravity.START);
        editor.setPadding(dp(14), dp(14), dp(14), dp(18));
        editor.setBackground(rounded(Color.rgb(5, 9, 15), 16, BORDER, 1));
        editor.setHorizontallyScrolling(true);
        LinearLayout.LayoutParams editorLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(editor, editorLp);

        Button review = primary("مراجعة Diff", GREEN);
        review.setOnClickListener(v -> {
            String value = editor.getText().toString();
            if (value.length() > MAX_EDIT_CHARS) {
                Toast.makeText(this, "Draft أكبر من الحد المسموح.", Toast.LENGTH_SHORT).show();
                return;
            }
            draftCurrent = value;
            renderDiff(filePath, original, value);
        });
        LinearLayout.LayoutParams reviewLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        reviewLp.setMargins(0, dp(10), 0, 0);
        root.addView(review, reviewLp);

        setContentView(root);
        editor.requestFocus();
        editor.setSelection(Math.min(editor.getText().length(), 0));
    }

    private void renderDiff(String filePath, String original, String draft) {
        DiffResult diff = buildDiff(original, draft);

        LinearLayout root = page();
        root.setPadding(dp(12), dp(10), dp(12), dp(12));
        root.addView(header("🔎 Diff", filePath, () -> renderEditor(filePath, original, draft)));

        TextView summary = text(diff.changed
                        ? "-" + diff.removed + " / +" + diff.added + " سطر · لم يُحفظ"
                        : "✅ لا توجد تغييرات",
                12, diff.changed ? ORANGE : GREEN, true);
        LinearLayout.LayoutParams summaryLp = matchWrap();
        summaryLp.setMargins(dp(4), dp(6), dp(4), dp(8));
        root.addView(summary, summaryLp);

        ScrollView diffScroll = new ScrollView(this);
        diffScroll.setFillViewport(true);
        diffScroll.setBackground(rounded(Color.rgb(5, 9, 15), 16, BORDER, 1));
        TextView diffText = text(diff.text, 12, Color.rgb(224, 232, 244), false);
        diffText.setTypeface(Typeface.MONOSPACE);
        diffText.setTextIsSelectable(true);
        diffText.setPadding(dp(14), dp(14), dp(14), dp(18));
        diffScroll.addView(diffText, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(diffScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        Button edit = primary("رجوع للتعديل", BLUE);
        edit.setOnClickListener(v -> renderEditor(filePath, original, draft));
        LinearLayout.LayoutParams editLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        editLp.setMargins(0, dp(10), 0, 0);
        root.addView(edit, editLp);

        TextView gate = text("🚫 لا يوجد Apply/Commit في هذا الإصدار. المرحلة التالية ستكتب فقط إلى Preview branch بعد Review Gate.", 11, MUTED, false);
        LinearLayout.LayoutParams gateLp = matchWrap();
        gateLp.setMargins(dp(4), dp(8), dp(4), 0);
        root.addView(gate, gateLp);

        setContentView(root);
    }

    private DiffResult buildDiff(String original, String draft) {
        String[] before = original.split("\\n", -1);
        String[] after = draft.split("\\n", -1);
        int prefix = 0;
        while (prefix < before.length && prefix < after.length && before[prefix].equals(after[prefix])) prefix++;
        if (prefix == before.length && prefix == after.length) {
            return new DiffResult(false, 0, 0, "لا توجد تغييرات.\n");
        }

        int suffix = 0;
        while (suffix < before.length - prefix && suffix < after.length - prefix
                && before[before.length - 1 - suffix].equals(after[after.length - 1 - suffix])) suffix++;

        int removed = Math.max(0, before.length - prefix - suffix);
        int added = Math.max(0, after.length - prefix - suffix);
        StringBuilder out = new StringBuilder();
        int contextStart = Math.max(0, prefix - 3);
        for (int i = contextStart; i < prefix; i++) appendDiffLine(out, "  ", before[i]);

        int emitted = 0;
        for (int i = prefix; i < before.length - suffix && emitted < MAX_DIFF_LINES; i++, emitted++) {
            appendDiffLine(out, "- ", before[i]);
        }
        for (int i = prefix; i < after.length - suffix && emitted < MAX_DIFF_LINES; i++, emitted++) {
            appendDiffLine(out, "+ ", after[i]);
        }
        int afterSuffixStart = after.length - suffix;
        for (int i = afterSuffixStart; i < Math.min(after.length, afterSuffixStart + 3); i++) {
            appendDiffLine(out, "  ", after[i]);
        }
        if (emitted >= MAX_DIFF_LINES) out.append("… Diff طويل وتم اختصاره للعرض …\n");
        return new DiffResult(true, removed, added, out.toString());
    }

    private void appendDiffLine(StringBuilder out, String prefix, String line) {
        out.append(prefix).append(line).append('\n');
    }

    private void renderFileObject(String filePath, String content) {
        try {
            JSONObject file = new JSONObject();
            file.put("path", filePath);
            file.put("content", content);
            renderFile(file);
        } catch (Exception ignored) {
            renderListShellAndRestore();
        }
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

    private LinearLayout header(String titleValue, String subtitleValue, Runnable backAction) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        Button close = secondary("رجوع");
        close.setOnClickListener(v -> backAction.run());
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

    private Button primary(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(color, 13, color, 0));
        return button;
    }

    private Button secondary(String label) {
        Button button = primary(label, SURFACE_ALT);
        button.setTextColor(TEXT);
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

    private static final class DiffResult {
        final boolean changed;
        final int removed;
        final int added;
        final String text;

        DiffResult(boolean changed, int removed, int added, String text) {
            this.changed = changed;
            this.removed = removed;
            this.added = added;
            this.text = text;
        }
    }
}
