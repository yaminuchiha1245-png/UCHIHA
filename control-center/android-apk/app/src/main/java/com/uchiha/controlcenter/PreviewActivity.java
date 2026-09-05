package com.uchiha.controlcenter;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

public final class PreviewActivity extends Activity {
    private static final int BG = Color.rgb(7, 12, 20);
    private static final int SURFACE = Color.rgb(14, 22, 34);
    private static final int TEXT = Color.rgb(244, 247, 252);
    private static final int MUTED = Color.rgb(153, 166, 185);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int BORDER = Color.rgb(42, 56, 76);
    private static final int MAX_PREVIEW_RESPONSE_BYTES = 2 * 1024 * 1024;

    private AuthSession session;
    private String projectId;
    private String projectName;
    private String previewPrefix;
    private String previewEntry;
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
        if (session == null || projectId == null || projectId.isEmpty()) {
            finish();
            return;
        }
        if (projectName == null || projectName.isEmpty()) projectName = "Project";

        try {
            previewPrefix = ApiClient.previewPrefixUrl(projectId);
            previewEntry = ApiClient.previewEntryUrl(projectId);
        } catch (Exception error) {
            finish();
            return;
        }

        renderLoading();
        checkPreview();
    }

    private void renderLoading() {
        LinearLayout page = page();
        page.addView(header());
        stateView = text("🔄 فحص Source Preview…", 14, MUTED, true);
        stateView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams stateLp = matchWrap();
        stateLp.setMargins(dp(18), dp(56), dp(18), 0);
        page.addView(stateView, stateLp);
        setContentView(page);
    }

    private void checkPreview() {
        new Thread(() -> {
            try {
                ApiClient.previewStatus(session.token, projectId);
                runOnUiThread(this::renderPreview);
            } catch (Exception error) {
                runOnUiThread(() -> renderUnavailable(error));
            }
        }, "uchiha-preview-status").start();
    }

    private void renderUnavailable(Exception error) {
        LinearLayout page = page();
        page.addView(header());

        String code = error instanceof ApiClient.ApiException
                ? ((ApiClient.ApiException) error).code : "preview_unavailable";
        String message;
        if ("preview_github_not_linked".equals(code) || "github_not_connected".equals(code)) {
            message = "🐙 اربط المشروع بمستودع GitHub أولًا حتى تتم معاينة Source.";
        } else if ("github_source_not_found".equals(code)) {
            message = "🧪 هذا المشروع لا يحتوي index.html جاهزًا. يحتاج Build Sandbox للمشاريع مثل React / Vite / Node، وهي المرحلة التالية من Preview Engine.";
        } else {
            message = "تعذر تجهيز Source Preview الآن.";
        }

        TextView title = text("👁️ Preview غير جاهز", 21, TEXT, true);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleLp = matchWrap();
        titleLp.setMargins(dp(18), dp(42), dp(18), dp(10));
        page.addView(title, titleLp);

        TextView detail = text(message, 14, MUTED, false);
        detail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailLp = matchWrap();
        detailLp.setMargins(dp(28), 0, dp(28), dp(22));
        page.addView(detail, detailLp);

        if (session.can("github.use")) {
            Button github = secondary("🐙 فتح GitHub");
            github.setOnClickListener(v -> {
                Intent intent = new Intent(this, GitHubActivity.class);
                intent.putExtra("project_id", projectId);
                intent.putExtra("project_name", projectName);
                startActivity(intent);
            });
            LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
            buttonLp.setMargins(dp(28), 0, dp(28), 0);
            page.addView(github, buttonLp);
        }
        setContentView(page);
    }

    private void renderPreview() {
        LinearLayout page = page();
        page.addView(header());

        TextView safe = text("🔒 Source Preview · معزول عن Production", 12, MUTED, true);
        safe.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams safeLp = matchWrap();
        safeLp.setMargins(dp(12), dp(4), dp(12), dp(8));
        page.addView(safe, safeLp);

        LinearLayout phone = new LinearLayout(this);
        phone.setOrientation(LinearLayout.VERTICAL);
        phone.setPadding(dp(7), dp(7), dp(7), dp(7));
        phone.setBackground(rounded(Color.rgb(5, 8, 14), 30, Color.rgb(70, 83, 104), 2));
        LinearLayout.LayoutParams phoneLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        phoneLp.setMargins(dp(15), 0, dp(15), dp(10));
        page.addView(phone, phoneLp);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        configureWebView(webView);
        phone.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(dp(15), 0, dp(15), dp(12));
        Button reload = secondary("↻ تحديث");
        reload.setOnClickListener(v -> loadEntry());
        controls.addView(reload, new LinearLayout.LayoutParams(0, dp(46), 1f));
        Button back = secondary("‹ داخل المشروع");
        back.setOnClickListener(v -> {
            if (webView != null && webView.canGoBack()) webView.goBack();
            else finish();
        });
        LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(0, dp(46), 1f);
        backLp.setMargins(dp(8), 0, 0, 0);
        controls.addView(back, backLp);
        page.addView(controls, matchWrap());

        setContentView(page);
        loadEntry();
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
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
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String target = mapPreviewUrl(uri);
                if (target == null) return blockedResponse();
                return fetchAuthorized(target);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                String mapped = mapPreviewUrl(request.getUrl());
                if (mapped == null) {
                    Toast.makeText(PreviewActivity.this, "تم حظر رابط خارج Preview.", Toast.LENGTH_SHORT).show();
                    return true;
                }
                if (!mapped.equals(request.getUrl().toString())) {
                    loadWithSession(mapped);
                    return true;
                }
                return false;
            }
        });
    }

    private String mapPreviewUrl(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return null;
        Uri base = Uri.parse(BuildConfig.API_BASE_URL);
        if (!safeEquals(base.getHost(), uri.getHost())) return null;
        int basePort = base.getPort() == -1 ? 443 : base.getPort();
        int uriPort = uri.getPort() == -1 ? 443 : uri.getPort();
        if (basePort != uriPort) return null;

        String raw = uri.toString();
        if (raw.startsWith(previewPrefix)) return raw;

        String path = uri.getEncodedPath();
        if (path == null || path.startsWith("/api/")) return null;
        String relative = path.replaceFirst("^/+", "");
        if (relative.isEmpty()) relative = "index.html";
        return previewPrefix + relative;
    }

    private WebResourceResponse fetchAuthorized(String target) {
        HttpsURLConnection connection = null;
        try {
            URL url = new URL(target);
            connection = (HttpsURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(20000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Authorization", "Bearer " + session.token);
            connection.setRequestProperty("Accept", "*/*");
            connection.setRequestProperty("User-Agent", "UCHIHA-Control-Center-Preview");

            int status = connection.getResponseCode();
            InputStream input = status >= 200 && status < 300
                    ? connection.getInputStream() : connection.getErrorStream();
            byte[] data = readLimited(input);
            String contentType = connection.getContentType();
            String mime = "text/plain";
            String charset = "utf-8";
            if (contentType != null && !contentType.isEmpty()) {
                String[] parts = contentType.split(";");
                mime = parts[0].trim();
                for (int i = 1; i < parts.length; i++) {
                    String part = parts[i].trim();
                    if (part.toLowerCase().startsWith("charset=")) charset = part.substring(8).trim();
                }
            }
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Referrer-Policy", "no-referrer");
            String reason = status >= 200 && status < 300 ? "OK" : "Preview Error";
            return new WebResourceResponse(
                    mime,
                    charset,
                    status,
                    reason,
                    headers,
                    new ByteArrayInputStream(data));
        } catch (Exception error) {
            return blockedResponse();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private byte[] readLimited(InputStream input) throws Exception {
        if (input == null) return new byte[0];
        try (InputStream stream = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_PREVIEW_RESPONSE_BYTES) throw new Exception("Preview response too large.");
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private WebResourceResponse blockedResponse() {
        byte[] body = "Blocked by UCHIHA Preview".getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(
                "text/plain",
                "utf-8",
                403,
                "Blocked",
                headers,
                new ByteArrayInputStream(body));
    }

    private void loadEntry() {
        loadWithSession(previewEntry);
    }

    private void loadWithSession(String url) {
        if (webView == null) return;
        Map<String, String> headers = new HashMap<>();
        headers.put("Authorization", "Bearer " + session.token);
        webView.loadUrl(url, headers);
    }

    private LinearLayout header() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(14), dp(10), dp(14), dp(8));
        Button close = secondary("رجوع");
        close.setOnClickListener(v -> finish());
        bar.addView(close, new LinearLayout.LayoutParams(dp(74), dp(42)));
        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        TextView title = text(projectName, 18, TEXT, true);
        TextView sub = text("👁️ Source Preview", 11, MUTED, false);
        labels.addView(title);
        labels.addView(sub);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(dp(10), 0, dp(10), 0);
        bar.addView(labels, lp);
        return bar;
    }

    private LinearLayout page() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);
        page.setLayoutDirection(LinearLayout.LAYOUT_DIRECTION_RTL);
        return page;
    }

    private Button secondary(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(13);
        button.setTypeface(null, Typeface.BOLD);
        button.setAllCaps(false);
        button.setBackground(rounded(SURFACE, 14, BORDER, 1));
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

    private boolean safeEquals(String a, String b) {
        return a != null && b != null && a.equalsIgnoreCase(b);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
