import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { loginGuest, loginAccount, registerAccount } from '../api';
import Icon from '../components/Icon';
import { useTheme, ThemeTokens } from '../theme';

type Mode = 'guest' | 'login' | 'register';

export default function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const [mode, setMode] = useState<Mode>('guest');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState(false);

  const goGuest = async () => {
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

  const goLogin = async () => {
    if (!email.trim() || !password) return setError('E-Mail und Passwort eingeben');
    setBusy(true); setError('');
    try {
      await loginAccount(email.trim(), password);
      onLoggedIn();
    } catch (e: any) {
      setError(e.message === 'invalid_credentials' ? 'E-Mail oder Passwort falsch' : (e.message || 'Fehler'));
    } finally {
      setBusy(false);
    }
  };

  const goRegister = async () => {
    if (!email.trim() || username.trim().length < 3 || password.length < 8) {
      return setError('E-Mail, Nutzername (min. 3 Zeichen) und Passwort (min. 8 Zeichen) eingeben');
    }
    setBusy(true); setError('');
    try {
      // Auto-verified regardless of email delivery (see api.ts comment) —
      // always safe to go straight to the login form next.
      await registerAccount(email.trim(), username.trim(), password);
      setRegistered(true);
      setMode('login');
      setPassword('');
    } catch (e: any) {
      const msgs: Record<string, string> = {
        email_taken: 'E-Mail bereits registriert',
        username_taken: 'Nutzername bereits vergeben',
      };
      setError(msgs[e.message] || e.message || 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={st.wrap}>
      <Icon name="satellite" size={64} color={theme.accent} style={{ marginBottom: 8 }} />
      <Text style={st.title}>AR Ops</Text>
      <Text style={st.sub}>Hide & Seek im echten Gelände</Text>

      <View style={st.tabRow}>
        <TouchableOpacity style={[st.tab, mode === 'guest' && st.tabActive]}
          onPress={() => { setMode('guest'); setError(''); setRegistered(false); }}>
          <Text style={[st.tabTxt, mode === 'guest' && st.tabTxtActive]}>Gast</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.tab, mode === 'login' && st.tabActive]}
          onPress={() => { setMode('login'); setError(''); }}>
          <Text style={[st.tabTxt, mode === 'login' && st.tabTxtActive]}>Anmelden</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.tab, mode === 'register' && st.tabActive]}
          onPress={() => { setMode('register'); setError(''); setRegistered(false); }}>
          <Text style={[st.tabTxt, mode === 'register' && st.tabTxtActive]}>Registrieren</Text>
        </TouchableOpacity>
      </View>

      {mode === 'guest' && (
        <TextInput
          style={st.input}
          placeholder="Dein Name"
          placeholderTextColor={theme.text3}
          value={name}
          onChangeText={setName}
          autoCapitalize="none"
          maxLength={24}
        />
      )}

      {(mode === 'login' || mode === 'register') && (<>
        <TextInput
          style={st.input}
          placeholder="E-Mail"
          placeholderTextColor={theme.text3}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {mode === 'register' && (
          <TextInput
            style={st.input}
            placeholder="Nutzername (3-32, a-z 0-9 _ -)"
            placeholderTextColor={theme.text3}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            maxLength={32}
          />
        )}
        <TextInput
          style={st.input}
          placeholder={mode === 'register' ? 'Passwort (min. 8 Zeichen)' : 'Passwort'}
          placeholderTextColor={theme.text3}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
      </>)}

      {registered && mode === 'login' && (
        <Text style={st.hint}>Registrierung erfolgreich — du kannst dich jetzt anmelden.</Text>
      )}
      {!!error && <Text style={st.err}>{error}</Text>}

      <TouchableOpacity
        style={st.btn}
        onPress={mode === 'guest' ? goGuest : mode === 'login' ? goLogin : goRegister}
        disabled={busy}>
        {busy ? <ActivityIndicator color="#80ff40" /> : (
          <View style={st.btnRow}>
            <Icon name={mode === 'guest' ? 'play' : mode === 'login' ? 'link' : 'rocket'} size={16} color="#80ff40" />
            <Text style={st.btnTxt}>
              {mode === 'guest' ? "Los geht's" : mode === 'login' ? 'Anmelden' : 'Registrieren'}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 32, fontWeight: '900', color: theme.accent },
    btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sub: { fontSize: 13, color: theme.text3, marginBottom: 20 },
    tabRow: { flexDirection: 'row', width: '100%', maxWidth: 320, marginBottom: 16, gap: 6 },
    tab: {
      flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8,
      paddingVertical: 8, alignItems: 'center', backgroundColor: theme.bg2,
    },
    tabActive: { borderColor: theme.borderStrong, backgroundColor: theme.bg3 },
    tabTxt: { color: theme.text3, fontSize: 12, fontWeight: '700' },
    tabTxtActive: { color: theme.accent },
    input: {
      width: '100%', maxWidth: 320, backgroundColor: theme.bg2, borderWidth: 1, borderColor: theme.border,
      borderRadius: 10, padding: 14, color: theme.text, fontSize: 16, marginBottom: 12,
    },
    hint: { color: theme.success, marginBottom: 8, fontSize: 12 },
    err: { color: theme.danger, marginBottom: 8, fontSize: 12 },
    // Primary CTA keeps its literal green brand accent across every theme,
    // same as the start menu's "Spiel hosten" button — see App.tsx.
    btn: {
      width: '100%', maxWidth: 320, backgroundColor: 'rgba(60,160,20,.3)', borderWidth: 2, borderColor: '#3a8020',
      borderRadius: 10, padding: 14, alignItems: 'center',
    },
    btnTxt: { color: '#80ff40', fontSize: 16, fontWeight: '800' },
  });
}
