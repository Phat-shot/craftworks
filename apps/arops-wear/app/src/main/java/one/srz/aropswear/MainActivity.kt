package one.srz.aropswear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.wear.compose.material.MaterialTheme
import one.srz.aropswear.model.GameStateRepository
import one.srz.aropswear.model.PairingRepository
import one.srz.aropswear.sensors.WatchCompass
import one.srz.aropswear.ui.PairingScreen
import one.srz.aropswear.ui.RadarScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                val claimed by PairingRepository.claimed.collectAsState()
                if (claimed) {
                    val state by GameStateRepository.state.collectAsState()
                    RadarScreen(state)
                } else {
                    PairingScreen()
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
