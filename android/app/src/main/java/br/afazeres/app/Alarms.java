package br.afazeres.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Alarmes nativos dos lembretes (v30).
 *
 * O app web gera um código e o PairActivity troca pela chave de alarme deste celular. Com ela,
 * a agenda dos próximos dias vem do servidor (/alarms/list) e cada aviso vira um alarme exato do
 * Android, que toca na hora mesmo com o celular parado, bloqueado ou sem internet. A agenda fica
 * guardada, para reagendar ao ligar o celular. Na hora de tocar, o AlarmReceiver confere se o aviso
 * ainda vale; os botões da notificação vão pelo ActionReceiver (/alarms/act), sem abrir o app.
 */
final class Alarms {
    private Alarms() {}

    static final String TAG = "Afazeres";
    static final String CHANNEL = "lembretes";
    static final String ACTION_ALARM = "br.afazeres.app.ALARME";
    static final String ACTION_DO = "br.afazeres.app.ACAO";
    private static final String PREFS = "alarmes";
    private static final long HOUR = 3_600_000L;
    private static final long REFRESH_GAP = 60_000L;
    private static final int SHOWN_MAX = 300;
    private static final int COLOR = 0xFF0F6B4C;

    /** Rede e banco fora da linha principal. Várias tarefas ao mesmo tempo: um alarme não espera a agenda. */
    static final ExecutorService IO = Executors.newCachedThreadPool();

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String token(Context c) { return prefs(c).getString("token", null); }

    static boolean paired(Context c) { return token(c) != null; }

    static void saveToken(Context c, String token) {
        prefs(c).edit().putString("token", token).apply();
    }

    /** Pode agendar alarme exato? (Android 12+ pede permissão; com USE_EXACT_ALARM ela vem sozinha no 13+.) */
    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    /** Pode mostrar a notificação dos lembretes? */
    static boolean canNotify(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return false;
        NotificationChannel channel = nm.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static void ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, c.getString(R.string.canalLembretes), NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(c.getString(R.string.canalLembretesDescricao));
        nm.createNotificationChannel(channel);
    }

    /** Minutos do fuso deste celular em relação ao UTC (Brasília: −180), para o servidor usar o relógio daqui. */
    static int offsetMinutes() {
        return TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000;
    }

    /** Atualiza a agenda em segundo plano, no máximo uma vez por minuto. */
    static void refreshAsync(Context c) {
        Context app = c.getApplicationContext();
        if (!paired(app) || System.currentTimeMillis() - prefs(app).getLong("refreshedAt", 0) < REFRESH_GAP) return;
        IO.execute(() -> {
            try {
                refresh(app);
            } catch (Exception e) {
                Log.w(TAG, "Agenda dos alarmes não atualizada", e);
            }
        });
    }

    /** Busca a agenda no servidor e reagenda os alarmes. Sem chave válida, desliga os alarmes deste celular. */
    static boolean refresh(Context c) throws Exception {
        if (!paired(c)) return false;
        JSONObject body = new JSONObject().put("exact", canExact(c)).put("notify", canNotify(c));
        JSONObject res;
        try {
            res = Net.post("/alarms/list", body, token(c), 15000);
        } catch (Net.Unauthorized e) {
            unpair(c);
            return false;
        }
        applyItems(c, res.optJSONArray("items"));
        prefs(c).edit().putLong("refreshedAt", System.currentTimeMillis()).apply();
        return true;
    }

    /** Guarda a agenda nova e reagenda. */
    static synchronized void applyItems(Context c, JSONArray items) {
        if (items == null) return;
        prefs(c).edit().putString("items", items.toString()).apply();
        scheduleCached(c);
    }

