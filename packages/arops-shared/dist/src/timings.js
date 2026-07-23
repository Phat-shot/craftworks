"use strict";
// ═══════════════════════════════════════════════════════════
//  Field-size-scaled timings.
//  L = sqrt(areaM2) is the characteristic field length in meters.
//  Reference: walking speed ~1.4 m/s. Per user requirement all
//  values err LONGER rather than shorter and are clamped to
//  sane bounds. Every value can be overridden via ar_settings.
//
//  Size categories: small = 20×20m (L=20, 400m², the platform minimum — see
//  DEFAULT_POLYGON_OPTIONS.minAreaM2 in types.ts), medium starts at 100×100m
//  (L=100), large starts at 1000×1000m (L=1000). Several values (see scale3()
//  below) are literally anchored to these 3 points: flat below 20m, linear
//  20→100m, linear 100→1000m, flat above 1000m. The rest remain smooth clamp()
//  functions of L tuned to land in a similar range at those same reference
//  points, without being formally anchored to them.
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRandomZones = exports.validateZones = exports.distanceToZoneM = exports.isInZone = exports.scaleCoreConfig = exports.scaleDroneRangeM = exports.scaleTimings = void 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/**
 * Piecewise-linear 3-anchor-point scale: flat floor below `sSmall`, linear
 * ramp small→medium, linear ramp medium→large, flat ceiling above `sLarge`.
 * Anchor field-length points are fixed platform-wide: 20m (small), 100m
 * (medium), 1000m (large) — see DEFAULT_POLYGON_OPTIONS.minAreaM2 (types.ts)
 * for the matching 20×20m minimum field size.
 */
