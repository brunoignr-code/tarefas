package br.afazeres.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * Hora do lembrete. Com internet, confere em até 3 s se o aviso ainda vale (tarefa concluída ou
 * mudada em outro aparelho sai da fila do servidor e não toca). Sem internet, toca assim mesmo:
 * melhor um lembrete a mais do que um a menos.
 */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Alarms.ACTION_ALARM.equals(intent.getAction())) return;
        String raw = intent.getStringExtra("item");
        if (raw == null) return;
        Context app = context.getApplicationContext();
        PendingResult result = goAsync();
        Alarms.IO.execute(() -> {
            try {
                JSONObject item = new JSONObject(raw);
                boolean valid = true;
                try {
                    JSONObject check = Net.post("/alarms/check", new JSONObject().put("key", item.optString("key")), Alarms.token(app), 3000);
                    valid = check.optBoolean("valid", true);
                } catch (Net.Unauthorized e) {
                    // A chave não vale mais: este lembrete ainda toca, e os próximos param.
                    Alarms.unpair(app);
                } catch (Exception ignored) {
                    // Sem internet ou servidor lento: toca.
                }
                if (valid) Alarms.show(app, item);
                else Alarms.markShown(app, item.optString("key"));
            } catch (Exception e) {
                android.util.Log.w(Alarms.TAG, "Alarme não mostrado", e);
            } finally {
                result.finish();
            }
        });
    }
}
