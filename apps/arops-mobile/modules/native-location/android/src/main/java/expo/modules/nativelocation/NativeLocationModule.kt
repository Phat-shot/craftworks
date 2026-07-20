package expo.modules.nativelocation

import android.location.Location
import android.os.Looper
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Direct Google Play Services FusedLocationProviderClient access, bypassing
 * expo-location's JS-bridge wrapper for the actual fix-acquisition calls
 * (the getCurrentPositionAsync/watchPositionAsync equivalents) — those have
 * a documented history in this codebase of silently hanging forever on some
 * devices with nothing to react to (see LobbyScreen.tsx's loadMyPosition and
 * useTelemetry.ts's startPosition, both worked around with JS-side watchdog
 * timers layered on top of expo-location rather than a fix at the source).
 * FusedLocationProviderClient is Google's own recommended API with
 * Task-based callbacks that reliably settle — using it directly removes the
 * wrapper layer that seems to be where the unreliability actually lives.
 *
 * Permission requesting itself is UNCHANGED — still expo-location's
 * Location.requestForegroundPermissionsAsync() on the JS side before any
 * call here. Every function below assumes that already succeeded; a
 * SecurityException from calling without it is swallowed (surfaced as
 * null / no events) rather than crashing, mirroring how the expo-location
 * calls it replaces would reject/stay silent for the same reason.
 */
class NativeLocationModule : Module() {
  private var client: FusedLocationProviderClient? = null
  private var callback: LocationCallback? = null

  override fun definition() = ModuleDefinition {
    Name("NativeLocation")
    Events("onLocation")

    OnDestroy { stopWatchInternal() }

    // Explicitly-typed locals (see EspBridgeModule.kt / WearBridgeModule.kt
    // for the same pattern): a bare lambda passed straight to the Coroutine
    // infix is a genuine overload-resolution-ambiguity compile error
    // (AsyncFunctionBuilder.Coroutine has 9 overloads, 0 through 8 params).
    val getCurrentLocationBody: suspend () -> Map<String, Any?>? = {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        val fused = LocationServices.getFusedLocationProviderClient(context)
        // 12s hard cap — belt-and-suspenders on top of this already being
        // the more reliable API; a caller-side timeout is still the
        // structural guarantee against ever hanging, same principle as
        // withTimeout() on the JS side wrapped around the old expo-location
        // calls this replaces.
        withTimeoutOrNull(12_000) {
          suspendCancellableCoroutine<Location?> { cont ->
            val cts = CancellationTokenSource()
            cont.invokeOnCancellation { cts.cancel() }
            try {
              fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                .addOnSuccessListener { loc -> if (cont.isActive) cont.resume(loc) }
                .addOnFailureListener { if (cont.isActive) cont.resume(null) }
            } catch (e: SecurityException) {
              if (cont.isActive) cont.resume(null)
            }
          }
        }?.toLocationMap()
      }
    }
    AsyncFunction("getCurrentLocation") Coroutine getCurrentLocationBody

    val startWatchBody: suspend () -> Unit = {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.Main) {
        stopWatchInternal()
        val fused = LocationServices.getFusedLocationProviderClient(context)
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
          .setMinUpdateIntervalMillis(500)
          .build()
        val cb = object : LocationCallback() {
          override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            sendEvent("onLocation", loc.toLocationMap())
          }
        }
        try {
          fused.requestLocationUpdates(request, cb, Looper.getMainLooper())
          client = fused
          callback = cb
        } catch (e: SecurityException) {
          // No permission — caller just never sees an "onLocation" event,
          // same observable behavior as expo-location's watchPositionAsync
          // rejecting for the same reason.
        }
      }
    }
    AsyncFunction("startWatch") Coroutine startWatchBody

    val stopWatchBody: suspend () -> Unit = { stopWatchInternal() }
    AsyncFunction("stopWatch") Coroutine stopWatchBody
  }

  private fun stopWatchInternal() {
    val cb = callback ?: return
    client?.removeLocationUpdates(cb)
    callback = null
    client = null
  }
}

private fun Location.toLocationMap(): Map<String, Any?> = mapOf(
  "lat" to latitude,
  "lon" to longitude,
  "accuracyM" to if (hasAccuracy()) accuracy.toDouble() else null,
  "speedMps" to if (hasSpeed()) speed.toDouble() else null,
  "headingDeg" to if (hasBearing()) bearing.toDouble() else null,
  "timestamp" to time,
)
