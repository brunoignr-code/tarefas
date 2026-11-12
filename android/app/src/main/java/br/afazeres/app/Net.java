package br.afazeres.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONException;
import org.json.JSONObject;

/** Conversa com o servidor dos alarmes (v30). Só JSON por POST, com tempo limite. */
final class Net {
    private Net() {}

    /** A chave de alarme não vale mais (o celular saiu da conta, ou a sessão venceu). */
    static final class Unauthorized extends IOException {
        Unauthorized(String message) { super(message); }
    }

    static JSONObject post(String path, JSONObject body, String token, int timeoutMs) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(BuildConfig.ALARM_SERVER + path).openConnection();
        try {
            con.setConnectTimeout(timeoutMs);
            con.setReadTimeout(timeoutMs);
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            if (token != null) con.setRequestProperty("Authorization", "Bearer " + token);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = con.getOutputStream()) {
                out.write(bytes);
            }
            int code = con.getResponseCode();
            String text = read(code >= 400 ? con.getErrorStream() : con.getInputStream());
            JSONObject json;
            try {
                json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (JSONException e) {
                throw new IOException("Resposta estranha do servidor (" + code + ").");
            }
            if (code == 401) throw new Unauthorized(json.optString("error", "Alarmes desligados neste celular."));
            if (code >= 400) throw new IOException(json.optString("error", "Erro " + code + " no servidor."));
            return json;
        } finally {
            con.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int n;
            while ((n = stream.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
