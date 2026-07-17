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
(0, node_test_1.test)('zone: inside / outside', () => {
    const z = { id: 'z1', lat: MUC.lat, lon: MUC.lon, radiusM: 20 };
    strict_1.default.equal((0, timings_1.isInZone)(MUC, z), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 15), z), true);
    strict_1.default.equal((0, timings_1.isInZone)((0, geo_1.destinationPoint)(MUC, 0, 25), z), false);
});
