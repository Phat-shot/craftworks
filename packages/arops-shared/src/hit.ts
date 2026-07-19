// ═══════════════════════════════════════════════════════════
//  AR OPS — hit validation
//
//  A "hit" = shooter pressed the camera trigger while aiming
//  at the target. We validate purely geometrically:
//
//    1. Shooter must have a compass heading.
//    2. Both telemetry samples must be close in time.
//    3. Target must be within max range.
//    4. Bearing(shooter→target) must lie inside the aiming
//       cone. The cone WIDENS with combined GPS inaccuracy
//       relative to distance: at close range a 10 m GPS error
//       makes direction almost meaningless, so tolerance grows;
//       far away the same error is a small angle.
//    5. A combined confidence score (angular centrality,
//       time freshness, GPS quality) must clear a threshold.
//
//  The same code runs on the app (instant local feedback)
//  and on the server (authoritative verdict).
// ═══════════════════════════════════════════════════════════
import { haversineMeters, bearingDeg, angleDeltaDeg } from './geo';
import {
  HitAttempt, HitVerdict, HitConfig, DEFAULT_HIT_CONFIG, TelemetrySample,
} from './types';

/**
 * Pick the target sample matching a trigger timestamp.
 * If two buffered samples bracket the timestamp, linearly interpolate
 * position/accuracy between them — at 1 Hz sampling a walking target moves
 * ~1.5 m between samples, so this measurably tightens validation.
 * Falls back to the nearest sample in time.
 */
export function pickTargetSample(
  samples: readonly TelemetrySample[],
  ts: number
): TelemetrySample | null {
  if (!samples.length) return null;
  let before: TelemetrySample | null = null;
  let after: TelemetrySample | null = null;
  let nearest: TelemetrySample = samples[0]!;
  for (const s of samples) {
    if (Math.abs(s.ts - ts) < Math.abs(nearest.ts - ts)) nearest = s;
    if (s.ts <= ts && (!before || s.ts > before.ts)) before = s;
    if (s.ts >= ts && (!after || s.ts < after.ts)) after = s;
  }
  if (before && after && after.ts > before.ts) {
    const f = (ts - before.ts) / (after.ts - before.ts);
    return {
      lat: before.lat + (after.lat - before.lat) * f,
      lon: before.lon + (after.lon - before.lon) * f,
      ts,
      accuracyM: Math.max(before.accuracyM, after.accuracyM),
      headingDeg: null,
      speedMps: null,
    };
  }
  return nearest;
}

const RAD2DEG = 180 / Math.PI;

/**
 * Angular tolerance (half-angle of the accepted cone) for a given
 * distance and combined GPS accuracy.
 *
 *   tolerance = baseCone + atan(accSum / distance)
 *
 * capped at cfg.maxToleranceDeg.
 */
export function hitToleranceDeg(
  distanceM: number,
  accuracySumM: number,
  cfg: HitConfig = DEFAULT_HIT_CONFIG
): number {
  if (distanceM <= 0) return cfg.maxToleranceDeg;
  const gpsAngle = Math.atan2(accuracySumM, distanceM) * RAD2DEG;
  return Math.min(cfg.maxToleranceDeg, cfg.baseConeHalfAngleDeg + gpsAngle);
}

