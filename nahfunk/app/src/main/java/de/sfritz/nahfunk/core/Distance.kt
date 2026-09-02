package de.sfritz.nahfunk.core

import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/** Umgebungs-Voreinstellung: bestimmt den Dämpfungsexponenten des Pfadverlustmodells. */
enum class Environment(val label: String, val exponent: Double, val hint: String) {
    OPEN("Frei", 2.0, "freies Feld, Sichtverbindung"),
    HALL("Halle", 2.5, "große Halle, Maschinen, Regale"),
    OFFICE("Büro", 3.0, "Wände, mehrere Räume");

    fun next(): Environment = entries[(ordinal + 1) % entries.size]
}

/** Eichwerte: Signalstärke in 1 m Abstand, getrennt für Handys (Funk) und WLAN-Router. */
data class Calibration(
    val p0Ble: Double = DEFAULT_P0_BLE,
    val p0Wifi: Double = DEFAULT_P0_WIFI,
    val environment: Environment = Environment.HALL,
) {
    fun p0For(channel: Channel?): Double = when (channel) {
        Channel.WIFI_AP -> p0Wifi
        else -> p0Ble
    }

    val isDefault: Boolean get() = p0Ble == DEFAULT_P0_BLE && p0Wifi == DEFAULT_P0_WIFI

    companion object {
        const val DEFAULT_P0_BLE = -59.0
        const val DEFAULT_P0_WIFI = -40.0
    }
}

object Distance {
    /** Log-Distanz-Pfadverlustmodell: d = 10^((P0 − RSSI) / (10·n)). */
    fun estimate(rssi: Double, p0: Double, exponent: Double): Double {
        val d = 10.0.pow((p0 - rssi) / (10.0 * exponent))
        return d.coerceIn(0.1, 2000.0)
    }

    fun estimate(rssi: Double, channel: Channel?, cal: Calibration): Double =
        estimate(rssi, cal.p0For(channel), cal.environment.exponent)

    /** Exponentielle Glättung; das erste Sample wird direkt übernommen. */
    fun smooth(previous: Double?, sample: Int, alpha: Double = 0.3): Double =
        if (previous == null) sample.toDouble() else previous + alpha * (sample - previous)

    fun format(meters: Double): String = when {
        meters < 1.0 -> "< 1 m"
        meters < 10.0 -> String.format(Locale.GERMANY, "%.1f m", meters)
        else -> "${meters.roundToInt()} m"
    }

    fun formatDbm(rssi: Double): String = "${rssi.roundToInt()} dBm"

    /**
     * Abbildung Entfernung → Ringradius (0..1), logarithmisch, damit 2 m und 150 m
     * gleichzeitig lesbar auf dem Radar liegen.
     */
    fun ringFraction(meters: Double, maxMeters: Double): Float {
        val a = maxMeters / 60.0
        val f = ln(1 + meters / a) / ln(1 + maxMeters / a)
        return f.coerceIn(0.0, 1.0).toFloat()
    }

    /** Auto-Maßstab: der kleinste Standardmaßstab, in den alle Entfernungen passen. */
    fun autoScale(maxDistance: Double?): Double {
        val steps = listOf(5.0, 15.0, 50.0, 150.0, 500.0)
        if (maxDistance == null) return 15.0
        return steps.firstOrNull { it >= maxDistance * 1.1 } ?: 500.0
    }

    /** Beschriftete Ringe für einen Maßstab. */
    fun rings(maxMeters: Double): List<Double> = when {
        maxMeters <= 5.0 -> listOf(0.5, 1.0, 2.0, 3.5, 5.0)
        maxMeters <= 15.0 -> listOf(1.0, 2.5, 5.0, 10.0, 15.0)
        maxMeters <= 50.0 -> listOf(1.0, 3.0, 10.0, 25.0, 50.0)
        maxMeters <= 150.0 -> listOf(2.0, 7.5, 20.0, 50.0, 150.0)
        else -> listOf(5.0, 20.0, 60.0, 200.0, 500.0)
    }
}

fun Peer.distanceMeters(cal: Calibration): Double? =
    rssi?.let { Distance.estimate(it, rssiChannel, cal) }
