package de.sfritz.nahfunk.engine

import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import androidx.core.content.ContextCompat
import de.sfritz.nahfunk.core.BleProtocol
import de.sfritz.nahfunk.core.Channel
import de.sfritz.nahfunk.core.Classifier
import de.sfritz.nahfunk.core.Direction
import de.sfritz.nahfunk.core.Distance
import de.sfritz.nahfunk.core.LanMessage
import de.sfritz.nahfunk.core.LogEntry
import de.sfritz.nahfunk.core.Mode
import de.sfritz.nahfunk.core.Peer
import de.sfritz.nahfunk.core.PeerKind
import de.sfritz.nahfunk.core.PingCode
import de.sfritz.nahfunk.core.distanceMeters
import de.sfritz.nahfunk.data.Prefs
import de.sfritz.nahfunk.radio.BleAdvertiser
import de.sfritz.nahfunk.radio.BleScanner
import de.sfritz.nahfunk.radio.ClassicBt
import de.sfritz.nahfunk.radio.ClassicDiscovery
import de.sfritz.nahfunk.radio.HeadingSensor
import de.sfritz.nahfunk.radio.LanChannel
import de.sfritz.nahfunk.radio.WifiScanner
import de.sfritz.nahfunk.service.NahfunkService
import de.sfritz.nahfunk.service.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import kotlin.random.Random

data class DirectionProgress(val peerKey: String, val fraction: Float, val sectorsCovered: Int, val samples: Int)

data class EngineStatus(
    val running: Boolean = false,
    val mode: Mode = Mode.BOTH,
    val bluetoothPresent: Boolean = false,
    val bluetoothOn: Boolean = false,
    /** null = unbekannt (Bluetooth aus). */
    val canAdvertise: Boolean? = null,
    val advertising: Boolean = false,
    val advertiseError: String? = null,
    val scanning: Boolean = false,
    val scanFiltered: Boolean = false,
    val scanError: String? = null,
    val lanUp: Boolean = false,
    val lanIp: String? = null,
    val lanError: String? = null,
    val pingAllRemaining: Int = 0,
    val classicDiscovering: Boolean = false,
    val direction: DirectionProgress? = null,
    val screenOn: Boolean = true,
)

sealed class UiEvent {
    data class Incoming(val entry: LogEntry) : UiEvent()
    data class Info(val text: String) : UiEvent()
}

/**
 * Herzstück: hält alle Wege zusammen, führt gesehene Geräte zusammen,
 * sendet Pings und Nachrichten und verteilt eingehende an Oberfläche und Benachrichtigungen.
 */
object Engine {

    private lateinit var app: Context
    lateinit var prefs: Prefs
        private set

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private lateinit var advertiser: BleAdvertiser
    private lateinit var scanner: BleScanner
    private lateinit var lan: LanChannel
    private lateinit var wifiScanner: WifiScanner
    private lateinit var headingSensor: HeadingSensor
    private var classicDiscovery: ClassicDiscovery? = null

    private val _peers = MutableStateFlow<Map<String, Peer>>(emptyMap())
    val peers: StateFlow<Map<String, Peer>> = _peers

    private val _log = MutableStateFlow<List<LogEntry>>(emptyList())
    val log: StateFlow<List<LogEntry>> = _log

    private val _status = MutableStateFlow(EngineStatus())
    val status: StateFlow<EngineStatus> = _status

    val heading: StateFlow<Float?> get() = headingSensor.heading
    val headingGeographic: StateFlow<Boolean> get() = headingSensor.geographic
    val compassAvailable: Boolean get() = headingSensor.available

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<UiEvent> = _events

    @Volatile
    var appVisible = false
        private set

    private var initialized = false
    private var seq = Random.nextInt(256)
    private var currentPing: PingCode = PingCode.NONE
    private var currentTarget: String? = null
    private var currentSeq = 0
    private val seenKeys = LinkedHashMap<String, Long>()
    private val lanAddresses = HashMap<String, InetAddress>()
    private var pingJob: Job? = null
    private var pingAllJob: Job? = null
    private var loopJob: Job? = null
    private var directionJob: Job? = null
    private var saveJob: Job? = null
    private var direction: DirectionSampler? = null
    private var screenReceiver: BroadcastReceiver? = null
    private var btReceiver: BroadcastReceiver? = null
    private lateinit var logFile: File

