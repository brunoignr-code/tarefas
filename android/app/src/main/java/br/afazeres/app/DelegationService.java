package br.afazeres.app;

import android.app.Notification;
import android.os.Bundle;

/**
 * Recebe do Chrome as notificações do site e as mostra como deste app.
 *
 * v34 (APK 1.5): ponte do site para os alarmes. O app web não consegue chamar o código do Android;
 * quando algo muda (tarefa concluída, adiada, resolvida em outro aparelho), ele mostra uma
 * notificação-sinal com o título "Atualizando os lembretes" e um JSON no texto. Ela chega aqui,
 * não aparece na tela, e o Android tira as notificações resolvidas e refaz a agenda dos alarmes.
 */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    static final String SIGNAL_TITLE = "Atualizando os lembretes";

    @Override
    public boolean onNotifyNotificationWithChannel(String platformTag, int platformId, Notification notification, String channelName) {
        Bundle extras = notification.extras;
        CharSequence title = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TEXT);
        if (title != null && SIGNAL_TITLE.contentEquals(title) && text != null && text.toString().startsWith("{")) {
            Alarms.handleSignal(this, text.toString());
            return true; // Para o Chrome, "mostrada"; na tela, nada.
        }
        return super.onNotifyNotificationWithChannel(platformTag, platformId, notification, channelName);
    }
}
