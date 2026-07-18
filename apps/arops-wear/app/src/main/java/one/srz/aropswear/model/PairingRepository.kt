package one.srz.aropswear.model

import android.content.Context
import android.content.SharedPreferences
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
 *
 * `claimed` is persisted to disk (unlike GameStateRepository, which is fine
 * staying purely in-memory since the phone re-pushes state every 2s while
 * paired). Reason: Wear OS aggressively kills the app's background process,
 * and the claim confirmation is a ONE-OFF message — GameStateListenerService
 * can easily receive it in a short-lived process that dies again before
 * MainActivity ever reads the in-memory flag, silently losing the pairing
 * and leaving the watch stuck showing the QR code again despite the phone
 * already considering it paired. init() must run before any claim can land,
 * so both MainActivity and GameStateListenerService call it on startup.
 */
object PairingRepository {
    private const val PREFS_NAME = "pairing"
    private const val KEY_CLAIMED = "claimed"
    private var prefs: SharedPreferences? = null

    private val _token = MutableStateFlow(UUID.randomUUID().toString())
    val token = _token.asStateFlow()

    private val _claimed = MutableStateFlow(false)
    val claimed = _claimed.asStateFlow()

    /** Idempotent — only the first call in a given process actually touches
     *  SharedPreferences and applies the persisted value. */
    fun init(context: Context) {
        if (prefs != null) return
        val p = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs = p
        _claimed.value = p.getBoolean(KEY_CLAIMED, false)
    }

    /** Call when returning to the pairing screen (e.g. after a match ends,
     *  or via the long-press "neu koppeln" escape hatch on RadarScreen) so a
     *  stale QR code can't be scanned to rejoin an old session — and so a
     *  persisted `claimed=true` from a previous pairing doesn't strand the
     *  watch on RadarScreen forever with no way back to the QR code. */
    fun regenerateToken() {
        _token.value = UUID.randomUUID().toString()
        setClaimed(false)
    }

    fun tryClaim(scannedToken: String): Boolean {
        if (scannedToken == _token.value) {
            setClaimed(true)
            return true
        }
        return false
    }

    private fun setClaimed(value: Boolean) {
        _claimed.value = value
        prefs?.edit()?.putBoolean(KEY_CLAIMED, value)?.apply()
    }
}
