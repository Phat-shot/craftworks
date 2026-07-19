package one.srz.aropswear.ui

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import one.srz.aropswear.BuildConfig
import one.srz.aropswear.model.PairingRepository

/**
 * Shown until the phone scans our QR code and claims us (see MainActivity,
 * which swaps this out for RadarScreen once claimed).
 */
@Composable
fun PairingScreen(onTapCode: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val token by PairingRepository.token.collectAsState()
    val qrBitmap = remember(token) { encodeQr(token, 280) }

    // The MessageClient push (GameStateListenerService receiving
    // "/arops/claim") can silently miss the watch if Wear OS killed the
    // app's process at the exact moment it arrived — poll the persistent
    // DataItem as a reliable fallback for as long as this screen is showing.
    // Restarts (so it checks immediately, not just every 5s) whenever the
    // token changes, e.g. right after tapping the code and getting a fresh one.
    LaunchedEffect(token) {
        while (isActive) {
            PairingRepository.checkClaimViaDataLayer(context)
            delay(5000)
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            bitmap = qrBitmap.asImageBitmap(),
            contentDescription = null,
            // Tap: still check RIGHT NOW whether the phone already wrote a
            // claim for this token (don't just wait for the next 5s poll —
            // if one's there, PairingRepository.tryClaim flips `claimed` and
            // MainActivity's own claimed-effect swaps to the LIVE
            // RadarScreen). But the tap's main, immediate job is now a debug
            // preview: jump to RadarScreen right away regardless of whether
            // a claim was found, showing either live data (if one was) or
            // the screen's own empty/no-data fallback — lets you check the
            // watch's own compass/radar rendering without needing a real
            // phone pairing first. Long-press on RadarScreen still gets you
            // back here (see ui/RadarScreen.kt).
            modifier = Modifier.size(170.dp).clickable {
                scope.launch { PairingRepository.checkClaimViaDataLayer(context) }
                onTapCode()
            },
        )
        Text(
            text = "Scannen · Tippen = Radar-Vorschau",
            color = ComicPalette.gold,
            style = MaterialTheme.typography.caption2,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            text = "v${BuildConfig.VERSION_NAME}",
            color = ComicPalette.gold.copy(alpha = 0.45f),
            style = MaterialTheme.typography.caption3,
        )
    }
}

private fun encodeQr(text: String, size: Int): Bitmap {
    val writer = QRCodeWriter()
    val bitMatrix = writer.encode(text, BarcodeFormat.QR_CODE, size, size)
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
    for (x in 0 until size) {
        for (y in 0 until size) {
            bmp.setPixel(x, y, if (bitMatrix[x, y]) Color.BLACK else Color.WHITE)
        }
    }
    return bmp
}
