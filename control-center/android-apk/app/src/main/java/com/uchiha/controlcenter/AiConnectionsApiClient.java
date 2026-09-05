package com.uchiha.controlcenter;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

final class AiConnectionsApiClient {
    private static final int CONNECT_TIMEOUT_MS = 10000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;

    private AiConnectionsApiClient() {}

    static JSONObject providers(String token) throws Exception {
        return request("GET", "/ai/providers", null, token);
    }

    static JSONObject connect(String token, String provider, String apiKey) throws Exception {
        JSONObject body = new JSONObject();
        body.put("apiKey", apiKey == null ? "" : apiKey.trim());
        return request("POST", providerPath(provider), body, token);
    }

    static JSONObject disconnect(String token, String provider) throws Exception {
        return request("DELETE", providerPath(provider), null, token);
    }

    static JSONObject models(String token, String provider) throws Exception {
        return request("GET", providerPath(provider) + "/models", null, token);
    }

    private static String providerPath(String provider) throws IOException {
        String value = provider == null ? "" : provider.trim().toLowerCase();
        if (!value.matches("openai|anthropic|gemini")) throw new IOException("Invalid AI provider.");
        return "/ai/providers/" + value;
    }

    private static JSONObject request(String method, String path, JSONObject body, String token) throws Exception {
        URL url = new URL(BuildConfig.API_BASE_URL + path);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IOException("API endpoint must use HTTPS.");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("User-Agent", "UCHIHA-Control-Center-Android/2.0.0-alpha16");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            connection.setDoOutput(true);
            byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) { output.write(data); }
        }
        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
            connection.disconnect();
            throw new IOException("Redirect rejected.");
        }
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String text = stream == null ? "{}" : readLimited(stream);
        JSONObject response;
        try { response = new JSONObject(text.isEmpty() ? "{}" : text); }
        catch (Exception error) { throw new IOException("Invalid API response."); }
        finally { connection.disconnect(); }
        if (status < 200 || status >= 300) throw new AiException(status, response.optString("error", "ai_request_failed"));
        return response;
    }

    private static String readLimited(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) throw new IOException("AI response too large.");
                out.write(buffer, 0, count);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    static final class AiException extends IOException {
        final int status;
        final String code;

        AiException(int status, String code) {
            super(code);
            this.status = status;
            this.code = code;
        }
    }
}
