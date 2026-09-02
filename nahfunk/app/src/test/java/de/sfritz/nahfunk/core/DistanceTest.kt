package de.sfritz.nahfunk.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DistanceTest {

    @Test
    fun `Eichwert ergibt genau einen Meter`() {
        assertEquals(1.0, Distance.estimate(-59.0, -59.0, 2.5), 1e-9)
    }

    @Test
    fun `25 dB weniger bei Dämpfung 2,5 sind zehn Meter`() {
        assertEquals(10.0, Distance.estimate(-84.0, -59.0, 2.5), 1e-6)
    }

    @Test
    fun `Kanal entscheidet über den Eichwert`() {
        val cal = Calibration(p0Ble = -59.0, p0Wifi = -40.0, environment = Environment.OPEN)
        assertEquals(1.0, Distance.estimate(-59.0, Channel.BLE, cal), 1e-9)
        assertEquals(1.0, Distance.estimate(-40.0, Channel.WIFI_AP, cal), 1e-9)
        assertEquals(10.0, Distance.estimate(-60.0, Channel.WIFI_AP, cal), 1e-6)
    }

    @Test
    fun `Glättung folgt dem Signal langsam`() {
        assertEquals(-70.0, Distance.smooth(null, -70), 1e-9)
        val s = Distance.smooth(-70.0, -60)
        assertEquals(-67.0, s, 1e-9)
    }

    @Test
    fun `Ringabbildung ist monoton und bleibt zwischen null und eins`() {
        var last = -1f
        for (d in listOf(0.0, 0.5, 2.0, 7.5, 20.0, 50.0, 150.0, 400.0)) {
            val f = Distance.ringFraction(d, 150.0)
            assertTrue(f >= 0f && f <= 1f)
            assertTrue("monoton bei $d", f >= last)
            last = f
        }
        assertEquals(1f, Distance.ringFraction(150.0, 150.0), 1e-6f)
        assertEquals(0f, Distance.ringFraction(0.0, 150.0), 1e-6f)
    }

    @Test
    fun `Auto-Maßstab wählt die nächste Stufe`() {
        assertEquals(15.0, Distance.autoScale(null), 0.0)
        assertEquals(5.0, Distance.autoScale(3.0), 0.0)
        assertEquals(15.0, Distance.autoScale(5.0), 0.0)
        assertEquals(150.0, Distance.autoScale(120.0), 0.0)
        assertEquals(500.0, Distance.autoScale(900.0), 0.0)
    }

    @Test
    fun `Formatierung auf Deutsch`() {
        assertEquals("< 1 m", Distance.format(0.4))
        assertEquals("2,5 m", Distance.format(2.5))
        assertEquals("25 m", Distance.format(25.4))
        assertEquals("-84 dBm", Distance.formatDbm(-84.2))
    }

    @Test
    fun `Peer-Distanz nutzt die Kalibrierung`() {
        val p = Peer("x", "x", PeerKind.PHONE, mapOf(Channel.BLE to 0L), rssi = -84.0, rssiChannel = Channel.BLE)
        assertEquals(10.0, p.distanceMeters(Calibration())!!, 1e-6)
        val none = Peer("y", "y", PeerKind.NAHFUNK, mapOf(Channel.LAN to 0L))
        assertEquals(null, none.distanceMeters(Calibration()))
    }
}
