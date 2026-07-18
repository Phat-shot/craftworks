"use strict";
// ═══════════════════════════════════════════════════════════
//  Field-size-scaled timings.
//  L = sqrt(areaM2) is the characteristic field length in meters.
//  Reference: walking speed ~1.4 m/s. Per user requirement all
//  values err LONGER rather than shorter and are clamped to
//  sane bounds. Every value can be overridden via ar_settings.
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.scaleTimings = scaleTimings;
exports.scaleDroneRangeM = scaleDroneRangeM;
exports.scaleCoreConfig = scaleCoreConfig;
exports.isInZone = isInZone;
exports.distanceToZoneM = distanceToZoneM;
exports.validateZones = validateZones;
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
/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
function scaleDroneRangeM(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2));
    return clamp(L * 0.4, 50, 200);
}
// A "medium" reference field (~50,000 m², L≈224m) roughly matching the
// fixed defaults these values replace (server/src/game/arops.js DEFAULTS) —
// cooldowns scale down from their reference value as the field grows past
// this, never up past it for a smaller field.
const REF_L_M = 224;
/**
 * "Auto" mode: derive hiding/game duration, shot range, and perk cooldowns
 * straight from the playfield size — an alternative to the host manually
 * picking presets, useful now that field area has no upper limit (see
 * DEFAULT_POLYGON_OPTIONS.maxAreaM2). Same L = sqrt(areaM2), ~1.4 m/s
 * walking-speed philosophy as scaleTimings() above. First-pass numbers, not
 * tuned by real playtesting yet — expect to revisit the exact constants.
 */
function scaleCoreConfig(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2));
    const cooldown = (referenceMs) => clamp(referenceMs * (REF_L_M / L), 15000, referenceMs);
    return {
        hidingDurationMs: clamp(((L / 2) / 1.4) * 1000, 45000, 600000),
        gameDurationMs: clamp((L / 1.4) * 1000 * 2.5, 300000, 3600000),
        hitRangeM: clamp(L * 0.5, 20, 500),
        hitHalfWidthM: clamp((L / REF_L_M) * 1, 0.5, 5),
        radarCooldownMs: cooldown(15 * 60000),
        droneCooldownMs: cooldown(60000),
        cloakCooldownMs: cooldown(90000),
        fakeMarkerCooldownMs: cooldown(90000),
        aufscheuchenCooldownMs: cooldown(45000),
    };
}
const geo_1 = require("./geo");
function isInZone(p, z) {
    return (0, geo_1.haversineMeters)(p, { lat: z.lat, lon: z.lon }) <= z.radiusM;
}
/** Negative = inside (meters past the rim), positive = outside. */
function distanceToZoneM(p, z) {
    return (0, geo_1.haversineMeters)(p, { lat: z.lat, lon: z.lon }) - z.radiusM;
}
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
