package one.srz.aropswear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import one.srz.aropswear.model.GameState
import one.srz.aropswear.net.OsmTileFetcher
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

@Composable
fun RadarScreen(state: GameState) {
    var tileBitmap by remember { mutableStateOf<android.graphics.Bitmap?>(null) }

    // OSM fallback: only fetched while the phone hasn't sent any comic-map
    // features yet — mirrors the phone's own fallback order (comic map
    // first, plain OSM tiles if it's missing or was never generated).
    LaunchedEffect(state.hasComicMap, state.myLat, state.myLon) {
        val lat = state.myLat
        val lon = state.myLon
        if (!state.hasComicMap && lat != null && lon != null) {
            tileBitmap = withContext(Dispatchers.IO) { OsmTileFetcher.fetchTile(lat, lon) }
        }
    }

    Box(
        modifier = Modifier.fillMaxSize().background(ComicPalette.background),
        contentAlignment = Alignment.Center,
    ) {
        if (state.hasComicMap) {
            ComicRadarCanvas(state)
        } else {
            tileBitmap?.let {
                Image(bitmap = it.asImageBitmap(), contentDescription = null, modifier = Modifier.fillMaxSize())
            }
            Canvas(modifier = Modifier.fillMaxSize()) { drawOwnPositionAndContacts(state) }
        }

        val mm = state.remainingS / 60
        val ss = state.remainingS % 60
        Text(
            text = "${state.phase} · $mm:${ss.toString().padStart(2, '0')}",
            color = ComicPalette.gold,
            style = MaterialTheme.typography.caption2,
            modifier = Modifier.align(Alignment.TopCenter),
        )
    }
}

/**
 * Comic-styled schematic: flat building/path/water outlines around the
 * player, in the same color language as the phone's comic map — but no
 * 3D/tilt. A watch-sized Compose Canvas isn't the place to reproduce a
 * tilted GL render like the phone's; this keeps the visual identity instead
 * of the perspective.
 */
@Composable
private fun ComicRadarCanvas(state: GameState) {
    val myLat = state.myLat
    val myLon = state.myLon
    if (myLat == null || myLon == null) return
    val metersPerPixel = 0.5f // fixed zoom — no pinch/zoom on a radar this small

    Canvas(modifier = Modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height / 2f

        fun project(lat: Double, lon: Double): Offset {
            val dLat = (lat - myLat) * 111_320.0
            val dLon = (lon - myLon) * 111_320.0 * cos(Math.toRadians(myLat))
            return Offset(cx + (dLon / metersPerPixel).toFloat(), cy - (dLat / metersPerPixel).toFloat())
        }

        for (f in state.comicFeatures) {
            if (f.points.size < 2) continue
            val color = when (f.kind) {
                "building" -> ComicPalette.building
                "forest" -> ComicPalette.forest
                "water" -> ComicPalette.water
                "grass" -> ComicPalette.grass
                "path" -> ComicPalette.path
                else -> ComicPalette.road
            }
            val path = Path()
            val first = project(f.points.first().first, f.points.first().second)
            path.moveTo(first.x, first.y)
            for (p in f.points.drop(1)) {
                val o = project(p.first, p.second)
                path.lineTo(o.x, o.y)
            }
            drawPath(path, color = color, style = Stroke(width = 3f))
        }

        drawOwnPositionAndContacts(state)
    }
}

/**
 * Contacts are relative bearing/distance pings from the phone (matches the
 * privacy model — radar never leaks absolute enemy coordinates, see
 * server/src/game/arops.js actionArUsePerk), so they're drawn relative to
 * our own position marker, not reprojected through lat/lon like the comic
 * features above.
 */
private fun DrawScope.drawOwnPositionAndContacts(state: GameState) {
    val cx = size.width / 2f
    val cy = size.height / 2f
    val pxPerMeter = 2f
    for (c in state.contacts) {
        val rad = Math.toRadians(c.bearingDeg - (state.headingDeg ?: 0.0))
        val r = min(c.distanceM.toFloat() * pxPerMeter, size.minDimension / 2f - 10f)
        val x = cx + (sin(rad) * r).toFloat()
        val y = cy - (cos(rad) * r).toFloat()
        drawCircle(color = if (c.hot) ComicPalette.hot else ComicPalette.gold, radius = 6f, center = Offset(x, y))
    }
    drawCircle(color = ComicPalette.gold, radius = 8f, center = Offset(cx, cy))
}
