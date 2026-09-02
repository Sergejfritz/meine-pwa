package de.sfritz.nahfunk.radio

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import de.sfritz.nahfunk.core.AdParser
import de.sfritz.nahfunk.core.AdRecord
import de.sfritz.nahfunk.core.BleProtocol

/** Hört Bluetooth-LE-Aussendungen mit: Nahfunk-Teilnehmer und fremde Geräte. */
class BleScanner(
    context: Context,
    private val onSighting: (BleSighting) -> Unit,
    private val onState: (ScanState) -> Unit,
) {
    data class ScanState(val active: Boolean = false, val filtered: Boolean = false, val error: String? = null)

    data class BleSighting(val address: String, val rssi: Int, val record: AdRecord, val time: Long)

    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager?.adapter

    private var scanner: BluetoothLeScanner? = null
    private var callback: ScanCallback? = null

    @Volatile
    var state = ScanState()
        private set(value) {
            field = value
            onState(value)
        }

    /**
     * @param filtered nur Nahfunk-Aussendungen (nötig bei ausgeschaltetem Bildschirm,
     *   Android liefert dann ohne Filter keine Ergebnisse).
     */
    fun start(filtered: Boolean, lowLatency: Boolean) {
        stop()
        val a = adapter
        if (a == null) {
            state = ScanState(false, filtered, "Kein Bluetooth vorhanden")
            return
        }
        if (!a.isEnabled) {
            state = ScanState(false, filtered, "Bluetooth ist aus")
            return
        }
        val s = a.bluetoothLeScanner
        if (s == null) {
            state = ScanState(false, filtered, "Bluetooth-Scanner nicht verfügbar")
            return
        }

        val settings = ScanSettings.Builder()
            .setScanMode(
                if (lowLatency) ScanSettings.SCAN_MODE_LOW_LATENCY
                else ScanSettings.SCAN_MODE_BALANCED,
            )
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            .setReportDelay(0)
            .build()

        val filters: List<ScanFilter>? = if (filtered) {
            listOf(
                ScanFilter.Builder()
                    .setManufacturerData(
                        BleProtocol.COMPANY_ID,
                        byteArrayOf(BleProtocol.MAGIC_MAIN, BleProtocol.VERSION),
                        byteArrayOf(0xFF.toByte(), 0xFF.toByte()),
                    )
                    .build(),
            )
        } else null

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                handle(result)
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                results.forEach { handle(it) }
            }

            override fun onScanFailed(errorCode: Int) {
                val msg = when (errorCode) {
                    ScanCallback.SCAN_FAILED_ALREADY_STARTED -> "Scan läuft bereits"
                    ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "Scanner konnte nicht registriert werden"
                    ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED -> "Scan wird nicht unterstützt"
                    ScanCallback.SCAN_FAILED_INTERNAL_ERROR -> "interner Bluetooth-Fehler"
                    else -> "Scan fehlgeschlagen (Code $errorCode)"
                }
                state = ScanState(false, filtered, msg)
            }
        }

        try {
            s.startScan(filters, settings, cb)
            scanner = s
            callback = cb
            state = ScanState(true, filtered, null)
        } catch (e: SecurityException) {
            state = ScanState(false, filtered, "Berechtigung zum Scannen fehlt")
        } catch (e: IllegalStateException) {
            state = ScanState(false, filtered, e.message ?: "Bluetooth nicht bereit")
        }
    }

    private fun handle(result: ScanResult) {
        val address = result.device?.address ?: return
        val record = AdParser.parse(result.scanRecord?.bytes)
        onSighting(BleSighting(address, result.rssi, record, System.currentTimeMillis()))
    }

    fun stop() {
        val s = scanner
        val cb = callback
        scanner = null
        callback = null
        if (s != null && cb != null) {
            try {
                s.stopScan(cb)
            } catch (e: Exception) {
                // Bluetooth kann inzwischen aus sein.
            }
        }
        if (state.active) state = state.copy(active = false)
    }
}