    val myId: String get() = prefs.current.deviceId

    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        initialized = true
        app = context.applicationContext
        prefs = Prefs(app)
        logFile = File(app.filesDir, "verlauf.json")
        advertiser = BleAdvertiser(app) { st ->
            _status.update {
                it.copy(
                    advertising = st.active,
                    advertiseError = st.error,
                    canAdvertise = st.supported ?: it.canAdvertise,
                )
            }
        }
        scanner = BleScanner(app, ::onBleSighting) { st ->
            _status.update { it.copy(scanning = st.active, scanFiltered = st.filtered, scanError = st.error) }
        }
        lan = LanChannel(app, scope, prefs.current.deviceId, ::onLanMessage) { st ->
            val wasUp = _status.value.lanUp
            _status.update { it.copy(lanUp = st.up, lanIp = st.ip, lanError = st.error) }
            if (st.up && !wasUp) {
                sendHello()
                // Flag „im Netz erreichbar“ in die Aussendung übernehmen
                if (_status.value.advertising) startAdvertising(currentPing != PingCode.NONE)
            }
        }
        wifiScanner = WifiScanner(app, ::onWifiResults)
        headingSensor = HeadingSensor(app)
        _status.update { it.copy(screenOn = isScreenOn()) }
        loadLog()
        refreshBluetoothState()
    }

    // ---------------------------------------------------------------- Start / Stopp

    fun start() {
        val s = prefs.current
        if (_status.value.running) {
            applyMode(s.mode)
            return
        }
        _status.update { it.copy(running = true, mode = s.mode) }
        registerReceivers()
        refreshBluetoothState()
        applyMode(s.mode)
        loopJob?.cancel()
        loopJob = scope.launch { loop() }
        if (s.background) NahfunkService.start(app)
    }

    fun stop() {
        if (!_status.value.running) return
        loopJob?.cancel(); loopJob = null
        pingJob?.cancel(); pingJob = null
        pingAllJob?.cancel(); pingAllJob = null
        cancelDirection()
        if (lan.state.up) {
            lan.send(LanMessage(LanMessage.BYE, myId, prefs.current.displayName, nextSeq(), ts = System.currentTimeMillis()))
        }
        currentPing = PingCode.NONE
        currentTarget = null
        advertiser.stop()
        scanner.stop()
        lan.stop()
        wifiScanner.stop()
        classicDiscovery?.cancel()
        classicDiscovery = null
        unregisterReceivers()
        if (!appVisible) headingSensor.stop()
        NahfunkService.stop(app)
        _status.update {
            it.copy(
                running = false, advertising = false, scanning = false, lanUp = false,
                pingAllRemaining = 0, classicDiscovering = false, direction = null,
            )
        }
    }

    fun setMode(mode: Mode) {
        prefs.update { it.copy(mode = mode) }
        if (_status.value.running) applyMode(mode) else _status.update { it.copy(mode = mode) }
    }

    fun setBackground(enabled: Boolean) {
        prefs.update { it.copy(background = enabled) }
        if (_status.value.running) {
            if (enabled) NahfunkService.start(app) else NahfunkService.stop(app)
        }
    }

    private fun applyMode(mode: Mode) {
        _status.update { it.copy(mode = mode) }
        if (mode.usesBle) {
            startScan()
            startAdvertising(currentPing != PingCode.NONE)
        } else {
            scanner.stop()
            advertiser.stop()
        }
        if (mode.usesLan) {
            lan.start()
            wifiScanner.start()
            wifiScanner.requestScan()
            wifiScanner.readResults()
        } else {
            if (lan.state.up) {
                lan.send(LanMessage(LanMessage.BYE, myId, prefs.current.displayName, nextSeq(), ts = System.currentTimeMillis()))
            }
            lan.stop()
            wifiScanner.stop()
        }
    }

    /** Die Oberfläche meldet, ob sie sichtbar ist: steuert Kompass und Scan-Intensität. */
    fun setAppVisible(visible: Boolean) {
        appVisible = visible
        val st = _status.value
        if (visible) {
            headingSensor.start()
            if (st.running && st.mode.usesBle) startScan()
        } else {
            if (direction == null) headingSensor.stop()
            if (st.running) {
                if (!prefs.current.background) {
                    stop()
                } else if (st.mode.usesBle) {
                    startScan()
                }
            }
        }
    }

    /** Nach Namensänderung: Aussendung und Präsenz erneuern. */
    fun onNameChanged() {
        val st = _status.value
        if (!st.running) return
        if (st.mode.usesBle && st.advertising) startAdvertising(currentPing != PingCode.NONE)
        if (st.lanUp) sendHello()
    }

    // ---------------------------------------------------------------- Bluetooth

    private fun startScan() {
        val st = _status.value
        scanner.start(filtered = !st.screenOn, lowLatency = appVisible || direction != null)
    }

    private fun startAdvertising(lowLatency: Boolean) {
        val s = prefs.current
        var flags = BleProtocol.FLAG_LISTENING
        if (_status.value.lanUp) flags = flags or BleProtocol.FLAG_LAN
        val main = BleProtocol.encodeMain(s.deviceId, flags, currentPing, currentSeq, currentTarget, s.displayName)
        val name = BleProtocol.encodeName(s.deviceId, s.displayName)
        advertiser.start(main, name, lowLatency)
    }

    /** „Sichtbar werden“: Funk-Aussendung (neu) starten. */
    fun becomeVisible() {
        if (!_status.value.running) start()
        if (!_status.value.mode.usesBle) setMode(Mode.BOTH)
        refreshBluetoothState()
        startAdvertising(currentPing != PingCode.NONE)
    }

    fun refreshBluetoothState() {
        val adapter = ClassicBt.adapter(app)
        val on = adapter?.isEnabled == true
        val can = if (adapter == null) false else advertiser.isSupported()
        _status.update { it.copy(bluetoothPresent = adapter != null, bluetoothOn = on, canAdvertise = can ?: it.canAdvertise?.takeIf { _ -> on }) }
    }

    /** Klassische Bluetooth-Suche (12 s), findet auch Handys, die nur klassisch sichtbar sind. */
    fun startClassicDiscovery() {
        if (classicDiscovery?.running == true) return
        val d = ClassicDiscovery(app, ::onClassicSighting) {
            _status.update { it.copy(classicDiscovering = false) }
            // Der LE-Scan leidet unter der klassischen Suche; danach frisch starten.
            if (_status.value.running && _status.value.mode.usesBle) startScan()
        }
        val ok = d.start()
        classicDiscovery = if (ok) d else null
        _status.update { it.copy(classicDiscovering = ok) }
    }

    // ---------------------------------------------------------------- Senden

    fun sendPing(code: PingCode, targetKey: String? = null) {
        if (!_status.value.running) start()
        val s = prefs.current
        val st = _status.value
        val target = targetKey?.let { _peers.value[it] }
        val targetId = target?.nahfunkId
        val seqNow = nextSeq()
        val via = ArrayList<Channel>()
        val now = System.currentTimeMillis()

        if (st.mode.usesLan && lan.state.up) {
            val unicast = if (targetId != null) listOfNotNull(lanAddresses[targetId]) else lanAddresses.values.toList()
            lan.send(
                LanMessage(LanMessage.PING, s.deviceId, s.displayName, seqNow, code, null, targetId, st.canAdvertise == true, now),
                unicast,
            )
            via += Channel.LAN
        }
        if (st.mode.usesBle && st.bluetoothOn && st.canAdvertise != false) {
            currentPing = code
            currentTarget = targetId
            currentSeq = seqNow
            startAdvertising(lowLatency = true)
            pingJob?.cancel()
            pingJob = scope.launch {
                delay(PING_BURST_MS)
                if (pingAllJob?.isActive != true) revertAdvertising()
            }
            via += Channel.BLE
        }
        if (via.isEmpty()) {
            emit(UiEvent.Info("Kein Weg aktiv – WLAN-Netz oder Funk einschalten."))
            return
        }
        addLog(LogEntry(now, Direction.OUT, targetKey, target?.name ?: "Alle", via.first(), code, null))
    }

    /** Ganze Sätze gehen nur im eigenen Netz. */
    fun sendText(text: String, targetKey: String? = null): Boolean {
        val clean = text.trim()
        if (clean.isEmpty()) return false
        if (!_status.value.running) start()
        if (!lan.state.up) {
            emit(UiEvent.Info("Nicht im WLAN-Netz – Sätze gehen nur dort."))
            return false
        }
        val s = prefs.current
        val target = targetKey?.let { _peers.value[it] }
        val targetId = target?.nahfunkId
        val unicast = if (targetId != null) listOfNotNull(lanAddresses[targetId]) else lanAddresses.values.toList()
        val now = System.currentTimeMillis()
        lan.send(
            LanMessage(LanMessage.TEXT, s.deviceId, s.displayName, nextSeq(), PingCode.NONE, clean.take(500), targetId, false, now),
            unicast,
        )
        addLog(LogEntry(now, Direction.OUT, targetKey, target?.name ?: "Alle", Channel.LAN, null, clean))
        return true
    }

    /** Ruft zwei Minuten lang auf allen Wegen und stupst jeden bekannten Teilnehmer einzeln an. */
    fun pingAll() {
        if (pingAllJob?.isActive == true) {
            cancelPingAll()
            return
        }
        if (!_status.value.running) start()
        val s = prefs.current
        val seqNow = nextSeq()
        val now = System.currentTimeMillis()
        addLog(LogEntry(now, Direction.OUT, null, "Alle", if (_status.value.mode.usesBle) Channel.BLE else Channel.LAN, PingCode.PING_ALL, null))
        pingAllJob = scope.launch {
            val st = _status.value
            if (st.mode.usesBle && st.bluetoothOn && st.canAdvertise != false) {
                pingJob?.cancel()
                currentPing = PingCode.PING_ALL
                currentTarget = null
                currentSeq = seqNow
                startAdvertising(lowLatency = true)
            }
            if (st.mode.usesBle && st.bluetoothOn) startClassicDiscovery()
            try {
                for (remaining in PING_ALL_SECONDS downTo 1) {
                    _status.update { it.copy(pingAllRemaining = remaining) }
                    if (remaining % 6 == 0 && _status.value.mode.usesLan && lan.state.up) {
                        lan.send(
                            LanMessage(LanMessage.PING, s.deviceId, s.displayName, seqNow, PingCode.PING_ALL, null, null, st.canAdvertise == true, System.currentTimeMillis()),
                            lanAddresses.values.toList(),
                        )
                    }
                    delay(1000)
                }
            } finally {
                _status.update { it.copy(pingAllRemaining = 0) }
                revertAdvertising()
            }
        }
    }

    fun cancelPingAll() {
        pingAllJob?.cancel()
        pingAllJob = null
        _status.update { it.copy(pingAllRemaining = 0) }
        revertAdvertising()
    }

    private fun revertAdvertising() {
        currentPing = PingCode.NONE
        currentTarget = null
        val st = _status.value
        if (st.running && st.mode.usesBle && st.bluetoothOn && st.canAdvertise != false) startAdvertising(lowLatency = false)
    }

    private fun sendHello() {
        val s = prefs.current
        val st = _status.value
        lan.send(LanMessage(LanMessage.HELLO, s.deviceId, s.displayName, nextSeq(), PingCode.NONE, null, null, st.canAdvertise == true, System.currentTimeMillis()))
    }

    @Synchronized
    private fun nextSeq(): Int {
        seq = (seq + 1) and 0xFF
        if (seq == 0) seq = 1
        return seq
    }

    // ---------------------------------------------------------------- Empfang

    private fun onBleSighting(s: BleScanner.BleSighting) {
        val blocks = s.record.manufacturerData(BleProtocol.COMPANY_ID)
        var beacon: BleProtocol.Beacon? = null
        var longName: Pair<String, String>? = null
        for (b in blocks) {
            val main = BleProtocol.decodeMain(b)
            if (main != null) beacon = main else BleProtocol.decodeName(b)?.let { longName = it }
        }
        val bc = beacon
        if (bc != null) {
            handleBeacon(bc, longName, s)
            return
        }
        // Fremdes Gerät – nur mit Bildschirm an interessant (ohne Filter-Scan kommen sie ohnehin nicht)
        val cls = Classifier.classifyBle(s.record)
        val key = "ble:${s.address}"
        val alias = prefs.current.aliases[key]
        val baseName = s.record.localName ?: defaultName(cls, s.address)
        upsert(key) { old ->
            val base = old ?: Peer(key, baseName, cls.kind, emptyMap())
            val kind = if (cls.kind == PeerKind.UNKNOWN && base.kind != PeerKind.UNKNOWN) base.kind else cls.kind
            base.copy(
                name = alias ?: s.record.localName ?: base.name,
                kind = kind,
                seen = base.seen + (Channel.BLE to s.time),
                rssi = Distance.smooth(base.rssi?.takeIf { base.rssiChannel == Channel.BLE }, s.rssi),
                rssiRaw = s.rssi,
                rssiChannel = Channel.BLE,
                address = s.address,
                detail = cls.detail.ifEmpty { base.detail },
            )
        }
        direction?.let { d -> if (d.peerKey == key) heading.value?.let { h -> d.add(h, s.rssi) } }
    }

    private fun handleBeacon(beacon: BleProtocol.Beacon, longName: Pair<String, String>?, s: BleScanner.BleSighting) {
        if (beacon.id == myId) return
        val key = "nf:${beacon.id}"
        val alias = prefs.current.aliases[key]
        val seenName = longName?.takeIf { it.first == beacon.id }?.second ?: beacon.shortName
        var peerName = "Jemand"
        upsert(key) { old ->
            val base = old ?: Peer(key, seenName ?: "Jemand", PeerKind.NAHFUNK, emptyMap())
            val name = alias ?: seenName ?: base.name
            peerName = name
            base.copy(
                name = name,
                kind = PeerKind.NAHFUNK,
                seen = base.seen + (Channel.BLE to s.time),
                rssi = Distance.smooth(base.rssi?.takeIf { base.rssiChannel == Channel.BLE }, s.rssi),
                rssiRaw = s.rssi,
                rssiChannel = Channel.BLE,
                nahfunkId = beacon.id,
                address = base.address ?: s.address,
                lanCapable = beacon.lanCapable,
            )
        }
        direction?.let { d -> if (d.peerKey == key) heading.value?.let { h -> d.add(h, s.rssi) } }

        if (beacon.ping != PingCode.NONE && (beacon.targetId == null || beacon.targetId == myId)) {
            if (markSeen("${beacon.id}:${beacon.seq}:${beacon.ping.code}")) {
                val dist = _peers.value[key]?.distanceMeters(prefs.current.calibration)
                incoming(LogEntry(s.time, Direction.IN, key, peerName, Channel.BLE, beacon.ping, null, dist))
            }
        }
    }

    private fun onLanMessage(m: LanMessage, from: InetAddress) {
        if (m.id == myId) return
        val key = "nf:${m.id}"
        val now = System.currentTimeMillis()
        if (m.type == LanMessage.BYE) {
            lanAddresses.remove(m.id)
            removeChannel(key, Channel.LAN)
            return
        }
        lanAddresses[m.id] = from
        val alias = prefs.current.aliases[key]
        upsert(key) { old ->
            val base = old ?: Peer(key, m.name, PeerKind.NAHFUNK, emptyMap())
            base.copy(
                name = alias ?: m.name,
                kind = PeerKind.NAHFUNK,
                seen = base.seen + (Channel.LAN to now),
                nahfunkId = m.id,
                address = from.hostAddress ?: base.address,
                lanCapable = true,
            )
        }
        if (m.target != null && m.target != myId) return
        when (m.type) {
            LanMessage.PING -> if (m.ping != PingCode.NONE && markSeen("${m.id}:${m.seq}:${m.ping.code}")) {
                val dist = _peers.value[key]?.distanceMeters(prefs.current.calibration)
                incoming(LogEntry(now, Direction.IN, key, alias ?: m.name, Channel.LAN, m.ping, null, dist))
            }
            LanMessage.TEXT -> if (!m.text.isNullOrBlank() && markSeen("${m.id}:${m.seq}:t")) {
                incoming(LogEntry(now, Direction.IN, key, alias ?: m.name, Channel.LAN, null, m.text.trim()))
            }
        }
    }

    private fun onWifiResults(list: List<WifiScanner.ApSighting>) {
        if (list.isEmpty()) return
        val aliases = prefs.current.aliases
        _peers.update { map ->
            val m = map.toMutableMap()
            for (ap in list) {
                val key = "ap:${ap.bssid}"
                val old = m[key]
                val base = old ?: Peer(key, ap.ssid, PeerKind.ACCESS_POINT, emptyMap())
                m[key] = base.copy(
                    name = aliases[key] ?: ap.ssid,
                    kind = PeerKind.ACCESS_POINT,
                    seen = mapOf(Channel.WIFI_AP to maxOf(ap.time, base.seen[Channel.WIFI_AP] ?: 0L)),
                    rssi = Distance.smooth(base.rssi, ap.rssi),
                    rssiRaw = ap.rssi,
                    rssiChannel = Channel.WIFI_AP,
                    address = ap.bssid,
                    detail = band(ap.frequencyMhz),
                )
            }
            m
        }
    }

    private fun onClassicSighting(s: ClassicDiscovery.ClassicSighting) {
        val cls = Classifier.classifyClassic(s.majorClass, s.deviceClass, s.name)
        val key = "bt:${s.address}"
        val alias = prefs.current.aliases[key]
        upsert(key) { old ->
            val base = old ?: Peer(key, s.name ?: defaultName(cls, s.address), cls.kind, emptyMap())
            base.copy(
                name = alias ?: s.name ?: base.name,
                kind = cls.kind,
                seen = base.seen + (Channel.CLASSIC to s.time),
                rssi = s.rssi?.let { Distance.smooth(base.rssi?.takeIf { _ -> base.rssiChannel == Channel.CLASSIC }, it) } ?: base.rssi,
                rssiRaw = s.rssi ?: base.rssiRaw,
                rssiChannel = if (s.rssi != null) Channel.CLASSIC else base.rssiChannel,
                address = s.address,
                detail = cls.detail.ifEmpty { base.detail },
            )
        }
        s.rssi?.let { rssi -> direction?.let { d -> if (d.peerKey == key) heading.value?.let { h -> d.add(h, rssi) } } }
    }

    private fun incoming(entry: LogEntry) {
        addLog(entry)
        entry.peerKey?.let { key ->
            upsert(key) { old -> old?.copy(lastPing = entry.ping, lastPingAt = entry.time) ?: return@upsert null }
        }
        Notifications.vibrate(app, entry.ping?.isUrgent == true)
        if (appVisible) {
            emit(UiEvent.Incoming(entry))
        } else if (prefs.current.notifications) {
            Notifications.showIncoming(app, entry)
        }
    }

    // ---------------------------------------------------------------- Richtung, Eichen, Namen

    fun startDirection(peerKey: String) {
        val peer = _peers.value[peerKey] ?: return
        if (peer.rssiChannel == Channel.WIFI_AP || peer.rssi == null) {
            emit(UiEvent.Info("Richtung geht nur bei Funk-Geräten, nicht bei WLAN-Sendern."))
            return
        }
        if (!headingSensor.available) {
            emit(UiEvent.Info("Kein Kompass-Sensor in diesem Handy."))
            return
        }
        cancelDirection()
        headingSensor.start()
        val sampler = DirectionSampler(peerKey)
        direction = sampler
        if (_status.value.running && _status.value.mode.usesBle) startScan()
        directionJob = scope.launch {
            val start = System.currentTimeMillis()
            try {
                while (true) {
                    val elapsed = System.currentTimeMillis() - start
                    val fraction = (elapsed.toFloat() / DIRECTION_MS).coerceIn(0f, 1f)
                    _status.update { it.copy(direction = DirectionProgress(peerKey, fraction, sampler.covered(), sampler.samples)) }
                    if (elapsed >= DIRECTION_MS) break
                    delay(250)
                }
                val result = sampler.result()
                if (result != null) {
                    val (bearing, quality) = result
                    upsert(peerKey) { old -> old?.copy(bearingDeg = bearing, bearingQuality = quality) }
                    val word = if (quality >= GOOD_QUALITY_DB) "gut" else "unsicher"
                    emit(UiEvent.Info("Richtung ${bearing.toInt()}° ($word, ${sampler.samples} Messungen)"))
                } else {
                    emit(UiEvent.Info("Richtung unklar – bitte langsam einmal ganz im Kreis drehen."))
                }
            } finally {
                direction = null
                _status.update { it.copy(direction = null) }
                if (!appVisible) headingSensor.stop()
            }
        }
    }

    fun cancelDirection() {
        directionJob?.cancel()
        directionJob = null
        direction = null
        _status.update { it.copy(direction = null) }
    }

    /** Auf 1 m eichen: die aktuelle Signalstärke dieses Geräts wird zum Bezugswert. */
    fun calibrateOn(peerKey: String): Boolean {
        val peer = _peers.value[peerKey] ?: return false
        val rssi = peer.rssi ?: return false
        prefs.update {
            val c = it.calibration
            it.copy(calibration = if (peer.rssiChannel == Channel.WIFI_AP) c.copy(p0Wifi = rssi) else c.copy(p0Ble = rssi))
        }
        emit(UiEvent.Info("Geeicht: ${Distance.formatDbm(rssi)} entsprechen 1 m."))
        return true
    }

    fun setAlias(peerKey: String, alias: String?) {
        val clean = alias?.trim()?.takeIf { it.isNotEmpty() }
        prefs.update {
            val a = it.aliases.toMutableMap()
            if (clean == null) a.remove(peerKey) else a[peerKey] = clean
            it.copy(aliases = a)
        }
        if (clean != null) upsert(peerKey) { old -> old?.copy(name = clean) }
    }

    fun forget(peerKey: String) {
        _peers.update { it - peerKey }
    }

    fun clearLog() {
        _log.value = emptyList()
        scheduleSave()
    }

    fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
        return pm.isIgnoringBatteryOptimizations(app.packageName)
    }

    // ---------------------------------------------------------------- Hilfen

    private fun upsert(key: String, transform: (Peer?) -> Peer?) {
        _peers.update { map ->
            val next = transform(map[key]) ?: return@update map
            map + (key to next)
        }
    }

    private fun removeChannel(key: String, channel: Channel) {
        _peers.update { map ->
            val p = map[key] ?: return@update map
            val seen = p.seen - channel
            if (seen.isEmpty()) map - key
            else map + (key to p.copy(seen = seen, rssi = if (p.rssiChannel == channel) null else p.rssi))
        }
    }

    private fun defaultName(cls: Classifier.Result, address: String): String {
        val base = cls.detail.ifEmpty { cls.kind.label }
        return "$base ${address.takeLast(5)}"
    }

    private fun band(mhz: Int): String = when {
        mhz <= 0 -> ""
        mhz < 3000 -> "2,4 GHz"
        mhz < 5925 -> "5 GHz"
        else -> "6 GHz"
    }

    @Synchronized
    private fun markSeen(key: String): Boolean {
        val now = System.currentTimeMillis()
        val it = seenKeys.entries.iterator()
        while (it.hasNext()) {
            if (now - it.next().value > SEEN_TTL_MS) it.remove() else break
        }
        if (seenKeys.containsKey(key)) return false
        seenKeys[key] = now
        if (seenKeys.size > 500) seenKeys.remove(seenKeys.keys.first())
        return true
    }

    private fun emit(e: UiEvent) {
        _events.tryEmit(e)
    }

    private suspend fun loop() {
        var tick = 0
        while (currentCoroutineContext().isActive) {
            val st = _status.value
            if (st.mode.usesLan) {
                if (lan.state.up && tick % HELLO_EVERY_S == 0) sendHello()
                if (tick % WIFI_SCAN_EVERY_S == 0) {
                    wifiScanner.requestScan()
                    wifiScanner.readResults()
                }
            }
            if (tick % 5 == 0) expire()
            if (tick % 30 == 0) refreshBluetoothState()
            if (st.mode.usesBle && st.bluetoothOn && tick > 0 && tick % SCAN_RESTART_EVERY_S == 0) startScan()
            delay(1000)
            tick++
        }
    }

    private fun expire() {
        val now = System.currentTimeMillis()
        _peers.update { map ->
            val out = HashMap<String, Peer>()
            for ((k, p) in map) {
                val seen = p.seen.filter { (ch, t) -> now - t < ttl(ch) }
                if (seen.isEmpty()) continue
                out[k] = if (seen.size == p.seen.size) p else p.copy(
                    seen = seen,
                    rssi = if (p.rssiChannel != null && !seen.containsKey(p.rssiChannel)) null else p.rssi,
                )
            }
            // Fremde Geräte begrenzen: die schwächsten fliegen zuerst
            val foreign = out.values.filter { !it.isNahfunk }
            if (foreign.size > MAX_FOREIGN) {
                foreign.sortedBy { it.rssi ?: -200.0 }.take(foreign.size - MAX_FOREIGN).forEach { out.remove(it.key) }
            }
            out
        }
        val liveIds = _peers.value.values.mapNotNull { it.nahfunkId }.toSet()
        lanAddresses.keys.retainAll(liveIds)
    }

    private fun ttl(ch: Channel): Long = when (ch) {
        Channel.BLE -> 30_000L
        Channel.LAN -> 35_000L
        Channel.WIFI_AP -> 4 * 60_000L
        Channel.CLASSIC -> 3 * 60_000L
    }

    private fun addLog(entry: LogEntry) {
        _log.update { (listOf(entry) + it).take(MAX_LOG) }
        scheduleSave()
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = scope.launch(Dispatchers.IO) {
            delay(1500)
            saveLog()
        }
    }

    private fun saveLog() {
        try {
            val arr = JSONArray()
            for (e in _log.value) {
                arr.put(
                    JSONObject()
                        .put("t", e.time)
                        .put("d", e.direction.name)
                        .put("k", e.peerKey ?: JSONObject.NULL)
                        .put("n", e.peerName)
                        .put("c", e.channel?.name ?: JSONObject.NULL)
                        .put("p", e.ping?.code ?: 0)
                        .put("x", e.text ?: JSONObject.NULL)
                        .put("m", e.distanceM ?: JSONObject.NULL),
                )
            }
            logFile.writeText(arr.toString())
        } catch (e: Exception) {
            // Verlauf ist Komfort, kein Muss
        }
    }

    private fun loadLog() {
        if (!logFile.exists()) return
        try {
            val arr = JSONArray(logFile.readText())
            val list = ArrayList<LogEntry>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list += LogEntry(
                    time = o.optLong("t"),
                    direction = runCatching { Direction.valueOf(o.optString("d")) }.getOrDefault(Direction.IN),
                    peerKey = if (o.isNull("k")) null else o.optString("k"),
                    peerName = o.optString("n", "Jemand"),
                    channel = if (o.isNull("c")) null else runCatching { Channel.valueOf(o.optString("c")) }.getOrNull(),
                    ping = PingCode.fromCode(o.optInt("p", 0)).takeIf { it != PingCode.NONE },
                    text = if (o.isNull("x")) null else o.optString("x"),
                    distanceM = if (o.isNull("m")) null else o.optDouble("m"),
                )
            }
            _log.value = list.take(MAX_LOG)
        } catch (e: JSONException) {
            // kaputter Verlauf wird ignoriert
        } catch (e: Exception) {
            // dito
        }
    }

    private fun registerReceivers() {
        if (screenReceiver == null) {
            val r = object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    val on = intent.action == Intent.ACTION_SCREEN_ON
                    _status.update { it.copy(screenOn = on) }
                    if (_status.value.running && _status.value.mode.usesBle) startScan()
                }
            }
            val f = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            }
            ContextCompat.registerReceiver(app, r, f, ContextCompat.RECEIVER_NOT_EXPORTED)
            screenReceiver = r
        }
        if (btReceiver == null) {
            val r = object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
                    val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                    refreshBluetoothState()
                    val st = _status.value
                    if (state == BluetoothAdapter.STATE_ON && st.running && st.mode.usesBle) {
                        startScan()
                        startAdvertising(currentPing != PingCode.NONE)
                    } else if (state == BluetoothAdapter.STATE_OFF) {
                        _status.update { it.copy(advertising = false, scanning = false) }
                    }
                }
            }
            ContextCompat.registerReceiver(app, r, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
            btReceiver = r
        }
    }

    private fun unregisterReceivers() {
        screenReceiver?.let { runCatching { app.unregisterReceiver(it) } }
        btReceiver?.let { runCatching { app.unregisterReceiver(it) } }
        screenReceiver = null
        btReceiver = null
    }

    private fun isScreenOn(): Boolean {
        val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
        return pm.isInteractive
    }

    private const val PING_BURST_MS = 25_000L
    private const val PING_ALL_SECONDS = 120
    private const val DIRECTION_MS = 20_000L
    private const val GOOD_QUALITY_DB = 4f
    private const val SEEN_TTL_MS = 10 * 60_000L
    private const val HELLO_EVERY_S = 10
    private const val WIFI_SCAN_EVERY_S = 30
    private const val SCAN_RESTART_EVERY_S = 600
    private const val MAX_FOREIGN = 80
    private const val MAX_LOG = 200
}

