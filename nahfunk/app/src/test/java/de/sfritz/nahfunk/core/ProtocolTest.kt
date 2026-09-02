package de.sfritz.nahfunk.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {

    @Test
    fun `Hauptpaket geht verlustfrei hin und zurück`() {
        val bytes = BleProtocol.encodeMain("a1b2c3d4", BleProtocol.FLAG_LAN, PingCode.COFFEE, 200, "deadbeef", "Sergej")
        assertTrue("passt in 24 Byte", bytes.size <= 24)
        val b = BleProtocol.decodeMain(bytes)
        assertNotNull(b)
        assertEquals("a1b2c3d4", b!!.id)
        assertEquals(PingCode.COFFEE, b.ping)
        assertEquals(200, b.seq)
        assertEquals("deadbeef", b.targetId)
        assertEquals("Sergej", b.shortName)
        assertTrue(b.lanCapable)
    }

    @Test
    fun `ohne Ziel ist targetId null`() {
        val bytes = BleProtocol.encodeMain("00000001", 0, PingCode.NONE, 0, null, "")
        val b = BleProtocol.decodeMain(bytes)!!
        assertNull(b.targetId)
        assertNull(b.shortName)
        assertEquals(PingCode.NONE, b.ping)
        assertFalse(b.lanCapable)
    }

    @Test
    fun `Kurzname wird auf zehn Byte gekürzt ohne Umlaute zu zerschneiden`() {
        val bytes = BleProtocol.encodeMain("00000001", 0, PingCode.NONE, 0, null, "Jürgen Müller-Lüdenscheid")
        assertTrue(bytes.size <= BleProtocol.HEADER_LEN + BleProtocol.SHORT_NAME_BYTES)
        val b = BleProtocol.decodeMain(bytes)!!
        // "Jürgen Mü" = 9 Zeichen, 11 Byte -> zu viel; "Jürgen M" = 8 Zeichen, 9 Byte passt
        assertEquals("Jürgen M", b.shortName)
    }

    @Test
    fun `Namenspaket mit Umlauten`() {
        val bytes = BleProtocol.encodeName("cafebabe", "Sergej Fritz Müller")
        assertTrue(bytes.size <= 5 + BleProtocol.LONG_NAME_BYTES)
        val (id, name) = BleProtocol.decodeName(bytes)!!
        assertEquals("cafebabe", id)
        assertEquals("Sergej Fritz Müller", name)
    }

    @Test
    fun `fremde Daten werden abgelehnt`() {
        assertNull(BleProtocol.decodeMain(null))
        assertNull(BleProtocol.decodeMain(byteArrayOf(1, 2, 3)))
        assertNull(BleProtocol.decodeMain(ByteArray(13) { 0x4E }))
        assertNull(BleProtocol.decodeName(byteArrayOf(0x6E, 1, 2)))
    }

    @Test
    fun `AD-Parser liest Flags, Namen, mehrere Herstellerblöcke, UUIDs und Appearance`() {
        val main = BleProtocol.encodeMain("a1b2c3d4", 0, PingCode.HELLO, 7, null, "Max")
        val name = BleProtocol.encodeName("a1b2c3d4", "Max Mustermann")
        val raw = ArrayList<Byte>()
        raw.addAll(listOf(0x02, 0x01, 0x06).map { it.toByte() })
        // Längenbyte = Typ (1) + Herstellerkennung (2) + Nutzdaten
        raw.addAll(listOf((3 + main.size).toByte(), 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte())); raw.addAll(main.toList())
        raw.addAll(listOf(0x05, 0x03, 0x2C, 0xFE, 0x0F, 0x18).map { it.toByte() })
        raw.addAll(listOf(0x03, 0x19, 0x40, 0x00).map { it.toByte() })
        raw.addAll(listOf(0x05, 0x09, 'T'.code, 'e'.code, 's'.code, 't'.code).map { it.toByte() })
        raw.addAll(listOf((3 + name.size).toByte(), 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte())); raw.addAll(name.toList())
        raw.addAll(listOf(0x00, 0x00, 0x00).map { it.toByte() })

        val rec = AdParser.parse(raw.toByteArray())
        assertEquals(0x06, rec.flags)
        assertEquals("Test", rec.localName)
        assertEquals(listOf(0xFE2C, 0x180F), rec.serviceUuids16)
        assertEquals(0x0040, rec.appearance)
        val blocks = rec.manufacturerData(BleProtocol.COMPANY_ID)
        assertEquals(2, blocks.size)
        assertArrayEquals(main, blocks[0])
        assertArrayEquals(name, blocks[1])
        assertEquals("a1b2c3d4", BleProtocol.decodeMain(blocks[0])!!.id)
        assertEquals("Max Mustermann", BleProtocol.decodeName(blocks[1])!!.second)
    }

    @Test
    fun `AD-Parser stürzt bei kaputten Längen nicht ab`() {
        val rec = AdParser.parse(byteArrayOf(0x20, 0x09, 'A'.code.toByte()))
        assertNotNull(rec)
        assertNull(AdParser.parse(null).localName)
        assertNull(AdParser.parse(ByteArray(0)).flags)
        // Längenbyte ohne Typbyte
        assertNull(AdParser.parse(byteArrayOf(0x01)).flags)
        // abgeschnittene letzte Struktur: was da ist, wird noch gelesen
        assertEquals("A", AdParser.parse(byteArrayOf(0x05, 0x09, 'A'.code.toByte())).localName)
        // Struktur, die genau bis zum Ende reicht
        assertEquals(0x06, AdParser.parse(byteArrayOf(0x02, 0x01, 0x06)).flags)
    }

    @Test
    fun `AD-Parser liest 128-Bit-UUIDs in richtiger Reihenfolge`() {
        val uuidLe = byteArrayOf(
            0xFB.toByte(), 0x34, 0x9B.toByte(), 0x5F, 0x80.toByte(), 0x00, 0x00, 0x80.toByte(),
            0x00, 0x10, 0x00, 0x00, 0x0F, 0x18, 0x00, 0x00,
        )
        val raw = byteArrayOf(0x11, 0x07) + uuidLe
        val rec = AdParser.parse(raw)
        assertEquals(listOf("0000180f-0000-1000-8000-00805f9b34fb"), rec.serviceUuids128)
    }

    @Test
    fun `Netz-Nachricht hin und zurück`() {
        val m = LanMessage(LanMessage.TEXT, "a1b2c3d4", "Sergej", 42, PingCode.NONE, "Kommst du kurz zur Drehbank 3?", "deadbeef", true, 1234L)
        val bytes = LanProtocol.encode(m)
        val d = LanProtocol.decode(bytes, 0, bytes.size)
        assertEquals(m, d)
    }

    @Test
    fun `Netz-Ping ohne Text`() {
        val m = LanMessage(LanMessage.PING, "a1b2c3d4", "Sergej", 1, PingCode.SOS)
        val d = LanProtocol.decode(LanProtocol.encode(m).let { it }, 0, LanProtocol.encode(m).size)!!
        assertEquals(PingCode.SOS, d.ping)
        assertNull(d.text)
        assertNull(d.target)
    }

    @Test
    fun `fremdes JSON und Müll werden abgelehnt`() {
        val other = """{"app":"x","v":2,"t":"ping","id":"a1b2c3d4"}""".toByteArray()
        assertNull(LanProtocol.decode(other, 0, other.size))
        val garbage = "hallo welt".toByteArray()
        assertNull(LanProtocol.decode(garbage, 0, garbage.size))
        assertNull(LanProtocol.decode(ByteArray(0), 0, 0))
        val badId = """{"app":"nahfunk","v":2,"t":"ping","id":"kurz"}""".toByteArray()
        assertNull(LanProtocol.decode(badId, 0, badId.size))
    }

    @Test
    fun `Geräte-ID ist acht Hex-Zeichen`() {
        repeat(20) {
            val id = BleProtocol.randomId()
            assertEquals(8, id.length)
            assertTrue(id.all { it in '0'..'9' || it in 'a'..'f' })
            assertEquals(id, BleProtocol.bytesToId(BleProtocol.idToBytes(id), 0))
        }
    }
}
