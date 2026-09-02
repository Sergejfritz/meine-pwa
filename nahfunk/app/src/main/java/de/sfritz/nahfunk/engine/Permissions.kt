package de.sfritz.nahfunk.engine

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** Welche Laufzeit-Berechtigungen Nahfunk auf dieser Android-Version braucht. */
object Permissions {

    fun bluetooth(): List<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        } else emptyList()

    fun location(): List<String> = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun wifi(): List<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) listOf(Manifest.permission.NEARBY_WIFI_DEVICES) else emptyList()

    fun notifications(): List<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()

    fun all(): List<String> = bluetooth() + location() + wifi() + notifications()

    fun granted(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun allGranted(context: Context, list: List<String>): Boolean = list.all { granted(context, it) }

    fun missing(context: Context): List<String> = all().filterNot { granted(context, it) }

    /** Ohne diese geht gar nichts: Bluetooth und Standort. */
    fun essentialGranted(context: Context): Boolean =
        allGranted(context, bluetooth()) && granted(context, Manifest.permission.ACCESS_FINE_LOCATION)

    fun label(permission: String): String = when (permission) {
        Manifest.permission.BLUETOOTH_SCAN -> "Bluetooth suchen"
        Manifest.permission.BLUETOOTH_ADVERTISE -> "Bluetooth senden"
        Manifest.permission.BLUETOOTH_CONNECT -> "Bluetooth verbinden"
        Manifest.permission.ACCESS_FINE_LOCATION -> "Standort (genau)"
        Manifest.permission.ACCESS_COARSE_LOCATION -> "Standort (ungefähr)"
        Manifest.permission.NEARBY_WIFI_DEVICES -> "WLAN-Geräte in der Nähe"
        Manifest.permission.POST_NOTIFICATIONS -> "Benachrichtigungen"
        else -> permission.substringAfterLast('.')
    }
}