/** Validate a hit attempt. Deterministic; identical results on app and server. */
export function validateHit(
  attempt: HitAttempt,
  cfg: HitConfig = DEFAULT_HIT_CONFIG
): HitVerdict {
  const { shooter, target } = attempt;
  const distanceM = haversineMeters(shooter, target);
  const timeSkewMs = Math.abs(shooter.ts - target.ts);

  const fail = (reason: HitVerdict['reason']): HitVerdict => ({
    hit: false, reason, confidence: 0,
    distanceM, angleDeltaDeg: null, toleranceDeg: null, timeSkewMs,
  });

  // 1. Heading present?
  if (shooter.headingDeg === null || shooter.headingDeg === undefined || Number.isNaN(shooter.headingDeg)) {
    return fail('no_heading');
  }

  // 2. Time sync
  if (timeSkewMs > cfg.maxTimeSkewMs) {
    return fail('time_skew');
  }

  // 3. Range
  if (distanceM > cfg.maxRangeM) {
    return fail('out_of_range');
  }

  // 4. Aiming cone
  const targetBearing = bearingDeg(shooter, target);
  const delta = angleDeltaDeg(shooter.headingDeg, targetBearing);
  const accSum = Math.max(0, shooter.accuracyM) + Math.max(0, target.accuracyM);
  const tolerance = hitToleranceDeg(distanceM, accSum, cfg);

  if (delta > tolerance) {
    return {
      hit: false, reason: 'outside_cone', confidence: 0,
      distanceM, angleDeltaDeg: delta, toleranceDeg: tolerance, timeSkewMs,
    };
  }

  // 5. Confidence score
  //    - angular:   1 at dead-center, 0 at the cone edge  (weight .6)
  //    - freshness: 1 at 0ms skew, 0 at maxTimeSkewMs     (weight .25)
  //    - gps:       1 at 0m combined error, 0 at ≥30m     (weight .15)
  const angularScore = 1 - delta / tolerance;
  const freshScore = 1 - timeSkewMs / cfg.maxTimeSkewMs;
  const gpsScore = Math.max(0, 1 - accSum / 30);
  const confidence =
    0.6 * angularScore + 0.25 * freshScore + 0.15 * gpsScore;

  if (confidence < cfg.minConfidence) {
    return {
      hit: false, reason: 'low_confidence', confidence,
      distanceM, angleDeltaDeg: delta, toleranceDeg: tolerance, timeSkewMs,
    };
  }

  return {
    hit: true, reason: null, confidence,
    distanceM, angleDeltaDeg: delta, toleranceDeg: tolerance, timeSkewMs,
  };
}

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
export function validateHitLateral(
  attempt: HitAttempt,
  cfg: HitConfig = DEFAULT_HIT_CONFIG,
  lateralToleranceM: number
): HitVerdict {
  const { shooter, target } = attempt;
  const distanceM = haversineMeters(shooter, target);
  const timeSkewMs = Math.abs(shooter.ts - target.ts);

  const fail = (reason: HitVerdict['reason']): HitVerdict => ({
    hit: false, reason, confidence: 0,
    distanceM, angleDeltaDeg: null, toleranceDeg: null, timeSkewMs,
  });

  if (shooter.headingDeg === null || shooter.headingDeg === undefined || Number.isNaN(shooter.headingDeg)) {
    return fail('no_heading');
  }
  if (timeSkewMs > cfg.maxTimeSkewMs) {
    return fail('time_skew');
  }
  if (distanceM > cfg.maxRangeM) {
    return fail('out_of_range');
  }

  const targetBearing = bearingDeg(shooter, target);
  const delta = angleDeltaDeg(shooter.headingDeg, targetBearing);
  const lateralM = distanceM * Math.sin(delta / RAD2DEG);

  if (lateralM > lateralToleranceM) {
    return {
      hit: false, reason: 'outside_lateral', confidence: 0,
      distanceM, angleDeltaDeg: lateralM, toleranceDeg: lateralToleranceM, timeSkewMs,
    };
  }

  const accSum = Math.max(0, shooter.accuracyM) + Math.max(0, target.accuracyM);
  const lateralScore = 1 - lateralM / lateralToleranceM;
  const freshScore = 1 - timeSkewMs / cfg.maxTimeSkewMs;
  const gpsScore = Math.max(0, 1 - accSum / 30);
  const confidence = 0.6 * lateralScore + 0.25 * freshScore + 0.15 * gpsScore;

  if (confidence < cfg.minConfidence) {
    return {
      hit: false, reason: 'low_confidence', confidence,
      distanceM, angleDeltaDeg: lateralM, toleranceDeg: lateralToleranceM, timeSkewMs,
    };
  }

  return {
    hit: true, reason: null, confidence,
    distanceM, angleDeltaDeg: lateralM, toleranceDeg: lateralToleranceM, timeSkewMs,
  };
}

/**
 * Bomber-class hit test: omnidirectional — any bearing within range counts,
 * no aiming at all. Deliberately does NOT check `shooter.headingDeg` (unlike
 * validateHit/validateHitLateral): a class built entirely around "no aiming
 * needed" shouldn't reject a shot just because the compass is unavailable.
 */
export function validateHitOmni(
  attempt: HitAttempt,
  cfg: HitConfig = DEFAULT_HIT_CONFIG
): HitVerdict {
  const { shooter, target } = attempt;
  const distanceM = haversineMeters(shooter, target);
  const timeSkewMs = Math.abs(shooter.ts - target.ts);

  const fail = (reason: HitVerdict['reason']): HitVerdict => ({
    hit: false, reason, confidence: 0,
    distanceM, angleDeltaDeg: null, toleranceDeg: null, timeSkewMs,
  });

  if (timeSkewMs > cfg.maxTimeSkewMs) {
    return fail('time_skew');
  }
  if (distanceM > cfg.maxRangeM) {
    return fail('out_of_range');
  }

  const accSum = Math.max(0, shooter.accuracyM) + Math.max(0, target.accuracyM);
  const freshScore = 1 - timeSkewMs / cfg.maxTimeSkewMs;
  const gpsScore = Math.max(0, 1 - accSum / 30);
  const confidence = 0.6 * freshScore + 0.4 * gpsScore;

  if (confidence < cfg.minConfidence) {
    return {
      hit: false, reason: 'low_confidence', confidence,
      distanceM, angleDeltaDeg: null, toleranceDeg: null, timeSkewMs,
    };
  }

  return {
    hit: true, reason: null, confidence,
    distanceM, angleDeltaDeg: null, toleranceDeg: null, timeSkewMs,
  };
}
