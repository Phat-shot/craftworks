import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, BackHandler, Modal, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import {
  restoreSession, loadLastPosition, createArLobby, getUser, logout,
  loadHeadingSettings, getHeadingSettings, saveHeadingSettings,
  getActiveGame, ActiveGame,
} from './src/api';
import { SERVER_URL, BUILD_TIME, COMMIT_SHA } from './src/config';
import Icon from './src/components/Icon';
import { useWatchSync } from './src/hooks/useWatchSync';
import { useEspSync } from './src/hooks/useEspSync';
import WatchPairModal from './src/components/WatchPairModal';
import LoginScreen from './src/screens/LoginScreen';
import JoinLobbyScreen from './src/screens/JoinLobbyScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen from './src/screens/GameScreen';
import GlossaryScreen from './src/screens/GlossaryScreen';

type Route =
  | { name: 'boot' }
  | { name: 'login' }
  | { name: 'menu' }
  | { name: 'join' }
  | { name: 'lobby'; lobbyId: string; isHost: boolean; lobbyCode?: string }
  | { name: 'game'; sessionId: string }
  | { name: 'glossary' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const [hostErr, setHostErr] = useState('');
  const watchSync = useWatchSync();
  const espSync = useEspSync();
  const [watchPairOpen, setWatchPairOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Compass-smoothing prefs (see api.ts's getHeadingSettings doc) — a
  // device-level tradeoff, so it lives here instead of GameScreen's own
  // in-match popup. Re-read from storage each time the modal opens (not
  // just once at mount) so it reflects loadHeadingSettings() having
  // finished by then, same reasoning as getUser() below just not reactive.
  const [headingSettings, setHeadingSettingsState] = useState(getHeadingSettings());
  const HEADING_RATE_STEPS_MS = [100, 150, 250, 400, 600, 1000];
  const HEADING_RENDER_STEPS_HZ = [10, 15, 20, 30, 45, 60, 90, 120];
  const updateHeadingSettings = (patch: Partial<ReturnType<typeof getHeadingSettings>>) => {
    saveHeadingSettings(patch);
    setHeadingSettingsState(getHeadingSettings());
  };
  const cycleHeadingRate = () => {
    const idx = HEADING_RATE_STEPS_MS.indexOf(headingSettings.sampleMs);
    updateHeadingSettings({ sampleMs: HEADING_RATE_STEPS_MS[(idx + 1) % HEADING_RATE_STEPS_MS.length]! });
  };
  const cycleHeadingRenderRate = () => {
    const pollingHz = 1000 / headingSettings.sampleMs;
    const steps = HEADING_RENDER_STEPS_HZ.filter(hz => hz >= pollingHz);
    if (!steps.length) steps.push(120);
    const idx = steps.indexOf(headingSettings.renderHz);
    updateHeadingSettings({ renderHz: steps[(idx + 1) % steps.length]! });
  };

  // A bare back-press used to close the whole app (Android's default
  // hardwareBackPress behavior with no handler on the root screen) from
  // ANY screen, including mid-match — one accidental back-swipe silently
  // dropped a live game with zero warning. Now: 'game' asks for
  // confirmation first (same underlying "leave" as the endgame recap's
  // "Beenden" button, just guarded since this one can fire mid-match, not
  // just after it's already over); 'lobby'/'join'/'glossary' — screens with
  // nothing at stake — go straight back to the main menu instead of
  // quitting the app outright.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'game') {
        Alert.alert(
          'Spiel verlassen?',
          'Das laufende Match wird für dich beendet.',
          [
            { text: 'Abbrechen', style: 'cancel' },
            { text: 'Verlassen', style: 'destructive', onPress: () => setRoute({ name: 'menu' }) },
          ],
        );
        return true;
      }
      if (route.name === 'lobby' || route.name === 'join' || route.name === 'glossary') {
        setRoute({ name: 'menu' });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route.name]);
  // Icon glyphs otherwise render blank on the first paint of every single
  // <Icon> instance (each one lazily self-loads its font in the background)
  // — explicitly waiting once here up front avoids that race entirely.
  const [fontsLoaded, fontError] = useFonts({ ...MaterialCommunityIcons.font, ...Ionicons.font });
  // Loading can fail or hang in a standalone build (asset packaging, device
  // quirks) — never block the whole app on it forever. On error or after a
  // timeout we proceed anyway; worst case icons render blank, same as before
  // this gate existed, instead of the app being stuck on the spinner.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const fontsReady = fontsLoaded || !!fontError || fontTimedOut;

  useEffect(() => {
    // Loaded alongside the session (not gated by it — device-local, not
    // tied to login) so the lobby map already has a last-known position to
    // seed its viewport with by the time any screen that needs it mounts,
    // and GameScreen has the compass-smoothing prefs ready the instant it
    // mounts too.
    Promise.all([restoreSession(), loadLastPosition(), loadHeadingSettings()])
      .then(([u]) => setRoute(u ? { name: 'menu' } : { name: 'login' }))
      .catch(() => setRoute({ name: 'login' }));
  }, []);

  const onGameStart = useCallback((sessionId: string) => setRoute({ name: 'game', sessionId }), []);

  // "Rejoin" — does this account still have a live game or an unstarted
  // lobby to go back to (app restart, connection drop mid-match, etc.)?
  // Re-checked every time the menu is shown, not just once at boot — the
  // most common way to land back on the menu is finishing/leaving a match,
  // which is exactly when this can change.
  const [activeGame, setActiveGame] = useState<ActiveGame>({ type: 'none' });
  useEffect(() => {
    if (route.name !== 'menu') return;
    getActiveGame().then(setActiveGame);
  }, [route.name]);
  const rejoin = () => {
    if (activeGame.type === 'game') setRoute({ name: 'game', sessionId: activeGame.sessionId });
    else if (activeGame.type === 'lobby') setRoute({ name: 'lobby', lobbyId: activeGame.lobbyId, isHost: activeGame.isHost, lobbyCode: activeGame.code });
  };

  // Guards against a double-tap firing two overlapping createArLobby calls
  // (no loading/disabled state existed on this button before) — each one
  // creates its own real lobby server-side, and whichever response happens
  // to resolve LAST silently wins `route`, leaving the other one an orphaned
  // lobby nobody's looking at — exactly the kind of "which lobby is this
  // actually" confusion reported. "Hosten" must always yield exactly one
  // fresh lobby per tap.
  const [hosting, setHosting] = useState(false);
  const host = async () => {
    if (hosting) return;
    setHosting(true);
    setHostErr('');
    try {
      const { lobbyId, code } = await createArLobby(`AR Ops · ${getUser()?.username || 'Host'}`);
      setRoute({ name: 'lobby', lobbyId, isHost: true, lobbyCode: code });
    } catch (e: any) {
      if (e.message === 'session_expired') {
        // Tokens are already cleared (see api.ts) — go straight to the login
        // screen instead of leaving the user stuck on a menu where every
        // action just fails the same way with no way back in.
        setRoute({ name: 'login' });
        return;
      }
      setHostErr(e.message === 'network_error' ? 'Server nicht erreichbar — kurz erneut versuchen'
        : (e.message || 'Fehler beim Erstellen'));
    } finally {
      setHosting(false);
    }
  };

  if (!fontsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0810' }}>
        <StatusBar style="light" />
        <View style={st.center}><ActivityIndicator color="#f0c840" size="large" /></View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0810' }}>
      <StatusBar style="light" />
      {route.name === 'boot' && (
        <View style={st.center}><ActivityIndicator color="#f0c840" size="large" /></View>
      )}
      {route.name === 'login' && <LoginScreen onLoggedIn={() => setRoute({ name: 'menu' })} />}
      {route.name === 'menu' && (
        <View style={st.center}>
          <Icon name="satellite" size={56} color="#f0c840" style={{ marginBottom: 6 }} />
          <Text style={st.title}>AR Ops</Text>
          <Text style={st.version}>v{Constants.expoConfig?.version || '–'}</Text>
          <View style={st.subRow}>
            <Text style={st.sub}>Hallo {getUser()?.username}</Text>
            <Icon name="wave" size={14} color="#807050" />
          </View>
          {/* Rejoin — a live game/lobby this account already has, e.g. after
              an app restart or a connection drop mid-match. Only ever an
              AR-Ops one (this app doesn't play the other game modes) — the
              server's own /lobbies/mine/active can technically return any
              mode. */}
          {(activeGame.type === 'game' || activeGame.type === 'lobby') && activeGame.gameMode === 'ar_ops' && (
            <TouchableOpacity style={st.rejoinBtn} onPress={rejoin}>
              <Icon name="loop" size={16} color="#40e0ff" />
              <Text style={st.rejoinTxt}>
                {activeGame.type === 'game' ? 'Zurück ins laufende Spiel' : 'Zurück zur Lobby'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[st.hostBtn, hosting && st.btnDisabled]} onPress={host} disabled={hosting}>
            <Icon name="target" size={16} color="#80ff40" />
            <Text style={st.hostTxt}>{hosting ? 'Erstelle Lobby…' : 'Spiel hosten'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.joinBtn} onPress={() => setRoute({ name: 'join' })}>
            <Icon name="link" size={16} color="#e060ff" />
            <Text style={st.joinTxt}>Lobby beitreten</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.glossaryBtn} onPress={() => setRoute({ name: 'glossary' })}>
            <Icon name="book" size={16} color="#f0c840" />
            <Text style={st.glossaryTxt}>Glossar</Text>
          </TouchableOpacity>
          {!!hostErr && <Text style={st.err}>{hostErr}</Text>}
          <View style={st.menuIconRow}>
            <TouchableOpacity style={[st.menuIconBtn, watchSync.paired && st.menuIconBtnActive]} onPress={() => setWatchPairOpen(true)}>
              <Icon name="watch" size={17} color={watchSync.paired ? '#f0c840' : '#c0a0f0'} />
            </TouchableOpacity>
            <TouchableOpacity style={[st.menuIconBtn, espSync.connected && st.menuIconBtnActive]} onPress={() => espSync.connect()}>
              <Icon name="usb" size={17} color={espSync.connected ? '#f0c840' : '#c0a0f0'} />
            </TouchableOpacity>
            <TouchableOpacity style={st.menuIconBtn} onPress={() => setInfoOpen(true)}>
              <Icon name="info" size={17} color="#c0a0f0" />
            </TouchableOpacity>
            <TouchableOpacity style={st.menuIconBtn} onPress={() => { setHeadingSettingsState(getHeadingSettings()); setSettingsOpen(true); }}>
              <Icon name="settings" size={17} color="#c0a0f0" />
            </TouchableOpacity>
          </View>
        </View>
      )}
      {route.name === 'join' && <JoinLobbyScreen onJoined={(lobbyId) => setRoute({ name: 'lobby', lobbyId, isHost: false })} />}
      {route.name === 'glossary' && <GlossaryScreen onBack={() => setRoute({ name: 'menu' })} />}
      {route.name === 'lobby' && (
        <LobbyScreen lobbyId={route.lobbyId} isHost={route.isHost} lobbyCode={route.lobbyCode} onGameStart={onGameStart} />
      )}
      {route.name === 'game' && (
        <GameScreen sessionId={route.sessionId} watchSync={watchSync} onExit={() => setRoute({ name: 'menu' })} />
      )}

      <WatchPairModal visible={watchPairOpen} onClose={() => setWatchPairOpen(false)} onClaim={watchSync.claim} />

      <Modal visible={infoOpen} animationType="slide" onRequestClose={() => setInfoOpen(false)} transparent>
        <View style={st.modalBackdrop}>
          <View style={st.modalCard}>
            <View style={st.modalHeader}>
              <Icon name="info" size={16} color="#f0c840" />
              <Text style={st.modalTitle}>Info</Text>
              <TouchableOpacity onPress={() => setInfoOpen(false)}><Icon name="close" size={18} color="#c0a0f0" /></TouchableOpacity>
            </View>
            <Text style={st.modalLine}>AR Ops · Version {Constants.expoConfig?.version || '–'}</Text>
            <Text style={st.modalLine}>Server: {SERVER_URL}</Text>
            <Text style={st.modalHint}>GPS+Kompass-basiertes Outdoor-Spiel — Hide&Seek, Domination, CTF, Seek&Destroy.</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)} transparent>
        <View style={st.modalBackdrop}>
          <View style={st.modalCard}>
            <View style={st.modalHeader}>
              <Icon name="settings" size={16} color="#f0c840" />
              <Text style={st.modalTitle}>Einstellungen</Text>
              <TouchableOpacity onPress={() => setSettingsOpen(false)}><Icon name="close" size={18} color="#c0a0f0" /></TouchableOpacity>
            </View>
            <Text style={st.modalLine}>Angemeldet als {getUser()?.username}</Text>
            <Text style={st.modalHint}>Build: {BUILD_TIME} · {COMMIT_SHA}</Text>
            {/* Kompass-Glättung — device-weites Performance/Glätte-Tradeoff,
                deshalb hier statt im in-Match-Popup von GameScreen. Aus: nur
                die Abtastrate zählt (1:1-Anzeige). An: zusätzlich eine
                Render-Rate zwischen der Abtastrate und 120Hz wählbar. */}
            <Text style={[st.modalLine, { marginTop: 8 }]}>Kompass-Glättung</Text>
            <View style={st.settingsRow}>
              <TouchableOpacity
                style={[st.settingsBtn, headingSettings.interpolation && st.settingsBtnActive]}
                onPress={() => updateHeadingSettings({ interpolation: !headingSettings.interpolation })}>
                <Icon name="loop" size={16} color={headingSettings.interpolation ? '#f0c840' : '#c0a0f0'} />
                <Text style={st.settingsBtnTxt}>Interpolation</Text>
              </TouchableOpacity>
            </View>
            <View style={st.settingsRow}>
              <TouchableOpacity style={st.settingsBtn} onPress={cycleHeadingRate}>
                <Text style={st.settingsBtnTxt}>Abtastrate: {headingSettings.sampleMs}ms</Text>
              </TouchableOpacity>
              {headingSettings.interpolation && (
                <TouchableOpacity style={st.settingsBtn} onPress={cycleHeadingRenderRate}>
                  <Text style={st.settingsBtnTxt}>Render: {headingSettings.renderHz}Hz</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={st.logoutBtn} onPress={async () => {
              await logout();
              setSettingsOpen(false);
              setRoute({ name: 'login' });
            }}>
              <Text style={st.logoutTxt}>Abmelden</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 30, fontWeight: '900', color: '#f0c840', marginBottom: 2 },
  version: { fontSize: 10, color: '#605850', marginBottom: 4 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 32 },
  sub: { fontSize: 13, color: '#807050' },
  rejoinBtn: {
    width: 260, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(40,160,200,.2)', borderWidth: 2, borderColor: '#2088a0',
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  rejoinTxt: { color: '#40e0ff', fontSize: 15, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  hostBtn: {
    width: 260, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(60,160,20,.25)', borderWidth: 2, borderColor: '#3a8020',
    borderRadius: 12, padding: 16, marginBottom: 12,
  },
  hostTxt: { color: '#80ff40', fontSize: 16, fontWeight: '800' },
  joinBtn: {
    width: 260, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(160,60,200,.2)', borderWidth: 2, borderColor: '#803aa0',
    borderRadius: 12, padding: 16,
  },
  joinTxt: { color: '#e060ff', fontSize: 16, fontWeight: '800' },
  glossaryBtn: {
    width: 260, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(240,200,64,.12)', borderWidth: 2, borderColor: '#8a7020',
    borderRadius: 12, padding: 16, marginTop: 12,
  },
  glossaryTxt: { color: '#f0c840', fontSize: 16, fontWeight: '800' },
  err: { color: '#ff6040', fontSize: 12, marginTop: 12 },
  menuIconRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  menuIconBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(40,32,64,.6)',
    borderWidth: 1, borderColor: '#2a2040', alignItems: 'center', justifyContent: 'center',
  },
  menuIconBtnActive: { borderColor: '#f0c840', backgroundColor: 'rgba(240,200,64,.15)' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 360, backgroundColor: '#141020', borderRadius: 16, borderWidth: 1, borderColor: '#2a2040', padding: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  modalTitle: { color: '#f0c840', fontSize: 16, fontWeight: '900', flex: 1 },
  modalLine: { color: '#c0a0f0', fontSize: 13, marginBottom: 8 },
  modalHint: { color: '#807050', fontSize: 12, marginTop: 4 },
  settingsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  settingsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(40,32,64,.6)',
    borderWidth: 1, borderColor: '#2a2040', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
  settingsBtnActive: { borderColor: '#f0c840', backgroundColor: 'rgba(240,200,64,.15)' },
  settingsBtnTxt: { color: '#c0a0f0', fontSize: 12, fontWeight: '800' },
  logoutBtn: {
    marginTop: 12, backgroundColor: 'rgba(224,48,32,.2)', borderWidth: 2, borderColor: '#a03020',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  logoutTxt: { color: '#ff6040', fontWeight: '800', fontSize: 14 },
});
