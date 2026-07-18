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

/** Triggers the physical IR pulse. */
export async function fireEsp(): Promise<boolean> {
  return NativeEspBridge.fire();
}

export function addEspStatusListener(listener: (event: EspStatusEvent) => void): EventSubscription {
  return NativeEspBridge.addListener('onStatus', listener);
}
