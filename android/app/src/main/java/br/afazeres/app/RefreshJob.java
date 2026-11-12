package br.afazeres.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/**
 * Atualiza a agenda dos alarmes a cada ~15 min (quando o Android deixar) e logo depois de ligar o
 * celular. Avisos criados em outro aparelho nesse intervalo continuam chegando pelo push.
 */
public class RefreshJob extends JobService {
    private static final int PERIODIC = 3001;
    private static final int SOON = 3002;

    static void schedulePeriodic(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(PERIODIC) != null) return;
        try {
            js.schedule(new JobInfo.Builder(PERIODIC, new ComponentName(c, RefreshJob.class))
                    .setPeriodic(15 * 60_000L)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .build());
        } catch (RuntimeException e) {
            // Sem a atualização periódica, a agenda ainda vem ao abrir o app e ao ligar o celular.
            android.util.Log.w(Alarms.TAG, "Atualização periódica não agendada", e);
        }
    }

    /** Uma atualização assim que houver internet (depois de ligar o celular ou mudar a hora). */
    static void runSoon(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        try {
            js.schedule(new JobInfo.Builder(SOON, new ComponentName(c, RefreshJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setMinimumLatency(0)
                    .build());
        } catch (RuntimeException e) {
            android.util.Log.w(Alarms.TAG, "Atualização não agendada", e);
        }
    }

    static void cancel(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        js.cancel(PERIODIC);
        js.cancel(SOON);
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Alarms.IO.execute(() -> {
            boolean retry = false;
            try {
                Alarms.refresh(getApplicationContext());
            } catch (Exception e) {
                retry = params.getJobId() == SOON;
            } finally {
                jobFinished(params, retry);
            }
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
