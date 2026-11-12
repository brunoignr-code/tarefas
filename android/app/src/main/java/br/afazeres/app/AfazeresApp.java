package br.afazeres.app;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

/**
 * Início do processo do app (v30): canal dos lembretes, atualização periódica da agenda e uma
 * atualização a cada vez que o app abre. A tela do app continua sendo o site no Chrome (TWA).
 */
public class AfazeresApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Alarms.ensureChannel(this);
        if (Alarms.paired(this)) RefreshJob.schedulePeriodic(this);
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityResumed(Activity activity) {
                if (!(activity instanceof PairActivity)) Alarms.refreshAsync(activity);
            }
            @Override public void onActivityCreated(Activity activity, Bundle state) {}
            @Override public void onActivityStarted(Activity activity) {}
            @Override public void onActivityPaused(Activity activity) {}
            @Override public void onActivityStopped(Activity activity) {}
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) {}
            @Override public void onActivityDestroyed(Activity activity) {}
        });
    }
}
