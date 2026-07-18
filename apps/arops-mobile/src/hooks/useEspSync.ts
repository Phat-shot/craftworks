// Bridges the AR Ops IR-ID-beacon ESP32 (wired USB-C bench link, see
// hardware/esp32-ir/) into the app for workbench testing only — the beacon
// itself runs standalone off any USB power source once flashed, no data
// connection while it's actually worn/played with (see useIrScan.ts for the
// real gameplay path: camera-based decoding of the beacon's blink pattern).
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectEsp, disconnectEsp, pingEsp, addEspStatusListener } from 'esp-bridge';

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

  const ping = useCallback(() => {
    if (!connected) return;
    pingEsp().catch(() => {});
  }, [connected]);

  return { connected, lastHeartbeatAt, connect, disconnect, ping };
}
