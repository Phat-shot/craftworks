// ═══════════════════════════════════════════════════════════
//  Match-Simulation — debug-only, fully automated on-device test harness.
//  Runs the fixed sequence of SIM_SNIPPETS (packages/arops-shared/src/
//  simScript.ts — single source of truth also used by the server's
//  tickSimBots, see server/src/game/arops.js) as REAL matches through the
//  normal socket pipeline (lobby create/update/start, game:join,
//  game:action telemetry/hit-attempt, game:ar_tick snapshots) — exactly
//  the same code path GameScreen uses, just with scripted positions
//  instead of real GPS/compass. Each snippet's shots/checkpoints already
//  carry a known-correct expected outcome (cross-verified against the
//  server pipeline by server/test/arops_sim.test.js) — this screen's job
//  is only to confirm the CLIENT correctly drives a real match and gets
//  the same answer back, not to re-derive the geometry itself.
//  No configurable options anywhere — a fixed script, not a game mode.
// ═══════════════════════════════════════════════════════════
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { Magnetometer } from 'expo-sensors';
import { destinationPoint, squareFieldCorners, SIM_SNIPPETS } from '@craftworks/arops-shared';
import type { SimSnippet, SimShootBeat, SimCheckpoint } from '@craftworks/arops-shared';
import { getSocket, getUser, createArLobby, getLastPosition, joinLobbyByCode } from '../api';
import Icon from '../components/Icon';
import { useTheme, ThemeTokens } from '../theme';

interface SimSnap {
  phase: string;
  me: { status: string } | null;
  zones?: { owner?: string | null }[];
  captures?: Record<string, number>;
  armed?: { explodeAt: number } | null;
  targets?: { destroyed: boolean }[];
  events: { type: string; userId?: string; byUserId?: string }[];
}

interface CheckResult { snippetKey: string; label: string; pass: boolean; detail: string; }

const CHECK_MARGIN_MS = 3_000; // network/processing slack before reading a checkpoint's result
const SHOT_RESULT_TIMEOUT_MS = 20_000; // generous — real device network/server latency, no fake clock here

function sleep(ms: number): Promise<void> { return new Promise(res => setTimeout(res, ms)); }

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
  if (cp.check === 'zoneOwner') {
    const owner = snap.zones?.[cp.targetIndex]?.owner ?? null;
    return { pass: owner === cp.expected, detail: `Zone[${cp.targetIndex}].owner = ${owner} (erwartet ${cp.expected})` };
  }
  if (cp.check === 'flagCaptured') {
    const count = snap.captures?.[cp.expected] ?? 0;
    return { pass: count >= 1, detail: `captures[${cp.expected}] = ${count}` };
  }
  if (cp.check === 'bombDefused') {
    const destroyed = snap.targets?.[cp.targetIndex]?.destroyed ?? null;
    const pass = snap.armed == null && destroyed === false;
    return { pass, detail: `armed=${JSON.stringify(snap.armed)} destroyed=${destroyed}` };
  }
  if (cp.check === 'bombArmed') {
    return { pass: snap.armed != null, detail: `armed=${JSON.stringify(snap.armed)}` };
  }
  return { pass: false, detail: `unbekannter Check-Typ: ${cp.check}` };
}

function checkBotShot(beat: SimShootBeat, myUserId: string, snap: SimSnap | null): { pass: boolean; detail: string } {
  if (!snap) return { pass: false, detail: 'kein Snapshot empfangen' };
  const gotHit = (snap.events || []).some(e =>
    ['player_downed', 'player_frozen', 'player_eliminated'].includes(e.type)
    && e.userId === myUserId && e.byUserId === beat.shooterId);
  return { pass: gotHit === beat.expectedHit, detail: `Treffer-Event von ${beat.shooterId} gefunden: ${gotHit}` };
}

