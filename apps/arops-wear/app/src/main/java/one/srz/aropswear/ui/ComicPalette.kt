package one.srz.aropswear.ui

import androidx.compose.ui.graphics.Color

/**
 * Mirrors apps/arops-mobile/src/components/ComicMapLayers.tsx's STYLE map —
 * no shared package between the JS/TS phone app and this Kotlin watch app,
 * so keep both in sync manually if the comic palette ever changes.
 */
object ComicPalette {
    val building = Color(0xFFE8A94C)
    val forest = Color(0xFF5FAE52)
    val water = Color(0xFF5AB4E0)
    val grass = Color(0xFFA8D66A)
    val path = Color(0xFFC9A86A)
    val road = Color(0xFF707070)
    val background = Color(0xFF0A0810)
    val gold = Color(0xFFF0C840)
    val hot = Color(0xFFFF2FD8)
}
