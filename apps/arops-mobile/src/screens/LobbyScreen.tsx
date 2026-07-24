import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Modal, ActivityIndicator, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import { getSocket, getUser, fetchLobbyQr, saveLastPosition, getDebugEnabled, fetchPlayableHuntScenarios, PlayableHuntScenario } from '../api';
import Icon, { IconName } from '../components/Icon';
import ComicMapLayers, { ComicFeature } from '../components/ComicMapLayers';
import { OSM_STYLE, OSM_STYLE_DARK, blankMapStyle } from '../mapStyle';
import { polygonAreaM2, scaleCoreConfig, scaleTimings, PLAYER_TYPE_PROFILES, GAME_MODE_PROFILES } from '@craftworks/arops-shared';
import { useTelemetry } from '../hooks/useTelemetry';
import { useTheme, ThemeTokens, THEMES } from '../theme';

interface ComicMap { features: ComicFeature[]; polygonSnapshot: string; fetchedAt: number; }
const COMIC_MAP_ERR_DE: Record<string, string> = {
  not_host: 'Nur der Host kann das', wrong_mode: 'Falscher Modus',
  no_polygon: 'Erst das Spielfeld zeichnen', invalid_polygon: 'Spielfeld ungültig',
  lobby_not_found: 'Lobby nicht gefunden', generation_failed: 'Erzeugung fehlgeschlagen — erneut versuchen',
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
  // 2 independent toggles now: what a found hider becomes when NOT frozen
  // (seeker/spectator), and whether freeze is even an option — freeze
  // always wins over foundMode when on (see server's cfg.foundMode
  // derivation in arops.js).
  foundMode?: 'spectator' | 'seeker';
  hiderCanFreeze?: boolean;
  // Hide & Seek variant: 'classic' (default, seeker/hider), 'ffa' (Jeder
  // gegen jeden — no roles/teams) or 'the_ship' (secret assassin-chain, no
  // roles) — see server's MODES.hide_and_seek.
  hsVariant?: 'classic' | 'ffa' | 'the_ship';
  // Team/FFA variant for the 4 team-capable modes (domination, ctf,
  // seek_destroy, deathmatch) — see server's cfg.teamVariant in arops.js.
  teamVariant?: 'team' | 'ffa';
  // Zerstören (seek_destroy): symmetric capture vs. attacker-arms/defender-defuses
  // — 'instant' always reactivates destroyed targets ("mit Restore"), 'defuse'
  // never does, no separate host toggle for that anymore (see arops.js).
  destroyVariant?: 'instant' | 'defuse';
  // Domination/Zerstören (instant): contested by an unfrozen opponent
  // cancels the capture attempt (progress resets to 0) instead of just
  // pausing it — see arops.js's cfg.contestResets.
  contestResets?: boolean;
  // "Team Capture": requires several teammates simultaneously in the
  // zone/target to capture instead of just one — see arops.js's
  // cfg.teamCaptureEnabled/cfg.teamCaptureSize. Never applies to ffa.
  teamCaptureEnabled?: boolean;
  teamCaptureSize?: 2 | 3 | 'all';
  // On-hit consequence + lives (respawn variant only) — all 4 combat modes
  // (Domination, CTF, Seek&Destroy, Deathmatch).
  onHit?: 'respawn' | 'freeze';
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
  // Freeze-time/Basis-Setup-Zeit overrides (host-adjustable, see the
  // Lobby's freeze-time/Vorbereitung rows) — the rest of ModeTimings stays
  // test-only, not host-facing.
  timings?: { freezeMs?: number | null; baseSettingMs?: number | null };
  autoScale?: boolean;
  // Schnitzeljagd: which pre-authored scenario this lobby will run — the
  // only lobby-side setting this mode has (see server's socket/game.js
  // lobby:start preflight, which loads the scenario's POIs/routes and
  // synthesizes a field polygon from them; there's no polygon-drawing step
  // for this mode at all).
  huntScenarioId?: string;
}

const RANGE_PRESETS = [30, 50, 75, 100];

// Short labels — 5 modes need to fit on one line (host screen real estate).
const SUB_MODES: { id: string; icon: IconName; label: string }[] = [
  { id: 'hide_and_seek', icon: 'ghost', label: 'H&S' },
  { id: 'domination', icon: 'target', label: 'DOM' },
  { id: 'ctf', icon: 'flag', label: 'CtF' },
  { id: 'seek_destroy', icon: 'bomb', label: 'Bomb' },
  { id: 'deathmatch', icon: 'skull', label: 'DM' },
  { id: 'schnitzeljagd', icon: 'flagCheckered', label: 'Hunt' },
];
const NEEDS_ZONES: Record<string, number> = { domination: 2, seek_destroy: 1 };
// Modes with real team assignment — hide_and_seek (all 3 variants: classic,
// ffa "Jeder gegen jeden", the_ship) has no teams at all (usesTeams: false
// server-side, see arops.js's MODES table).
const TEAM_MODES = ['domination', 'ctf', 'seek_destroy', 'deathmatch'];
const POLY_ERR_DE: Record<string, string> = {
  too_few_points: 'Mind. 3 Wegpunkte setzen',
  self_intersecting: 'Fläche überschneidet sich — Punkte der Reihe nach im Kreis setzen',
  area_too_small: 'Fläche zu klein (min. 400 m² / 20×20m)',
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
  ar_no_hunt_scenario: 'Szenario auswählen',
  ar_hunt_scenario_not_found: 'Szenario nicht gefunden',
  ar_hunt_scenario_empty: 'Szenario hat keine Stationen',
};
// Applied once when Debug-Mode is switched on — host can still retune via the
// normal pickers afterward, nothing here is locked in.
const DEBUG_COOLDOWNS = {
  hidingDurationMs: 5_000, gameDurationMs: 180_000, hitCooldownMs: 500,
  radarCooldownMs: 15_000, droneCooldownMs: 15_000, cloakCooldownMs: 15_000,
  fakeMarkerCooldownMs: 15_000, aufscheuchenCooldownMs: 15_000,
};

// One button per toggle, not one button per option — tapping cycles to the
// next option (2 options = a plain flip), the button's own icon always
// shows whichever is CURRENT. Icon-only, no text label (long-press still
// gives the full name/explanation via Alert) — this row was getting
// crowded/wordy with every toggle spelling itself out; `label` stays on
// the options shape purely for the long-press Alert title.
function CycleToggle<T extends string>({
  options, value, onChange, theme, st, disabled,
}: {
  options: { value: T; icon: IconName; label: string; title: string; body: string }[];
  value: T;
  onChange: (v: T) => void;
  theme: ThemeTokens;
  st: ReturnType<typeof makeStyles>;
  disabled?: boolean;
}) {
  const idx = Math.max(0, options.findIndex(o => o.value === value));
  const current = options[idx]!;
  return (
    <TouchableOpacity style={[st.smallBtn, st.toggleOn]} disabled={disabled}
      onPress={() => onChange(options[(idx + 1) % options.length]!.value)}
      onLongPress={() => Alert.alert(current.title, current.body)}>
      <Icon name={current.icon} size={15} color={theme.onAccent} />
    </TouchableOpacity>
  );
}

