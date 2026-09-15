package com.uchiha.radius;

import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Short-lived in-memory router credentials.
 *
 * No credential is written to SharedPreferences, WebView storage, logs or disk.
 * Future native RouterOS operations receive only a session id from the web UI and
 * resolve the secret inside the Android process.
 */
final class RouterCredentialVault {
    static final long TTL_MS = 5 * 60 * 1000L;

    interface CredentialUse<T> {
        T run(String host, char[] username, char[] password) throws Exception;
    }

    private static final Map<String, Entry> SESSIONS = new ConcurrentHashMap<>();

    private RouterCredentialVault() {
    }

    static String create(String host, CharSequence username, CharSequence password) {
        purgeExpired();
        String id = UUID.randomUUID().toString();
        Entry entry = new Entry(
                host,
                copy(username),
                copy(password),
                System.currentTimeMillis() + TTL_MS
        );
        SESSIONS.put(id, entry);
        return id;
    }

    static boolean isValid(String id) {
        purgeExpired();
        Entry entry = id == null ? null : SESSIONS.get(id);
        return entry != null && entry.expiresAt > System.currentTimeMillis();
    }

    static void clear(String id) {
        if (id == null) return;
        Entry entry = SESSIONS.remove(id);
        if (entry != null) entry.destroy();
    }

    static void clearAll() {
        for (String id : SESSIONS.keySet()) clear(id);
    }

    static <T> T use(String id, CredentialUse<T> action) throws Exception {
        purgeExpired();
        Entry entry = id == null ? null : SESSIONS.get(id);
        if (entry == null || entry.expiresAt <= System.currentTimeMillis()) {
            clear(id);
            throw new IllegalStateException("ROUTER_CREDENTIAL_SESSION_EXPIRED");
        }
        // Copies prevent a consumer from retaining or mutating the vault entry.
        char[] user = Arrays.copyOf(entry.username, entry.username.length);
        char[] pass = Arrays.copyOf(entry.password, entry.password.length);
        try {
            return action.run(entry.host, user, pass);
        } finally {
            Arrays.fill(user, '\0');
            Arrays.fill(pass, '\0');
        }
    }

    private static void purgeExpired() {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, Entry> item : SESSIONS.entrySet()) {
            if (item.getValue().expiresAt <= now) clear(item.getKey());
        }
    }

    private static char[] copy(CharSequence value) {
        if (value == null) return new char[0];
        int length = Math.min(value.length(), 256);
        char[] out = new char[length];
        for (int i = 0; i < length; i++) out[i] = value.charAt(i);
        return out;
    }

    private static final class Entry {
        final String host;
        final char[] username;
        final char[] password;
        final long expiresAt;

        Entry(String host, char[] username, char[] password, long expiresAt) {
            this.host = host;
            this.username = username;
            this.password = password;
            this.expiresAt = expiresAt;
        }

        void destroy() {
            Arrays.fill(username, '\0');
            Arrays.fill(password, '\0');
        }
    }
}
