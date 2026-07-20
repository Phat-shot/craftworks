// Fuses expo-location position + a tilt-compensated compass heading into
// TelemetrySamples. Sends at ~1 Hz over the game socket; exposes the latest
// sample for UI and for hit-trigger snapshots (camera shutter grabs current
// sample).
import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { Magnetometer, Accelerometer } from 'expo-sensors';
import type { EventSubscription } from 'expo-modules-core';
import {
  getCurrentLocation as getNativeLocation, startWatch as startNativeWatch,
  stopWatch as stopNativeWatch, addNativeLocationListener,
} from 'native-location';
import type { Socket } from 'socket.io-client';
import type { TelemetrySample } from '@craftworks/arops-shared';
import {
  tiltCompensatedHeadingDeg, TOP_EDGE_AXIS, CAMERA_FORWARD_AXIS,
} from '@craftworks/arops-shared';
import { withTimeout } from '../utils/withTimeout';

/** Minimal position shape both the expo-location (iOS) and native-location
 *  (Android) paths below normalize into, so buildSample() below doesn't
 *  need to know which one supplied it. */
interface RawFix { lat: number; lon: number; accuracyM: number | null; speedMps: number | null; }
const locToRawFix = (loc: Location.LocationObject): RawFix => ({
  lat: loc.coords.latitude, lon: loc.coords.longitude,
  accuracyM: loc.coords.accuracy, speedMps: loc.coords.speed,
});

export interface TelemetryState {
  granted: boolean | null;
  sample: TelemetrySample | null;
  /**
   * Heading of the BACK CAMERA's direction (throttled ~4 Hz) — the canonical
   * heading, used for aiming/hit-validation, since shooting only ever
   * happens through the camera (phone held upright, screen facing the
   * player). Only well-defined while the phone is roughly upright; null
   * while it's held flat (the camera then points at the ground).
   */
  heading: number | null;
  /**
   * Heading of the phone's TOP EDGE — only well-defined while held flat
   * (screen up), for rotating the flat map view in non-camera mode. Null
   * while the phone is upright (the top edge then points at the sky).
   */
  topEdgeHeadingDeg: number | null;
  /** Server's last geofence verdict for our own position. */
  geofence: 'inside' | 'warning' | 'outside' | null;
}

/**
 * @param enabled Gates the SENSOR side (GPS watch + magnetometer/accelerometer).
 *   Defaults to true (GameScreen's normal usage — starts cold when the game
 *   itself mounts). A prior attempt at warming this up earlier (hoisted to
 *   App.tsx, starting as soon as the Lobby screen is reachable) was reverted
 *   after it correlated with the whole app becoming unresponsive on a real
 *   device — root cause not confirmed, but this hook now only ever runs
 *   scoped to GameScreen's own lifetime again, same as before that attempt.
 *   Revisit warming this up earlier only with real-device verification.
 */
