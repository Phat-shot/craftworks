package expo.modules.wearbridge

import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Sends AR Ops match-state JSON to the paired Wear OS watch over the Data
 * Layer API (MessageClient) — the phone-side half of the watch companion,
 * see apps/arops-wear/.../GameStateListenerService.kt on the receiving end.
 * No pairing/discovery UI needed here: any already Bluetooth-paired watch
 * running the watch app is a "connected node" automatically.
 */
class WearBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WearBridge")

    AsyncFunction("sendMessage") Coroutine { path: String, jsonPayload: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        val nodes = Tasks.await(Wearable.getNodeClient(context).connectedNodes)
        if (nodes.isEmpty()) return@withContext false
        val data = jsonPayload.toByteArray(Charsets.UTF_8)
        for (node in nodes) {
          Tasks.await(Wearable.getMessageClient(context).sendMessage(node.id, path, data))
        }
        true
      }
    }

    // Pairing confirmation as a persistent DataItem, not just a one-off
    // MessageClient push — the watch can be in a short-lived, Activity-less
    // process exactly when the message arrives (Wear OS kills backgrounded
    // apps aggressively) and silently miss it. DataItems are actively kept
    // in sync by Play Services and can be polled on the watch side
    // (PairingRepository.checkClaimViaDataLayer) instead of relying purely
    // on a push being delivered at the right moment.
    AsyncFunction("putClaim") Coroutine { token: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        val request = PutDataMapRequest.create("/arops/claim").apply {
          dataMap.putString("token", token)
          dataMap.putLong("ts", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        Tasks.await(Wearable.getDataClient(context).putDataItem(request))
        true
      }
    }
  }
}
