import React, { useMemo, useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { joinLobbyByCode, getUser, parseLobbyCode } from '../api';
import Icon from '../components/Icon';
import { useTheme, ThemeTokens } from '../theme';

export default function JoinLobbyScreen({ onJoined }: { onJoined: (lobbyId: string) => void }) {
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  const join = async (c: string) => {
    setError('');
    try {
      const { lobbyId } = await joinLobbyByCode(c);
      onJoined(lobbyId);
    } catch (e: any) {
      handled.current = false;
      setError(e.message === 'http_404' ? 'Lobby nicht gefunden'
        : e.message === 'session_expired' ? 'Sitzung abgelaufen — bitte App neu starten und einloggen'
        : e.message === 'network_error' ? 'Server nicht erreichbar — kurz erneut versuchen'
        : (e.message || 'Fehler'));
      setScanning(false);
    }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) return setError('Kamera-Zugriff benötigt zum Scannen');
    }
    handled.current = false;
    setScanning(true);
  };

  const onScan = ({ data }: { data: string }) => {
    if (handled.current) return;
    const c = parseLobbyCode(data);
    if (!c) return;
    handled.current = true;
    setCode(c);
    join(c);
  };

  if (scanning) {
    return (
      <View style={st.scanWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        <View style={st.scanFrame} pointerEvents="none" />
        <Text style={st.scanHint}>QR-Code der Lobby scannen</Text>
        <TouchableOpacity style={st.scanClose} onPress={() => setScanning(false)}>
          <Icon name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={st.wrap}>
      <View style={st.hiRow}>
        <Text style={st.hi}>Hallo {getUser()?.username}</Text>
        <Icon name="wave" size={13} color={theme.text3} />
      </View>
      <Text style={st.title}>Lobby beitreten</Text>
      <TextInput
        style={st.input}
        placeholder="8-STELLIGER CODE"
        placeholderTextColor={theme.text3}
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        maxLength={8}
      />
      {!!error && <Text style={st.err}>{error}</Text>}
      <TouchableOpacity style={st.btn} onPress={() => join(code)} disabled={code.trim().length < 6}>
        <View style={st.btnRow}>
          <Icon name="arrowRight" size={16} color="#e060ff" />
          <Text style={st.btnTxt}>Beitreten</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={st.scanBtn} onPress={openScanner}>
        <View style={st.btnRow}>
          <Icon name="qrcode" size={15} color={theme.text2} />
          <Text style={st.scanBtnTxt}>QR-Code scannen</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
    hiRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24 },
    hi: { color: theme.text3, fontSize: 13 },
    btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 24, fontWeight: '900', color: theme.accent, marginBottom: 16 },
    input: {
      width: 320, backgroundColor: theme.bg2, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
      padding: 14, color: theme.text, fontSize: 21, textAlign: 'center', letterSpacing: 3, marginBottom: 12,
      fontFamily: 'monospace' as any,
    },
    err: { color: theme.danger, marginBottom: 8, fontSize: 12 },
    // Keeps the same literal magenta brand accent as the start menu's own
    // "Lobby beitreten" button (App.tsx) — same action, same identity.
    btn: {
      width: 320, backgroundColor: 'rgba(160,60,200,.25)', borderWidth: 2, borderColor: 'rgba(128,58,160,.5)',
      borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10,
    },
    btnTxt: { color: '#e060ff', fontSize: 15, fontWeight: '800' },
    scanBtn: {
      width: 320, backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
      borderRadius: 10, padding: 12, alignItems: 'center',
    },
    scanBtnTxt: { color: theme.text2, fontSize: 14, fontWeight: '700' },
    // Camera-preview chrome sits over a live (always-dark) video feed, not
    // the app's own background — stays literal black/white/gold regardless
    // of theme, same reasoning as GameScreen's camera-mode overlays.
    scanWrap: { flex: 1, backgroundColor: '#000' },
    scanFrame: {
      position: 'absolute', top: '30%', left: '15%', width: '70%', aspectRatio: 1,
      borderWidth: 3, borderColor: '#f0c840', borderRadius: 16,
    },
    scanHint: { position: 'absolute', bottom: 90, alignSelf: 'center', color: '#fff', fontSize: 14, fontWeight: '700' },
    scanClose: { position: 'absolute', top: 52, right: 20, padding: 10 },
  });
}
