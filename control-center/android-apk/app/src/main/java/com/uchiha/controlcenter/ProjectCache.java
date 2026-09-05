package com.uchiha.controlcenter;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;

final class ProjectCache {
    private static final String PREFS = "uchiha_project_cache";
    private static final String KEY_ITEMS = "items";
    private static final String KEY_SYNCED_AT = "synced_at";

    private final SharedPreferences prefs;

    ProjectCache(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
