// QR scanner for pairing the Wear OS companion app — the watch (see
// apps/arops-wear/) shows a QR code, this scans it and confirms the pairing
// over the Data Layer API (modules/wear-bridge). No new camera permission
// beyond what the app already requests for shooting.
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Icon from './Icon';

export default function WatchPairModal({
  visible, onClose, onClaim,
}: {
  visible: boolean;
  onClose: () => void;
  onClaim: (token: string) => Promise<boolean>;
}) {
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
          <Icon name="compass" size={16} color="#f0c840" />
          <Text style={st.title}>Uhr koppeln</Text>
          <TouchableOpacity onPress={onClose} style={st.closeBtn}>
            <Icon name="close" size={18} color="#c0a0f0" />
          </TouchableOpacity>
        </View>
        <Text style={st.hint}>QR-Code auf der Uhr scannen</Text>

        {!permission ? (
          <View style={st.center}><ActivityIndicator color="#f0c840" /></View>
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
                <ActivityIndicator color="#f0c840" size="large" />
              </View>
            )}
          </View>
        )}

        {err && (
          <View style={st.errRow}>
            <Icon name="warning" size={13} color="#ff6040" />
            <Text style={st.errTxt}>Kopplung fehlgeschlagen — keine Uhr verbunden?</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810', paddingTop: 52, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { color: '#f0c840', fontSize: 18, fontWeight: '900', flex: 1 },
  closeBtn: { padding: 6 },
  hint: { color: '#807050', fontSize: 12, marginBottom: 12 },
  camWrap: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  btn: { backgroundColor: 'rgba(60,160,20,.3)', borderWidth: 2, borderColor: '#3a8020', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  btnTxt: { color: '#80ff40', fontWeight: '800' },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  errTxt: { color: '#ff6040', fontSize: 12 },
});
