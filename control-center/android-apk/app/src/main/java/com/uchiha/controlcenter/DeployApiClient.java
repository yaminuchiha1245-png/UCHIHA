package com.uchiha.controlcenter;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

final class DeployApiClient {
    private static final int CONNECT_TIMEOUT_MS = 10000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final int MAX_RESPONSE_BYTES = 512 * 1024;

    private DeployApiClient() {}

    static JSONObject status(String token, String projectId) throws Exception {
        return request("GET", projectPath(projectId) + "/deploy", null, token).optJSONObject("deploy");
    }

    static JSONObject plan(String token, String projectId) throws Exception {
        return request("POST", projectPath(projectId) + "/deploy/plan", new JSONObject(), token).getJSONObject("deploy");
    }

    static JSONObject approve(String token, String projectId) throws Exception {
        return request("POST", projectPath(projectId) + "/deploy/approve", new JSONObject(), token).getJSONObject("deploy");
    }

    static JSONObject start(String token, String projectId) throws Exception {
        return request("POST", projectPath(projectId) + "/deploy/start", new JSONObject(), token).getJSONObject("deploy");
    }

    private static String projectPath(String projectId) throws IOException {
        String value = projectId == null ? "" : projectId.trim();
        if (!value.matches("[a-zA-Z0-9._-]+")) throw new IOException("Invalid project id.");
        return "/projects/" + value;
    }

    private static JSONObject request(String method, String path, JSONObject body, String token) throws Exception {
        URL url = new URL(BuildConfig.API_BASE_URL + path);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IOException("API endpoint must use HTTPS.");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("User-Agent", "UCHIHA-Control-Center-Android");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            connection.setDoOutput(true);
            byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) { output.write(data); }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String text = stream == null ? "{}" : readLimited(stream);
        JSONObject response;
        try { response = new JSONObject(text.isEmpty() ? "{}" : text); }
        catch (Exception error) { throw new IOException("Invalid API response."); }
        finally { connection.disconnect(); }
        if (status < 200 || status >= 300) {
            throw new DeployException(status, response.optString("error", "deploy_request_failed"));
        }
        return response;
    }

    private static String readLimited(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) throw new IOException("Deploy response too large.");
                out.write(buffer, 0, count);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    static final class DeployException extends IOException {
        final int status;
        final String code;
        DeployException(int status, String code) {
            super(code);
            this.status = status;
            this.code = code;
        }
    }
}
