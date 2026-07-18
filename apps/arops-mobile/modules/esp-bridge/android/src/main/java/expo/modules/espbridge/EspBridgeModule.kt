package expo.modules.espbridge

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private const val ACTION_USB_PERMISSION = "expo.modules.espbridge.USB_PERMISSION"

// Espressif's own USB vendor ID (used by boards with native USB, like the
// ESP32-S3, as opposed to a separate CP210x/CH340 UART bridge chip which
// would show a different VID) — lets us pick the right device automatically
// out of whatever else might be plugged in via USB-OTG.
private const val ESPRESSIF_VID = 0x303A

/**
 * Wired USB-C bench-test link to an AR Ops IR-ID-beacon board (see
 * hardware/esp32-ir/firmware/ir_beacon — an ESP32-S3 driving a TSAL6100 IR
 * LED through an AO3400A MOSFET). NOT part of the gameplay path: the beacon
 * broadcasts its ID continuously and standalone once flashed, no data
 * connection needed while worn — this is only for confirming over USB from
 * a workbench that a given board is alive (see "ping" below) before
 * flashing/wearing it. Talks raw CDC-ACM: the ESP32-S3's native USB already
 * presents as a standard USB serial device, so this reads/writes its bulk
 * data endpoints directly via Android's built-in USB host API — no
 * third-party USB-serial library/Maven repo needed for that.
 *
 * Protocol is line-based, newline-terminated:
 *  - phone → ESP: "PING\n"
 *  - ESP → phone: a boot line at startup and a heartbeat reply to each PING
 *    (see firmware), forwarded to JS as "onStatus" events so the UI can
 *    show a connected/last-seen status.
 */
class EspBridgeModule : Module() {
  private var connection: UsbDeviceConnection? = null
  private var bulkIn: UsbEndpoint? = null
  private var bulkOut: UsbEndpoint? = null
  private val reading = AtomicBoolean(false)
  private var readThread: Thread? = null

  override fun definition() = ModuleDefinition {
    Name("EspBridge")
    Events("onStatus")

    OnDestroy {
      teardown()
    }

    // Explicitly-typed `suspend () -> R` locals below, rather than passing a
    // bare `{ ... }` lambda straight to the Coroutine infix: AsyncFunctionBuilder
    // .Coroutine has 9 overloads (0 through 8 lambda parameters), and a plain
    // lambda that never references/declares any parameters is syntactically
    // valid for ALL of them at once — a genuine "overload resolution
    // ambiguity" compile error, not just a style nit. Pinning the type first
    // rules out every non-zero-arity overload outright (different arities
    // are simply incompatible function types in Kotlin, so once the type is
    // fixed there's nothing left to be ambiguous about).
    val connectBody: suspend () -> Boolean = {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { connectToDevice(context) }
    }
    AsyncFunction("connect") Coroutine connectBody

    val disconnectBody: suspend () -> Unit = { teardown() }
    AsyncFunction("disconnect") Coroutine disconnectBody

    // Bench-test only — the beacon firmware (hardware/esp32-ir/firmware/
    // ir_beacon) runs standalone off any USB power source and needs no data
    // connection during actual gameplay; "PING" just confirms over serial
    // that a given board is alive and reports which ID it's broadcasting,
    // without needing a second phone's camera nearby to verify.
    val pingBody: suspend () -> Boolean = {
      withContext(Dispatchers.IO) { writeLine("PING") }
    }
    AsyncFunction("ping") Coroutine pingBody
  }

  private fun findEspDevice(manager: UsbManager): UsbDevice? =
    manager.deviceList.values.firstOrNull { it.vendorId == ESPRESSIF_VID }

  private fun connectToDevice(context: Context): Boolean {
    val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
    val device = findEspDevice(manager) ?: return false

    if (!manager.hasPermission(device)) {
      if (!requestPermissionSync(context, manager, device)) return false
    }

    val conn = manager.openDevice(device) ?: return false

    // Native-USB CDC exposes (at least) two interfaces: a "Communications"
    // one (interrupt endpoint, control notifications we don't need) and a
    // "Data" one (bulk IN/OUT — the actual byte stream we talk to).
    var dataIface: UsbInterface? = null
    for (i in 0 until device.interfaceCount) {
      val iface = device.getInterface(i)
      if (iface.interfaceClass == UsbConstants.USB_CLASS_CDC_DATA) {
        dataIface = iface
        break
      }
    }
    val iface = dataIface
    if (iface == null) {
      conn.close()
      return false
    }
    if (!conn.claimInterface(iface, true)) {
      conn.close()
      return false
    }

    var inEp: UsbEndpoint? = null
    var outEp: UsbEndpoint? = null
    for (i in 0 until iface.endpointCount) {
      val ep = iface.getEndpoint(i)
      if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK) {
        if (ep.direction == UsbConstants.USB_DIR_IN) inEp = ep else outEp = ep
      }
    }
    if (inEp == null || outEp == null) {
      conn.close()
      return false
    }

    connection = conn
    bulkIn = inEp
    bulkOut = outEp
    startReadLoop()
    sendEvent("onStatus", mapOf("connected" to true))
    return true
  }

  private fun requestPermissionSync(context: Context, manager: UsbManager, device: UsbDevice): Boolean {
    val latch = CountDownLatch(1)
    var granted = false
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        if (intent?.action == ACTION_USB_PERMISSION) {
          granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
          latch.countDown()
        }
      }
    }
    val filter = IntentFilter(ACTION_USB_PERMISSION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    val pi = PendingIntent.getBroadcast(context, 0, Intent(ACTION_USB_PERMISSION), flags)
    manager.requestPermission(device, pi)
    latch.await(15, TimeUnit.SECONDS)
    try { context.unregisterReceiver(receiver) } catch (e: Exception) { /* already gone */ }
    return granted
  }

  private fun startReadLoop() {
    reading.set(true)
    val thread = Thread {
      val buf = ByteArray(256)
      val line = StringBuilder()
      while (reading.get()) {
        val conn = connection ?: break
        val ep = bulkIn ?: break
        val n = conn.bulkTransfer(ep, buf, buf.size, 500)
        if (n > 0) {
          for (i in 0 until n) {
            // Mask before widening — Kotlin bytes are signed, so a raw byte
            // >=128 would sign-extend to a negative Int and produce the
            // wrong character otherwise (only matters for non-ASCII bytes,
            // but the JSON heartbeat lines are plain ASCII either way).
            val c = (buf[i].toInt() and 0xFF).toChar()
            if (c == '\n') {
              val text = line.toString().trim()
              if (text.isNotEmpty()) sendEvent("onStatus", mapOf("connected" to true, "line" to text))
              line.clear()
            } else {
              line.append(c)
            }
          }
        }
      }
    }
    thread.isDaemon = true
    thread.start()
    readThread = thread
  }

  private fun writeLine(text: String): Boolean {
    val conn = connection ?: return false
    val ep = bulkOut ?: return false
    val data = (text + "\n").toByteArray(Charsets.UTF_8)
    return conn.bulkTransfer(ep, data, data.size, 1000) >= 0
  }

  private fun teardown() {
    reading.set(false)
    readThread = null
    connection?.close()
    connection = null
    bulkIn = null
    bulkOut = null
    sendEvent("onStatus", mapOf("connected" to false))
  }
}
