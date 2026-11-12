package br.afazeres.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Ao ligar o celular, ao atualizar o app ou ao mudar a hora/fuso, o Android apaga ou desalinha os
 * alarmes: agenda de novo com a agenda guardada (funciona sem internet) e busca a atual.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        if (!Alarms.paired(app)) return;
        Alarms.scheduleCached(app);
        RefreshJob.schedulePeriodic(app);
        RefreshJob.runSoon(app);
    }
}
