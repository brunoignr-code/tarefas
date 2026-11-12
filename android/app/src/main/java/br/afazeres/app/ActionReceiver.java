package br.afazeres.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * Concluir, Amanhã e Adiar 10 min na notificação, sem abrir o app. O servidor aplica as mesmas
 * regras do app com o relógio deste celular e devolve a agenda nova. Sem internet, a notificação
 * vira "toque para resolver no app" (o app abre já na ação).
 */
public class ActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Alarms.ACTION_DO.equals(intent.getAction())) return;
        String action = intent.getStringExtra("acao");
        String raw = intent.getStringExtra("item");
        if (action == null || raw == null) return;
        Context app = context.getApplicationContext();
        PendingResult result = goAsync();
        Alarms.IO.execute(() -> {
            JSONObject item = null;
            try {
                item = new JSONObject(raw);
                String taskId = item.optString("taskId");
                JSONObject body = new JSONObject().put("taskId", taskId).put("action", action).put("offset", Alarms.offsetMinutes());
                JSONObject res = Net.post("/alarms/act", body, Alarms.token(app), 8000);
                if (res.optBoolean("ok")) {
                    Alarms.cancelNotification(app, item);
                } else {
                    Alarms.showProblem(app, item, res.optString("error", "Não deu para fazer isso agora.") + " Toque para abrir o app.", "#today");
                }
                Alarms.applyItems(app, res.optJSONArray("items"));
            } catch (Net.Unauthorized e) {
                Alarms.unpair(app);
                if (item != null) offline(app, item, action);
            } catch (Exception e) {
                if (item != null) offline(app, item, action);
            } finally {
                result.finish();
            }
        });
    }

    private static void offline(Context app, JSONObject item, String action) {
        String taskId = item.optString("taskId");
        Alarms.showProblem(app, item, "Sem conexão agora. Toque para resolver no app.", "#notif/" + action + "/" + taskId);
    }
}
