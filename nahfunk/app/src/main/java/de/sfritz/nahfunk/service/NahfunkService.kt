package de.sfritz.nahfunk.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import de.sfritz.nahfunk.core.Channel
import de.sfritz.nahfunk.engine.Engine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * Vordergrund-Dienst: hält Funk und Netz auch bei ausgeschaltetem Bildschirm am Leben
 * und zeigt in der Statusleiste, was gerade läuft.
 */
class NahfunkService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Engine.init(this)
        val started = try {
            ServiceCompat.startForeground(
                this, Notifications.ID_STATUS,
                Notifications.statusNotification(this, "wird gestartet …"),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0,
            )
            true
        } catch (e: Exception) {
            // Android 12+ verbietet den Start aus dem Hintergrund; dann läuft Nahfunk eben nur im Vordergrund.
            false
        }
        if (!started) {
            stopSelf()
            return
        }
        scope.launch {
            combine(Engine.status, Engine.peers) { st, peers ->
                val nah = peers.values.count { it.isNahfunk }
                val net = peers.values.count { it.channels.contains(Channel.LAN) }
                val ways = buildList {
                    if (st.mode.usesLan) add(if (st.lanUp) "WLAN-Netz" else "WLAN-Netz (getrennt)")
                    if (st.mode.usesBle) add(
                        when {
                            !st.bluetoothOn -> "Funk (Bluetooth aus)"
                            st.advertising -> "Funk sichtbar"
                            st.scanning -> "Funk hört mit"
                            else -> "Funk"
                        },
                    )
                }
                val who = when {
                    nah == 0 -> "niemand in Reichweite"
                    nah == 1 -> "1 Teilnehmer in Reichweite"
                    else -> "$nah Teilnehmer in Reichweite"
                }
                val extra = if (net > 0) " ($net im Netz)" else ""
                ways.joinToString(" · ") + " · " + who + extra
            }.distinctUntilChanged().collect { text ->
                try {
                    NotificationManagerCompat.from(this@NahfunkService)
                        .notify(Notifications.ID_STATUS, Notifications.statusNotification(this@NahfunkService, text))
                } catch (e: SecurityException) {
                    // ohne Benachrichtigungsrecht bleibt der erste Text stehen
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        private const val ACTION_STOP = "de.sfritz.nahfunk.service.STOP"

        fun start(context: Context) {
            val intent = Intent(context, NahfunkService::class.java)
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (e: Exception) {
                // z. B. Start aus dem Hintergrund nicht erlaubt – dann ohne Dienst weiter
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, NahfunkService::class.java))
            } catch (e: Exception) {
                // lief nicht
            }
        }
    }
}
