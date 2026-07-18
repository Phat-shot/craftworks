"use strict";
// ═══════════════════════════════════════════════════════════
//  AR OPS — shared types
//  These types are the contract between app and server.
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PLAUSIBILITY = exports.DEFAULT_POLYGON_OPTIONS = exports.DEFAULT_HIT_CONFIG = void 0;
exports.DEFAULT_HIT_CONFIG = {
    maxRangeM: 75,
    // 5s: 1 Hz telemetry + network latency + Android background throttling
    maxTimeSkewMs: 5000,
    // 15°: covers typical phone compass noise (±10-15° urban) on top of GPS widening
    baseConeHalfAngleDeg: 15,
    maxToleranceDeg: 45,
    // 0.25: the cone IS the test — confidence only rejects stale+edge combinations,
    // no longer double-penalizes clean shots at the cone boundary
    minConfidence: 0.25,
};
exports.DEFAULT_POLYGON_OPTIONS = {
    minPoints: 3,
    minAreaM2: 2000, // ~45×45 m — smallest sensible playfield
    maxAreaM2: Infinity, // no upper limit — scaleCoreConfig()/scaleTimings() adapt to any field size
};
exports.DEFAULT_PLAUSIBILITY = {
    maxSpeedMps: 12,
    minGapMs: 1500,
};
