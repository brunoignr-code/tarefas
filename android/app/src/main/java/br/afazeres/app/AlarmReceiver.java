package br.afazeres.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * Hora do lembrete. Com internet, confere (6 s e mais 3 s) se o aviso ainda vale (tarefa concluída ou
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
                // v34: com o celular parado, a internet demora a acordar. Antes esperava só 3 s e tocava
                // assim mesmo (uma tarefa já concluída tocou às 5h). Agora 6 s e mais uma tentativa de 3 s.
                int[] waits = {6000, 3000};
                for (int i = 0; i < waits.length; i++) {
                    try {
                        JSONObject check = Net.post("/alarms/check", new JSONObject().put("key", item.optString("key")), Alarms.token(app), waits[i]);
                        valid = check.optBoolean("valid", true);
                        break;
                    } catch (Net.Unauthorized e) {
                        // A chave não vale mais: este lembrete ainda toca, e os próximos param.
                        Alarms.unpair(app);
                        break;
                    } catch (Exception ignored) {
                        // Sem internet ou servidor lento: tenta de novo; sem resposta, toca.
                    }
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
