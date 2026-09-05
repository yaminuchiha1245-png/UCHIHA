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
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public final class DeployActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int GREEN = Color.rgb(58, 200, 132);

    private AuthSession session;
    private String projectId;
    private String projectName;
    private TextView stateView;
    private TextView detailView;
    private Button primaryButton;
    private Button refreshButton;
    private volatile int pollGeneration = 0;
    private volatile boolean pollingDeploy;
    private boolean busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        session = new SessionStore(this).load();
        projectId = getIntent().getStringExtra("project_id");
        projectName = getIntent().getStringExtra("project_name");
        if (session == null) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        if (!session.can("deploy.plan") || projectId == null || !projectId.matches("[a-zA-Z0-9._-]+")) {
            finish();
            return;
        }
        if (projectName == null || projectName.trim().isEmpty()) projectName = "Project";
        render();
        refreshState(true);
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
        titles.addView(text("🚀 " + projectName, 20, TEXT, true));
        titles.addView(text("Guarded Deploy", 11, MUTED, false));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(12), 0, dp(12), 0);
        header.addView(titles, titleLp);
        refreshButton = secondary("تحديث");
        refreshButton.setOnClickListener(v -> refreshState(false));
        header.addView(refreshButton, new LinearLayout.LayoutParams(dp(80), dp(44)));
        page.addView(header);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setBackground(rounded(SURFACE, 20, BORDER, 1));
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.setMargins(0, dp(18), 0, 0);
        page.addView(card, cardLp);

        stateView = text("🔄 فحص حالة النشر…", 17, TEXT, true);
        card.addView(stateView);
        detailView = text("UCHIHA يتحقق من الخطة والموافقة وحالة Executor.", 13, MUTED, false);
        detailView.setPadding(0, dp(10), 0, dp(4));
        card.addView(detailView);

        LinearLayout guard = new LinearLayout(this);
        guard.setOrientation(LinearLayout.VERTICAL);
        guard.setPadding(dp(15), dp(14), dp(15), dp(14));
        guard.setBackground(rounded(Color.rgb(35, 27, 17), 17, Color.rgb(91, 64, 28), 1));
        LinearLayout.LayoutParams guardLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        guardLp.setMargins(0, dp(14), 0, 0);
        page.addView(guard, guardLp);
        guard.addView(text("🛡️ Production محمي", 15, ORANGE, true));
        guard.addView(text("Dockerfile Executor • Health Check • Rollback\nالمطور يحضّر الخطة فقط، والمالك يوافق ثم يبدأ النشر بخطوة مستقلة.", 12, MUTED, false));

        primaryButton = action("إنشاء خطة نشر", ORANGE);
        primaryButton.setVisibility(View.GONE);
        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        actionLp.setMargins(0, dp(16), 0, 0);
        page.addView(primaryButton, actionLp);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(page);
        setContentView(scroll);
    }

    private void refreshState(boolean initial) {
        if (busy) return;
        stopDeployPolling();
        busy = true;
        setButtonsEnabled(false);
        if (!initial) stateView.setText("🔄 تحديث حالة النشر…");
        new Thread(() -> {
            try {
                JSONObject deploy = DeployApiClient.status(session.token, projectId);
                runOnUiThread(() -> {
                    busy = false;
                    renderState(deploy);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    showError(error);
                });
            }
        }, "uchiha-deploy-status").start();
    }

    private void renderState(JSONObject deploy) {
        if (deploy == null) {
            stopDeployPolling();
            stateView.setText("جاهز لإنشاء خطة النشر");
            detailView.setText("سيتم استخدام Repository والفرع المرتبطين بالمشروع. لن يبدأ Production في هذه الخطوة.");
            showPrimary("إنشاء خطة نشر", ORANGE, v -> createPlan());
            return;
        }
        String stage = deploy.optString("stage", "idle");
        String repository = deploy.optString("repository", "");
        String branch = deploy.optString("branch", "");
        String source = repository.isEmpty() ? "" : repository + (branch.isEmpty() ? "" : " · " + branch);

        if ("pending_approval".equals(stage)) {
            stopDeployPolling();
            stateView.setText("⏳ بانتظار موافقة المالك");
            detailView.setText(source + "\nالخطة موجودة، لكن Executor لا يملك إذن Production بعد.");
            if (session.can("deploy.approve")) {
                showPrimary("موافقة المالك", ORANGE, v -> approvePlan());
            } else {
                hidePrimary();
            }
            return;
        }
        if ("approved".equals(stage)) {
            stopDeployPolling();
            stateView.setText("✅ تمت الموافقة — جاهز للنشر");
            detailView.setText(source + "\nالموافقة محفوظة وغير مستهلكة. بدء النشر يحتاج ضغطًا مستقلًا من المالك.");
            if (session.can("deploy.approve")) {
                showPrimary("🚀 نشر الآن", GREEN, v -> confirmStart());
            } else {
                hidePrimary();
            }
            return;
        }
        if ("deploying".equals(stage)) {
            stateView.setText("🚀 جارٍ النشر والتحقق…");
            detailView.setText(source + "\nGuarded Executor يعمل الآن. Health Check وRollback جزء من التنفيذ تلقائيًا.");
            hidePrimary();
            pollDeploy();
            return;
        }
        if ("succeeded".equals(stage)) {
            stopDeployPolling();
            String revision = deploy.optString("revision", "");
            stateView.setText("✅ تم النشر بنجاح");
            detailView.setText((revision.isEmpty() ? source : source + "\nRevision: " + revision)
                    + "\nHealth Check اجتاز المسار المحمي، والموافقة السابقة استُهلكت.");
            showPrimary("إنشاء خطة نشر جديدة", ORANGE, v -> createPlan());
            return;
        }
        if ("failed".equals(stage)) {
            stopDeployPolling();
            String reason = deploy.optString("reason", "deployment_failed");
            boolean rollback = deploy.optBoolean("rollback", false);
            stateView.setText("⚠️ تعذر النشر بأمان");
            detailView.setText("سبب آمن: " + reason + (rollback ? "\nتم الحفاظ على النسخة السابقة عبر Rollback." : "\nراجع المشروع قبل إنشاء خطة جديدة."));
            showPrimary("إنشاء خطة جديدة", ORANGE, v -> createPlan());
            return;
        }
        stopDeployPolling();
        stateView.setText("حالة النشر غير معروفة");
        detailView.setText("اضغط تحديث لإعادة قراءة حالة Guarded Executor.");
        hidePrimary();
    }

    private void createPlan() {
        runAction("إنشاء خطة النشر…", () -> DeployApiClient.plan(session.token, projectId));
    }

    private void approvePlan() {
        if (!session.can("deploy.approve")) return;
        runAction("تسجيل موافقة المالك…", () -> DeployApiClient.approve(session.token, projectId));
    }

    private void confirmStart() {
        if (!session.can("deploy.approve")) return;
        new AlertDialog.Builder(this)
                .setTitle("بدء Production Deploy؟")
                .setMessage("سيبدأ Guarded Executor الفعلي. سيتم فحص manifest وHealth Check، وسيحاول Rollback تلقائيًا إذا فشل الإصدار الجديد.")
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("نشر الآن", (dialog, which) -> startDeploy())
                .show();
    }

    private void startDeploy() {
        runAction("إرسال أمر النشر المحمي…", () -> DeployApiClient.start(session.token, projectId));
    }

    private interface JsonAction { JSONObject run() throws Exception; }

    private void runAction(String label, JsonAction action) {
        if (busy) return;
        stopDeployPolling();
        busy = true;
        stateView.setText("🔄 " + label);
        setButtonsEnabled(false);
        new Thread(() -> {
            try {
                JSONObject result = action.run();
                runOnUiThread(() -> {
                    busy = false;
                    renderState(result);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    busy = false;
                    showError(error);
                });
            }
        }, "uchiha-deploy-action").start();
    }

    private void pollDeploy() {
        if (pollingDeploy) return;
        pollingDeploy = true;
        final int generation = ++pollGeneration;
        new Thread(() -> {
            for (int i = 0; i < 60 && generation == pollGeneration; i++) {
                try {
                    if (i > 0) Thread.sleep(2500L);
                    JSONObject deploy = DeployApiClient.status(session.token, projectId);
                    if (generation != pollGeneration || deploy == null) return;
                    String stage = deploy.optString("stage", "");
                    if (!"deploying".equals(stage)) {
                        runOnUiThread(() -> {
                            pollingDeploy = false;
                            renderState(deploy);
                        });
                        return;
                    }
                    if (i > 0) {
                        runOnUiThread(() -> {
                            stateView.setText("🚀 جارٍ النشر والتحقق…");
                            detailView.setText("Guarded Executor يعمل الآن. يتم تحديث الحالة تلقائيًا دون إنشاء Poller إضافي.");
                        });
                    }
                } catch (InterruptedException ignored) {
                    pollingDeploy = false;
                    return;
                } catch (Exception error) {
                    if (generation == pollGeneration) {
                        runOnUiThread(() -> {
                            pollingDeploy = false;
                            showError(error);
                        });
                    }
                    return;
                }
            }
            if (generation == pollGeneration) {
                runOnUiThread(() -> {
                    pollingDeploy = false;
                    stateView.setText("⏳ النشر ما زال يعمل");
                    detailView.setText("يمكنك مغادرة الشاشة والعودة لاحقًا؛ التنفيذ يعمل على GitHub Actions/SSH وليس داخل الهاتف.");
                });
            }
        }, "uchiha-deploy-poll").start();
    }

    private void stopDeployPolling() {
        pollingDeploy = false;
        pollGeneration += 1;
    }

    private void showError(Exception error) {
        stopDeployPolling();
        setButtonsEnabled(true);
        String message = "تعذر إكمال عملية النشر.";
        if (error instanceof DeployApiClient.DeployException) {
            DeployApiClient.DeployException api = (DeployApiClient.DeployException) error;
            if ("deploy_github_not_linked".equals(api.code)) message = "اربط GitHub بالمشروع أولًا.";
            else if ("deploy_repository_owner_mismatch".equals(api.code)) message = "Repository غير مسموح به لهذا Guarded Executor.";
            else if ("deploy_approval_not_pending".equals(api.code)) message = "لا توجد موافقة معلقة لهذا المشروع.";
            else if ("deploy_owner_approval_required".equals(api.code)) message = "موافقة المالك مطلوبة قبل بدء Production.";
            else if ("deploy_github_owner_required".equals(api.code)) message = "اتصال GitHub الحالي لا يطابق مالك Executor.";
            else if (api.status == 401) message = "انتهت الجلسة أو اتصال GitHub غير صالح.";
        }
        stateView.setText("⚠️ العملية لم تكتمل");
        detailView.setText(message + "\nلم يتم تجاوز بوابة Production.");
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void showPrimary(String label, int color, View.OnClickListener listener) {
        primaryButton.setVisibility(View.VISIBLE);
        primaryButton.setText(label);
        primaryButton.setEnabled(true);
        primaryButton.setBackground(rounded(color, 14, color, 0));
        primaryButton.setOnClickListener(listener);
        refreshButton.setEnabled(true);
    }

    private void hidePrimary() {
        primaryButton.setVisibility(View.GONE);
        refreshButton.setEnabled(true);
    }

    private void setButtonsEnabled(boolean enabled) {
        if (primaryButton != null) primaryButton.setEnabled(enabled);
        if (refreshButton != null) refreshButton.setEnabled(enabled);
    }

    @Override
    protected void onDestroy() {
        stopDeployPolling();
        super.onDestroy();
    }

    private Button secondary(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(12);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(SURFACE, 13, BORDER, 1));
        return button;
    }

    private Button action(String label, int color) {
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
        return view;
    }

    private GradientDrawable rounded(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(strokeDp), strokeColor);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
