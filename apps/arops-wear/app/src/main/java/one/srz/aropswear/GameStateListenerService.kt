package one.srz.aropswear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import one.srz.aropswear.model.ComicFeature
import one.srz.aropswear.model.GameState
import one.srz.aropswear.model.GameStateRepository
import one.srz.aropswear.model.RadarContact
import org.json.JSONObject

/**
 * Receives game-state pushes from the paired phone's Craftworks app over the
 * Wear OS Data Layer (MessageClient, path "/arops/state"). The phone side
 * (apps/arops-mobile) does not implement the sending half yet — this is
 * only the receiving half, ready to be wired up once it does. Until then
 * this watch app has nothing to show but its blank placeholder state.
 *
 * Expected JSON payload shape (proposal, to be finalized once the phone
 * side is built):
 * {
 *   "phase": "seeking", "remainingS": 245,
 *   "myLat": 48.137, "myLon": 11.575, "headingDeg": 87.4,
 *   "contacts": [{"id":"...", "bearingDeg":120.0, "distanceM":30.0, "hot":false}],
 *   "comicFeatures": [{"kind":"building", "points":[{"lat":...,"lon":...}, ...]}]
 * }
 */
class GameStateListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
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
}
