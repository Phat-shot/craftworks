import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { loginGuest } from '../api';

export default function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    if (name.trim().length < 2) return setError('Mindestens 2 Zeichen');
    setBusy(true); setError('');
    try {
      await loginGuest(name.trim());
      onLoggedIn();
    } catch (e: any) {
      setError(e.message || 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={st.wrap}>
      <Text style={st.logo}>🛰️</Text>
      <Text style={st.title}>AR Ops</Text>
      <Text style={st.sub}>Hide & Seek im echten Gelände</Text>
      <TextInput
        style={st.input}
        placeholder="Dein Name"
        placeholderTextColor="#807050"
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        maxLength={24}
      />
      {!!error && <Text style={st.err}>{error}</Text>}
      <TouchableOpacity style={st.btn} onPress={go} disabled={busy}>
        {busy ? <ActivityIndicator color="#80ff40" /> : <Text style={st.btnTxt}>▶ Los geht's</Text>}
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 64, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: '900', color: '#f0c840' },
  sub: { fontSize: 13, color: '#807050', marginBottom: 32 },
  input: {
    width: '100%', maxWidth: 320, backgroundColor: '#141020', borderWidth: 1, borderColor: '#2a2040',
    borderRadius: 10, padding: 14, color: '#e0c080', fontSize: 16, marginBottom: 12,
  },
  err: { color: '#ff6040', marginBottom: 8, fontSize: 12 },
  btn: {
    width: '100%', maxWidth: 320, backgroundColor: 'rgba(60,160,20,.3)', borderWidth: 2, borderColor: '#3a8020',
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  btnTxt: { color: '#80ff40', fontSize: 16, fontWeight: '800' },
});
