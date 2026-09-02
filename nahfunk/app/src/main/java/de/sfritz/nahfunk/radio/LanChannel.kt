package de.sfritz.nahfunk.radio

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import de.sfritz.nahfunk.core.LanMessage
import de.sfritz.nahfunk.core.LanProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface

/**
 * Eigenes WLAN-Netz: UDP-Broadcast und -Multicast auf einem festen Port.
 * Präsenz, Pings und ganze Sätze – alles nur innerhalb des Netzes.
 */
class LanChannel(
    context: Context,
    private val scope: CoroutineScope,
    private val ownId: String,
    private val onMessage: (LanMessage, InetAddress) -> Unit,
    private val onState: (LanState) -> Unit,
) {
    data class LanState(
        val up: Boolean = false,
        val ip: String? = null,
        val broadcast: String? = null,
        val ifName: String? = null,
        val error: String? = null,
    )

    private val appContext = context.applicationContext
    private val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    private val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    @Volatile
    private var socket: MulticastSocket? = null
    private var receiveJob: Job? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var broadcastAddr: InetAddress? = null
    private val groupAddr: InetAddress = InetAddress.getByName(LanProtocol.GROUP)
    private val limitedBroadcast: InetAddress = InetAddress.getByName("255.255.255.255")

    @Volatile
    var state = LanState()
        private set(value) {
            field = value
            onState(value)
        }

    fun start() {
        if (callback != null) return
        val manager = cm
        if (manager == null) {
            state = LanState(error = "Kein Netzwerkdienst")
            return
        }
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
                scope.launch(Dispatchers.IO) { bind(network, linkProperties) }
            }

            override fun onLost(network: Network) {
                scope.launch(Dispatchers.IO) { closeSocket("Netz verloren") }
            }
        }
        try {
            manager.registerNetworkCallback(request, cb)
            callback = cb
        } catch (e: RuntimeException) {
            state = LanState(error = "Netzwerk-Überwachung nicht möglich")
        }
    }

    fun stop() {
        callback?.let { cb ->
            try {
                cm?.unregisterNetworkCallback(cb)
            } catch (e: RuntimeException) {
                // war nicht mehr registriert
            }
        }
        callback = null
        closeSocket(null)
    }

    @Synchronized
    private fun bind(network: Network, lp: LinkProperties) {
        val link = lp.linkAddresses.firstOrNull { it.address is Inet4Address && !it.address.isLoopbackAddress }
        if (link == null) {
            closeSocket("kein IPv4 im Netz")
            return
        }
        val ip = link.address.hostAddress ?: return
        val ifName = lp.interfaceName
        if (socket != null && state.up && state.ip == ip && state.ifName == ifName) return

        closeSocket(null)
        try {
            val nif = ifName?.let { runCatching { NetworkInterface.getByName(it) }.getOrNull() }
            val s = MulticastSocket(null)
            s.reuseAddress = true
            try {
                network.bindSocket(s)
            } catch (e: IOException) {
                // dann geht der Verkehr über die Standardroute; im WLAN meist dasselbe
            }
            s.bind(InetSocketAddress(LanProtocol.PORT))
            s.broadcast = true
            if (nif != null) {
                s.networkInterface = nif
                s.joinGroup(InetSocketAddress(groupAddr, LanProtocol.PORT), nif)
            } else {
                @Suppress("DEPRECATION")
                s.joinGroup(groupAddr)
            }
            multicastLock = wifi?.createMulticastLock("nahfunk")?.apply {
                setReferenceCounted(false)
                acquire()
            }
            broadcastAddr = broadcastOf(link.address as Inet4Address, link.prefixLength)
            socket = s
            state = LanState(true, ip, broadcastAddr?.hostAddress, ifName, null)
            receiveJob = scope.launch(Dispatchers.IO) { receiveLoop(s) }
        } catch (e: Exception) {
            state = LanState(false, ip, null, ifName, "Netz-Socket: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    @Synchronized
    private fun closeSocket(reason: String?) {
        receiveJob?.cancel()
        receiveJob = null
        socket?.let { s ->
            try {
                s.close()
            } catch (e: Exception) {
                // egal
            }
        }
        socket = null
        broadcastAddr = null
        multicastLock?.let { if (it.isHeld) it.release() }
        multicastLock = null
        if (state.up || reason != null) state = LanState(false, error = reason)
    }

    private fun receiveLoop(s: MulticastSocket) {
        val buf = ByteArray(2048)
        while (scope.isActive && socket === s) {
            val packet = DatagramPacket(buf, buf.size)
            try {
                s.receive(packet)
            } catch (e: IOException) {
                break
            }
            val msg = LanProtocol.decode(packet.data, packet.offset, packet.length) ?: continue
            if (msg.id == ownId) continue
            val from = packet.address ?: continue
            onMessage(msg, from)
        }
    }

    /** Sendet an Subnetz-Broadcast, 255.255.255.255, Multicast-Gruppe und zusätzlich einzeln. */
    fun send(msg: LanMessage, unicast: Collection<InetAddress> = emptyList()) {
        val s = socket ?: return
        val bytes = LanProtocol.encode(msg)
        scope.launch(Dispatchers.IO) {
            val targets = LinkedHashSet<InetAddress>()
            broadcastAddr?.let { targets.add(it) }
            targets.add(limitedBroadcast)
            targets.add(groupAddr)
            targets.addAll(unicast)
            for (t in targets) {
                try {
                    s.send(DatagramPacket(bytes, bytes.size, t, LanProtocol.PORT))
                } catch (e: IOException) {
                    // einzelne Ziele dürfen scheitern
                }
            }
        }
    }

    private fun broadcastOf(addr: Inet4Address, prefix: Int): InetAddress {
        val b = addr.address
        var ip = 0
        for (i in 0 until 4) ip = (ip shl 8) or (b[i].toInt() and 0xFF)
        val mask = if (prefix <= 0) 0 else if (prefix >= 32) -1 else (-1 shl (32 - prefix))
        val bc = ip or mask.inv()
        val out = ByteArray(4)
        for (i in 0 until 4) out[i] = (bc shr (24 - 8 * i)).toByte()
        return InetAddress.getByAddress(out)
    }
}
