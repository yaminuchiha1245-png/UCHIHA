package com.uchiha.controlcenter;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionStore {
    private static final String PREFS = "uchiha_secure_session";
    private static final String KEY_ALIAS = "uchiha_control_center_session_key_v1";
    private static final String PREF_IV = "iv";
    private static final String PREF_DATA = "data";

    private final SharedPreferences prefs;

    SessionStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void save(AuthSession session) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] cipherText = cipher.doFinal(session.toJson().toString().getBytes(StandardCharsets.UTF_8));
        prefs.edit()
                .putString(PREF_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString(PREF_DATA, Base64.encodeToString(cipherText, Base64.NO_WRAP))
                .apply();
    }

    AuthSession load() {
        String ivEncoded = prefs.getString(PREF_IV, null);
        String dataEncoded = prefs.getString(PREF_DATA, null);
        if (ivEncoded == null || dataEncoded == null) return null;
        try {
            byte[] iv = Base64.decode(ivEncoded, Base64.NO_WRAP);
            byte[] cipherText = Base64.decode(dataEncoded, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            byte[] plain = cipher.doFinal(cipherText);
            AuthSession session = AuthSession.fromJson(new JSONObject(new String(plain, StandardCharsets.UTF_8)));
            if (session.isExpired()) {
                clear();
                return null;
            }
            return session;
        } catch (Exception ignored) {
            clear();
            return null;
        }
    }

    void clear() {
        prefs.edit().clear().apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
