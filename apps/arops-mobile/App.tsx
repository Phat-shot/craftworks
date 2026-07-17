import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { restoreSession, createArLobby, getUser } from './src/api';
import LoginScreen from './src/screens/LoginScreen';
import JoinLobbyScreen from './src/screens/JoinLobbyScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen from './src/screens/GameScreen';

type Route =
  | { name: 'boot' }
  | { name: 'login' }
  | { name: 'menu' }
  | { name: 'join' }
  | { name: 'lobby'; lobbyId: string; isHost: boolean; lobbyCode?: string }
  | { name: 'game'; sessionId: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const [hostErr, setHostErr] = useState('');

  useEffect(() => {
    restoreSession()
      .then(u => setRoute(u ? { name: 'menu' } : { name: 'login' }))
      .catch(() => setRoute({ name: 'login' }));
  }, []);

  const onGameStart = useCallback((sessionId: string) => setRoute({ name: 'game', sessionId }), []);

  const host = async () => {
    setHostErr('');
    try {
      const { lobbyId, code } = await createArLobby(`AR Ops · ${getUser()?.username || 'Host'}`);
      setRoute({ name: 'lobby', lobbyId, isHost: true, lobbyCode: code });
    } catch (e: any) {
      setHostErr(e.message || 'Fehler beim Erstellen');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0810' }}>
      <StatusBar style="light" />
      {route.name === 'boot' && (
        <View style={st.center}><ActivityIndicator color="#f0c840" size="large" /></View>
      )}
      {route.name === 'login' && <LoginScreen onLoggedIn={() => setRoute({ name: 'menu' })} />}
      {route.name === 'menu' && (
        <View style={st.center}>
          <Text style={st.logo}>🛰️</Text>
          <Text style={st.title}>AR Ops</Text>
          <Text style={st.sub}>Hallo {getUser()?.username} 👋</Text>
          <TouchableOpacity style={st.hostBtn} onPress={host}>
            <Text style={st.hostTxt}>🎯 Spiel hosten</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.joinBtn} onPress={() => setRoute({ name: 'join' })}>
            <Text style={st.joinTxt}>🔗 Lobby beitreten</Text>
          </TouchableOpacity>
          {!!hostErr && <Text style={st.err}>{hostErr}</Text>}
        </View>
      )}
      {route.name === 'join' && <JoinLobbyScreen onJoined={(lobbyId) => setRoute({ name: 'lobby', lobbyId, isHost: false })} />}
      {route.name === 'lobby' && (
        <LobbyScreen lobbyId={route.lobbyId} isHost={route.isHost} lobbyCode={route.lobbyCode} onGameStart={onGameStart} />
      )}
      {route.name === 'game' && <GameScreen sessionId={route.sessionId} />}
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 56, marginBottom: 6 },
  title: { fontSize: 30, fontWeight: '900', color: '#f0c840', marginBottom: 4 },
  sub: { fontSize: 13, color: '#807050', marginBottom: 32 },
  hostBtn: {
    width: 260, backgroundColor: 'rgba(60,160,20,.25)', borderWidth: 2, borderColor: '#3a8020',
    borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12,
  },
  hostTxt: { color: '#80ff40', fontSize: 16, fontWeight: '800' },
  joinBtn: {
    width: 260, backgroundColor: 'rgba(160,60,200,.2)', borderWidth: 2, borderColor: '#803aa0',
    borderRadius: 12, padding: 16, alignItems: 'center',
  },
  joinTxt: { color: '#e060ff', fontSize: 16, fontWeight: '800' },
  err: { color: '#ff6040', fontSize: 12, marginTop: 12 },
});
