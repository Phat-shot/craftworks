"use strict";
// ═══════════════════════════════════════════════════════════
//  Field-size-scaled timings.
//  L = sqrt(areaM2) is the characteristic field length in meters.
//  Reference: walking speed ~1.4 m/s. Per user requirement all
//  values err LONGER rather than shorter and are clamped to
//  sane bounds. Every value can be overridden via ar_settings.
//
//  Size categories (host-facing mental model, not a literal code branch —
//  every formula below is a smooth function of L, these are just the
//  reference points each was tuned against): small <2,500m² (L<50),
//  medium up to 10,000m² (L up to 100), large beyond that (L>100). Floors/
//  coefficients throughout are chosen so small/medium/large each land in a
//  visibly different part of their own range instead of several categories
//  all bottoming out at the same fixed floor (the previous tuning's
//  reference field was ~50,000m², 5x today's "medium" ceiling, so most
//  values used to sit flatly at their floor for anything at or below what's
//  now the medium/large boundary).
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.scaleTimings = scaleTimings;
exports.scaleDroneRangeM = scaleDroneRangeM;
exports.scaleCoreConfig = scaleCoreConfig;
exports.isInZone = isInZone;
exports.distanceToZoneM = distanceToZoneM;
exports.validateZones = validateZones;
exports.generateRandomZones = generateRandomZones;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Compute all mode timings from the playfield area. */
function scaleTimings(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2)); // characteristic length in m
    return {
        // ~L/8: small ≈10m (floor), medium ≈13m, large(L=200) ≈25m.
        zoneRadiusM: clamp(L / 8, 10, 40),
        // 100ms/m of L: small ≈5s, medium ≈10s, large(L=200) ≈20s, caps at 30s
        // (L=300). Linear in L directly (not the walking-speed-derived shape
        // below) — simplest formula that visibly differentiates all 3 categories.
        freezeMs: clamp(L * 100, 3000, 30000),
        freezeMoveToleranceM: 15, // fixed: below GPS drift would punish standing still
        freezeExtensionMs: clamp(L * 25, 1000, 8000),
        // Base-placement/Warmup phase 1 — small ≈36s, medium ≈71s, large(L=200)
        // ≈143s. Floor lowered from 90s: a full 90s-5min setup was disproportionate
        // for a small field's much shorter overall match.
        baseSettingMs: clamp((L / 1.4) * 1000, 30000, 240000),
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
/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
function scaleDroneRangeM(areaM2) {
    const L = Math.sqrt(Math.max(1, areaM2));
    // Small ≈25m, medium ≈50m, large(L=200) ≈100m — the old L*0.4 floor of
    // 50m was already the WHOLE field on a small/medium field (near-useless
    // as a "nearby" signal, it'd fire almost constantly).
    return clamp(L * 0.5, 15, 200);
}
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
    // Small ≈3min (floor), medium ≈3.6min, large(L=200) ≈7.1min. Floor lowered
    // from 5min and coefficient raised (2.5→3) so medium fields clear the
    // floor with visible room instead of landing right on top of it.
    const gameDurationMs = clamp((L / 1.4) * 1000 * 3, 180000, 3600000);
    // Perk cooldowns used to be derived purely from a field-size ratio against
    // a fixed reference (bigger field → shorter cooldown, capped at the
    // reference value) — completely decoupled from gameDurationMs. A small
    // field's cooldown sat at (or near) that fixed reference ceiling
    // regardless of how short its own auto-derived match actually was, e.g.
    // radar's 15min reference cooldown inside a field whose whole match lasts
    // 5min (gameDurationMs's own lower clamp) — the perk was then barely or
    // never usable ("cooldowns nicht an die Match-Dauer angepasst"). Deriving
    // each cooldown as a fraction of the match's own gameDurationMs instead
    // fixes that directly — field size still matters, just indirectly via its
    // effect on gameDurationMs, same as every timing above. The old reference
    // constants now only serve as the absolute ceiling for a very long match
    // (huge field), so a differently-tuned bomb-timer-scale match doesn't
    // suddenly grant an absurdly long cooldown either.
    const perkCooldown = (fractionOfMatch, referenceMs) => clamp(gameDurationMs * fractionOfMatch, 15000, referenceMs);
    // One life per ~90s of match — the same "field size -> match length ->
    // derived value" chain every other auto value here follows (perkCooldown
    // above included), so a bigger field naturally affords more lives via its
    // longer auto-derived match, not via its own separate area formula.
    // Divisor lowered from 5min (300_000) so small/medium matches (now
    // several minutes shorter, see gameDurationMs above) don't all flatten to
    // the same 2-life floor.
    const livesPerPlayer = clamp(Math.round(gameDurationMs / 90000), 2, 6);
    return {
        // Small ≈20s (floor), medium ≈36s, large(L=200) ≈71s. Floor lowered
        // from 45s — a tiny field has nowhere to hide anyway, a long head start
        // is wasted time, not fairness.
        hidingDurationMs: clamp(((L / 2) / 1.4) * 1000, 20000, 600000),
        gameDurationMs,
        // Scout's base range — 10-100m regardless of field size (other classes'
        // ranges derive from this via their own shotRangeMultiplier, see
        // profiles.ts's PLAYER_TYPE_PROFILES).
        hitRangeM: clamp(L * 0.5, 10, 100),
        // Fixed, NOT field-size-scaled (unlike hitRangeM above) — matches the
        // Lobby's manual "Normal (2m)" preset (REF_DIST_M=10, halfWidthM=1)
        // regardless of field size.
        hitHalfWidthM: 1,
        // Fractions reflect relative perk power (radar reveals positions outright
        // → rarest; drone/aufscheuchen are cheap one-bit signals → most frequent).
        radarCooldownMs: perkCooldown(1 / 4, 15 * 60000),
        droneCooldownMs: perkCooldown(1 / 10, 60000),
        cloakCooldownMs: perkCooldown(1 / 6, 90000),
        fakeMarkerCooldownMs: perkCooldown(1 / 6, 90000),
        aufscheuchenCooldownMs: perkCooldown(1 / 10, 45000),
        revealTrapCooldownMs: perkCooldown(1 / 8, 60000),
        livesPerPlayer,
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
