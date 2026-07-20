import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Modal, ActivityIndicator, Alert, Platform, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { getCurrentLocation as getNativeLocation } from 'native-location';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import { getSocket, getUser, fetchLobbyQr, getLastPosition, saveLastPosition } from '../api';
import Icon, { IconName } from '../components/Icon';
import ComicMapLayers, { ComicFeature } from '../components/ComicMapLayers';
import { OSM_STYLE, BLANK_STYLE } from '../mapStyle';
import { polygonAreaM2, scaleCoreConfig, PLAYER_TYPE_PROFILES, GAME_MODE_PROFILES } from '@craftworks/arops-shared';
import { withTimeout } from '../utils/withTimeout';

interface ComicMap { features: ComicFeature[]; polygonSnapshot: string; fetchedAt: number; }
const COMIC_MAP_ERR_DE: Record<string, string> = {
  not_host: 'Nur der Host kann das', wrong_mode: 'Falscher Modus',
  no_polygon: 'Erst das Spielfeld zeichnen', invalid_polygon: 'Spielfeld ungültig',
  lobby_not_found: 'Lobby nicht gefunden', fetch_failed: 'Abruf fehlgeschlagen — später erneut versuchen',
  rate_limited: 'OpenStreetMap ist gerade überlastet (kostenloser Dienst) — kurz warten und erneut versuchen',
  timeout: 'Zeitüberschreitung beim Abruf — erneut versuchen',
  network_error: 'Server konnte OpenStreetMap nicht erreichen — kein Problem der App',
};

interface Member { id: string; username: string; ready: boolean; }
interface ArSettings {
  polygon?: { lat: number; lon: number }[];
  roles?: Record<string, 'seeker' | 'hider'>;
  teams?: Record<string, 'a' | 'b'>;
  zones?: { lat: number; lon: number }[];
  subMode?: string;
  hidingDurationMs?: number;
  gameDurationMs?: number;
  hitCooldownMs?: number;
  radarCooldownMs?: number;
  droneCooldownMs?: number;
  cloakCooldownMs?: number;
  fakeMarkerCooldownMs?: number;
  aufscheuchenCooldownMs?: number;
  foundMode?: 'spectator' | 'seeker' | 'freeze';
  // Hide & Seek variant: 'classic' (default, seeker/hider), 'ffa' (Jeder
  // gegen jeden — no roles/teams) or 'the_ship' (secret assassin-chain, no
  // roles) — see server's MODES.hide_and_seek.
  hsVariant?: 'classic' | 'ffa' | 'the_ship';
  // Team/FFA variant for the 4 team-capable modes (domination, ctf,
  // seek_destroy, deathmatch) — see server's cfg.teamVariant in arops.js.
  teamVariant?: 'team' | 'ffa';
  // Zerstören (seek_destroy): symmetric capture vs. attacker-arms/defender-defuses.
  destroyVariant?: 'instant' | 'defuse';
  destroyReactivate?: boolean;
  // Deathmatch: on-hit consequence + lives (respawn variant only).
  deathmatchOnHit?: 'respawn' | 'freeze';
  livesPerPlayer?: number;
  bots?: { id: string; username: string }[];
  debugMode?: boolean;
  comicMap?: ComicMap;
  hitTrackingMode?: 'compass' | 'ir';
  irIds?: Record<string, number>;
  // Player classes (scout/sniper/bomber) — additive to role/team, every
  // mode, optional (unset = classless, unchanged combat stats).
  classes?: Record<string, 'scout' | 'sniper' | 'bomber'>;
  hitConfig?: { maxRangeM?: number; baseConeHalfAngleDeg?: number };
  autoScale?: boolean;
}

// Half-angle presets expressed to the host as an approximate width at a 10m
// reference distance (halfWidthM = 10 * tan(halfAngleDeg)) — the actual
// validation stays angle-based (packages/arops-shared hit.ts, untouched),
// this is just an intuitive framing for the setting.
const REF_DIST_M = 10;
const WIDTH_PRESETS = [
  { halfWidthM: 0.5, label: 'Eng (1m)' },
  { halfWidthM: 1, label: 'Normal (2m)' },
  { halfWidthM: 2, label: 'Weit (4m)' },
];
const RANGE_PRESETS = [30, 50, 75, 100];

// Short labels — 5 modes need to fit on one line (host screen real estate).
const SUB_MODES: { id: string; icon: IconName; label: string }[] = [
  { id: 'hide_and_seek', icon: 'ghost', label: 'H&S' },
  { id: 'domination', icon: 'target', label: 'DOM' },
  { id: 'ctf', icon: 'flag', label: 'CtF' },
  { id: 'seek_destroy', icon: 'bomb', label: 'Bomb' },
  { id: 'deathmatch', icon: 'skull', label: 'DM' },
];
const NEEDS_ZONES: Record<string, number> = { domination: 2, seek_destroy: 1 };
// Modes with real team assignment — hide_and_seek (all 3 variants: classic,
// ffa "Jeder gegen jeden", the_ship) has no teams at all (usesTeams: false
// server-side, see arops.js's MODES table).
const TEAM_MODES = ['domination', 'ctf', 'seek_destroy', 'deathmatch'];
const POLY_ERR_DE: Record<string, string> = {
  too_few_points: 'Mind. 3 Wegpunkte setzen',
  self_intersecting: 'Fläche überschneidet sich — Punkte der Reihe nach im Kreis setzen',
  area_too_small: 'Fläche zu klein (min. 2.000 m²)',
  area_too_large: 'Fläche zu groß (max. 3 km²)',
};
// Was missing several codes the server actually emits on this same 'error'
// channel (lobby_not_found, server_error, and the generic-lobby ones below)
// — onError below only ever set startErr for a code present here, so any
// unmapped code (e.g. an unexpected server_error from a DB hiccup) made
// tapping "Start" look like it silently did nothing at all.
const START_ERR: Record<string, string> = {
  ar_invalid_polygon: 'Spielfeld ungültig — siehe Karte',
  ar_need_two_players: 'Mindestens 2 Spieler nötig',
  ar_need_zones: 'Zonen fehlen — Tipp-Modus auf "Zonen" stellen',
  ar_zones_invalid: 'Zonen ungültig (außerhalb / zu nah beieinander)',
  not_host: 'Nur der Host kann starten',
  lobby_not_found: 'Lobby nicht gefunden — evtl. abgelaufen',
  server_error: 'Serverfehler — bitte erneut versuchen',
  not_member: 'Nicht (mehr) Mitglied dieser Lobby',
  not_in_lobby: 'Nicht in der Lobby',
  wrong_mode: 'Falscher Modus',
  ar_update_failed: 'Einstellung konnte nicht gespeichert werden',
};
// Applied once when Debug-Mode is switched on — host can still retune via the
// normal pickers afterward, nothing here is locked in.
const DEBUG_COOLDOWNS = {
  hidingDurationMs: 5_000, gameDurationMs: 180_000, hitCooldownMs: 500,
  radarCooldownMs: 15_000, droneCooldownMs: 15_000, cloakCooldownMs: 15_000,
  fakeMarkerCooldownMs: 15_000, aufscheuchenCooldownMs: 15_000,
};

