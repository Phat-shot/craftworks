// Reusable camera layer for the AR view modes.
// Handles permission; renders the back camera filling its container.
// No photo is ever captured or transmitted.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function CameraLayer({ children }: { children?: React.ReactNode }) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) return <View style={st.fill} />;
  if (!permission.granted) {
    return (
      <View style={[st.fill, st.center]}>
        <Text style={st.msg}>Kamera-Zugriff für AR-Ansicht benötigt</Text>
        <TouchableOpacity style={st.btn} onPress={requestPermission}>
          <Text style={st.btnTxt}>Erlauben</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={st.fill}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  msg: { color: '#e0c080', fontSize: 14, marginBottom: 12, textAlign: 'center', padding: 12 },
  btn: { backgroundColor: 'rgba(60,160,20,.3)', borderWidth: 2, borderColor: '#3a8020', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  btnTxt: { color: '#80ff40', fontWeight: '800' },
});
