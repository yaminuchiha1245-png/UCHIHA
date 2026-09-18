package com.uchiha.radius.provider;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.EOFException;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.net.ssl.SSLSocketFactory;

final class RouterOsApiClient implements Closeable {
    private static final int CONNECT_TIMEOUT_MS = 3_000;
    private static final int READ_TIMEOUT_MS = 5_000;
    private static final int MAX_WORD_BYTES = 1024 * 1024;

    private final Socket socket;
    private final BufferedInputStream input;
    private final BufferedOutputStream output;

    RouterOsApiClient(String host, boolean tls) throws IOException {
        int port = tls ? 8729 : 8728;
        Socket raw = tls ? SSLSocketFactory.getDefault().createSocket() : new Socket();
        raw.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        raw.setSoTimeout(READ_TIMEOUT_MS);
        this.socket = raw;
        this.input = new BufferedInputStream(raw.getInputStream());
        this.output = new BufferedOutputStream(raw.getOutputStream());
    }

    void login(String username, char[] password) throws IOException {
        List<List<String>> response = command(List.of("/login", "=name=" + username, "=password=" + new String(password)));
        assertSuccessful(response, "تعذر تسجيل الدخول إلى MikroTik");
    }

    Map<String, String> firstRecord(String command) throws IOException {
        List<List<String>> response = command(List.of(command));
        assertSuccessful(response, "فشل قراءة بيانات MikroTik");
        for (List<String> sentence : response) {
            if (!sentence.isEmpty() && "!re".equals(sentence.get(0))) return attributes(sentence);
        }
        return new LinkedHashMap<>();
    }

    private void assertSuccessful(List<List<String>> response, String fallback) throws IOException {
        for (List<String> sentence : response) {
            if (!sentence.isEmpty() && "!trap".equals(sentence.get(0))) {
                String message = attributes(sentence).getOrDefault("message", fallback);
                throw new IOException(message);
            }
        }
    }

    private List<List<String>> command(List<String> words) throws IOException {
        for (String word : words) writeWord(word);
        writeLength(0);
        output.flush();
        List<List<String>> sentences = new ArrayList<>();
        while (true) {
            List<String> sentence = readSentence();
            sentences.add(sentence);
            if (!sentence.isEmpty() && ("!done".equals(sentence.get(0)) || "!fatal".equals(sentence.get(0)))) return sentences;
        }
    }

    private static Map<String, String> attributes(List<String> sentence) {
        Map<String, String> result = new LinkedHashMap<>();
        for (String word : sentence) {
            if (!word.startsWith("=") || word.length() < 3) continue;
            int split = word.indexOf('=', 1);
            if (split > 1) result.put(word.substring(1, split), word.substring(split + 1));
        }
        return result;
    }

    private List<String> readSentence() throws IOException {
        List<String> words = new ArrayList<>();
        while (true) {
            int length = readLength();
            if (length == 0) return words;
            if (length < 0 || length > MAX_WORD_BYTES) throw new IOException("RouterOS returned an invalid response");
            byte[] bytes = input.readNBytes(length);
            if (bytes.length != length) throw new EOFException("RouterOS closed the connection");
            words.add(new String(bytes, StandardCharsets.UTF_8));
        }
    }

    private void writeWord(String word) throws IOException {
        byte[] bytes = word.getBytes(StandardCharsets.UTF_8);
        writeLength(bytes.length);
        output.write(bytes);
    }

    private void writeLength(int length) throws IOException {
        if (length < 0x80) output.write(length);
        else if (length < 0x4000) {
            length |= 0x8000;
            output.write((length >> 8) & 0xff); output.write(length & 0xff);
        } else if (length < 0x200000) {
            length |= 0xC00000;
            output.write((length >> 16) & 0xff); output.write((length >> 8) & 0xff); output.write(length & 0xff);
        } else if (length < 0x10000000) {
            length |= 0xE0000000;
            output.write((length >> 24) & 0xff); output.write((length >> 16) & 0xff); output.write((length >> 8) & 0xff); output.write(length & 0xff);
        } else {
            output.write(0xF0);
            output.write((length >> 24) & 0xff); output.write((length >> 16) & 0xff); output.write((length >> 8) & 0xff); output.write(length & 0xff);
        }
    }

    private int readLength() throws IOException {
        int first = input.read();
        if (first < 0) throw new EOFException("RouterOS closed the connection");
        if ((first & 0x80) == 0) return first;
        if ((first & 0xC0) == 0x80) return ((first & 0x3F) << 8) | readByte();
        if ((first & 0xE0) == 0xC0) return ((first & 0x1F) << 16) | (readByte() << 8) | readByte();
        if ((first & 0xF0) == 0xE0) return ((first & 0x0F) << 24) | (readByte() << 16) | (readByte() << 8) | readByte();
        if (first == 0xF0) return (readByte() << 24) | (readByte() << 16) | (readByte() << 8) | readByte();
        throw new IOException("RouterOS returned an unsupported word length");
    }

    private int readByte() throws IOException {
        int value = input.read();
        if (value < 0) throw new EOFException("RouterOS closed the connection");
        return value;
    }

    @Override
    public void close() throws IOException {
        socket.close();
    }
}
