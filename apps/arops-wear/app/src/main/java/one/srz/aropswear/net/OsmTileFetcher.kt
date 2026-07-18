package one.srz.aropswear.net

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import okhttp3.OkHttpClient
import okhttp3.Request
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan

/**
 * OSM raster tile fallback for when the phone hasn't generated a comic map
 * yet (or the fetch failed) — same tile server the phone's Lobby map uses
 * (see apps/arops-mobile/src/mapStyle.ts OSM_STYLE), fetched directly here
 * since Wear OS has no MapLibre-equivalent renderer of its own. Single tile
 * only — enough for a small always-on radar background, not a scrollable
 * map (no pinch/zoom/pan on a watch-sized screen for this first version).
 */
object OsmTileFetcher {
    private val client = OkHttpClient()

    private fun lonToTileX(lon: Double, zoom: Int): Int =
        floor((lon + 180.0) / 360.0 * (1 shl zoom)).toInt()

    private fun latToTileY(lat: Double, zoom: Int): Int {
        val latRad = Math.toRadians(lat)
        return floor((1.0 - ln(tan(latRad) + 1.0 / cos(latRad)) / PI) / 2.0 * (1 shl zoom)).toInt()
    }

    /** Blocking network call — always invoke from a background dispatcher. */
    fun fetchTile(lat: Double, lon: Double, zoom: Int = 16): Bitmap? {
        val x = lonToTileX(lon, zoom)
        val y = latToTileY(lat, zoom)
        val url = "https://tile.openstreetmap.org/$zoom/$x/$y.png"
        val request = Request.Builder()
            .url(url)
            // OSM's public tile server blocks/throttles requests without a
            // descriptive User-Agent (same lesson learned server-side for
            // the Overpass API — see server/src/game/comic_map.js).
            .header("User-Agent", "craftworks-ar-ops-wear/1.0")
            .build()
        return try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) return null
                resp.body?.bytes()?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            }
        } catch (e: Exception) {
            null
        }
    }
}
