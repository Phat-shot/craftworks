// Wraps the native "scanIrBeacon" VisionCamera frame-processor plugin (see
// modules/ir-scan-plugin, registered natively at app startup) into a plain
// React hook: a memoized frame processor to hand to <Camera>, plus the most
// recently decoded beacon as regular JS state GameScreen can read.
import { useState } from 'react';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

export interface IrScanResult {
  deviceId: number;
  ts: number;
}

// Looked up once per JS bundle load — the native plugin is registered
// during Expo's module init, which always runs before the JS bundle does,
// so this should never race the registration.
const plugin = VisionCameraProxy.initFrameProcessorPlugin('scanIrBeacon', {});

export function useIrScan() {
  const [lastScan, setLastScan] = useState<IrScanResult | null>(null);

  const updateScan = useRunOnJS((deviceId: number, ts: number) => {
    setLastScan({ deviceId, ts });
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (plugin == null) return;
    const result = plugin.call(frame);
    if (result != null && typeof result === 'object' && 'deviceId' in result) {
      // @ts-ignore — result is a plain worklet-side value, not typed
      updateScan(result.deviceId, result.ts);
    }
  }, [updateScan]);

  return { frameProcessor, lastScan };
}
