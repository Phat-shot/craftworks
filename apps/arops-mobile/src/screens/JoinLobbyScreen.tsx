import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { joinLobbyByCode, getUser, parseLobbyCode } from '../api';

export default function JoinLobbyScreen({ onJoined }: { onJoined: (lobbyId: string) => void }) {
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
          <Text style={{ color: '#fff', fontSize: 22 }}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={st.wrap}>
      <Text style={st.hi}>Hallo {getUser()?.username} 👋</Text>
      <Text style={st.title}>Lobby beitreten</Text>
      <TextInput
        style={st.input}
        placeholder="8-STELLIGER CODE"
        placeholderTextColor="#807050"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        maxLength={8}
      />
      {!!error && <Text style={st.err}>{error}</Text>}
      <TouchableOpacity style={st.btn} onPress={() => join(code)} disabled={code.trim().length < 6}>
        <Text style={st.btnTxt}>→ Beitreten</Text>
      </TouchableOpacity>
      <TouchableOpacity style={st.scanBtn} onPress={openScanner}>
        <Text style={st.scanBtnTxt}>📷 QR-Code scannen</Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810', alignItems: 'center', justifyContent: 'center', padding: 24 },
  hi: { color: '#807050', fontSize: 13, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '900', color: '#f0c840', marginBottom: 16 },
  input: {
    width: 320, backgroundColor: '#141020', borderWidth: 1, borderColor: '#2a2040', borderRadius: 10,
    padding: 14, color: '#e0c080', fontSize: 21, textAlign: 'center', letterSpacing: 3, marginBottom: 12,
    fontFamily: 'monospace' as any,
  },
  err: { color: '#ff6040', marginBottom: 8, fontSize: 12 },
  btn: {
    width: 320, backgroundColor: 'rgba(160,60,200,.25)', borderWidth: 2, borderColor: '#803aa0',
    borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10,
  },
  btnTxt: { color: '#e060ff', fontSize: 15, fontWeight: '800' },
  scanBtn: {
    width: 320, backgroundColor: 'rgba(40,32,64,.6)', borderWidth: 1, borderColor: '#4a3a70',
    borderRadius: 10, padding: 12, alignItems: 'center',
  },
  scanBtnTxt: { color: '#c0a0f0', fontSize: 14, fontWeight: '700' },
  scanWrap: { flex: 1, backgroundColor: '#000' },
  scanFrame: {
    position: 'absolute', top: '30%', left: '15%', width: '70%', aspectRatio: 1,
    borderWidth: 3, borderColor: '#f0c840', borderRadius: 16,
  },
  scanHint: { position: 'absolute', bottom: 90, alignSelf: 'center', color: '#fff', fontSize: 14, fontWeight: '700' },
  scanClose: { position: 'absolute', top: 52, right: 20, padding: 10 },
});
