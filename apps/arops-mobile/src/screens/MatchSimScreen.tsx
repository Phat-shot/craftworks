// ═══════════════════════════════════════════════════════════
//  Match-Simulation — debug-only, fully automated on-device test harness.
//  Runs ~50 fixed, short (1-10s) scripted scenarios (SIM_SCENARIOS,
//  packages/arops-shared/src/simScript.ts — single source of truth also
//  used by the server's tickSimBots, see server/src/game/arops.js) as REAL
//  short-lived matches through the normal socket pipeline (lobby create/
//  update/start, game:join, game:action telemetry/hit-attempt,
//  game:ar_tick snapshots) — exactly the same code path GameScreen uses,
//  just with scripted positions instead of real GPS/compass, and no
//  warmup/base_setup wait (simulation sessions skip straight to 'live',
//  see arops.js). Each scenario's shot/checkpoint already carries a
//  known-correct expected outcome (cross-verified against the server
//  pipeline by server/test/arops_sim.test.js) — this screen's job is only
//  to confirm the CLIENT correctly drives a real match and gets the same
//  answer back, not to re-derive the geometry itself.
//  No configurable options anywhere — a fixed script, not a game mode.
// ═══════════════════════════════════════════════════════════
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { Magnetometer } from 'expo-sensors';
import { destinationPoint, squareFieldCorners, SIM_SCENARIOS } from '@craftworks/arops-shared';
import type { SimScenario, SimShootBeat, SimCheckpoint } from '@craftworks/arops-shared';
import { getSocket, getUser, createArLobby, getLastPosition, joinLobbyByCode } from '../api';
import Icon from '../components/Icon';
import { useTheme, ThemeTokens, THEMES } from '../theme';
import { OSM_STYLE, OSM_STYLE_DARK } from '../mapStyle';

interface SimSnap {
  phase: string;
  me: { status: string } | null;
  zones?: { owner?: string | null }[];
  events: { type: string; userId?: string; byUserId?: string }[];
  // Ground-truth positions — sim sessions force debugMode (see arops.js's
  // applySimOverrides), so fog-of-war never hides these. Used only for the
  // live map view, not for any check's pass/fail logic.
  players?: { userId: string; lat?: number; lon?: number }[];
}

interface CheckResult { snippetKey: string; label: string; pass: boolean; detail: string; }

const CHECK_MARGIN_MS = 1_500; // network/processing slack, plus tickSimBots' own ~1200ms tick granularity
const SHOT_RESULT_TIMEOUT_MS = 10_000; // generous real-device network/server latency — no fake clock here

function sleep(ms: number): Promise<void> { return new Promise(res => setTimeout(res, ms)); }

// Races a promise against a hard deadline — used so the sensor preflight
// (which can genuinely hang: expo-location's requestForegroundPermissionsAsync
// has no built-in timeout, see LobbyScreen.tsx's own hardened GPS code for
// the same documented risk) can never block the rest of the run. The
// underlying promise is left running regardless — if it eventually settles
// after the deadline, its result is simply discarded, it does not resolve
// this wrapper a second time.
function withHardTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(onTimeout()); } }, ms);
    promise.then(v => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } });
  });
}

const SENSOR_HARD_TIMEOUT_MS = 90_000;

/** Waits for a socket event, or a fallback timeout — used for the few
 *  places a short, real (not blind-sleep) wait matters: ar_update landing,
 *  and the sim_end cleanup ack. */
function waitForEvent(socket: ReturnType<typeof getSocket>, event: string, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const onEvent = () => { socket.off(event, onEvent); resolve(); };
    socket.once(event, onEvent);
    setTimeout(() => { socket.off(event, onEvent); resolve(); }, timeoutMs);
  });
}

// Arbitrary real-world anchor, only ever used as a last resort (see
// resolveOrigin) — never shown to the player, just needs to be a
// geometrically valid WGS84 point so squareFieldCorners/destinationPoint
// produce a sane polygon.
const FALLBACK_ORIGIN = { lat: 48.13743, lon: 11.57549 };

