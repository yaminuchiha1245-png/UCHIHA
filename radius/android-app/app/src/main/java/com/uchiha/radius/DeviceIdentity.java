package com.uchiha.radius;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

/**
 * App-scoped installation identity used for server-side activation binding.
 *
 * This deliberately avoids IMEI, phone number, MAC address and other hardware
 * identifiers. The value survives normal app updates and is regenerated only
 * when the app data is cleared/uninstalled.
 */
public final class DeviceIdentity {
    private static final String PREFS = "uchiha_radius_device";
    private static final String KEY_INSTALLATION_ID = "installation_id";

    private DeviceIdentity() {
    }

    public static String getOrCreate(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String existing = prefs.getString(KEY_INSTALLATION_ID, "");
        if (existing != null && existing.matches("[0-9a-fA-F-]{36}")) {
            return existing.toLowerCase();
        }

        String created = UUID.randomUUID().toString().toLowerCase();
        prefs.edit().putString(KEY_INSTALLATION_ID, created).apply();
        return created;
    }
}
