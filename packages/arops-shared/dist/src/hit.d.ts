import { HitAttempt, HitVerdict, HitConfig, TelemetrySample } from './types';
/**
 * Pick the target sample matching a trigger timestamp.
 * If two buffered samples bracket the timestamp, linearly interpolate
 * position/accuracy between them — at 1 Hz sampling a walking target moves
 * ~1.5 m between samples, so this measurably tightens validation.
 * Falls back to the nearest sample in time.
 */
export declare function pickTargetSample(samples: readonly TelemetrySample[], ts: number): TelemetrySample | null;
/**
 * Angular tolerance (half-angle of the accepted cone) for a given
 * distance and combined GPS accuracy.
 *
 *   tolerance = baseCone + atan(accSum / distance)
 *
 * capped at cfg.maxToleranceDeg.
 */
export declare function hitToleranceDeg(distanceM: number, accuracySumM: number, cfg?: HitConfig): number;
/** Validate a hit attempt. Deterministic; identical results on app and server. */
export declare function validateHit(attempt: HitAttempt, cfg?: HitConfig): HitVerdict;
