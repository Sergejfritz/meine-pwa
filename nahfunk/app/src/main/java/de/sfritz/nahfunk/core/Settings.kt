package de.sfritz.nahfunk.core

/** Verbindungsweg. */
enum class Mode(val label: String) {
    BOTH("Beides"),
    WIFI("Nur WLAN"),
    RADIO("Nur Funk");

    val usesLan: Boolean get() = this != RADIO
    val usesBle: Boolean get() = this != WIFI
}

/** Welche Geräte in Liste und Radar erscheinen. */
enum class Filter(val label: String) {
    NAHFUNK("Nahfunk"),
    PHONES("Handys"),
    ALL("Alle"),
}

/** Radar-Maßstab. */
enum class Scale(val label: String, val meters: Double?) {
    AUTO("Auto", null),
    M5("5 m", 5.0),
    M15("15 m", 15.0),
    M50("50 m", 50.0),
    M150("150 m", 150.0),
}

data class Settings(
    val deviceId: String,
    val name: String = "Jemand",
    val mode: Mode = Mode.BOTH,
    val filter: Filter = Filter.PHONES,
    val scale: Scale = Scale.AUTO,
    val headingUp: Boolean = true,
    val calibration: Calibration = Calibration(),
    val background: Boolean = true,
    val notifications: Boolean = true,
    val aliases: Map<String, String> = emptyMap(),
    val firstRunDone: Boolean = false,
) {
    val displayName: String get() = name.trim().ifEmpty { "Jemand" }
}
