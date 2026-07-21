package one.srz.aropswear.model

import android.content.Context
import android.content.SharedPreferences
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
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
    private const val KEY_TOKEN = "token"
    private var prefs: SharedPreferences? = null

    // Reported bug: phone showed pairing SUCCESS (its message/data write
    // genuinely reached a connected node — watch's own DebugScreen agreed,
    // "Handy erreichbar: ja") yet the watch stayed on "Gekoppelt: nein".
    // Root cause: this token was only ever an in-memory random UUID, never
    // persisted like `claimed` below already is. `object` singletons
    // re-run their property initializers whenever the process that hosts
    // them restarts — and per this file's own longstanding comments, Wear
    // OS aggressively kills the app's process, then respawns
    // GameStateListenerService in a FRESH, Activity-less process just to
    // handle one incoming message. If that respawn happened between
    // showing the QR code and the claim arriving, this object reinitialized
    // with a BRAND NEW random token — permanently mismatching whatever code
    // was actually displayed and scanned, with no error on either side:
    // the phone's send genuinely succeeded, the watch's comparison just
    // silently failed against a token that had quietly changed underneath
    // it. Persisting it the same way `claimed` already is closes that gap.
    private val _token = MutableStateFlow(UUID.randomUUID().toString())
    val token = _token.asStateFlow()

    private val _claimed = MutableStateFlow(false)
    val claimed = _claimed.asStateFlow()

    // Diagnostic only (shown on ui/DebugScreen.kt) — the phone has
    // consistently reported a successful claim while the watch keeps
    // showing unclaimed, with two rounds of fixes (connectivity
    // false-positive, then token persistence) not resolving it. Rather
    // than guess a third time, surface exactly what token a REJECTED claim
    // attempt actually carried, side by side with what this watch expects
    // — an empty/absent value here despite the phone reporting success
    // means the message never arrives at all (a transport-level problem,
    // not a token mismatch); a present-but-different value confirms an
    // actual mismatch and rules the transport out entirely.
    private val _lastRejectedToken = MutableStateFlow<String?>(null)
    val lastRejectedToken = _lastRejectedToken.asStateFlow()

    /** Idempotent — only the first call in a given process actually touches
     *  SharedPreferences and applies the persisted value. */
    fun init(context: Context) {
        if (prefs != null) return
        val p = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs = p
        _claimed.value = p.getBoolean(KEY_CLAIMED, false)
        val savedToken = p.getString(KEY_TOKEN, null)
        if (savedToken != null) {
            _token.value = savedToken
        } else {
            // First ever launch in this install — nothing to restore yet,
            // persist the freshly-generated one so the NEXT process
            // (however it gets spun up) agrees with what's on screen now.
            p.edit().putString(KEY_TOKEN, _token.value).apply()
        }
    }

    /** Call when returning to the pairing screen (e.g. after a match ends,
     *  or via the long-press "neu koppeln" escape hatch on RadarScreen) so a
     *  stale QR code can't be scanned to rejoin an old session — and so a
     *  persisted `claimed=true` from a previous pairing doesn't strand the
     *  watch on RadarScreen forever with no way back to the QR code. */
    fun regenerateToken() {
        _token.value = UUID.randomUUID().toString()
        prefs?.edit()?.putString(KEY_TOKEN, _token.value)?.apply()
        setClaimed(false)
    }

    fun tryClaim(scannedToken: String): Boolean {
        if (scannedToken == _token.value) {
            setClaimed(true)
            return true
        }
        _lastRejectedToken.value = scannedToken
        return false
    }

    /**
     * Pull-based fallback for the "/arops/claim" MessageClient push (see
     * GameStateListenerService) — messages can silently miss the watch if
     * Wear OS killed the app's process at the exact moment one arrived.
     * DataItems are actively kept in sync by Play Services in the
     * background, so polling the local cache here doesn't depend on a push
     * having been delivered right when it was sent; the phone writes it via
     * WearBridgeModule.putClaim. Safe to call repeatedly (PairingScreen
     * polls this every few seconds while unclaimed).
     */
    suspend fun checkClaimViaDataLayer(context: Context): Boolean = withContext(Dispatchers.IO) {
        try {
            // getDataItems(Uri) with no explicit filter type defaults to
            // FILTER_LITERAL (exact match) — "*" is only a documented
            // wildcard in a manifest's android:host, NOT here, so this was
            // very likely never matching a single real DataItem (whose
            // host is always an actual node ID once synced) regardless of
            // whether the phone's write itself succeeded. The unfiltered,
            // zero-arg overload plus a client-side path check is
            // unambiguous — it can't silently no-op on a URI-matching
            // technicality.
            val buffer = Tasks.await(Wearable.getDataClient(context).dataItems)
            var claimed = false
            for (item in buffer) {
                if (item.uri.path != "/arops/claim") continue
                val map = DataMapItem.fromDataItem(item.freeze()).dataMap
                val scanned = map.getString("token")
                if (scanned != null && tryClaim(scanned)) claimed = true
            }
            buffer.release()
            claimed
        } catch (e: Exception) {
            false
        }
    }

    private fun setClaimed(value: Boolean) {
        _claimed.value = value
        prefs?.edit()?.putBoolean(KEY_CLAIMED, value)?.apply()
    }
}
