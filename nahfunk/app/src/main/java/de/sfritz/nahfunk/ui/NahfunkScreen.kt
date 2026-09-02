package de.sfritz.nahfunk.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import de.sfritz.nahfunk.core.Calibration
import de.sfritz.nahfunk.core.Channel
import de.sfritz.nahfunk.core.Classifier
import de.sfritz.nahfunk.core.Direction
import de.sfritz.nahfunk.core.Distance
import de.sfritz.nahfunk.core.Filter
import de.sfritz.nahfunk.core.LogEntry
import de.sfritz.nahfunk.core.Mode
import de.sfritz.nahfunk.core.Peer
import de.sfritz.nahfunk.core.PingCode
import de.sfritz.nahfunk.core.Scale
import de.sfritz.nahfunk.core.distanceMeters
import de.sfritz.nahfunk.engine.Engine
import de.sfritz.nahfunk.engine.EngineStatus
import de.sfritz.nahfunk.engine.Permissions
import de.sfritz.nahfunk.engine.SelfTest
import de.sfritz.nahfunk.engine.SelfTestAction
import de.sfritz.nahfunk.engine.UiEvent
import de.sfritz.nahfunk.radio.ClassicBt
import de.sfritz.nahfunk.ui.theme.NfBackground
import de.sfritz.nahfunk.ui.theme.NfBlue
import de.sfritz.nahfunk.ui.theme.NfGreen
import de.sfritz.nahfunk.ui.theme.NfGreenDark
import de.sfritz.nahfunk.ui.theme.NfMuted
import de.sfritz.nahfunk.ui.theme.NfSurface
import de.sfritz.nahfunk.ui.theme.NfSurfaceHigh
import de.sfritz.nahfunk.ui.theme.NfText
import de.sfritz.nahfunk.ui.theme.NfYellow
import kotlinx.coroutines.delay
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NahfunkScreen() {
    val context = LocalContext.current
    val settings by Engine.prefs.settings.collectAsStateWithLifecycle()
    val status by Engine.status.collectAsStateWithLifecycle()
    val peersMap by Engine.peers.collectAsStateWithLifecycle()
    val log by Engine.log.collectAsStateWithLifecycle()
    val heading by Engine.heading.collectAsStateWithLifecycle()
    val geographic by Engine.headingGeographic.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    var permissionsVersion by remember { mutableIntStateOf(0) }
    var selectedKey by remember { mutableStateOf<String?>(null) }
    var showCalibrate by remember { mutableStateOf(false) }

    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(1000)
            value = System.currentTimeMillis()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permissionsVersion++
        if (Permissions.essentialGranted(context)) {
            Engine.prefs.update { it.copy(firstRunDone = true) }
            Engine.start()
        }
    }
    val activityLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        Engine.refreshBluetoothState()
        permissionsVersion++
    }

    LaunchedEffect(Unit) {
        Engine.events.collect { ev ->
            when (ev) {
                is UiEvent.Incoming -> snackbar.showSnackbar(
                    "${ev.entry.summary} · von ${ev.entry.peerName}" + (ev.entry.channel?.let { " (${it.label})" } ?: ""),
                    withDismissAction = true,
                    duration = SnackbarDuration.Short,
                )
                is UiEvent.Info -> snackbar.showSnackbar(ev.text, withDismissAction = true, duration = SnackbarDuration.Short)
            }
        }
    }

    LaunchedEffect(Unit) {
        if (Permissions.essentialGranted(context) && !Engine.status.value.running) Engine.start()
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                permissionsVersion++
                Engine.refreshBluetoothState()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val cal = settings.calibration
    val allPeers = peersMap.values.toList()
    val visiblePeers = remember(peersMap, settings.filter, cal) {
        allPeers.filter { Classifier.passesFilter(it.kind, settings.filter) }
            .sortedWith(
                compareBy<Peer> { !it.isNahfunk }
                    .thenBy { it.distanceMeters(cal) ?: Double.MAX_VALUE }
                    .thenByDescending { it.lastSeen },
            )
    }
    val hidden = allPeers.size - visiblePeers.size
    val nahfunkCount = allPeers.count { it.isNahfunk }
    val netCount = allPeers.count { it.channels.contains(Channel.LAN) }
    val radioCount = allPeers.count { it.isNahfunk && (it.channels.contains(Channel.BLE) || it.channels.contains(Channel.CLASSIC)) }
    val scaleMeters = settings.scale.meters
        ?: Distance.autoScale(visiblePeers.mapNotNull { it.distanceMeters(cal) }.maxOrNull())
    val withoutBearing = visiblePeers.count { it.distanceMeters(cal) != null && it.bearingDeg == null }
    val selfTest = remember(status, settings, permissionsVersion) { SelfTest.build(context, status, settings) }
    val essential = remember(permissionsVersion) { Permissions.essentialGranted(context) }

    fun open(intent: Intent) {
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // Einstellung auf diesem Gerät nicht vorhanden
        }
    }

    fun handle(action: SelfTestAction) {
        when (action) {
            SelfTestAction.ENABLE_BLUETOOTH ->
                if (Permissions.allGranted(context, Permissions.bluetooth())) activityLauncher.launch(ClassicBt.enableIntent())
                else permissionLauncher.launch(Permissions.all().toTypedArray())
            SelfTestAction.REQUEST_PERMISSIONS -> {
                val missing = Permissions.missing(context)
                if (missing.isEmpty()) open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
                else permissionLauncher.launch(missing.toTypedArray())
            }
            SelfTestAction.OPEN_APP_SETTINGS -> open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
            SelfTestAction.OPEN_LOCATION_SETTINGS -> open(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            SelfTestAction.OPEN_WIFI_SETTINGS -> open(Intent(Settings.ACTION_WIFI_SETTINGS))
            SelfTestAction.BECOME_VISIBLE -> Engine.becomeVisible()
            SelfTestAction.CLASSIC_VISIBLE ->
                if (Permissions.allGranted(context, Permissions.bluetooth())) activityLauncher.launch(ClassicBt.discoverableIntent())
                else permissionLauncher.launch(Permissions.all().toTypedArray())
            SelfTestAction.IGNORE_BATTERY -> {
                try {
                    context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
                } catch (e: ActivityNotFoundException) {
                    open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                }
            }
            SelfTestAction.START -> Engine.start()
        }
    }

    Scaffold(
        containerColor = NfBackground,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 20.dp, end = 20.dp,
                top = padding.calculateTopPadding() + 12.dp,
                bottom = padding.calculateBottomPadding() + 40.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { Header(status, nahfunkCount) }

            item { NameField(settings.name) }

            if (!essential) {
                item {
                    NfCard(container = NfSurfaceHigh) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Berechtigungen nötig", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                "Nahfunk braucht Bluetooth, Standort (Android verlangt ihn für Funk- und WLAN-Scans), WLAN-Geräte in der Nähe und Benachrichtigungen. Es werden keine Daten ins Internet gesendet.",
                                color = NfMuted, fontSize = 14.sp, lineHeight = 20.sp,
                            )
                            Button(onClick = { permissionLauncher.launch(Permissions.all().toTypedArray()) }, modifier = Modifier.fillMaxWidth()) {
                                Text("Berechtigungen erteilen")
                            }
                        }
                    }
                }
            }

            item {
                Column {
                    SectionTitle("Verbindungsweg")
                    ModeButtons(status.mode) { Engine.setMode(it) }
                    StatusLines(statusLines(status, netCount, radioCount))
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                        Text("Im Hintergrund weiterlaufen", color = NfMuted, fontSize = 15.sp, modifier = Modifier.weight(1f))
                        Switch(checked = settings.background, onCheckedChange = { Engine.setBackground(it) })
                    }
                    Row {
                        TextButton(onClick = { if (status.running) Engine.stop() else Engine.start() }) {
                            Text(if (status.running) "Nahfunk stoppen" else "Nahfunk starten")
                        }
                        if (status.mode.usesBle && status.bluetoothOn && !status.advertising && status.canAdvertise != false) {
                            TextButton(onClick = { Engine.becomeVisible() }) { Text("Sichtbar werden") }
                        }
                        if (status.mode.usesBle && status.bluetoothOn && status.canAdvertise == false) {
                            TextButton(onClick = { handle(SelfTestAction.CLASSIC_VISIBLE) }) { Text("Klassisch sichtbar") }
                        }
                    }
                }
            }

            item {
                Column {
                    PingAllButton(status.pingAllRemaining) { Engine.pingAll() }
                    Hint("Ruft zwei Minuten lang auf allen Wegen, stupst jeden bekannten Teilnehmer einzeln an und sucht auch klassische Bluetooth-Geräte.")
                }
            }

            item {
                Column {
                    SectionTitle("Ping senden", trailing = "an alle", trailingColor = NfMuted)
                    for (row in PingCode.sendable.chunked(2)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                            for (code in row) PingTile(code, modifier = Modifier.weight(1f)) { Engine.sendPing(code) }
                        }
                    }
                }
            }

            item {
                Column {
                    SectionTitle("Nachricht ins Netz", trailing = if (status.lanUp) "$netCount erreichbar" else "kein Netz", trailingColor = if (status.lanUp) NfGreen else NfMuted)
                    TextRow(enabled = status.lanUp) { Engine.sendText(it) }
                    Hint(if (status.lanUp) "Ganze Sätze an alle im selben WLAN-Netz." else "Ganze Sätze gehen nur im eigenen WLAN-Netz. Verbinde dich mit dem Hallen-WLAN.")
                }
            }

            item {
                Column {
                    SectionTitle("In Reichweite", trailing = visiblePeers.size.toString())
                    NfCard {
                        val radarPeers = remember(visiblePeers, cal, selectedKey) {
                            visiblePeers.mapNotNull { p ->
                                val d = p.distanceMeters(cal) ?: return@mapNotNull null
                                RadarPeer(p.key, p.name, d, p.bearingDeg, p.kind, p.key == selectedKey)
                            }
                        }
                        Radar(
                            peers = radarPeers,
                            scaleMeters = scaleMeters,
                            heading = heading,
                            headingUp = settings.headingUp,
                            onTap = { selectedKey = it },
                            modifier = Modifier.padding(8.dp),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 10.dp)) {
                        for (s in Scale.entries) {
                            FilterChip(
                                selected = settings.scale == s,
                                onClick = { Engine.prefs.update { it.copy(scale = s) } },
                                label = { Text(s.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                modifier = Modifier.weight(1f),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = NfGreen, selectedLabelColor = NfGreenDark),
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                        ToolButton(if (settings.headingUp) "⇧ Blick oben" else "N Norden oben", active = settings.headingUp, modifier = Modifier.weight(1f)) {
                            Engine.prefs.update { it.copy(headingUp = !it.headingUp) }
                        }
                        ToolButton("⌂ ${cal.environment.label}", active = false, modifier = Modifier.weight(1f)) {
                            Engine.prefs.update { it.copy(calibration = it.calibration.copy(environment = it.calibration.environment.next())) }
                        }
                        ToolButton("⊙ Eichen", active = !cal.isDefault, modifier = Modifier.weight(1f)) { showCalibrate = true }
                    }
                    Hint(radarCaption(cal, settings.headingUp, heading != null, geographic, withoutBearing))
                }
            }

            item {
                Column {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (f in Filter.entries) {
                            FilterChip(
                                selected = settings.filter == f,
                                onClick = { Engine.prefs.update { it.copy(filter = f) } },
                                label = { Text(f.label, maxLines = 1) },
                                modifier = Modifier.weight(1f),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = NfBlue, selectedLabelColor = NfBackground),
                            )
                        }
                    }
                    if (hidden > 0) {
                        Hint(
                            when (settings.filter) {
                                Filter.NAHFUNK -> "$hidden Geräte ausgeblendet – nur Handys mit Nahfunk werden gezeigt."
                                Filter.PHONES -> "$hidden Geräte ausgeblendet – Thermometer, Fernseher, Kopfhörer, WLAN-Sender und dergleichen."
                                Filter.ALL -> ""
                            },
                        )
                    }
                }
            }

            if (visiblePeers.isEmpty()) {
                item {
                    NfCard {
                        Column(Modifier.padding(16.dp)) {
                            Text("Noch niemand in Reichweite", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                when {
                                    !status.running -> "Nahfunk ist gestoppt."
                                    !status.bluetoothOn && status.mode.usesBle -> "Bluetooth ist aus – einschalten, damit Funk geht."
                                    settings.filter != Filter.ALL -> "Auf „Alle“ umschalten, um auch fremde Geräte und WLAN-Sender zu sehen."
                                    else -> "Es dauert ein paar Sekunden, bis Aussendungen ankommen."
                                },
                                color = NfMuted, fontSize = 14.sp, lineHeight = 20.sp,
                            )
                        }
                    }
                }
            }

            items(visiblePeers, key = { it.key }) { peer ->
                PeerRow(peer, cal, now) { selectedKey = peer.key }
            }

            item {
                Column {
                    SectionTitle("Verlauf", trailing = if (log.isNotEmpty()) "leeren" else null, trailingColor = NfMuted)
                    if (log.isEmpty()) {
                        Hint("Noch nichts gesendet oder empfangen.")
                    } else {
                        NfCard {
                            Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                                for (e in log.take(30)) LogRow(e) { code -> Engine.sendPing(code, e.peerKey) }
                            }
                        }
                        TextButton(onClick = { Engine.clearLog() }) { Text("Verlauf leeren", color = NfMuted) }
                    }
                }
            }

            item {
                Column {
                    SectionTitle("Selbsttest")
                    SelfTestCard(selfTest) { handle(it) }
                }
            }

            item {
                val version = remember {
                    try {
                        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
                    } catch (e: Exception) {
                        "?"
                    }
                }
                Text(
                    "Nahfunk $version · Gerät ${settings.deviceId} · alles bleibt im Nahbereich, nichts geht ins Internet",
                    color = NfMuted, fontSize = 12.sp, lineHeight = 18.sp,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }

    selectedKey?.let { key ->
        val peer = peersMap[key]
        if (peer == null) {
            selectedKey = null
        } else {
            PeerSheet(
                peer = peer,
                calibration = cal,
                direction = status.direction,
                lanUp = status.lanUp,
                now = now,
                onDismiss = { selectedKey = null },
                onPing = { Engine.sendPing(it, key) },
                onText = { Engine.sendText(it, key) },
                onMeasureDirection = { Engine.startDirection(key) },
                onCancelDirection = { Engine.cancelDirection() },
                onCalibrate = { Engine.calibrateOn(key) },
                onAlias = { Engine.setAlias(key, it) },
                onForget = {
                    Engine.forget(key)
                    selectedKey = null
                },
            )
        }
    }

    if (showCalibrate) {
        CalibrateDialog(
            candidates = allPeers.filter { it.rssi != null }.sortedByDescending { it.rssi }.take(8),
            calibration = cal,
            onPick = {
                Engine.calibrateOn(it.key)
                showCalibrate = false
            },
            onReset = {
                Engine.prefs.update { it.copy(calibration = Calibration(environment = it.calibration.environment)) }
                showCalibrate = false
            },
            onDismiss = { showCalibrate = false },
        )
    }
}

