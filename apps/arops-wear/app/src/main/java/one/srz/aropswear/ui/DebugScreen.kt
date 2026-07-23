package one.srz.aropswear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import one.srz.aropswear.BuildConfig
import one.srz.aropswear.model.GameStateRepository
import one.srz.aropswear.model.PairingRepository

/**
 * Debug/connection-info screen — reached by tapping RadarScreen (see
 * MainActivity's screen cycle: QR tap -> radar (live data, or the empty
 * fallback if unclaimed/no push yet) -> tap -> here -> tap -> back to the
 * QR code). Shows what "connected" means in this app: paired via QR claim,
 * whether a phone node is currently reachable over the Wear OS Data Layer,
 * and how stale the last match-state push is.
 */
@Composable
fun DebugScreen(onTap: () -> Unit) {
    val context = LocalContext.current
    val claimed by PairingRepository.claimed.collectAsState()
    val token by PairingRepository.token.collectAsState()
    val lastRejectedToken by PairingRepository.lastRejectedToken.collectAsState()
    val state by GameStateRepository.state.collectAsState()

    // -1 = still checking, -2 = check failed, otherwise the connected-node count.
    var nodeCount by remember { mutableStateOf(-1) }
    LaunchedEffect(Unit) {
        nodeCount = try {
            withContext(Dispatchers.IO) {
                Tasks.await(Wearable.getNodeClient(context).connectedNodes).size
            }
        } catch (e: Exception) {
            -2
        }
    }

    val lastUpdateText = if (state.updatedAtMs == 0L) {
        "noch keine Daten"
    } else {
        "vor ${(System.currentTimeMillis() - state.updatedAtMs) / 1000}s"
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(8.dp).clickable { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "Verbindung",
            color = ComicPalette.gold,
            style = MaterialTheme.typography.caption2,
        )
        Text(
            text = "Gekoppelt: ${if (claimed) "ja" else "nein"}",
            color = ComicPalette.gold,
            style = MaterialTheme.typography.caption2,
        )
        Text(
            text = "Handy erreichbar: " + when {
                nodeCount == -1 -> "prüfe…"
                nodeCount == -2 -> "Fehler"
                nodeCount == 0 -> "nein"
                else -> "ja ($nodeCount)"
            },
            color = ComicPalette.gold,
            style = MaterialTheme.typography.caption2,
        )
        Text(
            text = "Letzte Daten: $lastUpdateText",
            color = ComicPalette.gold,
            style = MaterialTheme.typography.caption2,
        )
        Text(
            text = "Erwarteter Token: ${token.take(8)}…",
            color = ComicPalette.gold.copy(alpha = 0.7f),
            style = MaterialTheme.typography.caption3,
        )
        // Diagnostic for a reported "phone says paired, watch says nein"
        // mismatch — see PairingRepository.lastRejectedToken's own comment.
        // Absent (this line doesn't render) despite a phone that reports
        // success means the claim never physically arrives at all; present
        // AND different from the token above confirms an actual mismatch.
        lastRejectedToken?.let {
            Text(
                text = "Letzter abgelehnter Claim: ${it.take(8)}…",
                color = ComicPalette.hot,
                style = MaterialTheme.typography.caption3,
            )
        }
        Text(
            text = "Build ${BuildConfig.VERSION_NAME} · ${BuildConfig.COMMIT_SHA}",
            color = ComicPalette.gold.copy(alpha = 0.45f),
            style = MaterialTheme.typography.caption3,
        )
        Text(
            text = "Tippen = zurück zum Code",
            color = ComicPalette.gold.copy(alpha = 0.6f),
            style = MaterialTheme.typography.caption3,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
