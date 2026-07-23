"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const timings_1 = require("../src/timings");
const geo_1 = require("../src/geo");
const MUC = { lat: 48.13743, lon: 11.57549 };
const REF_AREA_M2 = 224 * 224; // a "medium" reference field, L≈224m
(0, node_test_1.test)('timings: small field (L=20, platform minimum) matches spec anchors', () => {
    const t = (0, timings_1.scaleTimings)(400); // 20×20m
    strict_1.default.equal(t.zoneRadiusM, 10);
    strict_1.default.equal(t.freezeMs, 3000);
    strict_1.default.equal(t.captureDwellMs, 1500, 'capture dwell is always half the freeze duration');
    strict_1.default.equal(t.plantDwellMs, 1500);
    strict_1.default.equal(t.defuseDwellMs, 1500);
    strict_1.default.equal(t.flagPickupDwellMs, 1500);
    strict_1.default.equal(t.freezeMoveToleranceM, 15);
    strict_1.default.equal(t.baseSettingMs, 60000);
    strict_1.default.equal(t.warmupMs, 60000);
});
(0, node_test_1.test)('timings: medium field (L=100) matches spec anchors', () => {
    const t = (0, timings_1.scaleTimings)(10000); // 100×100m
    strict_1.default.equal(t.freezeMs, 10000);
    strict_1.default.equal(t.baseSettingMs, 120000);
    strict_1.default.equal(t.warmupMs, 60000); // fixed, never scales
});
(0, node_test_1.test)('timings: large field (L=1000) matches spec anchors', () => {
    const t = (0, timings_1.scaleTimings)(1000000); // 1000×1000m
    strict_1.default.equal(t.freezeMs, 30000);
    strict_1.default.equal(t.baseSettingMs, 300000);
    strict_1.default.equal(t.warmupMs, 60000); // fixed, never scales
});
(0, node_test_1.test)('timings: warmupMs is fixed regardless of field size', () => {
    strict_1.default.equal((0, timings_1.scaleTimings)(400).warmupMs, 60000);
    strict_1.default.equal((0, timings_1.scaleTimings)(40000).warmupMs, 60000);
    strict_1.default.equal((0, timings_1.scaleTimings)(1000000000).warmupMs, 60000);
});
(0, node_test_1.test)('timings: monotonic with field size', () => {
    const a = (0, timings_1.scaleTimings)(40000); // 200m
    const b = (0, timings_1.scaleTimings)(1000000); // 1km
    strict_1.default.ok(b.freezeMs >= a.freezeMs);
    strict_1.default.ok(b.zoneRadiusM >= a.zoneRadiusM);
    strict_1.default.ok(b.baseSettingMs >= a.baseSettingMs);
    strict_1.default.ok(b.bombTimerMs >= a.bombTimerMs);
    strict_1.default.ok(b.minBaseSeparationM >= a.minBaseSeparationM);
});
(0, node_test_1.test)('timings: huge field hits upper clamps', () => {
    const t = (0, timings_1.scaleTimings)(3000000); // L≈1,732 — beyond the L=1000 "large" anchor
    strict_1.default.equal(t.freezeMs, 30000);
    strict_1.default.equal(t.baseSettingMs, 300000);
    strict_1.default.equal(t.zoneRadiusM, 40);
});
(0, node_test_1.test)('scaleDroneRangeM: small field hits lower clamp', () => {
    strict_1.default.equal((0, timings_1.scaleDroneRangeM)(400), 15); // L=20, well under the small boundary
});
(0, node_test_1.test)('scaleDroneRangeM: monotonic with field size', () => {
    const a = (0, timings_1.scaleDroneRangeM)(40000); // L=200 → 100
    const b = (0, timings_1.scaleDroneRangeM)(1000000); // L=1000 → 200 (clamped)
    strict_1.default.ok(b >= a);
    strict_1.default.equal(a, 100);
});
(0, node_test_1.test)('scaleDroneRangeM: huge field hits upper clamp', () => {
    strict_1.default.equal((0, timings_1.scaleDroneRangeM)(3000000), 200);
});
(0, node_test_1.test)('scaleCoreConfig: small field (L=20, platform minimum) matches spec anchors', () => {
    const c = (0, timings_1.scaleCoreConfig)(400); // 20×20m
    strict_1.default.equal(c.gameDurationMs, 5 * 60000);
    strict_1.default.equal(c.hitRangeM, 5);
    strict_1.default.equal(c.radarCooldownMs, 60000);
    strict_1.default.equal(c.droneCooldownMs, 60000 / 3);
    strict_1.default.equal(c.perkDurationMs, 5000);
});
(0, node_test_1.test)('scaleCoreConfig: medium field (L=100) matches spec anchors', () => {
    const c = (0, timings_1.scaleCoreConfig)(10000); // 100×100m
    strict_1.default.equal(c.gameDurationMs, 15 * 60000);
    strict_1.default.equal(c.hitRangeM, 20);
    strict_1.default.equal(c.radarCooldownMs, 5 * 60000);
    strict_1.default.equal(c.perkDurationMs, 15000);
});
(0, node_test_1.test)('scaleCoreConfig: large field (L=1000) matches spec anchors', () => {
    const c = (0, timings_1.scaleCoreConfig)(1000000); // 1000×1000m
    strict_1.default.equal(c.gameDurationMs, 60 * 60000);
    strict_1.default.equal(c.hitRangeM, 100);
    strict_1.default.equal(c.radarCooldownMs, 15 * 60000);
    strict_1.default.equal(c.perkDurationMs, 30000);
});
(0, node_test_1.test)('scaleCoreConfig: beyond the large anchor stays at the ceiling (auto never exceeds it, unlike a manual override)', () => {
    const c = (0, timings_1.scaleCoreConfig)(1000000000); // L≈31,623
    strict_1.default.equal(c.gameDurationMs, 60 * 60000);
    strict_1.default.equal(c.hitRangeM, 100);
    strict_1.default.equal(c.radarCooldownMs, 15 * 60000);
    strict_1.default.equal(c.perkDurationMs, 30000);
});
(0, node_test_1.test)('scaleCoreConfig: monotonic game duration + range with field size', () => {
    const a = (0, timings_1.scaleCoreConfig)(40000); // L=200
    const b = (0, timings_1.scaleCoreConfig)(4000000); // L=2000
    strict_1.default.ok(b.gameDurationMs >= a.gameDurationMs);
    strict_1.default.ok(b.hitRangeM >= a.hitRangeM);
});
(0, node_test_1.test)('scaleCoreConfig: hidingDurationMs (H&S\'s base-less "warmup" phase) is fixed regardless of field size', () => {
    strict_1.default.equal((0, timings_1.scaleCoreConfig)(400).hidingDurationMs, 60000);
    strict_1.default.equal((0, timings_1.scaleCoreConfig)(40000).hidingDurationMs, 60000);
    strict_1.default.equal((0, timings_1.scaleCoreConfig)(1000000000).hidingDurationMs, 60000);
});
(0, node_test_1.test)('scaleCoreConfig: every other perk cooldown is always exactly 1/3 of radar\'s', () => {
    for (const area of [400, 2000, REF_AREA_M2, 1000000, 1000000000]) {
        const c = (0, timings_1.scaleCoreConfig)(area);
        strict_1.default.equal(c.droneCooldownMs, c.radarCooldownMs / 3);
        strict_1.default.equal(c.cloakCooldownMs, c.radarCooldownMs / 3);
        strict_1.default.equal(c.fakeMarkerCooldownMs, c.radarCooldownMs / 3);
        strict_1.default.equal(c.aufscheuchenCooldownMs, c.radarCooldownMs / 3);
        strict_1.default.equal(c.revealTrapCooldownMs, c.radarCooldownMs / 3);
    }
});
(0, node_test_1.test)('scaleCoreConfig: a short match never gets a cooldown longer than the match itself', () => {
    const tiny = (0, timings_1.scaleCoreConfig)(400); // smallest field: gameDurationMs=300_000
    strict_1.default.ok(tiny.radarCooldownMs < tiny.gameDurationMs);
    strict_1.default.ok(tiny.droneCooldownMs < tiny.gameDurationMs);
    strict_1.default.ok(tiny.revealTrapCooldownMs < tiny.gameDurationMs);
});
(0, node_test_1.test)('scaleCoreConfig: hitHalfWidthM matches the "Normal" manual preset', () => {
    const ref = (0, timings_1.scaleCoreConfig)(REF_AREA_M2);
    strict_1.default.ok(Math.abs(ref.hitHalfWidthM - 1) < 0.05);
});
(0, node_test_1.test)('scaleCoreConfig: hitHalfWidthM stays fixed regardless of field size (unlike hitRangeM)', () => {
    const tiny = (0, timings_1.scaleCoreConfig)(2000);
    const huge = (0, timings_1.scaleCoreConfig)(1000000000);
    strict_1.default.equal(tiny.hitHalfWidthM, 1);
    strict_1.default.equal(huge.hitHalfWidthM, 1);
});
(0, node_test_1.test)('scaleCoreConfig: hitRangeM stays within the 5-100m Scout range regardless of field size', () => {
    const tiny = (0, timings_1.scaleCoreConfig)(400);
    const huge = (0, timings_1.scaleCoreConfig)(1000000000);
    strict_1.default.ok(tiny.hitRangeM >= 5);
    strict_1.default.ok(huge.hitRangeM <= 100);
});
(0, node_test_1.test)('zone: inside / outside', () => {
    const z = { id: 'z1', lat: MUC.lat, lon: MUC.lon, radiusM: 20 };
    strict_1.default.equal((0, timings_1.isInZone)(MUC, z), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 15), z), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 25), z), false);
});
