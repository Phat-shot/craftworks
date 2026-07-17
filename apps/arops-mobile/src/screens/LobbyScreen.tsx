import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Modal } from 'react-native';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import { getSocket, getUser, fetchLobbyQr } from '../api';
import { OSM_STYLE } from '../mapStyle';

interface Member { id: string; username: string; ready: boolean; }
interface Effective { roles: Record<string, 'seeker' | 'hider'>; teams: Record<string, 'a' | 'b'>; captains: { a: string | null; b: string | null }; }
interface ArSettings {
  polygon?: { lat: number; lon: number }[];
  roles?: Record<string, 'seeker' | 'hider'>;
  teams?: Record<string, 'a' | 'b'>;
  zones?: { lat: number; lon: number }[];
  subMode?: string;
  hidingDurationMs?: number;
  gameDurationMs?: number;
}

const SUB_MODES = [
  { id: 'hide_and_seek', label: '🫥 H&S' },
  { id: 'domination', label: '🎯 Dom' },
  { id: 'ctf', label: '🚩 CTF' },
  { id: 'seek_destroy', label: '💣 S&D' },
];
const NEEDS_ZONES: Record<string, number> = { domination: 2, seek_destroy: 1 };
const POLY_ERR_DE: Record<string, string> = {
  too_few_points: 'Mind. 3 Wegpunkte setzen',
  self_intersecting: 'Fläche überschneidet sich — Punkte der Reihe nach im Kreis setzen',
  area_too_small: 'Fläche zu klein (min. 2.000 m²)',
  area_too_large: 'Fläche zu groß (max. 3 km²)',
};
const START_ERR: Record<string, string> = {
  ar_invalid_polygon: 'Spielfeld ungültig — siehe Karte',
  ar_need_two_players: 'Mindestens 2 Spieler nötig',
  ar_need_zones: 'Zonen fehlen — Tipp-Modus auf "Zonen" stellen',
  ar_zones_invalid: 'Zonen ungültig (außerhalb / zu nah beieinander)',
  not_host: 'Nur der Host kann starten',
};

