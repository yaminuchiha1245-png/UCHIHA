package com.uchiha.controlcenter;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
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

public final class TeamActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(143, 158, 180);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int CYAN = Color.rgb(80, 205, 220);
    private static final int RED = Color.rgb(236, 91, 91);
    private static final int BORDER = Color.rgb(39, 54, 75);

    private AuthSession session;
    private LinearLayout list;
    private TextView countView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        session = new SessionStore(this).load();
        if (session == null || !session.can("team.manage")) {
            finish();
            return;
        }
        render();
        loadTeam();
    }

    private void render() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.addView(header(), matchWrap());

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        page.setPadding(dp(16), dp(10), dp(16), dp(24));

        LinearLayout overview = card();
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        UchihaIconView team = new UchihaIconView(this, UchihaIconView.TEAM, BLUE);
        top.addView(team, new LinearLayout.LayoutParams(dp(52), dp(52)));
        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(text("فريق UCHIHA", 18, TEXT, true));
        labels.addView(text("حساب مستقل لكل عضو وصلاحيات واضحة فقط.", 11, MUTED, false));
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, dp(10), 0);
        top.addView(labels, labelsLp);
        countView = pill("—", BLUE);
        top.addView(countView);
        overview.addView(top);
        page.addView(overview, matchWrap());

        Button add = primary("إضافة عضو", BLUE);
        add.setOnClickListener(v -> showCreateDialog());
        LinearLayout.LayoutParams addLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        addLp.setMargins(0, dp(12), 0, 0);
        page.addView(add, addLp);

        TextView section = text("الأعضاء", 15, TEXT, true);
        section.setPadding(dp(2), dp(20), dp(2), dp(5));
        page.addView(section);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        page.addView(list, matchWrap());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private LinearLayout header() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        bar.setPadding(dp(16), dp(9), dp(16), dp(9));
        bar.setBackgroundColor(BG);
        UchihaIconView mark = new UchihaIconView(this, UchihaIconView.TEAM, BLUE);
        bar.addView(mark, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(text("الفريق", 19, TEXT, true));
        labels.addView(text(session.displayName + " · Owner", 10, MUTED, false));
        LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelsLp.setMargins(dp(10), 0, dp(10), 0);
        bar.addView(labels, labelsLp);
        Button back = secondary("رجوع");
        back.setOnClickListener(v -> finish());
        bar.addView(back, new LinearLayout.LayoutParams(dp(72), dp(42)));
        return bar;
    }

    private void loadTeam() {
        list.removeAllViews();
        TextView loading = text("جاري تحميل الفريق…", 12, BLUE, false);
        loading.setPadding(0, dp(16), 0, dp(16));
        list.addView(loading);

        new Thread(() -> {
            try {
                JSONArray users = ApiClient.listTeam(session.token);
                runOnUiThread(() -> showUsers(users));
            } catch (Exception error) {
                runOnUiThread(() -> {
                    list.removeAllViews();
                    TextView message = text("تعذر تحميل الفريق. هذه الصفحة تحتاج اتصالًا بالإنترنت.", 12, RED, false);
                    message.setPadding(0, dp(16), 0, 0);
                    list.addView(message);
                });
            }
        }, "uchiha-team-load").start();
    }

    private void showUsers(JSONArray users) {
        list.removeAllViews();
        if (countView != null) countView.setText(users.length() + " عضو");
        if (users.length() == 0) {
            LinearLayout empty = card();
            TextView message = text("لا يوجد أعضاء آخرون في الفريق بعد.", 12, MUTED, false);
            message.setGravity(Gravity.CENTER);
            message.setPadding(0, dp(16), 0, dp(16));
            empty.addView(message);
            addCard(list, empty);
            return;
        }
        for (int i = 0; i < users.length(); i++) {
            JSONObject user = users.optJSONObject(i);
            if (user == null) continue;

            String displayName = user.optString("displayName", user.optString("username", "عضو"));
            String role = user.optString("role", "SUPPORT");
            boolean active = user.optBoolean("active", true);
            int accent = roleColor(role);

            LinearLayout card = card();
            LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(Gravity.CENTER_VERTICAL);
            top.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
            UchihaIconView avatar = new UchihaIconView(this, UchihaIconView.TEAM, accent);
            top.addView(avatar, new LinearLayout.LayoutParams(dp(46), dp(46)));
            LinearLayout labels = new LinearLayout(this);
            labels.setOrientation(LinearLayout.VERTICAL);
            labels.addView(text(displayName, 15, TEXT, true));
            labels.addView(text("@" + user.optString("username") + " · " + roleLabel(role), 11, MUTED, false));
            LinearLayout.LayoutParams labelsLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            labelsLp.setMargins(dp(9), 0, dp(9), 0);
            top.addView(labels, labelsLp);
            top.addView(pill(active ? "نشط" : "موقوف", active ? GREEN : RED));
            card.addView(top);
            addCard(list, card);
        }
    }

    private void showCreateDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(18), dp(8), dp(18), 0);
        form.setLayoutDirection(LinearLayout.LAYOUT_DIRECTION_RTL);

        EditText displayName = field("الاسم الظاهر");
        EditText username = field("اسم المستخدم");
        EditText password = field("كلمة المرور — 10 أحرف على الأقل");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        form.addView(displayName);
        form.addView(username);
        form.addView(password);

        Spinner role = new Spinner(this);
        String[] roles = {"DEVELOPER", "SUPPORT", "OWNER"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, roles);
        role.setAdapter(adapter);
        form.addView(role, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("إضافة عضو")
                .setView(form)
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("إضافة", null)
                .create();

        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String nameValue = displayName.getText().toString().trim();
            String userValue = username.getText().toString().trim();
            String passValue = password.getText().toString();
            String roleValue = String.valueOf(role.getSelectedItem());
            if (nameValue.isEmpty() || userValue.length() < 3 || passValue.length() < 10) {
                Toast.makeText(this, "أكمل البيانات بشكل صحيح.", Toast.LENGTH_SHORT).show();
                return;
            }

            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            new Thread(() -> {
                try {
                    ApiClient.createTeamUser(session.token, userValue, nameValue, passValue, roleValue);
                    runOnUiThread(() -> {
                        dialog.dismiss();
                        Toast.makeText(this, "تمت إضافة العضو.", Toast.LENGTH_SHORT).show();
                        loadTeam();
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        Toast.makeText(this, "تعذر إضافة العضو.", Toast.LENGTH_SHORT).show();
                    });
                }
            }, "uchiha-team-create").start();
        }));
        dialog.show();
    }

    private int roleColor(String role) {
        if ("OWNER".equals(role)) return VIOLET;
        if ("DEVELOPER".equals(role)) return BLUE;
        return CYAN;
    }

    private String roleLabel(String role) {
        if ("OWNER".equals(role)) return "Owner";
        if ("DEVELOPER".equals(role)) return "Developer";
        return "Support";
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.setBackground(rounded(SURFACE, 17, BORDER, 1));
        return card;
    }

    private void addCard(LinearLayout parent, View card) {
        LinearLayout.LayoutParams lp = matchWrap();
        lp.setMargins(0, dp(7), 0, 0);
        parent.addView(card, lp);
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setTextSize(14);
        input.setSingleLine(true);
        input.setPadding(dp(12), 0, dp(12), 0);
        input.setBackground(rounded(SURFACE_ALT, 13, BORDER, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        lp.setMargins(0, 0, 0, dp(9));
        input.setLayoutParams(lp);
        return input;
    }

    private Button primary(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
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

    private TextView pill(String value, int accent) {
        TextView view = text(value, 10, accent, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(8), dp(5), dp(8), dp(5));
        view.setBackground(rounded(SURFACE_ALT, 11, accent, 1));
        return view;
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
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
