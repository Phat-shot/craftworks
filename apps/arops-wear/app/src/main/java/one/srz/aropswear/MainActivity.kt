package one.srz.aropswear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.wear.compose.material.MaterialTheme
import one.srz.aropswear.model.GameStateRepository
import one.srz.aropswear.model.PairingRepository
import one.srz.aropswear.sensors.WatchCompass
import one.srz.aropswear.ui.DebugScreen
import one.srz.aropswear.ui.PairingScreen
import one.srz.aropswear.ui.RadarScreen

// Independent of `claimed` on purpose — QR-tap now shows RadarScreen as a
// debug preview (empty if there's no real pairing/data yet), so screen
// choice can no longer be a pure `if (claimed)` derivation like before.
private enum class Screen { PAIRING, RADAR, DEBUG }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PairingRepository.init(this)
        setContent {
            MaterialTheme {
                val claimed by PairingRepository.claimed.collectAsState()
                var screen by remember { mutableStateOf(if (claimed) Screen.RADAR else Screen.PAIRING) }

                // A REAL pairing completing always wins over whatever the user
                // was manually peeking at (QR-tap preview, debug screen) — jump
                // straight to the live HUD, matching the old unconditional
                // `if (claimed)` behavior for this one direction.
                LaunchedEffect(claimed) {
                    if (claimed) screen = Screen.RADAR
                }

                when (screen) {
                    Screen.PAIRING -> PairingScreen(onTapCode = { screen = Screen.RADAR })
                    Screen.RADAR -> {
                        val state by GameStateRepository.state.collectAsState()
                        RadarScreen(
                            state,
                            claimed = claimed,
                            onTap = { screen = Screen.DEBUG },
                            onLongPress = { screen = Screen.PAIRING },
                        )
                    }
                    Screen.DEBUG -> DebugScreen(onTap = { screen = Screen.PAIRING })
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        WatchCompass.start(this)
    }

    override fun onPause() {
        WatchCompass.stop()
        super.onPause()
    }
}
