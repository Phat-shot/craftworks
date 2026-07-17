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
const zone = { id: 'z1', lat: MUC.lat, lon: MUC.lon, radiusM: 15 };
(0, node_test_1.test)('isInZone: inside / rim / outside', () => {
    strict_1.default.equal((0, timings_1.isInZone)(MUC, zone), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 14), zone), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 16), zone), false);
});
(0, node_test_1.test)('distanceToZone: signed', () => {
    const inside = (0, timings_1.distanceToZoneM)((0, geo_1.destinationPoint)(MUC, 90, 5), zone);
    const outside = (0, timings_1.distanceToZoneM)((0, geo_1.destinationPoint)(MUC, 90, 25), zone);
    strict_1.default.ok(inside < 0 && Math.abs(inside + 10) < 0.5);
    strict_1.default.ok(outside > 0 && Math.abs(outside - 10) < 0.5);
});
(0, node_test_1.test)('scaleTimings: bigger field → longer timings, within clamps', () => {
    const small = (0, timings_1.scaleTimings)(40000); // 200x200m park, L=200
    const big = (0, timings_1.scaleTimings)(1000000); // 1km², L=1000
    strict_1.default.ok(big.freezeMs > small.freezeMs);
    strict_1.default.ok(big.captureDwellMs >= small.captureDwellMs);
    strict_1.default.ok(small.freezeMs >= 30000, 'freeze floor');
    strict_1.default.ok(big.freezeMs <= 120000, 'freeze cap');
    strict_1.default.ok(small.captureDwellMs >= 5000, 'user-specified 5s minimum dwell');
    strict_1.default.equal(small.freezeMoveToleranceM, 15, 'move tolerance fixed (GPS drift)');
});
(0, node_test_1.test)('scaleTimings: matches real polygon area', () => {
    const field = [0, 90, 180, 270].map(b => (0, geo_1.destinationPoint)(MUC, b, 200));
    const t = (0, timings_1.scaleTimings)((0, geo_1.polygonAreaM2)(field));
    strict_1.default.ok(t.zoneRadiusM >= 12 && t.zoneRadiusM <= 45);
    strict_1.default.ok(t.minBaseSeparationM >= 60);
});
(0, node_test_1.test)('validateZones: valid trio passes', () => {
    const field = [0, 90, 180, 270].map(b => (0, geo_1.destinationPoint)(MUC, b, 200));
    const zones = [
        { id: 'a', ...(0, geo_1.destinationPoint)(MUC, 0, 100), radiusM: 15 },
        { id: 'b', ...(0, geo_1.destinationPoint)(MUC, 120, 100), radiusM: 15 },
        { id: 'c', ...(0, geo_1.destinationPoint)(MUC, 240, 100), radiusM: 15 },
    ];
    strict_1.default.deepEqual((0, timings_1.validateZones)(zones, field), { ok: true, errors: [] });
});
(0, node_test_1.test)('validateZones: outside field rejected', () => {
    const field = [0, 90, 180, 270].map(b => (0, geo_1.destinationPoint)(MUC, b, 200));
    const r = (0, timings_1.validateZones)([{ id: 'a', ...(0, geo_1.destinationPoint)(MUC, 0, 400), radiusM: 15 }], field);
    strict_1.default.ok(r.errors.includes('outside_field'));
});
(0, node_test_1.test)('validateZones: overlapping zones rejected', () => {
    const field = [0, 90, 180, 270].map(b => (0, geo_1.destinationPoint)(MUC, b, 200));
    const zones = [
        { id: 'a', ...MUC, radiusM: 15 },
        { id: 'b', ...(0, geo_1.destinationPoint)(MUC, 0, 30), radiusM: 15 },
    ];
    const r = (0, timings_1.validateZones)(zones, field);
    strict_1.default.ok(r.errors.includes('zones_too_close'));
});