// The simulation must always be able to run, even with no GPS fix
// anywhere (emulator, indoors, freshly cleared app data) — prefers the
// Lobby's own live position, falls back to the device's last cached fix,
// and only as a last resort jitters a fixed default instead of failing
// the whole run with a "keine Position" error.
function resolveOrigin(passed: { lat: number; lon: number } | null): { lat: number; lon: number } {
  if (passed) return passed;
  const cached = getLastPosition();
  if (cached) return { lat: cached.lat, lon: cached.lon };
  const jitterDeg = (Math.random() - 0.5) * 0.2; // ± ~11km, plenty for a synthetic test field
  return { lat: FALLBACK_ORIGIN.lat + jitterDeg, lon: FALLBACK_ORIGIN.lon + jitterDeg };
}

function checkCheckpoint(cp: SimCheckpoint, snap: SimSnap | null): { pass: boolean; detail: string } {
  if (!snap) return { pass: false, detail: 'kein Snapshot empfangen' };
  const owner = snap.zones?.[cp.targetIndex]?.owner ?? null;
  return { pass: owner === cp.expected, detail: `Zone[${cp.targetIndex}].owner = ${owner} (erwartet ${cp.expected})` };
}

function checkBotShot(beat: SimShootBeat, myUserId: string, snap: SimSnap | null): { pass: boolean; detail: string } {
  if (!snap) return { pass: false, detail: 'kein Snapshot empfangen' };
  const gotHit = (snap.events || []).some(e =>
    ['player_downed', 'player_frozen', 'player_eliminated'].includes(e.type)
    && e.userId === myUserId && e.byUserId === beat.shooterId);
  return { pass: gotHit === beat.expectedHit, detail: `Treffer-Event von ${beat.shooterId} gefunden: ${gotHit}` };
}

