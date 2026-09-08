package com.gamezone.admin;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final long LOAD_TIMEOUT_MS = 30000L;
    private static final long HEARTBEAT_INTERVAL_MS = 15000L;
    private static final long HEARTBEAT_TIMEOUT_MS = 8000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView webView;
    private ProgressBar loading;
    private LinearLayout errorPanel;
    private TextView errorDetail;
    private ValueCallback<Uri[]> fileCallback;
    private String startUrl;
    private String allowedHost;
    private String lastGoodUrl;
    private boolean mainFrameFailed = false;
    private boolean pageReady = false;
    private boolean resumed = false;
    private boolean recovering = false;
    private int heartbeatGeneration = 0;
    private Runnable loadTimeoutRunnable;
    private Runnable heartbeatRunnable;
    private Runnable heartbeatTimeoutRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(8, 11, 18));
        getWindow().setNavigationBarColor(Color.rgb(8, 11, 18));

        startUrl = getString(R.string.start_url);
        allowedHost = Uri.parse(startUrl).getHost();
        lastGoodUrl = startUrl;
        buildUi();

        boolean restored = false;
        if (savedInstanceState != null && webView != null) {
            try { restored = webView.restoreState(savedInstanceState) != null; } catch (Exception ignored) {}
        }
        if (!restored && webView != null) webView.loadUrl(startUrl);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(8, 11, 18));

        createAndAttachWebView();

        loading = new ProgressBar(this);
        FrameLayout.LayoutParams loadingParams = new FrameLayout.LayoutParams(dp(44), dp(44));
        loadingParams.gravity = Gravity.CENTER;
        root.addView(loading, loadingParams);

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(Color.rgb(8, 11, 18));
        errorPanel.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("تعذر فتح لوحة Game Zone");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        errorPanel.addView(title, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        errorDetail = new TextView(this);
        errorDetail.setText("تحقق من اتصال الإنترنت ثم حاول مرة أخرى.");
        errorDetail.setTextColor(Color.rgb(165, 174, 193));
        errorDetail.setTextSize(14);
        errorDetail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        detailParams.topMargin = dp(10);
        errorPanel.addView(errorDetail, detailParams);

        Button retry = new Button(this);
        retry.setText("إعادة المحاولة");
        retry.setOnClickListener(v -> recoverWebView("manual_retry", true));
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(dp(180), dp(52));
        retryParams.topMargin = dp(22);
        errorPanel.addView(retry, retryParams);

        root.addView(errorPanel, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
    }

    private void createAndAttachWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8, 11, 18));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        configureWebView(webView);
        root.addView(webView, 0, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
    }

    private void configureWebView(WebView target) {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings s = target.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setGeolocationEnabled(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
            target.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        s.setUserAgentString(s.getUserAgentString() + " GameZoneAdmin/2.1.6");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(target, false);

        target.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
                if ("https".equals(scheme) && allowedHost != null && allowedHost.equalsIgnoreCase(u.getHost())) {
                    return false;
                }
                if ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme) || "tg".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mainFrameFailed = false;
                pageReady = false;
                hideError();
                if (loading != null) loading.setVisibility(View.VISIBLE);
                armLoadTimeout();
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (isAllowedUrl(url)) lastGoodUrl = url;
                super.onPageCommitVisible(view, url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                cancelLoadTimeout();
                if (!mainFrameFailed) {
                    pageReady = true;
                    if (isAllowedUrl(url)) lastGoodUrl = url;
                    if (loading != null) loading.setVisibility(View.GONE);
                    scheduleHeartbeat(2500L);
                }
                super.onPageFinished(view, url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    cancelLoadTimeout();
                    showError("تعذر الاتصال بلوحة الإدارة. تحقق من الإنترنت ثم أعد المحاولة.");
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) {
                    cancelLoadTimeout();
                    showError("خادم لوحة الإدارة غير متاح مؤقتًا. حاول مرة أخرى بعد لحظات.");
                }
                super.onReceivedHttpError(view, request, errorResponse);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler sslHandler, SslError error) {
                sslHandler.cancel();
                cancelLoadTimeout();
                showError("تعذر التحقق من أمان الاتصال بالخادم.");
                Toast.makeText(MainActivity.this, "تعذر التحقق من أمان الاتصال", Toast.LENGTH_LONG).show();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                handler.post(() -> recoverWebView("renderer_gone", false));
                return true;
            }
        });

        target.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "تعذر فتح اختيار الملف", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
    }

    private boolean isAllowedUrl(String value) {
        try {
            Uri u = Uri.parse(value);
            return "https".equalsIgnoreCase(u.getScheme()) && allowedHost != null && allowedHost.equalsIgnoreCase(u.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    private void armLoadTimeout() {
        cancelLoadTimeout();
        loadTimeoutRunnable = () -> {
            if (webView == null || mainFrameFailed || pageReady) return;
            try { webView.stopLoading(); } catch (Exception ignored) {}
            showError("استغرق تحميل لوحة الإدارة وقتًا أطول من المعتاد. اضغط إعادة المحاولة لاستعادة الاتصال.");
        };
        handler.postDelayed(loadTimeoutRunnable, LOAD_TIMEOUT_MS);
    }

    private void cancelLoadTimeout() {
        if (loadTimeoutRunnable != null) handler.removeCallbacks(loadTimeoutRunnable);
        loadTimeoutRunnable = null;
    }

    private void scheduleHeartbeat(long delayMs) {
        cancelHeartbeat();
        if (!resumed || webView == null || !pageReady || mainFrameFailed) return;
        heartbeatRunnable = this::pingRenderer;
        handler.postDelayed(heartbeatRunnable, delayMs);
    }

    private void pingRenderer() {
        if (!resumed || webView == null || !pageReady || mainFrameFailed || recovering) return;
        final WebView current = webView;
        final int generation = ++heartbeatGeneration;
        heartbeatTimeoutRunnable = () -> {
            if (generation == heartbeatGeneration && resumed && current == webView && pageReady && !mainFrameFailed) {
                recoverWebView("heartbeat_timeout", false);
            }
        };
        handler.postDelayed(heartbeatTimeoutRunnable, HEARTBEAT_TIMEOUT_MS);
        try {
            current.evaluateJavascript("(function(){return document.readyState==='complete'?'ok':'loading';})()", value -> {
                if (generation != heartbeatGeneration || current != webView) return;
                heartbeatGeneration++;
                if (heartbeatTimeoutRunnable != null) handler.removeCallbacks(heartbeatTimeoutRunnable);
                heartbeatTimeoutRunnable = null;
                scheduleHeartbeat(HEARTBEAT_INTERVAL_MS);
            });
        } catch (Exception e) {
            recoverWebView("heartbeat_exception", false);
        }
    }

    private void cancelHeartbeat() {
        heartbeatGeneration++;
        if (heartbeatRunnable != null) handler.removeCallbacks(heartbeatRunnable);
        if (heartbeatTimeoutRunnable != null) handler.removeCallbacks(heartbeatTimeoutRunnable);
        heartbeatRunnable = null;
        heartbeatTimeoutRunnable = null;
    }

    private void recoverWebView(String reason, boolean manual) {
        if (recovering || root == null || isFinishing() || isDestroyed()) return;
        recovering = true;
        cancelHeartbeat();
        cancelLoadTimeout();

        String targetUrl = manual ? startUrl : lastGoodUrl;
        try {
            if (!manual && webView != null && isAllowedUrl(webView.getUrl())) targetUrl = webView.getUrl();
        } catch (Exception ignored) {}
        if (!isAllowedUrl(targetUrl)) targetUrl = startUrl;

        WebView old = webView;
        webView = null;
        if (old != null) {
            try { old.stopLoading(); } catch (Exception ignored) {}
            try { root.removeView(old); } catch (Exception ignored) {}
            try { old.setWebChromeClient(null); old.setWebViewClient(null); old.destroy(); } catch (Exception ignored) {}
        }

        mainFrameFailed = false;
        pageReady = false;
        hideError();
        if (loading != null) loading.setVisibility(View.VISIBLE);
        createAndAttachWebView();
        if (resumed && webView != null) {
            try { webView.onResume(); } catch (Exception ignored) {}
        }
        String finalTargetUrl = targetUrl;
        handler.post(() -> {
            recovering = false;
            if (webView != null) webView.loadUrl(finalTargetUrl);
        });
    }

    private void showError(String detail) {
        mainFrameFailed = true;
        pageReady = false;
        cancelHeartbeat();
        if (loading != null) loading.setVisibility(View.GONE);
        if (errorDetail != null && detail != null) errorDetail.setText(detail);
        if (errorPanel != null) errorPanel.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (webView != null) {
            try { webView.onResume(); } catch (Exception ignored) {}
        }
        if (pageReady && !mainFrameFailed) scheduleHeartbeat(1500L);
    }

    @Override
    protected void onPause() {
        resumed = false;
        cancelHeartbeat();
        if (webView != null) {
            try { webView.onPause(); } catch (Exception ignored) {}
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            try { webView.saveState(outState); } catch (Exception ignored) {}
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                result = new Uri[count];
                for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        if (fileCallback != null) {
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        resumed = false;
        cancelHeartbeat();
        cancelLoadTimeout();
        if (fileCallback != null) {
            try { fileCallback.onReceiveValue(null); } catch (Exception ignored) {}
            fileCallback = null;
        }
        WebView old = webView;
        webView = null;
        if (old != null) {
            try { old.stopLoading(); } catch (Exception ignored) {}
            try { if (root != null) root.removeView(old); } catch (Exception ignored) {}
            try { old.setWebChromeClient(null); old.setWebViewClient(null); old.destroy(); } catch (Exception ignored) {}
        }
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
