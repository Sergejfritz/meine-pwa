package de.sfritz.nahfunk.radio

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import de.sfritz.nahfunk.core.BleProtocol

/**
 * Sendet die eigene Nahfunk-Kennung (und laufende Pings) als Bluetooth-LE-Aussendung.
 * Hauptpaket in der Aussendung, langer Name in der Scan-Antwort.
 */
class BleAdvertiser(context: Context, private val onState: (AdvertiseState) -> Unit) {

    data class AdvertiseState(
        val active: Boolean = false,
        /** null = unbekannt (z. B. Bluetooth aus). */
        val supported: Boolean? = null,
        val error: String? = null,
    )

    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager?.adapter

    private var advertiser: BluetoothLeAdvertiser? = null
    private var callback: AdvertiseCallback? = null

    @Volatile
    var state = AdvertiseState()
        private set(value) {
            field = value
            onState(value)
        }

    val isActive: Boolean get() = state.active

    /** null = unbekannt (Bluetooth aus), sonst ob dieses Modell selbst senden kann. */
    fun isSupported(): Boolean? {
        val a = adapter ?: return false
        if (!a.isEnabled) return null
        return try {
            a.bluetoothLeAdvertiser != null
        } catch (e: SecurityException) {
            null
        }
    }

    fun start(main: ByteArray, name: ByteArray, lowLatency: Boolean) {
        stop()
        val a = adapter
        if (a == null) {
            state = AdvertiseState(false, false, "Kein Bluetooth vorhanden")
            return
        }
        if (!a.isEnabled) {
            state = AdvertiseState(false, null, "Bluetooth ist aus")
            return
        }
        val adv = try {
            a.bluetoothLeAdvertiser
        } catch (e: SecurityException) {
            null
        }
        if (adv == null) {
            state = AdvertiseState(false, false, "Dieses Modell kann nicht selbst senden")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(
                if (lowLatency) AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY
                else AdvertiseSettings.ADVERTISE_MODE_BALANCED,
            )
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .setTimeout(0)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addManufacturerData(BleProtocol.COMPANY_ID, main)
            .build()
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addManufacturerData(BleProtocol.COMPANY_ID, name)
            .build()

        val cb = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                state = AdvertiseState(active = true, supported = true, error = null)
            }

            override fun onStartFailure(errorCode: Int) {
                val unsupported = errorCode == AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED
                val msg = when (errorCode) {
                    AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE -> "Aussendung zu groß"
                    AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "Dieses Modell kann nicht selbst senden"
                    AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED -> "Sender läuft bereits"
                    AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Zu viele Sender aktiv"
                    else -> "Senden fehlgeschlagen (Code $errorCode)"
                }
                state = AdvertiseState(active = false, supported = !unsupported, error = msg)
            }
        }

        try {
            adv.startAdvertising(settings, data, scanResponse, cb)
            advertiser = adv
            callback = cb
        } catch (e: SecurityException) {
            state = AdvertiseState(false, true, "Berechtigung zum Senden fehlt")
        } catch (e: IllegalStateException) {
            state = AdvertiseState(false, null, e.message ?: "Bluetooth nicht bereit")
        } catch (e: IllegalArgumentException) {
            state = AdvertiseState(false, true, e.message ?: "Aussendung ungültig")
        }
    }

    fun stop() {
        val adv = advertiser
        val cb = callback
        advertiser = null
        callback = null
        if (adv != null && cb != null) {
            try {
                adv.stopAdvertising(cb)
            } catch (e: Exception) {
                // Bluetooth kann inzwischen aus sein; dann gibt es nichts zu stoppen.
            }
        }
        if (state.active) state = state.copy(active = false)
    }
}
