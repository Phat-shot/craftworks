import { requireOptionalNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

// Android-only (see expo-module.config.json). Unlike wear-bridge/esp-bridge
// (requireNativeModule, which THROWS if the module isn't linked — fine
// there since both are only ever touched from opt-in, Android-gated call
// sites), this one is imported from LobbyScreen.tsx and useTelemetry.ts —
// core files loaded on every platform. requireOptionalNativeModule resolves
// to null on iOS instead of crashing the app at import time; every export
// below no-ops/returns null in that case, same observable behavior as if
// Platform.OS-gated callers just never called them.
const NativeLocation = requireOptionalNativeModule('NativeLocation');

export interface NativeLocationFix {
  lat: number;
  lon: number;
  accuracyM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  /** Epoch ms, as reported by the OS (android.location.Location#getTime). */
  timestamp: number;
}

/** Whether the native module is actually available — false on iOS (no
 *  native implementation there, see NativeLocationModule.kt's doc-comment)
 *  or if it somehow failed to link. Callers should still gate on
 *  Platform.OS === 'android' themselves (clearer at the call site than an
 *  implicit availability check), this is the defensive backstop. */
export const hasNativeLocation = NativeLocation !== null;

/** One-shot fix via FusedLocationProviderClient.getCurrentLocation(), with
 *  a 12s native-side timeout — resolves null on timeout/failure/missing
 *  permission rather than ever hanging (see NativeLocationModule.kt). */
export async function getCurrentLocation(): Promise<NativeLocationFix | null> {
  if (!NativeLocation) return null;
  return NativeLocation.getCurrentLocation();
}

/** Starts a continuous FusedLocationProviderClient watch (~1s interval) —
 *  fixes arrive via addNativeLocationListener, not as a return value.
 *  Safe to call again while already watching (restarts the subscription). */
export async function startWatch(): Promise<void> {
  if (!NativeLocation) return;
  return NativeLocation.startWatch();
}

export async function stopWatch(): Promise<void> {
  if (!NativeLocation) return;
  return NativeLocation.stopWatch();
}

export function addNativeLocationListener(listener: (fix: NativeLocationFix) => void): EventSubscription | null {
  if (!NativeLocation) return null;
  return NativeLocation.addListener('onLocation', listener);
}