// Runs one scripted scenario as a real (short) match end-to-end and
// returns every check's pass/fail. Never throws — a setup failure (lobby/
// start/timeout) is folded into a single failing result so one broken
// scenario doesn't abort the whole run.
async function runScenario(
  scenario: SimScenario, myUserId: string, origin: { lat: number; lon: number },
  onSnapshot: (snap: SimSnap) => void,
): Promise<CheckResult[]> {
  const fail = (detail: string): CheckResult[] => [{ snippetKey: scenario.key, label: scenario.label, pass: false, detail }];

  const socket = getSocket();
  let lobbyId: string;
  try {
    const lobby = await createArLobby(`Sim: ${scenario.label}`);
    lobbyId = lobby.lobbyId;
  } catch (e: any) {
    return fail(`Lobby konnte nicht erstellt werden: ${e?.message || e}`);
  }

  const polygon = squareFieldCorners(scenario.fieldSideM).map(w => destinationPoint(origin, w.bearingDeg, w.distanceM));
  socket.emit('lobby:join', { lobbyId });

  const results: CheckResult[] = [];
  let latestSnap: SimSnap | null = null;
  const onTick = (s: SimSnap) => { latestSnap = s; onSnapshot(s); };
  let telemetryTimer: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    socket.off('game:ar_tick', onTick);
    if (telemetryTimer) clearInterval(telemetryTimer);
  };

  try {
    const ar_updated = waitForEvent(socket, 'lobby:ar_updated', 3_000);
    socket.emit('lobby:ar_update', {
      lobbyId,
      arSettings: {
        polygon, simulation: true, simSnippetKey: scenario.key, debugMode: true,
      },
    });
    await ar_updated;

    const sessionId = await new Promise<string | null>(resolve => {
      const onStart = ({ sessionId }: { sessionId: string }) => resolve(sessionId);
      const onErr = () => resolve(null);
      socket.once('game:start', onStart);
      socket.once('error', onErr);
      socket.emit('lobby:start', { lobbyId });
      setTimeout(() => resolve(null), 10_000);
    });
    if (!sessionId) return fail('lobby:start lieferte kein game:start (Timeout oder Server-Fehler)');

    socket.emit('game:join', { sessionId });
    socket.on('game:ar_tick', onTick);

    const sample = () => ({
      lat: origin.lat, lon: origin.lon, ts: Date.now(), accuracyM: 3, headingDeg: scenario.testerHeadingDeg,
    });
    socket.emit('game:action', { sessionId, action: 'ar_telemetry', data: { sample: sample() } });
    telemetryTimer = setInterval(() => {
      socket.emit('game:action', { sessionId, action: 'ar_telemetry', data: { sample: sample() } });
    }, 1000);

    const testerShots = scenario.shoots.filter(b => b.shooterId === 'tester');
    const botShots = scenario.shoots.filter(b => b.shooterId !== 'tester');

    const shotPromises = testerShots.map(beat => new Promise<void>(resolve => {
      setTimeout(() => {
        const done = (r: any) => {
          const pass = !!r?.ok && r.hit === beat.expectedHit;
          const detail = r === null
            ? `keine Antwort innerhalb ${SHOT_RESULT_TIMEOUT_MS / 1000}s (Netzwerk/Server-Last?)`
            : r.ok ? `hit=${r.hit} reason=${r.reason || '–'} (erwartet ${beat.expectedHit})` : `abgelehnt: ${r.err}`;
          results.push({ snippetKey: scenario.key, label: `${scenario.label}: Schuss`, pass, detail });
          resolve();
        };
        const onResult = (r: any) => { if (r.action === 'ar_hit_attempt') { socket.off('game:action_result', onResult); done(r); } };
        socket.on('game:action_result', onResult);
        setTimeout(() => { socket.off('game:action_result', onResult); done(null); }, SHOT_RESULT_TIMEOUT_MS);
        socket.emit('game:action', {
          sessionId, action: 'ar_hit_attempt', data: { sample: sample(), targetId: beat.targetId },
        });
      }, beat.tMs);
    }));

    const checkPromises = [
      ...botShots.map(beat => new Promise<void>(resolve => {
        setTimeout(() => {
          const r = checkBotShot(beat, myUserId, latestSnap);
          results.push({ snippetKey: scenario.key, label: `${scenario.label}: Bot-Schuss`, pass: r.pass, detail: r.detail });
          resolve();
        }, beat.tMs + CHECK_MARGIN_MS);
      })),
      ...scenario.checkpoints.map(cp => new Promise<void>(resolve => {
        setTimeout(() => {
          const r = checkCheckpoint(cp, latestSnap);
          results.push({ snippetKey: scenario.key, label: `${scenario.label}: ${cp.check}`, pass: r.pass, detail: r.detail });
          resolve();
        }, cp.tMs + CHECK_MARGIN_MS);
      })),
    ];

    await Promise.all([...shotPromises, ...checkPromises]);
    // Actively tear the session down instead of leaving it to idle out its
    // own gameDurationMs. game:sim_end (server/src/socket/game.js) is a
    // narrowly-scoped self-cleanup event: it only ever works on a session
    // this same run flagged as ar_settings.simulation, so it can't be
    // repurposed to end a real match.
    const ended = waitForEvent(socket, 'game:sim_end_result', 3_000);
    socket.emit('game:sim_end', { sessionId });
    await ended;
  } finally {
    cleanup();
  }

  return results.length ? results : fail('Kein einziger Check ausgeführt');
}

// ── PRE-FLIGHT: sensors ──────────────────────────────────────
// Deliberately NOT reusing the useTelemetry() hook here — its own doc
// comment (apps/arops-mobile/src/hooks/useTelemetry.ts) records that an
// earlier attempt to keep it mounted outside GameScreen's own lifetime
// correlated with the whole app becoming unresponsive on a real device.
// This is a self-contained, short-lived GPS+compass check instead: same
// expo-location/expo-sensors primitives, but subscribed and torn down only
// for the duration of this one preflight phase, never left running.
const SENSOR_TEST_ATTEMPTS = 8;
const SENSOR_TEST_WINDOW_MS = 3_000; // 8×3s = 24s worst case, matches the Lobby screen's own established GPS-retry budget

