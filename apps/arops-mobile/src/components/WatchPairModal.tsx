// QR scanner for pairing the Wear OS companion app — the watch (see
// apps/arops-wear/) shows a QR code, this scans it and confirms the pairing
// over the Data Layer API (modules/wear-bridge). No new camera permission
// beyond what the app already requests for shooting.
import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Icon from './Icon';
import { useTheme, ThemeTokens } from '../theme';

export default function WatchPairModal({
  visible, onClose, onClaim,
}: {
  visible: boolean;
  onClose: () => void;
  onClaim: (token: string) => Promise<boolean>;
}) {
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [scannedOnce, setScannedOnce] = useState(false);

  const handleScan = async (data: string) => {
    if (scannedOnce || busy) return;
    setScannedOnce(true);
    setBusy(true);
    setErr(false);
    const ok = await onClaim(data);
    setBusy(false);
    if (ok) onClose();
    else { setErr(true); setScannedOnce(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={st.wrap}>
        <View style={st.header}>
          <Icon name="compass" size={16} color={theme.accent} />
          <Text style={st.title}>Uhr koppeln</Text>
          <TouchableOpacity onPress={onClose} style={st.closeBtn}>
            <Icon name="close" size={18} color={theme.text2} />
          </TouchableOpacity>
        </View>
        <Text style={st.hint}>QR-Code auf der Uhr scannen</Text>

        {!permission ? (
          <View style={st.center}><ActivityIndicator color={theme.accent} /></View>
        ) : !permission.granted ? (
          <View style={st.center}>
            <Text style={st.hint}>Kamera-Zugriff zum Scannen nötig</Text>
            <TouchableOpacity style={st.btn} onPress={requestPermission}>
              <Text style={st.btnTxt}>Erlauben</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={st.camWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(result) => handleScan(result.data)}
            />
            {busy && (
              <View style={[StyleSheet.absoluteFill, st.center]}>
                <ActivityIndicator color={theme.accent} size="large" />
              </View>
            )}
          </View>
        )}

        {err && (
          <View style={st.errRow}>
            <Icon name="warning" size={13} color={theme.danger} />
            <Text style={st.errTxt}>Kopplung fehlgeschlagen — keine Uhr verbunden?</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: theme.bg, paddingTop: 52, padding: 16 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    title: { color: theme.accent, fontSize: 18, fontWeight: '900', flex: 1 },
    closeBtn: { padding: 6 },
    hint: { color: theme.text3, fontSize: 12, marginBottom: 12 },
    camWrap: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    // Confirm/accept action keeps its literal green brand accent, same
    // convention as every other primary CTA across the app.
    btn: { backgroundColor: 'rgba(60,160,20,.25)', borderWidth: 2, borderColor: 'rgba(58,128,32,.5)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
    btnTxt: { color: '#80ff40', fontWeight: '800' },
    errRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
    errTxt: { color: theme.danger, fontSize: 12 },
  });
}
