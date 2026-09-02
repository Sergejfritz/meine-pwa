package de.sfritz.nahfunk.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.sfritz.nahfunk.core.PeerKind
import de.sfritz.nahfunk.core.PingCode
import de.sfritz.nahfunk.ui.theme.NfBlue
import de.sfritz.nahfunk.ui.theme.NfGreen
import de.sfritz.nahfunk.ui.theme.NfMuted
import de.sfritz.nahfunk.ui.theme.NfOrange
import de.sfritz.nahfunk.ui.theme.NfOutline
import de.sfritz.nahfunk.ui.theme.NfSurface
import de.sfritz.nahfunk.ui.theme.NfSurfaceHigh
import de.sfritz.nahfunk.ui.theme.NfText
import de.sfritz.nahfunk.ui.theme.NfYellow

val CardShape = RoundedCornerShape(18.dp)

@Composable
fun SectionTitle(text: String, trailing: String? = null, trailingColor: Color = NfGreen, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 10.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text.uppercase(),
            color = NfMuted,
            fontSize = 13.sp,
            letterSpacing = 2.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f),
        )
        if (trailing != null) {
            Text(text = trailing, color = trailingColor, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun NfCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    container: Color = NfSurface,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = CardDefaults.cardColors(containerColor = container, contentColor = NfText)
    val border = BorderStroke(1.dp, NfOutline)
    if (onClick != null) {
        Card(onClick = onClick, modifier = modifier, shape = CardShape, colors = colors, border = border, content = content)
    } else {
        Card(modifier = modifier, shape = CardShape, colors = colors, border = border, content = content)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PingTile(code: PingCode, modifier: Modifier = Modifier, compact: Boolean = false, onClick: () -> Unit) {
    NfCard(modifier = modifier.height(if (compact) 72.dp else 96.dp), onClick = onClick) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(code.emoji, fontSize = if (compact) 20.sp else 26.sp)
            Text(
                code.label,
                fontSize = if (compact) 13.sp else 17.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun KindBadge(kind: PeerKind, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(44.dp)
            .background(NfSurfaceHigh, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(kind.emoji, fontSize = 22.sp)
    }
}

fun kindColor(kind: PeerKind): Color = when (kind) {
    PeerKind.NAHFUNK -> NfGreen
    PeerKind.PHONE -> NfBlue
    PeerKind.COMPUTER -> NfBlue
    PeerKind.ACCESS_POINT -> NfOrange
    PeerKind.ACCESSORY -> NfMuted
    PeerKind.IOT -> NfMuted
    PeerKind.UNKNOWN -> NfMuted
}

fun distanceColor(meters: Double): Color = when {
    meters < 5.0 -> NfGreen
    meters < 20.0 -> NfYellow
    else -> Color(0xFFFF6B7A)
}

@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, color = NfMuted, fontSize = 14.sp, lineHeight = 20.sp, modifier = modifier.padding(top = 6.dp))
}

@Composable
fun StatusLines(lines: List<String>, color: Color = NfGreen) {
    Column(modifier = Modifier.padding(top = 8.dp)) {
        for (l in lines) Text(l, color = color, fontSize = 15.sp, lineHeight = 21.sp)
    }
}

fun Long.timeOfDay(): String {
    val t = java.time.Instant.ofEpochMilli(this).atZone(java.time.ZoneId.systemDefault())
    return t.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
}

fun relativeTime(now: Long, then: Long): String {
    val s = (now - then) / 1000
    return when {
        s < 3 -> "gerade eben"
        s < 60 -> "vor $s s"
        s < 3600 -> "vor ${s / 60} min"
        else -> "vor ${s / 3600} h"
    }
}
