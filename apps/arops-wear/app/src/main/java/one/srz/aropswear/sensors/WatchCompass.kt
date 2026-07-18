package one.srz.aropswear.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * Tilt-compensated compass heading of the watch's own top-edge direction —
 * same East/North-from-raw-sensors algorithm as the phone's
 * tiltCompensatedHeadingDeg (see packages/arops-shared/src/compass.ts),
 * reimplemented natively here since there's no shared Kotlin/TS code path.
 * A watch is worn flat on the wrist (screen facing up when raised to look
 * at it), so only the top-edge axis is relevant — there's no "camera-
 * forward" case like on the phone, which is held upright instead.
 *
 * The watch reads its OWN sensors rather than relying solely on the
 * heading the phone pushes over the Data Layer — more responsive, and
 * correct even if the phone is sitting in a pocket facing a different way
 * than the wrist actually is.
 */
object WatchCompass {
    private val _headingDeg = MutableStateFlow<Double?>(null)
    val headingDeg = _headingDeg.asStateFlow()

    private var sensorManager: SensorManager? = null
    private var accel = FloatArray(3)
    private var mag = FloatArray(3)
    private var hasAccel = false
    private var hasMag = false

    private val listener =
        object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                when (event.sensor.type) {
                    Sensor.TYPE_ACCELEROMETER -> {
                        accel = event.values.clone()
                        hasAccel = true
                    }
                    Sensor.TYPE_MAGNETIC_FIELD -> {
                        mag = event.values.clone()
                        hasMag = true
                    }
                }
                if (hasAccel && hasMag) {
                    _headingDeg.value = computeHeading(accel, mag)
                }
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }

    fun start(context: Context) {
        if (sensorManager != null) return
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        sensorManager = sm
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_UI)
        }
        sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)?.let {
            sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_UI)
        }
    }

    fun stop() {
        sensorManager?.unregisterListener(listener)
        sensorManager = null
        hasAccel = false
        hasMag = false
        _headingDeg.value = null
    }

    private fun computeHeading(a: FloatArray, m: FloatArray): Double? {
        val aLen = sqrt((a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).toDouble())
        if (aLen < 1e-6) return null
        val ax = a[0] / aLen
        val ay = a[1] / aLen
        val az = a[2] / aLen

        // east = normalize(mag × a)
        var ex = (m[1] * az - m[2] * ay).toDouble()
        var ey = (m[2] * ax - m[0] * az).toDouble()
        var ez = (m[0] * ay - m[1] * ax).toDouble()
        val eLen = sqrt(ex * ex + ey * ey + ez * ez)
        if (eLen < 1e-6) return null
        ex /= eLen; ey /= eLen; ez /= eLen

        // north = a × east (already unit length, a and east are orthonormal)
        val ny = az * ex - ax * ez

        // heading of the local +Y axis ("top edge"): axis = (0, 1, 0)
        // → east-component = ey, north-component = ny
        if (kotlin.math.abs(ey) < 1e-6 && kotlin.math.abs(ny) < 1e-6) return null
        var heading = Math.toDegrees(atan2(ey, ny))
        if (heading < 0) heading += 360
        return heading
    }
}