// Runs one scripted snippet as a real match end-to-end and returns every
// check's pass/fail. Never throws — a setup failure (lobby/start/timeout)
// is folded into a single failing result so one broken snippet doesn't
// abort the whole run.
async function runSnippet(snippet: SimSnippet, myUserId: string, origin: { lat: number; lon: number }): Promise<CheckResult[]> {
  const fail = (detail: string): CheckResult[] => [{ snippetKey: snippet.key, label: snippet.label, pass: false, detail }];

  const socket = getSocket();
  let lobbyId: string;
  try {
    const lobby = await createArLobby(`Sim: ${snippet.label}`);
    lobbyId = lobby.lobbyId;
  } catch (e: any) {
    return fail(`Lobby konnte nicht erstellt werden: ${e?.message || e}`);
  }

  const polygon = squareFieldCorners(snippet.fieldSideM).map(w => destinationPoint(origin, w.bearingDeg, w.distanceM));
  socket.emit('lobby:join', { lobbyId });

  const results: CheckResult[] = [];
  let latestSnap: SimSnap | null = null;
  const onTick = (s: SimSnap) => { latestSnap = s; };
  let telemetryTimer: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    socket.off('game:ar_tick', onTick);
    if (telemetryTimer) clearInterval(telemetryTimer);
  };

  try {
    // Wait for the ar_update to actually land before starting — a fixed
    // short wait rather than chasing lobby:ar_updated's own payload shape,
    // simple and generous enough given every snippet's own timeline already
    // budgets many seconds of slack elsewhere.
    socket.emit('lobby:ar_update', {
      lobbyId,
      arSettings: { polygon, simulation: true, simSnippetKey: snippet.key, debugMode: true },
    });
    await sleep(800);

    const sessionId = await new Promise<string | null>(resolve => {
      const onStart = ({ sessionId }: { sessionId: string }) => resolve(sessionId);
      const onErr = () => resolve(null);
      socket.once('game:start', onStart);
      socket.once('error', onErr);
      socket.emit('lobby:start', { lobbyId });
      setTimeout(() => resolve(null), 15_000);
    });
    if (!sessionId) return fail('lobby:start lieferte kein game:start (Timeout oder Server-Fehler)');

    socket.emit('game:join', { sessionId });
    socket.on('game:ar_tick', onTick);

    const sample = () => ({
      lat: origin.lat, lon: origin.lon, ts: Date.now(), accuracyM: 3, headingDeg: snippet.testerHeadingDeg,
    });
    socket.emit('game:action', { sessionId, action: 'ar_telemetry', data: { sample: sample() } });
    telemetryTimer = setInterval(() => {
      socket.emit('game:action', { sessionId, action: 'ar_telemetry', data: { sample: sample() } });
    }, 1000);

    const testerShots = snippet.shoots.filter(b => b.shooterId === 'tester');
    const botShots = snippet.shoots.filter(b => b.shooterId !== 'tester');

    const shotPromises = testerShots.map(beat => new Promise<void>(resolve => {
      setTimeout(() => {
        const done = (r: any) => {
          const pass = !!r?.ok && r.hit === beat.expectedHit;
          const detail = r === null
            ? `keine Antwort innerhalb ${SHOT_RESULT_TIMEOUT_MS / 1000}s (Netzwerk/Server-Last?)`
            : r.ok ? `hit=${r.hit} reason=${r.reason || '–'} (erwartet ${beat.expectedHit})` : `abgelehnt: ${r.err}`;
          results.push({ snippetKey: snippet.key, label: `${snippet.label}: Schuss @${beat.tMs}ms`, pass, detail });
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
          results.push({ snippetKey: snippet.key, label: `${snippet.label}: Bot-Schuss @${beat.tMs}ms`, pass: r.pass, detail: r.detail });
          resolve();
        }, beat.tMs + CHECK_MARGIN_MS);
      })),
      ...snippet.checkpoints.map(cp => new Promise<void>(resolve => {
        setTimeout(() => {
          const r = checkCheckpoint(cp, latestSnap);
          results.push({ snippetKey: snippet.key, label: `${snippet.label}: ${cp.check} @${cp.tMs}ms`, pass: r.pass, detail: r.detail });
          resolve();
        }, cp.tMs + CHECK_MARGIN_MS);
      })),
    ];

    await Promise.all([...shotPromises, ...checkPromises]);
    // Actively tear the session down instead of leaving it to idle out its
    // own gameDurationMs (previously a known limitation — every sim run
    // left its sessions dangling server-side). game:sim_end
    // (server/src/socket/game.js) is a narrowly-scoped self-cleanup event:
    // it only ever works on a session this same run flagged as
    // ar_settings.simulation, so it can't be repurposed to end a real match.
    await new Promise<void>(resolve => {
      const onEnded = () => { socket.off('game:sim_end_result', onEnded); resolve(); };
      socket.once('game:sim_end_result', onEnded);
      socket.emit('game:sim_end', { sessionId });
      setTimeout(() => { socket.off('game:sim_end_result', onEnded); resolve(); }, 5_000);
    });
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

async function runSensorTest(): Promise<CheckResult[]> {
  const label = 'Vorflug: Sensoren';
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
// joinLobbyByCode, api.ts) the match snippets themselves never touch — they
// join their own freshly-created lobby directly over the socket since the
// host is auto-inserted into lobby_members at creation time. This lobby is
// deliberately never started (no lobby:start) — no session/worker is ever
// created, so there's nothing to actively clean up afterward; it just sits
// at status='waiting' like every other never-started lobby already does.
async function runCodeJoinTest(): Promise<CheckResult[]> {
  const label = 'Vorflug: Code/Beitritt';
  const results: CheckResult[] = [];
  let lobby: { lobbyId: string; code: string };
  try {
    lobby = await createArLobby('Sim: Code/Join-Test');
  } catch (e: any) {
    return [{ snippetKey: 'preflight', label: `${label}: Lobby erstellen`, pass: false, detail: e?.message || String(e) }];
  }

  const codeOk = /^[A-Za-z0-9_-]{6,12}$/.test(lobby.code);
  results.push({ snippetKey: 'preflight', label: `${label}: Code erzeugt`, pass: codeOk, detail: `Code: ${lobby.code}` });

  try {
    const joined = await joinLobbyByCode(lobby.code);
    results.push({
      snippetKey: 'preflight', label: `${label}: Beitritt per Code`, pass: joined.lobbyId === lobby.lobbyId,
      detail: `lobbyId=${joined.lobbyId} (erwartet ${lobby.lobbyId})`,
    });
  } catch (e: any) {
    results.push({ snippetKey: 'preflight', label: `${label}: Beitritt per Code`, pass: false, detail: e?.message || String(e) });
  }

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
  const [results, setResults] = useState<CheckResult[]>([]);
  const cancelRef = useRef(false);

  const start = async () => {
    setRunning(true);
    setDone(false);
    setResults([]);
    cancelRef.current = false;
    const myUserId = getUser()?.id || '';
    // Resolved once per run (not per snippet) — every snippet's synthetic
    // field is anchored at the same point, see resolveOrigin's fallback
    // chain (Lobby's live GPS → last cached fix → jittered default).
    const resolvedOrigin = resolveOrigin(origin);

    setCurrentLabel('Vorflug: Sensoren');
    const sensorResults = await runSensorTest();
    setResults(prev => [...prev, ...sensorResults]);

    setCurrentLabel('Vorflug: Code/Beitritt');
    const joinResults = await runCodeJoinTest();
    setResults(prev => [...prev, ...joinResults]);

    for (const snippet of SIM_SNIPPETS) {
      if (cancelRef.current) break;
      setCurrentLabel(snippet.label);
      const r = await runSnippet(snippet, myUserId, resolvedOrigin);
      setResults(prev => [...prev, ...r]);
    }
    setRunning(false);
    setDone(true);
    setCurrentLabel('');
  };

  const total = results.length;
  const passCount = results.filter(r => r.pass).length;

  return (
    <View style={st.root}>
      <View style={st.header}>
        <TouchableOpacity onPress={onExit}><Icon name="close" size={20} color={theme.text2} /></TouchableOpacity>
        <Icon name="bug" size={16} color="#ff8040" />
        <Text style={st.title}>Match-Simulation</Text>
      </View>
      <Text style={st.hint}>
        Fest verdrahtete Testläufe (Klassen-Grenzwerte, Bot-Beschuss, Objectives) über die echte
        Lobby-/Match-Pipeline — keine Optionen, kein manuelles Setup.
      </Text>

      {!running && !done && (
        <TouchableOpacity style={st.startBtn} onPress={start}>
          <Icon name="target" size={16} color="#80ff40" />
          <Text style={st.startTxt}>{SIM_SNIPPETS.length} Snippets starten</Text>
        </TouchableOpacity>
      )}

      {running && (
        <View style={st.runningRow}>
          <ActivityIndicator color={theme.accent} />
          <Text style={st.runningTxt}>Läuft: {currentLabel}</Text>
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
    runningRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
    runningTxt: { color: theme.text2, fontSize: 13 },
    summary: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    summaryTxt: { fontSize: 16, fontWeight: '900' },
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
