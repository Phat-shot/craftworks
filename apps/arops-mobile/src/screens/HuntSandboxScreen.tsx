// SCHNITZELJAGD SANDBOX — developer/tester screen for the Hunt engine
// (server/src/game/hunt.js), the Hunt equivalent of MatchSimScreen for AR
// Ops. No web editor/scan-code/DB-backed run exists yet (see CLAUDE.md's
// Schnitzeljagd note) — this drives a fixed, built-in scenario anchored to
// wherever the tester currently is, entirely through the server's real,
// unmodified engine via server/src/socket/hunt.js's hunt:sandbox_* events.
// Real GPS for your own progress; optional bot tracks auto-play on a timer
// so 'individual'/'teams' multi-track status is visible without needing
// several real people walking around at once.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { MapView, Camera, ShapeSource, CircleLayer } from '@maplibre/maplibre-react-native';
import { haversineMeters } from '@craftworks/arops-shared';
import { getSocket, saveLastPosition } from '../api';
import Icon, { IconName } from '../components/Icon';
import { OSM_STYLE, OSM_STYLE_DARK } from '../mapStyle';
import { useTelemetry } from '../hooks/useTelemetry';
import { useTheme, ThemeTokens, THEMES } from '../theme';

type PoiType = 'puzzle' | 'target' | 'base';
interface CurrentPoi {
  id: string; name: string; lat: number; lon: number; radiusM: number; type: PoiType;
  completed: boolean; arrivedAt: number | null; taskDeadlineAt: number | null;
}
interface Track {
  key: string; isMe: boolean; isBot: boolean; completedAt: number | null;
  groupIdx: number; groupCount: number; routeDeviation: boolean; legDeadlineAt: number | null;
  currentPois: CurrentPoi[];
}
interface AllPoi { id: string; name: string; lat: number; lon: number; orderIndex: number; type: PoiType; }
interface HuntEvent { seq: number; ts: number; type: string; key?: string; poiId?: string; correct?: boolean; }
interface SandboxState {
  runId: string; progressMode: 'shared' | 'teams' | 'individual';
  startedAt: number; endedAt: number | null; serverTime: number;
  allPois: AllPoi[]; tracks: Track[]; events: HuntEvent[];
}

const POI_ICON: Record<PoiType, IconName> = { puzzle: 'target', target: 'bomb', base: 'flagCheckered' };
const POI_LABEL: Record<PoiType, string> = { puzzle: 'Rätsel', target: 'Ziel', base: 'Basis' };
const EVENT_LABEL: Record<string, string> = {
  poi_arrived: 'Angekommen', poi_completed: 'Aufgabe erledigt', puzzle_wrong: 'Falsche Antwort',
  timeout: 'Zeitüberschreitung', route_deviation: 'Route verlassen', progress_finished: 'Strecke fertig',
  progress_failed: 'Strecke gescheitert', run_ended: 'Sandbox beendet', progress_started: 'Beigetreten',
  progress_cloned: 'Fortschritt kopiert', targets_reactivated: 'Ziele reaktiviert',
};

