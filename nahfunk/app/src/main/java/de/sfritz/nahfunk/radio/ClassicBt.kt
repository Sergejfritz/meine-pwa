package de.sfritz.nahfunk.radio

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat

/**
 * Klassisches Bluetooth als Ersatzweg: Handys, die nicht per LE senden können,
 * machen sich so trotzdem für andere sichtbar (Systemdialog), und die Suche
 * findet klassisch sichtbare Geräte samt Signalstärke.
 */
object ClassicBt {
    const val DISCOVERABLE_SECONDS = 300

    fun discoverableIntent(seconds: Int = DISCOVERABLE_SECONDS): Intent =
        Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
            .putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, seconds)

    fun enableIntent(): Intent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)

    fun adapter(context: Context): BluetoothAdapter? =
        (context.applicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    /** null = nicht feststellbar (Berechtigung fehlt oder Bluetooth aus). */
    fun isDiscoverable(context: Context): Boolean? {
        val a = adapter(context) ?: return false
        if (!a.isEnabled) return null
        return try {
            a.scanMode == BluetoothAdapter.SCAN_MODE_CONNECTABLE_DISCOVERABLE
        } catch (e: SecurityException) {
            null
        }
    }
}

class ClassicDiscovery(
    context: Context,
    private val onFound: (ClassicSighting) -> Unit,
    private val onFinished: () -> Unit,
) {
    data class ClassicSighting(
        val address: String,
        val name: String?,
        val rssi: Int?,
        val majorClass: Int,
        val deviceClass: Int,
        val time: Long,
    )

    private val appContext = context.applicationContext
    private var receiver: BroadcastReceiver? = null

    @Volatile
    var running = false
        private set

    fun start(): Boolean {
        val adapter = ClassicBt.adapter(appContext) ?: return false
        if (!adapter.isEnabled) return false
        if (running) return true

        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                when (intent.action) {
                    BluetoothDevice.ACTION_FOUND -> {
                        val device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                        val address = device?.address ?: return
                        val name = intent.getStringExtra(BluetoothDevice.EXTRA_NAME)
                        val rssiRaw = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE)
                        val rssi = if (rssiRaw == Short.MIN_VALUE) null else rssiRaw.toInt()
                        val cls = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_CLASS, BluetoothClass::class.java)
                        onFound(
                            ClassicSighting(
                                address = address,
                                name = name,
                                rssi = rssi,
                                majorClass = cls?.majorDeviceClass ?: 0,
                                deviceClass = cls?.deviceClass ?: 0,
                                time = System.currentTimeMillis(),
                            ),
                        )
                    }
                    BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                        finish()
                        onFinished()
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_FOUND)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        }
        ContextCompat.registerReceiver(appContext, r, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = r
        running = true

        return try {
            if (adapter.isDiscovering) adapter.cancelDiscovery()
            val ok = adapter.startDiscovery()
            if (!ok) finish()
            ok
        } catch (e: SecurityException) {
            finish()
            false
        }
    }

    fun cancel() {
        try {
            ClassicBt.adapter(appContext)?.let { if (it.isDiscovering) it.cancelDiscovery() }
        } catch (e: SecurityException) {
            // dann läuft die Suche eben bis zum natürlichen Ende
        }
        finish()
    }

    private fun finish() {
        val r = receiver ?: return
        receiver = null
        running = false
        try {
            appContext.unregisterReceiver(r)
        } catch (e: IllegalArgumentException) {
            // schon abgemeldet
        }
    }
}
