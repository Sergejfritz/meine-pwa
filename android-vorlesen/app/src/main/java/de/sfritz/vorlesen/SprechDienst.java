package de.sfritz.vorlesen;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Hält das Vorlesen am Leben, wenn es aus dem Menü „Vorlesen“ gestartet wurde
 * und man die App gleich wieder verlässt. Benachrichtigung mit Stopp-Knopf.
 */
public class SprechDienst extends Service implements Sprecher.Hoerer {

    static final String TEXT = "text";
    static final String STOPP = "de.sfritz.vorlesen.STOPP";
    private static final String KANAL = "vorlesen";

    public static void starte(Context c, String text) {
        Intent i = new Intent(c, SprechDienst.class).putExtra(TEXT, text);
        c.startForegroundService(i);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        vordergrund();
        Sprecher s = Sprecher.von(this);
        if (intent == null || STOPP.equals(intent.getAction())) {
            s.stopp();
            beenden();
            return START_NOT_STICKY;
        }
        s.hoererDazu(this);
        s.sprich(intent.getStringExtra(TEXT));
        if (!s.spricht()) beenden();
        return START_NOT_STICKY;
    }

    private void vordergrund() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(KANAL, "Vorlesen", NotificationManager.IMPORTANCE_LOW));
        PendingIntent stopp = PendingIntent.getService(this, 1,
                new Intent(this, SprechDienst.class).setAction(STOPP), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent oeffnen = PendingIntent.getActivity(this, 2,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, KANAL)
                .setSmallIcon(R.drawable.ic_lautsprecher)
                .setContentTitle("Wird vorgelesen …")
                .setContentText("Tippe auf Stopp zum Beenden")
                .setContentIntent(oeffnen)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Stopp", stopp).build())
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(1, n);
        }
    }

    @Override
    public void sprichtGerade(boolean spricht) {
        if (!spricht) beenden();
    }

    private void beenden() {
        Sprecher.von(this).hoererWeg(this);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        Sprecher.von(this).hoererWeg(this);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
