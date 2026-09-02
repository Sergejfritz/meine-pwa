package de.sfritz.nahfunk.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val NfGreen = Color(0xFF12E38C)
val NfGreenDark = Color(0xFF00301C)
val NfBackground = Color(0xFF0B0F14)
val NfSurface = Color(0xFF141B24)
val NfSurfaceHigh = Color(0xFF1B2430)
val NfOutline = Color(0xFF2A3644)
val NfText = Color(0xFFF2F5F8)
val NfMuted = Color(0xFF8B98A8)
val NfBlue = Color(0xFF4DB8FF)
val NfRed = Color(0xFFFF5C6C)
val NfYellow = Color(0xFFFFC857)
val NfOrange = Color(0xFFFF9A3C)

private val DarkColors = darkColorScheme(
    primary = NfGreen,
    onPrimary = NfGreenDark,
    primaryContainer = Color(0xFF0E3B2A),
    onPrimaryContainer = NfGreen,
    secondary = NfBlue,
    onSecondary = Color(0xFF002238),
    secondaryContainer = Color(0xFF12324A),
    onSecondaryContainer = NfBlue,
    tertiary = NfYellow,
    background = NfBackground,
    onBackground = NfText,
    surface = NfSurface,
    onSurface = NfText,
    surfaceVariant = NfSurfaceHigh,
    onSurfaceVariant = NfMuted,
    surfaceContainerLowest = NfBackground,
    surfaceContainerLow = NfSurface,
    surfaceContainer = NfSurface,
    surfaceContainerHigh = NfSurfaceHigh,
    surfaceContainerHighest = NfSurfaceHigh,
    outline = NfOutline,
    outlineVariant = NfOutline,
    error = NfRed,
    onError = Color.White,
)

@Composable
fun NahfunkTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColors,
        typography = Typography(),
        content = content,
    )
}
