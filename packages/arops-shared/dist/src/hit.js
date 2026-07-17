"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickTargetSample = pickTargetSample;
exports.hitToleranceDeg = hitToleranceDeg;
exports.validateHit = validateHit;
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
const geo_1 = require("./geo");
const types_1 = require("./types");
/**
 * Pick the target sample matching a trigger timestamp.
 * If two buffered samples bracket the timestamp, linearly interpolate
 * position/accuracy between them — at 1 Hz sampling a walking target moves
 * ~1.5 m between samples, so this measurably tightens validation.
 * Falls back to the nearest sample in time.
 */
function pickTargetSample(samples, ts) {
    if (!samples.length)
        return null;
    let before = null;
    let after = null;
    let nearest = samples[0];
    for (const s of samples) {
        if (Math.abs(s.ts - ts) < Math.abs(nearest.ts - ts))
            nearest = s;
        if (s.ts <= ts && (!before || s.ts > before.ts))
            before = s;
        if (s.ts >= ts && (!after || s.ts < after.ts))
            after = s;
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
function hitToleranceDeg(distanceM, accuracySumM, cfg = types_1.DEFAULT_HIT_CONFIG) {
    if (distanceM <= 0)
        return cfg.maxToleranceDeg;
    const gpsAngle = Math.atan2(accuracySumM, distanceM) * RAD2DEG;
    return Math.min(cfg.maxToleranceDeg, cfg.baseConeHalfAngleDeg + gpsAngle);
}
/** Validate a hit attempt. Deterministic; identical results on app and server. */
function validateHit(attempt, cfg = types_1.DEFAULT_HIT_CONFIG) {
    const { shooter, target } = attempt;
    const distanceM = (0, geo_1.haversineMeters)(shooter, target);
    const timeSkewMs = Math.abs(shooter.ts - target.ts);
    const fail = (reason) => ({
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
    const targetBearing = (0, geo_1.bearingDeg)(shooter, target);
    const delta = (0, geo_1.angleDeltaDeg)(shooter.headingDeg, targetBearing);
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
    const confidence = 0.6 * angularScore + 0.25 * freshScore + 0.15 * gpsScore;
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
