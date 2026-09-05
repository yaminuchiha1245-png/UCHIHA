package com.uchiha.controlcenter;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

final class AuthSession {
    final String token;
    final String expiresAt;
    final String userId;
    final String username;
    final String displayName;
    final String role;
    final Set<String> capabilities;

    AuthSession(String token, String expiresAt, String userId, String username,
                String displayName, String role, Set<String> capabilities) {
        this.token = token;
        this.expiresAt = expiresAt;
        this.userId = userId;
        this.username = username;
        this.displayName = displayName;
        this.role = role;
        this.capabilities = capabilities;
    }

    boolean isExpired() {
        try {
            return !Instant.parse(expiresAt).isAfter(Instant.now());
        } catch (Exception ignored) {
            return true;
        }
    }

    boolean can(String capability) {
        return capabilities.contains(capability);
    }

    JSONObject toJson() throws JSONException {
        JSONObject object = new JSONObject();
        object.put("token", token);
        object.put("expiresAt", expiresAt);
        object.put("userId", userId);
        object.put("username", username);
        object.put("displayName", displayName);
        object.put("role", role);
        JSONArray caps = new JSONArray();
        for (String capability : capabilities) caps.put(capability);
        object.put("capabilities", caps);
        return object;
    }

    static AuthSession fromJson(JSONObject object) throws JSONException {
        Set<String> caps = new HashSet<>();
        JSONArray array = object.optJSONArray("capabilities");
        if (array != null) {
            for (int i = 0; i < array.length(); i++) caps.add(array.getString(i));
        }
        return new AuthSession(
                object.getString("token"),
                object.getString("expiresAt"),
                object.getString("userId"),
                object.getString("username"),
                object.getString("displayName"),
                object.getString("role"),
                caps
        );
    }

    static AuthSession fromLoginResponse(JSONObject root) throws JSONException {
        JSONObject user = root.getJSONObject("user");
        Set<String> caps = new HashSet<>();
        JSONArray array = root.optJSONArray("capabilities");
        if (array != null) {
            for (int i = 0; i < array.length(); i++) caps.add(array.getString(i));
        }
        return new AuthSession(
                root.getString("token"),
                root.getString("expiresAt"),
                user.getString("id"),
                user.getString("username"),
                user.optString("displayName", user.getString("username")),
                user.getString("role"),
                caps
        );
    }
}
