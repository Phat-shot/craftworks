import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import {
  destinationPoint, DEFAULT_HIT_CONFIG, hitToleranceDeg, haversineMeters, bearingDeg, angleDeltaDeg,
} from '@craftworks/arops-shared';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSocket, getUser } from '../api';
import { useTelemetry } from '../hooks/useTelemetry';
import CameraLayer from '../components/CameraLayer';
import Icon, { IconName } from '../components/Icon';
import ComicMapLayers, { ComicFeature } from '../components/ComicMapLayers';
import { BLANK_STYLE, OSM_STYLE } from '../mapStyle';

interface ZoneInfo { id: string; lat: number; lon: number; radiusM: number; owner?: 'a'|'b'|null; capture?: { team: string; pct: number } | null; }
interface FlagInfo { team: 'a'|'b'; state: string; carrier: string | null; lat?: number; lon?: number; }

interface Snap {
  sessionId?: string;
  subMode?: string;
  debugMode?: boolean;
  phase: string;
  phaseEndsAt: number | null;
  serverTime: number;
  polygon: { lat: number; lon: number }[];
  comicMap?: { features: ComicFeature[] } | null;
  hitTrackingMode?: 'compass' | 'ir';
  hitRangeM?: number;
  hitConeHalfAngleDeg?: number;
  winner: string | null;
  hidersRemaining: number;
  me: {
    role: string; team?: 'a'|'b'|null; status: string; score: number;
    isCaptain?: boolean;
    geofence: string; proximityAlert: boolean;
    frozenRemainingMs?: number; freezeViolations?: number;
    radarCooldownRemainingMs: number; hitCooldownRemainingMs: number;
    droneCooldownRemainingMs?: number;
    cloakCooldownRemainingMs?: number; cloakActive?: boolean; cloakRemainingMs?: number;
    fakeMarkerCooldownRemainingMs?: number; fakeMarkerActive?: boolean; fakeMarkerRemainingMs?: number;
    aufscheuchenCooldownRemainingMs?: number;
  } | null;
  players: { userId: string; username: string; team?: 'a'|'b'|null; frozen?: boolean; lat?: number; lon?: number; positionAgeMs?: number; exposed?: boolean; accuracyM?: number; status: string }[];
  // Mode extras
  teamScore?: { a: number; b: number };
  targetScore?: number;
  zones?: ZoneInfo[];
  captures?: { a: number; b: number };
  targetCaptures?: number;
  bases?: { a: { lat: number; lon: number } | null; b: { lat: number; lon: number } | null };
  zoneRadiusM?: number;
  flags?: FlagInfo[];
  sites?: ZoneInfo[];
  bomb?: { siteId: string; explodeAt: number; defusePct: number } | null;
  plantPct?: number;
  events: { seq: number; type: string; userId?: string; winner?: string }[];
}

interface RadarContact { userId: string; lat: number; lon: number; ageMs: number; }

interface Toast { icon: IconName; text: string; }
const ERR_DE: Record<string, Toast> = {
  wrong_phase: { icon: 'hourglass', text: 'Noch Versteckphase — warte auf die Suchphase' },
  cooldown: { icon: 'hourglass', text: 'Noch im Cooldown' },
  outside_field: { icon: 'boundary', text: 'Du bist außerhalb des Spielfelds' },
  no_heading: { icon: 'compass', text: 'Kein Kompass — Handy in einer 8 bewegen' },
  role_cannot_shoot: { icon: 'ghost', text: 'Hider können nicht schießen' },
  implausible: { icon: 'warning', text: 'Position unplausibel' },
  frozen: { icon: 'snowflake', text: 'Du bist eingefroren' },
  bases_too_close: { icon: 'flag', text: 'Zu nah an der Gegner-Base' },
  not_captain: { icon: 'flag', text: 'Nur der Captain setzt die Base' },
  wrong_mode: { icon: 'close', text: 'Falscher Modus' },
  no_position: { icon: 'close', text: 'Keine Position bekannt' },
  perk_wrong_role: { icon: 'close', text: 'Für deine Rolle nicht verfügbar' },
};

// View modes: compass-oriented comic map → split cam/comic → transparent
// comic-over-camera → pure camera. (Plain OSM map/rotated views were dropped
// in-game — the comic map replaces them everywhere except the Lobby's field
// editor, which still needs real-world OSM context to draw the polygon.)
type ViewMode = 'comic' | 'split' | 'overlay' | 'camera';
const MODES: { id: ViewMode; icon: IconName; label: string }[] = [
  { id: 'comic',   icon: 'palette',   label: 'Karte' },
  { id: 'split',   icon: 'splitView', label: 'Split' },
  { id: 'overlay', icon: 'ghost',     label: 'Overlay' },
  { id: 'camera',  icon: 'camera',    label: 'Kamera' },
];