async function runSensorTest(onProgress: (text: string) => void): Promise<CheckResult[]> {
  const label = 'Vorflug: Sensoren';
  onProgress('GPS-Berechtigung wird angefragt…');
  const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
  const granted = perm?.status === 'granted';
  if (!granted) {
    return [{ snippetKey: 'preflight', label: `${label}: GPS-Berechtigung`, pass: false, detail: perm ? `verweigert (${perm.status})` : 'Anfrage fehlgeschlagen' }];
  }

  let gotFix = false;
  let gotCompass = false;
  const magSub = Magnetometer.addListener(() => { gotCompass = true; });
  Magnetometer.setUpdateInterval(200);
  let posSub: Location.LocationSubscription | null = null;
  try {
    posSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 1000, distanceInterval: 0 },
      () => { gotFix = true; },
    );
  } catch { /* posSub stays null — the retry loop below just runs out and reports gotFix=false */ }

  for (let i = 0; i < SENSOR_TEST_ATTEMPTS && !(gotFix && gotCompass); i++) {
    onProgress(`Versuch ${i + 1}/${SENSOR_TEST_ATTEMPTS} — GPS: ${gotFix ? '✓' : 'suche…'}, Kompass: ${gotCompass ? '✓' : 'suche…'}`);
    await sleep(SENSOR_TEST_WINDOW_MS);
  }
  posSub?.remove();
  magSub.remove();

  return [
    { snippetKey: 'preflight', label: `${label}: GPS-Berechtigung`, pass: true, detail: 'erteilt' },
    {
      snippetKey: 'preflight', label: `${label}: GPS-Fix`, pass: gotFix,
      detail: gotFix ? 'Position empfangen' : `kein Fix nach ${SENSOR_TEST_ATTEMPTS * SENSOR_TEST_WINDOW_MS / 1000}s`,
    },
    {
      // Ambiguous by design if it fails: a magnetometer reading only ever
      // arrives while the phone isn't perfectly motionless/shielded — a
      // held-still phone on a table can legitimately produce zero deltas.
      // Documented here rather than treated as a hard sensor failure.
      snippetKey: 'preflight', label: `${label}: Kompass`, pass: gotCompass,
      detail: gotCompass ? 'Lesung empfangen' : 'keine Lesung (evtl. Handy lag still/abgeschirmt, oder Sensor fehlt)',
    },
  ];
}

// ── PRE-FLIGHT: code generation + join-by-code ───────────────
// Exercises the REST join-by-code path (POST /lobbies/join/:code via
// joinLobbyByCode, api.ts) the scenarios themselves never touch — they
// join their own freshly-created lobby directly over the socket since the
// host is auto-inserted into lobby_members at creation time. This lobby is
// deliberately never started (no lobby:start) — no session/worker is ever
// created, so there's nothing to actively clean up afterward; it just sits
// at status='waiting' like every other never-started lobby already does.
async function runCodeJoinTest(onProgress: (text: string) => void): Promise<CheckResult[]> {
  const label = 'Vorflug: Code/Beitritt';
  const results: CheckResult[] = [];
  onProgress('Lobby erstellen…');
  let lobby: { lobbyId: string; code: string };
  try {
    lobby = await createArLobby('Sim: Code/Join-Test');
  } catch (e: any) {
    return [{ snippetKey: 'preflight', label: `${label}: Lobby erstellen`, pass: false, detail: e?.message || String(e) }];
  }

  const codeOk = /^[A-Za-z0-9_-]{6,12}$/.test(lobby.code);
  results.push({ snippetKey: 'preflight', label: `${label}: Code erzeugt`, pass: codeOk, detail: `Code: ${lobby.code}` });

  onProgress(`Beitritt mit Code ${lobby.code}…`);
  try {
    const joined = await joinLobbyByCode(lobby.code);
    results.push({
      snippetKey: 'preflight', label: `${label}: Beitritt per Code`, pass: joined.lobbyId === lobby.lobbyId,
      detail: `lobbyId=${joined.lobbyId} (erwartet ${lobby.lobbyId})`,
    });
  } catch (e: any) {
    results.push({ snippetKey: 'preflight', label: `${label}: Beitritt per Code`, pass: false, detail: e?.message || String(e) });
  }

  onProgress('Ungültigen Code testen…');
  try {
    await joinLobbyByCode('ZZZZZZZZ');
    results.push({ snippetKey: 'preflight', label: `${label}: Ungültiger Code wird abgelehnt`, pass: false, detail: 'unerwartet akzeptiert' });
  } catch {
    results.push({ snippetKey: 'preflight', label: `${label}: Ungültiger Code wird abgelehnt`, pass: true, detail: 'korrekt abgelehnt' });
  }

  return results;
}

