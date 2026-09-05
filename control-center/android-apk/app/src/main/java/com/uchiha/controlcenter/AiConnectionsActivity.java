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
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int RED = Color.rgb(236, 91, 91);

    private AuthSession session;
    private LinearLayout providerList;
    private TextView stateView;
    private Button refreshButton;
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
        refreshProviders();
    }

    private void render() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setPadding(dp(16), dp(12), dp(16), dp(24));
        page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = secondary("رجوع");
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(76), dp(44)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(text("🤖 اتصالات AI", 20, TEXT, true));
        titles.addView(text(session.can("team.manage") ? "الربط محمي داخل Vault" : "المزودات المتاحة للفريق", 11, MUTED, false));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(12), 0, dp(12), 0);
        header.addView(titles, titleLp);

        refreshButton = secondary("تحديث");
        refreshButton.setOnClickListener(v -> refreshProviders());
        header.addView(refreshButton, new LinearLayout.LayoutParams(dp(80), dp(44)));
        page.addView(header);

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(16), dp(14), dp(16), dp(14));
        info.setBackground(rounded(Color.rgb(22, 28, 43), 17, BORDER, 1));
        LinearLayout.LayoutParams infoLp = matchWrap();
        infoLp.setMargins(0, dp(18), 0, 0);
        page.addView(info, infoLp);
        info.addView(text("🔐 المفتاح لا يبقى على الهاتف", 14, VIOLET, true));
        info.addView(text("UCHIHA يختبر المفتاح مع API الرسمي أولًا، ثم يخزنه مشفرًا على السيرفر. بعد الحفظ لا يعرض قيمة المفتاح مجددًا.", 12, MUTED, false));

        stateView = text("🔄 قراءة الاتصالات…", 12, MUTED, false);
        stateView.setPadding(dp(2), dp(16), dp(2), dp(8));
        page.addView(stateView);

        providerList = new LinearLayout(this);
        providerList.setOrientation(LinearLayout.VERTICAL);
        page.addView(providerList, matchWrap());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        scroll.addView(page);
        setContentView(scroll);
    }

    private void refreshProviders() {
        if (busy) return;
        busy = true;
        refreshButton.setEnabled(false);
        stateView.setText("🔄 تحديث حالة المزودات…");
        new Thread(() -> {
            try {
                JSONObject response = AiConnectionsApiClient.providers(session.token);
                JSONArray items = response.optJSONArray("items");
                runOnUiThread(() -> {
                    busy = false;
                    refreshButton.setEnabled(true);
                    renderProviders(items == null ? new JSONArray() : items);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    refreshButton.setEnabled(true);
                    showError(error);
                });
            }
        }, "uchiha-ai-providers").start();
    }

    private void renderProviders(JSONArray items) {
        providerList.removeAllViews();
        int connected = 0;
        for (int i = 0; i < items.length(); i++) {
            JSONObject provider = items.optJSONObject(i);
            if (provider == null) continue;
            if (provider.optBoolean("connected", false)) connected += 1;
            providerList.addView(providerCard(provider));
        }
        stateView.setText(connected == 0
                ? "لا يوجد مزود AI مربوط حتى الآن."
                : "✅ " + connected + " مزود متصل ومتاح حسب صلاحية الحساب.");
    }

    private View providerCard(JSONObject provider) {
        String id = provider.optString("id", "");
        String label = provider.optString("label", providerName(id));
        boolean connected = provider.optBoolean("connected", false);
        int modelCount = provider.optInt("modelCount", -1);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(15), dp(16), dp(15));
        card.setBackground(rounded(SURFACE, 18, BORDER, 1));
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(0, dp(7), 0, 0);
        card.setLayoutParams(cardLp);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView name = text(label, 16, TEXT, true);
        top.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView badge = text(connected ? "متصل" : "غير مربوط", 11, connected ? GREEN : MUTED, true);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp(10), dp(5), dp(10), dp(5));
        badge.setBackground(rounded(connected ? Color.rgb(18, 48, 37) : SURFACE_ALT, 12, connected ? Color.rgb(41, 112, 81) : BORDER, 1));
        top.addView(badge);
        card.addView(top);

        String detail = connected
                ? (modelCount >= 0 ? modelCount + " نموذج تم اكتشافه عند آخر تحقق." : "تم التحقق من الاتصال رسميًا.")
                : (session.can("team.manage") ? "اربط API key رسميًا ليصبح المزود متاحًا للفريق." : "المالك لم يربط هذا المزود بعد.");
        TextView detailView = text(detail, 12, MUTED, false);
        detailView.setPadding(0, dp(8), 0, dp(12));
        card.addView(detailView);

        if (connected || session.can("team.manage")) {
            Button action = secondary(connected ? (session.can("team.manage") ? "إدارة" : "عرض النماذج") : "ربط");
            action.setOnClickListener(v -> {
                if (!connected) showKeyDialog(id, label);
                else if (session.can("team.manage")) showManageDialog(id, label);
                else showModels(id, label);
            });
            card.addView(action, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)));
        }
        return card;
    }

    private void showKeyDialog(String provider, String label) {
        if (!session.can("team.manage") || busy) return;
        EditText keyInput = new EditText(this);
        keyInput.setSingleLine(true);
        keyInput.setHint("API key");
        keyInput.setTextColor(TEXT);
        keyInput.setHintTextColor(MUTED);
        keyInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyInput.setPadding(dp(14), 0, dp(14), 0);
        keyInput.setBackground(rounded(SURFACE_ALT, 14, BORDER, 1));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(8), dp(20), 0);
        box.addView(text("سيتم اختبار المفتاح مع API الرسمي قبل حفظه. لن يتم عرضه بعد الربط.", 12, MUTED, false));
        LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        inputLp.setMargins(0, dp(12), 0, 0);
        box.addView(keyInput, inputLp);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("ربط " + label)
                .setView(box)
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("اختبار وربط", null)
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String key = keyInput.getText().toString().trim();
            if (key.length() < 8) {
                keyInput.setError("أدخل API key صالحًا.");
                return;
            }
            dialog.dismiss();
            connectProvider(provider, key);
            keyInput.setText("");
        }));
        dialog.show();
    }

    private void showManageDialog(String provider, String label) {
        if (busy) return;
        new AlertDialog.Builder(this)
                .setTitle(label)
                .setItems(new String[]{"عرض النماذج المتاحة", "استبدال API key", "فصل المزود"}, (dialog, which) -> {
                    if (which == 0) showModels(provider, label);
                    else if (which == 1) showKeyDialog(provider, label);
                    else confirmDisconnect(provider, label);
                })
                .show();
    }

    private void connectProvider(String provider, String apiKey) {
        if (busy || !session.can("team.manage")) return;
        busy = true;
        refreshButton.setEnabled(false);
        stateView.setText("🔄 اختبار " + providerName(provider) + " مع API الرسمي…");
        new Thread(() -> {
            try {
                AiConnectionsApiClient.connect(session.token, provider, apiKey);
                runOnUiThread(() -> {
                    busy = false;
                    Toast.makeText(this, "تم التحقق والربط بنجاح.", Toast.LENGTH_SHORT).show();
                    refreshProviders();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    refreshButton.setEnabled(true);
                    showError(error);
                });
            }
        }, "uchiha-ai-connect").start();
    }

    private void confirmDisconnect(String provider, String label) {
        if (!session.can("team.manage") || busy) return;
        new AlertDialog.Builder(this)
                .setTitle("فصل " + label + "؟")
                .setMessage("سيتم حذف المفتاح المشفر من Vault. لا يؤثر ذلك على حساب المزود نفسه.")
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("فصل", (dialog, which) -> disconnectProvider(provider))
                .show();
    }

    private void disconnectProvider(String provider) {
        if (busy || !session.can("team.manage")) return;
        busy = true;
        refreshButton.setEnabled(false);
        stateView.setText("🔄 فصل المزود…");
        new Thread(() -> {
            try {
                AiConnectionsApiClient.disconnect(session.token, provider);
                runOnUiThread(() -> {
                    busy = false;
                    Toast.makeText(this, "تم فصل المزود.", Toast.LENGTH_SHORT).show();
                    refreshProviders();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    refreshButton.setEnabled(true);
                    showError(error);
                });
            }
        }, "uchiha-ai-disconnect").start();
    }

    private void showModels(String provider, String label) {
        if (busy) return;
        busy = true;
        refreshButton.setEnabled(false);
        stateView.setText("🔄 قراءة النماذج المتاحة…");
        new Thread(() -> {
            try {
                JSONObject response = AiConnectionsApiClient.models(session.token, provider);
                JSONArray models = response.optJSONArray("models");
                String message = modelsText(models == null ? new JSONArray() : models);
                runOnUiThread(() -> {
                    busy = false;
                    refreshButton.setEnabled(true);
                    stateView.setText("✅ تم تحديث نماذج " + label);
                    new AlertDialog.Builder(this)
                            .setTitle(label + " · Models")
                            .setMessage(message)
                            .setPositiveButton("تم", null)
                            .show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    refreshButton.setEnabled(true);
                    showError(error);
                });
            }
        }, "uchiha-ai-models").start();
    }

    private String modelsText(JSONArray models) {
        if (models.length() == 0) return "لا توجد نماذج متاحة حاليًا.";
        StringBuilder out = new StringBuilder();
        int shown = Math.min(models.length(), 24);
        for (int i = 0; i < shown; i++) {
            JSONObject model = models.optJSONObject(i);
            if (model == null) continue;
            if (out.length() > 0) out.append('\n');
            out.append("• ").append(model.optString("name", model.optString("id", "Model")));
        }
        if (models.length() > shown) out.append("\n\n+").append(models.length() - shown).append(" نماذج أخرى");
        return out.toString();
    }

    private void showError(Exception error) {
        String message = "تعذر إكمال اتصال AI.";
        if (error instanceof AiConnectionsApiClient.AiException) {
            AiConnectionsApiClient.AiException api = (AiConnectionsApiClient.AiException) error;
            if ("ai_credentials_rejected".equals(api.code)) message = "المفتاح مرفوض من المزود الرسمي.";
            else if ("ai_provider_not_connected".equals(api.code)) message = "هذا المزود غير مربوط بعد.";
            else if ("ai_key_invalid".equals(api.code)) message = "صيغة API key غير صالحة.";
            else if ("vault_not_configured".equals(api.code)) message = "Vault غير مهيأ على السيرفر.";
            else if ("ai_provider_timeout".equals(api.code)) message = "انتهت مهلة الاتصال بالمزود.";
            else if (api.status == 401) message = "المفتاح مرفوض أو انتهت جلسة UCHIHA.";
        }
        stateView.setText("⚠️ " + message);
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private String providerName(String id) {
        if ("openai".equals(id)) return "OpenAI API";
        if ("anthropic".equals(id)) return "Anthropic API";
        if ("gemini".equals(id)) return "Gemini API";
        return "AI Provider";
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
        view.setLineSpacing(0f, 1.12f);
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
