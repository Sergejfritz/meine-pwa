package de.sfritz.nahfunk.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import de.sfritz.nahfunk.MainActivity
import de.sfritz.nahfunk.R
import de.sfritz.nahfunk.core.Distance
import de.sfritz.nahfunk.core.LogEntry
import de.sfritz.nahfunk.core.PingCode

object Notifications {
    const val CHANNEL_STATUS = "status"
    const val CHANNEL_PINGS = "pings"
    const val ID_STATUS = 1
    private const val ID_PING_BASE = 100
    private var pingCounter = 0

    fun createChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val status = NotificationChannel(CHANNEL_STATUS, context.getString(R.string.channel_status_name), NotificationManager.IMPORTANCE_LOW).apply {
            description = context.getString(R.string.channel_status_desc)
            setShowBadge(false)
        }
        val pings = NotificationChannel(CHANNEL_PINGS, context.getString(R.string.channel_pings_name), NotificationManager.IMPORTANCE_HIGH).apply {
            description = context.getString(R.string.channel_pings_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 150, 100, 150)
        }
        nm.createNotificationChannel(status)
        nm.createNotificationChannel(pings)
    }

    fun canPost(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun statusNotification(context: Context, text: String): Notification {
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getBroadcast(
            context, 1,
            Intent(context, NotificationActionReceiver::class.java).setAction(NotificationActionReceiver.ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(context, CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_nahfunk)
            .setContentTitle("Nahfunk läuft")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, "Beenden", stop)
            .build()
    }

    fun showIncoming(context: Context, entry: LogEntry) {
        if (!canPost(context)) return
        val id = ID_PING_BASE + (pingCounter++ % 50)
        val title = if (entry.ping != null) "${entry.ping.emoji} ${entry.ping.label} · ${entry.peerName}" else "💬 ${entry.peerName}"
        val via = entry.channel?.label ?: ""
        val dist = entry.distanceM?.let { " · ~" + Distance.format(it) } ?: ""
        val body = if (entry.text != null) entry.text else "über $via$dist"

        val open = PendingIntent.getActivity(
            context, id,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_PINGS)
            .setSmallIcon(R.drawable.ic_stat_nahfunk)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(if (entry.ping?.isUrgent == true) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(open)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

        entry.peerKey?.let { key ->
            for ((i, reply) in PingCode.replies.withIndex()) {
                val pi = PendingIntent.getBroadcast(
                    context, id * 10 + i,
                    Intent(context, NotificationActionReceiver::class.java)
                        .setAction(NotificationActionReceiver.ACTION_REPLY)
                        .putExtra(NotificationActionReceiver.EXTRA_CODE, reply.code)
                        .putExtra(NotificationActionReceiver.EXTRA_PEER, key)
                        .putExtra(NotificationActionReceiver.EXTRA_NOTIFICATION_ID, id),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                builder.addAction(0, "${reply.emoji} ${reply.label}", pi)
            }
        }
        try {
            NotificationManagerCompat.from(context).notify(id, builder.build())
        } catch (e: SecurityException) {
            // Benachrichtigungen nicht erlaubt
        }
    }

    fun cancel(context: Context, id: Int) {
        NotificationManagerCompat.from(context).cancel(id)
    }

    fun vibrate(context: Context, urgent: Boolean) {
        val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val pattern = if (urgent) longArrayOf(0, 300, 120, 300, 120, 300) else longArrayOf(0, 120, 80, 120)
        try {
            v.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } catch (e: Exception) {
            // kein Vibrationsmotor oder keine Berechtigung
        }
    }
}