export default function LobbyScreen({
  lobbyId, isHost = false, lobbyCode, onGameStart,
}: { lobbyId: string; isHost?: boolean; lobbyCode?: string; onGameStart: (sessionId: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [ar, setAr] = useState<ArSettings>({});
  const [polyErrs, setPolyErrs] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [startErr, setStartErr] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [tapMode, setTapMode] = useState<'polygon' | 'zones'>('polygon');
  const [comicMapLoading, setComicMapLoading] = useState(false);
  const [comicMapErr, setComicMapErr] = useState('');
  // Seeded from the last real fix persisted locally (see api.ts
  // saveLastPosition) so the map already centers on roughly the right area
  // on first render, instead of the world-view fallback, while a fresh fix
  // is still pending — myPosStale marks it as "last known", not live.
  const lastKnownPos = getLastPosition();
  const [myPos, setMyPos] = useState<{ lat: number; lon: number } | null>(
    lastKnownPos ? { lat: lastKnownPos.lat, lon: lastKnownPos.lon } : null
  );
  const [myPosStale, setMyPosStale] = useState(!!lastKnownPos);
  const myPosStaleRef = useRef(myPosStale);
  myPosStaleRef.current = myPosStale;
  const [myPosLoading, setMyPosLoading] = useState(false);
  const [myPosErr, setMyPosErr] = useState(false);
  // Distinct from myPosErr — "permission denied" needs a Settings change
  // (retrying can never succeed on its own, no matter which OS API is
  // behind loadMyPosition), whereas a plain myPosErr (fix timed out) might
  // resolve on the very next retry. Both used to collapse into the same
  // generic warning icon with no way to tell them apart, which could read
  // as "GPS is broken" indefinitely when the actual, fixable cause was a
  // denied permission the whole time.
  const [myPosPermDenied, setMyPosPermDenied] = useState(false);
  // Surfaced in the UI while loading — a GPS cold fix can legitimately take
  // up to ~24s (3 attempts × 8s timeout) outdoors; with nothing but a small
  // spinner icon to show for it, that reads as "the app is stuck" instead of
  // "still searching". Attempt count included so long waits stay legible.
  const [myPosAttempt, setMyPosAttempt] = useState(0);
  // Generation token for the watchdog below — a stale watchdog from an
  // earlier loadMyPosition() call (e.g. superseded by a manual retry tap)
  // must not clear the loading state of a newer, still-in-flight one.
  const loadGenRef = useRef(0);
  const me = getUser();
  const arRef = useRef(ar);
  arRef.current = ar;
  const comicMapReqRef = useRef<string | null>(null);

  // One-shot fetch (not a live watch) — this is just a reference point for
  // drawing the field, not gameplay telemetry, so no need to keep polling.
  // GPS can be unreliable on first try (cold fix, permission dialog timing).
  // Earlier version: recursive getCurrentPositionAsync attempts each wrapped
  // in withTimeout. Reported symptom: stuck showing "1/3" forever, spinner
  // never stopping — getCurrentPositionAsync has known hangs on some Android/
  // expo-location versions where the underlying NATIVE call itself never
  // settles, and (unconfirmed but plausible) requestForegroundPermissionsAsync
  // itself was never time-boxed at all, so a hang there before even reaching
  // the timeout-wrapped call would freeze progress with no way out — not even
  // the manual retry button, since it's disabled by myPosLoading which would
  // then never flip back to false.
  //
  // Rebuilt so the retry loop's progress depends ONLY on a plain JS timer,
  // never on any expo-location promise actually settling — it is therefore
  // structurally impossible for this to hang indefinitely again, regardless
  // of which native call turns out to be the culprit. watchPositionAsync is
  // also generally more reliable for acquiring a first fix than one-shot
  // getCurrentPositionAsync (keeps trying continuously instead of one single
  // snapshot attempt) — take its first update, then unsubscribe immediately.
  //
  // Watchdog on top of that (WATCHDOG_MS, well past the 24s of the internal
  // loop below): reported "hangs again" after the fix above means some path
  // through this function can still leave myPosLoading stuck — possibly a
  // synchronous throw before the loop is even reached. The watchdog and the
  // surrounding try/catch/finally are a second, independent layer that does
  // not rely on this function's own internals ever behaving — whatever goes
  // wrong inside, the lobby can no longer get stuck on "GPS wird gesucht"
  // forever, only ever fall back to the manual retry button.
  //
  // Android now bypasses expo-location's watchPositionAsync entirely below
  // (see modules/native-location) — the repeated hangs across multiple
  // rounds of JS-side watchdogs point at that wrapper itself, not the
  // underlying OS location stack. iOS (no native module there) still uses
  // the watchPositionAsync + timer-loop path.
  const WATCHDOG_MS = 30_000;
  const loadMyPosition = async () => {
    setMyPosLoading(true);
    setMyPosErr(false);
    setMyPosPermDenied(false);
    setMyPosAttempt(0);

    const gen = ++loadGenRef.current;
    const watchdog = setTimeout(() => {
      if (loadGenRef.current !== gen) return; // superseded by a newer attempt
      setMyPosErr(true);
      setMyPosLoading(false);
    }, WATCHDOG_MS);

    try {
      const perm = await withTimeout(Location.requestForegroundPermissionsAsync(), 15_000).catch(() => null);
      if (!perm || perm.status !== 'granted') {
        // A perm object that came back but says !granted is a REAL denial
        // (as opposed to the request itself timing out/throwing) — that
        // can only ever be fixed in Settings, not by tapping retry again.
        if (perm) setMyPosPermDenied(true);
        setMyPosErr(true);
        setMyPosLoading(false);
        return;
      }

      // Fill from the OS's own cache if we don't have anything yet, or all
      // we have is the (possibly much older) locally-persisted last fix —
      // a fresher OS-cached fix is worth preferring over that.
      Location.getLastKnownPositionAsync().then(cached => {
        if (cached) setMyPos(p => (p && !myPosStaleRef.current) ? p : { lat: cached.coords.latitude, lon: cached.coords.longitude });
      }).catch(() => {});

      // Android: FusedLocationProviderClient directly (see modules/
      // native-location), bypassing expo-location's watchPositionAsync —
      // that wrapper is the documented source of the repeated hangs above,
      // not the underlying OS location stack. Own 12s native-side timeout,
      // so this can't hang either; a plain one-shot call replaces the whole
      // watch-and-unsubscribe dance below, which stays as the iOS path
      // (no native module there, see NativeLocationModule.kt's doc-comment).
      if (Platform.OS === 'android') {
        const fix = await getNativeLocation().catch(() => null);
        if (loadGenRef.current !== gen) return; // superseded by a newer attempt
        if (fix) {
          setMyPos({ lat: fix.lat, lon: fix.lon });
          setMyPosStale(false);
          setMyPosLoading(false);
          saveLastPosition(fix.lat, fix.lon);
        } else {
          setMyPosErr(true);
          setMyPosLoading(false);
        }
        return;
      }

      let settled = false;
      // Plain object holder (not a bare `let`) — TS otherwise over-narrows a
      // closure-captured `let` reassigned only inside callbacks.
      const subHolder: { current: Location.LocationSubscription | null } = { current: null };
      Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 1000, distanceInterval: 0 }, pos => {
        if (settled) return;
        settled = true;
        setMyPos({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setMyPosStale(false);
        setMyPosLoading(false);
        saveLastPosition(pos.coords.latitude, pos.coords.longitude);
        subHolder.current?.remove();
      }).then(s => { subHolder.current = s; if (settled) s.remove(); }).catch(() => {});

      const WINDOW_MS = 8000;
      const WINDOWS = 3;
      for (let i = 0; i < WINDOWS && !settled; i++) {
        setMyPosAttempt(i);
        await new Promise(r => setTimeout(r, WINDOW_MS));
      }
      subHolder.current?.remove();
      if (!settled) { setMyPosErr(true); setMyPosLoading(false); }
    } catch {
      setMyPosErr(true);
      setMyPosLoading(false);
    } finally {
      clearTimeout(watchdog);
    }
  };

  useEffect(() => { loadMyPosition(); }, []);

  useEffect(() => {
    const socket = getSocket();
    // RN sockets routinely disconnect on background/foreground transitions;
    // re-joining the room on every reconnect resyncs lobby:state so players
    // who joined while we were disconnected show up again (server-side
    // lobby:join is idempotent — safe to call repeatedly).
    const joinLobby = () => socket.emit('lobby:join', { lobbyId });
    joinLobby();
    socket.on('connect', joinLobby);
    if (isHost) fetchLobbyQr(lobbyId).then(r => { setQr(r?.qr ?? null); setQrUrl(r?.url ?? null); });

    const onState = ({ members: m }: any) => setMembers(m || []);
    const onArUpdated = ({ arSettings, polygonCheck }: any) => {
      setAr(arSettings || {});
      setPolyErrs(polygonCheck && !polygonCheck.ok ? polygonCheck.errors : []);
    };
    const onJoined = (p: any) => setMembers(m => [...m.filter(x => x.id !== p.userId), { id: p.userId, username: p.username, ready: false }]);
    const onLeft = ({ userId }: any) => setMembers(m => m.filter(x => x.id !== userId));
    const onReady = ({ userId, ready: r }: any) => setMembers(m => m.map(x => x.id === userId ? { ...x, ready: r } : x));
    const onStart = ({ sessionId }: any) => onGameStart(sessionId);
    // Fallback to the raw code rather than doing nothing for one we haven't
    // mapped in START_ERR — a silent no-op here is exactly what made a tap
    // on "Start" look broken with zero feedback (see START_ERR's comment).
    const onError = ({ code, detail }: any) => setStartErr(START_ERR[code] || detail || `Fehler: ${code}`);
    const onComicMapReady = ({ reqId, comicMap }: any) => {
      if (reqId !== comicMapReqRef.current) return; // superseded by a newer request
      setComicMapLoading(false);
      setAr(a => ({ ...a, comicMap }));
    };
    const onComicMapError = ({ reqId, err, remainingMs }: any) => {
      if (reqId !== comicMapReqRef.current) return;
      setComicMapLoading(false);
      setComicMapErr(err === 'cooldown'
        ? `Bitte ${Math.ceil((remainingMs ?? 0) / 1000)}s warten`
        : (COMIC_MAP_ERR_DE[err] || 'Fehler beim Generieren'));
      setTimeout(() => setComicMapErr(''), 5000);
    };

    socket.on('lobby:state', onState);
    socket.on('lobby:ar_updated', onArUpdated);
    socket.on('lobby:player_joined', onJoined);
    socket.on('lobby:player_left', onLeft);
    socket.on('lobby:player_ready', onReady);
    socket.on('game:start', onStart);
    socket.on('error', onError);
    socket.on('lobby:comic_map_ready', onComicMapReady);
    socket.on('lobby:comic_map_error', onComicMapError);
    return () => {
      socket.emit('lobby:leave', { lobbyId });
      socket.off('connect', joinLobby);
      socket.off('lobby:state', onState);
      socket.off('lobby:ar_updated', onArUpdated);
      socket.off('lobby:player_joined', onJoined);
      socket.off('lobby:player_left', onLeft);
      socket.off('lobby:player_ready', onReady);
      socket.off('game:start', onStart);
      socket.off('error', onError);
      socket.off('lobby:comic_map_ready', onComicMapReady);
      socket.off('lobby:comic_map_error', onComicMapError);
    };
  }, [lobbyId, isHost, onGameStart]);

  // Debounced: rapidly tapping through several mode/settings buttons in a
  // row previously fired one full lobby:ar_update round-trip PER TAP —
  // each one its own DB read (effectiveArSettings) + write + broadcast to
  // everyone in the lobby. Reported symptom: the app becomes unresponsive
  // after switching modes a few times in quick succession. Coalescing
  // bursts into a single emit removes that pile-up regardless of exactly
  // which part of the round-trip it was overwhelming (client render churn
  // from rapid-fire lobby:ar_updated broadcasts, or the server/DB side).
  const pendingPatchRef = useRef<Partial<ArSettings>>({});
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (emitTimerRef.current) clearTimeout(emitTimerRef.current); }, []);
  const emitUpdate = (patch: Partial<ArSettings>) => {
    // Apply locally right away — otherwise the UI only reflects a change once
    // the debounced emit below round-trips through the server, which reads as
    // "nothing happened" if you tap again in the meantime. Worse, onMapPress
    // builds its next point list off the `polygon`/`zones` closure variables
    // (derived from `ar`) — without this, several taps within one debounce
    // window all read the same stale array and each tap's patch overwrites
    // the previous one's pending point instead of appending to it.
    setAr(prev => ({ ...prev, ...patch }));
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      const merged = { ...arRef.current, ...pendingPatchRef.current };
      pendingPatchRef.current = {};
      emitTimerRef.current = null;
      getSocket().emit('lobby:ar_update', { lobbyId, arSettings: merged });
    }, 150);
  };

  const polygon = ar.polygon || [];
  const zones = ar.zones || [];
  const subMode = ar.subMode || 'hide_and_seek';
  const teamMode = TEAM_MODES.includes(subMode);
  const hsVariant = ['ffa', 'the_ship'].includes(ar.hsVariant || '') ? ar.hsVariant! : 'classic';
  // ffa/The Ship have no roles at all (not seeker/hider, not team) —
  // role/team assignment UI only makes sense for the classic variant.
  const rolesApply = subMode === 'hide_and_seek' && hsVariant === 'classic';
  const teamVariant = teamMode && ar.teamVariant === 'ffa' ? 'ffa' : 'team';
  const foundMode = ar.foundMode || 'spectator';
  const destroyVariant = ar.destroyVariant === 'defuse' ? 'defuse' : 'instant';
  const deathmatchOnHit = ar.deathmatchOnHit === 'freeze' ? 'freeze' : 'respawn';
  const livesPerPlayer = ar.livesPerPlayer || 3;
  const bots = ar.bots || [];
  const debugMode = ar.debugMode || false;
  const hitTrackingMode = ar.hitTrackingMode || 'compass';
  // Bots are display-only overlay from ar_settings — never touch the real
  // socket-driven `members` state, which tracks actual joined players.
  const displayMembers = useMemo(
    () => [...members.map(m => ({ ...m, isBot: false })), ...bots.map(b => ({ id: b.id, username: b.username, ready: true, isBot: true }))],
    [members, bots]
  );
  // Server is the single source of truth for roles/teams
  const roleOf = (uid: string) => ar.roles?.[uid] || 'hider';
  const teamOf = (uid: string) => ar.teams?.[uid] || 'a';
  // Which numeric ID (0-255) each player's physical ESP32 IR beacon
  // broadcasts (see hardware/esp32-ir) — only meaningful/shown once IR mode
  // is selected. Tap-to-cycle rather than a text input, matching the
  // existing role/team toggle pattern; fine for the small player counts
  // this is actually used with.
  const irIdOf = (uid: string) => ar.irIds?.[uid];
  const cycleIrId = (uid: string) => {
    if (!isHost) return;
    const next = ((irIdOf(uid) ?? -1) + 1) % 256;
    emitUpdate({ irIds: { ...(ar.irIds || {}), [uid]: next } });
  };
  // Player classes (scout/sniper/bomber) — additive to role/team, every
  // mode, no host obligation to assign one. Tap-to-cycle: none -> scout ->
  // sniper -> bomber -> none, same pattern as the IR-ID cycle above.
  const CLASS_CYCLE = ['scout', 'sniper', 'bomber'] as const;
  const classOf = (uid: string) => ar.classes?.[uid];
  const cycleClass = (uid: string) => {
    if (!isHost) return;
    const cur = classOf(uid);
    const idx = cur ? CLASS_CYCLE.indexOf(cur) : -1;
    const next = idx === CLASS_CYCLE.length - 1 ? undefined : CLASS_CYCLE[idx + 1];
    const classes = { ...(ar.classes || {}) };
    if (next) classes[uid] = next; else delete classes[uid];
    emitUpdate({ classes });
  };

  const onMapPress = (feature: any) => {
    if (!isHost) return;
    // Placing a point is a strong signal the host is actively looking at the
    // map right now — a good moment to retry a GPS fix that hasn't resolved
    // yet (observed: a fix that seemed stuck often just appears shortly
    // after the host starts tapping the map anyway). Checking myPosStale too
    // (not just !myPos) matters now that myPos starts pre-seeded from the
    // persisted last-known position: without it, this retry-on-tap safety
    // net could never fire again once that seed was in place, even though
    // it's stale — the exact case a fresh fix is still needed for.
    // Excluded once myPosPermDenied: a denied permission can't be fixed by
    // retrying, only by a Settings change — retrying anyway on every single
    // tap while placing several points in a row was hammering the
    // permission check for nothing every time (reported as "GPS churns").
    if ((!myPos || myPosStale) && !myPosLoading && !myPosPermDenied) loadMyPosition();
    const c = feature?.geometry?.coordinates;
    if (!Array.isArray(c)) return;
    if (tapMode === 'zones' && NEEDS_ZONES[subMode] !== undefined) {
      emitUpdate({ zones: [...zones, { lat: c[1], lon: c[0] }] });
    } else {
      emitUpdate({ polygon: [...polygon, { lat: c[1], lon: c[0] }] });
    }
  };

  const toggleRole = (uid: string) => {
    if (!isHost) return;
    const all: Record<string, 'seeker' | 'hider'> = {};
    for (const m of displayMembers) all[m.id] = roleOf(m.id);
    all[uid] = all[uid] === 'seeker' ? 'hider' : 'seeker';
    emitUpdate({ roles: all });
  };
  const toggleTeam = (uid: string) => {
    if (!isHost) return;
    const all: Record<string, 'a' | 'b'> = {};
    for (const m of displayMembers) all[m.id] = teamOf(m.id);
    all[uid] = all[uid] === 'a' ? 'b' : 'a';
    emitUpdate({ teams: all });
  };

  const addBot = () => {
    const id = 'bot_' + Math.random().toString(36).slice(2, 10);
    const label = `Bot ${bots.length + 1}`;
    emitUpdate({ bots: [...bots, { id, username: label }] });
  };
  const removeBot = (id: string) => emitUpdate({ bots: bots.filter(b => b.id !== id) });
  const toggleDebugMode = () => {
    const next = !debugMode;
    emitUpdate(next ? { debugMode: true, ...DEBUG_COOLDOWNS } : { debugMode: false });
  };

  const comicMapStale = !!ar.comicMap && ar.comicMap.polygonSnapshot !== JSON.stringify(polygon);
  const generateComicMap = () => {
    if (polygon.length < 3 || polyErrs.length > 0 || comicMapLoading) return;
    const reqId = Math.random().toString(36).slice(2);
    comicMapReqRef.current = reqId;
    setComicMapLoading(true);
    setComicMapErr('');
    // Send the current polygon along, not just lobbyId — the auto-generate
    // effect below fires the instant local polygon.length hits 3, but the
    // point(s) that made it happen only reach the server via the
    // separately-debounced (150ms) emitUpdate/lobby:ar_update, which is
    // still in flight at this exact moment. Without this, the server's own
    // DB-read polygon reliably lags behind by a point, misreporting
    // "no_polygon" (Erst das Spielfeld zeichnen) right after finishing it.
    getSocket().emit('lobby:generate_comic_map', { lobbyId, reqId, polygon });
  };

  // Once the field becomes valid, auto-generate the comic map a single time
  // if the host never has (manual "generate"/"regenerate" button still
  // covers every later case — staleness after edits, retry after failure).
  // No extra fallback needed on failure: GameScreen already falls back to
  // plain OSM tiles whenever no comic map exists (see hasComicMap there).
  const autoGenTriedRef = useRef(false);
  useEffect(() => {
    if (!isHost || autoGenTriedRef.current) return;
    if (polygon.length >= 3 && polyErrs.length === 0 && !ar.comicMap && !comicMapLoading) {
      autoGenTriedRef.current = true;
      generateComicMap();
    }
  }, [isHost, polygon.length, polyErrs.length, ar.comicMap, comicMapLoading]);

  const toggleReady = () => {
    const next = !ready;
    setReady(next);
    getSocket().emit('lobby:ready', { lobbyId, ready: next });
  };
  const startGame = () => { setStartErr(''); getSocket().emit('lobby:start', { lobbyId }); };

  const copyToClipboard = async (text: string, which: 'code' | 'link') => {
    await Clipboard.setStringAsync(text);
    setCopied(which);
    setTimeout(() => setCopied(c => (c === which ? null : c)), 1500);
  };

  const center: [number, number] = polygon.length
    ? [polygon.reduce((s, p) => s + p.lon, 0) / polygon.length,
       polygon.reduce((s, p) => s + p.lat, 0) / polygon.length]
    : myPos ? [myPos.lon, myPos.lat] : [11.5755, 48.1374];

  const fieldGeoJSON = useMemo(() => ({
    type: 'Feature' as const, properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: polygon.length >= 3
        ? [[...polygon.map(p => [p.lon, p.lat]), [polygon[0]!.lon, polygon[0]!.lat]]]
        : [[]],
    },
  }), [JSON.stringify(polygon)]);
  const waypointsGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: polygon.map((p, i) => ({
      type: 'Feature' as const, properties: { idx: i },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    })),
  }), [JSON.stringify(polygon)]);
  const zonesGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: zones.map((z, i) => ({
      type: 'Feature' as const, properties: { idx: i },
      geometry: { type: 'Point' as const, coordinates: [z.lon, z.lat] },
    })),
  }), [JSON.stringify(zones)]);

  const hid = ar.hidingDurationMs || 120_000;
  const dur = ar.gameDurationMs || 1_200_000;
  const HIDING = [{ l: '1m', ms: 60_000 }, { l: '2m', ms: 120_000 }, { l: '3m', ms: 180_000 }];
  const DURATION = [{ l: '10m', ms: 600_000 }, { l: '15m', ms: 900_000 }, { l: '20m', ms: 1_200_000 }, { l: '30m', ms: 1_800_000 }];
  const hitRangeM = ar.hitConfig?.maxRangeM || 75;
  const hitHalfAngleDeg = ar.hitConfig?.baseConeHalfAngleDeg;
  const setHitRange = (maxRangeM: number) => emitUpdate({ hitConfig: { ...ar.hitConfig, maxRangeM } });
  const setHitWidth = (halfWidthM: number) => emitUpdate({
    hitConfig: { ...ar.hitConfig, baseConeHalfAngleDeg: Math.atan(halfWidthM / REF_DIST_M) * (180 / Math.PI) },
  });

  // "Auto": derive hiding/game duration, shot range/width and perk cooldowns
  // from the field size instead of manual presets — the field has no upper
  // size limit anymore, so fixed presets stop making sense once it's much
  // bigger than what they were tuned for. ON by default (server does the
  // same — see arops.js createAropsGame). Same scaleCoreConfig() the server
  // uses once the match actually starts, so this preview matches reality.
  const autoScale = ar.autoScale !== false;
  const autoPreview = useMemo(
    () => (polygon.length >= 3 ? scaleCoreConfig(polygonAreaM2(polygon)) : null),
    [autoScale, JSON.stringify(polygon)]
  );
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const fmtMin = (ms: number) => `${round1(ms / 60_000)}min`;
  const fmtM = (m: number) => `${round1(m)}m`;

  const header = (
    <View>
      {/* Oben: Erkennungsmodus + Debug links, Code rechts */}
      <View style={st.topRow}>
        <View style={st.topLeft}>
          <Icon name="satellite" size={19} color="#f0c840" />
          {isHost && (
            <>
              <TouchableOpacity style={[st.iconBtnLg, hitTrackingMode !== 'ir' && st.smallBtnActive]}
                onPress={() => emitUpdate({ hitTrackingMode: 'compass' })}>
                <Icon name="compass" size={19} color={hitTrackingMode !== 'ir' ? '#f0c840' : '#c0a0f0'} />
              </TouchableOpacity>
              <TouchableOpacity style={[st.iconBtnLg, hitTrackingMode === 'ir' && st.smallBtnActive]}
                onPress={() => emitUpdate({ hitTrackingMode: 'ir' })}>
                <Icon name="flash" size={19} color={hitTrackingMode === 'ir' ? '#f0c840' : '#c0a0f0'} />
              </TouchableOpacity>
              <TouchableOpacity style={[st.iconBtnLg, debugMode && st.smallBtnActive]} onPress={toggleDebugMode}>
                <Icon name="bug" size={19} color={debugMode ? '#f0c840' : '#c0a0f0'} />
              </TouchableOpacity>
            </>
          )}
        </View>
        {lobbyCode && (
          <TouchableOpacity
            style={st.codeChip}
            onPress={() => qr && setQrOpen(true)}
            onLongPress={() => copyToClipboard(lobbyCode, 'code')}
          >
            <Text style={st.codeTxt}>{lobbyCode}</Text>
            <View style={st.codeSubRow}>
              {copied === 'code' && <Icon name="checkCircle" size={9} color="#807050" />}
              <Text style={st.codeSub}>
                {copied === 'code' ? 'kopiert' : qr ? 'antippen: QR · halten: kopieren' : 'halten zum Kopieren'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {isHost && (
        <View style={st.modeRowTight}>
          {SUB_MODES.map(m => (
            <TouchableOpacity key={m.id} style={[st.smallBtnTight, subMode === m.id && st.smallBtnActive]}
              onPress={() => emitUpdate({ subMode: m.id })}
              onLongPress={() => Alert.alert(GAME_MODE_PROFILES[m.id]?.name || m.label, GAME_MODE_PROFILES[m.id]?.shortDescription || '')}>
              <Icon name={m.icon} size={13} color={subMode === m.id ? '#f0c840' : '#c0a0f0'} />
              <Text style={[st.smallTxt, subMode === m.id && st.smallTxtActive]} numberOfLines={1}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {/* Jeder gegen jeden + The Ship sind Varianten von Hide & Seek
          (ar_settings.hsVariant), keine eigenen Modi — daher ein Umschalter
          statt weiterer SUB_MODES-Einträge. */}
      {isHost && subMode === 'hide_and_seek' && (
        <View style={st.rowBtns}>
          <TouchableOpacity style={[st.smallBtnRow, hsVariant === 'classic' && st.smallBtnActive]}
            onPress={() => emitUpdate({ hsVariant: 'classic' })}
            onLongPress={() => Alert.alert('Team', GAME_MODE_PROFILES.hide_and_seek?.shortDescription || '')}>
            <Icon name="ghost" size={13} color={hsVariant === 'classic' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, hsVariant === 'classic' && st.smallTxtActive]}>Team</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.smallBtnRow, hsVariant === 'ffa' && st.smallBtnActive]}
            onPress={() => emitUpdate({ hsVariant: 'ffa' })}
            onLongPress={() => Alert.alert('Jeder gegen jeden',
              GAME_MODE_PROFILES.hide_and_seek?.submodes.find(sm => sm.id === 'ffa')?.shortDescription || '')}>
            <Icon name="crosshair" size={13} color={hsVariant === 'ffa' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, hsVariant === 'ffa' && st.smallTxtActive]}>Jeder gegen jeden</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.smallBtnRow, hsVariant === 'the_ship' && st.smallBtnActive]}
            onPress={() => emitUpdate({ hsVariant: 'the_ship' })}
            onLongPress={() => Alert.alert('The Ship',
              GAME_MODE_PROFILES.hide_and_seek?.submodes.find(sm => sm.id === 'the_ship')?.shortDescription || '')}>
            <Icon name="mask" size={13} color={hsVariant === 'the_ship' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, hsVariant === 'the_ship' && st.smallTxtActive]}>The Ship</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* Alle Modus-spezifischen Einstellungen konsistent direkt unter dem
          Modus-Umschalter, für jeden Modus gleich positioniert (vorher lagen
          Gefunden/Zerstören/Deathmatch-Einstellungen unter der Karte, nur
          hsVariant war oben — uneinheitlich). Domination/CTF haben keine
          echte Variante zum Umschalten, zeigen aber trotzdem eine Zeile in
          derselben Position — sonst wirkt die Lobby inkonsistent (leere
          Lücke bei genau diesen beiden Modi, während jeder andere Modus
          dort etwas zeigt).*/}
      {/* Team/FFA toggle for the 4 team-capable modes — analogous to Hide &
          Seek's variant picker above. Zerstören's 'defuse' sub-variant is
          inherently two-sided (attacker arms / defender defuses) and has no
          ffa reading, so that picker below hides it while ffa is selected. */}
      {teamMode && (
        <View style={st.rowBtns}>
          <TouchableOpacity style={[st.smallBtnRow, teamVariant === 'team' && st.smallBtnActive]}
            disabled={!isHost} onPress={() => emitUpdate({ teamVariant: 'team' })}
            onLongPress={() => Alert.alert('Team (A vs. B)', 'Zwei feste Seiten treten gegeneinander an.')}>
            <Icon name="people" size={13} color={teamVariant === 'team' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, teamVariant === 'team' && st.smallTxtActive]}>Team (A vs. B)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.smallBtnRow, teamVariant === 'ffa' && st.smallBtnActive]}
            disabled={!isHost} onPress={() => emitUpdate({ teamVariant: 'ffa' })}
            onLongPress={() => Alert.alert('Jeder gegen jeden',
              GAME_MODE_PROFILES[subMode]?.submodes.find(sm => sm.id === 'ffa')?.shortDescription || '')}>
            <Icon name="crosshair" size={13} color={teamVariant === 'ffa' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, teamVariant === 'ffa' && st.smallTxtActive]}>Jeder gegen jeden</Text>
          </TouchableOpacity>
          {(subMode === 'ctf' || subMode === 'deathmatch') && (
            <Text style={st.smallTxt}>
              {teamVariant === 'ffa' ? '· Jede/r platziert die eigene Basis' : '· Captain platziert die Basis'}
            </Text>
          )}
        </View>
      )}
      {isHost && rolesApply && (
        <View style={st.rowBtns}>
          <Text style={st.wpCount}>Gefunden:</Text>
          <TouchableOpacity style={[st.smallBtnRow, foundMode === 'spectator' && st.smallBtnActive]}
            onPress={() => emitUpdate({ foundMode: 'spectator' })}>
            <Icon name="ghost" size={13} color={foundMode === 'spectator' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, foundMode === 'spectator' && st.smallTxtActive]}>Zuschauer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.smallBtnRow, foundMode === 'seeker' && st.smallBtnActive]}
            onPress={() => emitUpdate({ foundMode: 'seeker' })}>
            <Icon name="loop" size={13} color={foundMode === 'seeker' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, foundMode === 'seeker' && st.smallTxtActive]}>Weiterspielen (Sucher)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.smallBtnRow, foundMode === 'freeze' && st.smallBtnActive]}
            onPress={() => emitUpdate({ foundMode: 'freeze' })}>
            <Icon name="snowflake" size={13} color={foundMode === 'freeze' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, foundMode === 'freeze' && st.smallTxtActive]}>Einfrieren</Text>
          </TouchableOpacity>
        </View>
      )}
      {isHost && subMode === 'seek_destroy' && (
        <View style={st.rowBtns}>
          <Text style={st.wpCount}>Zerstören:</Text>
          <TouchableOpacity style={[st.smallBtnRow, destroyVariant === 'instant' && st.smallBtnActive]}
            onPress={() => emitUpdate({ destroyVariant: 'instant' })}>
            <Text style={[st.smallTxt, destroyVariant === 'instant' && st.smallTxtActive]}>Symmetrisch</Text>
          </TouchableOpacity>
          {teamVariant === 'team' && (
            <TouchableOpacity style={[st.smallBtnRow, destroyVariant === 'defuse' && st.smallBtnActive]}
              onPress={() => emitUpdate({ destroyVariant: 'defuse' })}>
              <Text style={[st.smallTxt, destroyVariant === 'defuse' && st.smallTxtActive]}>Entschärfen</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[st.smallBtnRow, ar.destroyReactivate && st.smallBtnActive]}
            onPress={() => emitUpdate({ destroyReactivate: !ar.destroyReactivate })}>
            <Icon name="loop" size={13} color={ar.destroyReactivate ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, ar.destroyReactivate && st.smallTxtActive]}>Ziele reaktivieren</Text>
          </TouchableOpacity>
        </View>
      )}
      {isHost && subMode === 'deathmatch' && (
        <View style={st.rowBtns}>
          <Text style={st.wpCount}>Treffer:</Text>
          <TouchableOpacity style={[st.smallBtnRow, deathmatchOnHit === 'respawn' && st.smallBtnActive]}
            onPress={() => emitUpdate({ deathmatchOnHit: 'respawn' })}>
            <Text style={[st.smallTxt, deathmatchOnHit === 'respawn' && st.smallTxtActive]}>Leben verlieren</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.smallBtnRow, deathmatchOnHit === 'freeze' && st.smallBtnActive]}
            onPress={() => emitUpdate({ deathmatchOnHit: 'freeze' })}>
            <Icon name="snowflake" size={13} color={deathmatchOnHit === 'freeze' ? '#f0c840' : '#c0a0f0'} />
            <Text style={[st.smallTxt, deathmatchOnHit === 'freeze' && st.smallTxtActive]}>Einfrieren</Text>
          </TouchableOpacity>
        </View>
      )}
      {isHost && subMode === 'deathmatch' && deathmatchOnHit === 'respawn' && (
        <View style={st.rowBtns}>
          <Text style={st.wpCount}>Leben:</Text>
          {[1, 3, 5].map(n => (
            <TouchableOpacity key={n} style={[st.smallBtn, livesPerPlayer === n && st.smallBtnActive]}
              onPress={() => emitUpdate({ livesPerPlayer: n })}>
              <Text style={[st.smallTxt, livesPerPlayer === n && st.smallTxtActive]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={st.divider} />

      {isHost && (
        <Text style={st.hostHint}>
          Auf die Karte tippen: {tapMode === 'zones' ? 'Zone setzen' : 'Wegpunkt setzen'} — Punkte der Reihe nach im Kreis
        </Text>
      )}

      <View style={st.mapBox}>
        <MapView style={{ flex: 1 }} mapStyle={OSM_STYLE as any} onPress={onMapPress}>
          {/* key changes force MapLibre to re-apply defaultSettings: once when
              our own position resolves (async, arrives after mount), again
              once the field polygon is complete enough to re-center on it. */}
          <Camera key={polygon.length >= 3 ? 'f' : myPos ? 'me' : 'e'}
            defaultSettings={{ centerCoordinate: center, zoomLevel: 14.5 }} />
          {myPos && (
            <ShapeSource id="myPos" shape={{
              type: 'Feature', properties: {},
              geometry: { type: 'Point', coordinates: [myPos.lon, myPos.lat] },
            }}>
              <CircleLayer id="myPosDot" style={{
                circleRadius: 8, circleColor: myPosStale ? '#807050' : '#40a0ff',
                circleOpacity: myPosStale ? 0.5 : 0.85,
                circleStrokeWidth: 2, circleStrokeColor: '#ffffff',
              }} />
            </ShapeSource>
          )}
          {polygon.length >= 3 && (
            <ShapeSource id="field" shape={fieldGeoJSON}>
              <FillLayer id="fieldFill" style={{ fillColor: polyErrs.length ? 'rgba(224,48,32,0.12)' : 'rgba(80,208,64,0.12)' }} />
              <LineLayer id="fieldLine" style={{ lineColor: polyErrs.length ? '#e03020' : '#50d040', lineWidth: 2 }} />
            </ShapeSource>
          )}
          {polygon.length > 0 && (
            <ShapeSource id="wps" shape={waypointsGeoJSON as any}>
              <CircleLayer id="wpDots" style={{ circleRadius: 7, circleColor: '#f0c840', circleStrokeWidth: 2, circleStrokeColor: '#000' }} />
            </ShapeSource>
          )}
          {zones.length > 0 && (
            <ShapeSource id="lz" shape={zonesGeoJSON as any}>
              <CircleLayer id="lzDots" style={{ circleRadius: 11, circleColor: '#40a0ff', circleOpacity: 0.5, circleStrokeWidth: 2, circleStrokeColor: '#40a0ff' }} />
            </ShapeSource>
          )}
        </MapView>
        <TouchableOpacity
          style={st.locateBtn}
          onPress={() => (myPosPermDenied ? Linking.openSettings() : loadMyPosition())}
          disabled={myPosLoading}
        >
          {myPosLoading ? <ActivityIndicator size="small" color="#40a0ff" /> : (
            <Icon name={myPosErr ? 'warning' : 'crosshair'} size={18} color={myPosErr ? '#ff6040' : '#40a0ff'} />
          )}
        </TouchableOpacity>
        {myPosLoading && (
          <View style={st.gpsStatusBadge}>
            <Text style={st.gpsStatusTxt}>
              {/* Android's native one-shot call (see modules/native-location)
                  has no "3 attempts" concept — that's iOS-only below. */}
              {Platform.OS === 'android' ? 'GPS wird gesucht…' : `GPS wird gesucht… (${myPosAttempt + 1}/3)`}
            </Text>
          </View>
        )}
        {!myPosLoading && myPosPermDenied && (
          <View style={st.gpsStatusBadge}>
            <Text style={st.gpsStatusTxt}>Standort-Zugriff verweigert — antippen für Einstellungen</Text>
          </View>
        )}
        {!myPosLoading && !myPosPermDenied && myPosStale && (
          <View style={st.gpsStatusBadge}>
            <Text style={st.gpsStatusTxt}>Letzte bekannte Position</Text>
          </View>
        )}
      </View>

      {ar.comicMap && (
        <View style={st.comicPreviewBox}>
          <MapView style={{ flex: 1 }} mapStyle={BLANK_STYLE as any} scrollEnabled={false} zoomEnabled={false}>
            <Camera defaultSettings={{ centerCoordinate: center, zoomLevel: 14.5 }} />
            <ComicMapLayers features={ar.comicMap.features} />
          </MapView>
          {comicMapStale && (
            <View style={st.comicStaleBadge}>
              <Icon name="warning" size={11} color="#100" />
              <Text style={st.comicStaleTxt}>veraltet</Text>
            </View>
          )}
        </View>
      )}

      {/* Drawing errors: only meaningful for the host while drawing */}
      {isHost && polyErrs.length > 0 && (
        <View style={st.errRow}>
          <Icon name="warning" size={13} color="#ff6040" />
          <Text style={st.err}>{polyErrs.map(e => POLY_ERR_DE[e] || e).join(' · ')}</Text>
        </View>
      )}
      {!isHost && polygon.length < 3 && (
        <View style={st.hintRow}>
          <Icon name="hourglass" size={12} color="#807050" />
          <Text style={st.hint}>Der Host zeichnet das Spielfeld…</Text>
        </View>
      )}

      {isHost && (
        <>
          <View style={st.rowBtns}>
            <TouchableOpacity style={st.iconBtnLg} onPress={() => emitUpdate({ polygon: polygon.slice(0, -1) })} disabled={!polygon.length}>
              <Icon name="undo" size={19} color="#c0a0f0" />
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtnLg} onPress={() => emitUpdate({ polygon: [] })} disabled={!polygon.length}>
              <Icon name="close" size={19} color="#c0a0f0" />
            </TouchableOpacity>
            <Text style={st.wpCount}>{polygon.length}</Text>
            {NEEDS_ZONES[subMode] !== undefined && (
              <>
                <TouchableOpacity style={[st.smallBtn, tapMode === 'polygon' && st.smallBtnActive]} onPress={() => setTapMode('polygon')}>
                  <Text style={[st.smallTxt, tapMode === 'polygon' && st.smallTxtActive]}>Feld</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.smallBtn, tapMode === 'zones' && st.smallBtnActive]} onPress={() => setTapMode('zones')}>
                  <Text style={[st.smallTxt, tapMode === 'zones' && st.smallTxtActive]}>Zonen {zones.length}/{NEEDS_ZONES[subMode]}+</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.iconBtnLg} onPress={() => emitUpdate({ zones: [] })} disabled={!zones.length}>
                  <Icon name="trash" size={19} color="#c0a0f0" />
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={st.iconBtnLg} onPress={generateComicMap}
              disabled={polygon.length < 3 || polyErrs.length > 0 || comicMapLoading}>
              {comicMapLoading ? <ActivityIndicator size="small" color="#c0a0f0" /> : (
                <Icon name={comicMapStale ? 'loop' : 'palette'} size={19} color="#c0a0f0" />
              )}
            </TouchableOpacity>
          </View>
          {!!comicMapErr && (
            <View style={st.errRow}>
              <Icon name="warning" size={13} color="#ff6040" />
              <Text style={st.err}>{comicMapErr}</Text>
            </View>
          )}

          <View style={st.divider} />
          <View style={st.rowBtns}>
            <TouchableOpacity style={[st.smallBtnRow, autoScale && st.smallBtnActive]}
              onPress={() => emitUpdate({ autoScale: !autoScale })}>
              <Icon name="loop" size={13} color={autoScale ? '#f0c840' : '#c0a0f0'} />
              <Text style={[st.smallTxt, autoScale && st.smallTxtActive]}>
                Auto (nach Feldgröße) {autoScale ? 'AN' : 'AUS'}
              </Text>
            </TouchableOpacity>
          </View>
          {autoScale ? (
            <View style={st.rowBtns}>
              <Text style={st.wpCount}>
                {autoPreview
                  ? `Reichweite ~${fmtM(autoPreview.hitRangeM)} · Breite ~${fmtM(autoPreview.hitHalfWidthM * 2)} · Versteckzeit ${fmtMin(autoPreview.hidingDurationMs)} · Spielzeit ${fmtMin(autoPreview.gameDurationMs)}`
                  : 'Erst das Spielfeld zeichnen, um die Auto-Werte zu sehen'}
              </Text>
            </View>
          ) : (
            <>
              <View style={st.rowBtns}>
                <Text style={st.wpCount}>Reichweite:</Text>
                {RANGE_PRESETS.map(m => (
                  <TouchableOpacity key={m} style={[st.smallBtn, hitRangeM === m && st.smallBtnActive]}
                    onPress={() => setHitRange(m)}>
                    <Text style={[st.smallTxt, hitRangeM === m && st.smallTxtActive]}>{m}m</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={st.rowBtns}>
                <Text style={st.wpCount}>Breite:</Text>
                {WIDTH_PRESETS.map(w => {
                  const active = hitHalfAngleDeg !== undefined
                    && Math.abs(hitHalfAngleDeg - Math.atan(w.halfWidthM / REF_DIST_M) * (180 / Math.PI)) < 0.5;
                  return (
                    <TouchableOpacity key={w.label} style={[st.smallBtn, active && st.smallBtnActive]}
                      onPress={() => setHitWidth(w.halfWidthM)}>
                      <Text style={[st.smallTxt, active && st.smallTxtActive]}>{w.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
          <View style={st.divider} />
          {!autoScale && (
            <>
              <View style={st.rowBtns}>
                <Text style={st.wpCount}>Versteckzeit:</Text>
                {HIDING.map(o => (
                  <TouchableOpacity key={o.ms} style={[st.smallBtn, hid === o.ms && st.smallBtnActive]}
                    onPress={() => emitUpdate({ hidingDurationMs: o.ms })}>
                    <Text style={[st.smallTxt, hid === o.ms && st.smallTxtActive]}>{o.l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={st.rowBtns}>
                <Text style={st.wpCount}>Spielzeit:</Text>
                {DURATION.map(o => (
                  <TouchableOpacity key={o.ms} style={[st.smallBtn, dur === o.ms && st.smallBtnActive]}
                    onPress={() => emitUpdate({ gameDurationMs: o.ms })}>
                    <Text style={[st.smallTxt, dur === o.ms && st.smallTxtActive]}>{o.l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <View style={st.divider} />
          <View style={st.rowBtns}>
            <TouchableOpacity style={st.smallBtnRow} onPress={addBot} disabled={bots.length >= 12}>
              <Icon name="robot" size={13} color="#c0a0f0" />
              <Text style={st.smallTxt}>Bot hinzufügen</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      <View style={st.divider} />
      <View style={st.sectionRow}>
        <Icon name="people" size={13} color="#e0c080" />
        <Text style={st.section}>
          Spieler {isHost ? ((teamMode && teamVariant === 'team') ? '(Team antippen)' : rolesApply ? '(Rolle antippen)' : '') : ''}
        </Text>
      </View>
    </View>
  );

  const footer = (
    <View>
      {me && displayMembers.length > 0 && ((teamMode && teamVariant === 'team') || rolesApply) && (
        <View style={st.roleRow}>
          <Icon name={teamMode ? 'circle' : (roleOf(me.id) === 'seeker' ? 'flashlight' : 'ghost')}
            size={14} color={teamMode ? (teamOf(me.id) === 'a' ? '#40a0ff' : '#ff5050') : '#e0c080'} />
          <Text style={st.role}>
            {teamMode
              ? `Dein Team: ${teamOf(me.id) === 'a' ? 'A' : 'B'}`
              : `Deine Rolle: ${roleOf(me.id) === 'seeker' ? 'Seeker' : 'Hider'}`}
          </Text>
        </View>
      )}
      {me && displayMembers.length > 0 && !(teamMode && teamVariant === 'team') && !rolesApply && (
        <View style={st.roleRow}>
          <Icon name={hsVariant === 'the_ship' ? 'mask' : 'crosshair'} size={14} color="#e0c080" />
          <Text style={st.role}>
            {hsVariant === 'the_ship'
              ? 'Dein Ziel wird nur dir angezeigt, sobald das Spiel startet'
              : teamMode && teamVariant === 'ffa'
              ? 'Jeder gegen jeden — jeder spielt für sich, keine Teams'
              : 'Jeder gegen jeden — keine festen Rollen oder Teams'}
          </Text>
        </View>
      )}
      {!!startErr && (
        <View style={st.errRow}>
          <Icon name="warning" size={13} color="#ff6040" />
          <Text style={st.err}>{startErr}</Text>
        </View>
      )}
      <TouchableOpacity style={[st.btn, ready && st.btnActive]} onPress={toggleReady}>
        <View style={st.btnRow}>
          <Icon name={ready ? 'checkCircle' : 'checkboxBlank'} size={15} color="#80ff40" />
          <Text style={st.btnTxt}>{ready ? 'Bereit' : 'Bereit?'}</Text>
        </View>
      </TouchableOpacity>
      {isHost && (
        <TouchableOpacity style={st.startBtn} onPress={startGame}>
          <View style={st.btnRow}>
            <Icon name="rocket" size={15} color="#e060ff" />
            <Text style={st.startTxt}>Spiel starten</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={st.wrap}>
      <FlatList
        data={displayMembers}
        keyExtractor={m => m.id}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={st.row}>
            {item.isBot && <Icon name="robot" size={13} color="#807050" />}
            <Text style={st.name}>{item.username}</Text>
            {(teamMode && teamVariant === 'team') ? (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => toggleTeam(item.id)}>
                <Icon name="circle" size={11} color={teamOf(item.id) === 'a' ? '#40a0ff' : '#ff5050'} />
                <Text style={[st.roleTag, { color: teamOf(item.id) === 'a' ? '#40a0ff' : '#ff5050' }]}>
                  {teamOf(item.id) === 'a' ? 'Team A' : 'Team B'}
                </Text>
              </TouchableOpacity>
            ) : rolesApply ? (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => toggleRole(item.id)}>
                <Icon name={roleOf(item.id) === 'seeker' ? 'flashlight' : 'ghost'} size={13} color="#c0a0f0" />
                <Text style={st.roleTag}>{roleOf(item.id) === 'seeker' ? 'Seeker' : 'Hider'}</Text>
              </TouchableOpacity>
            ) : null}
            {hitTrackingMode === 'ir' && (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => cycleIrId(item.id)}>
                <Icon name="flash" size={12} color="#f0c840" />
                <Text style={st.roleTag}>{irIdOf(item.id) !== undefined ? `IR ${irIdOf(item.id)}` : 'IR –'}</Text>
              </TouchableOpacity>
            )}
            {/* Klasse (scout/sniper/bomber) — additiv zu Rolle/Team, jeder
                Modus, optional. Tap zum Durchschalten wie IR-ID oben;
                Long-Press zeigt die Steckbrief-Kurzbeschreibung (Tooltip-
                Pattern für Touch-Geräte, siehe AR-Ops-Modi-Plan Phase 7). */}
            <TouchableOpacity disabled={!isHost} style={st.roleTagRow}
              onPress={() => cycleClass(item.id)}
              onLongPress={() => {
                const cls = classOf(item.id);
                Alert.alert(
                  cls ? PLAYER_TYPE_PROFILES[cls].name : 'Keine Klasse',
                  cls ? PLAYER_TYPE_PROFILES[cls].shortDescription : 'Standard-Schusswerte, kein Klassen-Perk.'
                );
              }}>
              <Icon name="shieldAccount" size={12} color={classOf(item.id) ? '#f0c840' : '#807050'} />
              <Text style={[st.roleTag, classOf(item.id) && { color: '#f0c840' }]}>
                {classOf(item.id) ? PLAYER_TYPE_PROFILES[classOf(item.id)!].name : '–'}
              </Text>
            </TouchableOpacity>
            <Icon name={item.ready ? 'checkCircle' : 'checkboxBlank'} size={14}
              color={item.ready ? '#80ff40' : '#807050'} style={{ marginLeft: 8 }} />
            {isHost && item.isBot && (
              <TouchableOpacity onPress={() => removeBot(item.id)} style={{ marginLeft: 8 }}>
                <Icon name="close" size={14} color="#ff6040" />
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      {/* QR popup */}
      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <TouchableOpacity style={st.modalBg} activeOpacity={1} onPress={() => setQrOpen(false)}>
          <View style={st.modalBox}>
            <Text style={st.modalCode}>{lobbyCode}</Text>
            {qr && <Image source={{ uri: qr }} style={{ width: 260, height: 260, borderRadius: 8 }} />}
            {qrUrl && (
              <TouchableOpacity onLongPress={() => copyToClipboard(qrUrl, 'link')} activeOpacity={0.6} style={st.btnRow}>
                {copied === 'link' && <Icon name="checkCircle" size={12} color="#40a0ff" />}
                <Text style={st.linkTxt} numberOfLines={1} ellipsizeMode="middle">
                  {copied === 'link' ? 'Link kopiert' : qrUrl}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={st.hint}>Zum Beitreten scannen · Link halten zum Kopieren · Tippen zum Schließen</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810', padding: 16, paddingTop: 52 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  topLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  modeRowTight: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  smallBtnTight: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: 'rgba(40,32,64,.6)', borderWidth: 1, borderColor: '#2a2040',
    borderRadius: 7, paddingHorizontal: 4, paddingVertical: 7,
  },
  codeChip: { backgroundColor: 'rgba(240,200,64,.12)', borderWidth: 1.5, borderColor: '#f0c840', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6, alignItems: 'center' },
  codeTxt: { color: '#f0c840', fontSize: 18, fontWeight: '900', letterSpacing: 2, fontFamily: 'monospace' as any },
  codeSubRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  codeSub: { color: '#807050', fontSize: 9 },
  hostHint: { color: '#807050', fontSize: 11, marginBottom: 8 },
  mapBox: { height: 230, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  locateBtn: {
    position: 'absolute', bottom: 10, right: 10, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(20,16,32,.9)', borderWidth: 1.5, borderColor: '#40a0ff',
    alignItems: 'center', justifyContent: 'center',
  },
  gpsStatusBadge: {
    position: 'absolute', bottom: 14, left: 10, backgroundColor: 'rgba(20,16,32,.9)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#40a0ff',
  },
  gpsStatusTxt: { color: '#40a0ff', fontSize: 10, fontWeight: '700' },
  comicPreviewBox: { height: 160, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  comicStaleBadge: {
    position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f0c840', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  comicStaleTxt: { color: '#100', fontSize: 10, fontWeight: '800' },
  rowBtns: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  smallBtn: { backgroundColor: 'rgba(40,32,64,.6)', borderWidth: 1, borderColor: '#2a2040', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  smallBtnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(40,32,64,.6)',
    borderWidth: 1, borderColor: '#2a2040', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7,
  },
  smallBtnActive: { borderColor: '#f0c840', backgroundColor: 'rgba(240,200,64,.14)' },
  smallBtnDisabled: { opacity: 0.5 },
  iconBtnLg: {
    width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(40,32,64,.6)', borderWidth: 1, borderColor: '#2a2040',
  },
  smallTxt: { color: '#c0a0f0', fontSize: 12, fontWeight: '700' },
  smallTxtActive: { color: '#f0c840' },
  wpCount: { color: '#807050', fontSize: 11 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, marginBottom: 4 },
  section: { color: '#e0c080', fontSize: 12, fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#2a2040', marginVertical: 10 },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 },
  hint: { color: '#807050', fontSize: 12, textAlign: 'center' },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  err: { color: '#ff6040', fontSize: 12 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 8 },
  role: { color: '#e0c080', fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1428', gap: 8 },
  name: { flex: 1, color: '#e0c080', fontSize: 14 },
  roleTagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roleTag: { fontSize: 13, color: '#c0a0f0', fontWeight: '700' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { backgroundColor: 'rgba(60,160,20,.2)', borderWidth: 2, borderColor: '#3a8020', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnActive: { backgroundColor: 'rgba(60,160,20,.45)' },
  btnTxt: { color: '#80ff40', fontSize: 15, fontWeight: '800' },
  startBtn: { backgroundColor: 'rgba(160,60,200,.25)', borderWidth: 2, borderColor: '#803aa0', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  startTxt: { color: '#e060ff', fontSize: 15, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center' },
  modalBox: { backgroundColor: '#141020', borderWidth: 2, borderColor: '#f0c840', borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
  modalCode: { color: '#f0c840', fontSize: 26, fontWeight: '900', letterSpacing: 4, fontFamily: 'monospace' as any },
  linkTxt: { color: '#40a0ff', fontSize: 12, fontFamily: 'monospace' as any, maxWidth: 260, textDecorationLine: 'underline' },
});
