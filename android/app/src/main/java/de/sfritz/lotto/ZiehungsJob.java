package de.sfritz.lotto;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Läuft regelmäßig im Hintergrund und meldet neue Ziehungen (siehe Lotto.pruefe). */
public class ZiehungsJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                Lotto.pruefe(getApplicationContext(), false);
            } catch (Exception ignored) {
                // kein Netz o. Ä. – der nächste Durchlauf versucht es wieder
            }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
