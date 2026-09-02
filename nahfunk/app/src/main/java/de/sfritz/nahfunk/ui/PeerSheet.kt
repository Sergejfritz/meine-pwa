package de.sfritz.nahfunk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.sfritz.nahfunk.core.Calibration
import de.sfritz.nahfunk.core.Channel
import de.sfritz.nahfunk.core.Distance
import de.sfritz.nahfunk.core.Peer
import de.sfritz.nahfunk.core.PingCode
import de.sfritz.nahfunk.core.distanceMeters
import de.sfritz.nahfunk.engine.DirectionProgress
import de.sfritz.nahfunk.ui.theme.NfGreen
import de.sfritz.nahfunk.ui.theme.NfMuted
import de.sfritz.nahfunk.ui.theme.NfSurface
import de.sfritz.nahfunk.ui.theme.NfText

/** Detailblatt eines Geräts: Werte, Pings, Nachricht, Richtung messen, Eichen, Umbenennen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeerSheet(
    peer: Peer,
    calibration: Calibration,
    direction: DirectionProgress?,
    lanUp: Boolean,
    now: Long,
    onDismiss: () -> Unit,
    onPing: (PingCode) -> Unit,
    onText: (String) -> Unit,
    onMeasureDirection: () -> Unit,
    onCancelDirection: () -> Unit,
    onCalibrate: () -> Unit,
    onAlias: (String?) -> Unit,
    onForget: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var text by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf(false) }
    var alias by remember(peer.key) { mutableStateOf(peer.name) }
    val measuring = direction?.peerKey == peer.key
    val distance = peer.distanceMeters(calibration)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = NfSurface) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 36.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                KindBadge(peer.kind)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(peer.name, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = NfText)
                    Text(
                        listOfNotNull(peer.kind.label, peer.detail.takeIf { it.isNotEmpty() }).joinToString(" · "),
                        color = NfMuted, fontSize = 14.sp,
                    )
                }
                distance?.let {
                    Text(Distance.format(it), color = distanceColor(it), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            ValueRow("Weg", peer.channels.joinToString(" + ") { it.label })
            peer.rssi?.let { ValueRow("Signal", "${Distance.formatDbm(it)} geglättet · roh ${peer.rssiRaw ?: "?"} dBm") }
            distance?.let {
                ValueRow("Entfernung", "≈ ${Distance.format(it)} (geschätzt, ${calibration.environment.label})")
            }
            if (peer.channels.contains(Channel.LAN) && distance == null) ValueRow("Entfernung", "im Netz, keine Funkmessung")
            ValueRow(
                "Richtung",
                peer.bearingDeg?.let { b ->
                    val q = peer.bearingQuality ?: 0f
                    "${b.toInt()}° (${if (q >= 4f) "gut" else "unsicher"}, ${"%.1f".format(q)} dB Unterschied)"
                } ?: "nicht gemessen",
            )
            ValueRow("Zuletzt", relativeTime(now, peer.lastSeen))
            peer.address?.let { ValueRow("Adresse", it) }
            peer.lastPing?.let { p -> ValueRow("Letzter Ping", "${p.emoji} ${p.label}" + (peer.lastPingAt?.let { " · " + it.timeOfDay() } ?: "")) }

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            if (peer.isNahfunk) {
                Text("Ping an ${peer.name}", color = NfMuted, fontSize = 13.sp)
                val tiles = PingCode.sendable
                for (row in tiles.chunked(3)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (code in row) PingTile(code, modifier = Modifier.weight(1f), compact = true) { onPing(code) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (code in PingCode.replies) PingTile(code, modifier = Modifier.weight(1f), compact = true) { onPing(code) }
                }
                if (peer.channels.contains(Channel.LAN) && lanUp) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Ganzer Satz an ${peer.name} …") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = {
                            if (text.isNotBlank()) {
                                onText(text)
                                text = ""
                            }
                        }),
                        trailingIcon = {
                            TextButton(onClick = {
                                if (text.isNotBlank()) {
                                    onText(text)
                                    text = ""
                                }
                            }) { Text("Senden") }
                        },
                    )
                } else if (peer.channels.contains(Channel.LAN)) {
                    Hint("Ganze Sätze gehen nur, wenn beide im selben WLAN-Netz sind.")
                } else {
                    Hint("Nur per Funk erreichbar: kurze Pings, keine Sätze.")
                }
            }

            if (peer.rssi != null && peer.rssiChannel != Channel.WIFI_AP) {
                if (measuring) {
                    LinearProgressIndicator(
                        progress = { direction?.fraction ?: 0f },
                        modifier = Modifier.fillMaxWidth(),
                        color = NfGreen,
                    )
                    Text(
                        "Halte das Handy flach vor dich und dreh dich langsam einmal im Kreis. " +
                            "${direction?.sectorsCovered ?: 0} von 24 Richtungen, ${direction?.samples ?: 0} Messungen.",
                        color = NfMuted, fontSize = 14.sp, lineHeight = 20.sp,
                    )
                    OutlinedButton(onClick = onCancelDirection, modifier = Modifier.fillMaxWidth()) { Text("Messung abbrechen") }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = onMeasureDirection, modifier = Modifier.weight(1f)) { Text("🧭 Richtung messen") }
                        OutlinedButton(onClick = onCalibrate, modifier = Modifier.weight(1f)) { Text("⊙ Auf 1 m eichen") }
                    }
                    Hint("Richtung: Der Körper dämpft das Signal – beim Drehen ist es am stärksten, wenn du das Gerät vor dir hast. Eichen: 1 m Abstand einnehmen, dann tippen.")
                }
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            if (renaming) {
                OutlinedTextField(
                    value = alias,
                    onValueChange = { alias = it.take(30) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Eigener Name für dieses Gerät") },
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onAlias(alias); renaming = false }, modifier = Modifier.weight(1f)) { Text("Speichern") }
                    OutlinedButton(onClick = { onAlias(null); renaming = false }, modifier = Modifier.weight(1f)) { Text("Zurücksetzen") }
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { renaming = true }, modifier = Modifier.weight(1f)) { Text("Umbenennen") }
                    OutlinedButton(onClick = onForget, modifier = Modifier.weight(1f)) { Text("Aus Liste nehmen") }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ValueRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, color = NfMuted, fontSize = 14.sp, modifier = Modifier.width(96.dp))
        Text(value, color = NfText, fontSize = 14.sp, modifier = Modifier.weight(1f))
    }
}
