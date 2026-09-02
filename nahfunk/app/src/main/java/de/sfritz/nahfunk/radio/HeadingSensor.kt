package de.sfritz.nahfunk.radio

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Kompass: Blickrichtung des Handys in Grad (0 = Nord, im Uhrzeigersinn).
 * Funktioniert flach gehalten und aufrecht; nutzt die Deklination, wenn ein
 * letzter Standort bekannt ist (dann geografisch Nord, sonst magnetisch).
 */
class HeadingSensor(context: Context) : SensorEventListener {

    private val appContext = context.applicationContext
    private val sm = appContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val sensor: Sensor? = sm?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

    private val _heading = MutableStateFlow<Float?>(null)
    val heading: StateFlow<Float?> = _heading

    private val _geographic = MutableStateFlow(false)
    val geographic: StateFlow<Boolean> = _geographic

    val available: Boolean get() = sensor != null

    private var declination = 0f
    private var sx = 0f
    private var sy = 0f
    private var haveSmoothed = false
    private val r = FloatArray(9)
    private val r2 = FloatArray(9)
    private val o = FloatArray(3)

    @Volatile
    var running = false
        private set

    fun start() {
        val s = sensor ?: return
        if (running) return
        running = true
        updateDeclination()
        sm?.registerListener(this, s, SensorManager.SENSOR_DELAY_GAME)
    }

    fun stop() {
        if (!running) return
        running = false
        sm?.unregisterListener(this)
    }

    /** Letzten bekannten Standort holen – nur für die Missweisung, kein GPS-Start. */
    fun updateDeclination() {
        val lm = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        var best: Location? = null
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)) {
            val loc = try {
                if (lm.allProviders.contains(provider)) lm.getLastKnownLocation(provider) else null
            } catch (e: SecurityException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            }
            if (loc != null && (best == null || loc.time > best.time)) best = loc
        }
        val loc = best
        if (loc != null) {
            declination = GeomagneticField(
                loc.latitude.toFloat(), loc.longitude.toFloat(), loc.altitude.toFloat(), System.currentTimeMillis(),
            ).declination
            _geographic.value = true
        } else {
            declination = 0f
            _geographic.value = false
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        val values = if (event.values.size > 4) event.values.copyOf(4) else event.values
        try {
            SensorManager.getRotationMatrixFromVector(r, values)
        } catch (e: IllegalArgumentException) {
            return
        }
        SensorManager.getOrientation(r, o)
        var azimuth = o[0]
        val pitch = o[1]
        if (abs(pitch) > UPRIGHT_PITCH_RAD) {
            // Handy steht aufrecht (Bildschirm zum Gesicht): Achsen umlegen
            SensorManager.remapCoordinateSystem(r, SensorManager.AXIS_X, SensorManager.AXIS_Z, r2)
            SensorManager.getOrientation(r2, o)
            azimuth = o[0]
        }
        val deg = Math.toDegrees(azimuth.toDouble()) + declination
        val rad = Math.toRadians(deg)
        val cx = cos(rad).toFloat()
        val cy = sin(rad).toFloat()
        if (!haveSmoothed) {
            sx = cx
            sy = cy
            haveSmoothed = true
        } else {
            sx += SMOOTHING * (cx - sx)
            sy += SMOOTHING * (cy - sy)
        }
        val smoothed = Math.toDegrees(atan2(sy.toDouble(), sx.toDouble())).toFloat()
        _heading.value = ((smoothed % 360f) + 360f) % 360f
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private companion object {
        const val SMOOTHING = 0.25f
        val UPRIGHT_PITCH_RAD = Math.toRadians(45.0).toFloat()
    }
}