export default function LobbyScreen({
  lobbyId, isHost = false, lobbyCode, onGameStart,
}: { lobbyId: string; isHost?: boolean; lobbyCode?: string; onGameStart: (sessionId: string) => void }) {
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  // Map tiles fake a dark-mode look (mapStyle.ts's OSM_STYLE_DARK) for both
  // dark UI themes ('color', the original dark-purple default, and 'night') —
  // only 'day' keeps the stock light OSM raster look. `theme` is the exact
  // object reference ThemeProvider hands out per name (see theme.ts), so
  // comparing against THEMES.day avoids threading the ThemeName itself down
  // through props just for this.
  const mapStyle = theme === THEMES.day ? OSM_STYLE : OSM_STYLE_DARK;
  const comicMapStyle = useMemo(() => blankMapStyle(theme.bg), [theme]);
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
  // Gates the per-lobby debug toggle below (fog-of-war off etc.) — app-wide
  // Debug-Modus setting, see Einstellungen. Match-Simulation itself moved
  // back to its own main-menu entry point (App.tsx) — see MatchSimScreen.tsx.
  const debugEnabled = useMemo(() => getDebugEnabled(), []);
  const [comicMapLoading, setComicMapLoading] = useState(false);
  const [comicMapErr, setComicMapErr] = useState('');
  // Schnitzeljagd scenario picker (host-only) — fetched once, not gated on
  // isHunt/isHost so switching into the mode never shows an empty flash
  // while a request is still in flight.
  const [huntScenarios, setHuntScenarios] = useState<PlayableHuntScenario[]>([]);
  useEffect(() => { fetchPlayableHuntScenarios().then(setHuntScenarios); }, []);
  // GPS/compass acquisition — adopted from GameScreen's own useTelemetry()
  // hook instead of this screen's former ~180-line bespoke retry/watchdog
  // implementation (see git history for that version's own hard-won fixes,
  // now superseded). Passing sessionId=null disables the hook's 1Hz
  // telemetry-SEND loop entirely (gated on `socket && sessionId`, see
  // useTelemetry.ts) — only the GPS/compass ACQUISITION side runs here,
  // which is all this screen ever needed. The hook's own doc comment warns
  // against mounting it outside GameScreen's lifetime (an earlier attempt
  // hoisted to App.tsx correlated with the whole app becoming unresponsive)
  // — LobbyScreen doesn't do that: it has the same bounded "in this one
  // place for a while, then leave" lifecycle GameScreen itself has, not the
  // always-mounted app-wide scope that caused that regression.
  const telemetry = useTelemetry(getSocket(), null, true);
  const myPos = telemetry.sample ? { lat: telemetry.sample.lat, lon: telemetry.sample.lon } : null;
  // Same grace-period concept as GameScreen's own GPS fab (see there): the
  // first few seconds without a fix are normal, only shown as a real problem
  // (red) once it's gone on long enough that it probably isn't just still
  // starting up.
  const [initGraceOver, setInitGraceOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setInitGraceOver(true), 10_000);
    return () => clearTimeout(t);
  }, []);
  // Keeps api.ts's getLastPosition() cache warm for other flows that fall
  // back to it (e.g. MatchSimScreen's origin resolution) — useTelemetry
  // itself has no equivalent (GameScreen never needed one), but there's no
  // harm in this screen still doing it since GPS acquisition is otherwise
  // identical.
  useEffect(() => {
    if (telemetry.sample) saveLastPosition(telemetry.sample.lat, telemetry.sample.lon);
  }, [telemetry.sample]);
  const me = getUser();
  const arRef = useRef(ar);
  arRef.current = ar;
  const comicMapReqRef = useRef<string | null>(null);

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
    const onComicMapError = ({ reqId, err }: any) => {
      if (reqId !== comicMapReqRef.current) return;
      setComicMapLoading(false);
      setComicMapErr(COMIC_MAP_ERR_DE[err] || 'Fehler beim Generieren');
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
  const isHunt = subMode === 'schnitzeljagd';
  const teamMode = TEAM_MODES.includes(subMode);
  const hsVariant = ['ffa', 'the_ship'].includes(ar.hsVariant || '') ? ar.hsVariant! : 'classic';
  // ffa/The Ship have no roles at all (not seeker/hider, not team) —
  // role/team assignment UI only makes sense for the classic variant.
  const rolesApply = subMode === 'hide_and_seek' && hsVariant === 'classic';
  const teamVariant = teamMode && ar.teamVariant === 'ffa' ? 'ffa' : 'team';
  const foundMode = ar.foundMode === 'seeker' ? 'seeker' : 'spectator';
  const hiderCanFreeze = ar.hiderCanFreeze === true;
  const destroyVariant = ar.destroyVariant === 'defuse' ? 'defuse' : 'instant';
  // 'freeze' is every combat mode's original, pre-toggle default (only
  // Deathmatch defaulted to 'respawn') — mirrors arops.js createAropsGame's
  // defaultOnHit exactly.
  const onHit = ar.onHit === 'respawn' || ar.onHit === 'freeze' ? ar.onHit : (subMode === 'deathmatch' ? 'respawn' : 'freeze');
  const livesPerPlayer = ar.livesPerPlayer || 3;
  const bots = ar.bots || [];
  const debugMode = ar.debugMode || false;
  const hitTrackingMode = ar.hitTrackingMode || 'compass';
  const selectedHuntScenario = huntScenarios.find(s => s.id === ar.huntScenarioId);
  // Schnitzeljagd only needs team formation when its chosen scenario was
  // authored with progressMode==='teams' (see hunt_scenarios.config) —
  // reuses the exact same toggleTeam/teamOf roster UI every other team
  // mode already has, just gated open for this one extra case.
  const huntTeams = isHunt && selectedHuntScenario?.progress_mode === 'teams';
  const showTeamToggle = (teamMode && teamVariant === 'team') || huntTeams;
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
  // Player classes (scout/sniper/bomber) — additive to role/team. Scout is
  // now the server-side default for anyone unset (see effectiveArSettings/
  // createAropsGame in arops.js) — "none" is no longer a real, reachable
  // state, so this is a true wrap-around cycle now: scout -> sniper ->
  // bomber -> scout -> … The old none -> scout -> sniper -> bomber -> none
  // cycle had a real bug once that changed: tapping the row while it
  // already (correctly) showed the default "Scout" moved AWAY from it to
  // Sniper, since idx=0 -> next=CLASS_CYCLE[1]='sniper' — reported as
  // "started as Scout, overlay was still Sniper" is consistent with
  // exactly that trap.
  const CLASS_CYCLE = ['scout', 'sniper', 'bomber'] as const;
  const classOf = (uid: string) => ar.classes?.[uid] ?? 'scout';
  const cycleClass = (uid: string) => {
    if (!isHost) return;
    const idx = CLASS_CYCLE.indexOf(classOf(uid));
    const next = CLASS_CYCLE[(idx + 1) % CLASS_CYCLE.length];
    emitUpdate({ classes: { ...(ar.classes || {}), [uid]: next } });
  };

  // Which kind of point was placed most recently — "Schritt zurück" below
  // undoes whichever this is (target/zone or field/geofence point), not just
  // one or the other.
  const [lastEditType, setLastEditType] = useState<'polygon' | 'zones' | null>(null);
  const onMapPress = (feature: any) => {
    if (!isHost) return;
    // No explicit "retry GPS on tap" needed anymore — useTelemetry already
    // retries continuously in the background on its own (see its internal
    // watchdog), the same way GameScreen just lets it run.
    const c = feature?.geometry?.coordinates;
    if (!Array.isArray(c)) return;
    if (tapMode === 'zones' && NEEDS_ZONES[subMode] !== undefined) {
      emitUpdate({ zones: [...zones, { lat: c[1], lon: c[0] }] });
      setLastEditType('zones');
    } else {
      emitUpdate({ polygon: [...polygon, { lat: c[1], lon: c[0] }] });
      setLastEditType('polygon');
    }
  };
  const undoLastPoint = () => {
    if (lastEditType === 'zones' && zones.length) {
      emitUpdate({ zones: zones.slice(0, -1) });
    } else if (polygon.length) {
      emitUpdate({ polygon: polygon.slice(0, -1) });
      setLastEditType('polygon');
    } else if (zones.length) {
      emitUpdate({ zones: zones.slice(0, -1) });
      setLastEditType('zones');
    }
  };
  // Clears every point (field + zones) but keeps the comic map and the
  // current map viewport — see everHadFieldRef below, which stops the
  // Camera from jumping back to the own-position view once the field
  // polygon empties out again.
  const clearAllPoints = () => {
    setLastEditType(null);
    emitUpdate({ polygon: [], zones: [] });
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

  // Generation is now a fully local, instant computation on the server (no
  // external service, no rate limit to respect) — auto-(re)generate any
  // time the host's polygon changes and is valid, debounced so dragging a
  // point around doesn't fire a request per pixel. Skips re-requesting for
  // a polygon that's already reflected in the current comic map. No extra
  // fallback needed on failure: GameScreen already falls back to plain OSM
  // tiles whenever no comic map exists (see hasComicMap there); the manual
  // retry button below still covers a one-off socket hiccup.
  useEffect(() => {
    if (!isHost) return;
    if (polygon.length < 3 || polyErrs.length > 0) return;
    if (ar.comicMap?.polygonSnapshot === JSON.stringify(polygon)) return;
    const t = setTimeout(() => generateComicMap(), 400);
    return () => clearTimeout(t);
  }, [isHost, polygon, polyErrs.length, ar.comicMap?.polygonSnapshot, comicMapLoading]);

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
  // Latches once the field polygon first reaches 3 points — used for the
  // Camera's `key` below so clearing all points (Papierkorb) doesn't jump
  // the viewport back to the own-position view; without this, the key would
  // flip from 'f' back to 'me' the instant polygon.length drops under 3,
  // forcing MapLibre to re-apply defaultSettings and recenter.
  const everHadFieldRef = useRef(false);
  if (polygon.length >= 3) everHadFieldRef.current = true;

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
  // Phase 2 (gameDurationMs): 5/15/30min auto-scale range, plus 3h/6h for
  // very large fields — manual ceiling (platform.js) allows up to 6h even
  // though auto-scale itself never derives past 60min.
  const DURATION = [
    { l: '5m', ms: 300_000 }, { l: '15m', ms: 900_000 }, { l: '30m', ms: 1_800_000 },
    { l: '3h', ms: 10_800_000 }, { l: '6h', ms: 21_600_000 },
  ];
  // Phase 1 (baseSettingMs — CTF always, Domination/S&D/Deathmatch only
  // with onHit==='respawn'): 1/2/5min auto-scale range, plus 15min manual.
  const BASE_SETTING_OPTIONS = [
    { l: '1m', ms: 60_000 }, { l: '2m', ms: 120_000 }, { l: '5m', ms: 300_000 }, { l: '15m', ms: 900_000 },
  ];
  const baseSettingMs: number | null = ar.timings?.baseSettingMs ?? null;
  // Freeze duration is always field-size-scaled by default (server's
  // scaleTimings, 3-30s range, independent of autoScale) but host-adjustable
  // here like Reichweite/Versteckzeit/Spielzeit — hidden while Auto is on
  // (see !autoScale gate below), same convention as those.
  const FREEZE_OPTIONS: { l: string; ms: number }[] = [
    { l: '3s', ms: 3_000 }, { l: '10s', ms: 10_000 }, { l: '30s', ms: 30_000 },
  ];
  const hitRangeM = ar.hitConfig?.maxRangeM || 75;
  const setHitRange = (maxRangeM: number) => emitUpdate({ hitConfig: { ...ar.hitConfig, maxRangeM } });

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
  // Freeze duration is always field-size-scaled server-side (scaleTimings,
  // independent of the autoScale toggle — see arops.js createAropsGame) —
  // computed here purely for the preview line below, same field area input
  // as autoPreview.
  const autoFreezeMs = useMemo(
    () => (polygon.length >= 3 ? scaleTimings(polygonAreaM2(polygon)).freezeMs : null),
    [JSON.stringify(polygon)]
  );
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const fmtMin = (ms: number) => `${round1(ms / 60_000)}min`;
  const fmtM = (m: number) => `${round1(m)}m`;
  const fmtSec = (ms: number) => `${Math.round(ms / 1000)}s`;
  // Lives only matter for the 4 combat modes' respawn variant (elimination),
  // never under freeze — see resolveCombatHit in arops.js. Freeze time only
  // matters wherever a freeze can actually happen: the combat modes' freeze
  // variant, or Hide & Seek's foundMode==='freeze'.
  const showLivesInPreview = teamMode && onHit === 'respawn';
  const showFreezeInPreview = (teamMode && onHit === 'freeze')
    || (subMode === 'hide_and_seek' && hiderCanFreeze);
  // Base-Setup-Zeit only matters where a base actually gets placed — CTF
  // always, the other 3 team-capable modes only in the respawn variant
  // (see MODES' initialPhase in arops.js: onHit==='respawn' → 'base_setup',
  // onHit==='freeze' → the base-less 'warmup' phase instead).
  const showBaseSettingInPreview = teamMode && (subMode === 'ctf' || onHit === 'respawn');
  const freezeMs: number | null = ar.timings?.freezeMs ?? null;

  const header = (
    <View>
      {/* Oben: Erkennungsmodus + Debug links, Code rechts */}
      <View style={st.topRow}>
        <View style={st.topLeft}>
          <Icon name="satellite" size={19} color={theme.accent} />
          {/* Kompass-Modus-Button verschmilzt jetzt mit dem GPS-Status: Icon
              gelb (theme.accent) sobald Kompass-Modus aktiv UND ein Fix da
              ist, rot (Icon + Rahmen) wenn Kompass-Modus aktiv ist aber kein
              Fix (Grace-Zeit um), sonst grau wie jeder unausgewählte
              Modus-Button. Für ALLE Lobby-Mitglieder sichtbar und antippbar
              (GPS-Retry funktioniert für jeden), aber nur der Host kann den
              Modus damit tatsächlich wechseln. */}
          <TouchableOpacity
            style={[
              st.iconBtnLg,
              hitTrackingMode !== 'ir' && st.smallBtnActive,
              hitTrackingMode !== 'ir' && !telemetry.sample && initGraceOver && st.iconBtnDanger,
            ]}
            onPress={() => { if (isHost) emitUpdate({ hitTrackingMode: 'compass' }); telemetry.retryPosition(); }}>
            <Icon name="compass" size={19}
              color={hitTrackingMode === 'ir' ? theme.text2
                : telemetry.sample ? theme.accent
                : initGraceOver ? theme.danger : theme.text2} />
          </TouchableOpacity>
          {isHost && (
            <>
              <TouchableOpacity style={[st.iconBtnLg, hitTrackingMode === 'ir' && st.smallBtnActive]}
                onPress={() => emitUpdate({ hitTrackingMode: 'ir' })}>
                <Icon name="flash" size={19} color={hitTrackingMode === 'ir' ? theme.accent : theme.text2} />
              </TouchableOpacity>
              {/* Per-Lobby-Debug (Fog-of-War aus etc.) — nur anbietbar, wenn
                  der App-weite Entwickler-Schalter (Einstellungen) an ist,
                  sonst bleibt dieser Toggle für alle Hosts unsichtbar. */}
              {debugEnabled && (
                <TouchableOpacity style={[st.iconBtnLg, debugMode && st.smallBtnActive]} onPress={toggleDebugMode}>
                  <Icon name="bug" size={19} color={debugMode ? theme.accent : theme.text2} />
                </TouchableOpacity>
              )}
            </>
          )}
          {/* Non-Host: kein Toggle (das bleibt Host-Sache), aber sichtbare
              Anzeige sobald debugMode aktiv ist — debug hebt die Fog-of-War
              für ALLE Spieler auf (Server: getAropsSnapshot überspringt die
              reveal-Prüfung komplett), das lief bisher unsichtbar für jeden
              außer dem Host, der es selbst gesetzt hat. Nur sichtbar wenn
              aktiv (kein totes Icon für den Normalfall). */}
          {!isHost && debugMode && (
            <View style={[st.iconBtnLg, st.smallBtnActive]}>
              <Icon name="bug" size={19} color={theme.accent} />
            </View>
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
              {copied === 'code' && <Icon name="checkCircle" size={9} color={theme.text3} />}
              <Text style={st.codeSub}>
                {copied === 'code' ? 'kopiert' : qr ? 'antippen: QR · halten: kopieren' : 'halten zum Kopieren'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {isHost && (
        <View style={st.modeRowOuter}>
          <View style={st.modeRowTight}>
            {SUB_MODES.map(m => (
              <TouchableOpacity key={m.id} style={[st.smallBtnTight, subMode === m.id && st.smallBtnActive]}
                onPress={() => emitUpdate({ subMode: m.id })}
                onLongPress={() => Alert.alert(GAME_MODE_PROFILES[m.id]?.name || m.label, GAME_MODE_PROFILES[m.id]?.shortDescription || '')}>
                <Icon name={m.icon} size={13} color={subMode === m.id ? theme.accent : theme.text2} />
                <Text style={[st.smallTxt, subMode === m.id && st.smallTxtActive]} numberOfLines={1}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {/* Jeder gegen jeden + The Ship sind Varianten von Hide & Seek
          (ar_settings.hsVariant), keine eigenen Modi — daher ein Umschalter
          statt weiterer SUB_MODES-Einträge. */}
      {isHost && subMode === 'hide_and_seek' && (
        <View style={st.rowBtns}>
          {/* Toggle 1: Team / Single (Jeder gegen jeden) / The Ship — ein
              Button, der durchschaltet, statt 3 nebeneinander. */}
          <CycleToggle theme={theme} st={st} value={hsVariant}
            onChange={v => emitUpdate({ hsVariant: v })}
            options={[
              { value: 'classic', icon: 'ghost', label: 'Team', title: 'Team', body: GAME_MODE_PROFILES.hide_and_seek?.shortDescription || '' },
              { value: 'ffa', icon: 'crosshair', label: 'Jeder gegen jeden', title: 'Jeder gegen jeden',
                body: GAME_MODE_PROFILES.hide_and_seek?.submodes.find(sm => sm.id === 'ffa')?.shortDescription || '' },
              { value: 'the_ship', icon: 'mask', label: 'The Ship', title: 'The Ship',
                body: GAME_MODE_PROFILES.hide_and_seek?.submodes.find(sm => sm.id === 'the_ship')?.shortDescription || '' },
            ]} />
          {/* Toggle 2 + Toggle 3 — 2 unabhängige Schalter statt eines
              verschmolzenen 3-Wege-Werts: was ein gefundener Hider wird,
              WENN er nicht einfriert (Sucher/Zuschauer), und getrennt davon
              ob Freeze für Hider überhaupt aktiv ist — Freeze AN gewinnt
              immer, unabhängig vom Sucher/Zuschauer-Toggle (siehe
              arops.js's cfg.foundMode-Herleitung). Nur bei classic sichtbar
              (rolesApply) — ffa/The Ship haben keine Rollen, also nichts
              "Gefundenes". */}
          {isHost && rolesApply && (
            <>
              <CycleToggle theme={theme} st={st} value={foundMode}
                onChange={v => emitUpdate({ foundMode: v })}
                options={[
                  { value: 'seeker', icon: 'magnify', label: 'Weiter: Sucher', title: 'Weiterspielen (Sucher)', body: 'Gefundene Hider spielen sofort als Sucher weiter (falls nicht eingefroren).' },
                  { value: 'spectator', icon: 'binoculars', label: 'Weiter: Zuschauer', title: 'Weiter: Zuschauer', body: 'Gefundene Hider scheiden aus und schauen zu (falls nicht eingefroren).' },
                ]} />
              <TouchableOpacity style={[st.smallBtn, hiderCanFreeze && st.toggleOn]}
                onPress={() => emitUpdate({ hiderCanFreeze: !hiderCanFreeze })}
                onLongPress={() => Alert.alert('Hider kann Freezen',
                  'AN: Gefundene Hider frieren kurz ein statt auszuscheiden — überstimmt Weiterspielen/Zuschauer. AUS: der andere Toggle entscheidet direkt.')}>
                <Icon name="snowflake" size={15} color={hiderCanFreeze ? theme.onAccent : theme.text2} />
              </TouchableOpacity>
            </>
          )}
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
          {/* Toggle 1: Team (A vs. B) / Jeder gegen jeden — ein Button. */}
          <CycleToggle theme={theme} st={st} value={teamVariant} disabled={!isHost}
            onChange={v => emitUpdate({ teamVariant: v })}
            options={[
              { value: 'team', icon: 'people', label: 'Team (A vs. B)', title: 'Team (A vs. B)', body: 'Zwei feste Seiten treten gegeneinander an.' },
              { value: 'ffa', icon: 'crosshair', label: 'Jeder gegen jeden', title: 'Jeder gegen jeden',
                body: GAME_MODE_PROFILES[subMode]?.submodes.find(sm => sm.id === 'ffa')?.shortDescription || '' },
            ]} />
          {/* Toggle 2: Treffer-Konsequenz — jetzt hier in der Submode-Zeile
              statt in der Modus-Zeile oben (Leben verlieren vs. Einfrieren).
              Leben/Freeze-Zeit selbst sitzen unten bei den übrigen Settings
              (Versteckzeit/Spielzeit etc.), nicht hier — diese Zeile ist nur
              noch für die Toggles selbst, keine Werte-Picker. */}
          {isHost && (
            <CycleToggle theme={theme} st={st} value={onHit}
              onChange={v => emitUpdate({ onHit: v })}
              options={[
                { value: 'respawn', icon: 'heart', label: 'Leben verlieren', title: 'Leben verlieren', body: 'Treffer kostet ein Leben statt einzufrieren.' },
                { value: 'freeze', icon: 'snowflake', label: 'Einfrieren', title: 'Einfrieren', body: 'Treffer friert kurz ein statt ein Leben zu kosten.' },
              ]} />
          )}
        </View>
      )}
      {/* Toggle 3 (Domination/CTF/Bomb): was passiert, wenn ein
          ungefreezter Gegner während der Einnahme/des Diebstahls/des
          Scharfmachens auftaucht (z.B. weil der Einnehmende erst hätte
          gefreezt werden müssen) — pausiert (Standard, Fortschritt bleibt
          erhalten) oder bricht komplett ab (Fortschritt auf 0). */}
      {isHost && (subMode === 'domination' || subMode === 'seek_destroy' || subMode === 'ctf') && (
        <View style={st.rowBtns}>
          {/* Eigene Icons statt beide "snowflake" — sonst nicht vom Hider-
              Freeze-/Einfrieren-Toggle unterscheidbar, jetzt wo alle Toggles
              nur noch ein Icon ohne Text zeigen. "Pausiert"/"Unterbricht"
              ist konzeptionell auch kein Freeze-Zustand selbst, sondern eine
              Capture-Konsequenz DAVON — pause/close passt dafür besser. */}
          <CycleToggle theme={theme} st={st} value={ar.contestResets ? 'breaks' : 'pauses'}
            onChange={v => emitUpdate({ contestResets: v === 'breaks' })}
            options={[
              { value: 'pauses', icon: 'pause', label: 'Pausiert', title: 'Freeze pausiert Capture', body: 'Ein ungefreezter Gegner pausiert die Einnahme nur — Fortschritt bleibt erhalten, sobald er weg ist geht es weiter.' },
              { value: 'breaks', icon: 'closeCircle', label: 'Unterbricht', title: 'Freeze bricht Capture', body: 'Ein ungefreezter Gegner bricht den Versuch komplett ab — Fortschritt auf 0, von vorn beginnen.' },
            ]} />
        </View>
      )}
      {/* Toggle 4 (Domination/CTF/Bomb-Symmetrisch): mehrere Teammitglieder
          müssen gleichzeitig im Ziel stehen, um es einzunehmen — Standard
          AUS (jede/r Einzelne kann einnehmen). Nur bei echten Teams (nicht
          ffa) und nur, wo die symmetrische Einnahme gilt (Zerstören-
          "Angriff & Verteidigung" ist bereits zweiseitig angelegt, davon
          unabhängig). Anzahl-Picker nur sichtbar, wenn der Toggle an ist —
          selbe "nur zeigen wenn relevant"-Regel wie bei Leben unten. */}
      {isHost && teamVariant === 'team' && (subMode === 'domination' || subMode === 'ctf' || (subMode === 'seek_destroy' && destroyVariant === 'instant')) && (
        <View style={st.rowBtns}>
          <TouchableOpacity style={[st.smallBtn, ar.teamCaptureEnabled && st.toggleOn]}
            onPress={() => emitUpdate({ teamCaptureEnabled: !ar.teamCaptureEnabled })}
            onLongPress={() => Alert.alert('Team Capture', 'Statt einer einzelnen Person müssen mehrere Teammitglieder gleichzeitig im Ziel stehen, um es einzunehmen.')}>
            <Icon name="teamCapture" size={15} color={ar.teamCaptureEnabled ? theme.onAccent : theme.text2} />
          </TouchableOpacity>
        </View>
      )}
      {/* Toggle 5 (nur Bomb): Symmetrisch reaktiviert Ziele immer nach
          vollständiger Zerstörung ("mit Restore") — Angriff & Verteidigung
          nie, ein erfolgreicher Angriff ohne Verteidiger entscheidet das
          Match sofort. Kein separater "Ziele reaktivieren"-Schalter mehr —
          die Wahl der Variante entscheidet das jetzt fest mit (host
          requirement). */}
      {isHost && subMode === 'seek_destroy' && (
        <View style={st.rowBtns}>
          {/* ffa hat keine Entschärfen-Lesart (zweiseitig, force-reset zu
              instant server-seitig) — dann nur die eine Option, der Button
              zeigt sie fest an statt durchzuschalten. */}
          <CycleToggle theme={theme} st={st} value={destroyVariant}
            onChange={v => emitUpdate({ destroyVariant: v })}
            options={teamVariant === 'team' ? [
              { value: 'instant', icon: 'loop', label: 'Symmetrisch (Restore)', title: 'Symmetrisch (mit Restore)', body: 'Beide Teams können jedes Ziel einnehmen. Sind alle zerstört, reaktivieren sie sich automatisch — das Match läuft bis zum Zeitlimit weiter.' },
              { value: 'defuse', icon: 'bomb', label: 'Angriff & Verteidigung', title: 'Angriff & Verteidigung', body: 'Team A scharf machen, Team B entschärfen. Explodiert ein Ziel ohne Verteidiger, endet das Match sofort — keine Reaktivierung.' },
            ] : [
              { value: 'instant', icon: 'loop', label: 'Symmetrisch (Restore)', title: 'Symmetrisch (mit Restore)', body: 'Jede/r kann jedes Ziel einnehmen. Sind alle zerstört, reaktivieren sie sich automatisch.' },
            ]} />
        </View>
      )}
      <View style={st.divider} />

      {/* Schnitzeljagd: no polygon to draw at all — the field comes from
          the chosen scenario's own POIs (server synthesizes a bounding-box
          playfield at match start, see socket/game.js's lobby:start). The
          lobby here is deliberately rudimentary: pick a scenario, form
          teams if the scenario needs them, nothing else. */}
      {isHunt && (
        <View style={st.rowBtns}>
          <Text style={st.section}>Szenario</Text>
        </View>
      )}
      {isHunt && huntScenarios.length === 0 && (
        <View style={st.hintRow}>
          <Icon name="hourglass" size={12} color={theme.text3} />
          <Text style={st.hint}>Keine Szenarien vorhanden — im Web-Editor eines anlegen</Text>
        </View>
      )}
      {isHunt && huntScenarios.map(s => (
        <TouchableOpacity key={s.id} disabled={!isHost}
          style={[st.rowBtns, st.smallBtnRow, ar.huntScenarioId === s.id && st.smallBtnActive]}
          onPress={() => emitUpdate({ huntScenarioId: s.id })}>
          <Icon name="flagCheckered" size={14} color={ar.huntScenarioId === s.id ? theme.accent : theme.text2} />
          <Text style={[st.smallTxt, ar.huntScenarioId === s.id && st.smallTxtActive]}>
            {s.title} ({s.poi_count} Stationen{s.progress_mode === 'teams' ? ', Teams' : ''})
          </Text>
        </TouchableOpacity>
      ))}
      {isHunt && <View style={st.divider} />}

      {isHost && !isHunt && (
        <Text style={st.hostHint}>
          Auf die Karte tippen: {tapMode === 'zones' ? 'Zone setzen' : 'Wegpunkt setzen'} — Punkte der Reihe nach im Kreis
        </Text>
      )}

      {!isHunt && (
      <>
      <View style={st.mapBox}>
        <MapView style={{ flex: 1 }} mapStyle={mapStyle as any} onPress={onMapPress}>
          {/* key changes force MapLibre to re-apply defaultSettings: once when
              our own position resolves (async, arrives after mount), again
              once the field polygon is complete enough to re-center on it. */}
          <Camera key={everHadFieldRef.current ? 'f' : myPos ? 'me' : 'e'}
            defaultSettings={{ centerCoordinate: center, zoomLevel: 14.5 }} />
          {myPos && (
            <ShapeSource id="myPos" shape={{
              type: 'Feature', properties: {},
              geometry: { type: 'Point', coordinates: [myPos.lon, myPos.lat] },
            }}>
              <CircleLayer id="myPosDot" style={{
                circleRadius: 8, circleColor: '#40a0ff', circleOpacity: 0.85,
                circleStrokeWidth: 2, circleStrokeColor: '#ffffff',
                // 'map' instead of the default 'viewport': lets the dot tilt
                // with the map plane instead of always facing the camera
                // flat-on. This MapView's Camera never sets a non-zero pitch
                // (defaultSettings only has centerCoordinate/zoomLevel, see
                // above) though, so on this particular screen it's currently
                // a no-op in practice — kept for consistency with GameScreen
                // and in case this map ever gains tilt later.
                circlePitchAlignment: 'map',
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
      </View>

      {ar.comicMap && (
        <View style={st.comicPreviewBox}>
          <MapView style={{ flex: 1 }} mapStyle={comicMapStyle as any} scrollEnabled={false} zoomEnabled={false}>
            <Camera defaultSettings={{ centerCoordinate: center, zoomLevel: 14.5 }} />
            <ComicMapLayers features={ar.comicMap.features} />
          </MapView>
        </View>
      )}

      {/* Drawing errors: only meaningful for the host while drawing */}
      {isHost && polyErrs.length > 0 && (
        <View style={st.errRow}>
          <Icon name="warning" size={13} color={theme.danger} />
          <Text style={st.err}>{polyErrs.map(e => POLY_ERR_DE[e] || e).join(' · ')}</Text>
        </View>
      )}
      {!isHost && polygon.length < 3 && (
        <View style={st.hintRow}>
          <Icon name="hourglass" size={12} color={theme.text3} />
          <Text style={st.hint}>Der Host zeichnet das Spielfeld…</Text>
        </View>
      )}
      </>)}

      {isHost && !isHunt && (
        <>
          <View style={st.rowBtns}>
            {/* Just 2 correction buttons instead of separate undo/clear per
                point type: "Schritt zurück" undoes whichever kind of point
                (field/geofence or target/zone) was placed most recently,
                "Papierkorb" clears everything at once but keeps the comic
                map + viewport (see everHadFieldRef/clearAllPoints above). */}
            <TouchableOpacity style={st.iconBtnLg} onPress={undoLastPoint} disabled={!polygon.length && !zones.length}>
              <Icon name="undo" size={19} color={theme.text2} />
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtnLg} onPress={clearAllPoints}
              disabled={!polygon.length && !zones.length}>
              <Icon name="trash" size={19} color={theme.text2} />
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
              </>
            )}
            <TouchableOpacity style={st.iconBtnLg} onPress={generateComicMap}
              disabled={polygon.length < 3 || polyErrs.length > 0 || comicMapLoading}>
              {/* The comic map now auto-(re)generates on every polygon
                  change (see the effect above) — this button is only a
                  manual-retry fallback for a one-off socket hiccup. */}
              {comicMapLoading ? <ActivityIndicator size="small" color={theme.text2} /> : (
                <Icon name={ar.comicMap ? 'loop' : 'palette'} size={19} color={theme.text2} />
              )}
            </TouchableOpacity>
          </View>
          {!!comicMapErr && (
            <View style={st.errRow}>
              <Icon name="warning" size={13} color={theme.danger} />
              <Text style={st.err}>{comicMapErr}</Text>
            </View>
          )}

          <View style={st.divider} />
          <View style={st.rowBtns}>
            <TouchableOpacity style={[st.smallBtnRow, autoScale && st.smallBtnActive]}
              onPress={() => emitUpdate({ autoScale: !autoScale })}>
              <Icon name="loop" size={13} color={autoScale ? theme.accent : theme.text2} />
              <Text style={[st.smallTxt, autoScale && st.smallTxtActive]}>
                Auto (nach Feldgröße) {autoScale ? 'AN' : 'AUS'}
              </Text>
            </TouchableOpacity>
          </View>
          {autoScale ? (
            <View style={st.rowBtns}>
              <Text style={st.wpCount}>
                {autoPreview
                  ? `Reichweite ~${fmtM(autoPreview.hitRangeM)} · Versteckzeit ${fmtMin(autoPreview.hidingDurationMs)} · Spielzeit ${fmtMin(autoPreview.gameDurationMs)}`
                    + (showLivesInPreview ? ` · Leben ${autoPreview.livesPerPlayer}` : '')
                    + (showFreezeInPreview && autoFreezeMs != null ? ` · Freeze ${fmtSec(autoFreezeMs)}` : '')
                  : 'Erst das Spielfeld zeichnen, um die Auto-Werte zu sehen'}
              </Text>
            </View>
          ) : (
            <View style={st.rowBtns}>
              <Text style={st.wpCount}>Reichweite:</Text>
              {RANGE_PRESETS.map(m => (
                <TouchableOpacity key={m} style={[st.smallBtn, hitRangeM === m && st.smallBtnActive]}
                  onPress={() => setHitRange(m)}>
                  <Text style={[st.smallTxt, hitRangeM === m && st.smallTxtActive]}>{m}m</Text>
                </TouchableOpacity>
              ))}
            </View>
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
              {isHost && teamMode && onHit === 'respawn' && (
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
              {showFreezeInPreview && (
                <View style={st.rowBtns}>
                  <Text style={st.wpCount}>Freeze-Zeit:</Text>
                  {FREEZE_OPTIONS.map(o => (
                    <TouchableOpacity key={o.l} style={[st.smallBtn, freezeMs === o.ms && st.smallBtnActive]}
                      onPress={() => emitUpdate({ timings: { ...(ar.timings || {}), freezeMs: o.ms } })}>
                      <Text style={[st.smallTxt, freezeMs === o.ms && st.smallTxtActive]}>{o.l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {showBaseSettingInPreview && (
                <>
                  <View style={st.rowBtns}>
                    <Text style={st.wpCount}>Vorbereitung:</Text>
                    {BASE_SETTING_OPTIONS.map(o => (
                      <TouchableOpacity key={o.ms} style={[st.smallBtn, baseSettingMs === o.ms && st.smallBtnActive]}
                        onPress={() => emitUpdate({ timings: { ...(ar.timings || {}), baseSettingMs: o.ms } })}>
                        <Text style={[st.smallTxt, baseSettingMs === o.ms && st.smallTxtActive]}>{o.l}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[st.wpCount, { marginBottom: 8 }]}>
                    {teamVariant === 'ffa' ? 'Jede/r platziert die eigene Basis' : 'Captain platziert die Basis'}
                  </Text>
                </>
              )}
            </>
          )}
          {/* Nicht an !autoScale gekoppelt (anders als Leben/Freeze-Zeit
              oben) — ist ein Headcount, keine Timing-Größe, die Auto-Mode
              ersetzen würde. */}
          {isHost && ar.teamCaptureEnabled && (
            <View style={st.rowBtns}>
              <Text style={st.wpCount}>Spieler pro Ziel:</Text>
              {([2, 3, 'all'] as const).map(n => (
                <TouchableOpacity key={n} style={[st.smallBtn, (ar.teamCaptureSize ?? 2) === n && st.smallBtnActive]}
                  onPress={() => emitUpdate({ teamCaptureSize: n })}>
                  <Text style={[st.smallTxt, (ar.teamCaptureSize ?? 2) === n && st.smallTxtActive]}>
                    {n === 'all' ? 'ganzes Team' : n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={st.divider} />
          <View style={st.rowBtns}>
            <TouchableOpacity style={st.smallBtnRow} onPress={addBot} disabled={bots.length >= 12}>
              <Icon name="robot" size={13} color={theme.text2} />
              <Text style={st.smallTxt}>Bot hinzufügen</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      <View style={st.divider} />
      <View style={st.sectionRow}>
        <Icon name="people" size={13} color={theme.text} />
        <Text style={st.section}>
          Spieler {isHost ? (showTeamToggle ? '(Team antippen)' : rolesApply ? '(Rolle antippen)' : '') : ''}
        </Text>
      </View>
    </View>
  );

  const footer = (
    <View>
      {me && displayMembers.length > 0 && (showTeamToggle || rolesApply) && (
        <View style={st.roleRow}>
          <Icon name={showTeamToggle ? 'circle' : (roleOf(me.id) === 'seeker' ? 'flashlight' : 'ghost')}
            size={14} color={showTeamToggle ? (teamOf(me.id) === 'a' ? '#40a0ff' : '#ff5050') : theme.text} />
          <Text style={st.role}>
            {showTeamToggle
              ? `Dein Team: ${teamOf(me.id) === 'a' ? 'A' : 'B'}`
              : `Deine Rolle: ${roleOf(me.id) === 'seeker' ? 'Seeker' : 'Hider'}`}
          </Text>
        </View>
      )}
      {me && displayMembers.length > 0 && !showTeamToggle && !rolesApply && (
        <View style={st.roleRow}>
          <Icon name={isHunt ? 'flagCheckered' : hsVariant === 'the_ship' ? 'mask' : 'crosshair'} size={14} color={theme.text} />
          <Text style={st.role}>
            {isHunt
              ? 'Gemeinsam — alle sehen dieselben Stationen'
              : hsVariant === 'the_ship'
              ? 'Dein Ziel wird nur dir angezeigt, sobald das Spiel startet'
              : teamMode && teamVariant === 'ffa'
              ? 'Jeder gegen jeden — jeder spielt für sich, keine Teams'
              : 'Jeder gegen jeden — keine festen Rollen oder Teams'}
          </Text>
        </View>
      )}
      {!!startErr && (
        <View style={st.errRow}>
          <Icon name="warning" size={13} color={theme.danger} />
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
            {item.isBot && <Icon name="robot" size={13} color={theme.text3} />}
            <Text style={st.name}>{item.username}</Text>
            {showTeamToggle ? (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => toggleTeam(item.id)}>
                <Icon name="circle" size={11} color={teamOf(item.id) === 'a' ? '#40a0ff' : '#ff5050'} />
                <Text style={[st.roleTag, { color: teamOf(item.id) === 'a' ? '#40a0ff' : '#ff5050' }]}>
                  {teamOf(item.id) === 'a' ? 'Team A' : 'Team B'}
                </Text>
              </TouchableOpacity>
            ) : rolesApply ? (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => toggleRole(item.id)}>
                <Icon name={roleOf(item.id) === 'seeker' ? 'flashlight' : 'ghost'} size={13} color={theme.text2} />
                <Text style={st.roleTag}>{roleOf(item.id) === 'seeker' ? 'Seeker' : 'Hider'}</Text>
              </TouchableOpacity>
            ) : null}
            {hitTrackingMode === 'ir' && (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => cycleIrId(item.id)}>
                <Icon name="flash" size={12} color={theme.accent} />
                <Text style={st.roleTag}>{irIdOf(item.id) !== undefined ? `IR ${irIdOf(item.id)}` : 'IR –'}</Text>
              </TouchableOpacity>
            )}
            {/* Klasse (scout/sniper/bomber) — additiv zu Rolle/Team, jeder
                Kampfmodus, optional. Nicht bei Schnitzeljagd (kein Kampf,
                keine Klassen-Perks — siehe MODES.schnitzeljagd in arops.js).
                Tap zum Durchschalten wie IR-ID oben; Long-Press zeigt die
                Steckbrief-Kurzbeschreibung (Tooltip-Pattern für Touch-
                Geräte, siehe AR-Ops-Modi-Plan Phase 7). */}
            {!isHunt && (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow}
                onPress={() => cycleClass(item.id)}
                onLongPress={() => {
                  const cls = classOf(item.id);
                  Alert.alert(
                    cls ? PLAYER_TYPE_PROFILES[cls].name : 'Keine Klasse',
                    cls ? PLAYER_TYPE_PROFILES[cls].shortDescription : 'Standard-Schusswerte, kein Klassen-Perk.'
                  );
                }}>
                <Icon name="shieldAccount" size={12} color={classOf(item.id) ? theme.accent : theme.text3} />
                <Text style={[st.roleTag, classOf(item.id) && { color: theme.accent }]}>
                  {classOf(item.id) ? PLAYER_TYPE_PROFILES[classOf(item.id)!].name : '–'}
                </Text>
              </TouchableOpacity>
            )}
            <Icon name={item.ready ? 'checkCircle' : 'checkboxBlank'} size={14}
              color={item.ready ? '#80ff40' : theme.text3} style={{ marginLeft: 8 }} />
            {isHost && item.isBot && (
              <TouchableOpacity onPress={() => removeBot(item.id)} style={{ marginLeft: 8 }}>
                <Icon name="close" size={14} color={theme.danger} />
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

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: theme.bg, padding: 16, paddingTop: 52 },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
    topLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    // Outer row: the 5 mode buttons (modeRowTight, flex:1) pinned left, an
    // icon-only mode-specific toggle group (modeRowToggle) pinned right —
    // same space-between convention as topRow/topLeft above.
    modeRowOuter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    modeRowTight: { flex: 1, flexDirection: 'row', gap: 6 },
    smallBtnTight: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
      borderRadius: 7, paddingHorizontal: 4, paddingVertical: 7,
    },
    codeChip: { backgroundColor: theme.bg3, borderWidth: 1.5, borderColor: theme.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6, alignItems: 'center' },
    codeTxt: { color: theme.accent, fontSize: 18, fontWeight: '900', letterSpacing: 2, fontFamily: 'monospace' as any },
    codeSubRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    codeSub: { color: theme.text3, fontSize: 9 },
    hostHint: { color: theme.text3, fontSize: 11, marginBottom: 8 },
    mapBox: { height: 300, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
    comicPreviewBox: { height: 160, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
    rowBtns: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
    smallBtn: { backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
    smallBtnRow: {
      flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.bg3,
      borderWidth: 1, borderColor: theme.border, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7,
    },
    smallBtnActive: { borderColor: theme.borderStrong, backgroundColor: theme.bg2 },
    smallBtnDisabled: { opacity: 0.5 },
    // A true on/off toggle, not a pick-one-of-several option (smallBtnActive
    // above) — filled solid when on instead of just a faint tint, so it reads
    // unambiguously as ON/OFF rather than "another choice in this row".
    toggleOn: { borderColor: theme.borderStrong, backgroundColor: theme.accent },
    toggleOnTxt: { color: theme.onAccent, fontWeight: '800' },
    iconBtnLg: {
      width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
    },
    // Overrides smallBtnActive's border — GPS-status-merged compass button
    // when there's no fix (see topLeft header row).
    iconBtnDanger: { borderColor: theme.danger },
    smallTxt: { color: theme.text2, fontSize: 12, fontWeight: '700' },
    smallTxtActive: { color: theme.accent },
    wpCount: { color: theme.text3, fontSize: 11 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, marginBottom: 4 },
    section: { color: theme.text, fontSize: 12, fontWeight: '800' },
    divider: { height: 1, backgroundColor: theme.border, marginVertical: 10 },
    hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 },
    hint: { color: theme.text3, fontSize: 12, textAlign: 'center' },
    errRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
    err: { color: theme.danger, fontSize: 12 },
    roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 8 },
    role: { color: theme.text, fontSize: 14, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 8 },
    name: { flex: 1, color: theme.text, fontSize: 14 },
    roleTagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    roleTag: { fontSize: 13, color: theme.text2, fontWeight: '700' },
    btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // Ready/Start keep their literal green/purple brand accents, same
    // convention as every other primary CTA across the app.
    btn: { backgroundColor: 'rgba(60,160,20,.25)', borderWidth: 2, borderColor: 'rgba(58,128,32,.5)', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
    btnActive: { backgroundColor: 'rgba(60,160,20,.45)' },
    btnTxt: { color: '#80ff40', fontSize: 15, fontWeight: '800' },
    startBtn: { backgroundColor: 'rgba(160,60,200,.25)', borderWidth: 2, borderColor: 'rgba(128,58,160,.5)', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
    startTxt: { color: '#e060ff', fontSize: 15, fontWeight: '800' },
    modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center' },
    modalBox: { backgroundColor: theme.bg2, borderWidth: 2, borderColor: theme.accent, borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
    modalCode: { color: theme.accent, fontSize: 26, fontWeight: '900', letterSpacing: 4, fontFamily: 'monospace' as any },
    linkTxt: { color: '#40a0ff', fontSize: 12, fontFamily: 'monospace' as any, maxWidth: 260, textDecorationLine: 'underline' },
  });
}
