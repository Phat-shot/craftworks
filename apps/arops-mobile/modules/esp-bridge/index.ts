import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

// As of Expo SDK 52, the object requireNativeModule() returns already IS an
// EventEmitter (native modules implement it directly) — no separate
// `new EventEmitter(...)` wrapper needed/wanted, that constructor overload
// is deprecated precisely because of this.
const NativeEspBridge = requireNativeModule('EspBridge');

export interface EspStatusEvent {
  connected: boolean;
  /** Raw line received from the ESP32 (e.g. a heartbeat), if this event was
   *  triggered by incoming serial data rather than a connect/disconnect. */
  line?: string;
}

/** Request USB permission (shows the system dialog if not already granted)
 *  and open the serial link to the ESP32. Resolves false if no Espressif
 *  USB device is currently plugged in, or the user denies permission. */
export async function connectEsp(): Promise<boolean> {
  return NativeEspBridge.connect();
}

export async function disconnectEsp(): Promise<void> {
  return NativeEspBridge.disconnect();
}

/** Bench-test only — asks a USB-connected board to report a heartbeat over
 *  serial. Not part of the gameplay path (the beacon runs standalone off
 *  any USB power once flashed, no data connection needed while worn). */
export async function pingEsp(): Promise<boolean> {
  return NativeEspBridge.ping();
}

export function addEspStatusListener(listener: (event: EspStatusEvent) => void): EventSubscription {
  return NativeEspBridge.addListener('onStatus', listener);
}