@Composable
private fun Header(status: EngineStatus, nahfunkCount: Int) {
    Column(modifier = Modifier.padding(top = 8.dp)) {
        Text("Nahfunk", fontSize = 40.sp, fontWeight = FontWeight.Medium, color = NfText)
        val state = when {
            !status.running -> "aus"
            status.advertising -> "sichtbar"
            else -> "still"
        }
        val reach = if (nahfunkCount > 0) "$nahfunkCount in Reichweite" else "kein Empfang"
        Text("$state · $reach", color = NfMuted, fontSize = 17.sp)
    }
}

@Composable
private fun NameField(name: String) {
    var text by remember { mutableStateOf(name) }
    LaunchedEffect(text) {
        if (text != name) {
            Engine.prefs.update { it.copy(name = text.take(24)) }
            delay(700)
            Engine.onNameChanged()
        }
    }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it.take(24) },
        modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("Dein Name") },
        singleLine = true,
        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 20.sp, color = NfText),
        supportingText = { Text("So sehen dich die anderen.", color = NfMuted) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModeButtons(mode: Mode, onSelect: (Mode) -> Unit) {
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        val all = Mode.entries
        all.forEachIndexed { i, m ->
            SegmentedButton(
                selected = m == mode,
                onClick = { onSelect(m) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = all.size),
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = NfGreen,
                    activeContentColor = NfGreenDark,
                    inactiveContainerColor = NfSurface,
                    inactiveContentColor = NfMuted,
                ),
                icon = {},
            ) {
                Text(m.label, fontSize = 16.sp, maxLines = 1)
            }
        }
    }
}

