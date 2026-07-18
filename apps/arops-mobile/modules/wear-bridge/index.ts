import { requireNativeModule } from 'expo-modules-core';

const NativeWearBridge = requireNativeModule('WearBridge');

/**
 * Sends a JSON payload to the paired Wear OS watch over the Data Layer API's
 * MessageClient. Resolves false (no-op) if no watch is currently connected —
 * this is the phone-side half of the AR Ops watch companion; the receiving
 * half lives in apps/arops-wear/.../GameStateListenerService.kt.
 *
 * No pairing/discovery step needed here: any watch already Bluetooth-paired
 * with this phone and running the watch app is automatically a "connected
 * node" — the QR-code flow (see useWatchPairing) is only for telling THAT
 * watch which match to show, not for finding it.
 */
export async function sendToWatch(path: string, payload: unknown): Promise<boolean> {
  return NativeWearBridge.sendMessage(path, JSON.stringify(payload));
}
