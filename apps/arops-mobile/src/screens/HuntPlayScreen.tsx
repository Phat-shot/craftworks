// SCHNITZELJAGD — real, DB-backed play screen: join a host-built scenario
// by its scan code and play it through server/src/socket/hunt.js's
// hunt:live_* events (see client/src/pages/HuntPlay.jsx for the reference
// web implementation this mirrors). Distinct from HuntSandboxScreen (fixed
// built-in scenario, no code, engine-testing tool) — this is the actual
// player-facing entry point once a host has built + saved + generated a
// code for a real scenario in the web editor. Deliberately slim: code
// entry, then map + current-task card(s) + recent events, same density as
// the sandbox screen rather than a heavier onboarding flow.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { MapView, Camera, ShapeSource, CircleLayer } from '@maplibre/maplibre-react-native';
import { haversineMeters } from '@craftworks/arops-shared';
import { getSocket, saveLastPosition } from '../api';
import Icon, { IconName } from '../components/Icon';
import { OSM_STYLE, OSM_STYLE_DARK } from '../mapStyle';
import { useTelemetry } from '../hooks/useTelemetry';
import { useTheme, ThemeTokens, THEMES } from '../theme';

type PoiType = 'puzzle' | 'target' | 'capture' | 'base' | 'carry_from' | 'carry_to';
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
interface LiveState {
  runId: string; progressMode: 'shared' | 'teams' | 'individual';
  startedAt: number; endedAt: number | null; serverTime: number;
  allPois: AllPoi[]; tracks: Track[]; events: HuntEvent[];
}

// Confirm-types (target/capture) need an explicit "erledigt" tap; the rest
// (base/carry_from/carry_to) auto-complete on arrival alone — mirrors
// hunt.js's own CONFIRM_TYPES/AUTO_COMPLETE_TYPES split exactly, this UI
// has no independent opinion about which types need a button.
const CONFIRM_TYPES = new Set<PoiType>(['target', 'capture']);
const POI_ICON: Record<PoiType, IconName> = {
  puzzle: 'puzzlePiece', target: 'bomb', capture: 'flag', base: 'flagCheckered',
  carry_from: 'box', carry_to: 'flagCheckered',
};
const POI_LABEL: Record<PoiType, string> = {
  puzzle: 'Rätsel', target: 'Zerstören', capture: 'Capture', base: 'Basis',
  carry_from: 'Abholen', carry_to: 'Abliefern',
};
const JOIN_ERR: Record<string, string> = {
  not_found: 'Code nicht gefunden', expired: 'Code abgelaufen', session_full: 'Session voll',
  scenario_empty: 'Szenario hat keine POIs', server_error: 'Fehler beim Beitreten',
};
const EVENT_LABEL: Record<string, string> = {
  poi_arrived: 'Angekommen', poi_completed: 'Aufgabe erledigt', puzzle_wrong: 'Falsche Antwort',
  timeout: 'Zeitüberschreitung', route_deviation: 'Route verlassen', progress_finished: 'Strecke fertig',
  progress_failed: 'Strecke gescheitert', run_ended: 'Schnitzeljagd beendet', progress_started: 'Beigetreten',
  progress_cloned: 'Fortschritt kopiert',
};

