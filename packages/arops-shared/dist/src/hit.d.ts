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
/**
 * Sniper-class hit test: a fixed LATERAL tolerance (meters, perpendicular
 * distance from the shooter's aim ray) instead of an angular cone that
 * widens with distance — a hitscan/laser shape. `lateralToleranceM` is the
 * caller's job to pick (the already field-size-scaled `hitHalfWidthM` from
 * `scaleCoreConfig`, see packages/arops-shared/src/timings.ts, is the right
 * source value — don't invent a new scaled constant for this).
 *
 * Same HitVerdict shape as validateHit so callers can treat the two
 * interchangeably; `angleDeltaDeg`/`toleranceDeg` are repurposed here to
 * carry the lateral offset/tolerance in meters, not degrees (documented via
 * `reason: 'outside_lateral'` so callers can tell the two models apart).
 */
export declare function validateHitLateral(attempt: HitAttempt, cfg: HitConfig | undefined, lateralToleranceM: number): HitVerdict;
/**
 * Bomber-class hit test: omnidirectional — any bearing within range counts,
 * no aiming at all. Deliberately does NOT check `shooter.headingDeg` (unlike
 * validateHit/validateHitLateral): a class built entirely around "no aiming
 * needed" shouldn't reject a shot just because the compass is unavailable.
 */
export declare function validateHitOmni(attempt: HitAttempt, cfg?: HitConfig): HitVerdict;
