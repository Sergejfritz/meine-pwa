package de.sfritz.nahfunk.core

/**
 * Ordnet fremde Bluetooth-Geräte grob ein: Handy, Computer, Zubehör oder sonstiges Gerät.
 * Grundlage sind Herstellerkennung, Service-UUIDs, Appearance und der Name.
 */
object Classifier {

    data class Result(val kind: PeerKind, val detail: String)

    private const val APPLE = 0x004C
    private const val MICROSOFT = 0x0006
    private const val SAMSUNG = 0x0075
    private const val GOOGLE = 0x00E0
    private const val XIAOMI = 0x038F
    private const val HUAWEI = 0x027D
    private const val SONY = 0x012D
    private const val GARMIN = 0x0087
    private const val FITBIT = 0x0224
    private const val BOSE = 0x009E
    private const val ONEPLUS = 0x0A0B

    private const val SVC_FAST_PAIR = 0xFE2C
    private const val SVC_EDDYSTONE = 0xFEAA
    private const val SVC_EXPOSURE = 0xFD6F
    private const val SVC_XIAOMI = 0xFE95
    private const val SVC_TILE = 0xFEED
    private const val SVC_HEALTH_THERMO = 0x1809
    private const val SVC_ENVIRONMENTAL = 0x181A
    private const val SVC_HEART_RATE = 0x180D
    private const val SVC_GOVEE = 0xEC88

    private val phoneNames = Regex(
        "iphone|galaxy|pixel|xiaomi|redmi|poco|oneplus|huawei|honor|oppo|vivo|realme|motorola|moto ?[geE]|nokia|fairphone|xperia|handy|phone|smartphone|nothing phone",
        RegexOption.IGNORE_CASE,
    )
    private val computerNames = Regex(
        "macbook|imac|mac ?mini|mac ?pro|thinkpad|laptop|notebook|desktop-|surface|chromebook|ideapad|zenbook|vivobook|latitude|elitebook|\\bpc\\b",
        RegexOption.IGNORE_CASE,
    )
    private val accessoryNames = Regex(
        "buds|airpods|headphone|kopfh|headset|watch|band|speaker|lautsprecher|jbl|bose|beats|soundcore|\\bwh-|\\bwf-|mouse|maus|keyboard|tastatur|pencil|\\bpen\\b|earbuds|stylus|controller|gamepad|hearing|hörger|garmin|fitbit|polar |suunto",
        RegexOption.IGNORE_CASE,
    )
    private val iotNames = Regex(
        "\\btv\\b|fernseher|bravia|chromecast|thermo|sensor|mi smart|mijia|lywsd|mj_ht|govee|tile|airtag|printer|drucker|hue|sonos|echo|alexa|nest|cam|lock|scale|waage|plug|steckdose|led|light|lampe|tesla|\\bvw\\b|\\bbmw\\b|obd|ebike|e-bike|bike|radar|beacon|shelly|tado|homematic|bosch|makita|dewalt|hilti|milwaukee|festool",
        RegexOption.IGNORE_CASE,
    )

