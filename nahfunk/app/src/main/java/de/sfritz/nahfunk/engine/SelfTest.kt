package de.sfritz.nahfunk.engine

import android.Manifest
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
import de.sfritz.nahfunk.core.Settings as AppSettings
import de.sfritz.nahfunk.radio.ClassicBt
import de.sfritz.nahfunk.service.Notifications

enum class SelfTestAction(val label: String) {
    ENABLE_BLUETOOTH("einschalten"),
    REQUEST_PERMISSIONS("erlauben"),
    OPEN_APP_SETTINGS("App-Einstellungen"),
    OPEN_LOCATION_SETTINGS("einschalten"),
    OPEN_WIFI_SETTINGS("WLAN-Einstellungen"),
    BECOME_VISIBLE("„Sichtbar werden“ antippen"),
    CLASSIC_VISIBLE("klassisch sichtbar machen"),
    IGNORE_BATTERY("ausnehmen"),
    START("starten"),
}

data class SelfTestItem(
    /** true = ok, false = Problem, null = nicht feststellbar oder nicht nötig. */
    val ok: Boolean?,
    val label: String,
    val hint: String? = null,
    val action: SelfTestAction? = null,
)

/** Die Checkliste unten auf dem Hauptbildschirm. */
object SelfTest {

    fun build(context: Context, status: EngineStatus, settings: AppSettings): List<SelfTestItem> {
        val out = ArrayList<SelfTestItem>()
        val btPerms = Permissions.bluetooth()
        val btGranted = Permissions.allGranted(context, btPerms)
        val locGranted = Permissions.granted(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val wifiGranted = Permissions.allGranted(context, Permissions.wifi())
        val notifGranted = Permissions.allGranted(context, Permissions.notifications()) && Notifications.canPost(context)

        out += SelfTestItem(status.bluetoothPresent, "Bluetooth vorhanden", if (!status.bluetoothPresent) "dieses Gerät hat kein Bluetooth" else null)
        out += SelfTestItem(
            if (!status.bluetoothPresent) null else status.bluetoothOn,
            "Bluetooth eingeschaltet",
            action = if (status.bluetoothPresent && !status.bluetoothOn) SelfTestAction.ENABLE_BLUETOOTH else null,
        )
        out += when (status.canAdvertise) {
            true -> SelfTestItem(true, "Gerät kann selbst funken")
            false -> SelfTestItem(false, "Gerät kann selbst funken", "dieses Modell kann es nicht – klassisch sichtbar geht trotzdem", SelfTestAction.CLASSIC_VISIBLE)
            null -> SelfTestItem(null, "Gerät kann selbst funken", "erst prüfbar, wenn Bluetooth an ist")
        }
        if (btPerms.isNotEmpty()) {
            out += SelfTestItem(btGranted, "Berechtigung Bluetooth", if (!btGranted) "Suchen, Senden, Verbinden" else null, if (!btGranted) SelfTestAction.REQUEST_PERMISSIONS else null)
        }
        out += SelfTestItem(locGranted, "Berechtigung Standort", if (!locGranted) "Android verlangt sie für Funk- und WLAN-Scans" else null, if (!locGranted) SelfTestAction.REQUEST_PERMISSIONS else null)
        if (Permissions.wifi().isNotEmpty()) {
            out += SelfTestItem(wifiGranted, "Berechtigung WLAN-Geräte in der Nähe", action = if (!wifiGranted) SelfTestAction.REQUEST_PERMISSIONS else null)
        }
        out += SelfTestItem(notifGranted, "Benachrichtigungen erlaubt", if (!notifGranted) "sonst kommen Pings im Hintergrund nicht an" else null, if (!notifGranted) SelfTestAction.REQUEST_PERMISSIONS else null)
        val locOn = locationEnabled(context)
        out += SelfTestItem(locOn, "Standortdienste an", if (!locOn) "ohne sie liefert Android keine Scan-Ergebnisse" else null, if (!locOn) SelfTestAction.OPEN_LOCATION_SETTINGS else null)

        val battery = Engine.isIgnoringBatteryOptimizations()
        out += SelfTestItem(
            if (battery) true else null,
            "Von Akku-Optimierung ausgenommen",
            if (!battery) "sonst schläft Nahfunk im Hintergrund ein" else null,
            if (!battery) SelfTestAction.IGNORE_BATTERY else null,
        )

        // Laufender Betrieb
        if (!status.running) {
            out += SelfTestItem(false, "Nahfunk läuft", "gerade gestoppt", SelfTestAction.START)
        } else {
            if (status.mode.usesLan) {
                out += SelfTestItem(status.lanUp, "Im WLAN-Netz erreichbar", status.lanIp?.let { "eigene Adresse $it" } ?: status.lanError ?: "nicht mit einem WLAN verbunden", if (!status.lanUp) SelfTestAction.OPEN_WIFI_SETTINGS else null)
            }
            if (status.mode.usesBle) {
                out += SelfTestItem(
                    if (status.canAdvertise == false) null else status.advertising,
                    "Sendet gerade",
                    if (status.advertising) null else status.advertiseError ?: "noch nicht sichtbar",
                    if (!status.advertising && status.canAdvertise != false) SelfTestAction.BECOME_VISIBLE
                    else if (status.canAdvertise == false) SelfTestAction.CLASSIC_VISIBLE else null,
                )
                out += SelfTestItem(status.scanning, "Empfängt gerade", if (status.scanning) (if (status.scanFiltered) "nur Nahfunk (Bildschirm aus)" else null) else status.scanError)
                val discoverable = ClassicBt.isDiscoverable(context)
                out += SelfTestItem(discoverable, "Klassisch sichtbar", if (discoverable == true) "andere sehen dieses Handy in ihrer Bluetooth-Suche" else "nur nötig, wenn Funk-Senden nicht geht", if (discoverable != true) SelfTestAction.CLASSIC_VISIBLE else null)
            }
        }
        return out
    }

    fun locationEnabled(context: Context): Boolean {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lm.isLocationEnabled
        } else {
            @Suppress("DEPRECATION")
            Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF) != Settings.Secure.LOCATION_MODE_OFF
        }
    }
}
