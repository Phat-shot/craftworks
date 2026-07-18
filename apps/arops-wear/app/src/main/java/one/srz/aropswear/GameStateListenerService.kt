package one.srz.aropswear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import one.srz.aropswear.model.ComicFeature
import one.srz.aropswear.model.GameState
import one.srz.aropswear.model.GameStateRepository
import one.srz.aropswear.model.PairingRepository
import one.srz.aropswear.model.RadarContact
import org.json.JSONObject

/**
 * Receives pushes from the paired phone's Craftworks app over the Wear OS
 * Data Layer (MessageClient), two paths:
 *  - "/arops/claim": the phone scanned our pairing QR code (see
 *    ui/PairingScreen.kt) and echoes the token back — {"token": "..."}.
 *    Confirms the pairing so MainActivity switches to the HUD.
 *  - "/arops/state": the actual match-state push, JSON shape:
 *    {
 *      "phase": "seeking", "remainingS": 245,
 *      "myLat": 48.137, "myLon": 11.575, "headingDeg": 87.4,
 *      "contacts": [{"id":"...", "bearingDeg":120.0, "distanceM":30.0, "hot":false}],
 *      "comicFeatures": [{"kind":"building", "points":[{"lat":...,"lon":...}, ...]}]
 *    }
 */
class GameStateListenerService : WearableListenerService() {
    override fun onCreate() {
        super.onCreate()
        // The OS can spin up this service in a fresh, Activity-less process
        // just to deliver one message — PairingRepository.init() must have
        // run here too, or a "/arops/claim" landing in that short-lived
        // process would persist nothing and get lost once it dies again.
        PairingRepository.init(this)
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == "/arops/claim") {
            handleClaim(event)
            return
        }
        if (event.path != "/arops/state") return
        try {
            val json = JSONObject(String(event.data, Charsets.UTF_8))

            val contacts = mutableListOf<RadarContact>()
            json.optJSONArray("contacts")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val c = arr.getJSONObject(i)
                    contacts.add(
                        RadarContact(
                            id = c.optString("id"),
                            bearingDeg = c.optDouble("bearingDeg"),
                            distanceM = c.optDouble("distanceM"),
                            hot = c.optBoolean("hot", false),
                        )
                    )
                }
            }

            val features = mutableListOf<ComicFeature>()
            json.optJSONArray("comicFeatures")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val f = arr.getJSONObject(i)
                    val pts = mutableListOf<Pair<Double, Double>>()
                    f.optJSONArray("points")?.let { parr ->
                        for (j in 0 until parr.length()) {
                            val p = parr.getJSONObject(j)
                            pts.add(p.optDouble("lat") to p.optDouble("lon"))
                        }
                    }
                    features.add(ComicFeature(kind = f.optString("kind"), points = pts))
                }
            }

            GameStateRepository.update(
                GameState(
                    phase = json.optString("phase", "–"),
                    remainingS = json.optInt("remainingS", 0),
                    myLat = if (json.has("myLat")) json.optDouble("myLat") else null,
                    myLon = if (json.has("myLon")) json.optDouble("myLon") else null,
                    headingDeg = if (json.has("headingDeg")) json.optDouble("headingDeg") else null,
                    contacts = contacts,
                    comicFeatures = features,
                    hasComicMap = features.isNotEmpty(),
                )
            )
        } catch (e: Exception) {
            // Malformed push from the phone — keep showing the last good
            // state rather than crashing the watch app over it.
        }
    }

    private fun handleClaim(event: MessageEvent) {
        try {
            val json = JSONObject(String(event.data, Charsets.UTF_8))
            PairingRepository.tryClaim(json.optString("token"))
        } catch (e: Exception) {
            // Malformed claim — ignore, stay on the pairing screen.
        }
    }
}
