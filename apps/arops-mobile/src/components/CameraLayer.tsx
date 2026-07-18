// Reusable camera layer for the AR view modes.
// Handles permission; renders the back camera filling its container.
// No photo is ever captured or transmitted. Uses react-native-vision-camera
// (not expo-camera) specifically so a frame processor (IR-beacon scanning,
// see src/hooks/useIrScan.ts) can be attached — expo-camera has no
// equivalent real-time frame-analysis hook. The QR-scanning screens
// (JoinLobbyScreen, WatchPairModal) stay on expo-camera on purpose: they
// never need frame processors, and never run at the same time as this
// layer, so there's no real conflict running both libraries in the app.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, type ReadonlyFrameProcessor } from 'react-native-vision-camera';

export default function CameraLayer({ children, frameProcessor }: {
  children?: React.ReactNode;
  frameProcessor?: ReadonlyFrameProcessor;
}) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  if (!hasPermission) {
    return (
      <View style={[st.fill, st.center]}>
        <Text style={st.msg}>Kamera-Zugriff für AR-Ansicht benötigt</Text>
        <TouchableOpacity style={st.btn} onPress={requestPermission}>
          <Text style={st.btnTxt}>Erlauben</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!device) return <View style={st.fill} />;
  return (
    <View style={st.fill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        pixelFormat="yuv"
        frameProcessor={frameProcessor}
      />
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
