package de.sfritz.nahfunk.core

import org.json.JSONException
import org.json.JSONObject
import java.util.Locale
import kotlin.random.Random

/**
 * Bluetooth-LE-Aussendung (Funk).
 *
 * Herstellerdaten mit der vom Bluetooth-SIG für Tests reservierten Kennung 0xFFFF.
 *
 * Hauptpaket (in der Aussendung, max. 24 Byte):
 *   'N' | Version | Flags | Geräte-ID (4) | Ping | Folge-Nr | Ziel-ID (4) | Kurzname (≤ 10 Byte)
 *
 * Namenspaket (in der Scan-Antwort, max. 25 Byte):
 *   'n' | Geräte-ID (4) | Name (≤ 20 Byte)
 */
object BleProtocol {
    const val COMPANY_ID = 0xFFFF
    const val MAGIC_MAIN: Byte = 0x4E // 'N'
    const val MAGIC_NAME: Byte = 0x6E // 'n'
    const val VERSION: Byte = 2
    const val HEADER_LEN = 13
    const val SHORT_NAME_BYTES = 10
    const val LONG_NAME_BYTES = 20

    /** Gerät ist auch im WLAN-Netz erreichbar (ganze Sätze möglich). */
    const val FLAG_LAN = 0x01

    /** Gerät hört mit (scannt), Pings kommen dort also an. */
    const val FLAG_LISTENING = 0x02

    data class Beacon(
        val id: String,
        val flags: Int,
        val ping: PingCode,
        val seq: Int,
        val targetId: String?,
        val shortName: String?,
    ) {
        val lanCapable: Boolean get() = flags and FLAG_LAN != 0
    }

    fun encodeMain(id: String, flags: Int, ping: PingCode, seq: Int, targetId: String?, shortName: String): ByteArray {
        val idB = idToBytes(id)
        val tgt = targetId?.let { idToBytes(it) } ?: ByteArray(4)
        val nameB = truncateUtf8(shortName, SHORT_NAME_BYTES)
        val out = ByteArray(HEADER_LEN + nameB.size)
        out[0] = MAGIC_MAIN
        out[1] = VERSION
        out[2] = (flags and 0xFF).toByte()
        System.arraycopy(idB, 0, out, 3, 4)
        out[7] = (ping.code and 0xFF).toByte()
        out[8] = (seq and 0xFF).toByte()
        System.arraycopy(tgt, 0, out, 9, 4)
        System.arraycopy(nameB, 0, out, HEADER_LEN, nameB.size)
        return out
    }

    fun decodeMain(b: ByteArray?): Beacon? {
        if (b == null || b.size < HEADER_LEN) return null
        if (b[0] != MAGIC_MAIN || b[1] != VERSION) return null
        val id = bytesToId(b, 3)
        val target = bytesToId(b, 9).takeIf { it != "00000000" }
        val name = if (b.size > HEADER_LEN) {
            String(b, HEADER_LEN, b.size - HEADER_LEN, Charsets.UTF_8).trim().takeIf { it.isNotEmpty() }
        } else null
        return Beacon(
            id = id,
            flags = b[2].toInt() and 0xFF,
            ping = PingCode.fromCode(b[7].toInt() and 0xFF),
            seq = b[8].toInt() and 0xFF,
            targetId = target,
            shortName = name,
        )
    }

    fun encodeName(id: String, name: String): ByteArray {
        val nameB = truncateUtf8(name, LONG_NAME_BYTES)
        val out = ByteArray(5 + nameB.size)
        out[0] = MAGIC_NAME
        System.arraycopy(idToBytes(id), 0, out, 1, 4)
        System.arraycopy(nameB, 0, out, 5, nameB.size)
        return out
    }