export function useTelemetry(socket: Socket | null, sessionId: string | null, enabled = true): TelemetryState & {
  /** Snapshot of the current fused sample — call at camera-trigger time. */
  snapshot: () => TelemetrySample | null;
  /** Manually tear down + recreate the compass sensors (retry button). */
  retryHeading: () => void;
  /** Manually tear down + recreate the GPS subscription (retry button). */
  retryPosition: () => void;
} {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [sample, setSample] = useState<TelemetrySample | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [topEdgeHeadingDeg, setTopEdgeHeadingDeg] = useState<number | null>(null);
  const lastHeadingEmit = useRef(0);
  const [geofence, setGeofence] = useState<TelemetryState['geofence']>(null);

  const posRef = useRef<RawFix | null>(null);
  const headingRef = useRef<number | null>(null);
  const sampleRef = useRef<TelemetrySample | null>(null);

  const buildSample = useCallback((): TelemetrySample | null => {
    const p = posRef.current;
    if (!p) return null;
    return {
      lat: p.lat,
      lon: p.lon,
      ts: Date.now(),
      accuracyM: p.accuracyM ?? 30,
      headingDeg: headingRef.current,
      speedMps: p.speedMps,
    };
  }, []);

  const lastHeadingAt = useRef(0);
  const headingRetries = useRef(0);
  const startHeadingRef = useRef<() => void>(() => {});
  const lastPosAt = useRef(0);
  const posRetries = useRef(0);
  const startPositionRef = useRef<() => Promise<void>>(async () => {});

  // Permissions + watchers
  useEffect(() => {
    if (!enabled) return;
    let posSub: Location.LocationSubscription | null = null;
    let nativeSub: EventSubscription | null = null;
    let magSub: ReturnType<typeof Magnetometer.addListener> | null = null;
    let accelSub: ReturnType<typeof Accelerometer.addListener> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const accelValRef = { x: 0, y: 0, z: 1 };
    const magValRef = { x: 0, y: 1, z: 0 };

    const recomputeHeading = () => {
      if (cancelled) return;
      lastHeadingAt.current = Date.now();
      headingRetries.current = 0;
      const camDeg = tiltCompensatedHeadingDeg(accelValRef, magValRef, CAMERA_FORWARD_AXIS);
      const topDeg = tiltCompensatedHeadingDeg(accelValRef, magValRef, TOP_EDGE_AXIS);
      // Canonical heading sent to the server / used for aiming: the camera's
      // direction, since a hit attempt only ever happens through the camera.
      headingRef.current = camDeg;
      const t = Date.now();
      if (t - lastHeadingEmit.current > 250) {
        lastHeadingEmit.current = t;
        setHeading(camDeg);
        setTopEdgeHeadingDeg(topDeg);
      }
    };

    const startHeading = () => {
      magSub?.remove();
      accelSub?.remove();
      Magnetometer.setUpdateInterval(100);
      Accelerometer.setUpdateInterval(100);
      magSub = Magnetometer.addListener((m) => { magValRef.x = m.x; magValRef.y = m.y; magValRef.z = m.z; recomputeHeading(); });
      accelSub = Accelerometer.addListener((a) => { accelValRef.x = a.x; accelValRef.y = a.y; accelValRef.z = a.z; recomputeHeading(); });
    };
    startHeadingRef.current = () => {
      headingRetries.current = 0;
      lastHeadingAt.current = Date.now();
      startHeading();
    };

    // watchPositionAsync's setup promise has no built-in timeout and can hang
    // indefinitely on some devices instead of resolving/rejecting. Without a
    // guard, the 4s-silence watchdog below would then fire startPosition()
    // again on top of the still-pending first call — two overlapping
    // watchPositionAsync setups racing to assign posSub, one of them
    // possibly getting leaked/never torn down. The guard serializes
    // automatic retries; a manual tap (retryPosition) always force-clears it
    // first so the user can never get stuck behind a permanently-stuck flag.
    let posStartInFlight = false;
    const startPosition = async () => {
      if (posStartInFlight) return;
      posStartInFlight = true;
      try {
        // Android: FusedLocationProviderClient directly (see modules/
        // native-location) instead of expo-location's watchPositionAsync —
        // the same wrapper repeatedly implicated in the lobby's own GPS
        // hangs (see LobbyScreen.tsx loadMyPosition's comments). iOS has no
        // native module here (Android-only) and keeps the expo-location
        // path below unchanged.
        if (Platform.OS === 'android') {
          nativeSub?.remove();
          // Kickstart with an immediate one-shot fix in parallel, same
          // reasoning as the iOS branch below — the watch's first callback
          // can take a moment to arrive.
          getNativeLocation()
            .then(fix => { if (!cancelled && fix) { posRef.current = { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM, speedMps: fix.speedMps }; lastPosAt.current = Date.now(); } })
            .catch(() => {});
          nativeSub = addNativeLocationListener(fix => {
            posRef.current = { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM, speedMps: fix.speedMps };
            lastPosAt.current = Date.now();
          });
          await startNativeWatch().catch(() => {});
          return;
        }

        posSub?.remove();
        // Kickstart with an immediate one-shot fix in parallel — watchPositionAsync's
        // first callback can take a while to arrive, so without this the player's own
        // position (and the map dot) can stay empty for a long stretch after match start.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then(loc => { if (!cancelled) { posRef.current = locToRawFix(loc); lastPosAt.current = Date.now(); } })
          .catch(() => {});

        // High (not BestForNavigation): comparable few-meter accuracy but noticeably
        // faster/more reliable continuous fixes in practice — BestForNavigation was
        // observed to stall for a long time on some devices.
        posSub = await withTimeout(
          Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
            (loc) => { posRef.current = locToRawFix(loc); lastPosAt.current = Date.now(); }
          ),
          10_000
        );
      } catch {
        // Swallowed — the silence watchdog below notices no position ever
        // arrived and retries.
      } finally {
        posStartInFlight = false;
      }
    };
    startPositionRef.current = async () => {
      posRetries.current = 0;
      lastPosAt.current = Date.now();
      posStartInFlight = false;
      await startPosition();
    };

    (async () => {
      // requestForegroundPermissionsAsync has no built-in timeout and can
      // hang indefinitely on some devices (same class of bug fixed in the
      // lobby's own GPS flow, see LobbyScreen.tsx loadMyPosition) — left
      // unguarded, `granted` would stay null forever and this whole effect
      // (including the watchdog below) would never even get set up, with no
      // recovery path at all. A bare timeout->false would be worse: `granted
      // === false` renders GameScreen's permanent "no permission" dead-end
      // below with no retry, which would be wrong for a merely slow OS call.
      // So: keep retrying the request itself (bounded per attempt, unbounded
      // overall) until it actually settles one way or the other — mirrors
      // this hook's existing "never permanently give up automatically"
      // philosophy for position/heading retries below.
      let status: Location.PermissionStatus | null = null;
      while (!cancelled && status === null) {
        const r = await withTimeout(Location.requestForegroundPermissionsAsync(), 15_000).catch(() => null);
        if (r) status = r.status;
      }
      if (cancelled) return;
      setGranted(status === 'granted');
      if (status !== 'granted') return;

      lastPosAt.current = Date.now();
      lastHeadingAt.current = Date.now();
      // Not awaited: if the position setup call itself hangs (rather than
      // just staying silent afterward), the watchdog below must still start —
      // otherwise a hung setup call would block position AND the recovery
      // mechanism forever. Heading sensors start synchronously (no await
      // needed at all — expo-sensors' addListener doesn't return a promise).
      startPosition();
      startHeading();

      // expo-location's position watcher is known to occasionally never
      // deliver a single callback on some Android devices (while the OS's
      // own GPS, e.g. in Google Maps, works fine) — a silent, dead
      // subscription rather than an error. Since there's no failure event to
      // react to, we just notice the silence and tear down + recreate the
      // subscription instead of leaving the player stuck with no position
      // and no feedback. The magnetometer/accelerometer are a much
      // lower-level API than the old heading watcher, but get the same
      // safety net in case a given device's sensor stack still stalls.
      // Retries indefinitely — never permanently gives up on its own (a
      // capped retry count meant the player had to notice it was stuck and
      // manually tap retryPosition/retryHeading; this way the status
      // banners in the UI are purely informational, not something the
      // player has to act on to keep the recovery going).
      watchdog = setInterval(() => {
        if (cancelled) return;
        if (Date.now() - lastHeadingAt.current > 4000) {
          headingRetries.current += 1;
          startHeading();
        }
        if (Date.now() - lastPosAt.current > 4000) {
          posRetries.current += 1;
          startPosition();
        }
      }, 4000);
    })();

    return () => {
      cancelled = true;
      posSub?.remove();
      nativeSub?.remove();
      if (Platform.OS === 'android') stopNativeWatch().catch(() => {});
      magSub?.remove();
      accelSub?.remove();
      if (watchdog) clearInterval(watchdog);
    };
  }, [enabled]);

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
    granted, sample, heading, topEdgeHeadingDeg, geofence,
    snapshot: () => sampleRef.current ?? buildSample(),
    retryHeading: () => { startHeadingRef.current(); },
    retryPosition: () => { startPositionRef.current(); },
  };
}