    /** Fremdes BLE-Gerät anhand seiner Aussendung einordnen. */
    fun classifyBle(rec: AdRecord): Result {
        val name = rec.localName
        val byName = name?.let { classifyName(it) }
        if (byName != null) return byName

        rec.appearance?.let { app ->
            when (app shr 6) {
                1 -> return Result(PeerKind.PHONE, "Handy")
                2 -> return Result(PeerKind.COMPUTER, "Computer")
                3, 15, 33, 34, 37, 41, 42 -> return Result(PeerKind.ACCESSORY, "Zubehör")
                0 -> {}
                else -> return Result(PeerKind.IOT, "Gerät")
            }
        }

        if (rec.hasService16(SVC_EXPOSURE)) return Result(PeerKind.PHONE, "Handy")
        if (rec.hasService16(SVC_FAST_PAIR)) return Result(PeerKind.ACCESSORY, "Zubehör")
        if (rec.hasService16(SVC_XIAOMI)) return Result(PeerKind.IOT, "Xiaomi-Gerät")
        if (rec.hasService16(SVC_TILE)) return Result(PeerKind.IOT, "Tile")
        if (rec.hasService16(SVC_EDDYSTONE)) return Result(PeerKind.IOT, "Beacon")
        if (rec.hasService16(SVC_HEALTH_THERMO) || rec.hasService16(SVC_ENVIRONMENTAL)) return Result(PeerKind.IOT, "Thermometer")
        if (rec.hasService16(SVC_HEART_RATE)) return Result(PeerKind.ACCESSORY, "Pulsmesser")
        if (rec.hasService16(SVC_GOVEE)) return Result(PeerKind.IOT, "Govee")

        for ((company, data) in rec.manufacturer) {
            when (company) {
                APPLE -> return classifyApple(data)
                SAMSUNG -> return Result(PeerKind.PHONE, "Samsung")
                GOOGLE -> return Result(PeerKind.PHONE, "Google")
                XIAOMI -> return Result(PeerKind.PHONE, "Xiaomi")
                HUAWEI -> return Result(PeerKind.PHONE, "Huawei")
                ONEPLUS -> return Result(PeerKind.PHONE, "OnePlus")
                MICROSOFT -> return Result(PeerKind.COMPUTER, "Windows")
                SONY -> return Result(PeerKind.ACCESSORY, "Sony")
                GARMIN -> return Result(PeerKind.ACCESSORY, "Garmin")
                FITBIT -> return Result(PeerKind.ACCESSORY, "Fitbit")
                BOSE -> return Result(PeerKind.ACCESSORY, "Bose")
            }
        }
        return Result(PeerKind.UNKNOWN, if (name != null) "" else "ohne Namen")
    }

    private fun classifyApple(data: ByteArray): Result {
        val type = data.firstOrNull()?.toInt()?.and(0xFF) ?: return Result(PeerKind.UNKNOWN, "Apple")
        return when (type) {
            0x02 -> Result(PeerKind.IOT, "iBeacon")
            0x07 -> Result(PeerKind.ACCESSORY, "AirPods")
            0x09 -> Result(PeerKind.IOT, "AirPlay-Gerät")
            0x12 -> Result(PeerKind.ACCESSORY, "Apple Wo ist?")
            0x10, 0x0C, 0x0E, 0x0F, 0x05, 0x0A, 0x0D -> Result(PeerKind.PHONE, "Apple")
            else -> Result(PeerKind.UNKNOWN, "Apple")
        }
    }

    /** Spezielle Muster zuerst: „Galaxy Buds“ ist Zubehör, obwohl „Galaxy“ nach Handy klingt. */
    fun classifyName(name: String): Result? = when {
        accessoryNames.containsMatchIn(name) -> Result(PeerKind.ACCESSORY, "Zubehör")
        iotNames.containsMatchIn(name) -> Result(PeerKind.IOT, "Gerät")
        computerNames.containsMatchIn(name) -> Result(PeerKind.COMPUTER, "Computer")
        phoneNames.containsMatchIn(name) -> Result(PeerKind.PHONE, "Handy")
        else -> null
    }

    /** Klassisches Bluetooth: Geräteklasse aus dem Inquiry-Ergebnis. */
    fun classifyClassic(majorClass: Int, deviceClass: Int, name: String?): Result {
        val byName = name?.let { classifyName(it) }
        if (byName != null) return byName
        return when (majorClass) {
            0x0100 -> Result(PeerKind.COMPUTER, "Computer")
            0x0200 -> Result(PeerKind.PHONE, "Handy")
            0x0400 -> if (deviceClass == 0x043C) Result(PeerKind.IOT, "Fernseher") else Result(PeerKind.ACCESSORY, "Audio")
            0x0500, 0x0700 -> Result(PeerKind.ACCESSORY, "Zubehör")
            0x0300, 0x0600, 0x0800, 0x0900 -> Result(PeerKind.IOT, "Gerät")
            else -> Result(PeerKind.UNKNOWN, "")
        }
    }

    /** Welche Arten der Filter durchlässt. */
    fun passesFilter(kind: PeerKind, filter: Filter): Boolean = when (filter) {
        Filter.NAHFUNK -> kind == PeerKind.NAHFUNK
        Filter.PHONES -> kind == PeerKind.NAHFUNK || kind == PeerKind.PHONE
        Filter.ALL -> true
    }
}
