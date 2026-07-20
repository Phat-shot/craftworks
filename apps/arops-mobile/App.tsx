import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, BackHandler, Modal, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { restoreSession, loadLastPosition, createArLobby, getUser, logout } from './src/api';
import { SERVER_URL, BUILD_TIME } from './src/config';
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
    // seed its viewport with by the time any screen that needs it mounts.
    Promise.all([restoreSession(), loadLastPosition()])
      .then(([u]) => setRoute(u ? { name: 'menu' } : { name: 'login' }))
      .catch(() => setRoute({ name: 'login' }));
  }, []);

  const onGameStart = useCallback((sessionId: string) => setRoute({ name: 'game', sessionId }), []);

  const host = async () => {
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
          <TouchableOpacity style={st.hostBtn} onPress={host}>
            <Icon name="target" size={16} color="#80ff40" />
            <Text style={st.hostTxt}>Spiel hosten</Text>
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
            <TouchableOpacity style={st.menuIconBtn} onPress={() => setSettingsOpen(true)}>
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
            <Text style={st.modalHint}>Build: {BUILD_TIME}</Text>
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
  logoutBtn: {
    marginTop: 12, backgroundColor: 'rgba(224,48,32,.2)', borderWidth: 2, borderColor: '#a03020',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  logoutTxt: { color: '#ff6040', fontWeight: '800', fontSize: 14 },
});