export default function HuntSandboxScreen({ onExit }: { onExit: () => void }) {
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const mapStyle = theme === THEMES.day ? OSM_STYLE : OSM_STYLE_DARK;

  const telemetry = useTelemetry(getSocket(), null, true);
  const myPos = telemetry.sample ? { lat: telemetry.sample.lat, lon: telemetry.sample.lon } : null;
  useEffect(() => { if (telemetry.sample) saveLastPosition(telemetry.sample.lat, telemetry.sample.lon); }, [telemetry.sample]);

  const [running, setRunning] = useState(false);
  const [progressMode, setProgressMode] = useState<'shared' | 'teams' | 'individual'>('individual');
  const [botCount, setBotCount] = useState(0);
  const [state, setState] = useState<SandboxState | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [wrongFlashPoiId, setWrongFlashPoiId] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const onState = (s: SandboxState) => { setState(s); if (s.endedAt) setRunning(false); };
    const onResult = (r: { ok: boolean; correct?: boolean; err?: string }) => {
      if (r.ok && r.correct === false) {
        setWrongFlashPoiId('x'); // brief generic flash — exact POI doesn't matter for a single-input UI
        setTimeout(() => setWrongFlashPoiId(null), 1200);
      }
    };
    socket.on('hunt:sandbox_state', onState);
    socket.on('hunt:sandbox_action_result', onResult);
    return () => {
      socket.off('hunt:sandbox_state', onState);
      socket.off('hunt:sandbox_action_result', onResult);
      socket.emit('hunt:sandbox_stop');
    };
  }, []);

  // Real telemetry drives my own track's arrival checks — throttled to
  // roughly the same 1Hz useTelemetry already samples at (sample itself
  // only updates ~1x/s), no extra timer needed.
  const lastSentRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!running || !telemetry.sample) return;
    const last = lastSentRef.current;
    if (last && last.lat === telemetry.sample.lat && last.lon === telemetry.sample.lon) return;
    lastSentRef.current = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    getSocket().emit('hunt:sandbox_telemetry', { lat: telemetry.sample.lat, lon: telemetry.sample.lon });
  }, [running, telemetry.sample?.lat, telemetry.sample?.lon]);

  const start = () => {
    const origin = myPos || { lat: 48.13743, lon: 11.57549 }; // last-resort fallback, same convention as MatchSimScreen
    getSocket().emit('hunt:sandbox_start', { ...origin, progressMode, botCount });
    setRunning(true);
  };
  const stop = () => {
    getSocket().emit('hunt:sandbox_stop');
    setRunning(false);
    setState(null);
  };

  const myTrack = state?.tracks.find(t => t.isMe) || null;
  const otherTracks = state?.tracks.filter(t => !t.isMe) || [];

  const submitAnswer = (poiId: string) => {
    if (!answerText.trim()) return;
    getSocket().emit('hunt:sandbox_puzzle_answer', { poiId, answer: answerText });
    setAnswerText('');
  };
  const confirmTarget = (poiId: string) => getSocket().emit('hunt:sandbox_confirm_target', { poiId });

  const center: [number, number] = myPos ? [myPos.lon, myPos.lat]
    : (state?.allPois[0] ? [state.allPois[0].lon, state.allPois[0].lat] : [11.5755, 48.1374]);

  const poiMarkersGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (state?.allPois || []).map(p => {
      const active = myTrack?.currentPois.some(cp => cp.id === p.id) ?? false;
      const done = myTrack ? !myTrack.currentPois.some(cp => cp.id === p.id) && myTrack.groupIdx > (state?.allPois.find(x => x.id === p.id)?.orderIndex ?? -1) : false;
      return {
        type: 'Feature' as const, properties: { active, done },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      };
    }),
  }), [state?.allPois, myTrack?.currentPois, myTrack?.groupIdx]);

  if (!running || !state) {
    return (
      <View style={st.setupWrap}>
        <Icon name="crosshair" size={48} color={theme.accent} style={{ marginBottom: 8 }} />
        <Text style={st.title}>Schnitzeljagd-Sandbox</Text>
        <Text style={st.hint}>
          Testet die echte Hunt-Engine mit einem fest eingebauten Szenario (Rätsel → Ziel → paralleles
          Rätsel/Ziel-Paar → Basis), verankert an deiner aktuellen Position.
        </Text>
        <Text style={st.sectionLabel}>Fortschritts-Modus</Text>
        <View style={st.rowBtns}>
          {(['individual', 'teams', 'shared'] as const).map(m => (
            <TouchableOpacity key={m} style={[st.smallBtn, progressMode === m && st.smallBtnActive]}
              onPress={() => setProgressMode(m)}>
              <Text style={[st.smallTxt, progressMode === m && st.smallTxtActive]}>
                {m === 'individual' ? 'Einzeln' : m === 'teams' ? 'Teams' : 'Gemeinsam'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={st.sectionLabel}>Bots (simulieren Mitspieler)</Text>
        <View style={st.rowBtns}>
          {[0, 1, 2].map(n => (
            <TouchableOpacity key={n} style={[st.smallBtn, botCount === n && st.smallBtnActive]}
              onPress={() => setBotCount(n)}>
              <Text style={[st.smallTxt, botCount === n && st.smallTxtActive]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!myPos && <Text style={st.warn}>Kein GPS-Fix — startet notfalls an einer festen Position.</Text>}
        <TouchableOpacity style={st.startBtn} onPress={start}>
          <Icon name="play" size={16} color="#0a2010" />
          <Text style={st.startTxt}>Sandbox starten</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.exitBtn} onPress={onExit}>
          <Text style={st.exitTxt}>Zurück</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={st.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={st.mapBox}>
        <MapView style={{ flex: 1 }} mapStyle={mapStyle as any} scrollEnabled zoomEnabled>
          <Camera defaultSettings={{ centerCoordinate: center, zoomLevel: 15.5 }} />
          {myPos && (
            <ShapeSource id="me" shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [myPos.lon, myPos.lat] } }}>
              <CircleLayer id="meDot" style={{ circleRadius: 8, circleColor: '#40a0ff', circleStrokeWidth: 2, circleStrokeColor: '#fff' }} />
            </ShapeSource>
          )}
          {(state.allPois.length > 0) && (
            <ShapeSource id="pois" shape={poiMarkersGeoJSON as any}>
              <CircleLayer id="poiDots" style={{
                circleRadius: 10,
                circleColor: ['case', ['get', 'done'], '#50d040', ['get', 'active'], '#f0c840', '#808080'] as any,
                circleOpacity: ['case', ['get', 'active'], 1, 0.55] as any,
                circleStrokeWidth: 2, circleStrokeColor: '#000',
              }} />
            </ShapeSource>
          )}
        </MapView>
        <TouchableOpacity style={st.stopFab} onPress={stop}>
          <Icon name="close" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={st.panel} contentContainerStyle={{ paddingBottom: 24 }}>
        {state.endedAt && (
          <View style={st.finishedBanner}>
            <Icon name="trophy" size={16} color="#0a2010" />
            <Text style={st.finishedTxt}>Sandbox beendet — jede Strecke ist fertig</Text>
          </View>
        )}

        <Text style={st.sectionLabel}>Deine aktuelle(n) Aufgabe(n)</Text>
        {myTrack?.completedAt ? (
          <Text style={st.hint}>Deine Strecke ist fertig.</Text>
        ) : (myTrack?.currentPois || []).map(poi => {
          const dist = myPos ? Math.round(haversineMeters(myPos, poi)) : null;
          const arrived = !!poi.arrivedAt;
          const deadlineS = poi.taskDeadlineAt ? Math.max(0, Math.ceil((poi.taskDeadlineAt - state.serverTime) / 1000)) : null;
          return (
            <View key={poi.id} style={st.poiCard}>
              <View style={st.poiHeaderRow}>
                <Icon name={POI_ICON[poi.type]} size={15} color={arrived ? theme.accent : theme.text2} />
                <Text style={st.poiTitle}>{poi.name} · {POI_LABEL[poi.type]}</Text>
              </View>
              <Text style={st.poiSub}>
                {dist !== null ? `${dist}m entfernt` : 'GPS wird gesucht…'}
                {arrived ? ' · angekommen' : ''}
                {deadlineS !== null ? ` · ${deadlineS}s Zeitlimit` : ''}
              </Text>
              {poi.type === 'puzzle' && arrived && (
                <View style={st.answerRow}>
                  <TextInput style={st.answerInput} placeholder="Antwort…" placeholderTextColor={theme.text3}
                    value={answerText} onChangeText={setAnswerText} onSubmitEditing={() => submitAnswer(poi.id)} />
                  <TouchableOpacity style={st.answerBtn} onPress={() => submitAnswer(poi.id)}>
                    <Icon name="checkCircle" size={16} color="#0a2010" />
                  </TouchableOpacity>
                </View>
              )}
              {poi.type === 'target' && arrived && (
                <TouchableOpacity style={st.confirmBtn} onPress={() => confirmTarget(poi.id)}>
                  <Icon name="bomb" size={14} color="#0a2010" />
                  <Text style={st.confirmTxt}>Als zerstört bestätigen</Text>
                </TouchableOpacity>
              )}
              {poi.type === 'base' && !arrived && (
                <Text style={st.hint}>Lauf einfach hin — zählt sofort bei Ankunft.</Text>
              )}
            </View>
          );
        })}
        {!!wrongFlashPoiId && <Text style={st.wrongTxt}>Falsche Antwort — nochmal versuchen.</Text>}

        {otherTracks.length > 0 && (
          <>
            <Text style={st.sectionLabel}>
              {state.progressMode === 'teams' ? 'Anderes Team' : 'Andere Strecken'}
            </Text>
            {otherTracks.map(t => (
              <View key={t.key} style={st.trackRow}>
                <Icon name={t.isBot ? 'robot' : 'people'} size={13} color={theme.text2} />
                <Text style={st.trackTxt}>
                  {t.key}{t.isBot ? ' (Bot)' : ''} — {t.completedAt ? 'fertig' : `Gruppe ${t.groupIdx + 1}/${t.groupCount}`}
                </Text>
              </View>
            ))}
          </>
        )}

        <Text style={st.sectionLabel}>Ereignisse</Text>
        {[...state.events].reverse().slice(0, 12).map(e => (
          <Text key={e.seq} style={st.eventTxt}>
            {EVENT_LABEL[e.type] || e.type}{e.key ? ` · ${e.key}` : ''}
          </Text>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: theme.bg },
    setupWrap: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
    hint: { color: theme.text3, fontSize: 12, textAlign: 'center', marginBottom: 4, paddingHorizontal: 8 },
    warn: { color: theme.danger, fontSize: 12, marginTop: 8, textAlign: 'center' },
    sectionLabel: { color: theme.text2, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
    rowBtns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
    smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.bg2, borderWidth: 1, borderColor: theme.border },
    smallBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    smallTxt: { color: theme.text2, fontSize: 13, fontWeight: '600' },
    smallTxtActive: { color: theme.onAccent, fontWeight: '800' },
    startBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#50d040',
      borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 20,
    },
    startTxt: { color: '#0a2010', fontSize: 16, fontWeight: '800' },
    exitBtn: { marginTop: 14, padding: 8 },
    exitTxt: { color: theme.text3, fontSize: 13 },
    mapBox: { height: '38%', borderBottomWidth: 1, borderBottomColor: theme.border },
    stopFab: {
      position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17,
      backgroundColor: 'rgba(224,48,32,0.85)', alignItems: 'center', justifyContent: 'center',
    },
    panel: { flex: 1, padding: 14 },
    finishedBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#50d040',
      borderRadius: 10, padding: 12, marginBottom: 10,
    },
    finishedTxt: { color: '#0a2010', fontWeight: '800', fontSize: 13 },
    poiCard: {
      backgroundColor: theme.bg2, borderRadius: 10, padding: 12, marginBottom: 8,
      borderWidth: 1, borderColor: theme.border,
    },
    poiHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    poiTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
    poiSub: { color: theme.text3, fontSize: 12, marginTop: 4 },
    answerRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    answerInput: {
      flex: 1, backgroundColor: theme.bg, borderRadius: 8, borderWidth: 1, borderColor: theme.border,
      paddingHorizontal: 10, paddingVertical: 8, color: theme.text, fontSize: 13,
    },
    answerBtn: { backgroundColor: '#50d040', borderRadius: 8, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
    confirmBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f0c840',
      borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginTop: 8, alignSelf: 'flex-start',
    },
    confirmTxt: { color: '#0a2010', fontSize: 13, fontWeight: '700' },
    wrongTxt: { color: theme.danger, fontSize: 12, marginBottom: 8 },
    trackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    trackTxt: { color: theme.text2, fontSize: 12 },
    eventTxt: { color: theme.text3, fontSize: 11, marginBottom: 2 },
  });
}
