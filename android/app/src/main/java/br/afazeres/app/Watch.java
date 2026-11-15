package br.afazeres.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * v36 (APK 1.6): enquanto houver notificação de lembrete no painel, confere de tempos em tempos se
 * ela já foi resolvida em outro aparelho (a agenda do servidor traz a lista do que foi resolvido) e
 * a tira. É a reserva da ponte do site, que não chegou ao APK 1.5: 2 min, 5 min, depois a cada 15 min,
 * por até 12 horas. Com o celular parado, o Android junta esses despertares (~10 a 15 min).
 */
public class Watch extends BroadcastReceiver {
    static final String ACTION = "br.afazeres.app.CONFERIR";
    private static final long[] STEPS = {2 * 60_000L, 5 * 60_000L};
    private static final long EVERY = 15 * 60_000L;
    private static final long LIMIT = 12 * 3_600_000L;

    /** Uma notificação nova acabou de aparecer: recomeça a conferência. */
    static void start(Context c) {
        Alarms.prefs(c).edit().putInt("watch.step", 0).putLong("watch.since", System.currentTimeMillis()).apply();
        schedule(c, STEPS[0]);
    }

    private static PendingIntent intent(Context c, int flags) {
        Intent i = new Intent(c, Watch.class).setAction(ACTION);
        return PendingIntent.getBroadcast(c, 4001, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void schedule(Context c, long delay) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        // Inexato de propósito: não precisa do segundo certo, e assim não gasta a cota de alarmes exatos.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delay, intent(c, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    static void stop(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = intent(c, PendingIntent.FLAG_NO_CREATE);
        if (am != null && pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION.equals(intent.getAction())) return;
        Context app = context.getApplicationContext();
        PendingResult result = goAsync();
        Alarms.IO.execute(() -> {
            try {
                Alarms.stampBridge(app, "lastWatchAt");
                if (Alarms.hasReminderOnScreen(app)) {
                    try {
                        Alarms.refresh(app);
                    } catch (Exception e) {
                        android.util.Log.w(Alarms.TAG, "Conferência sem internet; tenta de novo depois", e);
                    }
                }
                long since = Alarms.prefs(app).getLong("watch.since", 0);
                if (Alarms.paired(app) && Alarms.hasReminderOnScreen(app) && System.currentTimeMillis() - since < LIMIT) {
                    int step = Alarms.prefs(app).getInt("watch.step", 0) + 1;
                    Alarms.prefs(app).edit().putInt("watch.step", step).apply();
                    schedule(app, step < STEPS.length ? STEPS[step] : EVERY);
                }
            } finally {
                result.finish();
            }
        });
    }
}