/** Sammelt (Blickrichtung, Signalstärke) in 15°-Sektoren, während man sich einmal dreht. */
class DirectionSampler(val peerKey: String) {
    private val sum = DoubleArray(SECTORS)
    private val count = IntArray(SECTORS)

    @Volatile
    var samples = 0
        private set

    @Synchronized
    fun add(headingDeg: Float, rssi: Int) {
        val h = ((headingDeg % 360f) + 360f) % 360f
        val sector = (h / (360f / SECTORS)).toInt().coerceIn(0, SECTORS - 1)
        sum[sector] += rssi
        count[sector]++
        samples++
    }

    @Synchronized
    fun covered(): Int = count.count { it > 0 }

    /** Liefert (Richtung in Grad, Güte in dB) oder null, wenn zu wenig gemessen wurde. */
    @Synchronized
    fun result(): Pair<Float, Float>? {
        val avg = DoubleArray(SECTORS) { if (count[it] > 0) sum[it] / count[it] else Double.NaN }
        val valid = avg.filter { !it.isNaN() }
        if (valid.size < MIN_SECTORS || samples < MIN_SAMPLES) return null
        var bestI = -1
        var bestScore = Double.NEGATIVE_INFINITY
        val scores = DoubleArray(SECTORS)
        for (i in 0 until SECTORS) {
            var s = 0.0
            var n = 0
            for (d in -1..1) {
                val v = avg[(i + d + SECTORS) % SECTORS]
                if (!v.isNaN()) {
                    s += v
                    n++
                }
            }
            scores[i] = if (n == 0) Double.NEGATIVE_INFINITY else s / n
            if (scores[i] > bestScore) {
                bestScore = scores[i]
                bestI = i
            }
        }
        if (bestI < 0) return null
        val sorted = valid.sorted()
        val median = sorted[sorted.size / 2]
        val bearing = bestI * (360f / SECTORS) + (180f / SECTORS)
        return bearing to (bestScore - median).toFloat()
    }

    private companion object {
        const val SECTORS = 24
        const val MIN_SECTORS = 6
        const val MIN_SAMPLES = 12
    }
}
