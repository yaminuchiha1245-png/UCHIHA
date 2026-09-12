package com.uchiha.debtstore;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.hardware.biometrics.BiometricPrompt;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.webkit.WebResourceRequest;
import android.util.Base64;
import android.security.keystore.KeyProperties;
import android.security.keystore.KeyGenParameterSpec;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Matrix;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextDirectionHeuristics;
import android.text.TextPaint;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.net.URLEncoder;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

public class MainActivity extends Activity {
    private static final int PICK_BACKUP_REQUEST = 4107;
    private static final int BARCODE_PHOTO_REQUEST = 4312;
    private static final String CHANNEL_ID = "debt_alerts";
    private static final String SECURE_PREFS = "uchiha_secure_state_v1";
    private static final String STATE_KEY_ALIAS = "uchiha_debt_state_key_v1";
    private static final String PIN_SALT = "UCHIHA-DEBT-STORE-PIN-v2";
    private static final String SUPABASE_URL = "https://jmluqclcwwuldwhaspgz.supabase.co";
    private static final String SUPABASE_KEY = "sb_publishable_zhOXbcCDipCmq0TGC3kQJA_32IaYRZq";
    private static final String CLOUD_PREFS = "uchiha_cloud_session_v1";
    private WebView webView;
    private final java.util.concurrent.ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService realtimeScheduler = Executors.newSingleThreadScheduledExecutor();
    private final OkHttpClient realtimeHttp = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build();
    private volatile WebSocket realtimeSocket;
    private volatile ScheduledFuture<?> realtimeHeartbeat;
    private volatile boolean realtimeWanted = false;
    private volatile String realtimeStoreId = "";
    private volatile int realtimeRef = 1;
    private boolean barcodeScanInProgress = false;
    private File barcodePhotoFile;
    private DebtService debtService;
    private volatile boolean stateReadBlocked = false;
    private volatile boolean upgradeCheckpointFailed = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        debtService = new DebtService(this, new DebtService.Codec() {
            public String encrypt(String value) throws Exception { return encryptState(value); }
            public String decrypt(String value) throws Exception { return decryptState(value); }
        }, SUPABASE_URL + "/functions/v1/debt-service", SUPABASE_KEY);
        preserveUpgradeCheckpoint();
        getWindow().setStatusBarColor(Color.rgb(10, 13, 18));
        getWindow().setNavigationBarColor(Color.rgb(10, 13, 18));
        createNotificationChannel();
        requestNotificationPermissionIfNeeded();

        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        WebView.setWebContentsDebuggingEnabled(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            private boolean handle(Uri uri) {
                if (uri == null) return true;
                String scheme = uri.getScheme();
                String url = uri.toString();
                if ("file".equalsIgnoreCase(scheme) && url.startsWith("file:///android_asset/")) return false;
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return handle(request.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return handle(Uri.parse(url)); }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new AppBridge(this), "Android");
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("window.appBack ? window.appBack() : false", value -> {
                if ("false".equals(value) || "null".equals(value)) {
                    if (webView.canGoBack()) webView.goBack(); else MainActivity.super.onBackPressed();
                }
            });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        stopRealtimeInternal();
        realtimeScheduler.shutdownNow();
        realtimeHttp.dispatcher().executorService().shutdown();
        realtimeHttp.connectionPool().evictAll();
        ioExecutor.shutdownNow();
        cleanupBarcodePhoto();
        if (webView != null) { webView.removeJavascriptInterface("Android"); webView.destroy(); webView=null; }
        super.onDestroy();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 221);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "تنبيهات الديون", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("تنبيهات حدود الديون وسعر الصرف");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void js(String code) {
        runOnUiThread(() -> {
            if (webView != null && !isDestroyed()) webView.evaluateJavascript(code, null);
        });
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_SHORT).show());
    }

    private String readAll(InputStream in) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line).append('\n');
        return sb.toString();
    }

    private JSONObject getJson(String endpoint) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(12000);
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("User-Agent", "UCHIHA-Debt-Store/1.0");
        int code = conn.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
        String body = readAll(stream);
        conn.disconnect();
        if (code < 200 || code >= 300) throw new IOException("HTTP " + code + ": " + body);
        return new JSONObject(body);
    }

    private double findMid(JSONArray arr, String currency) throws JSONException {
        if (arr == null) return Double.NaN;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject row = arr.optJSONObject(i);
            if (row != null && currency.equalsIgnoreCase(row.optString("currency"))) {
                double mid = row.optDouble("mid", Double.NaN);
                if (!Double.isNaN(mid) && mid > 0) return mid;
                double buy = row.optDouble("buy", Double.NaN);
                double sell = row.optDouble("sell", Double.NaN);
                if (!Double.isNaN(buy) && !Double.isNaN(sell) && buy > 0 && sell > 0) return (buy + sell) / 2.0;
            }
        }
        return Double.NaN;
    }

    private void fetchRates() {
        ioExecutor.execute(() -> {
            JSONObject result = new JSONObject();
            try {
                JSONObject usdBased = getJson("https://lirascope.syria-cloud.sy/api/v1/rates/usd-based?lang=ar");
                double usdTry = findMid(usdBased.optJSONArray("rates"), "TRY");

                JSONObject latest = getJson("https://lirascope.syria-cloud.sy/api/v1/rates/latest?currencies=USD&lang=ar");
                double usdSyp = findMid(latest.optJSONArray("effectiveRates"), "USD");
                if (Double.isNaN(usdSyp)) usdSyp = findMid(latest.optJSONArray("marketRates"), "USD");
                if (Double.isNaN(usdSyp)) usdSyp = findMid(latest.optJSONArray("cbsRates"), "USD");

                if (Double.isNaN(usdTry) || Double.isNaN(usdSyp)) throw new IOException("تعذر قراءة سعر إحدى العملات");
                result.put("ok", true);
                result.put("usdTry", usdTry);
                result.put("usdSyp", usdSyp);
                result.put("trySyp", usdSyp / usdTry);
                result.put("source", "LiraScope");
                result.put("timestamp", latest.optString("timestampUtc", usdBased.optString("timestampUtc", new Date().toString())));
            } catch (Exception e) {
                try {
                    result.put("ok", false);
                    result.put("error", e.getMessage() == null ? "تعذر تحديث سعر الصرف" : e.getMessage());
                } catch (JSONException ignored) {}
            }
            js("window.onNativeRates && window.onNativeRates(" + result.toString() + ")");
        });
    }

    private Uri writeToDownloads(String fileName, String mime, byte[] bytes) throws IOException {
        String safe = sanitizeFileName(fileName);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, safe);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/UCHIHA-Debt-Store");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("تعذر إنشاء الملف");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("تعذر فتح الملف");
                out.write(bytes);
            }
            return uri;
        }
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (dir == null) dir = getFilesDir();
        File file = new File(dir, safe);
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
        return Uri.fromFile(file);
    }

    private String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) name = "UCHIHA-file";
        return name.replaceAll("[\\\\/:*?\"<>|]", "-");
    }

    private void shareUri(Uri uri, String mime, String title) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && "file".equals(uri.getScheme())) {
            toast("تم حفظ الملف داخل مجلد التطبيق");
            return;
        }
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType(mime);
        share.putExtra(Intent.EXTRA_STREAM, uri);
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivity(Intent.createChooser(share, title)); }
        catch (ActivityNotFoundException e) { toast("تم حفظ الملف في التنزيلات"); }
    }

    private void exportTextFile(String text, String fileName, String mime, boolean bom) {
        ioExecutor.execute(() -> {
            try {
                byte[] raw = text.getBytes(StandardCharsets.UTF_8);
                byte[] bytes;
                if (bom) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    bos.write(0xEF); bos.write(0xBB); bos.write(0xBF); bos.write(raw);
                    bytes = bos.toByteArray();
                } else bytes = raw;
                Uri uri = writeToDownloads(fileName, mime, bytes);
                runOnUiThread(() -> shareUri(uri, mime, "مشاركة الملف"));
            } catch (Exception e) { toast("تعذر تصدير الملف: " + e.getMessage()); }
        });
    }

    private void exportShortagesPdf(String json, String fileName) {
        ioExecutor.execute(() -> {
            PdfDocument doc = new PdfDocument();
            try {
                JSONObject data = new JSONObject(json);
                JSONObject shop = data.optJSONObject("shop");
                JSONObject summary = data.optJSONObject("summary");
                JSONArray rows = data.optJSONArray("rows");
                if (rows == null) rows = new JSONArray();

                final int pageW = 595, pageH = 842, margin = 38;
                final int rowH = 42, tableHeaderH = 38;
                final int[] widths = {196, 74, 88, 88, 73};
                final String[] heads = {"الصنف", "الكمية", "الحالة", "أضيف بواسطة", "التاريخ"};
                final int navy = Color.rgb(10, 26, 44);
                final int navy2 = Color.rgb(16, 42, 67);
                final int blue = Color.rgb(37, 99, 235);
                final int cyan = Color.rgb(14, 165, 233);
                final int text = Color.rgb(15, 23, 42);
                final int muted = Color.rgb(100, 116, 139);
                final int line = Color.rgb(226, 232, 240);
                final int panel = Color.rgb(248, 250, 252);
                final int red = Color.rgb(190, 24, 93);
                final int redBg = Color.rgb(253, 242, 248);
                final int amber = Color.rgb(180, 83, 9);
                final int amberBg = Color.rgb(255, 247, 237);
                final int green = Color.rgb(21, 128, 61);
                final int greenBg = Color.rgb(240, 253, 244);

                int rowIndex = 0, pageNo = 1;
                while (rowIndex < rows.length() || pageNo == 1) {
                    PdfDocument.Page page = doc.startPage(new PdfDocument.PageInfo.Builder(pageW, pageH, pageNo).create());
                    Canvas c = page.getCanvas();
                    c.drawColor(Color.WHITE);
                    Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

                    // Professional NOVA header
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(navy);
                    c.drawRect(0, 0, pageW, 104, p);
                    p.setColor(cyan);
                    c.drawRect(0, 0, 7, 104, p);
                    p.setTextAlign(Paint.Align.RIGHT);
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                    p.setTextSize(20);
                    p.setColor(Color.WHITE);
                    String shopName = shop == null ? "المحل" : shop.optString("name", "المحل");
                    c.drawText(trim(shopName, 32), pageW - margin, 36, p);
                    p.setTextSize(15);
                    p.setColor(Color.rgb(186, 230, 253));
                    c.drawText("قائمة نواقص المحل", pageW - margin, 62, p);
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                    p.setTextSize(9.5f);
                    p.setColor(Color.rgb(203, 213, 225));
                    String village = shop == null ? "" : shop.optString("village", "");
                    String phone = shop == null ? "" : shop.optString("phone", "");
                    String meta = (!village.isEmpty() ? village : "") + ((!village.isEmpty() && !phone.isEmpty()) ? "  •  " : "") + (!phone.isEmpty() ? phone : "");
                    if (!meta.isEmpty()) c.drawText(trim(meta, 52), pageW - margin, 84, p);
                    p.setTextAlign(Paint.Align.LEFT);
                    p.setTextSize(9);
                    c.drawText(new SimpleDateFormat("yyyy/MM/dd  HH:mm", Locale.US).format(new Date()), margin, 38, p);
                    c.drawText("UCHIHA · NOVA", margin, 58, p);

                    float tableTop;
                    if (pageNo == 1) {
                        // Summary cards
                        int total = summary == null ? rows.length() : summary.optInt("total", rows.length());
                        int needed = summary == null ? 0 : summary.optInt("needed", 0);
                        int ordered = summary == null ? 0 : summary.optInt("ordered", 0);
                        int bought = summary == null ? 0 : summary.optInt("bought", 0);
                        int[] values = {total, needed, ordered, bought};
                        String[] labels = {"الإجمالي", "ناقص", "تم الطلب", "تم الشراء"};
                        int[] accents = {blue, red, amber, green};
                        float top = 121, gap = 8f, cardH = 61f;
                        float cardW = (pageW - 2f * margin - 3f * gap) / 4f;
                        for (int i = 0; i < 4; i++) {
                            float left = margin + i * (cardW + gap);
                            p.setColor(panel); p.setStyle(Paint.Style.FILL);
                            c.drawRoundRect(left, top, left + cardW, top + cardH, 10, 10, p);
                            p.setColor(line); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(1f);
                            c.drawRoundRect(left, top, left + cardW, top + cardH, 10, 10, p);
                            p.setStyle(Paint.Style.FILL); p.setColor(accents[i]);
                            c.drawRoundRect(left + 8, top + 9, left + 13, top + cardH - 9, 3, 3, p);
                            p.setTextAlign(Paint.Align.CENTER);
                            p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                            p.setTextSize(18); p.setColor(text);
                            c.drawText(String.valueOf(values[i]), left + cardW / 2f, top + 30, p);
                            p.setTextSize(9.2f); p.setColor(muted);
                            c.drawText(labels[i], left + cardW / 2f, top + 49, p);
                        }
                        tableTop = 204;
                    } else {
                        tableTop = 128;
                    }

                    // Table header
                    p.setStyle(Paint.Style.FILL); p.setColor(navy2);
                    c.drawRoundRect(margin, tableTop, pageW - margin, tableTop + tableHeaderH, 8, 8, p);
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                    p.setTextSize(10.2f); p.setColor(Color.WHITE); p.setTextAlign(Paint.Align.CENTER);
                    float x = pageW - margin;
                    for (int i = 0; i < heads.length; i++) {
                        float center = x - widths[i] / 2f;
                        c.drawText(heads[i], center, tableTop + 24, p);
                        x -= widths[i];
                    }

                    float y = tableTop + tableHeaderH;
                    int maxRows = (int) ((pageH - y - 53) / rowH);
                    int used = 0;
                    while (rowIndex < rows.length() && used < maxRows) {
                        JSONObject r = rows.optJSONObject(rowIndex++);
                        if (r == null) continue;
                        if (used % 2 == 0) {
                            p.setColor(Color.rgb(248, 250, 252));
                            c.drawRect(margin, y, pageW - margin, y + rowH, p);
                        }
                        p.setColor(line); p.setStrokeWidth(.8f);
                        c.drawLine(margin, y + rowH, pageW - margin, y + rowH, p);

                        String status = r.optString("status", "needed");
                        String statusLabel = r.optString("statusLabel", "ناقص");
                        String[] vals = {
                                trim(r.optString("name", ""), 30),
                                trim(r.optString("qty", "—"), 15),
                                statusLabel,
                                trim(r.optString("createdBy", "—"), 16),
                                trim(r.optString("date", ""), 14)
                        };
                        x = pageW - margin;
                        for (int i = 0; i < vals.length; i++) {
                            float left = x - widths[i], center = (left + x) / 2f;
                            if (i == 2) {
                                int fg = "bought".equals(status) ? green : "ordered".equals(status) ? amber : red;
                                int bgc = "bought".equals(status) ? greenBg : "ordered".equals(status) ? amberBg : redBg;
                                float badgeW = Math.min(68, widths[i] - 12), badgeH = 25;
                                p.setColor(bgc); p.setStyle(Paint.Style.FILL);
                                c.drawRoundRect(center - badgeW / 2f, y + 8, center + badgeW / 2f, y + 8 + badgeH, 8, 8, p);
                                p.setColor(fg); p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD)); p.setTextSize(9.2f); p.setTextAlign(Paint.Align.CENTER);
                                c.drawText(vals[i], center, y + 25, p);
                            } else {
                                p.setTypeface(Typeface.create(Typeface.DEFAULT, i == 0 ? Typeface.BOLD : Typeface.NORMAL));
                                p.setTextSize(i == 0 ? 10.5f : 9.4f);
                                p.setColor(i == 0 ? text : muted);
                                p.setTextAlign(Paint.Align.CENTER);
                                c.drawText(vals[i], center, y + 25, p);
                            }
                            x = left;
                        }
                        y += rowH;
                        used++;
                    }

                    if (rows.length() == 0) {
                        p.setTextAlign(Paint.Align.CENTER); p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                        p.setTextSize(12); p.setColor(muted);
                        c.drawText("لا توجد نواقص ضمن هذا التصدير", pageW / 2f, tableTop + 80, p);
                    }

                    // Footer
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)); p.setTextSize(8.8f); p.setColor(muted);
                    p.setTextAlign(Paint.Align.LEFT); c.drawText("صفحة " + pageNo, margin, pageH - 20, p);
                    p.setTextAlign(Paint.Align.RIGHT);
                    String footer = shop == null ? "" : shop.optString("pdfFooter", "");
                    if (footer.isEmpty()) footer = "قائمة نواقص المحل - تم إنشاؤها بواسطة UCHIHA";
                    c.drawText(trim(footer, 60), pageW - margin, pageH - 20, p);

                    doc.finishPage(page);
                    pageNo++;
                    if (rows.length() == 0) break;
                }

                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                doc.writeTo(bos);
                Uri uri = writeToDownloads(fileName, "application/pdf", bos.toByteArray());
                runOnUiThread(() -> shareUri(uri, "application/pdf", "مشاركة نواقص المحل"));
            } catch (Exception e) {
                toast("تعذر إنشاء PDF النواقص: " + e.getMessage());
            } finally {
                doc.close();
            }
        });
    }

    private void exportClientPdf(String json, String fileName) {
        ioExecutor.execute(() -> {
            PdfDocument doc = new PdfDocument();
            try {
                JSONObject data = new JSONObject(json), shop = data.optJSONObject("shop"), client = data.optJSONObject("client"), summary = data.optJSONObject("summary");
                JSONArray rows = data.optJSONArray("rows"); if (rows == null) rows = new JSONArray();
                final int pageW = 420, pageH = 840, margin = 12, rowH = 43, cardTop = 70, cardH = 58, tableTop = 142;
                final int[] widths = {78,70,88,55,105};
                final String[] heads = {"التاريخ","نوع العملية","مبلغ العملية","العملة","الرصيد بعد العملية"};
                final int bg=Color.rgb(4,14,24),panel=Color.rgb(8,25,40),panelAlt=Color.rgb(7,21,34),border=Color.rgb(28,67,92),text=Color.rgb(239,245,250),muted=Color.rgb(164,180,194),blue=Color.rgb(75,184,248),blueBg=Color.rgb(11,52,78),green=Color.rgb(0,226,154),greenBg=Color.rgb(7,75,58);
                int rowIndex=0,pageNo=1;
                while(rowIndex<rows.length()||pageNo==1){
                    PdfDocument.Page page=doc.startPage(new PdfDocument.PageInfo.Builder(pageW,pageH,pageNo).create());
                    Canvas c=page.getCanvas(); c.drawColor(bg); Paint p=new Paint(Paint.ANTI_ALIAS_FLAG); p.setTextAlign(Paint.Align.RIGHT);
                    String shopName=shop==null?"دفتر الديون":shop.optString("name","دفتر الديون"), clientName=client==null?"":client.optString("name","");
                    p.setColor(text);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(17);c.drawText(trim(shopName,28),pageW-margin,26,p);
                    p.setTextSize(13);p.setColor(muted);c.drawText("كشف حساب — "+trim(clientName,25),pageW-margin,47,p);
                    p.setTextAlign(Paint.Align.LEFT);p.setTextSize(8.8f);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.NORMAL));c.drawText(new SimpleDateFormat("yyyy/MM/dd",Locale.US).format(new Date()),margin,26,p);p.setTextAlign(Paint.Align.RIGHT);
                    boolean usdTryOnly=summary!=null && summary.optBoolean("usdTryOnly",false);
                    if(pageNo==1){
                        float gap=4f,cardW=(pageW-2f*margin-2f*gap)/3f;
                        if(usdTryOnly){
                            String[] labs={"الرصيد بالدولار","التركي محوّل بالدولار","عدد العمليات"};
                            String[] vals={"$"+summary.optString("balanceUsd","0"),"$"+summary.optString("tryConvertedUsd","0"),String.valueOf(summary.optInt("operations",rows.length()))};
                            for(int i=0;i<3;i++){float left=pageW-margin-(i+1)*cardW-i*gap;p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRoundRect(left,cardTop,left+cardW,cardTop+cardH,7,7,p);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1f);p.setColor(border);c.drawRoundRect(left,cardTop,left+cardW,cardTop+cardH,7,7,p);p.setStyle(Paint.Style.FILL);p.setTextAlign(Paint.Align.CENTER);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(9.2f);p.setColor(muted);c.drawText(labs[i],left+cardW/2f,cardTop+17,p);p.setColor(i==1?green:text);p.setTextSize(16.5f);c.drawText(trim(vals[i],18),left+cardW/2f,cardTop+43,p);}
                            float ct=cardTop+cardH+6;p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRoundRect(margin,ct,pageW-margin,ct+38,7,7,p);p.setStyle(Paint.Style.STROKE);p.setColor(border);c.drawRoundRect(margin,ct,pageW-margin,ct+38,7,7,p);p.setStyle(Paint.Style.FILL);p.setTextAlign(Paint.Align.RIGHT);p.setColor(muted);p.setTextSize(9f);c.drawText("إجمالي المطلوب دفعه بالدولار",pageW-margin-8,ct+15,p);p.setColor(blue);p.setTextSize(16f);c.drawText("$"+summary.optString("totalDueUsd","0"),pageW-margin-8,ct+32,p);p.setTextAlign(Paint.Align.LEFT);p.setTextSize(7.5f);p.setColor(muted);c.drawText("المبلغ النهائي المطلوب من العميل",margin+8,ct+25,p);p.setTextAlign(Paint.Align.RIGHT);
                        }else{
                        boolean multiCurrency=summary!=null && summary.optBoolean("multiCurrency",false);
                        String[] labels={"إجمالي المشتريات","إجمالي الدفعات","عدد العمليات"};
                        int[] colors={green,text,text};
                        for(int i=0;i<3;i++){
                            float left=pageW-margin-(i+1)*cardW-i*gap;
                            p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRoundRect(left,cardTop,left+cardW,cardTop+cardH,7,7,p);
                            p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1f);p.setColor(border);c.drawRoundRect(left,cardTop,left+cardW,cardTop+cardH,7,7,p);
                            p.setStyle(Paint.Style.FILL);p.setTextAlign(Paint.Align.CENTER);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(9.4f);p.setColor(muted);c.drawText(labels[i],left+cardW/2f,cardTop+16,p);
                            p.setColor(colors[i]);
                            if(multiCurrency && i<2){
                                JSONObject sums=summary.optJSONObject(i==0?"purchases":"payments");
                                String usd="$"+(sums==null?"0":sums.optString("USD","0"));
                                String tr="₺"+(sums==null?"0":sums.optString("TRY","0"));
                                p.setTextSize(9.2f);c.drawText(trim(usd,16),left+cardW/2f,cardTop+33,p);
                                c.drawText(trim(tr,16),left+cardW/2f,cardTop+49,p);
                            }else{
                                String value=i==0?"$"+(summary==null?"0.00":summary.optString("purchasesUsd","0.00")):i==1?"$"+(summary==null?"0.00":summary.optString("paymentsUsd","0.00")):summary==null?String.valueOf(rows.length()):String.valueOf(summary.optInt("operations",rows.length()));
                                p.setTextSize(17);c.drawText(value,left+cardW/2f,cardTop+43,p);
                            }
                        }
                        p.setTextAlign(Paint.Align.RIGHT);
                        }
                    }
                    float yTop=pageNo==1?(usdTryOnly?cardTop+cardH+50:tableTop):58;
                    p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRect(margin,yTop,pageW-margin,yTop+rowH,p);
                    p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1f);p.setColor(border);c.drawRect(margin,yTop,pageW-margin,yTop+rowH,p);
                    p.setStyle(Paint.Style.FILL);p.setTextSize(8.4f);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setColor(text);
                    int x=pageW-margin;
                    for(int i=0;i<heads.length;i++){
                        float center=x-widths[i]/2f;p.setTextAlign(Paint.Align.CENTER);c.drawText(heads[i],center,yTop+26,p);
                        if(i<heads.length-1){p.setColor(border);p.setStrokeWidth(.85f);c.drawLine(x-widths[i],yTop,x-widths[i],yTop+rowH,p);p.setColor(text);}x-=widths[i];
                    }
                    float y=yTop+rowH;int maxRows=(int)((pageH-y-30)/rowH),used=0;
                    while(rowIndex<rows.length()&&used<maxRows){
                        JSONObject r=rows.optJSONObject(rowIndex++);if(r==null)continue;
                        p.setStyle(Paint.Style.FILL);p.setColor((used%2==0)?panelAlt:panel);c.drawRect(margin,y,pageW-margin,y+rowH,p);
                        p.setColor(border);p.setStrokeWidth(.75f);c.drawLine(margin,y+rowH,pageW-margin,y+rowH,p);
                        String type=r.optString("type","purchase"),typeLabel=r.optString("typeLabel",type.equals("payment")?"دفعة":"شراء");
                        String[] vals={r.optString("date",""),typeLabel,r.optString("amount",""),r.optString("currency",""),r.optString("balance","")};
                        x=pageW-margin;p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));
                        for(int i=0;i<vals.length;i++){
                            float right=x,left=x-widths[i],center=(left+right)/2f;
                            if(i==1){float badgeW=Math.min(54,widths[i]-8),bLeft=center-badgeW/2f,bRight=center+badgeW/2f,top=y+7;p.setColor(type.equals("payment")?greenBg:blueBg);c.drawRoundRect(bLeft,top,bRight,top+28,7,7,p);p.setColor(type.equals("payment")?green:blue);p.setTextSize(10.5f);p.setTextAlign(Paint.Align.CENTER);c.drawText(vals[i],center,y+26,p);}else{p.setTextAlign(Paint.Align.CENTER);p.setColor((i==2||i==4)?text:muted);p.setTextSize((i==2||i==4)?9.6f:8.8f);c.drawText(trim(vals[i],i==4?16:13),center,y+26,p);}
                            if(i<vals.length-1){p.setColor(border);p.setStrokeWidth(.75f);c.drawLine(left,y,left,y+rowH,p);}x-=widths[i];
                        }
                        y+=rowH;used++;
                    }
                    p.setTextSize(8.3f);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.NORMAL));p.setColor(muted);p.setTextAlign(Paint.Align.LEFT);c.drawText("صفحة "+pageNo,margin,pageH-11,p);p.setTextAlign(Paint.Align.RIGHT);
                    String footer=shop==null?"":shop.optString("pdfFooter","");if(!footer.isEmpty())c.drawText(trim(footer,45),pageW-margin,pageH-11,p);
                    doc.finishPage(page);pageNo++;if(rows.length()==0)break;
                }
                ByteArrayOutputStream bos=new ByteArrayOutputStream();doc.writeTo(bos);Uri uri=writeToDownloads(fileName,"application/pdf",bos.toByteArray());runOnUiThread(()->shareUri(uri,"application/pdf","مشاركة كشف الحساب"));
            }catch(Exception e){toast("تعذر إنشاء PDF: "+e.getMessage());}finally{doc.close();}
        });
    }

    /**
     * Stability-first barcode flow. The app never opens a live Camera1 preview.
     * It delegates capture to the phone camera app and decodes the saved photo locally.
     */
    private void openBarcodeScannerSafely() {
        if (barcodeScanInProgress) return;
        if (!getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)) {
            toast("هذا الجهاز لا يحتوي على كاميرا متاحة");
            js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");
            return;
        }
        openSystemCameraBarcodeFallback();
    }

    private void deliverBarcode(String value) {
        if (value == null || value.trim().isEmpty()) return;
        js("window.onNativeBarcodeScanned && window.onNativeBarcodeScanned(" + JSONObject.quote(value.trim()) + ")");
    }

    private void openSystemCameraBarcodeFallback() {
        if (barcodeScanInProgress) return;
        try {
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (camera.resolveActivity(getPackageManager()) == null) {
                toast("لا يوجد تطبيق كاميرا متاح على الجهاز");
                js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");
                return;
            }
            File dir = new File(getCacheDir(), "barcode");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("camera_cache");
            barcodePhotoFile = File.createTempFile("barcode_", ".jpg", dir);
            Uri photoUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", barcodePhotoFile);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            camera.setClipData(ClipData.newRawUri("barcode", photoUri));
            barcodeScanInProgress = true;
            startActivityForResult(camera, BARCODE_PHOTO_REQUEST);
            toast("تم تشغيل كاميرا الهاتف الآمنة — صوّر الباركود بوضوح");
        } catch (Throwable error) {
            barcodeScanInProgress = false;
            cleanupBarcodePhoto();
            toast("تعذر فتح الكاميرا الآمنة");
            js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");
        }
    }

    private void decodeBarcodePhotoAsync(File photo) {
        ioExecutor.execute(() -> {
            String decoded = null;
            try {
                Bitmap bitmap = loadBarcodeBitmap(photo);
                if (bitmap != null) { decoded = decodeBarcodeBitmap(bitmap); bitmap.recycle(); }
            } catch (Throwable ignored) {
            } finally { cleanupBarcodePhoto(); }
            final String value = decoded;
            runOnUiThread(() -> {
                barcodeScanInProgress = false;
                if (value != null && !value.trim().isEmpty()) deliverBarcode(value.trim());
                else {
                    toast("لم أتمكن من قراءة الباركود من الصورة — قرّبه من الكاميرا وحاول مجددًا");
                    js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");
                }
            });
        });
    }

    private Bitmap loadBarcodeBitmap(File photo) throws IOException {
        if (photo == null || !photo.exists() || photo.length() == 0) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(photo.getAbsolutePath(), bounds);
        int maxSide = Math.max(bounds.outWidth, bounds.outHeight), sample = 1;
        while (maxSide / sample > 1800) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = Math.max(1, sample);
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bitmap = BitmapFactory.decodeFile(photo.getAbsolutePath(), opts);
        if (bitmap == null) return null;
        int rotation = 0;
        try {
            android.media.ExifInterface exif = new android.media.ExifInterface(photo.getAbsolutePath());
            int orientation = exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL);
            if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;
            else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;
            else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;
        } catch (Throwable ignored) {}
        if (rotation == 0) return bitmap;
        Matrix matrix = new Matrix(); matrix.postRotate(rotation);
        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        if (rotated != bitmap) bitmap.recycle();
        return rotated;
    }

    private String decodeBarcodeBitmap(Bitmap bitmap) {
        if (bitmap == null) return null;
        int width = bitmap.getWidth(), height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        BinaryBitmap binary = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width, height, pixels)));
        MultiFormatReader reader = new MultiFormatReader();
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, Arrays.asList(
                BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
                BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.CODABAR,
                BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX));
        reader.setHints(hints);
        try { Result result = reader.decodeWithState(binary); return result == null ? null : result.getText(); }
        catch (Throwable ignored) { return null; }
        finally { reader.reset(); }
    }

    private void cleanupBarcodePhoto() {
        File photo = barcodePhotoFile; barcodePhotoFile = null;
        if (photo != null) try { if (photo.exists()) photo.delete(); } catch (Throwable ignored) {}
    }

    private void exportInvoicePdf(String json, String fileName) {
        ioExecutor.execute(() -> {
            PdfDocument doc = new PdfDocument();
            try {
                JSONObject data = new JSONObject(json);
                JSONObject shop = data.optJSONObject("shop");
                JSONObject client = data.optJSONObject("client");
                JSONObject invoice = data.optJSONObject("invoice");
                JSONArray items = data.optJSONArray("items"); if (items == null) items = new JSONArray();
                JSONObject totals = invoice == null ? null : invoice.optJSONObject("totals");
                final int pageW = 420, pageH = 840, margin = 18, rowH = 42;
                final int bg=Color.rgb(4,14,24), panel=Color.rgb(9,25,39), line=Color.rgb(31,62,84), text=Color.rgb(238,245,250), muted=Color.rgb(150,168,184), blue=Color.rgb(91,192,248), green=Color.rgb(63,222,158);
                int index=0,pageNo=1;
                while(index<items.length() || pageNo==1){
                    PdfDocument.Page page=doc.startPage(new PdfDocument.PageInfo.Builder(pageW,pageH,pageNo).create());
                    Canvas c=page.getCanvas();c.drawColor(bg);Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setTextAlign(Paint.Align.RIGHT);
                    String shopName=shop==null?"دفتر الديون":shop.optString("name","دفتر الديون");
                    String clientName=client==null?"":client.optString("name","");
                    String number=invoice==null?"":invoice.optString("number","");
                    p.setColor(text);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(18);c.drawText(trim(shopName,28),pageW-margin,28,p);
                    p.setColor(blue);p.setTextSize(13);c.drawText("فاتورة منتجات #"+trim(number,23),pageW-margin,50,p);
                    p.setColor(muted);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.NORMAL));p.setTextSize(9.5f);c.drawText("العميل: "+trim(clientName,28),pageW-margin,69,p);
                    String date=invoice==null?"":invoice.optString("createdAt","");c.drawText("التاريخ: "+trim(date.replace('T',' '),22),pageW-margin,84,p);
                    if(pageNo==1){
                        p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRoundRect(margin,96,pageW-margin,148,9,9,p);p.setStyle(Paint.Style.STROKE);p.setColor(line);c.drawRoundRect(margin,96,pageW-margin,148,9,9,p);p.setStyle(Paint.Style.FILL);
                        double usd=totals==null?0:totals.optDouble("USD",0), tr=totals==null?0:totals.optDouble("TRY",0);
                        p.setTextAlign(Paint.Align.CENTER);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setColor(muted);p.setTextSize(9);c.drawText("إجمالي USD",pageW*0.72f,112,p);c.drawText("إجمالي TRY",pageW*0.28f,112,p);
                        p.setColor(green);p.setTextSize(16);c.drawText(String.format(Locale.US,"$%,.2f",usd),pageW*0.72f,137,p);c.drawText(String.format(Locale.US,"₺%,.2f",tr),pageW*0.28f,137,p);p.setTextAlign(Paint.Align.RIGHT);
                    }
                    float y=pageNo==1?162:100;
                    p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRect(margin,y,pageW-margin,y+34,p);p.setColor(text);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(9);p.setTextAlign(Paint.Align.CENTER);
                    float[] cx={pageW-82,pageW-210,88,36};String[] heads={"المنتج","سعر الوحدة","الكمية","الإجمالي"};for(int i=0;i<heads.length;i++)c.drawText(heads[i],cx[i],y+22,p);y+=34;
                    int max=(int)((pageH-y-44)/rowH),used=0;
                    while(index<items.length()&&used<max){JSONObject it=items.optJSONObject(index++);if(it==null)continue;if(used%2==0){p.setColor(Color.rgb(7,20,31));c.drawRect(margin,y,pageW-margin,y+rowH,p);}p.setColor(line);p.setStrokeWidth(.7f);c.drawLine(margin,y+rowH,pageW-margin,y+rowH,p);
                        String cur=it.optString("currency","TRY");String sym="USD".equals(cur)?"$":"₺";String name=trim(it.optString("name",""),22);double unit=it.optDouble("unitPrice",0),qty=it.optDouble("quantity",1),total=it.optDouble("lineTotal",unit*qty);
                        p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(9.5f);p.setColor(text);p.setTextAlign(Paint.Align.RIGHT);c.drawText(name,pageW-margin-5,y+25,p);
                        p.setTextAlign(Paint.Align.CENTER);p.setColor(muted);p.setTextSize(9);c.drawText(sym+String.format(Locale.US,"%.2f",unit),pageW-210,y+25,p);c.drawText(String.format(Locale.US,"%.2f",qty),88,y+25,p);p.setColor(text);c.drawText(sym+String.format(Locale.US,"%.2f",total),36,y+25,p);y+=rowH;used++;}
                    p.setTextAlign(Paint.Align.LEFT);p.setColor(muted);p.setTextSize(8);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.NORMAL));c.drawText("صفحة "+pageNo,margin,pageH-16,p);p.setTextAlign(Paint.Align.RIGHT);String footer=shop==null?"":shop.optString("footer","");if(!footer.isEmpty())c.drawText(trim(footer,42),pageW-margin,pageH-16,p);
                    doc.finishPage(page);pageNo++;if(items.length()==0)break;
                }
                ByteArrayOutputStream bos=new ByteArrayOutputStream();doc.writeTo(bos);Uri uri=writeToDownloads(fileName,"application/pdf",bos.toByteArray());runOnUiThread(()->shareUri(uri,"application/pdf","مشاركة الفاتورة"));
            } catch(Exception e){toast("تعذر إنشاء فاتورة PDF: "+e.getMessage());} finally {doc.close();}
        });
    }

    private void exportDebtSummaryPdf(String json, String fileName) {
        ioExecutor.execute(() -> {
            PdfDocument doc = new PdfDocument();
            try {
                JSONObject data = new JSONObject(json);
                JSONObject shop = data.optJSONObject("shop");
                JSONArray clients = data.optJSONArray("clients");
                if (clients == null) clients = new JSONArray();

                final int pageW = 595, pageH = 842;
                final int margin = 42;
                final int rowH = 34;
                final int tableTop = 132;
                final int usdW = 120;
                final int tryW = 120;
                int rowIndex = 0;
                int pageNo = 1;

                while (rowIndex < clients.length() || pageNo == 1) {
                    PdfDocument.PageInfo info = new PdfDocument.PageInfo.Builder(pageW, pageH, pageNo).create();
                    PdfDocument.Page page = doc.startPage(info);
                    Canvas c = page.getCanvas();
                    c.drawColor(Color.WHITE);

                    Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
                    p.setTextAlign(Paint.Align.RIGHT);
                    p.setColor(Color.rgb(15, 23, 42));
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                    p.setTextSize(22);
                    String shopName = shop == null ? "دفتر الديون" : shop.optString("name", "دفتر الديون");
                    c.drawText(shopName, pageW - margin, 42, p);

                    p.setTextSize(16);
                    p.setColor(Color.rgb(37, 99, 235));
                    c.drawText("ملخص الديون المتبقية", pageW - margin, 72, p);

                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                    p.setTextSize(10);
                    p.setColor(Color.rgb(100, 116, 139));
                    c.drawText("تاريخ التصدير: " + new SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.US).format(new Date()), pageW - margin, 94, p);

                    p.setColor(Color.rgb(15, 23, 42));
                    p.setStrokeWidth(1.2f);
                    c.drawLine(margin, 110, pageW - margin, 110, p);

                    p.setColor(Color.rgb(15, 23, 42));
                    c.drawRoundRect(margin, tableTop, pageW - margin, tableTop + rowH, 8, 8, p);
                    p.setColor(Color.WHITE);
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                    p.setTextSize(11.5f);
                    c.drawText("USD", pageW - margin - 12, tableTop + 22, p);
                    c.drawText("TRY", pageW - margin - usdW - 12, tableTop + 22, p);
                    c.drawText("اسم العميل", pageW - margin - usdW - tryW - 14, tableTop + 22, p);

                    float y = tableTop + rowH;
                    int maxRows = (int) ((pageH - y - 55) / rowH);
                    int used = 0;
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                    while (rowIndex < clients.length() && used < maxRows) {
                        JSONObject item = clients.optJSONObject(rowIndex++);
                        if (item == null) continue;
                        if (used % 2 == 0) {
                            p.setColor(Color.rgb(248, 250, 252));
                            c.drawRect(margin, y, pageW - margin, y + rowH, p);
                        }

                        String name = trim(item.optString("name", ""), 34);
                        double debtUsd = item.optDouble("debtUsd", 0);
                        double debtTry = item.optDouble("debtTry", 0);
                        String usdText = String.format(Locale.US, "$%,.2f", debtUsd);
                        String tryText = String.format(Locale.US, "₺%,.2f", debtTry);

                        p.setColor(Color.rgb(30, 41, 59));
                        p.setTextSize(11.2f);
                        p.setTextAlign(Paint.Align.RIGHT);
                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                        c.drawText(name, pageW - margin - usdW - tryW - 14, y + 22, p);

                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                        p.setColor(debtUsd > 0.005 ? Color.rgb(185, 28, 28) : Color.rgb(22, 163, 74));
                        c.drawText(usdText, pageW - margin - 12, y + 22, p);
                        p.setColor(debtTry > 0.005 ? Color.rgb(185, 28, 28) : Color.rgb(22, 163, 74));
                        c.drawText(tryText, pageW - margin - usdW - 12, y + 22, p);

                        p.setColor(Color.rgb(226, 232, 240));
                        p.setStrokeWidth(0.8f);
                        c.drawLine(margin, y + rowH, pageW - margin, y + rowH, p);
                        y += rowH;
                        used++;
                    }

                    if (clients.length() == 0) {
                        p.setTextAlign(Paint.Align.CENTER);
                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                        p.setTextSize(12);
                        p.setColor(Color.rgb(100, 116, 139));
                        c.drawText("لا يوجد عملاء مسجلون", pageW / 2f, tableTop + rowH + 42, p);
                    }

                    p.setTextAlign(Paint.Align.LEFT);
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                    p.setTextSize(9);
                    p.setColor(Color.rgb(100, 116, 139));
                    c.drawText("صفحة " + pageNo, margin, pageH - 22, p);
                    p.setTextAlign(Paint.Align.RIGHT);
                    c.drawText("USD و TRY كما سُجّلا — بدون تحويل", pageW - margin, pageH - 22, p);

                    doc.finishPage(page);
                    pageNo++;
                    if (clients.length() == 0) break;
                }

                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                doc.writeTo(bos);
                Uri uri = writeToDownloads(fileName, "application/pdf", bos.toByteArray());
                runOnUiThread(() -> shareUri(uri, "application/pdf", "مشاركة ملخص الديون"));
            } catch (Exception e) {
                toast("تعذر إنشاء PDF المختصر: " + e.getMessage());
            } finally {
                doc.close();
            }
        });
    }

    private SecretKey getOrCreateStateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(STATE_KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                STATE_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private String encryptState(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateStateKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decryptState(String packed) throws Exception {
        int dot = packed.indexOf('.');
        if (dot <= 0) throw new IOException("bad encrypted state");
        byte[] iv = Base64.decode(packed.substring(0, dot), Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(packed.substring(dot + 1), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateStateKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private synchronized void saveSecureStateInternal(String json) {
        try {
            if (stateReadBlocked || upgradeCheckpointFailed) throw new IOException("previous state is protected");
            new JSONObject(json);
            SharedPreferences prefs = getSharedPreferences(SECURE_PREFS, MODE_PRIVATE);
            String current = prefs.getString("state", null);
            String prev1 = prefs.getString("state_prev1", null);
            String prev2 = prefs.getString("state_prev2", null);
            SharedPreferences.Editor e = prefs.edit();
            if (prev2 != null) e.putString("state_prev3", prev2);
            if (prev1 != null) e.putString("state_prev2", prev1);
            if (current != null) e.putString("state_prev1", current);
            e.putString("state", encryptState(json));
            if (!e.commit()) throw new IOException("state commit failed");
        } catch (Exception ex) {
            throw new RuntimeException("secure state save failed", ex);
        }
    }

    private synchronized String loadSecureStateInternal() {
        SharedPreferences prefs = getSharedPreferences(SECURE_PREFS, MODE_PRIVATE);
        String[] slots = {"state", "state_prev1", "state_prev2", "state_prev3"};
        boolean hasExisting = false;
        for (String slot : slots) {
            String packed = prefs.getString(slot, null);
            if (packed == null || packed.isEmpty()) continue;
            hasExisting = true;
            try {
                String plain = decryptState(packed);
                new JSONObject(plain);
                stateReadBlocked = false;
                if (!"state".equals(slot)) {
                    prefs.edit().putString("state", packed).commit();
                    toast("تم استرجاع آخر نسخة محلية سليمة تلقائيًا");
                }
                return plain;
            } catch (Exception ignored) {}
        }
        if (hasExisting) {
            stateReadBlocked = true;
            return "{\"__read_error\":true}";
        }
        return "";
    }

    /** Keep the pre-update ciphertext immutable; never replace the previous key or preferences. */
    private synchronized void preserveUpgradeCheckpoint() {
        try {
            File folder = new File(getFilesDir(), "debt_recovery");
            if (!folder.exists() && !folder.mkdirs()) throw new IOException("checkpoint folder");
            File checkpoint = new File(folder, "before-v145.json");
            if (checkpoint.exists()) return;
            JSONObject packed = new JSONObject();
            SharedPreferences prefs = getSharedPreferences(SECURE_PREFS, MODE_PRIVATE);
            for (String key : new String[]{"state","state_prev1","state_prev2","state_prev3"}) {
                String value = prefs.getString(key,null); if(value!=null)packed.put(key,value);
            }
            if (packed.length()==0) return;
            File temp = new File(folder,"before-v145.tmp");
            try(FileOutputStream out = new FileOutputStream(temp)) {
                out.write(packed.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();
            }
            if(!temp.renameTo(checkpoint))throw new IOException("checkpoint rename");
        } catch(Exception e) { upgradeCheckpointFailed=true; }
    }

    private synchronized boolean restoreSecureStateChecked(String raw) {
        try {
            JSONObject incoming = new JSONObject(raw);
            if(!incoming.optBoolean("setupDone") || incoming.optJSONArray("clients")==null ||
              incoming.optJSONArray("entries")==null || incoming.optJSONArray("accounts")==null) return false;
            File folder = new File(getFilesDir(),"debt_recovery");
            if(!folder.exists()&&!folder.mkdirs())return false;
            SharedPreferences prefs = getSharedPreferences(SECURE_PREFS,MODE_PRIVATE);
            JSONObject before = new JSONObject();
            for(String key:new String[]{"state","state_prev1","state_prev2","state_prev3"}) {
                String value=prefs.getString(key,null);if(value!=null)before.put(key,value);
            }
            File snapshot=new File(folder,"before-restore-"+System.currentTimeMillis()+".json");
            try(FileOutputStream out = new FileOutputStream(snapshot)) {
                out.write(before.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();
            }
            String cipher=encryptState(raw);
            if(!prefs.edit().putString("state",cipher).commit())return false;
            stateReadBlocked=false;
            return true;
        }catch(Exception e){return false;}
    }

    private synchronized void saveCloudSessionInternal(JSONObject session) {
        try {
            SharedPreferences prefs = getSharedPreferences(CLOUD_PREFS, MODE_PRIVATE);
            if (session == null) {
                prefs.edit().clear().commit();
                return;
            }
            prefs.edit().putString("session", encryptState(session.toString())).commit();
        } catch (Exception e) {
            throw new RuntimeException("cloud session save failed", e);
        }
    }

    private synchronized JSONObject loadCloudSessionInternal() {
        try {
            String packed = getSharedPreferences(CLOUD_PREFS, MODE_PRIVATE).getString("session", null);
            if (packed == null || packed.isEmpty()) return null;
            return new JSONObject(decryptState(packed));
        } catch (Exception e) {
            getSharedPreferences(CLOUD_PREFS, MODE_PRIVATE).edit().clear().commit();
            return null;
        }
    }

    private JSONObject cloudStatusInternal() {
        JSONObject out = new JSONObject();
        try {
            JSONObject session = loadCloudSessionInternal();
            if (session == null) {
                out.put("signedIn", false);
                return out;
            }
            JSONObject user = session.optJSONObject("user");
            out.put("signedIn", true);
            out.put("userId", user == null ? "" : user.optString("id", ""));
            out.put("email", user == null ? "" : user.optString("email", ""));
        } catch (Exception ignored) {}
        return out;
    }

    private JSONObject cloudHttp(String method, String path, String body, String bearer, boolean prefer) throws Exception {
        if (path == null || !path.startsWith("/")) throw new IOException("invalid cloud path");
        HttpURLConnection conn = (HttpURLConnection) new URL(SUPABASE_URL + path).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod(method);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("apikey", SUPABASE_KEY);
        if (bearer != null && !bearer.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + bearer);
        if (prefer) conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=representation");
        if (("POST".equals(method) || "PATCH".equals(method)) && body != null) {
            conn.setDoOutput(true);
            try (OutputStream out = conn.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = conn.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
        String text = stream == null ? "" : readAll(stream).trim();
        conn.disconnect();
        JSONObject result = new JSONObject();
        result.put("ok", code >= 200 && code < 300);
        result.put("status", code);
        if (!text.isEmpty()) {
            try {
                Object data = text.startsWith("[") ? new JSONArray(text) : text.startsWith("{") ? new JSONObject(text) : text;
                result.put("data", data);
            } catch (Exception e) { result.put("data", text); }
        } else result.put("data", JSONObject.NULL);
        return result;
    }

    private JSONObject doCloudAuth(String action, String email, String password) throws Exception {
        String path;
        if ("signup".equals(action)) path = "/auth/v1/signup";
        else if ("signin".equals(action)) path = "/auth/v1/token?grant_type=password";
        else throw new IOException("unsupported auth action");
        JSONObject payload = new JSONObject();
        payload.put("email", email == null ? "" : email.trim());
        payload.put("password", password == null ? "" : password);
        JSONObject raw = cloudHttp("POST", path, payload.toString(), null, false);
        if (!raw.optBoolean("ok")) return raw;
        Object obj = raw.opt("data");
        JSONObject data = obj instanceof JSONObject ? (JSONObject) obj : new JSONObject();
        String access = data.optString("access_token", "");
        JSONObject result = new JSONObject();
        result.put("ok", true);
        JSONObject user = data.optJSONObject("user");
        if (!access.isEmpty()) {
            saveCloudSessionInternal(data);
            result.put("signedIn", true);
            result.put("userId", user == null ? "" : user.optString("id", ""));
            result.put("email", user == null ? email : user.optString("email", email));
        } else {
            result.put("signedIn", false);
            result.put("needsEmailConfirmation", true);
            result.put("userId", user == null ? "" : user.optString("id", ""));
            result.put("email", user == null ? email : user.optString("email", email));
        }
        return result;
    }

    private JSONObject refreshCloudSessionInternal() throws Exception {
        JSONObject session = loadCloudSessionInternal();
        if (session == null) throw new IOException("not signed in");
        String refresh = session.optString("refresh_token", "");
        if (refresh.isEmpty()) throw new IOException("missing refresh token");
        JSONObject body = new JSONObject().put("refresh_token", refresh);
        JSONObject raw = cloudHttp("POST", "/auth/v1/token?grant_type=refresh_token", body.toString(), null, false);
        if (!raw.optBoolean("ok")) throw new IOException("session refresh failed");
        Object dataObj = raw.opt("data");
        if (!(dataObj instanceof JSONObject)) throw new IOException("invalid session refresh");
        JSONObject data = (JSONObject) dataObj;
        saveCloudSessionInternal(data);
        return data;
    }

    private boolean allowedCloudPath(String path) {
        if (path == null) return false;
        String base = path.split("\\?", 2)[0];
        return base.equals("/rest/v1/stores") || base.equals("/rest/v1/store_members") ||
                base.equals("/rest/v1/customers") || base.equals("/rest/v1/transactions") ||
                base.equals("/rest/v1/products") || base.equals("/rest/v1/invoices") || base.equals("/rest/v1/invoice_items") ||
                base.equals("/rest/v1/whatsapp_notifications") || base.equals("/functions/v1/send-whatsapp") ||
                base.equals("/rest/v1/rpc/create_store") || base.equals("/rest/v1/rpc/join_store");
    }

    private JSONObject authorizedCloudRequest(String method, String path, String body) throws Exception {
        if (!allowedCloudPath(path)) throw new IOException("cloud path not allowed");
        if (!("GET".equals(method) || "POST".equals(method) || "PATCH".equals(method))) throw new IOException("cloud method not allowed");
        JSONObject session = loadCloudSessionInternal();
        if (session == null) throw new IOException("not signed in");
        String access = session.optString("access_token", "");
        JSONObject result = cloudHttp(method, path, body, access, "POST".equals(method) || "PATCH".equals(method));
        if (result.optInt("status") == 401) {
            session = refreshCloudSessionInternal();
            access = session.optString("access_token", "");
            result = cloudHttp(method, path, body, access, "POST".equals(method) || "PATCH".equals(method));
        }
        return result;
    }

    private void cloudCallback(String requestId, JSONObject result) {
        js("window.onCloudNativeResult && window.onCloudNativeResult(" + JSONObject.quote(requestId == null ? "" : requestId) + "," + result.toString() + ")");
    }

    private void realtimeEvent(String type, String payload) {
        String safePayload = payload == null ? "{}" : payload;
        js("window.onCloudRealtimeEvent && window.onCloudRealtimeEvent(" + JSONObject.quote(type) + "," + JSONObject.quote(safePayload) + ")");
    }

    private synchronized void stopRealtimeInternal() {
        realtimeWanted = false;
        if (realtimeHeartbeat != null) {
            realtimeHeartbeat.cancel(true);
            realtimeHeartbeat = null;
        }
        WebSocket ws = realtimeSocket;
        realtimeSocket = null;
        if (ws != null) {
            try { ws.close(1000, "app_stop"); } catch (Exception ignored) {}
        }
    }

    private void scheduleRealtimeReconnect() {
        if (!realtimeWanted || realtimeStoreId == null || realtimeStoreId.isEmpty()) return;
        realtimeScheduler.schedule(() -> {
            if (realtimeWanted && realtimeSocket == null) startRealtimeInternal(realtimeStoreId);
        }, 5, TimeUnit.SECONDS);
    }

    private synchronized void startRealtimeInternal(String storeId) {
        if (storeId == null || storeId.trim().isEmpty()) return;
        realtimeWanted = true;
        realtimeStoreId = storeId.trim();
        WebSocket old = realtimeSocket;
        realtimeSocket = null;
        if (old != null) try { old.close(1000, "restart"); } catch (Exception ignored) {}
        if (realtimeHeartbeat != null) { realtimeHeartbeat.cancel(true); realtimeHeartbeat = null; }
        try {
            JSONObject session = loadCloudSessionInternal();
            if (session == null) { realtimeEvent("error", "not_signed_in"); return; }
            String access = session.optString("access_token", "");
            if (access.isEmpty()) { realtimeEvent("error", "missing_access_token"); return; }
            String wsBase = SUPABASE_URL.replaceFirst("^https://", "wss://").replaceFirst("^http://", "ws://");
            String url = wsBase + "/realtime/v1/websocket?apikey=" + URLEncoder.encode(SUPABASE_KEY, "UTF-8") + "&vsn=1.0.0";
            Request request = new Request.Builder().url(url).build();
            final String topic = "realtime:store-" + realtimeStoreId;
            realtimeSocket = realtimeHttp.newWebSocket(request, new WebSocketListener() {
                @Override public void onOpen(WebSocket webSocket, Response response) {
                    try {
                        JSONArray changes = new JSONArray();
                        changes.put(new JSONObject().put("event", "*").put("schema", "public").put("table", "transactions").put("filter", "store_id=eq." + realtimeStoreId));
                        changes.put(new JSONObject().put("event", "*").put("schema", "public").put("table", "customers").put("filter", "store_id=eq." + realtimeStoreId));
                        changes.put(new JSONObject().put("event", "*").put("schema", "public").put("table", "products").put("filter", "store_id=eq." + realtimeStoreId));
                        changes.put(new JSONObject().put("event", "*").put("schema", "public").put("table", "invoices").put("filter", "store_id=eq." + realtimeStoreId));
                        changes.put(new JSONObject().put("event", "*").put("schema", "public").put("table", "invoice_items").put("filter", "store_id=eq." + realtimeStoreId));
                        changes.put(new JSONObject().put("event", "*").put("schema", "public").put("table", "store_members").put("filter", "store_id=eq." + realtimeStoreId));
                        changes.put(new JSONObject().put("event", "*").put("schema", "public").put("table", "stores").put("filter", "id=eq." + realtimeStoreId));
                        JSONObject config = new JSONObject()
                                .put("broadcast", new JSONObject().put("ack", false).put("self", false))
                                .put("presence", new JSONObject().put("key", ""))
                                .put("postgres_changes", changes);
                        String ref = String.valueOf(realtimeRef++);
                        JSONObject join = new JSONObject().put("topic", topic).put("event", "phx_join")
                                .put("payload", new JSONObject().put("config", config).put("access_token", access))
                                .put("ref", ref).put("join_ref", ref);
                        webSocket.send(join.toString());
                        realtimeHeartbeat = realtimeScheduler.scheduleAtFixedRate(() -> {
                            try {
                                WebSocket current = realtimeSocket;
                                if (current != null) {
                                    String hRef = String.valueOf(realtimeRef++);
                                    current.send(new JSONObject().put("topic", "phoenix").put("event", "heartbeat").put("payload", new JSONObject()).put("ref", hRef).toString());
                                }
                            } catch (Exception ignored) {}
                        }, 20, 20, TimeUnit.SECONDS);
                    } catch (Exception e) { realtimeEvent("error", e.getMessage()); }
                }
                @Override public void onMessage(WebSocket webSocket, String text) {
                    try {
                        JSONObject m = new JSONObject(text);
                        String event = m.optString("event", "");
                        if ("phx_reply".equals(event)) {
                            JSONObject payload = m.optJSONObject("payload");
                            if (payload != null && "ok".equals(payload.optString("status"))) realtimeEvent("connected", "{}");
                        } else if ("postgres_changes".equals(event)) {
                            realtimeEvent("change", text);
                        }
                    } catch (Exception ignored) {}
                }
                @Override public void onClosing(WebSocket webSocket, int code, String reason) {
                    realtimeEvent("disconnected", reason == null ? "" : reason);
                }
                @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                    if (realtimeSocket == webSocket) realtimeSocket = null;
                    realtimeEvent("disconnected", reason == null ? "" : reason);
                    scheduleRealtimeReconnect();
                }
                @Override public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                    if (realtimeSocket == webSocket) realtimeSocket = null;
                    realtimeEvent("error", t == null ? "realtime_failed" : String.valueOf(t.getMessage()));
                    scheduleRealtimeReconnect();
                }
            });
        } catch (Exception e) {
            realtimeSocket = null;
            realtimeEvent("error", e.getMessage());
            scheduleRealtimeReconnect();
        }
    }

    private String strongPinHash(String pin) {
        try {
            PBEKeySpec spec = new PBEKeySpec(String.valueOf(pin).toCharArray(), PIN_SALT.getBytes(StandardCharsets.UTF_8), 60000, 256);
            byte[] hash = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            spec.clearPassword();
            return "v2$" + Base64.encodeToString(hash, Base64.NO_WRAP);
        } catch (Exception e) {
            return "v2$error";
        }
    }

    private String trim(String s, int max) {
        if (s == null) return "";
        if (s.length() <= max) return s;
        return s.substring(0, Math.max(1, max - 1)) + "…";
    }

    private void showLocalNotification(String title, String body) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new android.app.Notification.Builder(this, CHANNEL_ID)
                : new android.app.Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new android.app.Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi);
        manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), builder.build());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == BARCODE_PHOTO_REQUEST) {
            if (resultCode == RESULT_OK && barcodePhotoFile != null) decodeBarcodePhotoAsync(barcodePhotoFile);
            else {
                barcodeScanInProgress = false;
                cleanupBarcodePhoto();
                js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");
            }
            return;
        }
        if (requestCode == PICK_BACKUP_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                ioExecutor.execute(() -> {
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new IOException("تعذر قراءة الملف");
                        String text = readAll(in);
                        js("window.onNativeBackupPicked && window.onNativeBackupPicked(" + JSONObject.quote(text) + ")");
                    } catch (Exception e) {
                        toast("تعذر قراءة النسخة الاحتياطية");
                    }
                });
            } else {
                js("window.onNativeBackupCancelled && window.onNativeBackupCancelled()");
            }
        }
    }

    public class AppBridge {
        private final Context context;
        AppBridge(Context context) { this.context = context; }

        @JavascriptInterface
        public String loadSecureState() {
            return loadSecureStateInternal();
        }

        @JavascriptInterface
        public void saveSecureState(String json) {
            saveSecureStateInternal(json);
        }

        @JavascriptInterface
        public boolean saveSecureStateChecked(String json) {
            try { saveSecureStateInternal(json); return true; } catch(Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean restoreSecureState(String json) { return restoreSecureStateChecked(json); }

        @JavascriptInterface
        public void restartAfterRestore() { runOnUiThread(() -> recreate()); }

        @JavascriptInterface
        public boolean preserveLegacyState(String json) {
            try {
                new JSONObject(json);
                File folder=new File(getFilesDir(),"debt_recovery");
                if(!folder.exists()&&!folder.mkdirs())return false;
                File f=new File(folder,"legacy-before-v145.enc");
                if(f.exists())return true;
                try(FileOutputStream out=new FileOutputStream(f)){
                    out.write(encryptState(json).getBytes(StandardCharsets.UTF_8));out.getFD().sync();
                }
                return true;
            }catch(Exception e){return false;}
        }

        @JavascriptInterface
        public String serviceStatus() { return debtService.status().toString(); }

        @JavascriptInterface
        public void serviceRequest(String action, String arguments, String requestId) {
            if(requestId==null||!requestId.matches("[A-Za-z0-9-]{1,90}"))return;
            ioExecutor.execute(() -> {
                JSONObject result;
                try { result=debtService.request(action,arguments); }
                catch(Exception e){result=DebtService.error("SERVICE_UNAVAILABLE");}
                js("window.onDebtServiceResult && window.onDebtServiceResult("+JSONObject.quote(requestId)+","+result.toString()+")");
            });
        }

        @JavascriptInterface
        public String hashPin(String pin) {
            return strongPinHash(pin);
        }

        @JavascriptInterface
        public String cloudStatus() {
            return cloudStatusInternal().toString();
        }

        @JavascriptInterface
        public void cloudAuth(String action, String email, String password, String requestId) {
            ioExecutor.execute(() -> {
                JSONObject result = new JSONObject();
                try { result = doCloudAuth(action, email, password); }
                catch (Exception e) {
                    try { result.put("ok", false).put("error", e.getMessage() == null ? "تعذر تسجيل الدخول" : e.getMessage()); } catch (Exception ignored) {}
                }
                cloudCallback(requestId, result);
            });
        }

        @JavascriptInterface
        public void cloudRequest(String method, String path, String body, String requestId) {
            ioExecutor.execute(() -> {
                JSONObject result = new JSONObject();
                try { result = authorizedCloudRequest(method == null ? "GET" : method.toUpperCase(Locale.US), path, body); }
                catch (Exception e) {
                    try { result.put("ok", false).put("error", e.getMessage() == null ? "تعذر الاتصال بالمتجر" : e.getMessage()); } catch (Exception ignored) {}
                }
                cloudCallback(requestId, result);
            });
        }

        @JavascriptInterface
        public void cloudSignOut(String requestId) {
            ioExecutor.execute(() -> {
                JSONObject result = new JSONObject();
                try {
                    JSONObject session = loadCloudSessionInternal();
                    if (session != null) {
                        String access = session.optString("access_token", "");
                        try { cloudHttp("POST", "/auth/v1/logout", "{}", access, false); } catch (Exception ignored) {}
                    }
                    saveCloudSessionInternal(null);
                    result.put("ok", true);
                } catch (Exception e) {
                    try { result.put("ok", false).put("error", "تعذر تسجيل الخروج"); } catch (Exception ignored) {}
                }
                cloudCallback(requestId, result);
            });
        }

        @JavascriptInterface
        public void cloudRealtimeStart(String storeId) {
            ioExecutor.execute(() -> startRealtimeInternal(storeId));
        }

        @JavascriptInterface
        public void cloudRealtimeStop() {
            ioExecutor.execute(() -> stopRealtimeInternal());
        }

        @JavascriptInterface
        public void copyText(String text) {
            ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cb != null) cb.setPrimaryClip(ClipData.newPlainText("UCHIHA", text));
            toast("تم النسخ");
        }

        @JavascriptInterface
        public void shareText(String title, String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_SUBJECT, title);
                send.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(send, title));
            });
        }

        @JavascriptInterface
        public void refreshRates() { fetchRates(); }

        @JavascriptInterface
        public void exportCsv(String csv, String fileName) {
            exportTextFile(csv, fileName, "text/csv", true);
        }

        @JavascriptInterface
        public void exportBackup(String json, String fileName) {
            exportTextFile(json, fileName, "application/json", false);
        }

        @JavascriptInterface
        public void exportPdf(String json, String fileName) {
            exportClientPdf(json, fileName);
        }

        @JavascriptInterface
        public void exportDebtSummaryPdf(String json, String fileName) {
            MainActivity.this.exportDebtSummaryPdf(json, fileName);
        }

        @JavascriptInterface
        public void exportShortagesPdf(String json, String fileName) {
            MainActivity.this.exportShortagesPdf(json, fileName);
        }

        @JavascriptInterface
        public void exportInvoicePdf(String json, String fileName) {
            MainActivity.this.exportInvoicePdf(json, fileName);
        }

        @JavascriptInterface
        public void scanBarcode() {
            runOnUiThread(() -> MainActivity.this.openBarcodeScannerSafely());
        }

        @JavascriptInterface
        public void pickBackup() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                try { startActivityForResult(intent, PICK_BACKUP_REQUEST); }
                catch (ActivityNotFoundException e) { toast("لا يوجد مدير ملفات متاح"); }
            });
        }

        @JavascriptInterface
        public void notifyUser(String title, String body) {
            runOnUiThread(() -> showLocalNotification(title, body));
        }

        @JavascriptInterface
        public void requestBiometric(String callbackName) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
                js("window." + safeCallback(callbackName) + " && window." + safeCallback(callbackName) + "(false,'unsupported')");
                return;
            }
            runOnUiThread(() -> {
                try {
                    Executor executor = getMainExecutor();
                    CancellationSignal cancel = new CancellationSignal();
                    BiometricPrompt prompt = new BiometricPrompt.Builder(MainActivity.this)
                            .setTitle("تأكيد العملية")
                            .setSubtitle("استخدم بصمة الإصبع")
                            .setDescription("يتم التحقق بواسطة نظام أمان الهاتف ولا يخزن التطبيق بيانات البصمة")
                            .setNegativeButton("استخدام PIN", executor, (dialog, which) ->
                                    js("window." + safeCallback(callbackName) + " && window." + safeCallback(callbackName) + "(false,'pin')"))
                            .build();
                    prompt.authenticate(cancel, executor, new BiometricPrompt.AuthenticationCallback() {
                        @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            js("window." + safeCallback(callbackName) + " && window." + safeCallback(callbackName) + "(true,'biometric')");
                        }
                        @Override public void onAuthenticationError(int errorCode, CharSequence errString) {
                            js("window." + safeCallback(callbackName) + " && window." + safeCallback(callbackName) + "(false," + JSONObject.quote(errString.toString()) + ")");
                        }
                        @Override public void onAuthenticationFailed() {
                            // Keep prompt open; no JS callback until success/cancel/error.
                        }
                    });
                } catch (Exception e) {
                    js("window." + safeCallback(callbackName) + " && window." + safeCallback(callbackName) + "(false,'unavailable')");
                }
            });
        }

        private String safeCallback(String name) {
            if (name == null || !name.matches("[A-Za-z0-9_.$]+")) return "onBiometricResult";
            return name;
        }
    }
}
