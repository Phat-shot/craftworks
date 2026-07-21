// Bridges match state to a paired Wear OS watch (see apps/arops-wear/) via
// the phone-side native module (modules/wear-bridge). The watch has no
// account/session of its own — pairing is a one-time QR handshake: the
// watch displays a random token as a QR code, the phone scans it and sends
// that same token back over "/arops/claim"; only once the watch confirms a
// match does it switch from its pairing screen to showing the HUD (see
// GameStateListenerService.kt + PairingRepository.kt on the watch).
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendToWatch, putClaimOnWatch, hasConnectedWatch } from 'wear-bridge';

// Pairing is meant to be a ONE-TIME handshake (see module doc-comment
// above) — the watch side already persists `claimed` to disk (see
// PairingRepository.kt) specifically so it survives Wear OS killing its
// process. `paired` here used to be plain useState(false), so it silently
// reset to false on every phone app restart despite the watch still
// considering itself claimed — GameScreen's push effect gates on `paired`,
// so this meant the watch stopped receiving any state at all after the
// very next app restart, with nothing on the phone side telling the user
// to re-pair (looked like the watch companion had simply stopped working).
const PAIRED_KEY = 'watch_paired';

export function useWatchSync() {
  const [paired, setPaired] = useState(false);
  const pushingRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(PAIRED_KEY).then(v => { if (v === '1') setPaired(true); }).catch(() => {});
  }, []);

  const claim = useCallback(async (scannedToken: string): Promise<boolean> => {
    // Two paths, belt-and-suspenders: the MessageClient push is instant if
    // it lands, but Wear OS can kill the watch app's process in the exact
    // moment it arrives and silently drop it. The DataItem write is the
    // reliable fallback the watch polls every few seconds for (see
    // PairingRepository.checkClaimViaDataLayer on the watch side).
    //
    // Reported symptom: scanning the QR shows "paired" in the app, but
    // NOTHING ever changes on the watch, not even once a match starts and
    // real state pushes begin — the signature of putClaimOnWatch's DataItem
    // write "succeeding" with zero actually-connected nodes (it's a local
    // write Play Services buffers for whenever a node connects, which can
    // be never). `ok = msgOk || dataOk` let that local-only success alone
    // report "paired", hiding the real problem (no Bluetooth/companion
    // connection to any watch) behind a false positive. hasConnectedWatch()
    // is the actual connectivity signal — require it too.
    try {
      const [msgOk, dataOk, hasNode] = await Promise.all([
        sendToWatch('/arops/claim', { token: scannedToken }).catch(() => false),
        putClaimOnWatch(scannedToken).catch(() => false),
        hasConnectedWatch().catch(() => false),
      ]);
      const ok = hasNode && (msgOk || dataOk);
      setPaired(ok);
      if (ok) await AsyncStorage.setItem(PAIRED_KEY, '1').catch(() => {});
      return ok;
    } catch {
      return false;
    }
  }, []);

  // Fire-and-forget — a dropped push just means the watch shows slightly
  // stale data until the next one, never worth blocking or retrying for.
  const push = useCallback((payload: unknown) => {
    if (!paired || pushingRef.current) return;
    pushingRef.current = true;
    sendToWatch('/arops/state', payload)
      .catch(() => {})
      .finally(() => { pushingRef.current = false; });
  }, [paired]);

  return { paired, claim, push };
}
