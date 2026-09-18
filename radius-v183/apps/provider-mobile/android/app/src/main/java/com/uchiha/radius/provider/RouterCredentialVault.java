package com.uchiha.radius.provider;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

final class RouterCredentialVault {
    static final class Credentials {
        final String host;
        final String username;
        final char[] password;
        final boolean tls;

        Credentials(String host, String username, char[] password, boolean tls) {
            this.host = host;
            this.username = username;
            this.password = password;
            this.tls = tls;
        }

        void clear() {
            java.util.Arrays.fill(password, '\0');
        }
    }

    private final Map<String, Credentials> entries = new ConcurrentHashMap<>();

    String put(String host, String username, String password, boolean tls) {
        String handle = UUID.randomUUID().toString();
        entries.put(handle, new Credentials(host, username, password.toCharArray(), tls));
        return handle;
    }

    Credentials get(String handle) {
        return entries.get(handle);
    }

    void remove(String handle) {
        Credentials credentials = entries.remove(handle);
        if (credentials != null) credentials.clear();
    }

    void clear() {
        entries.values().forEach(Credentials::clear);
        entries.clear();
    }
}
