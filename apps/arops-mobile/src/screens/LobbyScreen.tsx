import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Modal, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import { getSocket, getUser, fetchLobbyQr } from '../api';
import Icon, { IconName } from '../components/Icon';
import ComicMapLayers, { ComicFeature } from '../components/ComicMapLayers';
import { OSM_STYLE, BLANK_STYLE } from '../mapStyle';

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
  foundMode?: 'spectator' | 'seeker';
  bots?: { id: string; username: string }[];
  debugMode?: boolean;
  comicMap?: ComicMap;
}

const SUB_MODES: { id: string; icon: IconName; label: string }[] = [
  { id: 'hide_and_seek', icon: 'ghost', label: 'Verstecken' },
  { id: 'domination', icon: 'target', label: 'Herrschaft' },
  { id: 'ctf', icon: 'flag', label: 'Flagge' },
  { id: 'seek_destroy', icon: 'bomb', label: 'Sprengen' },
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
  const [myPos, setMyPos] = useState<{ lat: number; lon: number } | null>(null);
  const [myPosLoading, setMyPosLoading] = useState(false);
  const [myPosErr, setMyPosErr] = useState(false);
  const me = getUser();
  const arRef = useRef(ar);
  arRef.current = ar;
  const comicMapReqRef = useRef<string | null>(null);

  // One-shot fetch (not a live watch) — this is just a reference point for
  // drawing the field, not gameplay telemetry, so no need to keep polling.
  // GPS can be unreliable on first try (cold fix, permission dialog timing),
  // so this is also wired to a manual retry button on the map, not just mount.
  const loadMyPosition = async () => {
    setMyPosLoading(true);
    setMyPosErr(false);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setMyPosErr(true); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMyPos({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    } catch {
      setMyPosErr(true);
    } finally {
      setMyPosLoading(false);
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
    const onError = ({ code }: any) => { if (START_ERR[code]) setStartErr(START_ERR[code]!); };
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

  const emitUpdate = (patch: Partial<ArSettings>) => {
    getSocket().emit('lobby:ar_update', { lobbyId, arSettings: { ...arRef.current, ...patch } });
  };

  const polygon = ar.polygon || [];
  const zones = ar.zones || [];
  const subMode = ar.subMode || 'hide_and_seek';
  const teamMode = subMode !== 'hide_and_seek';
  const foundMode = ar.foundMode || 'spectator';
  const bots = ar.bots || [];
  const debugMode = ar.debugMode || false;
  // Bots are display-only overlay from ar_settings — never touch the real
  // socket-driven `members` state, which tracks actual joined players.
  const displayMembers = useMemo(
    () => [...members.map(m => ({ ...m, isBot: false })), ...bots.map(b => ({ id: b.id, username: b.username, ready: true, isBot: true }))],
    [members, bots]
  );
  // Server is the single source of truth for roles/teams
  const roleOf = (uid: string) => ar.roles?.[uid] || 'hider';
  const teamOf = (uid: string) => ar.teams?.[uid] || 'a';

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
    getSocket().emit('lobby:generate_comic_map', { lobbyId, reqId });
  };

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

  const header = (
    <View>
      {/* Code prominent + tap → QR popup */}
      <View style={st.topRow}>
        <View style={st.titleRow}>
          <Icon name="satellite" size={18} color="#f0c840" />
          <Text style={st.title}>Lobby</Text>
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
        <>
          <View style={st.sectionRow}>
            <Icon name="target" size={13} color="#e0c080" />
            <Text style={st.section}>Modus</Text>
          </View>
          <View style={st.rowBtns}>
          {SUB_MODES.map(m => (
            <TouchableOpacity key={m.id} style={[st.smallBtnRow, subMode === m.id && st.smallBtnActive]}
              onPress={() => emitUpdate({ subMode: m.id })}>
              <Icon name={m.icon} size={13} color={subMode === m.id ? '#f0c840' : '#c0a0f0'} />
              <Text style={[st.smallTxt, subMode === m.id && st.smallTxtActive]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
          </View>
        </>
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
                circleRadius: 8, circleColor: '#40a0ff', circleOpacity: 0.85,
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
        <TouchableOpacity style={st.locateBtn} onPress={loadMyPosition} disabled={myPosLoading}>
          {myPosLoading ? <ActivityIndicator size="small" color="#40a0ff" /> : (
            <Icon name={myPosErr ? 'warning' : 'crosshair'} size={18} color={myPosErr ? '#ff6040' : '#40a0ff'} />
          )}
        </TouchableOpacity>
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
          <View style={st.divider} />
          <View style={st.sectionRow}>
            <Icon name="settings" size={13} color="#e0c080" />
            <Text style={st.section}>Einstellungen</Text>
          </View>
          <View style={st.rowBtns}>
            <TouchableOpacity style={st.smallBtnRow} onPress={addBot} disabled={bots.length >= 12}>
              <Icon name="robot" size={13} color="#c0a0f0" />
              <Text style={st.smallTxt}>Bot hinzufügen</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.smallBtnRow, debugMode && st.smallBtnActive]} onPress={toggleDebugMode}>
              <Icon name="bug" size={13} color={debugMode ? '#f0c840' : '#c0a0f0'} />
              <Text style={[st.smallTxt, debugMode && st.smallTxtActive]}>Debug-Modus {debugMode ? 'AN' : 'AUS'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.smallBtnRow} onPress={generateComicMap}
              disabled={polygon.length < 3 || polyErrs.length > 0 || comicMapLoading}>
              {comicMapLoading ? <ActivityIndicator size="small" color="#c0a0f0" /> : (
                <Icon name={comicMapStale ? 'loop' : 'palette'} size={13} color="#c0a0f0" />
              )}
              <Text style={st.smallTxt}>
                {comicMapLoading ? 'Lädt…' : ar.comicMap ? (comicMapStale ? 'Comic-Karte neu generieren' : 'Comic-Karte aktualisieren') : 'Comic-Karte generieren'}
              </Text>
            </TouchableOpacity>
          </View>
          {!!comicMapErr && (
            <View style={st.errRow}>
              <Icon name="warning" size={13} color="#ff6040" />
              <Text style={st.err}>{comicMapErr}</Text>
            </View>
          )}
          {subMode === 'hide_and_seek' && (
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
            </View>
          )}
          {NEEDS_ZONES[subMode] !== undefined && (
            <View style={st.rowBtns}>
              <Text style={st.wpCount}>Tippen setzt:</Text>
              <TouchableOpacity style={[st.smallBtn, tapMode === 'polygon' && st.smallBtnActive]} onPress={() => setTapMode('polygon')}>
                <Text style={[st.smallTxt, tapMode === 'polygon' && st.smallTxtActive]}>Spielfeld</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.smallBtn, tapMode === 'zones' && st.smallBtnActive]} onPress={() => setTapMode('zones')}>
                <Text style={[st.smallTxt, tapMode === 'zones' && st.smallTxtActive]}>Zonen ({zones.length}/{NEEDS_ZONES[subMode]}+)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.smallBtnRow} onPress={() => emitUpdate({ zones: [] })} disabled={!zones.length}>
                <Icon name="trash" size={13} color="#c0a0f0" />
                <Text style={st.smallTxt}>Zonen leeren</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={st.rowBtns}>
            <TouchableOpacity style={st.smallBtnRow} onPress={() => emitUpdate({ polygon: polygon.slice(0, -1) })} disabled={!polygon.length}>
              <Icon name="undo" size={13} color="#c0a0f0" />
              <Text style={st.smallTxt}>Punkt zurück</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.smallBtnRow} onPress={() => emitUpdate({ polygon: [] })} disabled={!polygon.length}>
              <Icon name="trash" size={13} color="#c0a0f0" />
              <Text style={st.smallTxt}>Feld leeren</Text>
            </TouchableOpacity>
            <Text style={st.wpCount}>{polygon.length} Punkte</Text>
          </View>
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
      <View style={st.sectionRow}>
        <Icon name="people" size={13} color="#e0c080" />
        <Text style={st.section}>Spieler {isHost ? (teamMode ? '(Team antippen)' : '(Rolle antippen)') : ''}</Text>
      </View>
    </View>
  );

  const footer = (
    <View>
      {me && displayMembers.length > 0 && (
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
            {teamMode ? (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => toggleTeam(item.id)}>
                <Icon name="circle" size={11} color={teamOf(item.id) === 'a' ? '#40a0ff' : '#ff5050'} />
                <Text style={[st.roleTag, { color: teamOf(item.id) === 'a' ? '#40a0ff' : '#ff5050' }]}>
                  {teamOf(item.id) === 'a' ? 'Team A' : 'Team B'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity disabled={!isHost} style={st.roleTagRow} onPress={() => toggleRole(item.id)}>
                <Icon name={roleOf(item.id) === 'seeker' ? 'flashlight' : 'ghost'} size={13} color="#c0a0f0" />
                <Text style={st.roleTag}>{roleOf(item.id) === 'seeker' ? 'Seeker' : 'Hider'}</Text>
              </TouchableOpacity>
            )}
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
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 20, fontWeight: '900', color: '#f0c840' },
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
