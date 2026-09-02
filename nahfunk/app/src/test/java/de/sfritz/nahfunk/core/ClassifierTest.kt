package de.sfritz.nahfunk.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassifierTest {

    private fun rec(
        name: String? = null,
        manufacturer: List<Pair<Int, ByteArray>> = emptyList(),
        services: List<Int> = emptyList(),
        appearance: Int? = null,
    ) = AdRecord(localName = name, manufacturer = manufacturer, serviceUuids16 = services, appearance = appearance)

    @Test
    fun `Namen erkennen Handys, Zubehör und Geräte`() {
        assertEquals(PeerKind.PHONE, Classifier.classifyBle(rec("Galaxy S23 von Sergej")).kind)
        assertEquals(PeerKind.PHONE, Classifier.classifyBle(rec("iPhone von Anna")).kind)
        assertEquals(PeerKind.ACCESSORY, Classifier.classifyBle(rec("JBL Flip 6")).kind)
        assertEquals(PeerKind.ACCESSORY, Classifier.classifyBle(rec("Galaxy Buds2")).kind)
        assertEquals(PeerKind.IOT, Classifier.classifyBle(rec("LYWSD03MMC")).kind)
        assertEquals(PeerKind.IOT, Classifier.classifyBle(rec("[TV] Samsung Q80")).kind)
        assertEquals(PeerKind.COMPUTER, Classifier.classifyBle(rec("DESKTOP-4F3K2")).kind)
    }

    @Test
    fun `Apple-Typen`() {
        assertEquals(PeerKind.PHONE, Classifier.classifyBle(rec(manufacturer = listOf(0x004C to byteArrayOf(0x10, 0x05)))).kind)
        assertEquals(PeerKind.ACCESSORY, Classifier.classifyBle(rec(manufacturer = listOf(0x004C to byteArrayOf(0x07, 0x19)))).kind)
        assertEquals(PeerKind.IOT, Classifier.classifyBle(rec(manufacturer = listOf(0x004C to byteArrayOf(0x02, 0x15)))).kind)
    }

    @Test
    fun `Herstellerkennungen`() {
        val samsung = Classifier.classifyBle(rec(manufacturer = listOf(0x0075 to byteArrayOf(0x42))))
        assertEquals(PeerKind.PHONE, samsung.kind)
        assertEquals("Samsung", samsung.detail)
        assertEquals(PeerKind.COMPUTER, Classifier.classifyBle(rec(manufacturer = listOf(0x0006 to byteArrayOf(0x01)))).kind)
        assertEquals(PeerKind.ACCESSORY, Classifier.classifyBle(rec(manufacturer = listOf(0x0087 to byteArrayOf(0x01)))).kind)
    }

    @Test
    fun `Appearance und Services`() {
        assertEquals(PeerKind.PHONE, Classifier.classifyBle(rec(appearance = 0x0040)).kind)
        assertEquals(PeerKind.COMPUTER, Classifier.classifyBle(rec(appearance = 0x0080)).kind)
        assertEquals(PeerKind.ACCESSORY, Classifier.classifyBle(rec(appearance = 0x00C0)).kind)
        assertEquals(PeerKind.IOT, Classifier.classifyBle(rec(appearance = 0x0300)).kind)
        assertEquals(PeerKind.PHONE, Classifier.classifyBle(rec(services = listOf(0xFD6F))).kind)
        assertEquals(PeerKind.ACCESSORY, Classifier.classifyBle(rec(services = listOf(0xFE2C))).kind)
        assertEquals(PeerKind.IOT, Classifier.classifyBle(rec(services = listOf(0xFE95))).kind)
        assertEquals(PeerKind.UNKNOWN, Classifier.classifyBle(rec()).kind)
    }

    @Test
    fun `Name schlägt Herstellerkennung`() {
        val r = Classifier.classifyBle(rec("Galaxy Buds Pro", manufacturer = listOf(0x0075 to byteArrayOf(0x42))))
        assertEquals(PeerKind.ACCESSORY, r.kind)
    }

    @Test
    fun `klassisches Bluetooth nach Geräteklasse`() {
        assertEquals(PeerKind.PHONE, Classifier.classifyClassic(0x0200, 0x020C, null).kind)
        assertEquals(PeerKind.IOT, Classifier.classifyClassic(0x0400, 0x043C, null).kind)
        assertEquals(PeerKind.ACCESSORY, Classifier.classifyClassic(0x0400, 0x0418, null).kind)
        assertEquals(PeerKind.COMPUTER, Classifier.classifyClassic(0x0100, 0x010C, null).kind)
        assertEquals(PeerKind.UNKNOWN, Classifier.classifyClassic(0x1F00, 0, null).kind)
    }

    @Test
    fun `Filter`() {
        assertTrue(Classifier.passesFilter(PeerKind.NAHFUNK, Filter.NAHFUNK))
        assertFalse(Classifier.passesFilter(PeerKind.PHONE, Filter.NAHFUNK))
        assertTrue(Classifier.passesFilter(PeerKind.PHONE, Filter.PHONES))
        assertFalse(Classifier.passesFilter(PeerKind.ACCESS_POINT, Filter.PHONES))
        assertTrue(Classifier.passesFilter(PeerKind.IOT, Filter.ALL))
    }
}
