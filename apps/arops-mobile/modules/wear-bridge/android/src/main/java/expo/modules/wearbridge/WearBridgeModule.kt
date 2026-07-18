package expo.modules.wearbridge

import com.google.android.gms.tasks.Tasks
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
  }
}