export default function LobbyScreen({
  lobbyId, isHost = false, lobbyCode, onGameStart,
}: { lobbyId: string; isHost?: boolean; lobbyCode?: string; onGameStart: (sessionId: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [ar, setAr] = useState<ArSettings>({});
  const [effective, setEffective] = useState<Effective | null>(null);
  const [polyErrs, setPolyErrs] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [startErr, setStartErr] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [tapMode, setTapMode] = useState<'polygon' | 'zones'>('polygon');
  const me = getUser();
  const arRef = useRef(ar);
  arRef.current = ar;

  useEffect(() => {
    const socket = getSocket();
    socket.emit('lobby:join', { lobbyId });
    if (isHost) fetchLobbyQr(lobbyId).then(r => setQr(r?.qr ?? null));

    const onState = ({ members: m }: any) => setMembers(m || []);
    const onArUpdated = ({ arSettings, polygonCheck, effective: eff }: any) => {
      setAr(arSettings || {});
      setPolyErrs(polygonCheck && !polygonCheck.ok ? polygonCheck.errors : []);
      if (eff) setEffective(eff);
    };
    const onJoined = (p: any) => setMembers(m => [...m.filter(x => x.id !== p.userId), { id: p.userId, username: p.username, ready: false }]);
    const onLeft = ({ userId }: any) => setMembers(m => m.filter(x => x.id !== userId));
    const onReady = ({ userId, ready: r }: any) => setMembers(m => m.map(x => x.id === userId ? { ...x, ready: r } : x));
    const onStart = ({ sessionId }: any) => onGameStart(sessionId);
    const onError = ({ code }: any) => { if (START_ERR[code]) setStartErr(START_ERR[code]!); };

    socket.on('lobby:state', onState);
    socket.on('lobby:ar_updated', onArUpdated);
    socket.on('lobby:player_joined', onJoined);
    socket.on('lobby:player_left', onLeft);
    socket.on('lobby:player_ready', onReady);
    socket.on('game:start', onStart);
    socket.on('error', onError);
    return () => {
      socket.emit('lobby:leave', { lobbyId });
      socket.off('lobby:state', onState);
      socket.off('lobby:ar_updated', onArUpdated);
      socket.off('lobby:player_joined', onJoined);
      socket.off('lobby:player_left', onLeft);
      socket.off('lobby:player_ready', onReady);
      socket.off('game:start', onStart);
      socket.off('error', onError);
    };
  }, [lobbyId, isHost, onGameStart]);

  const emitUpdate = (patch: Partial<ArSettings>) => {
    getSocket().emit('lobby:ar_update', { lobbyId, arSettings: { ...arRef.current, ...patch } });
  };

  const polygon = ar.polygon || [];
  const zones = ar.zones || [];
  const subMode = ar.subMode || 'hide_and_seek';
  const teamMode = subMode !== 'hide_and_seek';
  // Server is the single source of truth for roles/teams
  const roleOf = (uid: string) => effective?.roles?.[uid] || 'hider';
  const teamOf = (uid: string) => effective?.teams?.[uid] || 'a';

  const onMapPress = (feature: any) => {
    if (!isHost) return;
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
    for (const m of members) all[m.id] = roleOf(m.id);
    all[uid] = all[uid] === 'seeker' ? 'hider' : 'seeker';
    emitUpdate({ roles: all });
  };
  const toggleTeam = (uid: string) => {
    if (!isHost) return;
    const all: Record<string, 'a' | 'b'> = {};
    for (const m of members) all[m.id] = teamOf(m.id);
    all[uid] = all[uid] === 'a' ? 'b' : 'a';
    emitUpdate({ teams: all });
  };

  const toggleReady = () => {
    const next = !ready;
    setReady(next);
    getSocket().emit('lobby:ready', { lobbyId, ready: next });
  };
  const startGame = () => { setStartErr(''); getSocket().emit('lobby:start', { lobbyId }); };

  const center: [number, number] = polygon.length
    ? [polygon.reduce((s, p) => s + p.lon, 0) / polygon.length,
       polygon.reduce((s, p) => s + p.lat, 0) / polygon.length]
    : [11.5755, 48.1374];

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

  const header = (
    <View>
      {/* Code prominent + tap → QR popup */}
      <View style={st.topRow}>
        <Text style={st.title}>🛰️ Lobby</Text>
        {lobbyCode && (
          <TouchableOpacity style={st.codeChip} onPress={() => qr && setQrOpen(true)}>
            <Text style={st.codeTxt}>{lobbyCode}</Text>
            <Text style={st.codeSub}>{qr ? 'antippen für QR' : 'Code teilen'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {isHost && (
        <Text style={st.hostHint}>
          Auf die Karte tippen: {tapMode === 'zones' ? 'Zone setzen' : 'Wegpunkt setzen'} — Punkte der Reihe nach im Kreis
        </Text>
      )}

      <View style={st.mapBox}>
        <MapView style={{ flex: 1 }} mapStyle={OSM_STYLE as any} onPress={onMapPress}>
          <Camera key={polygon.length >= 3 ? 'f' : 'e'} defaultSettings={{ centerCoordinate: center, zoomLevel: 14.5 }} />
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

      {/* Drawing errors: only meaningful for the host while drawing */}
      {isHost && polyErrs.length > 0 && (
        <Text style={st.err}>⚠ {polyErrs.map(e => POLY_ERR_DE[e] || e).join(' · ')}</Text>
      )}
      {!isHost && polygon.length < 3 && <Text style={st.hint}>⏳ Der Host zeichnet das Spielfeld…</Text>}

      {isHost && (
        <>
          <View style={st.rowBtns}>
            {SUB_MODES.map(m => (
              <TouchableOpacity key={m.id} style={[st.smallBtn, subMode === m.id && st.smallBtnActive]}
                onPress={() => emitUpdate({ subMode: m.id })}>
                <Text style={[st.smallTxt, subMode === m.id && st.smallTxtActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {NEEDS_ZONES[subMode] !== undefined && (
            <View style={st.rowBtns}>
              <Text style={st.wpCount}>Tippen setzt:</Text>
              <TouchableOpacity style={[st.smallBtn, tapMode === 'polygon' && st.smallBtnActive]} onPress={() => setTapMode('polygon')}>
                <Text style={[st.smallTxt, tapMode === 'polygon' && st.smallTxtActive]}>Feld</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.smallBtn, tapMode === 'zones' && st.smallBtnActive]} onPress={() => setTapMode('zones')}>
                <Text style={[st.smallTxt, tapMode === 'zones' && st.smallTxtActive]}>Zonen ({zones.length}/{NEEDS_ZONES[subMode]}+)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.smallBtn} onPress={() => emitUpdate({ zones: [] })} disabled={!zones.length}>
                <Text style={st.smallTxt}>🗑</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={st.rowBtns}>
            <TouchableOpacity style={st.smallBtn} onPress={() => emitUpdate({ polygon: polygon.slice(0, -1) })} disabled={!polygon.length}>
              <Text style={st.smallTxt}>↩ Punkt</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.smallBtn} onPress={() => emitUpdate({ polygon: [] })} disabled={!polygon.length}>
              <Text style={st.smallTxt}>🗑 Feld</Text>
            </TouchableOpacity>
            <Text style={st.wpCount}>{polygon.length} Punkte</Text>
          </View>
          <View style={st.rowBtns}>
            {HIDING.map(o => (
              <TouchableOpacity key={o.ms} style={[st.smallBtn, hid === o.ms && st.smallBtnActive]}
                onPress={() => emitUpdate({ hidingDurationMs: o.ms })}>
                <Text style={[st.smallTxt, hid === o.ms && st.smallTxtActive]}>{o.l}</Text>
              </TouchableOpacity>
            ))}
            <View style={{ width: 10 }} />
            {DURATION.map(o => (
              <TouchableOpacity key={o.ms} style={[st.smallBtn, dur === o.ms && st.smallBtnActive]}
                onPress={() => emitUpdate({ gameDurationMs: o.ms })}>
                <Text style={[st.smallTxt, dur === o.ms && st.smallTxtActive]}>{o.l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
      <Text style={st.section}>👥 Spieler {isHost ? (teamMode ? '(Team antippen)' : '(Rolle antippen)') : ''}</Text>
    </View>
  );

  const footer = (
    <View>
      {me && members.length > 0 && (
        <Text style={st.role}>
          {teamMode
            ? `Dein Team: ${teamOf(me.id) === 'a' ? '🔵 A' : '🔴 B'}`
            : `Deine Rolle: ${roleOf(me.id) === 'seeker' ? '🔦 Seeker' : '🫥 Hider'}`}
        </Text>
      )}
      {!!startErr && <Text style={st.err}>⚠ {startErr}</Text>}
      <TouchableOpacity style={[st.btn, ready && st.btnActive]} onPress={toggleReady}>
        <Text style={st.btnTxt}>{ready ? '✅ Bereit' : 'Bereit?'}</Text>
      </TouchableOpacity>
      {isHost && (
        <TouchableOpacity style={st.startBtn} onPress={startGame}>
          <Text style={st.startTxt}>🚀 Spiel starten</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={st.wrap}>
      <FlatList
        data={members}
        keyExtractor={m => m.id}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={st.row}>
            <Text style={st.name}>{item.username}</Text>
            {teamMode ? (
              <TouchableOpacity disabled={!isHost} onPress={() => toggleTeam(item.id)}>
                <Text style={[st.roleTag, { color: teamOf(item.id) === 'a' ? '#40a0ff' : '#ff5050' }]}>
                  {teamOf(item.id) === 'a' ? '🔵 Team A' : '🔴 Team B'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity disabled={!isHost} onPress={() => toggleRole(item.id)}>
                <Text style={st.roleTag}>{roleOf(item.id) === 'seeker' ? '🔦 Seeker' : '🫥 Hider'}</Text>
              </TouchableOpacity>
            )}
            <Text style={{ color: item.ready ? '#80ff40' : '#807050', fontSize: 12, marginLeft: 8 }}>
              {item.ready ? '✅' : '⬜'}
            </Text>
          </View>
        )}
      />

      {/* QR popup */}
      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <TouchableOpacity style={st.modalBg} activeOpacity={1} onPress={() => setQrOpen(false)}>
          <View style={st.modalBox}>
            <Text style={st.modalCode}>{lobbyCode}</Text>
            {qr && <Image source={{ uri: qr }} style={{ width: 260, height: 260, borderRadius: 8 }} />}
            <Text style={st.hint}>Zum Beitreten scannen · Tippen zum Schließen</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810', padding: 16, paddingTop: 52 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '900', color: '#f0c840' },
  codeChip: { backgroundColor: 'rgba(240,200,64,.12)', borderWidth: 1.5, borderColor: '#f0c840', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6, alignItems: 'center' },
  codeTxt: { color: '#f0c840', fontSize: 18, fontWeight: '900', letterSpacing: 2, fontFamily: 'monospace' as any },
  codeSub: { color: '#807050', fontSize: 9 },
  hostHint: { color: '#807050', fontSize: 11, marginBottom: 8 },
  mapBox: { height: 230, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  rowBtns: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  smallBtn: { backgroundColor: 'rgba(40,32,64,.6)', borderWidth: 1, borderColor: '#2a2040', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  smallBtnActive: { borderColor: '#f0c840', backgroundColor: 'rgba(240,200,64,.14)' },
  smallTxt: { color: '#c0a0f0', fontSize: 12, fontWeight: '700' },
  smallTxtActive: { color: '#f0c840' },
  wpCount: { color: '#807050', fontSize: 11 },
  section: { color: '#e0c080', fontSize: 12, fontWeight: '800', marginTop: 6, marginBottom: 4 },
  hint: { color: '#807050', fontSize: 12, textAlign: 'center', marginTop: 8 },
  err: { color: '#ff6040', fontSize: 12, marginBottom: 8 },
  role: { color: '#e0c080', fontSize: 14, fontWeight: '700', marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1428', gap: 8 },
  name: { flex: 1, color: '#e0c080', fontSize: 14 },
  roleTag: { fontSize: 13, color: '#c0a0f0', fontWeight: '700' },
  btn: { backgroundColor: 'rgba(60,160,20,.2)', borderWidth: 2, borderColor: '#3a8020', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnActive: { backgroundColor: 'rgba(60,160,20,.45)' },
  btnTxt: { color: '#80ff40', fontSize: 15, fontWeight: '800' },
  startBtn: { backgroundColor: 'rgba(160,60,200,.25)', borderWidth: 2, borderColor: '#803aa0', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  startTxt: { color: '#e060ff', fontSize: 15, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.85)', alignItems: 'center', justifyContent: 'center' },
  modalBox: { backgroundColor: '#141020', borderWidth: 2, borderColor: '#f0c840', borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
  modalCode: { color: '#f0c840', fontSize: 26, fontWeight: '900', letterSpacing: 4, fontFamily: 'monospace' as any },
});
