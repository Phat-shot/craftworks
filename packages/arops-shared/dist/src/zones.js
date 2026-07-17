"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERENCE_DIAGONAL_M = void 0;
exports.isInZone = isInZone;
exports.distanceToZoneM = distanceToZoneM;
exports.fieldMetrics = fieldMetrics;
exports.timingScale = timingScale;
exports.scaledMs = scaledMs;
exports.validateZones = validateZones;
// ═══════════════════════════════════════════════════════════
//  AR OPS — zones + field-size timing scale
//
//  Zones are circles (center + radius) used by every team mode:
//  Domination points, CTF bases, S&D bomb sites. Capture/plant/
//  defuse all reduce to "dwell": standing inside continuously.
//
//  All gameplay timings scale with the field diagonal — a bigger
//  field means longer walks, so freezes/timers grow proportionally
//  ("eher länger als zu kurz": factor is floored at 1, capped at 3).
// ═══════════════════════════════════════════════════════════
const geo_1 = require("./geo");
function isInZone(point, zone) {
    return (0, geo_1.haversineMeters)(point, { lat: zone.lat, lon: zone.lon }) <= zone.radiusM;
}
/** Negative = inside (meters past the rim), positive = outside. */
function distanceToZoneM(point, zone) {
    return (0, geo_1.haversineMeters)(point, { lat: zone.lat, lon: zone.lon }) - zone.radiusM;
}
function fieldMetrics(polygon) {
    let diagonalM = 0;
    for (let i = 0; i < polygon.length; i++) {
        for (let j = i + 1; j < polygon.length; j++) {
            diagonalM = Math.max(diagonalM, (0, geo_1.haversineMeters)(polygon[i], polygon[j]));
        }
    }
    return { diagonalM };
}
/** Reference field: 300 m diagonal (≈ city park). */
exports.REFERENCE_DIAGONAL_M = 300;
/**
 * Timing scale factor for a field. Never shrinks timings below the
 * reference values (floor 1), caps at 3x for huge fields.
 */
function timingScale(diagonalM) {
    return Math.min(3, Math.max(1, diagonalM / exports.REFERENCE_DIAGONAL_M));
}
/** Scale a base duration, rounded UP to whole seconds ("eher länger"). */
function scaledMs(baseMs, scale) {
    return Math.ceil((baseMs * scale) / 1000) * 1000;
}
/**
 * Validate host-placed zones: all inside the field, pairwise separation
 * of at least 3x radius (so zones do not overlap into trivial multi-caps).
 */
function validateZones(zones, polygon, maxZones = 8) {
    const errors = [];
    if (zones.length > maxZones)
        errors.push('too_many_zones');
    for (const z of zones) {
        if (!(0, geo_1.pointInPolygon)({ lat: z.lat, lon: z.lon }, polygon)) {
            errors.push('outside_field');
            break;
        }
    }
    outer: for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
            const minSep = (zones[i].radiusM + zones[j].radiusM) * 1.5;
            if ((0, geo_1.haversineMeters)(zones[i], zones[j]) < minSep) {
                errors.push('zones_too_close');
                break outer;
            }
        }
    }
    return { ok: errors.length === 0, errors };
}
