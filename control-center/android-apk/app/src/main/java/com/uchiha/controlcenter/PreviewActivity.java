package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

public final class PreviewActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final String PREVIEW_HOST = "preview.uchiha";
    private static final String PREVIEW_ORIGIN = "https://" + PREVIEW_HOST + "/";

    private AuthSession session;
    private String projectId;
    private String projectName;
    private WebView webView;
    private TextView stateView;

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
        if (projectId == null || !projectId.matches("[a-zA-Z0-9._-]+")) {
            Toast.makeText(this, "معرّف المشروع غير صالح.", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        if (projectName == null || projectName.trim().isEmpty()) projectName = "Project";

        render();
        loadEntry();
    }

    private void render() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(12), dp(8), dp(12), dp(12));
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);

        Button close = secondary("رجوع");
        close.setOnClickListener(v -> finish());
        top.addView(close, new LinearLayout.LayoutParams(dp(72), dp(42)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView name = text("👁️ " + projectName, 18, TEXT, true);
        stateView = text("Static Sandbox · JS Off · External Network Blocked", 10, MUTED, false);
        titles.addView(name);
        titles.addView(stateView);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(10), 0, dp(10), 0);
        top.addView(titles, titleLp);

        Button refresh = secondary("تحديث");
        refresh.setOnClickListener(v -> loadEntry());
        top.addView(refresh, new LinearLayout.LayoutParams(dp(76), dp(42)));
        root.addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        LinearLayout phone = new LinearLayout(this);
        phone.setOrientation(LinearLayout.VERTICAL);
        phone.setPadding(dp(7), dp(7), dp(7), dp(7));
        phone.setBackground(rounded(Color.rgb(5, 8, 14), 30, Color.rgb(70, 83, 104), 2));
        LinearLayout.LayoutParams phoneLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        phoneLp.setMargins(dp(10), dp(8), dp(10), 0);
        root.addView(phone, phoneLp);

        TextView deviceBar = text("UCHIHA PREVIEW  •  PHONE", 10, MUTED, true);
        deviceBar.setGravity(Gravity.CENTER);
        phone.addView(deviceBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(28)));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        configureWebView(webView);
        phone.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(false);
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(false);
        cookies.setAcceptThirdPartyCookies(view, false);

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                if (!isPreviewUri(request.getUrl())) {
                    runOnUiThread(() -> Toast.makeText(
                            PreviewActivity.this,
                            "تم حظر رابط خارج Preview.",
                            Toast.LENGTH_SHORT).show());
                    return true;
                }
                return false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isPreviewUri(uri)) return blockedResponse();
                String sourcePath = normalizePreviewPath(uri.getPath());
                if (sourcePath == null) return blockedResponse();
                try {
                    JSONObject source = ApiClient.previewSource(session.token, projectId, sourcePath);
                    String encoded = source.optString("contentBase64", "");
                    String mime = source.optString("mime", "application/octet-stream");
                    if (encoded.isEmpty()) return errorResponse("ملف المعاينة فارغ أو غير متاح.");
                    byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                    runOnUiThread(() -> {
                        if (stateView != null) stateView.setText(
                                "Static Sandbox · JS Off · External Network Blocked");
                    });
                    return new WebResourceResponse(
                            mime,
                            isTextMime(mime) ? "UTF-8" : null,
                            new ByteArrayInputStream(bytes));
                } catch (Exception error) {
                    runOnUiThread(() -> showPreviewError(error));
                    return errorResponse("تعذر تحميل ملف المعاينة: " + sourcePath);
                }
            }
        });
    }

    private void loadEntry() {
        if (webView == null) return;
        stateView.setText("🔄 تحميل Preview من GitHub المرتبط…");
        webView.loadUrl(PREVIEW_ORIGIN + "index.html");
    }

    private boolean isPreviewUri(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && PREVIEW_HOST.equalsIgnoreCase(uri.getHost());
    }

    private String normalizePreviewPath(String rawPath) {
        String path = rawPath == null ? "" : rawPath;
        while (path.startsWith("/")) path = path.substring(1);
        if (path.isEmpty()) path = "index.html";
        if (path.length() > 500 || path.contains("\\") || path.indexOf('\0') >= 0) return null;
        String[] parts = path.split("/");
        StringBuilder normalized = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return null;
            if (normalized.length() > 0) normalized.append('/');
            normalized.append(part);
        }
        return normalized.toString();
    }

    private WebResourceResponse blockedResponse() {
        return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse errorResponse(String message) {
        String safe = "<!doctype html><meta charset=\"utf-8\"><style>body{font-family:sans-serif;padding:24px;background:#fff;color:#222}h3{margin-top:0}</style><h3>UCHIHA Preview</h3><p>"
                + escapeHtml(message) + "</p>";
        return new WebResourceResponse(
                "text/html",
                "UTF-8",
                new ByteArrayInputStream(safe.getBytes(StandardCharsets.UTF_8)));
    }

    private void showPreviewError(Exception error) {
        if (stateView == null) return;
        if (error instanceof ApiClient.ApiException) {
            ApiClient.ApiException api = (ApiClient.ApiException) error;
            if ("preview_github_not_linked".equals(api.code) || "github_not_connected".equals(api.code)) {
                stateView.setText("⚠️ اربط GitHub بالمشروع أولًا");
                return;
            }
            if ("github_source_not_found".equals(api.code)) {
                stateView.setText("⚠️ لم يتم العثور على index.html أو الملف المطلوب");
                return;
            }
            if (api.status == 401) {
                stateView.setText("⚠️ انتهت الجلسة — سجّل الدخول من جديد");
                return;
            }
        }
        stateView.setText("⚠️ تعذر تحميل Preview");
    }

    private boolean isTextMime(String mime) {
        return mime != null && (mime.startsWith("text/")
                || mime.contains("json")
                || mime.contains("xml")
                || mime.contains("svg"));
    }

    private String escapeHtml(String value) {
        return String.valueOf(value)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.clearHistory();
            webView.clearCache(true);
            webView.loadUrl("about:blank");
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
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