export default function MatchSimScreen({ origin, onExit }: { origin: { lat: number; lon: number } | null; onExit: () => void }) {
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [currentLabel, setCurrentLabel] = useState('');
  const [progress, setProgress] = useState('');
  const [sensorProgress, setSensorProgress] = useState('');
  const [results, setResults] = useState<CheckResult[]>([]);
  // Drives the live map — the scenario currently in flight (for its field/
  // bot layout) and the latest snapshot received for it (for live
  // positions). Cleared between scenarios so the map never shows a stale
  // field from the previous one while the next is still setting up.
  const [currentScenario, setCurrentScenario] = useState<SimScenario | null>(null);
  const [liveSnap, setLiveSnap] = useState<SimSnap | null>(null);
  const [mapOrigin, setMapOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const cancelRef = useRef(false);

  const start = async () => {
    setRunning(true);
    setDone(false);
    setResults([]);
    setProgress('');
    setSensorProgress('');
    cancelRef.current = false;
    const myUserId = getUser()?.id || '';
    // Resolved once per run (not per scenario) — every scenario's synthetic
    // field is anchored at the same point, see resolveOrigin's fallback
    // chain (Lobby's live GPS → last cached fix → jittered default).
    const resolvedOrigin = resolveOrigin(origin);
    setMapOrigin(resolvedOrigin);

    // Sensor detection runs in the BACKGROUND — nothing here has a hard
    // dependency on it (every scenario uses scripted, not real, positions),
    // so it must never block the rest of the run. A hard 90s deadline
    // ensures it always reports SOMETHING even if the underlying
    // expo-location call itself hangs (no built-in timeout there — see
    // LobbyScreen.tsx's own hardened GPS code for the same documented
    // risk). Results are merged in whenever they actually land.
    const sensorPromise = withHardTimeout(
      runSensorTest(setSensorProgress),
      SENSOR_HARD_TIMEOUT_MS,
      () => [{
        snippetKey: 'preflight', label: 'Vorflug: Sensoren', pass: false,
        detail: `Zeitüberschreitung nach ${SENSOR_HARD_TIMEOUT_MS / 1000}s — lief im Hintergrund weiter, hat den restlichen Testlauf nicht blockiert`,
      }],
    );
    sensorPromise.then(r => { setResults(prev => [...prev, ...r]); setSensorProgress(''); });

    setCurrentLabel('Vorflug: Code/Beitritt');
    const joinResults = await runCodeJoinTest(setProgress);
    setResults(prev => [...prev, ...joinResults]);
    setProgress('');

    for (let i = 0; i < SIM_SCENARIOS.length; i++) {
      if (cancelRef.current) break;
      const scenario = SIM_SCENARIOS[i]!;
      setCurrentLabel(scenario.label);
      setProgress(`Szenario ${i + 1}/${SIM_SCENARIOS.length}`);
      setCurrentScenario(scenario);
      setLiveSnap(null);
      const r = await runScenario(scenario, myUserId, resolvedOrigin, setLiveSnap);
      setResults(prev => [...prev, ...r]);
    }
    setCurrentScenario(null);
    setLiveSnap(null);
    // Everything else is done — the sensor test almost certainly finished
    // (or timed out) long before this point, but wait for it explicitly so
    // "done" always reflects the FULL result set, never a partial one.
    await sensorPromise;
    setRunning(false);
    setDone(true);
    setCurrentLabel('');
    setProgress('');
  };

  const total = results.length;
  const passCount = results.filter(r => r.pass).length;
  const myUserId = getUser()?.id;
  const mapStyle = theme === THEMES.day ? OSM_STYLE : OSM_STYLE_DARK;

  // Live map data for the currently-running scenario — the field polygon
  // and any capture zones are static (computed once per scenario from its
  // own fixed bearing/distance offsets), the tester is fixed at the origin
  // (every scenario scripts it that way), and bots come from the latest
  // game:ar_tick snapshot (ground truth — sim sessions force debugMode, no
  // fog of war). Recomputed only when the scenario or origin actually
  // changes, not on every tick.
  const fieldGeoJSON = useMemo(() => {
    if (!currentScenario || !mapOrigin) return null;
    const corners = squareFieldCorners(currentScenario.fieldSideM).map(w => {
      const p = destinationPoint(mapOrigin, w.bearingDeg, w.distanceM);
      return [p.lon, p.lat];
    });
    return {
      type: 'FeatureCollection' as const,
      features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[...corners, corners[0]]] } }],
    };
  }, [currentScenario, mapOrigin]);

  const zoneGeoJSON = useMemo(() => {
    if (!currentScenario?.zones?.length || !mapOrigin) return null;
    return {
      type: 'FeatureCollection' as const,
      features: currentScenario.zones.map((z, i) => {
        const p = destinationPoint(mapOrigin, z.bearingDeg, z.distanceM);
        return { type: 'Feature' as const, properties: { i }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } };
      }),
    };
  }, [currentScenario, mapOrigin]);

  const actorsGeoJSON = useMemo(() => {
    if (!mapOrigin) return null;
    const features: any[] = [{
      type: 'Feature', properties: { kind: 'tester' },
      geometry: { type: 'Point', coordinates: [mapOrigin.lon, mapOrigin.lat] },
    }];
    for (const p of liveSnap?.players || []) {
      if (p.userId === myUserId || p.lat == null || p.lon == null) continue;
      features.push({ type: 'Feature', properties: { kind: 'bot' }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
    }
    return { type: 'FeatureCollection' as const, features };
  }, [liveSnap, mapOrigin, myUserId]);

  return (
    <View style={st.root}>
      <View style={st.header}>
        <TouchableOpacity onPress={onExit}><Icon name="close" size={20} color={theme.text2} /></TouchableOpacity>
        <Icon name="bug" size={16} color="#ff8040" />
        <Text style={st.title}>Match-Simulation</Text>
      </View>
      <Text style={st.hint}>
        Fest verdrahtete Kurz-Szenarien (1-10s, Klassen-Grenzwerte, Bot-Beschuss, Pod-Capture) über
        die echte Lobby-/Match-Pipeline — keine Optionen, kein manuelles Setup.
      </Text>

      {!running && !done && (
        <TouchableOpacity style={st.startBtn} onPress={start}>
          <Icon name="target" size={16} color="#80ff40" />
          <Text style={st.startTxt}>{SIM_SCENARIOS.length} Szenarien starten</Text>
        </TouchableOpacity>
      )}

      {running && (
        <View style={st.runningBox}>
          <View style={st.runningRow}>
            <ActivityIndicator color={theme.accent} />
            <Text style={st.runningTxt}>Läuft: {currentLabel}</Text>
          </View>
          {!!progress && <Text style={st.progressTxt}>{progress}</Text>}
          {/* Sensor detection runs concurrently in the background — its own
              status line, separate from the main flow above, since it no
              longer blocks it. */}
          {!!sensorProgress && (
            <View style={st.sensorRow}>
              <Icon name="satellite" size={12} color={theme.text3} />
              <Text style={st.sensorTxt}>{sensorProgress}</Text>
            </View>
          )}
        </View>
      )}

      {done && (
        <View style={st.summary}>
          <Icon name={passCount === total ? 'checkCircle' : 'close'} size={18} color={passCount === total ? theme.success : theme.danger} />
          <Text style={[st.summaryTxt, { color: passCount === total ? theme.success : theme.danger }]}>
            {passCount}/{total} Checks bestanden
          </Text>
        </View>
      )}

      {/* Live view of whichever scenario is currently running — field
          outline, capture zone(s) if any, tester (fixed at the origin) and
          bot(s) (live from the latest snapshot). Only rendered while a
          scenario is actually in flight; the map has nothing meaningful to
          show before start or between scenarios. */}
      {currentScenario && mapOrigin && (
        <View style={st.mapBox}>
          <MapView key={currentScenario.key} style={{ flex: 1 }} mapStyle={mapStyle as any} scrollEnabled={false} zoomEnabled={false} rotateEnabled={false}>
            <Camera defaultSettings={{ centerCoordinate: [mapOrigin.lon, mapOrigin.lat], zoomLevel: 17.3 }} />
            {fieldGeoJSON && (
              <ShapeSource id="simField" shape={fieldGeoJSON as any}>
                <FillLayer id="simFieldFill" style={{ fillColor: theme.accent, fillOpacity: 0.08 }} />
                <LineLayer id="simFieldLine" style={{ lineColor: theme.accent, lineWidth: 2, lineOpacity: 0.6 }} />
              </ShapeSource>
            )}
            {zoneGeoJSON && (
              <ShapeSource id="simZones" shape={zoneGeoJSON as any}>
                <CircleLayer id="simZoneDots" style={{
                  circleRadius: 14, circleColor: '#f0c840', circleOpacity: 0.25,
                  circleStrokeWidth: 2, circleStrokeColor: '#f0c840',
                }} />
              </ShapeSource>
            )}
            {actorsGeoJSON && (
              <ShapeSource id="simActors" shape={actorsGeoJSON as any}>
                <CircleLayer id="simActorDots" style={{
                  circleRadius: 8,
                  circleColor: ['match', ['get', 'kind'], 'tester', '#40a0ff', '#ff5050'] as any,
                  circleStrokeWidth: 2, circleStrokeColor: '#ffffff',
                }} />
              </ShapeSource>
            )}
          </MapView>
        </View>
      )}

      <ScrollView style={st.list}>
        {results.map((r, i) => (
          <View key={i} style={[st.row, r.pass ? st.rowPass : st.rowFail]}>
            <Icon name={r.pass ? 'checkCircle' : 'close'} size={14} color={r.pass ? theme.success : theme.danger} />
            <View style={{ flex: 1 }}>
              <Text style={st.rowLabel}>{r.label}</Text>
              <Text style={st.rowDetail}>{r.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg, paddingTop: 50, paddingHorizontal: 16 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    title: { color: theme.text, fontSize: 18, fontWeight: '900' },
    hint: { color: theme.text3, fontSize: 12, marginBottom: 16 },
    startBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: 'rgba(60,160,20,.25)', borderWidth: 2, borderColor: '#3a8020',
      borderRadius: 12, padding: 16, marginBottom: 16,
    },
    startTxt: { color: '#80ff40', fontSize: 15, fontWeight: '800' },
    runningBox: { marginBottom: 16 },
    runningRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    runningTxt: { color: theme.text2, fontSize: 13 },
    progressTxt: { color: theme.text3, fontSize: 12, marginTop: 4, marginLeft: 34 },
    sensorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    sensorTxt: { color: theme.text3, fontSize: 11 },
    summary: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    summaryTxt: { fontSize: 16, fontWeight: '900' },
    mapBox: {
      height: 220, borderRadius: 12, overflow: 'hidden', marginBottom: 12,
      borderWidth: 1, borderColor: theme.border,
    },
    list: { flex: 1 },
    row: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8,
      marginBottom: 6, borderWidth: 1,
    },
    rowPass: { backgroundColor: 'rgba(80,255,64,.08)', borderColor: 'rgba(80,255,64,.3)' },
    rowFail: { backgroundColor: 'rgba(255,64,64,.1)', borderColor: 'rgba(255,64,64,.35)' },
    rowLabel: { color: theme.text, fontSize: 12, fontWeight: '700' },
    rowDetail: { color: theme.text3, fontSize: 11, marginTop: 2 },
  });
}
