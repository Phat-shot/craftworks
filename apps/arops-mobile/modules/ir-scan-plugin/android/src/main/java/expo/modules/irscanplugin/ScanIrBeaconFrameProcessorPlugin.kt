package expo.modules.irscanplugin

import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy

/**
 * Decodes the AR Ops IR-ID beacon (see hardware/esp32-ir/firmware/ir_beacon)
 * from the camera's live Y-plane (luminance) — an 850nm IR LED shows up as a
 * bright spot even through a phone's IR-cut filter, so this reads raw
 * brightness directly off the YUV Y-plane, no full RGB conversion needed.
 *
 * Tracks the brightest region's on/off state over time in a short rolling
 * history and decodes the beacon's fixed packet format (see firmware):
 *   300ms ON preamble, 100ms gap, 8×150ms data bits (MSB first), 500ms idle.
 *
 * Call from JS: VisionCameraProxy.initFrameProcessorPlugin("scanIrBeacon", {})
 * (see src/hooks/useIrScan.ts). Returns null while no complete packet has
 * finished decoding yet, otherwise a map with "deviceId" (0-255) and "ts"
 * (the frame timestamp the decode completed at).
 *
 * UNTESTED against real hardware. BRIGHTNESS_THRESHOLD and the ROI size are
 * starting points based on the LED/camera characteristics described in
 * hardware/esp32-ir/README.md, not empirically measured — expect to tune
 * BRIGHTNESS_THRESHOLD after seeing real camera footage of the lit LED (in
 * particular: ambient IR from sunlight can itself be bright enough to
 * saturate the Y-plane, so this will likely need to work worse/not at all
 * outdoors in direct sun until re-tuned against real footage).
 */
class ScanIrBeaconFrameProcessorPlugin(
  proxy: VisionCameraProxy,
  options: Map<String, Any?>?
) : FrameProcessorPlugin() {

  companion object {
    private const val BRIGHTNESS_THRESHOLD = 200 // Y-plane value (0-255) above which a pixel counts as "lit"
    private const val ROI_FRACTION = 0.5 // only scan the central 50%x50% of the frame
    private const val GRID_SAMPLES = 40 // per axis — coarse grid, not a full-resolution scan
    private const val PREAMBLE_MIN_MS = 220L // preamble is 300ms transmitted; allow camera-timing margin
    private const val GAP_MS = 100L
    private const val BIT_MS = 150L
    private const val HISTORY_WINDOW_MS = 3000L // discard on/off samples older than this
  }

  private data class Sample(val tsMs: Long, val on: Boolean)
  // VisionCamera invokes a given plugin instance's callback() serially from
  // its own frame-processor thread, never concurrently — a plain mutable
  // list is safe here without extra synchronization.
  private val history = ArrayDeque<Sample>()

  override fun callback(frame: Frame, params: Map<String, Any?>?): Any? {
    val nowMs = System.currentTimeMillis()
    val isOn = try {
      isBeaconLit(frame)
    } catch (e: Throwable) {
      false
    }

    history.addLast(Sample(nowMs, isOn))
    while (history.isNotEmpty() && nowMs - history.first().tsMs > HISTORY_WINDOW_MS) {
      history.removeFirst()
    }

    return decode(nowMs)
  }

  private fun isBeaconLit(frame: Frame): Boolean {
    val image = frame.image
    val plane = image.planes[0] // Y (luminance) plane — first plane in YUV_420_888
    val buffer = plane.buffer
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    val width = frame.width
    val height = frame.height

    val roiW = (width * ROI_FRACTION).toInt()
    val roiH = (height * ROI_FRACTION).toInt()
    val startX = (width - roiW) / 2
    val startY = (height - roiH) / 2
    val stepX = maxOf(1, roiW / GRID_SAMPLES)
    val stepY = maxOf(1, roiH / GRID_SAMPLES)

    var brightest = 0
    var y = startY
    while (y < startY + roiH) {
      val rowOffset = y * rowStride
      var x = startX
      while (x < startX + roiW) {
        val idx = rowOffset + x * pixelStride
        if (idx in 0 until buffer.capacity()) {
          val v = buffer.get(idx).toInt() and 0xFF
          if (v > brightest) brightest = v
        }
        x += stepX
      }
      y += stepY
    }
    return brightest >= BRIGHTNESS_THRESHOLD
  }

  /**
   * Finds the most recent "on" run in the history long enough to plausibly
   * be the preamble, then majority-votes each of the 8 following 150ms bit
   * slots. Returns null until enough history has accumulated past the end
   * of the last full 8-bit window (i.e. keeps returning null while still
   * "mid-packet").
   */
  private fun decode(nowMs: Long): Map<String, Any>? {
    if (history.size < 4) return null
    val samples = history.toList() // oldest → newest

    var i = samples.size - 1
    var preambleEndTs = -1L
    while (i >= 0) {
      if (samples[i].on) {
        var j = i
        while (j >= 0 && samples[j].on) j--
        val runStartTs = samples[j + 1].tsMs
        val runEndTs = samples[i].tsMs
        if (runEndTs - runStartTs >= PREAMBLE_MIN_MS) {
          preambleEndTs = runEndTs
          break
        }
        i = j
      } else {
        i--
      }
    }
    if (preambleEndTs < 0) return null

    val dataStartTs = preambleEndTs + GAP_MS
    val dataEndTs = dataStartTs + 8 * BIT_MS
    if (nowMs < dataEndTs) return null // still waiting for the full packet to have elapsed

    var value = 0
    for (bitIndex in 0 until 8) {
      val slotStart = dataStartTs + bitIndex * BIT_MS
      val slotEnd = slotStart + BIT_MS
      val slotSamples = samples.filter { it.tsMs >= slotStart && it.tsMs < slotEnd }
      val onCount = slotSamples.count { it.on }
      val bitIsOn = slotSamples.isNotEmpty() && onCount * 2 >= slotSamples.size // majority vote
      value = (value shl 1) or (if (bitIsOn) 1 else 0)
    }

    return mapOf("deviceId" to value, "ts" to nowMs)
  }
}
