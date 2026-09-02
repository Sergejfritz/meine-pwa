package de.sfritz.nahfunk.core

/** Über welchen Weg ein Gerät gesehen wurde. */
enum class Channel(val label: String) {
    BLE("Funk"),
    LAN("im Netz"),
    WIFI_AP("WLAN-Aushang"),
    CLASSIC("Bluetooth klassisch"),
}

/** Was für ein Gerät das ist – bestimmt Symbol und Filter. */
enum class PeerKind(val emoji: String, val label: String) {
    NAHFUNK("🟢", "Nahfunk"),
    PHONE("📱", "Handy"),
    COMPUTER("💻", "Computer"),
    ACCESSORY("🎧", "Zubehör"),
    IOT("🌡️", "Gerät"),
    ACCESS_POINT("📡", "WLAN-Sender"),
    UNKNOWN("❔", "Unbekannt"),
}

/** Kurz-Pings, die auch über die 31 Byte einer Bluetooth-Aussendung passen. */
enum class PingCode(val code: Int, val emoji: String, val label: String) {
    NONE(0, "", ""),
    HELLO(1, "👋", "Hallo"),
    COFFEE(2, "☕", "Kaffee"),
    SMOKE(3, "🚬", "Eine rauchen"),
    LUNCH(4, "🍽️", "Mittag"),
    HELP_SHORT(5, "🧰", "Kurz helfen?"),
    SOS(6, "🆘", "Brauche Hilfe"),
    COMING(7, "🏃", "Komme"),
    OK(8, "👍", "OK"),
    LATER(9, "⏳", "Später"),
    PING_ALL(10, "📣", "Alle anpingen");

    val isUrgent: Boolean get() = this == SOS

    companion object {
        fun fromCode(c: Int): PingCode = entries.firstOrNull { it.code == c } ?: NONE

        /** Die sechs Kacheln auf dem Hauptbildschirm, in Leserichtung. */
        val sendable: List<PingCode> = listOf(COFFEE, SMOKE, HELLO, LUNCH, HELP_SHORT, SOS)

        /** Schnellantworten auf einen eingegangenen Ping. */
        val replies: List<PingCode> = listOf(OK, COMING, LATER)
    }
}

/** Ein gesehenes Gerät. Nahfunk-Teilnehmer werden über alle Wege zusammengeführt. */
data class Peer(
    val key: String,
    val name: String,
    val kind: PeerKind,
    /** Zuletzt gesehen, je Weg (Epoch-Millisekunden). */
    val seen: Map<Channel, Long>,
    /** Geglättete Signalstärke in dBm. */
    val rssi: Double? = null,
    val rssiRaw: Int? = null,
    /** Zu welchem Weg die Signalstärke gehört (entscheidet über das Distanzmodell). */
    val rssiChannel: Channel? = null,
    val nahfunkId: String? = null,
    /** IP (Netz), MAC (Bluetooth) oder BSSID (WLAN-Sender). */
    val address: String? = null,
    val detail: String = "",
    val bearingDeg: Float? = null,
    val bearingQuality: Float? = null,
    val lastPing: PingCode? = null,
    val lastPingAt: Long? = null,
    val lanCapable: Boolean = false,
) {
    val lastSeen: Long get() = seen.values.maxOrNull() ?: 0L
    val channels: Set<Channel> get() = seen.keys
    val isNahfunk: Boolean get() = kind == PeerKind.NAHFUNK
    val hasRssi: Boolean get() = rssi != null
}

enum class Direction { IN, OUT, SYSTEM }

/** Ein Eintrag im Verlauf. */
data class LogEntry(
    val time: Long,
    val direction: Direction,
    val peerKey: String?,
    val peerName: String,
    val channel: Channel?,
    val ping: PingCode?,
    val text: String?,
    val distanceM: Double? = null,
) {
    val summary: String
        get() = when {
            ping != null && ping != PingCode.NONE -> "${ping.emoji} ${ping.label}"
            text != null -> text
            else -> ""
        }
}