const SMALL_L = 20, MEDIUM_L = 100, LARGE_L = 1000;
function scale3(L, atSmall, atMedium, atLarge) {
    if (L <= SMALL_L)
        return atSmall;
    if (L <= MEDIUM_L)
        return atSmall + (atMedium - atSmall) * ((L - SMALL_L) / (MEDIUM_L - SMALL_L));
    if (L <= LARGE_L)
        return atMedium + (atLarge - atMedium) * ((L - MEDIUM_L) / (LARGE_L - MEDIUM_L));
    return atLarge;
}
/** Compute all mode timings from the playfield area. */
function scaleTimings(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2)); // characteristic length in m
    return {
        // ~L/8: small ≈10m (floor), medium ≈13m, large(L=200) ≈25m.
        zoneRadiusM: clamp(L / 8, 10, 40),
        // 3s @ 20m, 10s @ 100m, 30s @ 1000m+.
        freezeMs: scale3(L, 3000, 10000, 30000),
        freezeMoveToleranceM: 15, // fixed: below GPS drift would punish standing still
        freezeExtensionMs: clamp(L * 25, 1000, 8000),
        // Base-placement phase: 1min @ 20m, 2min @ 100m, 5min @ 1000m+.
        baseSettingMs: scale3(L, 60000, 120000, 300000),
        // Warmup phase: fixed 1 minute regardless of field size.
        warmupMs: 60000,
        // Small ≈2.5s, medium ≈5s, large(L=200) ≈10s.
        flagPickupDwellMs: clamp((L / 20) * 1000, 2000, 12000),
        // Small ≈15s, medium ≈30s, large(L=200) ≈60s.
        flagReturnMs: clamp(L * 300, 10000, 90000),
        // Small ≈30m, medium ≈60m, large(L=200) ≈120m — the old 60m floor left
        // almost no room to place 2 bases at all on a small/medium field.
        minBaseSeparationM: clamp(L * 0.6, 15, 500),
        // Small ≈3.3s, medium ≈6.7s, large(L=200) ≈13.3s.
        captureDwellMs: clamp((L / 15) * 1000, 3000, 20000),
        plantDwellMs: clamp((L / 15) * 1000, 4000, 20000),
        defuseDwellMs: clamp((L / 20) * 1000, 3000, 15000),
        // Small ≈51s, medium ≈86s, large(L=200) ≈158s.
        bombTimerMs: clamp(((L / 1.4) + 15) * 1000, 45000, 240000),
        // Small ≈10m, medium ≈20m, large(L=200) ≈40m.
        revealTrapRadiusM: clamp(L * 0.2, 8, 60),
        spawnCheckDwellMs: clamp((L / 20) * 1000, 3000, 15000),
    };
}
exports.scaleTimings = scaleTimings;
/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
function scaleDroneRangeM(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2));
    // Small ≈25m, medium ≈50m, large(L=200) ≈100m — the old L*0.4 floor of
    // 50m was already the WHOLE field on a small/medium field (near-useless
    // as a "nearby" signal, it'd fire almost constantly).
    return clamp(L * 0.5, 15, 200);
}
exports.scaleDroneRangeM = scaleDroneRangeM;
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
    // Auto: 5min @ 20m, 15min @ 100m, 60min @ 1000m+. Manual override can go
    // up to 6h (see platform.js's ceiling on ar_settings.gameDurationMs) —
    // this auto-derived value is deliberately never that long.
    const gameDurationMs = scale3(L, 5 * 60000, 15 * 60000, 60 * 60000);
    // Radar cooldown: 1min @ 20m, 5min @ 100m, 15min @ 1000m+ — every other
    // perk's cooldown is a fixed fraction of radar's (radar reveals positions
    // outright, so it's the rarest; every other perk is a cheaper signal).
    const radarCooldownMs = scale3(L, 60000, 5 * 60000, 15 * 60000);
    const otherPerkCooldownMs = radarCooldownMs / 3;
    // One life per ~90s of match — bigger field naturally affords more lives
    // via its longer auto-derived match, not via its own separate area formula.
    const livesPerPlayer = clamp(Math.round(gameDurationMs / 90000), 2, 6);
    return {
        // Small ≈20s (floor), medium ≈36s, large(L=200) ≈71s. Floor lowered
        // from 45s — a tiny field has nowhere to hide anyway, a long head start
        // is wasted time, not fairness.
        hidingDurationMs: clamp(((L / 2) / 1.4) * 1000, 20000, 600000),
        gameDurationMs,
        // Scout's base range: 5m @ 20m, 20m @ 100m, 100m @ 1000m+ (other classes'
        // ranges derive from this via their own shotRangeMultiplier, see
        // profiles.ts's PLAYER_TYPE_PROFILES).
        hitRangeM: scale3(L, 5, 20, 100),
        // Fixed, NOT field-size-scaled (unlike hitRangeM above) — matches the
        // Lobby's manual "Normal (2m)" preset (REF_DIST_M=10, halfWidthM=1)
        // regardless of field size.
        hitHalfWidthM: 1,
        radarCooldownMs,
        droneCooldownMs: otherPerkCooldownMs,
        cloakCooldownMs: otherPerkCooldownMs,
        fakeMarkerCooldownMs: otherPerkCooldownMs,
        aufscheuchenCooldownMs: otherPerkCooldownMs,
        revealTrapCooldownMs: otherPerkCooldownMs,
        // Perk effect duration (radar contacts visible, cloak active, etc.):
        // 5s @ 20m, 15s @ 100m, 30s @ 1000m+ — same anchor points as radar's
        // own cooldown above.
        perkDurationMs: scale3(L, 5000, 15000, 30000),
        livesPerPlayer,
    };
}
exports.scaleCoreConfig = scaleCoreConfig;
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
// ── Random zone/target generation (host "random" toggle) ───────────────────
// A public, multi-point counterpart to server/src/game/arops.js's private,
// single-point `randomPointInPolygon` (used there only for fake-marker
// decoys and bot spawn — deliberately left untouched, its 2 call sites don't
// need pairwise separation). This one is for a different, new use case:
// hosts generating several well-separated random targets/zones at once
// (planned for the Zerstören mode rework and Domination's "random targets"
// toggle) — not wired into any mode yet, just the reusable primitive.
function generateRandomZones(polygon, count, minSeparationM, radiusM, maxAttemptsPerZone = 30) {
    if (!polygon || polygon.length < 3 || count <= 0)
        return [];
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const v of polygon) {
        if (v.lat < minLat)
            minLat = v.lat;
        if (v.lat > maxLat)
            maxLat = v.lat;
        if (v.lon < minLon)
            minLon = v.lon;
        if (v.lon > maxLon)
            maxLon = v.lon;
    }
    const zones = [];
    for (let i = 0; i < count; i++) {
        let placed = null;
        for (let attempt = 0; attempt < maxAttemptsPerZone; attempt++) {
            const cand = {
                lat: minLat + Math.random() * (maxLat - minLat),
                lon: minLon + Math.random() * (maxLon - minLon),
            };
            if (!(0, geo_2.pointInPolygon)(cand, polygon))
                continue;
            if (zones.some(z => (0, geo_1.haversineMeters)(cand, z) < minSeparationM))
                continue;
            placed = cand;
            break;
        }
        // A field too small/crowded for the requested count+separation simply
        // yields fewer zones than asked — callers decide whether that's an
        // error (e.g. re-prompt the host) or an acceptable partial result.
        if (!placed)
            break;
        zones.push({ id: 'rz' + (i + 1), lat: placed.lat, lon: placed.lon, radiusM });
    }
    return zones;
}
exports.generateRandomZones = generateRandomZones;
