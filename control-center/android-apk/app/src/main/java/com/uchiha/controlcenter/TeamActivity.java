package com.uchiha.controlcenter;

import android.app.Activity;
import android.app.AlertDialog;
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

public final class TeamActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int BORDER = Color.rgb(39, 54, 75);

    private AuthSession session;
    private LinearLayout list;

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

        TextView title = text("👥 الفريق", 24, TEXT, true);
        page.addView(title);
        TextView subtitle = text("حساب مستقل لكل عضو بثلاث صلاحيات واضحة فقط.", 13, MUTED, false);
        LinearLayout.LayoutParams subLp = matchWrap();
        subLp.setMargins(0, dp(4), 0, dp(14));
        page.addView(subtitle, subLp);

        Button add = button("＋ إضافة عضو", BLUE);
        add.setOnClickListener(v -> showCreateDialog());
        page.addView(add, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams listLp = matchWrap();
        listLp.setMargins(0, dp(10), 0, 0);
        page.addView(list, listLp);

        setContentView(scroll);
    }

    private void loadTeam() {
        list.removeAllViews();
        TextView loading = text("جاري تحميل الفريق…", 13, MUTED, false);
        loading.setPadding(0, dp(16), 0, dp(16));
        list.addView(loading);

        new Thread(() -> {
            try {
                JSONArray users = ApiClient.listTeam(session.token);
                runOnUiThread(() -> showUsers(users));
            } catch (Exception error) {
                runOnUiThread(() -> {
                    list.removeAllViews();
                    TextView message = text("تعذر تحميل الفريق. هذه الصفحة تحتاج اتصالًا بالإنترنت.", 13, MUTED, false);
                    message.setPadding(0, dp(16), 0, 0);
                    list.addView(message);
                });
            }
        }, "uchiha-team-load").start();
    }

    private void showUsers(JSONArray users) {
        list.removeAllViews();
        for (int i = 0; i < users.length(); i++) {
            JSONObject user = users.optJSONObject(i);
            if (user == null) continue;

            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(13), dp(14), dp(13));
            card.setBackground(rounded(SURFACE, 17, BORDER, 1));
            LinearLayout.LayoutParams cardLp = matchWrap();
            cardLp.setMargins(0, dp(7), 0, 0);
            card.setLayoutParams(cardLp);

            String displayName = user.optString("displayName", user.optString("username", "عضو"));
            String role = user.optString("role", "SUPPORT");
            boolean active = user.optBoolean("active", true);
            TextView name = text(displayName + "  " + roleIcon(role), 16, TEXT, true);
            card.addView(name);
            TextView meta = text("@" + user.optString("username") + " · " + roleLabel(role)
                    + (active ? " · نشط" : " · موقوف"), 12, MUTED, false);
            LinearLayout.LayoutParams metaLp = matchWrap();
            metaLp.setMargins(0, dp(3), 0, 0);
            card.addView(meta, metaLp);
            list.addView(card);
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
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, roles);
        role.setAdapter(adapter);
        form.addView(role, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

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
                        Toast.makeText(this, "تمت إضافة العضو ✅", Toast.LENGTH_SHORT).show();
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

    private String roleIcon(String role) {
        if ("OWNER".equals(role)) return "👑";
        if ("DEVELOPER".equals(role)) return "💻";
        return "🛠";
    }

    private String roleLabel(String role) {
        if ("OWNER".equals(role)) return "Owner";
        if ("DEVELOPER".equals(role)) return "Developer";
        return "Support";
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setTextSize(14);
        input.setSingleLine(true);
        input.setPadding(dp(12), 0, dp(12), 0);
        input.setBackground(rounded(SURFACE, 13, BORDER, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        lp.setMargins(0, 0, 0, dp(9));
        input.setLayoutParams(lp);
        return input;
    }

    private Button button(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(color, 14, color, 0));
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
