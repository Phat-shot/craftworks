import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import {
  destinationPoint, DEFAULT_HIT_CONFIG, hitToleranceDeg, haversineMeters, bearingDeg, angleDeltaDeg,
} from '@craftworks/arops-shared';
import { useKeepAwake } from 'expo-keep-awake';
import { getSocket, getUser } from '../api';
import { useTelemetry } from '../hooks/useTelemetry';
import CameraLayer from '../components/CameraLayer';
import Icon, { IconName } from '../components/Icon';
import ComicMapLayers, { ComicFeature } from '../components/ComicMapLayers';
import { BLANK_STYLE } from '../mapStyle';

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
  const [lastResult, setLastResult] = useState<Toast | null>(null);
  const [radarContacts, setRadarContacts] = useState<RadarContact[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('comic');
  const [showRange, setShowRange] = useState(false);
  const telemetry = useTelemetry(socket, sessionId);

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
        else if (r.reason === 'out_of_range') toast = { icon: 'ruler', text: 'Außer Reichweite (max. 75 m)' };
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

  // Debug overlay only: distance + "currently in my shooting cone" per enemy,
  // using the SAME hitToleranceDeg formula the server validates hits with.
  // Only ever non-empty while debugOpen — the server only reveals every
  // opponent's position in debugMode sessions (see arops.js getAropsSnapshot).
  interface DebugEnemy { userId: string; username: string; distanceM: number; inCone: boolean; }
  const debugEnemies: DebugEnemy[] = useMemo(() => {
    if (!debugMode || !debugOpen || !telemetry.sample) return [];
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    const heading = telemetry.heading;
    const out: DebugEnemy[] = [];
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const target = { lat: p.lat, lon: p.lon };
      const distanceM = haversineMeters(origin, target);
      let inCone = false;
      if (heading !== null) {
        const accSum = Math.max(4, (telemetry.sample.accuracyM || 0) + (p.accuracyM ?? telemetry.sample.accuracyM ?? 0));
        inCone = angleDeltaDeg(heading, bearingDeg(origin, target)) <= hitToleranceDeg(distanceM, accSum);
      }
      out.push({ userId: p.userId, username: p.username, distanceM, inCone });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  }, [debugMode, debugOpen, telemetry.sample?.lat, telemetry.sample?.lon, telemetry.sample?.accuracyM,
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
        const inCone = debugEnemies.find(e => e.userId === p.userId)?.inCone;
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
  }, [telemetry.sample?.lat, telemetry.sample?.lon, JSON.stringify(snap?.players), radarContacts, debugEnemies]);

  // Approximate hit range around own position (toggleable)
  const rangeGeoJSON = useMemo(() => {
    if (!showRange || !telemetry.sample) return null;
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    const pts: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const p = destinationPoint(origin, (i / 48) * 360, DEFAULT_HIT_CONFIG.maxRangeM);
      pts.push([p.lon, p.lat]);
    }
    return {
      type: 'Feature' as const, properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [pts] },
    };
  }, [showRange, telemetry.sample?.lat, telemetry.sample?.lon]);

  // HIT-ZONE CONE: the honest shape of the validation. Wide at close range
  // (GPS error dominates direction), narrowing to the base cone at max range.
  // Uses the SAME shared tolerance function the server validates with.
  const coneGeoJSON = useMemo(() => {
    if (!showRange || !telemetry.sample || telemetry.heading === null) return null;
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    // accSum estimate: own accuracy + assumed similar target accuracy
    const accSum = Math.max(4, telemetry.sample.accuracyM * 2);
    const h = telemetry.heading;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let d = 6; d <= DEFAULT_HIT_CONFIG.maxRangeM; d += 6) {
      const tol = hitToleranceDeg(d, accSum);
      const pl = destinationPoint(origin, h - tol, d);
      const pr = destinationPoint(origin, h + tol, d);
      left.push([pl.lon, pl.lat]);
      right.push([pr.lon, pr.lat]);
    }
    const ring = [[origin.lon, origin.lat], ...left, ...right.reverse(), [origin.lon, origin.lat]];
    return {
      type: 'Feature' as const, properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    };
  }, [showRange, telemetry.sample?.lat, telemetry.sample?.lon, telemetry.sample?.accuracyM, telemetry.heading]);

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

  // Small per-target hitbox circles (~1.5m physical radius) at each visible
  // opponent's exact position — a preview of the point-hitbox the planned
  // IR-based hit detection will use later (fixed physical radius derived from
  // distance), rather than only the wide GPS-uncertainty cone above. Shows
  // for whichever opponents are already visible under the normal privacy
  // rules (teammates/exposed/flag-carrier) or, in debug sessions, everyone.
  const hitboxGeoJSON = useMemo(() => {
    const feats: any[] = [];
    if (!showRange) return { type: 'FeatureCollection' as const, features: feats };
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const inCone = debugEnemies.find(e => e.userId === p.userId)?.inCone;
      feats.push({
        type: 'Feature', properties: { color: inCone ? '#ff2020' : '#ff7828' },
        geometry: { type: 'Polygon', coordinates: [zoneCircle(p.lat, p.lon, 1.5)] },
      });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [showRange, JSON.stringify(snap?.players), me?.id, debugEnemies]);

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
  // Every map-showing mode is compass-oriented (heading-up); pure camera has no map to rotate.
  const mapHeading = viewMode === 'camera' ? 0 : (telemetry.heading ?? 0);
  const hasCam = viewMode === 'split' || viewMode === 'overlay' || viewMode === 'camera';

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
  const renderMap = (interactive: boolean) => (
    <MapView style={{ flex: 1 }} mapStyle={BLANK_STYLE as any} onPress={onMapPress}
      scrollEnabled={interactive} zoomEnabled={interactive} rotateEnabled={false}>
      <Camera centerCoordinate={center} zoomLevel={16.5} heading={mapHeading} animationDuration={250} />
      <ComicMapLayers features={snap?.comicMap?.features ?? []} />
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
          <FillLayer id="hitboxFill" style={{ fillColor: ['get', 'color'] as any, fillOpacity: 0.35 }} />
          <LineLayer id="hitboxLine" style={{ lineColor: ['get', 'color'] as any, lineWidth: 2 }} />
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

  const shootButton = canShoot && hasCam && (
    <TouchableOpacity style={[st.shutter, hitCd > 0 && st.shutterCd]} onPress={shoot} disabled={hitCd > 0}>
      {hitCd > 0 ? <Text style={st.shutterTxt}>{Math.ceil(hitCd / 1000) + 's'}</Text> : <Icon name="photo" size={26} color="#f0c840" />}
    </TouchableOpacity>
  );

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

      {telemetry.heading === null && (
        <TouchableOpacity style={st.geoWarn} onPress={telemetry.retryHeading}>
          <Icon name="compass" size={12} color="#100" />
          <Text style={st.geoTxt}>Kein Kompass — Handy in einer 8 bewegen · antippen zum Neustart</Text>
        </TouchableOpacity>
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
        {!hasCam && viewMode === 'comic' && (
          snap?.comicMap?.features?.length ? renderMap(true) : (
            <View style={st.comicEmpty}>
              <Icon name="palette" size={32} color="#807050" />
              <Text style={st.comicEmptyTxt}>
                Keine Comic-Karte generiert — das geht in der Lobby, sobald das Spielfeld steht.
              </Text>
            </View>
          )
        )}
        {hasCam && (
          <CameraLayer>
            {viewMode === 'split' && (
              <View style={{ flex: 1 }}>
                <View style={{ flex: 1 }}>{crosshair}</View>
                <View style={{ flex: 1 }}>{renderMap(false)}</View>
              </View>
            )}
            {viewMode === 'overlay' && (
              <>
                <View style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} pointerEvents="none">
                  {renderMap(false)}
                </View>
                {crosshair}
              </>
            )}
            {viewMode === 'camera' && crosshair}
          </CameraLayer>
        )}

        {/* Shoot button floats over camera modes */}
        {shootButton && <View style={st.shootWrap}>{shootButton}</View>}

        {/* Debug overlay: floats directly over whichever view is active —
            rendered last (like shootWrap above) so it actually paints on top
            of the native MapView/CameraView instead of underneath it; text
            only, doesn't push any other layout down or intercept taps. */}
        {debugMode && debugOpen && (
          <View style={st.debugBar} pointerEvents="none">
            <View style={st.iconTextRow}>
              <Icon name="bug" size={12} color="#40ff80" />
              <Text style={st.debugBarTxt}>Ping {pingMs ?? '–'}ms · {ticksPerSec}/s</Text>
            </View>
            {debugEnemies.map(e => (
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


      {/* Mode switcher + actions */}
      <View style={st.bottomBar}>
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
        <View style={st.actionRow}>
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
          {canShoot && !hasCam && (
            <TouchableOpacity style={st.camBtn} onPress={() => setViewMode('camera')}>
              <Icon name="photo" size={24} color="#f0c840" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810' },
  comicEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: '#f3e9d2' },
  comicEmptyTxt: { color: '#807050', fontSize: 13, textAlign: 'center' },
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
  result: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(20,16,32,.95)', padding: 8, alignItems: 'center' },
  resultTxt: { color: '#f0c840', fontWeight: '800' },
  crosshair: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  chH: { position: 'absolute', width: 50, height: 2, backgroundColor: 'rgba(240,200,64,.8)' },
  chV: { position: 'absolute', width: 2, height: 50, backgroundColor: 'rgba(240,200,64,.8)' },
  chRing: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(240,200,64,.5)' },
  shootWrap: { position: 'absolute', bottom: 16, left: 0, right: 0, alignItems: 'center' },
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
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10 },
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
