package de.sfritz.nahfunk.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.sfritz.nahfunk.core.Distance
import de.sfritz.nahfunk.core.PeerKind
import de.sfritz.nahfunk.ui.theme.NfGreen
import de.sfritz.nahfunk.ui.theme.NfMuted
import de.sfritz.nahfunk.ui.theme.NfOutline
import de.sfritz.nahfunk.ui.theme.NfRed
import de.sfritz.nahfunk.ui.theme.NfSurfaceHigh
import de.sfritz.nahfunk.ui.theme.NfText
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class RadarPeer(
    val key: String,
    val name: String,
    val distance: Double,
    val bearingDeg: Float?,
    val kind: PeerKind,
    val selected: Boolean,
)

private data class Placed(val peer: RadarPeer, val x: Float, val y: Float, val ringRadius: Float, val beyond: Boolean)

/**
 * Kompass-Radar: Ringe logarithmisch, Blickkegel, Funde als Punkte.
 * Ohne gemessene Richtung liegt ein Fund auf einer festen Pseudo-Position seines Rings,
 * markiert durch einen gestrichelten Ring.
 */
@Composable
fun Radar(
    peers: List<RadarPeer>,
    scaleMeters: Double,
    heading: Float?,
    headingUp: Boolean,
    onTap: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val labelStyle = TextStyle(color = NfMuted, fontSize = 11.sp)
    val nameStyle = TextStyle(color = NfText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    val compassStyle = TextStyle(color = NfMuted, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    val northStyle = compassStyle.copy(color = NfRed)

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f),
    ) {
        val widthPx = with(density) { maxWidth.toPx() }
        val heightPx = with(density) { maxHeight.toPx() }
        val padPx = with(density) { 34.dp.toPx() }
        val center = Offset(widthPx / 2f, heightPx / 2f)
        val radius = minOf(widthPx, heightPx) / 2f - padPx
        val rot = if (headingUp) -(heading ?: 0f) else 0f

        val placed = remember(peers, scaleMeters, rot, radius, center) {
            peers.map { p ->
                val clamped = p.distance.coerceAtMost(scaleMeters)
                val rr = radius * Distance.ringFraction(clamped, scaleMeters)
                val angle = if (p.bearingDeg != null) p.bearingDeg + rot else pseudoAngle(p.key)
                val rad = Math.toRadians(angle.toDouble())
                Placed(
                    peer = p,
                    x = center.x + (rr * sin(rad)).toFloat(),
                    y = center.y - (rr * cos(rad)).toFloat(),
                    ringRadius = rr,
                    beyond = p.distance > scaleMeters,
                )
            }
        }
        val hitPx = with(density) { 28.dp.toPx() }

        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(placed) {
                    detectTapGestures { pos ->
                        val hit = placed.minByOrNull { (it.x - pos.x) * (it.x - pos.x) + (it.y - pos.y) * (it.y - pos.y) }
                        if (hit != null) {
                            val d = sqrt((hit.x - pos.x) * (hit.x - pos.x) + (hit.y - pos.y) * (hit.y - pos.y))
                            if (d <= hitPx) onTap(hit.peer.key)
                        }
                    }
                },
        ) {
            val dash = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 6.dp.toPx()))

            // Fläche
            drawCircle(NfSurfaceHigh.copy(alpha = 0.55f), radius, center)

            // Entfernungsringe
            for (d in Distance.rings(scaleMeters)) {
                val rr = radius * Distance.ringFraction(d, scaleMeters)
                drawCircle(NfOutline, rr, center, style = Stroke(1.dp.toPx()))
                val m = textMeasurer.measure(ringLabel(d), labelStyle)
                drawText(m, topLeft = Offset(center.x + 6.dp.toPx(), center.y - rr - m.size.height - 1.dp.toPx()))
            }

            // Außenring mit Teilstrichen
            drawCircle(NfGreen.copy(alpha = 0.45f), radius, center, style = Stroke(2.dp.toPx()))
            for (deg in 0 until 360 step 15) {
                val long = deg % 90 == 0
                val rad = Math.toRadians((deg + rot).toDouble())
                val len = if (long) 10.dp.toPx() else 5.dp.toPx()
                val sx = sin(rad).toFloat()
                val cy = cos(rad).toFloat()
                drawLine(
                    color = if (long) NfMuted else NfOutline,
                    start = Offset(center.x + radius * sx, center.y - radius * cy),
                    end = Offset(center.x + (radius - len) * sx, center.y - (radius - len) * cy),
                    strokeWidth = if (long) 2.dp.toPx() else 1.dp.toPx(),
                )
            }

            // Himmelsrichtungen
            for ((deg, letter) in listOf(0 to "N", 90 to "O", 180 to "S", 270 to "W")) {
                val rad = Math.toRadians((deg + rot).toDouble())
                val rr = radius + 18.dp.toPx()
                val m = textMeasurer.measure(letter, if (deg == 0) northStyle else compassStyle)
                drawText(
                    m,
                    topLeft = Offset(
                        center.x + (rr * sin(rad)).toFloat() - m.size.width / 2f,
                        center.y - (rr * cos(rad)).toFloat() - m.size.height / 2f,
                    ),
                )
            }

            // Blickkegel
            if (heading != null) {
                val facing = if (headingUp) 0f else heading
                val wr = radius * 0.38f
                drawArc(
                    color = NfGreen.copy(alpha = 0.22f),
                    startAngle = facing - 25f - 90f,
                    sweepAngle = 50f,
                    useCenter = true,
                    topLeft = Offset(center.x - wr, center.y - wr),
                    size = Size(wr * 2, wr * 2),
                )
                val rad = Math.toRadians(facing.toDouble())
                drawLine(
                    NfGreen.copy(alpha = 0.6f),
                    center,
                    Offset(center.x + (wr * sin(rad)).toFloat(), center.y - (wr * cos(rad)).toFloat()),
                    strokeWidth = 2.dp.toPx(),
                )
            }

            // Eigener Standort
            drawCircle(NfGreen.copy(alpha = 0.3f), 13.dp.toPx(), center)
            drawCircle(NfGreen, 7.dp.toPx(), center)

            // Funde ohne Richtung: gestrichelter Ring auf ihrer Entfernung
            for (pl in placed) {
                if (pl.peer.bearingDeg == null && pl.ringRadius > 4f) {
                    drawCircle(kindColor(pl.peer.kind).copy(alpha = 0.35f), pl.ringRadius, center, style = Stroke(1.dp.toPx(), pathEffect = dash))
                }
            }

            // Funde
            for (pl in placed) {
                val c = kindColor(pl.peer.kind)
                val pos = Offset(pl.x, pl.y)
                if (pl.beyond) {
                    drawCircle(c, 6.dp.toPx(), pos, style = Stroke(2.dp.toPx()))
                } else {
                    drawCircle(c.copy(alpha = 0.35f), 11.dp.toPx(), pos)
                    drawCircle(c, 6.dp.toPx(), pos)
                }
                if (pl.peer.bearingDeg != null) {
                    // kleiner radialer Strich: Richtung ist gemessen
                    val rad = Math.toRadians((pl.peer.bearingDeg + rot).toDouble())
                    drawLine(
                        c,
                        Offset(center.x + ((pl.ringRadius - 14.dp.toPx()) * sin(rad)).toFloat(), center.y - ((pl.ringRadius - 14.dp.toPx()) * cos(rad)).toFloat()),
                        Offset(center.x + ((pl.ringRadius - 8.dp.toPx()) * sin(rad)).toFloat(), center.y - ((pl.ringRadius - 8.dp.toPx()) * cos(rad)).toFloat()),
                        strokeWidth = 2.dp.toPx(),
                    )
                }
                if (pl.peer.selected) {
                    drawCircle(Color.White, 11.dp.toPx(), pos, style = Stroke(2.dp.toPx()))
                }
                val label = pl.peer.name.let { if (it.length > 16) it.take(15) + "…" else it }
                val m = textMeasurer.measure(label, nameStyle)
                var lx = pl.x + 10.dp.toPx()
                if (lx + m.size.width > size.width) lx = pl.x - 10.dp.toPx() - m.size.width
                val ly = (pl.y - m.size.height / 2f).coerceIn(0f, size.height - m.size.height)
                drawText(m, topLeft = Offset(lx, ly))
            }
        }
    }
}

private fun pseudoAngle(key: String): Float = Math.floorMod(key.hashCode(), 360).toFloat()

private fun ringLabel(d: Double): String =
    if (d == Math.floor(d)) "${d.toInt()} m" else String.format(java.util.Locale.GERMANY, "%.1f m", d)
