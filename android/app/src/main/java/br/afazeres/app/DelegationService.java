package br.afazeres.app;

import android.app.Notification;
import android.os.Bundle;
import android.util.Log;

/**
 * Recebe do Chrome as notificações do site e as mostra como deste app.
 *
 * v34 (APK 1.5): ponte do site para os alarmes. O app web não consegue chamar o código do Android;
 * quando algo muda (tarefa concluída, adiada, resolvida em outro aparelho), ele mostra uma
 * notificação-sinal com o título "Atualizando os lembretes" e um JSON no texto. Ela chega aqui,
 * não aparece na tela, e o Android tira as notificações resolvidas e refaz a agenda dos alarmes.
 *
 * v36 (APK 1.6): nos celulares reais o 1.5 não tirou a notificação. Agora cada entrega do Chrome
 * fica contada (o registro vai ao servidor e aparece em Config. › Avisos), o JSON é procurado também
 * no texto longo, e há uma reserva que não depende daqui (Watch e a lista "resolved" da agenda).
 */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    static final String SIGNAL_TITLE = "Atualizando os lembretes";

    @Override
    public boolean onNotifyNotificationWithChannel(String platformTag, int platformId, Notification notification, String channelName) {
        Alarms.addBridge(this, "calls", 1);
        Alarms.stampBridge(this, "lastCallAt");
        Bundle extras = notification.extras;
        String title = text(extras, Notification.EXTRA_TITLE, Notification.EXTRA_TITLE_BIG);
        String body = text(extras, Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT);
        boolean signal = title != null && title.contains(SIGNAL_TITLE);
        Log.i(Alarms.TAG, "Notificação do Chrome: tag=" + platformTag + " canal=" + channelName + " sinal=" + signal
                + " texto=" + (body == null ? "nulo" : body.length() + " letras"));
        if (signal) {
            String json = body == null ? null : body.substring(Math.max(0, body.indexOf('{')));
            if (json != null && json.startsWith("{")) Alarms.handleSignal(this, json);
            else Log.w(Alarms.TAG, "Sinal do site sem o JSON no texto");
            return true; // Para o Chrome, "mostrada"; na tela, nada.
        }
        return super.onNotifyNotificationWithChannel(platformTag, platformId, notification, channelName);
    }

    /** O primeiro texto não vazio entre as chaves dadas (o Chrome pode usar o texto curto ou o longo). */
    private static String text(Bundle extras, String... keys) {
        if (extras == null) return null;
        for (String key : keys) {
            CharSequence value = extras.getCharSequence(key);
            if (value != null && value.length() > 0) return value.toString();
        }
        return null;
    }
}
