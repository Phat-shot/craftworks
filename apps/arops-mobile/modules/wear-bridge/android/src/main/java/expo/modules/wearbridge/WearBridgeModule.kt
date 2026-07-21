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

    // putClaim's DataItem write below "succeeds" purely locally even with
    // zero connected nodes (Play Services just buffers it for whenever a
    // node eventually connects, which may be never) — that alone is not
    // proof the watch is actually reachable. Exposed separately so the JS
    // side (useWatchSync.claim) can tell "wrote locally" apart from
    // "there's an actual watch on the other end", instead of reporting a
    // pairing success that silently never reaches the watch.
    //
    // Explicitly-typed local (see EspBridgeModule.kt's connectBody/
    // disconnectBody for the same pattern): a bare zero-arg `{ ... }` lambda
    // passed straight to the Coroutine infix is a genuine overload-
    // resolution-ambiguity compile error (AsyncFunctionBuilder.Coroutine has
    // 9 overloads, 0 through 8 params, and a parameter-less lambda matches
    // all of them at once).
    val hasConnectedNodeBody: suspend () -> Boolean = {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        Tasks.await(Wearable.getNodeClient(context).connectedNodes).isNotEmpty()
      }
    }
    AsyncFunction("hasConnectedNode") Coroutine hasConnectedNodeBody

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