private fun statusLines(status: EngineStatus, netCount: Int, radioCount: Int): List<String> {
    if (!status.running) return listOf("Nahfunk ist gestoppt.")
    val parts = ArrayList<String>()
    if (status.mode.usesLan) parts += if (status.lanUp) "WLAN läuft" else "WLAN getrennt"
    if (status.mode.usesBle) parts += when {
        !status.bluetoothOn -> "Funk aus (Bluetooth aus)"
        status.advertising -> "Funk sendet"
        status.canAdvertise == false && status.scanning -> "Funk hört nur mit"
        status.scanning -> "Funk hört mit"
        else -> "Funk aus"
    }
    val second = "$netCount im Netz, $radioCount per Funk erreichbar · ganze Sätze nur im eigenen Netz"
    return listOf(parts.joinToString(" · "), second)
}

@Composable
private fun PingAllButton(remaining: Int, onClick: () -> Unit) {
    val running = remaining > 0
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp),
        shape = CardShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (running) NfGreen else NfSurface,
            contentColor = if (running) NfGreenDark else NfText,
        ),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                if (running) "📣 Läuft noch $remaining s · antippen zum Abbrechen" else "📣 Alle anpingen",
                fontSize = if (running) 16.sp else 20.sp,
                fontWeight = FontWeight.SemiBold,
            )
            if (running) {
                LinearProgressIndicator(
                    progress = { 1f - remaining / 120f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    color = NfGreenDark,
                    trackColor = NfGreen.copy(alpha = 0.5f),
                )
            }
        }
    }
}