export default function HuntPlayScreen({ onExit }: { onExit: () => void }) {
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const mapStyle = theme === THEMES.day ? OSM_STYLE : OSM_STYLE_DARK;

  const telemetry = useTelemetry(getSocket(), null, true);
  const myPos = telemetry.sample ? { lat: telemetry.sample.lat, lon: telemetry.sample.lon } : null;
  useEffect(() => { if (telemetry.sample) saveLastPosition(telemetry.sample.lat, telemetry.sample.lon); }, [telemetry.sample]);

  const [code, setCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [joinErr, setJoinErr] = useState('');
  const [state, setState] = useState<LiveState | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [wrongFlashPoiId, setWrongFlashPoiId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const onJoined = ({ runId }: { runId: string }) => { runIdRef.current = runId; setJoined(true); setJoinErr(''); };
    const onState = (s: LiveState) => setState(s);
    const onErr = ({ err }: { err: string }) => setJoinErr(JOIN_ERR[err] || 'Fehler beim Beitreten');
    const onResult = (r: { ok: boolean; correct?: boolean; err?: string }) => {
      if (r.ok && r.correct === false) {
        setWrongFlashPoiId('x'); // brief generic flash — exact POI doesn't matter for a single-input UI
        setTimeout(() => setWrongFlashPoiId(null), 1200);
      }
    };
    socket.on('hunt:live_joined', onJoined);
    socket.on('hunt:live_state', onState);
    socket.on('hunt:live_error', onErr);
    socket.on('hunt:live_action_result', onResult);
    return () => {
      socket.off('hunt:live_joined', onJoined);
      socket.off('hunt:live_state', onState);
      socket.off('hunt:live_error', onErr);
      socket.off('hunt:live_action_result', onResult);
      if (runIdRef.current) socket.emit('hunt:live_leave', { runId: runIdRef.current });
    };
  }, []);

  // Real telemetry drives my own track's arrival checks — throttled to
  // roughly the same 1Hz useTelemetry already samples at (sample itself
  // only updates ~1x/s), no extra timer needed. Same pattern as
  // HuntSandboxScreen, just runId-scoped instead of session-less.
  const lastSentRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!joined || !telemetry.sample || !runIdRef.current) return;
    const last = lastSentRef.current;
    if (last && last.lat === telemetry.sample.lat && last.lon === telemetry.sample.lon) return;
    lastSentRef.current = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    getSocket().emit('hunt:live_telemetry', {
      runId: runIdRef.current, lat: telemetry.sample.lat, lon: telemetry.sample.lon,
    });
  }, [joined, telemetry.sample?.lat, telemetry.sample?.lon]);

  const join = () => {
    if (!code.trim()) return;
    setJoinErr('');
    getSocket().emit('hunt:join_by_code', { code: code.trim().toUpperCase() });
  };
  const leave = () => {
    if (runIdRef.current) getSocket().emit('hunt:live_leave', { runId: runIdRef.current });
    runIdRef.current = null;
    setJoined(false);
    setState(null);
  };

  const myTrack = state?.tracks.find(t => t.isMe) || null;
  const otherTracks = state?.tracks.filter(t => !t.isMe) || [];

  const submitAnswer = (poiId: string) => {
    if (!answerText.trim() || !runIdRef.current) return;
    getSocket().emit('hunt:live_puzzle_answer', { runId: runIdRef.current, poiId, answer: answerText });
    setAnswerText('');
  };
  const confirmTask = (poiId: string) => {
    if (!runIdRef.current) return;
    getSocket().emit('hunt:live_confirm_task', { runId: runIdRef.current, poiId });
  };

  const center: [number, number] = myPos ? [myPos.lon, myPos.lat]
    : (state?.allPois[0] ? [state.allPois[0].lon, state.allPois[0].lat] : [11.5755, 48.1374]);

  const poiMarkersGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (state?.allPois || []).map(p => {
      const active = myTrack?.currentPois.some(cp => cp.id === p.id) ?? false;
      const done = myTrack ? !myTrack.currentPois.some(cp => cp.id === p.id) && myTrack.groupIdx > p.orderIndex : false;
      return {
        type: 'Feature' as const, properties: { active, done },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      };
    }),
  }), [state?.allPois, myTrack?.currentPois, myTrack?.groupIdx]);

  if (!joined || !state) {
    return (
      <View style={st.setupWrap}>
        <Icon name="flagCheckered" size={48} color={theme.accent} style={{ marginBottom: 8 }} />
        <Text style={st.title}>Schnitzeljagd</Text>
        <Text style={st.hint}>Code eingeben, um einer laufenden Schnitzeljagd beizutreten.</Text>
        <TextInput style={st.codeInput} placeholder="CODE" placeholderTextColor={theme.text3}
          value={code} onChangeText={t => setCode(t.toUpperCase())} autoCapitalize="characters"
          autoCorrect={false} onSubmitEditing={join} />
        {!!joinErr && <Text style={st.warn}>{joinErr}</Text>}
        <TouchableOpacity style={st.startBtn} onPress={join}>
          <Icon name="play" size={16} color="#0a2010" />
          <Text style={st.startTxt}>Beitreten</Text>
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
        <TouchableOpacity style={st.stopFab} onPress={leave}>
          <Icon name="close" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={st.panel} contentContainerStyle={{ paddingBottom: 24 }}>
        {state.endedAt && (
          <View style={st.finishedBanner}>
            <Icon name="trophy" size={16} color="#0a2010" />
            <Text style={st.finishedTxt}>Schnitzeljagd beendet</Text>
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
              {CONFIRM_TYPES.has(poi.type) && arrived && (
                <TouchableOpacity style={st.confirmBtn} onPress={() => confirmTask(poi.id)}>
                  <Icon name={POI_ICON[poi.type]} size={14} color="#0a2010" />
                  <Text style={st.confirmTxt}>Als erledigt bestätigen</Text>
                </TouchableOpacity>
              )}
              {!CONFIRM_TYPES.has(poi.type) && poi.type !== 'puzzle' && !arrived && (
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
                <Icon name="people" size={13} color={theme.text2} />
                <Text style={st.trackTxt}>
                  {t.key} — {t.completedAt ? 'fertig' : `Gruppe ${t.groupIdx + 1}/${t.groupCount}`}
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
    codeInput: {
      width: 220, marginTop: 14, backgroundColor: theme.bg2, borderRadius: 10, borderWidth: 1, borderColor: theme.border,
      paddingVertical: 12, paddingHorizontal: 14, color: theme.text, fontSize: 20, fontWeight: '800',
      textAlign: 'center', letterSpacing: 2,
    },
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
