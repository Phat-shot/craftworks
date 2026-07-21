package one.srz.aropswear.model

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A radar contact reported by the phone — bearing/distance relative to the
 * player, never an absolute lat/lon (matches AR Ops' privacy model: radar
 * pings never leak exact enemy coordinates, see
 * server/src/game/arops.js actionArUsePerk).
 */
data class RadarContact(
    val id: String,
    val bearingDeg: Double,
    val distanceM: Double,
    val hot: Boolean,
)

/** A single comic-map footprint (building/path/forest/...), mirrors
 *  apps/arops-mobile/src/components/ComicMapLayers.tsx's ComicFeature. */
data class ComicFeature(
    val kind: String,
    val points: List<Pair<Double, Double>>, // (lat, lon)
)

data class GameState(
    val phase: String = "–",
    val remainingS: Int = 0,
    val myLat: Double? = null,
    val myLon: Double? = null,
    val headingDeg: Double? = null,
    val contacts: List<RadarContact> = emptyList(),
    val comicFeatures: List<ComicFeature> = emptyList(),
    val hasComicMap: Boolean = false,
    // Stamped by GameStateRepository.update, not by callers — 0L means "no
    // push has ever been received" (used by ui/DebugScreen.kt's connection
    // info to show "no data yet" vs. "last data Xs ago").
    val updatedAtMs: Long = 0L,
)

/**
 * Simple in-process holder for the latest state pushed from the phone —
 * GameStateListenerService writes to it, the Compose UI (MainActivity)
 * reads it as a StateFlow. No persistence: if the watch app is killed, it
 * starts blank again until the phone pushes a fresh state.
 */
object GameStateRepository {
    private val _state = MutableStateFlow(GameState())
    val state = _state.asStateFlow()

    fun update(newState: GameState) {
        _state.value = newState.copy(updatedAtMs = System.currentTimeMillis())
    }
}
