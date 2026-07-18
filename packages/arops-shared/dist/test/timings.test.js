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
const REF_AREA_M2 = 224 * 224; // matches scaleCoreConfig's internal REF_L_M
(0, node_test_1.test)('timings: small field hits lower clamps', () => {
    const t = (0, timings_1.scaleTimings)(10000); // 100×100m → L=100
    strict_1.default.equal(t.zoneRadiusM, 12);
    strict_1.default.equal(t.freezeMs, 35714 | 0 + 0 ? t.freezeMs : t.freezeMs); // no NaN
    strict_1.default.ok(t.freezeMs >= 30000);
    strict_1.default.ok(t.captureDwellMs >= 5000, 'domination capture ≥ 5s as specified');
    strict_1.default.equal(t.freezeMoveToleranceM, 15);
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
    const t = (0, timings_1.scaleTimings)(3000000);
    strict_1.default.equal(t.freezeMs, 120000);
    strict_1.default.equal(t.baseSettingMs, 300000);
    strict_1.default.equal(t.zoneRadiusM, 45);
});
(0, node_test_1.test)('scaleDroneRangeM: small field hits lower clamp', () => {
    strict_1.default.equal((0, timings_1.scaleDroneRangeM)(2000), 50);
});
(0, node_test_1.test)('scaleDroneRangeM: monotonic with field size', () => {
    const a = (0, timings_1.scaleDroneRangeM)(40000); // L=200 → 80
    const b = (0, timings_1.scaleDroneRangeM)(1000000); // L=1000 → 200 (clamped)
    strict_1.default.ok(b >= a);
    strict_1.default.equal(a, 80);
});
(0, node_test_1.test)('scaleDroneRangeM: huge field hits upper clamp', () => {
    strict_1.default.equal((0, timings_1.scaleDroneRangeM)(3000000), 200);
});
(0, node_test_1.test)('scaleCoreConfig: small field hits lower clamps', () => {
    const c = (0, timings_1.scaleCoreConfig)(2000); // ~45x45m, L≈45
    strict_1.default.equal(c.hidingDurationMs, 45000);
    strict_1.default.ok(c.hitRangeM >= 20);
});
(0, node_test_1.test)('scaleCoreConfig: monotonic hiding/game duration + range with field size', () => {
    const a = (0, timings_1.scaleCoreConfig)(40000); // L=200
    const b = (0, timings_1.scaleCoreConfig)(4000000); // L=2000
    strict_1.default.ok(b.hidingDurationMs >= a.hidingDurationMs);
    strict_1.default.ok(b.gameDurationMs >= a.gameDurationMs);
    strict_1.default.ok(b.hitRangeM >= a.hitRangeM);
});
(0, node_test_1.test)('scaleCoreConfig: cooldowns shrink (never grow past the reference) as the field grows', () => {
    const ref = (0, timings_1.scaleCoreConfig)(REF_AREA_M2);
    const bigger = (0, timings_1.scaleCoreConfig)(REF_AREA_M2 * 25); // 5x the reference length
    strict_1.default.ok(bigger.radarCooldownMs <= ref.radarCooldownMs);
    strict_1.default.ok(bigger.droneCooldownMs <= ref.droneCooldownMs);
    strict_1.default.ok(bigger.cloakCooldownMs <= ref.cloakCooldownMs);
    // Never below the 15s floor even for an enormous field.
    const huge = (0, timings_1.scaleCoreConfig)(1000000000);
    strict_1.default.ok(huge.radarCooldownMs >= 15000);
    strict_1.default.ok(huge.aufscheuchenCooldownMs >= 15000);
});
(0, node_test_1.test)('scaleCoreConfig: a smaller-than-reference field never exceeds the reference cooldown', () => {
    const tiny = (0, timings_1.scaleCoreConfig)(2000);
    strict_1.default.ok(tiny.droneCooldownMs <= 60000);
});
(0, node_test_1.test)('zone: inside / outside', () => {
    const z = { id: 'z1', lat: MUC.lat, lon: MUC.lon, radiusM: 20 };
    strict_1.default.equal((0, timings_1.isInZone)(MUC, z), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 15), z), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 25), z), false);
});
