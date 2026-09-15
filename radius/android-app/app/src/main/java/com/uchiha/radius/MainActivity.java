package com.uchiha.radius;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public final class MainActivity extends Activity {
    private static final String BUNDLED_UI_ASSET = "RADIUS-A-Master-v101.html";
    private static final Set<String> ALLOWED_HOSTS = Collections.unmodifiableSet(
            new HashSet<>(Collections.singletonList("radius.uchiha-builder.com"))
    );

    private static final String PROVIDER_ADAPTER_SCRIPT =
            "(function(){" +
            "if(window.UchihaProviderApp)return;" +
            "function parse(x){try{return JSON.parse(x||'{}')}catch(e){return {ok:false,error:'NATIVE_JSON_INVALID'}}}" +
            "function json(x){try{return JSON.stringify(x||{})}catch(e){return '{}'}}" +
            "window.UchihaProviderApp={" +
            "available:true," +
            "environment:function(){return parse(UchihaNative.getEnvironment())}," +
            "installationId:function(){return String(UchihaNative.getInstallationId()||'')}," +
            "validateActivationCode:function(code){return parse(UchihaNative.validateActivationCode(String(code||'')))}," +
            "validateRouterSetup:function(draft){return parse(UchihaNative.validateRouterSetup(json(draft)))}," +
            "validatePlan:function(draft){return parse(UchihaNative.validatePlan(json(draft)))}," +
            "network:function(){return parse(UchihaNative.getLocalNetwork())}," +
            "discoverRouters:function(){return parse(UchihaNative.discoverLocalRouters())}," +
            "probeRouter:function(host){return parse(UchihaNative.probeLocalRouter(String(host||'')))}," +
            "requestRouterCredentials:function(host){UchihaNative.requestRouterCredentials(String(host||''))}," +
            "hasRouterCredentialSession:function(id){return !!UchihaNative.hasRouterCredentialSession(String(id||''))}," +
            "clearRouterCredentialSession:function(id){UchihaNative.clearRouterCredentialSession(String(id||''))}," +
            "openWifiSettings:function(){UchihaNative.openWifiSettings()}," +
            "requestActivation:function(){UchihaNative.requestActivationOnWhatsApp()}" +
            "};" +
            "var detail=window.UchihaProviderApp.environment();" +
            "detail.bridge='UchihaNative';" +
            "window.dispatchEvent(new CustomEvent('uchiha-native-ready',{detail:detail}));" +
            "})();";

    private WebView webView;
    private ProgressBar progress;
    private TextView errorView;
    private NativeBridge nativeBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        configureWebView();
        loadInitialSurface();
    }

    private void loadInitialSurface() {
        try {
            String bundledHtml = readBundledUi();
            if (bundledHtml != null && !bundledHtml.isEmpty()) {
                webView.loadDataWithBaseURL(
                        BuildConfig.RADIUS_URL,
                        bundledHtml,
                        "text/html",
                        "UTF-8",
                        BuildConfig.RADIUS_URL
                );
                return;
            }
        } catch (Exception ignored) {
        }
        webView.loadUrl(BuildConfig.RADIUS_URL);
    }

    private String readBundledUi() {
        try (InputStream in = getAssets().open(BUNDLED_UI_ASSET);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return null;
        }
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        progress = new ProgressBar(this);
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(64, 64);
        pp.gravity = Gravity.CENTER;
        root.addView(progress, pp);

        errorView = new TextView(this);
        errorView.setText(getString(com.uchiha.radius.R.string.offline));
        errorView.setTextSize(16f);
        errorView.setGravity(Gravity.CENTER);
        errorView.setPadding(36, 36, 36, 36);
        errorView.setVisibility(View.GONE);
        FrameLayout.LayoutParams ep = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        root.addView(errorView, ep);

        errorView.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            progress.setVisibility(View.VISIBLE);
            loadInitialSurface();
        });

        setContentView(root);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " UCHIHA-RADIUS-Android/1.0-v101");

        nativeBridge = new NativeBridge(this, webView);
        webView.addJavascriptInterface(nativeBridge, "UchihaNative");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, false);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
                String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
                if ("https".equals(scheme) && ALLOWED_HOSTS.contains(host)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progress.setVisibility(View.VISIBLE);
                errorView.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                view.evaluateJavascript(PROVIDER_ADAPTER_SCRIPT, null);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    progress.setVisibility(View.GONE);
                    errorView.setVisibility(View.VISIBLE);
                }
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (nativeBridge != null) nativeBridge.clearSensitiveState();
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("UchihaNative");
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
