package de.sfritz.nahfunk.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.sfritz.nahfunk.core.PingCode
import de.sfritz.nahfunk.engine.Engine

/** Knöpfe in den Benachrichtigungen: Beenden und Schnellantworten. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Engine.init(context)
        when (intent.action) {
            ACTION_STOP -> Engine.stop()
            ACTION_REPLY -> {
                val code = PingCode.fromCode(intent.getIntExtra(EXTRA_CODE, 0))
                val peer = intent.getStringExtra(EXTRA_PEER)
                val id = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
                if (id >= 0) Notifications.cancel(context, id)
                if (code != PingCode.NONE) Engine.sendPing(code, peer)
            }
        }
    }

    companion object {
        const val ACTION_STOP = "de.sfritz.nahfunk.STOP"
        const val ACTION_REPLY = "de.sfritz.nahfunk.REPLY"
        const val EXTRA_CODE = "code"
        const val EXTRA_PEER = "peer"
        const val EXTRA_NOTIFICATION_ID = "nid"
    }
}
