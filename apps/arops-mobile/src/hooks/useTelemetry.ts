// Fuses expo-location position + compass heading into TelemetrySamples.
// Sends at ~1 Hz over the game socket; exposes the latest sample for
// UI and for hit-trigger snapshots (camera shutter grabs current sample).
import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';
import type { Socket } from 'socket.io-client';
import type { TelemetrySample } from '@craftworks/arops-shared';

export interface TelemetryState {
  granted: boolean | null;
  sample: TelemetrySample | null;
  /** Live compass heading (throttled ~4 Hz) for rotated map / AR views. */
  heading: number | null;
  /** Server's last geofence verdict for our own position. */
  geofence: 'inside' | 'warning' | 'outside' | null;
}

export function useTelemetry(socket: Socket | null, sessionId: string | null): TelemetryState & {
  /** Snapshot of the current fused sample — call at camera-trigger time. */
  snapshot: () => TelemetrySample | null;
  /** Manually tear down + recreate the compass subscription (retry button). */
  retryHeading: () => void;
} {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [sample, setSample] = useState<TelemetrySample | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const lastHeadingEmit = useRef(0);
  const [geofence, setGeofence] = useState<TelemetryState['geofence']>(null);

  const posRef = useRef<Location.LocationObject | null>(null);
  const headingRef = useRef<number | null>(null);
  const sampleRef = useRef<TelemetrySample | null>(null);

  const buildSample = useCallback((): TelemetrySample | null => {
    const p = posRef.current;
    if (!p) return null;
    return {
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      ts: Date.now(),
      accuracyM: p.coords.accuracy ?? 30,
      headingDeg: headingRef.current,
      speedMps: p.coords.speed ?? null,
    };
  }, []);

  const lastHeadingAt = useRef(0);
  const headingRetries = useRef(0);
  const startHeadingRef = useRef<() => Promise<void>>(async () => {});

  // Permissions + watchers
  useEffect(() => {
    let posSub: Location.LocationSubscription | null = null;
    let headSub: Location.LocationSubscription | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startHeading = async () => {
      headSub?.remove();
      headSub = await Location.watchHeadingAsync((h) => {
        if (cancelled) return;
        lastHeadingAt.current = Date.now();
        headingRetries.current = 0;
        // trueHeading is -1 when unavailable → fall back to magnetic
        const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        headingRef.current = deg;
        // Throttled state for UI rotation (~4 Hz)
        const t = Date.now();
        if (t - lastHeadingEmit.current > 250) {
          lastHeadingEmit.current = t;
          setHeading(deg);
        }
      });
    };
    startHeadingRef.current = async () => {
      headingRetries.current = 0;
      lastHeadingAt.current = Date.now();
      await startHeading();
    };

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setGranted(status === 'granted');
      if (status !== 'granted') return;

      // Kickstart with an immediate one-shot fix in parallel — watchPositionAsync's
      // first callback can take a while to arrive, so without this the player's own
      // position (and the map dot) can stay empty for a long stretch after match start.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then(loc => { if (!cancelled && !posRef.current) posRef.current = loc; })
        .catch(() => {});

      // High (not BestForNavigation): comparable few-meter accuracy but noticeably
      // faster/more reliable continuous fixes in practice — BestForNavigation was
      // observed to stall for a long time on some devices.
      posSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
        (loc) => { posRef.current = loc; }
      );

      lastHeadingAt.current = Date.now();
      await startHeading();

      // expo-location's heading watcher is known to occasionally never deliver a
      // single callback on some Android devices (while the OS's own compass, e.g.
      // in Google Maps, works fine) — a silent, dead subscription rather than an
      // error. Since there's no failure event to react to, we just notice the
      // silence and tear down + recreate the subscription, a few times, instead
      // of leaving the user stuck on a permanently blank compass.
      watchdog = setInterval(() => {
        if (cancelled) return;
        const silentMs = Date.now() - lastHeadingAt.current;
        if (silentMs > 4000 && headingRetries.current < 5) {
          headingRetries.current += 1;
          startHeading();
        }
      }, 4000);
    })();

    return () => {
      cancelled = true;
      posSub?.remove();
      headSub?.remove();
      if (watchdog) clearInterval(watchdog);
    };
  }, []);

  // 1 Hz send loop
  useEffect(() => {
    if (!socket || !sessionId) return;
    const iv = setInterval(() => {
      const s = buildSample();
      if (!s) return;
      sampleRef.current = s;
      setSample(s);
      socket.emit('game:action', { sessionId, action: 'ar_telemetry', data: { sample: s } });
    }, 1000);

    const onResult = (r: any) => {
      if (r?.action === 'ar_telemetry' && r.ok && r.geofence) setGeofence(r.geofence);
    };
    socket.on('game:action_result', onResult);
    return () => { clearInterval(iv); socket.off('game:action_result', onResult); };
  }, [socket, sessionId, buildSample]);

  return {
    granted, sample, heading, geofence,
    snapshot: () => sampleRef.current ?? buildSample(),
    retryHeading: () => { startHeadingRef.current(); },
  };
}