export default function GameScreen({ sessionId }: { sessionId: string }) {
  useKeepAwake(); // screen lock would stop GPS → target_stale for everyone else
  const socket = getSocket();
  const me = getUser();
  const [snap, setSnap] = useState<Snap | null>(null);
  const hitRangeRef = useRef(DEFAULT_HIT_CONFIG.maxRangeM);
  const [lastResult, setLastResult] = useState<Toast | null>(null);
  const [radarContacts, setRadarContacts] = useState<RadarContact[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('comic');
  const [showRange, setShowRange] = useState(false);
  const telemetry = useTelemetry(socket, sessionId);

  // First few seconds without a GPS/compass fix are normal and expected — only
  // treat it as an actual problem (and offer the retry banner) once it's gone
  // on long enough that it probably isn't just still starting up.
  const [initGraceOver, setInitGraceOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setInitGraceOver(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  // Personal display preference only (never synced/server-authoritative) —
  // how transparent the hitbox/target overlay renders. Also the groundwork
  // for a future IR-tracking blend: this is the "hybrid mode" opacity knob
  // the views popup below exposes, already wired to the live overlay.
  // Persisted locally so the choice survives leaving/rejoining a match.
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [viewPopupOpen, setViewPopupOpen] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('ar_overlay_opacity').then(v => {
      const n = v ? parseFloat(v) : NaN;
      if (Number.isFinite(n)) setOverlayOpacity(n);
    }).catch(() => {});
  }, []);
  const setOverlayOpacityPersisted = (v: number) => {
    setOverlayOpacity(v);
    AsyncStorage.setItem('ar_overlay_opacity', String(v)).catch(() => {});
  };

  // ── Debug overlay: live stats + enemy distance/hitbox, overlaid on the
  // existing view — not a separate full-screen panel.
  const [debugOpen, setDebugOpen] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [ticksPerSec, setTicksPerSec] = useState(0);
  const tickCounterRef = useRef(0);
  const debugMode = !!snap?.debugMode;

  useEffect(() => {
    const id = setInterval(() => {
      setTicksPerSec(tickCounterRef.current);
      tickCounterRef.current = 0;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!debugMode) return;
    const onPong = ({ t }: { t: number }) => setPingMs(Date.now() - t);
    socket.on('debug:pong', onPong);
    const id = setInterval(() => socket.emit('debug:ping', { t: Date.now() }), 3000);
    return () => { clearInterval(id); socket.off('debug:pong', onPong); };
  }, [debugMode]);

  useEffect(() => {
    socket.emit('game:join', { sessionId });
    const onTick = (s: Snap) => {
      if (s.sessionId && s.sessionId !== sessionId) return; // stale session
      tickCounterRef.current++;
      if (s.hitRangeM) hitRangeRef.current = s.hitRangeM;
      setSnap(s);
    };
    const onResult = (r: any) => {
      if (r.action === 'ar_hit_attempt') {
        let toast: Toast;
        if (r.hit) toast = { icon: 'crosshair', text: `Treffer! (${Math.round((r.confidence || 0) * 100)}%)` };
        else if (r.err) toast = ERR_DE[r.err] || { icon: 'close', text: r.err };
        else if (r.near) toast = { icon: 'windy', text: `Knapp! ${r.near.deltaDeg}° daneben (Toleranz ${r.near.toleranceDeg}°, ~${r.near.distanceM} m)` };
        else if (r.reason === 'no_candidates') toast = { icon: 'close', text: 'Kein gültiges Ziel (Team? Eingefroren? Keine Daten?)' };
        else if (r.reason === 'target_stale') toast = { icon: 'signalOff', text: 'Gegner-Position veraltet — dessen App/Display muss aktiv sein!' };
        else if (r.reason === 'low_confidence') toast = { icon: 'signal', text: 'Im Kegel, aber Datenqualität zu niedrig (GPS/Aktualität)' };
        else if (r.reason === 'out_of_range') toast = { icon: 'ruler', text: `Außer Reichweite (max. ${hitRangeRef.current} m)` };
        else toast = { icon: 'windy', text: 'Daneben — kein Ziel im Kegel' };
        setLastResult(toast);
        setTimeout(() => setLastResult(null), 4500);
      } else if (r.action === 'ar_use_perk' && r.contacts) {
        setRadarContacts(r.contacts);
        setTimeout(() => setRadarContacts([]), 15_000);
      } else if (r.action === 'ar_use_perk' && typeof r.alert === 'boolean') {
        setLastResult({ icon: 'drone', text: r.alert ? 'Gegner in der Nähe!' : 'Nichts entdeckt' });
        setTimeout(() => setLastResult(null), 4000);
      } else if (r.action === 'ar_use_perk' && r.err) {
        setLastResult(ERR_DE[r.err] || { icon: 'close', text: r.err });
        setTimeout(() => setLastResult(null), 4000);
      } else if (r.action === 'ar_set_base') {
        setLastResult(r.ok ? { icon: 'flag', text: 'Base gesetzt!' } : (ERR_DE[r.err] || { icon: 'close', text: r.err }));
        setTimeout(() => setLastResult(null), 4000);
      }
    };
    socket.on('game:ar_tick', onTick);
    socket.on('game:action_result', onResult);
    return () => {
      socket.off('game:ar_tick', onTick);
      socket.off('game:action_result', onResult);
    };
  }, [sessionId]);

  const shoot = () => {
    const s = telemetry.snapshot();
    if (!s) return setLastResult({ icon: 'close', text: 'Keine Position' });
    socket.emit('game:action', { sessionId, action: 'ar_hit_attempt', data: { sample: s } });
  };
  const useRadar = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'radar' } });
  const useDrone = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'drone' } });
  const useCloak = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'cloak' } });
  const useFakeMarker = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'fake_marker' } });
  const useAufscheuchen = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'aufscheuchen' } });

  const setBase = (lat?: number, lon?: number) =>
    socket.emit('game:action', {
      sessionId, action: 'ar_set_base',
      data: lat !== undefined ? { lat, lon } : {},
    });

  // ── Geo layers ────────────────────────────────────────────
  const center: [number, number] = useMemo(() => {
    const poly = snap?.polygon || [];
    if (telemetry.sample) return [telemetry.sample.lon, telemetry.sample.lat];
    if (poly.length) {
      return [
        poly.reduce((s, p) => s + p.lon, 0) / poly.length,
        poly.reduce((s, p) => s + p.lat, 0) / poly.length,
      ];
    }
    return [11.5755, 48.1374];
  }, [snap?.polygon, telemetry.sample?.lat, telemetry.sample?.lon]);

  const fieldGeoJSON = useMemo(() => {
    const poly = snap?.polygon || [];
    return {
      type: 'Feature' as const, properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: poly.length >= 3
          ? [[...poly.map(p => [p.lon, p.lat]), [poly[0]!.lon, poly[0]!.lat]]]
          : [[]],
      },
    };
  }, [JSON.stringify(snap?.polygon)]);

  const TEAM_COLOR = { a: '#40a0ff', b: '#ff5050' } as const;

  // Distance + bearing + "currently in my shooting cone" per opponent whose
  // position I'm allowed to see (server already enforces the privacy rules —
  // players simply have no lat/lon here if hidden; debug sessions reveal
  // everyone). Single source of truth for the debug bar's text listing AND
  // the hitbox/cross visuals AND the camera target overlay below, so all
  // three always agree with each other.
  interface VisibleEnemy { userId: string; username: string; distanceM: number; bearingDeg: number; inCone: boolean; }
  const visibleEnemies: VisibleEnemy[] = useMemo(() => {
    if (!telemetry.sample) return [];
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    const heading = telemetry.heading;
    const out: VisibleEnemy[] = [];
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const target = { lat: p.lat, lon: p.lon };
      const distanceM = haversineMeters(origin, target);
      const brg = bearingDeg(origin, target);
      let inCone = false;
      if (heading !== null) {
        const accSum = Math.max(4, (telemetry.sample.accuracyM || 0) + (p.accuracyM ?? telemetry.sample.accuracyM ?? 0));
        inCone = angleDeltaDeg(heading, brg) <= hitToleranceDeg(distanceM, accSum);
      }
      out.push({ userId: p.userId, username: p.username, distanceM, bearingDeg: brg, inCone });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  }, [telemetry.sample?.lat, telemetry.sample?.lon, telemetry.sample?.accuracyM,
      telemetry.heading, JSON.stringify(snap?.players), me?.id]);

  const actorsGeoJSON = useMemo(() => {
    const features: any[] = [];
    if (telemetry.sample) {
      features.push({ type: 'Feature', properties: { color: '#f0c840', op: 0.95 },
        geometry: { type: 'Point', coordinates: [telemetry.sample.lon, telemetry.sample.lat] } });
    }
    for (const p of snap?.players || []) {
      if (p.userId !== me?.id && typeof p.lat === 'number') {
        // Fade with position age: fresh = solid, ≥30s old = barely visible ghost
        const age = p.positionAgeMs ?? 0;
        const op = Math.max(0.25, 0.95 - (age / 30_000) * 0.7);
        // Debug: in my current shooting cone right now → bright red, overrides
        // the normal team/enemy color. Team modes: teammates blue, enemies
        // red; frozen = icy tint.
        const inCone = visibleEnemies.find(e => e.userId === p.userId)?.inCone;
        const color = inCone ? '#ff2020'
          : p.frozen ? '#a0d8ff'
          : p.team ? TEAM_COLOR[p.team] : '#ff4040';
        features.push({ type: 'Feature', properties: { color, op },
          geometry: { type: 'Point', coordinates: [p.lon!, p.lat!] } });
      }
    }
    for (const c of radarContacts) {
      const op = Math.max(0.25, 0.9 - (c.ageMs / 30_000) * 0.7);
      features.push({ type: 'Feature', properties: { color: '#ff8000', op },
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] } });
    }
    return { type: 'FeatureCollection' as const, features };
  }, [telemetry.sample?.lat, telemetry.sample?.lon, JSON.stringify(snap?.players), radarContacts, visibleEnemies]);

  // Host-configurable in the Lobby (Reichweite/Breite) — falls back to the
  // shared defaults until the snapshot carries a per-lobby override. "Breite"
  // is stored server-side as an angle (baseConeHalfAngleDeg, same formula
  // hit.ts validates with), translated back to a meters-wide lane here using
  // the same 10m reference distance the Lobby setting uses.
  const REF_DIST_M = 10;
  const effectiveMaxRangeM = snap?.hitRangeM ?? DEFAULT_HIT_CONFIG.maxRangeM;
  const effectiveLaneWidthM = snap?.hitConeHalfAngleDeg !== undefined
    ? 2 * REF_DIST_M * Math.tan(snap.hitConeHalfAngleDeg * Math.PI / 180)
    : 2;

  // Approximate hit range around own position (toggleable)
  const rangeGeoJSON = useMemo(() => {
    if (!showRange || !telemetry.sample) return null;
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    const pts: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const p = destinationPoint(origin, (i / 48) * 360, effectiveMaxRangeM);
      pts.push([p.lon, p.lat]);
    }
    return {
      type: 'Feature' as const, properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [pts] },
    };
  }, [showRange, telemetry.sample?.lat, telemetry.sample?.lon, effectiveMaxRangeM]);

  // HIT LANE: a corridor straight ahead, host-configured width (see above) —
  // not the wider GPS-tolerance cone the server actually validates with
  // (hitToleranceDeg still widens at close range for the real inCone check
  // above; this is deliberately the simpler, honest-about-the-target-size
  // preview, and previews the fixed-width IR lane too).
  const coneGeoJSON = useMemo(() => {
    if (!showRange || !telemetry.sample || telemetry.heading === null) return null;
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    const h = telemetry.heading;
    const halfW = effectiveLaneWidthM / 2;
    const nearLeft = destinationPoint(origin, h - 90, halfW);
    const nearRight = destinationPoint(origin, h + 90, halfW);
    const farLeft = destinationPoint(nearLeft, h, effectiveMaxRangeM);
    const farRight = destinationPoint(nearRight, h, effectiveMaxRangeM);
    const ring = [
      [nearLeft.lon, nearLeft.lat], [farLeft.lon, farLeft.lat],
      [farRight.lon, farRight.lat], [nearRight.lon, nearRight.lat],
      [nearLeft.lon, nearLeft.lat],
    ];
    return {
      type: 'Feature' as const, properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    };
  }, [showRange, telemetry.sample?.lat, telemetry.sample?.lon, telemetry.heading, effectiveLaneWidthM, effectiveMaxRangeM]);

  // Zones (domination), sites (S&D), bases (CTF) as circles
  const zoneCircle = (lat: number, lon: number, radiusM: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const p = destinationPoint({ lat, lon }, (i / 32) * 360, radiusM);
      pts.push([p.lon, p.lat]);
    }
    return pts;
  };
  const zonesGeoJSON = useMemo(() => {
    const feats: any[] = [];
    const zs = snap?.zones || snap?.sites || [];
    for (const z of zs) {
      const color = z.owner === 'a' ? '#40a0ff' : z.owner === 'b' ? '#ff5050' : '#c0c0c0';
      feats.push({ type: 'Feature', properties: { color },
        geometry: { type: 'Polygon', coordinates: [zoneCircle(z.lat, z.lon, z.radiusM)] } });
    }
    if (snap?.bases) {
      for (const tm of ['a', 'b'] as const) {
        const b = snap.bases[tm];
        if (b) feats.push({ type: 'Feature', properties: { color: TEAM_COLOR[tm] },
          geometry: { type: 'Polygon', coordinates: [zoneCircle(b.lat, b.lon, snap.zoneRadiusM || 15)] } });
      }
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [JSON.stringify(snap?.zones), JSON.stringify(snap?.sites), JSON.stringify(snap?.bases), snap?.zoneRadiusM]);

  // The hitbox/cross/camera-target overlay is a strong aim-assist — showing it
  // just because a position happens to be visible (teammate, flag-carrier)
  // would be too strong. It appears for opponents currently pinged by an
  // active detection means: a radar contact, a geofence exposure (they left
  // the field — visible to everyone, so the aim-assist is fair game too), or
  // (once a future perk actually reveals a position — drone currently only
  // gives a boolean proximity alert, no position, so it can't drive this yet)
  // another perk, or a debug session with the debug overlay open.
  const activeRevealIds = useMemo(() => {
    const ids = new Set(radarContacts.map(c => c.userId));
    for (const p of snap?.players || []) if (p.exposed) ids.add(p.userId);
    if (debugMode && debugOpen) {
      for (const p of snap?.players || []) if (p.userId !== me?.id) ids.add(p.userId);
    }
    return ids;
  }, [radarContacts, debugMode, debugOpen, JSON.stringify(snap?.players), me?.id]);

  // The real (planned) IR hit zone is a fixed 2x2m physical box, not a wide
  // angular cone — this previews that exact footprint at each visible
  // opponent's position, north/east-aligned.
  const HITBOX_SIZE_M = 2;
  const hitboxSquare = (lat: number, lon: number, sizeM: number) => {
    const diag = Math.SQRT2 * (sizeM / 2);
    return [45, 135, 225, 315, 45].map(brg => {
      const p = destinationPoint({ lat, lon }, brg, diag);
      return [p.lon, p.lat] as [number, number];
    });
  };
  const HOT_COLOR = '#ff2fd8';
  const NORMAL_COLOR = '#ff7828';
  const hitboxGeoJSON = useMemo(() => {
    const feats: any[] = [];
    if (!showRange) return { type: 'FeatureCollection' as const, features: feats };
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      if (!activeRevealIds.has(p.userId)) continue;
      const inCone = visibleEnemies.find(e => e.userId === p.userId)?.inCone;
      feats.push({
        type: 'Feature',
        properties: { color: inCone ? HOT_COLOR : NORMAL_COLOR, op: (inCone ? 0.22 : 0.35) * overlayOpacity * 2 },
        geometry: { type: 'Polygon', coordinates: [hitboxSquare(p.lat, p.lon, HITBOX_SIZE_M)] },
      });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [showRange, JSON.stringify(snap?.players), me?.id, visibleEnemies, overlayOpacity, activeRevealIds]);

  // A visible hit-confirmation cross inside the box, only for opponents
  // currently in the shooting cone — the "hot" feedback the map version and
  // the camera overlay both draw identically.
  const hitboxCrossGeoJSON = useMemo(() => {
    const feats: any[] = [];
    if (!showRange) return { type: 'FeatureCollection' as const, features: feats };
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      if (!activeRevealIds.has(p.userId)) continue;
      if (!visibleEnemies.find(e => e.userId === p.userId)?.inCone) continue;
      const diag = Math.SQRT2 * (HITBOX_SIZE_M / 2);
      const a = destinationPoint({ lat: p.lat, lon: p.lon }, 45, diag);
      const b = destinationPoint({ lat: p.lat, lon: p.lon }, 225, diag);
      const c = destinationPoint({ lat: p.lat, lon: p.lon }, 135, diag);
      const d = destinationPoint({ lat: p.lat, lon: p.lon }, 315, diag);
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[c.lon, c.lat], [d.lon, d.lat]] } });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [showRange, JSON.stringify(snap?.players), me?.id, visibleEnemies, activeRevealIds]);

  const flagsGeoJSON = useMemo(() => {
    const feats: any[] = [];
    for (const f of snap?.flags || []) {
      if (typeof f.lat === 'number') {
        feats.push({ type: 'Feature', properties: { color: TEAM_COLOR[f.team] },
          geometry: { type: 'Point', coordinates: [f.lon!, f.lat!] } });
      }
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [JSON.stringify(snap?.flags)]);

  // ── Derived state ─────────────────────────────────────────
  const remainingS = snap?.phaseEndsAt ? Math.max(0, Math.round((snap.phaseEndsAt - snap.serverTime) / 1000)) : 0;
  const isSeeker = snap?.me?.role === 'seeker';
  const isTeamMode = !!snap?.me?.team;
  const shootPhase = isTeamMode ? snap?.phase === 'live' : snap?.phase === 'seeking';
  const canShoot = shootPhase && snap?.me?.status === 'alive'
    && (snap?.me?.frozenRemainingMs ?? 0) <= 0
    && (isTeamMode || isSeeker);
  const radarCd = snap?.me?.radarCooldownRemainingMs ?? 0;
  const hitCd = snap?.me?.hitCooldownRemainingMs ?? 0;
  const isHider = snap?.me?.role === 'hider';
  const droneCd = snap?.me?.droneCooldownRemainingMs ?? 0;
  const cloakCd = snap?.me?.cloakCooldownRemainingMs ?? 0;
  const cloakActive = !!snap?.me?.cloakActive;
  const cloakRemainingS = Math.ceil((snap?.me?.cloakRemainingMs ?? 0) / 1000);
  const fakeMarkerCd = snap?.me?.fakeMarkerCooldownRemainingMs ?? 0;
  const fakeMarkerActive = !!snap?.me?.fakeMarkerActive;
  const fakeMarkerRemainingS = Math.ceil((snap?.me?.fakeMarkerRemainingMs ?? 0) / 1000);
  const aufscheuchenCd = snap?.me?.aufscheuchenCooldownRemainingMs ?? 0;
  const phaseLabel: Toast = snap?.phase === 'hiding' ? { icon: 'ghost', text: 'Versteckphase' }
    : snap?.phase === 'seeking' ? { icon: 'flashlight', text: 'Suchphase' }
    : snap?.phase === 'base_setup' ? { icon: 'flag', text: 'Base setzen' }
    : snap?.phase === 'live' ? { icon: 'circle', text: 'Live' }
    : snap?.phase === 'ended' ? { icon: 'flagCheckered', text: 'Beendet' } : { icon: 'hourglass', text: '' };
  const frozenMs = snap?.me?.frozenRemainingMs ?? 0;
  const isCaptainSetup = snap?.phase === 'base_setup' && snap?.me?.isCaptain;
  const scoreLine: string | null = snap?.subMode === 'domination'
    ? `A ${snap.teamScore?.a ?? 0} : ${snap.teamScore?.b ?? 0} B · Ziel ${snap.targetScore}`
    : snap?.subMode === 'ctf'
    ? `A ${snap.captures?.a ?? 0} : ${snap.captures?.b ?? 0} B · Ziel ${snap.targetCaptures}`
    : snap?.subMode === 'seek_destroy'
    ? (snap.bomb ? `${Math.max(0, Math.ceil((snap.bomb.explodeAt - snap.serverTime) / 1000))}s${snap.bomb.defusePct ? ` · Defuse ${snap.bomb.defusePct}%` : ''}`
       : (snap.plantPct ? `Plant ${snap.plantPct}%` : (snap?.me?.team === 'a' ? 'Angreifer' : 'Verteidiger')))
    : null;
  const scoreIcon: IconName = snap?.subMode === 'ctf' ? 'flag' : snap?.subMode === 'seek_destroy' ? 'bomb' : 'target';
  const hasCam = viewMode === 'split' || viewMode === 'overlay' || viewMode === 'camera';
  // Whichever heading is actually meaningful for how the phone is currently
  // expected to be held: flat/screen-up in pure map mode (top-edge heading),
  // upright/screen-towards-you once the camera is showing (camera-forward
  // heading — the same one used for aiming/hit-validation).
  const activeHeadingDeg = hasCam ? telemetry.heading : telemetry.topEdgeHeadingDeg;
  // Every map-showing mode is compass-oriented (heading-up); pure camera has no map to rotate.
  const mapHeading = viewMode === 'camera' ? 0 : (activeHeadingDeg ?? 0);

  if (telemetry.granted === false) {
    return (
      <View style={[st.wrap, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: '#ff6040', fontSize: 15, textAlign: 'center', padding: 24 }}>
          Ohne Standort-Berechtigung kann AR Ops nicht spielen.{'\n'}Bitte in den Einstellungen erlauben.
        </Text>
      </View>
    );
  }

  const onMapPress = (feature: any) => {
    if (!isCaptainSetup) return;
    const c = feature?.geometry?.coordinates;
    if (Array.isArray(c)) setBase(c[1], c[0]);
  };
  // The comic map is a nice-to-have (host-generated, needs OpenStreetMap's rate-
  // limited Overpass API) — if it was never generated or the fetch failed, fall
  // back to plain OSM tiles instead of an empty background so the match is still
  // playable with a real map underneath.
  const hasComicMap = (snap?.comicMap?.features?.length ?? 0) > 0;
  const renderMap = (interactive: boolean) => (
    <MapView style={{ flex: 1 }} mapStyle={(hasComicMap ? BLANK_STYLE : OSM_STYLE) as any} onPress={onMapPress}
      scrollEnabled={interactive} zoomEnabled={interactive} rotateEnabled={false}>
      {/* Pitch only once the compass is actually driving the rotation — a
          tilted-but-static (non-rotating) map reads as broken, not "3D". */}
      <Camera centerCoordinate={center} zoomLevel={16.5} heading={mapHeading}
        pitch={activeHeadingDeg !== null ? 45 : 0} animationDuration={250} />
      {hasComicMap && <ComicMapLayers features={snap!.comicMap!.features} />}
      {(snap?.polygon?.length ?? 0) >= 3 && (
        <ShapeSource id="field" shape={fieldGeoJSON}>
          <FillLayer id="fieldFill" style={{ fillColor: 'rgba(80,208,64,0.08)' }} />
          <LineLayer id="fieldLine" style={{ lineColor: '#50d040', lineWidth: 2 }} />
        </ShapeSource>
      )}
      {rangeGeoJSON && (
        <ShapeSource id="range" shape={rangeGeoJSON}>
          <FillLayer id="rangeFill" style={{ fillColor: 'rgba(240,200,64,0.05)' }} />
          <LineLayer id="rangeLine" style={{ lineColor: '#f0c840', lineWidth: 1.5, lineDasharray: [2, 2] as any }} />
        </ShapeSource>
      )}
      {coneGeoJSON && (
        <ShapeSource id="hitcone" shape={coneGeoJSON}>
          <FillLayer id="coneFill" style={{ fillColor: 'rgba(255,120,40,0.16)' }} />
          <LineLayer id="coneLine" style={{ lineColor: '#ff7828', lineWidth: 1.5 }} />
        </ShapeSource>
      )}
      {hitboxGeoJSON.features.length > 0 && (
        <ShapeSource id="hitboxes" shape={hitboxGeoJSON as any}>
          <FillLayer id="hitboxFill" style={{ fillColor: ['get', 'color'] as any, fillOpacity: ['get', 'op'] as any }} />
          <LineLayer id="hitboxLine" style={{ lineColor: ['get', 'color'] as any, lineWidth: 2 }} />
        </ShapeSource>
      )}
      {hitboxCrossGeoJSON.features.length > 0 && (
        <ShapeSource id="hitboxCross" shape={hitboxCrossGeoJSON as any}>
          <LineLayer id="hitboxCrossLine" style={{ lineColor: HOT_COLOR, lineWidth: 2.5 }} />
        </ShapeSource>
      )}
      {zonesGeoJSON.features.length > 0 && (
        <ShapeSource id="zones" shape={zonesGeoJSON as any}>
          <FillLayer id="zoneFill" style={{ fillColor: ['get', 'color'] as any, fillOpacity: 0.14 }} />
          <LineLayer id="zoneLine" style={{ lineColor: ['get', 'color'] as any, lineWidth: 2 }} />
        </ShapeSource>
      )}
      {flagsGeoJSON.features.length > 0 && (
        <ShapeSource id="flags" shape={flagsGeoJSON as any}>
          <CircleLayer id="flagDots" style={{
            circleRadius: 6, circleColor: ['get', 'color'] as any,
            circleStrokeWidth: 2, circleStrokeColor: '#000000',
          }} />
        </ShapeSource>
      )}
      {actorsGeoJSON.features.length > 0 && (
        <ShapeSource id="actors" shape={actorsGeoJSON as any}>
          <CircleLayer id="actorDots" style={{
            circleRadius: 9, circleColor: ['get', 'color'] as any,
            circleStrokeWidth: 2, circleStrokeColor: '#ffffff', circleOpacity: ['get', 'op'] as any,
          }} />
        </ShapeSource>
      )}
    </MapView>
  );

  const crosshair = (
    <View style={st.crosshair} pointerEvents="none">
      <View style={st.chH} /><View style={st.chV} />
      <View style={st.chRing} />
    </View>
  );

  // Same hitbox markers as the map view, projected onto the camera preview by
  // heading offset so both views agree ("muss konsistent sein"). No pitch/
  // elevation compensation yet (no device data for it) — markers sit on a
  // fixed horizontal band, correct only while holding the phone level. FOV is
  // an approximation of the rear camera preview, not read from device
  // intrinsics.
  const CAMERA_FOV_DEG = 65;
  const screenW = Dimensions.get('window').width;
  const cameraTargets = useMemo(() => {
    if (!showRange || telemetry.heading === null) return [];
    const heading = telemetry.heading;
    return visibleEnemies.filter(e => activeRevealIds.has(e.userId)).map(e => {
      let delta = e.bearingDeg - heading;
      delta = ((delta + 540) % 360) - 180; // normalize to -180..180
      if (Math.abs(delta) > CAMERA_FOV_DEG / 2 + 8) return null; // off-screen
      const x = screenW * (0.5 + delta / CAMERA_FOV_DEG);
      const angularSizeDeg = (180 / Math.PI) * (2 * Math.atan(1 / Math.max(2, e.distanceM)));
      const size = Math.min(110, Math.max(20, (angularSizeDeg / CAMERA_FOV_DEG) * screenW));
      return { userId: e.userId, distanceM: e.distanceM, inCone: e.inCone, x, size };
    }).filter((t): t is { userId: string; distanceM: number; inCone: boolean; x: number; size: number } => t !== null);
  }, [showRange, telemetry.heading, visibleEnemies, screenW, activeRevealIds]);

  // Camera preview of the 2m lane: honest perspective would need device pitch
  // (how far down the phone is tilted) to place near/far correctly, which we
  // don't read yet — so this fakes a converging "alley" using fixed vertical
  // anchors instead of real elevation, valid mainly when holding the phone
  // roughly level. Rungs narrow from bottom (near) to top (near the crosshair,
  // far away), same width math as the target markers.
  const LANE_NEAR_M = 6;
  const LANE_BANDS = 7;
  const laneRungs = useMemo(() => {
    if (!showRange || telemetry.heading === null) return [];
    const out: { yFrac: number; wPx: number }[] = [];
    for (let i = 0; i < LANE_BANDS; i++) {
      const t = i / (LANE_BANDS - 1); // 0 = near/bottom, 1 = far/top
      const d = LANE_NEAR_M + t * (effectiveMaxRangeM - LANE_NEAR_M);
      const angDeg = (180 / Math.PI) * 2 * Math.atan((effectiveLaneWidthM / 2) / d);
      const wPx = Math.max(3, (angDeg / CAMERA_FOV_DEG) * screenW);
      const yFrac = 0.85 - t * (0.85 - 0.42);
      out.push({ yFrac, wPx });
    }
    return out;
  }, [showRange, telemetry.heading, screenW, effectiveMaxRangeM, effectiveLaneWidthM]);

  const laneOverlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {laneRungs.map((r, i) => (
        <View key={i} style={{
          position: 'absolute', top: `${r.yFrac * 100}%`, left: screenW / 2 - r.wPx / 2,
          width: r.wPx, height: 2, backgroundColor: `rgba(240,200,64,${(0.5 * overlayOpacity * 2).toFixed(2)})`,
        }} />
      ))}
    </View>
  );

  const targetOverlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {cameraTargets.map(t => (
        <View key={t.userId} style={{
          position: 'absolute', left: t.x - t.size / 2, top: '48%', width: t.size, height: t.size,
          marginTop: -t.size / 2, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: t.inCone ? HOT_COLOR : NORMAL_COLOR,
          backgroundColor: t.inCone
            ? `rgba(255,47,216,${(0.22 * overlayOpacity * 2).toFixed(2)})`
            : `rgba(255,120,40,${(0.35 * overlayOpacity * 2).toFixed(2)})`,
        }}>
          {t.inCone && (
            <>
              <View style={{ position: 'absolute', width: '150%', height: 2, backgroundColor: HOT_COLOR, transform: [{ rotate: '45deg' }] }} />
              <View style={{ position: 'absolute', width: '150%', height: 2, backgroundColor: HOT_COLOR, transform: [{ rotate: '-45deg' }] }} />
            </>
          )}
          <Text style={st.targetDist}>{Math.round(t.distanceM)}m</Text>
        </View>
      ))}
    </View>
  );

  const centerButton = canShoot && (hasCam ? (
    <TouchableOpacity style={[st.shutter, hitCd > 0 && st.shutterCd]} onPress={shoot} disabled={hitCd > 0}>
      {hitCd > 0 ? <Text style={st.shutterTxt}>{Math.ceil(hitCd / 1000) + 's'}</Text> : <Icon name="photo" size={26} color="#f0c840" />}
    </TouchableOpacity>
  ) : (
    <TouchableOpacity style={st.camBtn} onPress={() => setViewMode('camera')}>
      <Icon name="photo" size={24} color="#f0c840" />
    </TouchableOpacity>
  ));

  return (
    <View style={st.wrap}>
      {/* Status bar */}
      <View style={st.status}>
        <View style={st.iconTextRow}>
          <Icon name={phaseLabel.icon} size={13} color="#f0c840" />
          <Text style={st.phase}>{phaseLabel.text}</Text>
        </View>
        <View style={st.iconTextRow}>
          <Icon name="clock" size={13} color="#80ff80" />
          <Text style={st.timer}>{Math.floor(remainingS / 60)}:{String(remainingS % 60).padStart(2, '0')}</Text>
        </View>
        <View style={[st.iconTextRow, { marginLeft: 'auto' }]}>
          <Icon name={isSeeker ? 'flashlight' : 'ghost'} size={13} color="#a090c0" />
          <Text style={st.info}>Hider: {snap?.hidersRemaining ?? '–'}</Text>
        </View>
      </View>

      {!telemetry.sample && (
        initGraceOver ? (
          <TouchableOpacity style={st.geoWarn} onPress={telemetry.retryPosition}>
            <Icon name="close" size={12} color="#100" />
            <Text style={st.geoTxt}>Keine Position — antippen zum Neustart</Text>
          </TouchableOpacity>
        ) : (
          <View style={st.geoInit}>
            <Icon name="hourglass" size={12} color="#c0a0f0" />
            <Text style={st.geoInitTxt}>Initialisiere GPS…</Text>
          </View>
        )
      )}

      {activeHeadingDeg === null && (
        initGraceOver ? (
          <TouchableOpacity style={st.geoWarn} onPress={telemetry.retryHeading}>
            <Icon name="compass" size={12} color="#100" />
            <Text style={st.geoTxt}>
              {hasCam ? 'Kein Kompass — Handy aufrecht halten (Bildschirm zu dir)' : 'Kein Kompass — Handy flach halten'}
              {' · antippen zum Neustart'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={st.geoInit}>
            <Icon name="compass" size={12} color="#c0a0f0" />
            <Text style={st.geoInitTxt}>Initialisiere Kompass…</Text>
          </View>
        )
      )}

      {frozenMs > 0 && (
        <View style={st.frozenBanner}>
          <Icon name="snowflake" size={13} color="#04121f" />
          <Text style={st.frozenTxt}>EINGEFROREN — {Math.ceil(frozenMs / 1000)}s · Stehen bleiben! Bewegung verlängert.</Text>
        </View>
      )}
      {!!scoreLine && (
        <View style={st.scoreBar}>
          <Icon name={scoreIcon} size={13} color="#f0c840" />
          <Text style={st.scoreTxt}>{scoreLine}</Text>
        </View>
      )}
      {snap?.me?.proximityAlert && (
        <View style={st.proxAlert}>
          <Icon name="warning" size={13} color="#fff" />
          <Text style={st.proxTxt}>GEGNER IN DER NÄHE</Text>
        </View>
      )}
      {cloakActive && (
        <View style={st.cloakBanner}>
          <Icon name="ghost" size={13} color="#fff" />
          <Text style={st.cloakTxt}>CLOAK AKTIV — {cloakRemainingS}s</Text>
        </View>
      )}
      {fakeMarkerActive && (
        <View style={st.cloakBanner}>
          <Icon name="mask" size={13} color="#fff" />
          <Text style={st.cloakTxt}>FAKE-MARKER AKTIV — {fakeMarkerRemainingS}s</Text>
        </View>
      )}
      {snap?.me?.geofence === 'warning' && (
        <View style={st.geoWarn}>
          <Icon name="boundary" size={12} color="#100" />
          <Text style={st.geoTxt}>Spielfeldrand!</Text>
        </View>
      )}
      {snap?.me?.geofence === 'outside' && (
        <View style={st.geoOut}>
          <Icon name="alertOctagon" size={12} color="#100" />
          <Text style={st.geoTxt}>AUSSERHALB — zurück ins Feld!</Text>
        </View>
      )}
      {!!lastResult && (
        <View style={st.result}>
          <Icon name={lastResult.icon} size={13} color="#f0c840" />
          <Text style={st.resultTxt}>{lastResult.text}</Text>
        </View>
      )}

      {/* ── View modes ── */}
      {/*
        Single CameraLayer instance, gated on `hasCam` rather than mounted
        separately per viewMode: switching directly between two camera-using
        modes (split/overlay/camera) used to unmount + remount CameraView in
        the same React commit, racing its native session teardown on Android
        and hanging the camera. Only crossing hasCam's own boundary (camera
        mode <-> map/rotated) unmounts it now.
      */}
      <View style={{ flex: 1 }}>
        {!hasCam && viewMode === 'comic' && renderMap(true)}
        {hasCam && (
          <CameraLayer>
            {viewMode === 'split' && (
              <View style={{ flex: 1 }}>
                <View style={{ flex: 1 }}>{crosshair}{laneOverlay}{targetOverlay}</View>
                <View style={{ flex: 1 }}>{renderMap(false)}</View>
              </View>
            )}
            {viewMode === 'overlay' && (
              <>
                {/* The semi-transparent map below already carries the geo-projected
                    hitbox through — the screen-projected targetOverlay is skipped
                    here to avoid two non-aligned markers for the same opponent. */}
                <View style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} pointerEvents="none">
                  {renderMap(false)}
                </View>
                {crosshair}
              </>
            )}
            {viewMode === 'camera' && <>{crosshair}{laneOverlay}{targetOverlay}</>}
          </CameraLayer>
        )}

        {/* Debug overlay: floats directly over whichever view is active —
            rendered last so it actually paints on top of the native
            MapView/CameraView instead of underneath it; text only, doesn't
            push any other layout down or intercept taps. */}
        {debugMode && debugOpen && (
          <View style={st.debugBar} pointerEvents="none">
            <View style={st.iconTextRow}>
              <Icon name="bug" size={12} color="#40ff80" />
              <Text style={st.debugBarTxt}>Ping {pingMs ?? '–'}ms · {ticksPerSec}/s</Text>
            </View>
            {visibleEnemies.map(e => (
              <View key={e.userId} style={st.iconTextRow}>
                <Icon name={e.inCone ? 'crosshair' : 'circle'} size={11} color={e.inCone ? '#ff4040' : '#80e0a0'} />
                <Text style={[st.debugBarTxt, e.inCone && st.debugBarTxtHot]}>
                  {e.username}: {Math.round(e.distanceM)}m
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Endgame overlay */}
      {snap?.phase === 'ended' && (() => {
        const end: Toast = snap.winner === 'seekers' ? { icon: 'flashlight', text: 'Seeker gewinnen!' }
          : snap.winner === 'hiders' ? { icon: 'ghost', text: 'Hider gewinnen!' }
          : snap.winner === 'draw' ? { icon: 'handshake', text: 'Unentschieden' }
          : snap.winner === 'team_' + (snap.me?.team || '') ? { icon: 'trophy', text: 'Dein Team gewinnt!' }
          : { icon: 'skull', text: 'Gegner-Team gewinnt' };
        return (
          <View style={st.endOverlay}>
            <Icon name={end.icon} size={32} color="#f0c840" style={{ marginBottom: 8 }} />
            <Text style={st.endTitle}>{end.text}</Text>
            <Text style={st.endScore}>Deine Punkte: {snap.me?.score ?? 0}</Text>
          </View>
        );
      })()}

      {/* Views-Popup: Kartenmodus, Schussbereich, Debug, Overlay-Transparenz.
          Transparenz ist eine rein geräteseitige Anzeige-Einstellung (nicht
          serverseitig synchronisiert), wirkt aber schon jetzt live auf
          Hitbox/Kreuz auf Karte und Kamera — dieselbe Einstellung soll
          später auch die Überblendung im IR-Hybrid-Modus steuern. */}
      {viewPopupOpen && (
        <View style={st.viewPopup}>
          <View style={st.modeRow}>
            {MODES.map(m => (
              <TouchableOpacity key={m.id}
                style={[st.modeBtn, viewMode === m.id && st.modeBtnActive]}
                onPress={() => setViewMode(m.id)}>
                <Icon name={m.icon} size={18} color={viewMode === m.id ? '#f0c840' : '#c0a0f0'} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[st.modeBtn, showRange && st.modeBtnActive]}
              onPress={() => setShowRange(r => !r)}>
              <Icon name="target" size={18} color={showRange ? '#f0c840' : '#c0a0f0'} />
            </TouchableOpacity>
            {debugMode && (
              <TouchableOpacity
                style={[st.modeBtn, debugOpen && st.modeBtnActive]}
                onPress={() => setDebugOpen(o => !o)}>
                <Icon name="bug" size={18} color={debugOpen ? '#f0c840' : '#c0a0f0'} />
              </TouchableOpacity>
            )}
          </View>
          {showRange && (
            <>
              <View style={st.iconTextRow}>
                <Icon name="settings" size={13} color="#f0c840" />
                <Text style={st.overlaySettingsTitle}>Overlay-Transparenz</Text>
              </View>
              <View style={st.overlaySettingsRow}>
                {[0.25, 0.5, 0.75, 1].map(v => (
                  <TouchableOpacity key={v}
                    style={[st.overlaySettingsBtn, overlayOpacity === v && st.modeBtnActive]}
                    onPress={() => setOverlayOpacityPersisted(v)}>
                    <Text style={[st.overlaySettingsTxt, overlayOpacity === v && { color: '#f0c840' }]}>
                      {Math.round(v * 100)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {/* Bottom bar: Aktionen links, Schuss/Kamera-Wechsel mittig, Views-Popup rechts */}
      <View style={st.bottomBar}>
        <View style={st.bottomRow}>
          <View style={st.bottomLeft}>
            {isCaptainSetup && (
              <TouchableOpacity style={[st.baseBtn, st.btnRow]} onPress={() => setBase()}>
                <Icon name="flag" size={14} color="#f0c840" />
                <Text style={st.baseTxt}>Base HIER setzen</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[st.radarBtn, st.btnRow]} onPress={useRadar}
              disabled={radarCd > 0 || snap?.phase !== 'seeking'}>
              <Icon name="radar" size={15} color="#c0a0f0" />
              <Text style={st.actTxt}>{radarCd > 0 ? Math.ceil(radarCd / 60_000) + 'min' : 'Radar'}</Text>
            </TouchableOpacity>
            {snap?.subMode === 'hide_and_seek' && isHider && (
              <>
                <TouchableOpacity style={[st.radarBtn, st.btnRow]} onPress={useDrone}
                  disabled={droneCd > 0 || snap?.phase !== 'seeking'}>
                  <Icon name="drone" size={15} color="#c0a0f0" />
                  <Text style={st.actTxt}>{droneCd > 0 ? Math.ceil(droneCd / 1000) + 's' : 'Drohne'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.radarBtn, st.btnRow]} onPress={useCloak}
                  disabled={cloakCd > 0 || cloakActive || snap?.phase !== 'seeking'}>
                  <Icon name="ghost" size={15} color="#c0a0f0" />
                  <Text style={st.actTxt}>
                    {cloakActive ? cloakRemainingS + 's' : cloakCd > 0 ? Math.ceil(cloakCd / 1000) + 's' : 'Cloak'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.radarBtn, st.btnRow]} onPress={useFakeMarker}
                  disabled={fakeMarkerCd > 0 || snap?.phase !== 'seeking'}>
                  <Icon name="mask" size={15} color="#c0a0f0" />
                  <Text style={st.actTxt}>{fakeMarkerCd > 0 ? Math.ceil(fakeMarkerCd / 1000) + 's' : 'Fake'}</Text>
                </TouchableOpacity>
              </>
            )}
            {snap?.subMode === 'hide_and_seek' && isSeeker && (
              <TouchableOpacity style={[st.radarBtn, st.btnRow]} onPress={useAufscheuchen}
                disabled={aufscheuchenCd > 0 || snap?.phase !== 'seeking'}>
                <Icon name="scare" size={15} color="#c0a0f0" />
                <Text style={st.actTxt}>{aufscheuchenCd > 0 ? Math.ceil(aufscheuchenCd / 1000) + 's' : 'Aufscheuchen'}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={st.bottomCenter}>{centerButton}</View>
          <View style={st.bottomRight}>
            <TouchableOpacity
              style={[st.modeBtn, viewPopupOpen && st.modeBtnActive]}
              onPress={() => setViewPopupOpen(o => !o)}>
              <Icon name="settings" size={20} color={viewPopupOpen ? '#f0c840' : '#c0a0f0'} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810' },
  status: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 10,
    backgroundColor: '#141020', gap: 14,
  },
  iconTextRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  phase: { color: '#f0c840', fontWeight: '800', fontSize: 14 },
  timer: { color: '#80ff80', fontWeight: '800', fontSize: 14 },
  info: { color: '#a090c0', fontSize: 13 },
  proxAlert: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(224,48,32,.9)', padding: 8, alignItems: 'center' },
  cloakBanner: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(120,60,200,.9)', padding: 8, alignItems: 'center' },
  cloakTxt: { color: '#fff', fontWeight: '900', fontSize: 13 },
  frozenBanner: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(80,160,255,.92)', padding: 8, alignItems: 'center' },
  frozenTxt: { color: '#04121f', fontWeight: '900', fontSize: 12 },
  scoreBar: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: '#1a1428', paddingVertical: 5, alignItems: 'center' },
  scoreTxt: { color: '#f0c840', fontWeight: '800', fontSize: 13 },
  baseBtn: { backgroundColor: 'rgba(240,200,64,.2)', borderWidth: 2, borderColor: '#f0c840', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  baseTxt: { color: '#f0c840', fontWeight: '800', fontSize: 13 },
  proxTxt: { color: '#fff', fontWeight: '900', fontSize: 13 },
  geoWarn: { flexDirection: 'row', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(240,200,64,.85)', padding: 6, alignItems: 'center' },
  geoOut: { flexDirection: 'row', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(224,48,32,.95)', padding: 6, alignItems: 'center' },
  geoTxt: { color: '#100', fontWeight: '800', fontSize: 12 },
  geoInit: { flexDirection: 'row', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(40,32,64,.85)', padding: 6, alignItems: 'center' },
  geoInitTxt: { color: '#c0a0f0', fontWeight: '700', fontSize: 12 },
  result: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(20,16,32,.95)', padding: 8, alignItems: 'center' },
  resultTxt: { color: '#f0c840', fontWeight: '800' },
  crosshair: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  chH: { position: 'absolute', width: 50, height: 2, backgroundColor: 'rgba(240,200,64,.8)' },
  chV: { position: 'absolute', width: 2, height: 50, backgroundColor: 'rgba(240,200,64,.8)' },
  chRing: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(240,200,64,.5)' },
  targetDist: { position: 'absolute', bottom: -16, color: '#fff', fontSize: 10, fontWeight: '800' },
  shutter: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(240,200,64,.25)',
    borderWidth: 4, borderColor: '#f0c840', alignItems: 'center', justifyContent: 'center',
  },
  shutterCd: { borderColor: '#605030' },
  shutterTxt: { fontSize: 24, color: '#f0c840', fontWeight: '800' },
  endOverlay: {
    position: 'absolute', top: '35%', left: 24, right: 24, backgroundColor: 'rgba(10,8,16,.95)',
    borderWidth: 2, borderColor: '#f0c840', borderRadius: 16, padding: 24, alignItems: 'center', zIndex: 50,
  },
  endTitle: { color: '#f0c840', fontSize: 22, fontWeight: '900', marginBottom: 8 },
  endScore: { color: '#80ff80', fontSize: 16 },
  viewPopup: {
    backgroundColor: '#1a1428', borderTopWidth: 1, borderTopColor: '#2a2040',
    paddingHorizontal: 16, paddingVertical: 10, gap: 8,
  },
  overlaySettingsTitle: { color: '#f0c840', fontSize: 12, fontWeight: '800' },
  overlaySettingsRow: { flexDirection: 'row', gap: 8 },
  overlaySettingsBtn: {
    flex: 1, alignItems: 'center', backgroundColor: 'rgba(40,32,64,.6)',
    borderWidth: 1, borderColor: '#2a2040', borderRadius: 7, paddingVertical: 8,
  },
  overlaySettingsTxt: { color: '#c0a0f0', fontSize: 12, fontWeight: '700' },
  debugBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center',
    backgroundColor: 'rgba(8,16,8,.85)', borderBottomWidth: 1, borderBottomColor: '#40ff80',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  debugBarTxt: { color: '#a0e0a0', fontSize: 11, fontWeight: '700' },
  debugBarTxtHot: { color: '#ff4040', fontWeight: '900' },
  bottomBar: { backgroundColor: '#141020', paddingBottom: 24, paddingTop: 8 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 },
  modeBtn: {
    width: 46, height: 40, borderRadius: 8, backgroundColor: 'rgba(40,32,64,.6)',
    borderWidth: 1, borderColor: '#2a2040', alignItems: 'center', justifyContent: 'center',
  },
  modeBtnActive: { borderColor: '#f0c840', backgroundColor: 'rgba(240,200,64,.15)' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  bottomLeft: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  bottomCenter: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  bottomRight: { alignItems: 'center', justifyContent: 'center' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  radarBtn: {
    backgroundColor: 'rgba(40,32,64,.9)', borderWidth: 2, borderColor: '#4a3a70',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  actTxt: { color: '#c0a0f0', fontWeight: '800', fontSize: 14 },
  camBtn: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(240,200,64,.25)',
    borderWidth: 3, borderColor: '#f0c840', alignItems: 'center', justifyContent: 'center',
  },
});
