package one.srz.aropswear.model

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/**
 * One-time QR pairing handshake: the watch shows a random token as a QR
 * code (see ui/PairingScreen.kt); once the phone scans it and echoes it
 * back over Data Layer path "/arops/claim" (see
 * GameStateListenerService.onMessageReceived), the watch switches from
 * showing the code to showing the live HUD. No server round-trip involved —
 * the token only needs to be unguessable for as long as it's on screen, a
 * local random UUID is enough for that.
 */
object PairingRepository {
    private val _token = MutableStateFlow(UUID.randomUUID().toString())
    val token = _token.asStateFlow()

    private val _claimed = MutableStateFlow(false)
    val claimed = _claimed.asStateFlow()

    /** Call when returning to the pairing screen (e.g. after a match ends)
     *  so a stale QR code can't be scanned to rejoin an old session. */
    fun regenerateToken() {
        _token.value = UUID.randomUUID().toString()
        _claimed.value = false
    }

    fun tryClaim(scannedToken: String): Boolean {
        if (scannedToken == _token.value) {
            _claimed.value = true
            return true
        }
        return false
    }
}
