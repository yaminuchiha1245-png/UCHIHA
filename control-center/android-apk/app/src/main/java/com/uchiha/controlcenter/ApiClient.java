package com.uchiha.controlcenter;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

final class ApiClient {
    private static final int CONNECT_TIMEOUT_MS = 10000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    private ApiClient() {}

    static JSONObject setupStatus() throws Exception {
        return request("GET", "/setup", null, null);
    }

    static AuthSession createInitialOwner(String setupCode, String username, String displayName,
                                          String password) throws Exception {
        JSONObject body = new JSONObject();
        body.put("setupCode", setupCode);
        body.put("username", username);
        body.put("displayName", displayName);
        body.put("password", password);
        JSONObject response = request("POST", "/setup/owner", body, null);
        return AuthSession.fromLoginResponse(response);
    }

    static AuthSession login(String username, String password) throws Exception {
        JSONObject body = new JSONObject();
        body.put("username", username);
        body.put("password", password);
        JSONObject response = request("POST", "/auth/login", body, null);
        return AuthSession.fromLoginResponse(response);
    }

    static JSONObject me(String token) throws Exception {
        return request("GET", "/me", null, token);
    }

    static JSONArray listProjects(String token) throws Exception {
        return request("GET", "/projects", null, token).getJSONArray("items");
    }

    static JSONObject getProject(String token, String projectId) throws Exception {
        return request("GET", "/projects/" + safeProjectId(projectId), null, token).getJSONObject("project");
    }

    static JSONObject previewStatus(String token, String projectId) throws Exception {
        return request("GET", "/projects/" + safeProjectId(projectId) + "/preview", null, token);
    }

    static String previewEntryUrl(String projectId) throws IOException {
        return BuildConfig.API_BASE_URL + "/projects/" + safeProjectId(projectId) + "/preview/files/index.html";
    }

    static String previewPrefixUrl(String projectId) throws IOException {
        return BuildConfig.API_BASE_URL + "/projects/" + safeProjectId(projectId) + "/preview/files/";
    }

    static JSONObject previewSource(String token, String projectId, String sourcePath) throws Exception {
        String path = sourcePath == null || sourcePath.trim().isEmpty() ? "index.html" : sourcePath.trim();
        if (path.length() > 500) throw new IOException("Invalid preview source path.");
        String encoded = URLEncoder.encode(path, StandardCharsets.UTF_8.name()).replace("+", "%20");
        return request("GET", "/projects/" + safeProjectId(projectId) + "/preview/source?path=" + encoded, null, token);
    }

    static JSONObject githubStatus(String token) throws Exception {
        return request("GET", "/connections/github", null, token).getJSONObject("github");
    }

    static JSONObject connectGithub(String token, String githubToken) throws Exception {
        JSONObject body = new JSONObject();
        body.put("token", githubToken);
        return request("POST", "/connections/github", body, token).getJSONObject("github");
    }

    static void disconnectGithub(String token) throws Exception {
        request("DELETE", "/connections/github", null, token);
    }

    static JSONArray listGithubRepos(String token) throws Exception {
        return request("GET", "/github/repos", null, token).getJSONArray("items");
    }

    static JSONObject projectGithubStatus(String token, String projectId) throws Exception {
        return request("GET", "/projects/" + safeProjectId(projectId) + "/github", null, token);
    }

    static JSONObject linkProjectGithub(String token, String projectId, String repository) throws Exception {
        JSONObject body = new JSONObject();
        body.put("repository", repository);
        return request("POST", "/projects/" + safeProjectId(projectId) + "/github", body, token)
                .getJSONObject("binding");
    }

    static JSONArray listServers(String token) throws Exception {
        return request("GET", "/servers", null, token).getJSONArray("items");
    }

    static JSONObject projectServerStatus(String token, String projectId) throws Exception {
        return request("GET", "/projects/" + safeProjectId(projectId) + "/server", null, token);
    }

    static JSONObject createServer(String token, String projectId, String label, String host,
                                   int port, String username, String password) throws Exception {
        JSONObject body = new JSONObject();
        body.put("projectId", safeProjectId(projectId));
        body.put("label", label);
        body.put("host", host);
        body.put("port", port);
        body.put("username", username);
        body.put("password", password);
        return request("POST", "/servers", body, token);
    }

    static JSONObject bindProjectServer(String token, String projectId, String serverId) throws Exception {
        JSONObject body = new JSONObject();
        body.put("serverId", serverId);
        return request("POST", "/projects/" + safeProjectId(projectId) + "/server", body, token)
                .getJSONObject("binding");
    }

    static JSONObject testServer(String token, String serverId) throws Exception {
        if (serverId == null || !serverId.matches("srv_[a-zA-Z0-9_-]+")) throw new IOException("Invalid server id.");
        return request("POST", "/servers/" + serverId + "/test", new JSONObject(), token)
                .getJSONObject("server");
    }

    static JSONArray listTeam(String token) throws Exception {
        return request("GET", "/team", null, token).getJSONArray("users");
    }

    static JSONObject createTeamUser(String token, String username, String displayName,
                                     String password, String role) throws Exception {
        JSONObject body = new JSONObject();
        body.put("username", username);
        body.put("displayName", displayName);
        body.put("password", password);
        body.put("role", role);
        return request("POST", "/team", body, token).getJSONObject("user");
    }

    static void logout(String token) {
        try {
            request("POST", "/auth/logout", new JSONObject(), token);
        } catch (Exception ignored) {
            // Local logout must still work even when the server is unreachable.
        }
    }

    private static String safeProjectId(String projectId) throws IOException {
        String safeId = projectId == null ? "" : projectId.replaceAll("[^a-zA-Z0-9._-]", "");
        if (safeId.isEmpty() || !safeId.equals(projectId)) throw new IOException("Invalid project id.");
        return safeId;
    }

    private static JSONObject request(String method, String path, JSONObject body, String token) throws Exception {
        URL url = new URL(BuildConfig.API_BASE_URL + path);
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new IOException("API endpoint must use HTTPS.");
        }

        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("User-Agent", "UCHIHA-Control-Center-Android");
        if (token != null && !token.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + token);
        }

        if (body != null) {
            connection.setDoOutput(true);
            byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(data);
            }
        }

        int status = connection.getResponseCode();
        InputStream input = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
        String text = input == null ? "{}" : readLimited(input);
        JSONObject response;
        try {
            response = new JSONObject(text.isEmpty() ? "{}" : text);
        } catch (Exception parseError) {
            throw new IOException("Invalid API response.");
        } finally {
            connection.disconnect();
        }

        if (status < 200 || status >= 300) {
            String error = response.optString("error", "request_failed");
            throw new ApiException(status, error);
        }
        return response;
    }

    private static String readLimited(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new IOException("API response too large.");
                out.write(buffer, 0, read);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    static final class ApiException extends IOException {
        final int status;
        final String code;

        ApiException(int status, String code) {
            super(code);
            this.status = status;
            this.code = code;
        }
    }
}
