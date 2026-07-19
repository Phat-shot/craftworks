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
// 400x400m square field around MUC.
const FIELD = [0, 90, 180, 270].map(b => (0, geo_1.destinationPoint)(MUC, b, 200));
(0, node_test_1.test)('generateRandomZones: all generated points are inside the polygon', () => {
    const zones = (0, timings_1.generateRandomZones)(FIELD, 5, 20, 15);
    strict_1.default.ok(zones.length > 0, 'expected at least one zone to be placed');
    for (const z of zones) {
        strict_1.default.ok((0, geo_1.pointInPolygon)({ lat: z.lat, lon: z.lon }, FIELD), `zone ${z.id} should be inside the field`);
    }
});
(0, node_test_1.test)('generateRandomZones: every zone carries the requested radius and a unique id', () => {
    const zones = (0, timings_1.generateRandomZones)(FIELD, 4, 15, 22);
    const ids = new Set(zones.map(z => z.id));
    strict_1.default.equal(ids.size, zones.length, 'zone ids must be unique');
    for (const z of zones)
        strict_1.default.equal(z.radiusM, 22);
});
(0, node_test_1.test)('generateRandomZones: pairwise separation is always respected', () => {
    const zones = (0, timings_1.generateRandomZones)(FIELD, 6, 30, 10);
    for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
            const d = (0, geo_1.haversineMeters)(zones[i], zones[j]);
            strict_1.default.ok(d >= 30, `zones ${zones[i].id}/${zones[j].id} are ${d}m apart, expected >= 30m`);
        }
    }
});
(0, node_test_1.test)('generateRandomZones: asking for more zones than the field can fit yields a partial result, not an error', () => {
    // Absurdly large separation relative to field size — most attempts will fail.
    const zones = (0, timings_1.generateRandomZones)(FIELD, 20, 350, 15);
    strict_1.default.ok(zones.length < 20, 'should not be able to fit 20 zones at 350m separation in a 400x400m field');
});
(0, node_test_1.test)('generateRandomZones: count=0 or invalid polygon yields an empty array, no throw', () => {
    strict_1.default.deepEqual((0, timings_1.generateRandomZones)(FIELD, 0, 20, 15), []);
    strict_1.default.deepEqual((0, timings_1.generateRandomZones)([], 3, 20, 15), []);
    strict_1.default.deepEqual((0, timings_1.generateRandomZones)([MUC, MUC], 3, 20, 15), []); // < 3 points, not a real polygon
});
(0, node_test_1.test)('generateRandomZones: deterministic-ish sanity — repeated calls stay within field bounds', () => {
    for (let i = 0; i < 10; i++) {
        const zones = (0, timings_1.generateRandomZones)(FIELD, 3, 25, 15);
        for (const z of zones) {
            strict_1.default.ok((0, geo_1.pointInPolygon)({ lat: z.lat, lon: z.lon }, FIELD));
        }
    }
});
