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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import one.srz.aropswear.model.PairingRepository

/**
 * Shown until the phone scans our QR code and claims us (see MainActivity,
 * which swaps this out for RadarScreen once claimed). Tap the code to get a
 * fresh one — useful if the phone's scan attempt failed (e.g. the code
 * scrolled off screen mid-scan) or you want to pair a different phone.
 */
@Composable
fun PairingScreen() {
    val token by PairingRepository.token.collectAsState()
    val qrBitmap = remember(token) { encodeQr(token, 280) }

    Column(
        modifier = Modifier.fillMaxSize().padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            bitmap = qrBitmap.asImageBitmap(),
            contentDescription = null,
            modifier = Modifier.size(190.dp).clickable { PairingRepository.regenerateToken() },
        )
        Text(
            text = "Scannen zum Koppeln",
            color = ComicPalette.gold,
            style = MaterialTheme.typography.caption1,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            text = "Tippen = neuer Code",
            color = ComicPalette.gold,
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
