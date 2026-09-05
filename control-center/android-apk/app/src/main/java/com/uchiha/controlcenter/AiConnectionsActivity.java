package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class AiConnectionsActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int SURFACE_ALT = Color.rgb(20, 31, 46);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final String CHATGPT_URL = "https://chatgpt.com/";
    private static final String PLUGINS_URL = "https://chatgpt.com/plugins";
    private static final String MCP_URL = "https://panel.uchiha-builder.com/mcp";

    private AuthSession session;

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
            Toast.makeText(this, "هذا الحساب لا يملك صلاحية AI.", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        render();
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
        header.addView(back, new LinearLayout.LayoutParams(dp(76), dp(44)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(text("ChatGPT × UCHIHA", 21, TEXT, true));
        titles.addView(text("استخدم حساب ChatGPT الشخصي بدل API key", 12, MUTED, false));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(12), 0, dp(12), 0);
        header.addView(titles, titleLp);
        page.addView(header);

        LinearLayout hero = card();
        LinearLayout.LayoutParams heroLp = matchWrap();
        heroLp.setMargins(0, dp(20), 0, 0);
        page.addView(hero, heroLp);

        TextView badge = text("الحساب الشخصي هو المسار الأساسي", 12, GREEN, true);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp(12), dp(7), dp(12), dp(7));
        badge.setBackground(rounded(Color.rgb(18, 48, 37), 13, Color.rgb(41, 112, 81), 1));
        hero.addView(badge, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text("ChatGPT يبقى مكان الذكاء والمحادثة", 19, TEXT, true);
        title.setPadding(0, dp(16), 0, dp(7));
        hero.addView(title);
        hero.addView(text("UCHIHA لا يحاول تحويل اشتراكك إلى API. بدل ذلك، ChatGPT يستخدم حسابك الحقيقي، وUCHIHA يظهر له أدوات المشاريع المسموح بها عبر MCP.", 13, MUTED, false));

        Button openChatGpt = primary("فتح ChatGPT", BLUE);
        openChatGpt.setOnClickListener(v -> openUrl(CHATGPT_URL));
        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        actionLp.setMargins(0, dp(18), 0, 0);
        hero.addView(openChatGpt, actionLp);

        Button openPlugins = secondary("ربط UCHIHA داخل ChatGPT");
        openPlugins.setOnClickListener(v -> openUrl(PLUGINS_URL));
        LinearLayout.LayoutParams secondLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        secondLp.setMargins(0, dp(9), 0, 0);
        hero.addView(openPlugins, secondLp);

        LinearLayout endpoint = card();
        LinearLayout.LayoutParams endpointLp = matchWrap();
        endpointLp.setMargins(0, dp(12), 0, 0);
        page.addView(endpoint, endpointLp);
        endpoint.addView(text("UCHIHA MCP", 16, VIOLET, true));
        TextView url = text(MCP_URL, 13, TEXT, false);
        url.setTextDirection(View.TEXT_DIRECTION_LTR);
        url.setGravity(Gravity.START);
        url.setPadding(0, dp(10), 0, dp(12));
        endpoint.addView(url);
        Button copy = secondary("نسخ رابط MCP");
        copy.setOnClickListener(v -> copyMcp());
        endpoint.addView(copy, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)));

        LinearLayout permissions = card();
        LinearLayout.LayoutParams permissionsLp = matchWrap();
        permissionsLp.setMargins(0, dp(12), 0, 0);
        page.addView(permissions, permissionsLp);
        permissions.addView(text("صلاحيات النسخة الأولى", 16, TEXT, true));
        TextView readOnly = text("قراءة المشاريع فقط", 14, GREEN, true);
        readOnly.setPadding(0, dp(10), 0, dp(3));
        permissions.addView(readOnly);
        permissions.addView(text("يسمح لـChatGPT بعرض قائمة مشاريع UCHIHA وحالة مشروع محدد. لا يوجد Deploy، لا تعديل Source، لا Terminal، ولا وصول إلى Secrets.", 12, MUTED, false));

        LinearLayout steps = card();
        LinearLayout.LayoutParams stepsLp = matchWrap();
        stepsLp.setMargins(0, dp(12), 0, 0);
        page.addView(steps, stepsLp);
        steps.addView(text("طريقة الربط", 16, TEXT, true));
        TextView how = text("1. افتح ChatGPT بحسابك الشخصي.\n2. افتح Plugins / Developer mode.\n3. أضف UCHIHA باستخدام رابط MCP أعلاه.\n4. عند ظهور صفحة UCHIHA، سجّل بحساب UCHIHA ووافق على قراءة المشاريع.\n5. بعد الربط اطلب من ChatGPT عرض مشاريع UCHIHA.", 13, MUTED, false);
        how.setPadding(0, dp(10), 0, 0);
        how.setLineSpacing(dp(3), 1.15f);
        steps.addView(how);

        TextView note = text("ملاحظة: كلمة مرور ChatGPT لا تدخل إلى UCHIHA نهائيًا. صفحة OAuth الخاصة بـUCHIHA تطلب حساب UCHIHA فقط لتحديد صلاحيات الأدوات.", 11, MUTED, false);
        note.setPadding(dp(4), dp(18), dp(4), 0);
        page.addView(note);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page);
        setContentView(scroll);
    }

    private void openUrl(String value) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(value)));
        } catch (Exception error) {
            Toast.makeText(this, "تعذر فتح الرابط على هذا الجهاز.", Toast.LENGTH_SHORT).show();
        }
    }

    private void copyMcp() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("UCHIHA MCP", MCP_URL));
        Toast.makeText(this, "تم نسخ رابط UCHIHA MCP.", Toast.LENGTH_SHORT).show();
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(17), dp(16), dp(17), dp(16));
        card.setBackground(rounded(SURFACE, 19, BORDER, 1));
        return card;
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
