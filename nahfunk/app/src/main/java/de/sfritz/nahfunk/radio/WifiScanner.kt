package de.sfritz.nahfunk.radio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.ScanResult
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat

/** Liest die WLAN-Aushänge (Beacons) der umliegenden Router mit Signalstärke. */
class WifiScanner(context: Context, private val onResults: (List<ApSighting>) -> Unit) {

    data class ApSighting(val bssid: String, val ssid: String, val rssi: Int, val frequencyMhz: Int, val time: Long)

    private val appContext = context.applicationContext
    private val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private var receiver: BroadcastReceiver? = null

    val available: Boolean get() = wifi != null

    fun start() {
        if (receiver != null || wifi == null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (intent.action == WifiManager.SCAN_RESULTS_AVAILABLE_ACTION) readResults()
            }
        }
        ContextCompat.registerReceiver(
            appContext, r, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        receiver = r
    }

    fun stop() {
        val r = receiver ?: return
        receiver = null
        try {
            appContext.unregisterReceiver(r)
        } catch (e: IllegalArgumentException) {
            // schon abgemeldet
        }
    }

    /** Android drosselt auf wenige Scans pro Minute; false heißt nur: jetzt nicht. */
    @Suppress("DEPRECATION")
    fun requestScan(): Boolean {
        val w = wifi ?: return false
        return try {
            w.startScan()
        } catch (e: SecurityException) {
            false
        }
    }

    fun readResults() {
        val w = wifi ?: return
        val results = try {
            w.scanResults
        } catch (e: SecurityException) {
            return
        } ?: return
        val now = System.currentTimeMillis()
        val bootMs = SystemClock.elapsedRealtime()
        val list = results.mapNotNull { r ->
            val bssid = r.BSSID ?: return@mapNotNull null
            val ageMs = bootMs - r.timestamp / 1000
            if (ageMs > MAX_AGE_MS) return@mapNotNull null
            ApSighting(
                bssid = bssid,
                ssid = ssidOf(r),
                rssi = r.level,
                frequencyMhz = r.frequency,
                time = now - ageMs.coerceAtLeast(0),
            )
        }
        onResults(list)
    }

    @Suppress("DEPRECATION")
    private fun ssidOf(r: ScanResult): String {
        val raw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            r.wifiSsid?.toString() ?: ""
        } else {
            r.SSID ?: ""
        }
        val cleaned = raw.removeSurrounding("\"").trim()
        return cleaned.ifEmpty { "(verstecktes WLAN)" }
    }

    private companion object {
        const val MAX_AGE_MS = 3 * 60 * 1000L
    }
}