    /** Liefert (Geräte-ID, Name) oder null. */
    fun decodeName(b: ByteArray?): Pair<String, String>? {
        if (b == null || b.size < 6 || b[0] != MAGIC_NAME) return null
        val id = bytesToId(b, 1)
        val name = String(b, 5, b.size - 5, Charsets.UTF_8).trim()
        if (name.isEmpty()) return null
        return id to name
    }

    fun idToBytes(id: String): ByteArray {
        val out = ByteArray(4)
        if (id.length != 8) return out
        for (i in 0 until 4) {
            val v = id.substring(i * 2, i * 2 + 2).toIntOrNull(16) ?: return ByteArray(4)
            out[i] = v.toByte()
        }
        return out
    }

    fun bytesToId(b: ByteArray, off: Int): String {
        val sb = StringBuilder(8)
        for (i in 0 until 4) sb.append(String.format(Locale.ROOT, "%02x", b[off + i].toInt() and 0xFF))
        return sb.toString()
    }

    /** Kürzt auf höchstens [max] UTF-8-Bytes, ohne ein Zeichen zu zerschneiden. */
    fun truncateUtf8(s: String, max: Int): ByteArray {
        val sb = StringBuilder()
        var bytes = 0
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val chars = Character.charCount(cp)
            val len = when {
                cp < 0x80 -> 1
                cp < 0x800 -> 2
                cp < 0x10000 -> 3
                else -> 4
            }
            if (bytes + len > max) break
            sb.appendCodePoint(cp)
            bytes += len
            i += chars
        }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    fun randomId(): String = String.format(Locale.ROOT, "%08x", Random.nextInt())
}

/** Zerlegte Bluetooth-Aussendung (AD-Strukturen). */
data class AdRecord(
    val flags: Int? = null,
    val localName: String? = null,
    val manufacturer: List<Pair<Int, ByteArray>> = emptyList(),
    val serviceUuids16: List<Int> = emptyList(),
    val serviceUuids128: List<String> = emptyList(),
    val serviceData16: Map<Int, ByteArray> = emptyMap(),
    val appearance: Int? = null,
    val txPower: Int? = null,
) {
    fun manufacturerData(companyId: Int): List<ByteArray> =
        manufacturer.filter { it.first == companyId }.map { it.second }

    fun hasManufacturer(companyId: Int): Boolean = manufacturer.any { it.first == companyId }
    fun hasService16(uuid: Int): Boolean = serviceUuids16.contains(uuid) || serviceData16.containsKey(uuid)
}

/** Eigener Parser für die Rohbytes, damit mehrere Herstellerdaten-Blöcke erhalten bleiben. */
object AdParser {
    fun parse(raw: ByteArray?): AdRecord {
        if (raw == null) return AdRecord()
        var flags: Int? = null
        var name: String? = null
        val manufacturer = ArrayList<Pair<Int, ByteArray>>()
        val uuids16 = ArrayList<Int>()
        val uuids128 = ArrayList<String>()
        val serviceData = HashMap<Int, ByteArray>()
        var appearance: Int? = null
        var txPower: Int? = null

        var i = 0
        while (i < raw.size) {
            val len = raw[i].toInt() and 0xFF
            if (len == 0) break
            if (i + 1 >= raw.size) break
            val type = raw[i + 1].toInt() and 0xFF
            val start = i + 2
            val end = minOf(i + 1 + len, raw.size)
            val data = if (start < end) raw.copyOfRange(start, end) else ByteArray(0)
            when (type) {
                0x01 -> if (data.isNotEmpty()) flags = data[0].toInt() and 0xFF
                0x02, 0x03 -> {
                    var j = 0
                    while (j + 1 < data.size) {
                        uuids16.add((data[j].toInt() and 0xFF) or ((data[j + 1].toInt() and 0xFF) shl 8))
                        j += 2
                    }
                }
                0x06, 0x07 -> {
                    var j = 0
                    while (j + 15 < data.size) {
                        uuids128.add(uuid128(data, j))
                        j += 16
                    }
                }
                0x08 -> if (name == null) name = String(data, Charsets.UTF_8)
                0x09 -> name = String(data, Charsets.UTF_8)
                0x0A -> if (data.isNotEmpty()) txPower = data[0].toInt()
                0x16 -> if (data.size >= 2) {
                    val uuid = (data[0].toInt() and 0xFF) or ((data[1].toInt() and 0xFF) shl 8)
                    serviceData[uuid] = data.copyOfRange(2, data.size)
                }
                0x19 -> if (data.size >= 2) appearance = (data[0].toInt() and 0xFF) or ((data[1].toInt() and 0xFF) shl 8)
                0xFF -> if (data.size >= 2) {
                    val company = (data[0].toInt() and 0xFF) or ((data[1].toInt() and 0xFF) shl 8)
                    manufacturer.add(company to data.copyOfRange(2, data.size))
                }
            }
            i += len + 1
        }
        return AdRecord(flags, name?.trim()?.takeIf { it.isNotEmpty() }, manufacturer, uuids16, uuids128, serviceData, appearance, txPower)
    }

