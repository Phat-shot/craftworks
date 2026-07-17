import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import { destinationPoint, DEFAULT_HIT_CONFIG, hitToleranceDeg } from '@craftworks/arops-shared';
import { useKeepAwake } from 'expo-keep-awake';
import { getSocket, getUser } from '../api';
import { useTelemetry } from '../hooks/useTelemetry';
import CameraLayer from '../components/CameraLayer';
import { OSM_STYLE } from '../mapStyle';

interface ZoneInfo { id: string; lat: number; lon: number; radiusM: number; owner?: 'a'|'b'|null; capture?: { team: string; pct: number } | null; }
interface FlagInfo { team: 'a'|'b'; state: string; carrier: string | null; lat?: number; lon?: number; }

interface Snap {
  sessionId?: string;
  subMode?: string;
  phase: string;
  phaseEndsAt: number | null;
  serverTime: number;
  polygon: { lat: number; lon: number }[];
  winner: string | null;
  hidersRemaining: number;
  me: {
    role: string; team?: 'a'|'b'|null; status: string; score: number;
    isCaptain?: boolean;
    geofence: string; proximityAlert: boolean;
    frozenRemainingMs?: number; freezeViolations?: number;
    radarCooldownRemainingMs: number; hitCooldownRemainingMs: number;
  } | null;
  players: { userId: string; username: string; team?: 'a'|'b'|null; frozen?: boolean; lat?: number; lon?: number; positionAgeMs?: number; exposed?: boolean; status: string }[];
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

const ERR_DE: Record<string, string> = {
  wrong_phase: '⏳ Noch Versteckphase — warte auf die Suchphase',
  cooldown: '⏱ Noch im Cooldown',
  outside_field: '🚧 Du bist außerhalb des Spielfelds',
  no_heading: '🧭 Kein Kompass — Handy in einer 8 bewegen',
  role_cannot_shoot: '🫥 Hider können nicht schießen',
  implausible: '⚠️ Position unplausibel',
  frozen: '🧊 Du bist eingefroren',
  bases_too_close: '🚩 Zu nah an der Gegner-Base',
  not_captain: '🚩 Nur der Captain setzt die Base',
  wrong_mode: '✖ Falscher Modus',
  no_position: '✖ Keine Position bekannt',
};

// View modes: 2D map (default) → heading-rotated map → split cam/map →
// transparent map over camera → pure camera.
type ViewMode = 'map' | 'rotated' | 'split' | 'overlay' | 'camera';
const MODES: { id: ViewMode; icon: string; label: string }[] = [
  { id: 'map',     icon: '🗺',  label: 'Karte' },
  { id: 'rotated', icon: '🧭', label: 'Gedreht' },
  { id: 'split',   icon: '◧',  label: 'Split' },
  { id: 'overlay', icon: '👻', label: 'Overlay' },
  { id: 'camera',  icon: '📷', label: 'Kamera' },
];

export default function GameScreen({ sessionId }: { sessionId: string }) {
  useKeepAwake(); // screen lock would stop GPS → target_stale for everyone else
  const socket = getSocket();
  const me = getUser();
  const [snap, setSnap] = useState<Snap | null>(null);
  const [lastResult, setLastResult] = useState('');
  const [radarContacts, setRadarContacts] = useState<RadarContact[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [showRange, setShowRange] = useState(false);
  const telemetry = useTelemetry(socket, sessionId);

  useEffect(() => {
    socket.emit('game:join', { sessionId });
    const onTick = (s: Snap) => {
      if (s.sessionId && s.sessionId !== sessionId) return; // stale session
      setSnap(s);
    };
    const onResult = (r: any) => {
      if (r.action === 'ar_hit_attempt') {
        let txt: string;
        if (r.hit) txt = `🎯 Treffer! (${Math.round((r.confidence || 0) * 100)}%)`;
        else if (r.err) txt = ERR_DE[r.err] || `✖ ${r.err}`;
        else if (r.near) txt = `💨 Knapp! ${r.near.deltaDeg}° daneben (Toleranz ${r.near.toleranceDeg}°, ~${r.near.distanceM} m)`;
        else if (r.reason === 'no_candidates') txt = '✖ Kein gültiges Ziel (Team? Eingefroren? Keine Daten?)';
        else if (r.reason === 'target_stale') txt = '📵 Gegner-Position veraltet — dessen App/Display muss aktiv sein!';
        else if (r.reason === 'low_confidence') txt = '📡 Im Kegel, aber Datenqualität zu niedrig (GPS/Aktualität)';
        else if (r.reason === 'out_of_range') txt = '📏 Außer Reichweite (max. 75 m)';
        else txt = '💨 Daneben — kein Ziel im Kegel';
        setLastResult(txt);
        setTimeout(() => setLastResult(''), 4500);
      } else if (r.action === 'ar_use_perk' && r.contacts) {
        setRadarContacts(r.contacts);
        setTimeout(() => setRadarContacts([]), 15_000);
      } else if (r.action === 'ar_use_perk' && r.err) {
        setLastResult(ERR_DE[r.err] || `✖ ${r.err}`);
        setTimeout(() => setLastResult(''), 4000);
      } else if (r.action === 'ar_set_base') {
        setLastResult(r.ok ? '🚩 Base gesetzt!' : (ERR_DE[r.err] || `✖ ${r.err}`));
        setTimeout(() => setLastResult(''), 4000);
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
    if (!s) return setLastResult('✖ Keine Position');
    socket.emit('game:action', { sessionId, action: 'ar_hit_attempt', data: { sample: s } });
  };
  const useRadar = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'radar' } });

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
        // Team modes: teammates blue, enemies red; frozen = icy tint
        const color = p.frozen ? '#a0d8ff'
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
  }, [telemetry.sample?.lat, telemetry.sample?.lon, JSON.stringify(snap?.players), radarContacts]);

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
  const phaseLabel = snap?.phase === 'hiding' ? '🫥 Versteckphase'
    : snap?.phase === 'seeking' ? '🔦 Suchphase'
    : snap?.phase === 'base_setup' ? '🚩 Base setzen'
    : snap?.phase === 'live' ? '🟢 Live'
    : snap?.phase === 'ended' ? '🏁 Beendet' : '⏳';
  const frozenMs = snap?.me?.frozenRemainingMs ?? 0;
  const isCaptainSetup = snap?.phase === 'base_setup' && snap?.me?.isCaptain;
  const scoreLine = snap?.subMode === 'domination'
    ? `🅰 ${snap.teamScore?.a ?? 0} : ${snap.teamScore?.b ?? 0} 🅱 · Ziel ${snap.targetScore}`
    : snap?.subMode === 'ctf'
    ? `🚩 🅰 ${snap.captures?.a ?? 0} : ${snap.captures?.b ?? 0} 🅱 · Ziel ${snap.targetCaptures}`
    : snap?.subMode === 'seek_destroy'
    ? (snap.bomb ? `💣 ${Math.max(0, Math.ceil((snap.bomb.explodeAt - snap.serverTime) / 1000))}s${snap.bomb.defusePct ? ` · Defuse ${snap.bomb.defusePct}%` : ''}`
       : (snap.plantPct ? `Plant ${snap.plantPct}%` : (snap?.me?.team === 'a' ? '💣 Angreifer' : '🛡 Verteidiger')))
    : null;
  // Rotated modes align the map to the compass (heading-up)
  const mapHeading = (viewMode === 'rotated' || viewMode === 'split' || viewMode === 'overlay')
    ? (telemetry.heading ?? 0) : 0;
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
    <MapView style={{ flex: 1 }} mapStyle={OSM_STYLE as any} onPress={onMapPress}
      scrollEnabled={interactive} zoomEnabled={interactive} rotateEnabled={false}>
      <Camera centerCoordinate={center} zoomLevel={16.5} heading={mapHeading} animationDuration={250} />
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
      <Text style={st.shutterTxt}>{hitCd > 0 ? Math.ceil(hitCd / 1000) + 's' : '📸'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={st.wrap}>
      {/* Status bar */}
      <View style={st.status}>
        <Text style={st.phase}>{phaseLabel}</Text>
        <Text style={st.timer}>⏱ {Math.floor(remainingS / 60)}:{String(remainingS % 60).padStart(2, '0')}</Text>
        <Text style={st.info}>{isSeeker ? '🔦' : '🫥'} · Hider: {snap?.hidersRemaining ?? '–'}</Text>
      </View>

      {frozenMs > 0 && (
        <View style={st.frozenBanner}>
          <Text style={st.frozenTxt}>🧊 EINGEFROREN — {Math.ceil(frozenMs / 1000)}s · Stehen bleiben! Bewegung verlängert.</Text>
        </View>
      )}
      {!!scoreLine && (
        <View style={st.scoreBar}><Text style={st.scoreTxt}>{scoreLine}</Text></View>
      )}
      {snap?.me?.proximityAlert && (
        <View style={st.proxAlert}><Text style={st.proxTxt}>⚠️ GEGNER IN DER NÄHE</Text></View>
      )}
      {snap?.me?.geofence === 'warning' && (
        <View style={st.geoWarn}><Text style={st.geoTxt}>🚧 Spielfeldrand!</Text></View>
      )}
      {snap?.me?.geofence === 'outside' && (
        <View style={st.geoOut}><Text style={st.geoTxt}>🚨 AUSSERHALB — zurück ins Feld!</Text></View>
      )}
      {!!lastResult && <View style={st.result}><Text style={st.resultTxt}>{lastResult}</Text></View>}

      {/* ── View modes ── */}
      <View style={{ flex: 1 }}>
        {viewMode === 'map' && renderMap(true)}
        {viewMode === 'rotated' && renderMap(false)}
        {viewMode === 'split' && (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1 }}>
              <CameraLayer>{crosshair}</CameraLayer>
            </View>
            <View style={{ flex: 1 }}>{renderMap(false)}</View>
          </View>
        )}
        {viewMode === 'overlay' && (
          <CameraLayer>
            <View style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} pointerEvents="none">
              {renderMap(false)}
            </View>
            {crosshair}
          </CameraLayer>
        )}
        {viewMode === 'camera' && <CameraLayer>{crosshair}</CameraLayer>}

        {/* Shoot button floats over camera modes */}
        {shootButton && <View style={st.shootWrap}>{shootButton}</View>}
      </View>

      {/* Endgame overlay */}
      {snap?.phase === 'ended' && (
        <View style={st.endOverlay}>
          <Text style={st.endTitle}>{
            snap.winner === 'seekers' ? '🔦 Seeker gewinnen!'
            : snap.winner === 'hiders' ? '🫥 Hider gewinnen!'
            : snap.winner === 'draw' ? '🤝 Unentschieden'
            : snap.winner === 'team_' + (snap.me?.team || '') ? '🏆 Dein Team gewinnt!'
            : '💀 Gegner-Team gewinnt'
          }</Text>
          <Text style={st.endScore}>Deine Punkte: {snap.me?.score ?? 0}</Text>
        </View>
      )}

      {/* Mode switcher + actions */}
      <View style={st.bottomBar}>
        <View style={st.modeRow}>
          {MODES.map(m => (
            <TouchableOpacity key={m.id}
              style={[st.modeBtn, viewMode === m.id && st.modeBtnActive]}
              onPress={() => setViewMode(m.id)}>
              <Text style={st.modeIcon}>{m.icon}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[st.modeBtn, showRange && st.modeBtnActive]}
            onPress={() => setShowRange(r => !r)}>
            <Text style={st.modeIcon}>🎯</Text>
          </TouchableOpacity>
        </View>
        <View style={st.actionRow}>
          {isCaptainSetup && (
            <TouchableOpacity style={st.baseBtn} onPress={() => setBase()}>
              <Text style={st.baseTxt}>🚩 Base HIER setzen</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={st.radarBtn} onPress={useRadar}
            disabled={radarCd > 0 || snap?.phase !== 'seeking'}>
            <Text style={st.actTxt}>🛰️ {radarCd > 0 ? Math.ceil(radarCd / 60_000) + 'min' : 'Radar'}</Text>
          </TouchableOpacity>
          {canShoot && !hasCam && (
            <TouchableOpacity style={st.camBtn} onPress={() => setViewMode('camera')}>
              <Text style={st.camTxt}>📸</Text>
            </TouchableOpacity>
          )}
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
  phase: { color: '#f0c840', fontWeight: '800', fontSize: 14 },
  timer: { color: '#80ff80', fontWeight: '800', fontSize: 14 },
  info: { color: '#a090c0', fontSize: 13, marginLeft: 'auto' },
  proxAlert: { backgroundColor: 'rgba(224,48,32,.9)', padding: 8, alignItems: 'center' },
  frozenBanner: { backgroundColor: 'rgba(80,160,255,.92)', padding: 8, alignItems: 'center' },
  frozenTxt: { color: '#04121f', fontWeight: '900', fontSize: 12 },
  scoreBar: { backgroundColor: '#1a1428', paddingVertical: 5, alignItems: 'center' },
  scoreTxt: { color: '#f0c840', fontWeight: '800', fontSize: 13 },
  baseBtn: { backgroundColor: 'rgba(240,200,64,.2)', borderWidth: 2, borderColor: '#f0c840', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  baseTxt: { color: '#f0c840', fontWeight: '800', fontSize: 13 },
  proxTxt: { color: '#fff', fontWeight: '900', fontSize: 13 },
  geoWarn: { backgroundColor: 'rgba(240,200,64,.85)', padding: 6, alignItems: 'center' },
  geoOut: { backgroundColor: 'rgba(224,48,32,.95)', padding: 6, alignItems: 'center' },
  geoTxt: { color: '#100', fontWeight: '800', fontSize: 12 },
  result: { backgroundColor: 'rgba(20,16,32,.95)', padding: 8, alignItems: 'center' },
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
  bottomBar: { backgroundColor: '#141020', paddingBottom: 24, paddingTop: 8 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 },
  modeBtn: {
    width: 46, height: 40, borderRadius: 8, backgroundColor: 'rgba(40,32,64,.6)',
    borderWidth: 1, borderColor: '#2a2040', alignItems: 'center', justifyContent: 'center',
  },
  modeBtnActive: { borderColor: '#f0c840', backgroundColor: 'rgba(240,200,64,.15)' },
  modeIcon: { fontSize: 18 },
  actionRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  radarBtn: {
    backgroundColor: 'rgba(40,32,64,.9)', borderWidth: 2, borderColor: '#4a3a70',
    borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12,
  },
  actTxt: { color: '#c0a0f0', fontWeight: '800', fontSize: 14 },
  camBtn: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(240,200,64,.25)',
    borderWidth: 3, borderColor: '#f0c840', alignItems: 'center', justifyContent: 'center',
  },
  camTxt: { fontSize: 24 },
});
