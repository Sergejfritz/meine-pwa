package de.sfritz.nahfunk.data

import android.content.Context
import android.content.SharedPreferences
import de.sfritz.nahfunk.core.BleProtocol
import de.sfritz.nahfunk.core.Calibration
import de.sfritz.nahfunk.core.Environment
import de.sfritz.nahfunk.core.Filter
import de.sfritz.nahfunk.core.Mode
import de.sfritz.nahfunk.core.Scale
import de.sfritz.nahfunk.core.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONException
import org.json.JSONObject

/** Einstellungen in SharedPreferences, als StateFlow für die Oberfläche. */
class Prefs(context: Context) {

    private val sp: SharedPreferences =
        context.applicationContext.getSharedPreferences("nahfunk", Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(load())
    val settings: StateFlow<Settings> = _settings

    val current: Settings get() = _settings.value

    @Synchronized
    fun update(transform: (Settings) -> Settings) {
        val next = transform(_settings.value)
        _settings.value = next
        save(next)
    }

    private fun load(): Settings {
        var id = sp.getString(KEY_ID, null)
        if (id == null || id.length != 8) {
            id = BleProtocol.randomId()
            sp.edit().putString(KEY_ID, id).apply()
        }
        return Settings(
            deviceId = id,
            name = sp.getString(KEY_NAME, "Jemand") ?: "Jemand",
            mode = enum(sp.getString(KEY_MODE, null), Mode.BOTH),
            filter = enum(sp.getString(KEY_FILTER, null), Filter.PHONES),
            scale = enum(sp.getString(KEY_SCALE, null), Scale.AUTO),
            headingUp = sp.getBoolean(KEY_HEADING_UP, true),
            calibration = Calibration(
                p0Ble = sp.getFloat(KEY_P0_BLE, Calibration.DEFAULT_P0_BLE.toFloat()).toDouble(),
                p0Wifi = sp.getFloat(KEY_P0_WIFI, Calibration.DEFAULT_P0_WIFI.toFloat()).toDouble(),
                environment = enum(sp.getString(KEY_ENV, null), Environment.HALL),
            ),
            background = sp.getBoolean(KEY_BACKGROUND, true),
            notifications = sp.getBoolean(KEY_NOTIFY, true),
            aliases = loadAliases(),
            firstRunDone = sp.getBoolean(KEY_FIRST_RUN_DONE, false),
        )
    }

    private fun save(s: Settings) {
        val aliases = JSONObject()
        for ((k, v) in s.aliases) aliases.put(k, v)
        sp.edit()
            .putString(KEY_NAME, s.name)
            .putString(KEY_MODE, s.mode.name)
            .putString(KEY_FILTER, s.filter.name)
            .putString(KEY_SCALE, s.scale.name)
            .putBoolean(KEY_HEADING_UP, s.headingUp)
            .putFloat(KEY_P0_BLE, s.calibration.p0Ble.toFloat())
            .putFloat(KEY_P0_WIFI, s.calibration.p0Wifi.toFloat())
            .putString(KEY_ENV, s.calibration.environment.name)
            .putBoolean(KEY_BACKGROUND, s.background)
            .putBoolean(KEY_NOTIFY, s.notifications)
            .putString(KEY_ALIASES, aliases.toString())
            .putBoolean(KEY_FIRST_RUN_DONE, s.firstRunDone)
            .apply()
    }

    private fun loadAliases(): Map<String, String> {
        val raw = sp.getString(KEY_ALIASES, null) ?: return emptyMap()
        return try {
            val o = JSONObject(raw)
            val out = HashMap<String, String>()
            for (k in o.keys()) out[k] = o.optString(k)
            out
        } catch (e: JSONException) {
            emptyMap()
        }
    }

    private inline fun <reified T : Enum<T>> enum(name: String?, fallback: T): T =
        name?.let { runCatching { enumValueOf<T>(it) }.getOrNull() } ?: fallback

    private companion object {
        const val KEY_ID = "deviceId"
        const val KEY_NAME = "name"
        const val KEY_MODE = "mode"
        const val KEY_FILTER = "filter"
        const val KEY_SCALE = "scale"
        const val KEY_HEADING_UP = "headingUp"
        const val KEY_P0_BLE = "p0Ble"
        const val KEY_P0_WIFI = "p0Wifi"
        const val KEY_ENV = "environment"
        const val KEY_BACKGROUND = "background"
        const val KEY_NOTIFY = "notifications"
        const val KEY_ALIASES = "aliases"
        const val KEY_FIRST_RUN_DONE = "firstRunDone"
    }
}
