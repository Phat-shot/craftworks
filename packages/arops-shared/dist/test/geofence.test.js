"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const geofence_1 = require("../src/geofence");
const geo_1 = require("../src/geo");
const MUC = { lat: 48.13743, lon: 11.57549 };
const T0 = 1700000000000;
function squareAround(center, halfSideM) {
    const n = (0, geo_1.destinationPoint)(center, 0, halfSideM);
    const s = (0, geo_1.destinationPoint)(center, 180, halfSideM);
    return [
        (0, geo_1.destinationPoint)(n, 90, halfSideM),
        (0, geo_1.destinationPoint)(s, 90, halfSideM),
        (0, geo_1.destinationPoint)(s, 270, halfSideM),
        (0, geo_1.destinationPoint)(n, 270, halfSideM),
    ];
}
function sample(pos, ts) {
    return { lat: pos.lat, lon: pos.lon, ts, accuracyM: 5, headingDeg: null };
}
// ── validatePolygon ─────────────────────────────────────────
(0, node_test_1.test)('polygon: valid 200×200m square passes', () => {
    const sq = squareAround(MUC, 100); // 40,000 m²
    const r = (0, geofence_1.validatePolygon)(sq);
    strict_1.default.equal(r.ok, true);
    strict_1.default.deepEqual(r.errors, []);
    strict_1.default.ok(Math.abs(r.areaM2 - 40000) < 150);
});
(0, node_test_1.test)('polygon: two points rejected', () => {
    const r = (0, geofence_1.validatePolygon)([MUC, (0, geo_1.destinationPoint)(MUC, 0, 100)]);
    strict_1.default.equal(r.ok, false);
    strict_1.default.deepEqual(r.errors, ['too_few_points']);
});
(0, node_test_1.test)('polygon: tiny 10×10m square rejected as too small', () => {
    const r = (0, geofence_1.validatePolygon)(squareAround(MUC, 5)); // 100 m²
    strict_1.default.equal(r.ok, false);
    strict_1.default.ok(r.errors.includes('area_too_small'));
});
(0, node_test_1.test)('polygon: no upper area limit — a huge field is accepted', () => {
    const r = (0, geofence_1.validatePolygon)(squareAround(MUC, 1500)); // 9 km²
    strict_1.default.equal(r.ok, true);
    strict_1.default.ok(!r.errors.includes('area_too_large'));
});
(0, node_test_1.test)('polygon: bowtie rejected as self-intersecting', () => {
    const sq = squareAround(MUC, 100);
    const bowtie = [sq[0], sq[1], sq[3], sq[2]];
    const r = (0, geofence_1.validatePolygon)(bowtie);
    strict_1.default.equal(r.ok, false);
    strict_1.default.ok(r.errors.includes('self_intersecting'));
});
(0, node_test_1.test)('polygon: reports multiple errors at once', () => {
    // Tiny bowtie: both self-intersecting AND too small
    const sq = squareAround(MUC, 5);
    const bowtie = [sq[0], sq[1], sq[3], sq[2]];
    const r = (0, geofence_1.validatePolygon)(bowtie);
    strict_1.default.equal(r.ok, false);
    strict_1.default.ok(r.errors.includes('self_intersecting'));
    strict_1.default.ok(r.errors.includes('area_too_small'));
});
// ── geofenceStatus ──────────────────────────────────────────
(0, node_test_1.test)('geofence: center of field is inside with correct edge distance', () => {
    const sq = squareAround(MUC, 100);
    const s = (0, geofence_1.geofenceStatus)(MUC, sq, 10);
    strict_1.default.equal(s.state, 'inside');
    strict_1.default.ok(Math.abs(s.signedDistanceM - 100) < 1);
});
(0, node_test_1.test)('geofence: near edge triggers warning', () => {
    const sq = squareAround(MUC, 100);
    const nearEdge = (0, geo_1.destinationPoint)(MUC, 0, 95); // 5m from north edge
    const s = (0, geofence_1.geofenceStatus)(nearEdge, sq, 10);
    strict_1.default.equal(s.state, 'warning');
    strict_1.default.ok(s.signedDistanceM > 0 && s.signedDistanceM <= 10);
});
(0, node_test_1.test)('geofence: outside gives negative distance', () => {
    const sq = squareAround(MUC, 100);
    const out = (0, geo_1.destinationPoint)(MUC, 0, 130); // 30m past edge
    const s = (0, geofence_1.geofenceStatus)(out, sq, 10);
    strict_1.default.equal(s.state, 'outside');
    strict_1.default.ok(Math.abs(s.signedDistanceM + 30) < 1, `signed ${s.signedDistanceM} ≈ -30`);
});
// ── movement plausibility ───────────────────────────────────
(0, node_test_1.test)('plausibility: walking speed accepted', () => {
    // 15m in 10s = 1.5 m/s
    const a = sample(MUC, T0);
    const b = sample((0, geo_1.destinationPoint)(MUC, 0, 15), T0 + 10000);
    strict_1.default.equal((0, geofence_1.isMovementPlausible)(a, b), true);
});
(0, node_test_1.test)('plausibility: sprint accepted', () => {
    // 80m in 10s = 8 m/s
    const a = sample(MUC, T0);
    const b = sample((0, geo_1.destinationPoint)(MUC, 0, 80), T0 + 10000);
    strict_1.default.equal((0, geofence_1.isMovementPlausible)(a, b), true);
});
(0, node_test_1.test)('plausibility: teleport rejected', () => {
    // 500m in 10s = 50 m/s
    const a = sample(MUC, T0);
    const b = sample((0, geo_1.destinationPoint)(MUC, 0, 500), T0 + 10000);
    strict_1.default.equal((0, geofence_1.isMovementPlausible)(a, b), false);
});
(0, node_test_1.test)('plausibility: GPS jitter in short gaps tolerated', () => {
    // 20m jump within 1s — implied 20 m/s, but gap < minGapMs so accepted
    const a = sample(MUC, T0);
    const b = sample((0, geo_1.destinationPoint)(MUC, 0, 20), T0 + 1000);
    strict_1.default.equal((0, geofence_1.isMovementPlausible)(a, b), true);
});
(0, node_test_1.test)('speedBetween: correct value', () => {
    const a = sample(MUC, T0);
    const b = sample((0, geo_1.destinationPoint)(MUC, 90, 100), T0 + 20000);
    const v = (0, geofence_1.speedBetweenMps)(a, b);
    strict_1.default.ok(Math.abs(v - 5) < 0.01, `100m/20s should be 5 m/s, got ${v}`);
});
// ── sortPolygonPoints ───────────────────────────────────────
const geofence_2 = require("../src/geofence");
(0, node_test_1.test)('sortPolygonPoints repairs tap-order self-intersection', () => {
    const a = MUC;
    const b = (0, geo_1.destinationPoint)(MUC, 90, 200);
    const c = (0, geo_1.destinationPoint)(b, 0, 150);
    const d = (0, geo_1.destinationPoint)(MUC, 0, 150);
    // Zigzag tap order a,c,b,d → self-intersecting bowtie
    const bowtie = [a, c, b, d];
    strict_1.default.ok(!(0, geofence_2.validatePolygon)(bowtie).ok, 'bowtie must be invalid');
    const fixed = (0, geofence_2.sortPolygonPoints)(bowtie);
    const check = (0, geofence_2.validatePolygon)(fixed);
    strict_1.default.ok(!check.errors.includes('self_intersecting'), 'sorted must not self-intersect');
    strict_1.default.ok(check.ok, JSON.stringify(check));
});
