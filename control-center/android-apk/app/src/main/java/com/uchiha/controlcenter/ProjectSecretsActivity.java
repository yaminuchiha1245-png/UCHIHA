package com.uchiha.controlcenter;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

public final class ProjectSecretsActivity extends Activity {
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
    private String projectId;
    private String projectName;
    private LinearLayout list;
    private EditText keyInput;
    private EditText valueInput;
    private Button saveButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        session = new SessionStore(this).load();
        projectId = getIntent().getStringExtra("project_id");
        projectName = getIntent().getStringExtra("project_name");
        if (session == null || !session.can("secrets.manage") || projectId == null || projectId.isEmpty()) {
            finish();
            return;
        }
        render();
        loadSecrets();
    }

    private void render() {
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
        TextView title = text("أسرار المشروع", 24, TEXT, true);
        title.setGravity(Gravity.END);
        TextView sub = text(projectName == null ? projectId : projectName, 13, MUTED, false);
        sub.setGravity(Gravity.END);
        titles.addView(title);
        titles.addView(sub);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(10), 0, dp(10), 0);
        top.addView(titles, titleLp);
        page.addView(top);

        LinearLayout note = card();
        note.addView(text("🔐 القيم لا تظهر بعد الحفظ", 16, GREEN, true));
        note.addView(spacedText("يمكنك إضافة أو استبدال مفاتيح البيئة من هنا بدل فتح Terminal. التطبيق يعرض أسماء المفاتيح فقط، ولا يعيد السر المخزن إلى الهاتف.", 12, MUTED, false));
        LinearLayout.LayoutParams noteLp = matchWrap();
        noteLp.setMargins(0, dp(14), 0, 0);
        page.addView(note, noteLp);

        LinearLayout form = card();
        LinearLayout.LayoutParams formLp = matchWrap();
        formLp.setMargins(0, dp(12), 0, 0);
        form.setLayoutParams(formLp);
        form.addView(text("إضافة / استبدال سر", 17, TEXT, true));

        keyInput = field("اسم المفتاح مثل BOT_TOKEN");
        keyInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        LinearLayout.LayoutParams keyLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        keyLp.setMargins(0, dp(12), 0, dp(10));
        form.addView(keyInput, keyLp);

        valueInput = field("القيمة السرية");
        valueInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        form.addView(valueInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        saveButton = primary("حفظ السر", BLUE);
        saveButton.setOnClickListener(v -> saveSecret());
        LinearLayout.LayoutParams saveLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        saveLp.setMargins(0, dp(10), 0, 0);
        form.addView(saveButton, saveLp);
        page.addView(form);

        TextView listTitle = text("المفاتيح المحفوظة", 19, TEXT, true);
        LinearLayout.LayoutParams listTitleLp = matchWrap();
        listTitleLp.setMargins(0, dp(18), 0, dp(8));
        page.addView(listTitle, listTitleLp);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        page.addView(list, matchWrap());

        setContentView(scroll);
    }

    private void loadSecrets() {
        list.removeAllViews();
        TextView loading = text("جاري تحميل المفاتيح…", 13, MUTED, false);
        loading.setPadding(0, dp(18), 0, dp(18));
        list.addView(loading);

        new Thread(() -> {
            try {
                JSONArray items = ApiClient.listProjectSecrets(session.token, projectId);
                runOnUiThread(() -> renderSecrets(items));
            } catch (Exception error) {
                runOnUiThread(() -> handleError(error, "تعذر تحميل أسرار المشروع."));
            }
        }, "uchiha-project-secrets").start();
    }

    private void renderSecrets(JSONArray items) {
        list.removeAllViews();
        if (items == null || items.length() == 0) {
            TextView empty = text("لا توجد مفاتيح محفوظة لهذا المشروع بعد.", 13, MUTED, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(8), dp(24), dp(8), dp(24));
            list.addView(empty, matchWrap());
            return;
        }

        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String key = item.optString("key", "");
            if (key.isEmpty()) continue;

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(14), dp(12), dp(14), dp(12));
            row.setBackground(rounded(SURFACE, 17, BORDER, 1));
            LinearLayout.LayoutParams rowLp = matchWrap();
            rowLp.setMargins(0, 0, 0, dp(8));
            row.setLayoutParams(rowLp);

            LinearLayout labels = new LinearLayout(this);
            labels.setOrientation(LinearLayout.VERTICAL);
            labels.addView(text(key, 15, TEXT, true));
            labels.addView(text("••••••••  محفوظ", 12, GREEN, false));
            row.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            Button replace = secondary("تغيير");
            replace.setOnClickListener(v -> {
                keyInput.setText(key);
                valueInput.setText("");
                valueInput.requestFocus();
            });
            row.addView(replace, new LinearLayout.LayoutParams(dp(76), dp(42)));

            Button remove = secondary("حذف");
            remove.setTextColor(RED);
            LinearLayout.LayoutParams removeLp = new LinearLayout.LayoutParams(dp(70), dp(42));
            removeLp.setMargins(dp(8), 0, 0, 0);
            row.addView(remove, removeLp);
            remove.setOnClickListener(v -> confirmDelete(key));

            list.addView(row);
        }
    }

    private void saveSecret() {
        String key = keyInput.getText().toString().trim();
        String value = valueInput.getText().toString();
        if (!key.matches("[A-Za-z_][A-Za-z0-9_]{0,79}")) {
            Toast.makeText(this, "اسم المفتاح غير صالح.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (value.isEmpty() || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            Toast.makeText(this, "أدخل قيمة سرية من سطر واحد.", Toast.LENGTH_SHORT).show();
            return;
        }

        saveButton.setEnabled(false);
        saveButton.setText("جاري الحفظ…");
        new Thread(() -> {
            try {
                ApiClient.putProjectSecret(session.token, projectId, key, value);
                runOnUiThread(() -> {
                    keyInput.setText("");
                    valueInput.setText("");
                    saveButton.setEnabled(true);
                    saveButton.setText("حفظ السر");
                    Toast.makeText(this, "تم حفظ السر بأمان ✅", Toast.LENGTH_SHORT).show();
                    loadSecrets();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    saveButton.setEnabled(true);
                    saveButton.setText("حفظ السر");
                    handleError(error, "تعذر حفظ السر.");
                });
            }
        }, "uchiha-project-secret-save").start();
    }

    private void confirmDelete(String key) {
        new AlertDialog.Builder(this)
                .setTitle("حذف " + key)
                .setMessage("سيتم حذف هذا السر من إعدادات المشروع.")
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("حذف", (dialog, which) -> deleteSecret(key))
                .show();
    }

    private void deleteSecret(String key) {
        new Thread(() -> {
            try {
                ApiClient.deleteProjectSecret(session.token, projectId, key);
                runOnUiThread(() -> {
                    Toast.makeText(this, "تم حذف المفتاح.", Toast.LENGTH_SHORT).show();
                    loadSecrets();
                });
            } catch (Exception error) {
                runOnUiThread(() -> handleError(error, "تعذر حذف المفتاح."));
            }
        }, "uchiha-project-secret-delete").start();
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
            if (api.status == 403) fallback = "إدارة الأسرار متاحة للمالك فقط.";
            if ("project_secret_value_invalid".equals(api.code)) fallback = "قيمة السر غير صالحة.";
            if ("project_secret_key_invalid".equals(api.code)) fallback = "اسم المفتاح غير صالح.";
        }
        list.removeAllViews();
        list.addView(spacedText(fallback, 13, MUTED, false));
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
