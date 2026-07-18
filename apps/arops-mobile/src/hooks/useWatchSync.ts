// Bridges match state to a paired Wear OS watch (see apps/arops-wear/) via
// the phone-side native module (modules/wear-bridge). The watch has no
// account/session of its own — pairing is a one-time QR handshake: the
// watch displays a random token as a QR code, the phone scans it and sends
// that same token back over "/arops/claim"; only once the watch confirms a
// match does it switch from its pairing screen to showing the HUD (see
// GameStateListenerService.kt + PairingRepository.kt on the watch).
import { useCallback, useRef, useState } from 'react';
import { sendToWatch, putClaimOnWatch } from 'wear-bridge';

export function useWatchSync() {
  const [paired, setPaired] = useState(false);
  const pushingRef = useRef(false);

  const claim = useCallback(async (scannedToken: string): Promise<boolean> => {
    // Two paths, belt-and-suspenders: the MessageClient push is instant if
    // it lands, but Wear OS can kill the watch app's process in the exact
    // moment it arrives and silently drop it. The DataItem write is the
    // reliable fallback the watch polls every few seconds for (see
    // PairingRepository.checkClaimViaDataLayer on the watch side).
    try {
      const [msgOk, dataOk] = await Promise.all([
        sendToWatch('/arops/claim', { token: scannedToken }).catch(() => false),
        putClaimOnWatch(scannedToken).catch(() => false),
      ]);
      const ok = msgOk || dataOk;
      setPaired(ok);
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