@Composable
private fun TextRow(enabled: Boolean, onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        placeholder = { Text(if (enabled) "Ganzer Satz an alle im Netz …" else "Nicht im WLAN-Netz") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = {
            if (text.isNotBlank()) {
                onSend(text)
                text = ""
            }
        }),
        trailingIcon = {
            TextButton(
                enabled = enabled && text.isNotBlank(),
                onClick = {
                    onSend(text)
                    text = ""
                },
            ) { Text("Senden") }
        },
    )
}

@Composable
private fun ToolButton(label: String, active: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (active) NfGreen.copy(alpha = 0.18f) else NfSurface,
            contentColor = if (active) NfGreen else NfText,
        ),
        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 10.dp),
    ) {
        Text(label, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun radarCaption(cal: Calibration, headingUp: Boolean, hasHeading: Boolean, geographic: Boolean, withoutBearing: Int): String {
    val sb = StringBuilder()
    sb.append("Maßstab: ")
    sb.append(String.format(Locale.GERMANY, "%.0f dBm auf 1 m", cal.p0Ble))
    sb.append(if (cal.isDefault) " (Standardwert)" else " (geeicht)")
    sb.append(" · Dämpfung ")
    sb.append(String.format(Locale.GERMANY, "%.1f", cal.environment.exponent))
    sb.append(" (").append(cal.environment.label).append(")\n")
    sb.append(
        when {
            !hasHeading -> "Kein Kompass verfügbar – Norden oben."
            headingUp -> "Blickrichtung oben. "
            else -> "Norden oben. "
        },
    )
    if (hasHeading) sb.append(if (geographic) "Geografisch Nord." else "Magnetisch Nord.")
    if (withoutBearing > 0) {
        sb.append("\n")
        sb.append(if (withoutBearing == 1) "1 Gerät liegt" else "$withoutBearing Geräte liegen")
        sb.append(" irgendwo auf dem Ring – Entfernung geschätzt, Richtung nicht. Antippen und „Richtung messen“.")
    }
    return sb.toString()
}

@Composable
private fun PeerRow(peer: Peer, cal: Calibration, now: Long, onClick: () -> Unit) {
    val distance = peer.distanceMeters(cal)
    NfCard(onClick = onClick) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            KindBadge(peer.kind)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(peer.name, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val parts = ArrayList<String>()
                parts += peer.channels.sortedBy { it.ordinal }.joinToString(" + ") { it.label }
                peer.rssi?.let { parts += Distance.formatDbm(it) }
                if (peer.detail.isNotEmpty()) parts += peer.detail
                if (peer.isNahfunk && peer.channels.contains(Channel.LAN) && peer.address != null && peer.rssi == null) parts += peer.address
                Text(parts.joinToString(" · "), color = NfBlue, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                peer.lastPing?.let { p ->
                    Text("${p.emoji} ${p.label} · ${relativeTime(now, peer.lastPingAt ?: now)}", color = NfYellow, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                if (distance != null) {
                    Text(Distance.format(distance), color = distanceColor(distance), fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
                    Text(if (peer.kind == de.sfritz.nahfunk.core.PeerKind.ACCESS_POINT) "Netzstärke" else "geschätzt", color = NfMuted, fontSize = 12.sp)
                } else {
                    Text("im Netz", color = NfGreen, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Text(relativeTime(now, peer.lastSeen), color = NfMuted, fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
private fun LogRow(e: LogEntry, onReply: (PingCode) -> Unit) {
    Column(modifier = Modifier.padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(e.time.timeOfDay(), color = NfMuted, fontSize = 13.sp, modifier = Modifier.width(48.dp))
            Text(
                when (e.direction) {
                    Direction.IN -> "↓"
                    Direction.OUT -> "↑"
                    Direction.SYSTEM -> "·"
                },
                color = if (e.direction == Direction.IN) NfGreen else NfMuted,
                fontSize = 15.sp,
                modifier = Modifier.width(18.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(e.summary, color = NfText, fontSize = 15.sp)
                Text(
                    (if (e.direction == Direction.IN) "von " else "an ") + e.peerName +
                        (e.channel?.let { " · ${it.label}" } ?: "") +
                        (e.distanceM?.let { " · ~" + Distance.format(it) } ?: ""),
                    color = NfMuted, fontSize = 13.sp,
                )
            }
        }
        if (e.direction == Direction.IN && e.peerKey != null && e.ping != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(start = 66.dp, top = 4.dp)) {
                for (r in PingCode.replies) {
                    FilterChip(selected = false, onClick = { onReply(r) }, label = { Text("${r.emoji} ${r.label}", fontSize = 13.sp) })
                }
            }
        }
    }
}

@Composable
private fun CalibrateDialog(
    candidates: List<Peer>,
    calibration: Calibration,
    onPick: (Peer) -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Auf 1 m eichen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Stell dich genau 1 m neben ein Gerät und tippe es an. Seine jetzige Signalstärke wird zum Bezugswert für alle Entfernungen. " +
                        "Aktuell: ${String.format(Locale.GERMANY, "%.0f", calibration.p0Ble)} dBm (Funk), ${String.format(Locale.GERMANY, "%.0f", calibration.p0Wifi)} dBm (WLAN-Sender).",
                    color = NfMuted, fontSize = 14.sp, lineHeight = 20.sp,
                )
                if (candidates.isEmpty()) {
                    Text("Gerade kein Gerät mit Signalstärke in Reichweite.", color = NfText)
                }
                for (p in candidates) {
                    OutlinedButton(onClick = { onPick(p) }, modifier = Modifier.fillMaxWidth()) {
                        Text("${p.kind.emoji} ${p.name} · ${p.rssi?.let { Distance.formatDbm(it) } ?: ""}", maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fertig") } },
        dismissButton = { TextButton(onClick = onReset) { Text("Standardwerte") } },
    )
}