    private fun uuid128(d: ByteArray, off: Int): String {
        // In der Aussendung steht die UUID in umgekehrter Bytefolge.
        val sb = StringBuilder(36)
        for (k in 15 downTo 0) {
            sb.append(String.format(Locale.ROOT, "%02x", d[off + k].toInt() and 0xFF))
            if (k == 12 || k == 10 || k == 8 || k == 6) sb.append('-')
        }
        return sb.toString()
    }
}

/** Nachricht im eigenen WLAN-Netz (UDP, JSON). */
data class LanMessage(
    val type: String,
    val id: String,
    val name: String,
    val seq: Int,
    val ping: PingCode = PingCode.NONE,
    val text: String? = null,
    val target: String? = null,
    val canAdvertise: Boolean = false,
    val ts: Long = 0L,
) {
    companion object {
        const val HELLO = "hello"
        const val PING = "ping"
        const val TEXT = "text"
        const val BYE = "bye"
    }
}

object LanProtocol {
    const val PORT = 47474
    const val GROUP = "239.255.47.47"
    const val VERSION = 2
    const val MAX_TEXT = 500
    const val MAX_PACKET = 1400

    fun encode(m: LanMessage): ByteArray {
        val o = JSONObject()
            .put("app", "nahfunk")
            .put("v", VERSION)
            .put("t", m.type)
            .put("id", m.id)
            .put("name", m.name)
            .put("seq", m.seq)
            .put("ts", m.ts)
        if (m.ping != PingCode.NONE) o.put("ping", m.ping.code)
        if (m.text != null) o.put("text", m.text.take(MAX_TEXT))
        if (m.target != null) o.put("to", m.target)
        if (m.canAdvertise) o.put("adv", true)
        return o.toString().toByteArray(Charsets.UTF_8)
    }

    fun decode(bytes: ByteArray, offset: Int, length: Int): LanMessage? {
        if (length <= 0 || length > MAX_PACKET) return null
        return try {
            val o = JSONObject(String(bytes, offset, length, Charsets.UTF_8))
            if (o.optString("app") != "nahfunk") return null
            if (o.optInt("v", 0) < 1) return null
            val type = o.optString("t")
            val id = o.optString("id")
            if (type.isEmpty() || id.length != 8) return null
            LanMessage(
                type = type,
                id = id,
                name = o.optString("name").ifBlank { "Jemand" }.take(40),
                seq = o.optInt("seq", 0),
                ping = PingCode.fromCode(o.optInt("ping", 0)),
                text = if (o.has("text")) o.optString("text").take(MAX_TEXT) else null,
                target = if (o.has("to")) o.optString("to").takeIf { it.length == 8 } else null,
                canAdvertise = o.optBoolean("adv", false),
                ts = o.optLong("ts", 0L),
            )
        } catch (e: JSONException) {
            null
        }
    }
}
