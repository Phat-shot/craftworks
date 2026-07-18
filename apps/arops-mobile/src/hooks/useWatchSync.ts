// Bridges match state to a paired Wear OS watch (see apps/arops-wear/) via
// the phone-side native module (modules/wear-bridge). The watch has no
// account/session of its own — pairing is a one-time QR handshake: the
// watch displays a random token as a QR code, the phone scans it and sends
// that same token back over "/arops/claim"; only once the watch confirms a
// match does it switch from its pairing screen to showing the HUD (see
// GameStateListenerService.kt + PairingRepository.kt on the watch).
import { useCallback, useRef, useState } from 'react';
import { sendToWatch } from 'wear-bridge';

export function useWatchSync() {
  const [paired, setPaired] = useState(false);
  const pushingRef = useRef(false);

  const claim = useCallback(async (scannedToken: string): Promise<boolean> => {
    try {
      const ok = await sendToWatch('/arops/claim', { token: scannedToken });
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