    private static JSONArray cachedItems(Context c) {
        try {
            return new JSONArray(prefs(c).getString("items", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /**
     * Agenda os alarmes da agenda guardada (também sem internet, ao ligar o celular).
     * Aviso que venceu há menos de 1 hora e não foi mostrado (celular desligado) aparece agora.
     */
    static synchronized void scheduleCached(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        JSONArray items = cachedItems(c);
        Set<String> shown = shownKeys(c);
        Set<String> keep = new HashSet<>();
        long now = System.currentTimeMillis();
        boolean exact = canExact(c);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String key = item.optString("key", "");
            long at = item.optLong("at", 0);
            if (key.isEmpty() || shown.contains(key)) continue;
            if (at <= now) {
                if (now - at <= HOUR) show(c, item);
                continue;
            }
            PendingIntent pi = alarmIntent(c, item, PendingIntent.FLAG_UPDATE_CURRENT);
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            keep.add(key);
        }
        for (String key : prefs(c).getStringSet("scheduled", new HashSet<>())) {
            if (keep.contains(key)) continue;
            PendingIntent old = PendingIntent.getBroadcast(c, 0, alarmBase(c, key), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (old != null) {
                am.cancel(old);
                old.cancel();
            }
        }
        prefs(c).edit().putStringSet("scheduled", keep).apply();
    }

    /** Desliga os alarmes deste celular: apaga a chave e cancela tudo o que estava agendado. */
    static synchronized void unpair(Context c) {
        prefs(c).edit().remove("token").putString("items", "[]").apply();
        scheduleCached(c);
        RefreshJob.cancel(c);
    }

    /** O dado (data) do Intent diferencia um alarme do outro: dois avisos nunca se sobrepõem. */
    private static Intent alarmBase(Context c, String key) {
        return new Intent(c, AlarmReceiver.class).setAction(ACTION_ALARM).setData(Uri.parse("afazeres-alarme://aviso/" + Uri.encode(key)));
    }

    private static PendingIntent alarmIntent(Context c, JSONObject item, int flags) {
        Intent intent = alarmBase(c, item.optString("key"))
                .putExtra("item", item.toString());
        return PendingIntent.getBroadcast(c, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /* ---------- Notificação ---------- */

    static String tagFor(JSONObject item) {
        String taskId = item.optString("taskId", "");
        return taskId.isEmpty() || "null".equals(taskId) ? item.optString("key") : taskId;
    }

    /** Abre o app (o site no Chrome, como o ícone faz) já na tela indicada. */
    static PendingIntent openApp(Context c, String hash, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(c.getString(R.string.launchUrl) + hash))
                .setPackage(c.getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Notification.Action action(Context c, JSONObject item, String action, String title, int requestCode) {
        Intent intent = new Intent(c, ActionReceiver.class)
                .setAction(ACTION_DO)
                .setData(Uri.parse("afazeres-acao://" + action + "/" + Uri.encode(item.optString("key"))))
                .putExtra("acao", action)
                .putExtra("item", item.toString());
        PendingIntent pi = PendingIntent.getBroadcast(c, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_notificacao), title, pi).build();
    }

    /** Mostra o lembrete: Concluir, Amanhã e Adiar 10 min resolvem sem abrir o app. */
    static void show(Context c, JSONObject item) {
        ensureChannel(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        String key = item.optString("key");
        String kind = item.optString("kind", "remind");
        String taskId = item.optString("taskId", "");
        boolean task = !taskId.isEmpty() && !"null".equals(taskId) && ("remind".equals(kind) || "insist".equals(kind));
        int code = key.hashCode();
        Notification.Builder builder = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notificacao)
                .setColor(COLOR)
                .setContentTitle(item.optString("title", c.getString(R.string.appName)))
                .setContentText(item.optString("body", ""))
                .setWhen(item.optLong("at", System.currentTimeMillis()))
                .setShowWhen(true)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(openApp(c, "#today", code));
        if (task) {
            builder.addAction(action(c, item, "done", "Concluir", code + 1));
            builder.addAction(action(c, item, "tomorrow", "Amanhã", code + 2));
            builder.addAction(action(c, item, "snooze", "Adiar 10 min", code + 3));
        }
        nm.notify(tagFor(item), 1, builder.build());
        markShown(c, key);
    }

    /** Troca o texto da notificação (sem internet num botão, por exemplo) e oferece abrir o app. */
    static void showProblem(Context c, JSONObject item, String text, String hash) {
        ensureChannel(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notificacao)
                .setColor(COLOR)
                .setContentTitle(item.optString("title", c.getString(R.string.appName)))
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openApp(c, hash, item.optString("key").hashCode() + 4))
                .build();
        nm.notify(tagFor(item), 1, n);
    }

    static void cancelNotification(Context c, JSONObject item) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(tagFor(item), 1);
    }

    /* ---------- Avisos já mostrados (para não repetir ao ligar o celular) ---------- */

    private static Set<String> shownKeys(Context c) {
        return new HashSet<>(shownList(c));
    }

    private static List<String> shownList(Context c) {
        List<String> list = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs(c).getString("shown", "[]"));
            for (int i = 0; i < array.length(); i++) list.add(array.optString(i));
        } catch (JSONException ignored) {
            // Lista estragada: começa de novo.
        }
        return list;
    }

    static synchronized void markShown(Context c, String key) {
        List<String> list = shownList(c);
        if (list.contains(key)) return;
        list.add(key);
        while (list.size() > SHOWN_MAX) list.remove(0);
        prefs(c).edit().putString("shown", new JSONArray(list).toString()).apply();
    }
}
