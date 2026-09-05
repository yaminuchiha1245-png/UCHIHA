package com.uchiha.controlcenter;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;

final class ProjectCache {
    private static final String PREFS_PREFIX = "uchiha_project_cache_";
    private static final String KEY_ITEMS = "items";
    private static final String KEY_SYNCED_AT = "synced_at";

    private final SharedPreferences prefs;

    ProjectCache(Context context, String userId) {
        String safeUserId = userId == null ? "anonymous" : userId.replaceAll("[^a-zA-Z0-9_-]", "_");
        prefs = context.getSharedPreferences(PREFS_PREFIX + safeUserId, Context.MODE_PRIVATE);
    }

    void save(JSONArray items) {
        prefs.edit()
                .putString(KEY_ITEMS, items == null ? "[]" : items.toString())
                .putLong(KEY_SYNCED_AT, System.currentTimeMillis())
                .apply();
    }

    JSONArray load() {
        String raw = prefs.getString(KEY_ITEMS, "[]");
        try {
            return new JSONArray(raw == null ? "[]" : raw);
        } catch (Exception ignored) {
            clear();
            return new JSONArray();
        }
    }

    long syncedAt() {
        return prefs.getLong(KEY_SYNCED_AT, 0L);
    }

    void clear() {
        prefs.edit().clear().apply();
    }
}
