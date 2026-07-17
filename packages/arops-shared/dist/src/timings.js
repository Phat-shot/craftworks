"use strict";
// ═══════════════════════════════════════════════════════════
//  Field-size-scaled timings.
//  L = sqrt(areaM2) is the characteristic field length in meters.
//  Reference: walking speed ~1.4 m/s. Per user requirement all
//  values err LONGER rather than shorter and are clamped to
//  sane bounds. Every value can be overridden via ar_settings.
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateZones = exports.distanceToZoneM = exports.isInZone = exports.scaleDroneRangeM = exports.scaleTimings = void 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Compute all mode timings from the playfield area. */
function scaleTimings(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2)); // characteristic length in m
    return {
        zoneRadiusM: clamp(L / 25, 12, 45),
        freezeMs: clamp(((L / 2) / 1.4) * 1000, 30000, 120000),
        freezeMoveToleranceM: 15, // fixed: below GPS drift would punish standing still
        freezeExtensionMs: clamp((((L / 2) / 1.4) * 1000) * 0.25, 10000, 30000),
        baseSettingMs: clamp((L / 1.4) * 1000, 90000, 300000),
        flagPickupDwellMs: clamp((L / 50) * 1000, 4000, 15000),
        flagReturnMs: clamp(L * 200, 30000, 90000),
        minBaseSeparationM: clamp(L * 0.5, 60, 600),
        captureDwellMs: clamp((L / 40) * 1000, 5000, 20000),
        plantDwellMs: clamp((L / 30) * 1000, 8000, 20000),
        defuseDwellMs: clamp((L / 40) * 1000, 6000, 15000),
        bombTimerMs: clamp(((L / 1.4) + 30) * 1200, 90000, 300000),
    };
}
exports.scaleTimings = scaleTimings;
/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
function scaleDroneRangeM(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2));
    return clamp(L * 0.4, 50, 200);
}
exports.scaleDroneRangeM = scaleDroneRangeM;
const geo_1 = require("./geo");
function isInZone(p, z) {
    return (0, geo_1.haversineMeters)(p, { lat: z.lat, lon: z.lon }) <= z.radiusM;
}
exports.isInZone = isInZone;
/** Negative = inside (meters past the rim), positive = outside. */
function distanceToZoneM(p, z) {
    return (0, geo_1.haversineMeters)(p, { lat: z.lat, lon: z.lon }) - z.radiusM;
}
exports.distanceToZoneM = distanceToZoneM;
// ── Zone validation (host setup) ────────────────────────────
const geo_2 = require("./geo");
/**
 * Validate host-placed zones: all inside the field, pairwise separation
 * ≥ 1.5x combined radii (no overlapping trivial multi-caps).
 */
function validateZones(zones, polygon, maxZones = 8) {
    const errors = [];
    if (zones.length > maxZones)
        errors.push('too_many_zones');
    for (const z of zones) {
        if (!(0, geo_2.pointInPolygon)({ lat: z.lat, lon: z.lon }, polygon)) {
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
exports.validateZones = validateZones;
