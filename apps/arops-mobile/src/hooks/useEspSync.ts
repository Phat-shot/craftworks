// Bridges the AR Ops IR-fire ESP32 companion (wired USB-C, see
// hardware/esp32-ir/) into the app — the phone-side counterpart to
// useWatchSync.ts, same shape (connected/fire), different transport (USB
// serial instead of the Wear OS Data Layer).
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectEsp, disconnectEsp, fireEsp, addEspStatusListener } from 'esp-bridge';

export function useEspSync() {
  const [connected, setConnected] = useState(false);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<number | null>(null);
  const connectingRef = useRef(false);

  useEffect(() => {
    const sub = addEspStatusListener(e => {
      setConnected(e.connected);
      if (e.connected) setLastHeartbeatAt(Date.now());
    });
    return () => sub.remove();
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    if (connectingRef.current) return false;
    connectingRef.current = true;
    try {
      const ok = await connectEsp();
      setConnected(ok);
      return ok;
    } catch {
      return false;
    } finally {
      connectingRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectEsp().catch(() => {});
  }, []);

  // Fire-and-forget, like the watch's push() — a dropped command just means
  // no physical flash this one time, never worth blocking the shoot action for.
  const fire = useCallback(() => {
    if (!connected) return;
    fireEsp().catch(() => {});
  }, [connected]);

  return { connected, lastHeartbeatAt, connect, disconnect, fire };
}
