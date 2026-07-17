"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const geo_1 = require("../src/geo");
// Reference location: Munich Marienplatz
const MUC = { lat: 48.13743, lon: 11.57549 };
function approx(actual, expected, tolerance, msg) {
    strict_1.default.ok(Math.abs(actual - expected) <= tolerance, msg ?? `expected ${actual} ≈ ${expected} (±${tolerance})`);
}
// ── haversine ───────────────────────────────────────────────
(0, node_test_1.test)('haversine: zero distance', () => {
    strict_1.default.equal((0, geo_1.haversineMeters)(MUC, MUC), 0);
});
(0, node_test_1.test)('haversine: 1° latitude ≈ 111.19 km (sphere)', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 1, lon: 0 };
    const expected = (Math.PI * geo_1.EARTH_RADIUS_M) / 180; // exact on sphere
    approx((0, geo_1.haversineMeters)(a, b), expected, 1);
});
(0, node_test_1.test)('haversine: 1° longitude at 60°N is half of equator value', () => {
    const eq = (0, geo_1.haversineMeters)({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const n60 = (0, geo_1.haversineMeters)({ lat: 60, lon: 0 }, { lat: 60, lon: 1 });
    approx(n60, eq / 2, eq * 0.005); // cos(60°) = 0.5
});
(0, node_test_1.test)('haversine: symmetric', () => {
    const b = { lat: 48.2, lon: 11.6 };
    approx((0, geo_1.haversineMeters)(MUC, b), (0, geo_1.haversineMeters)(b, MUC), 1e-9);
});
// ── bearing ─────────────────────────────────────────────────
(0, node_test_1.test)('bearing: due north = 0°', () => {
    approx((0, geo_1.bearingDeg)({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 1e-9);
});
(0, node_test_1.test)('bearing: due east = 90° (at equator)', () => {
    approx((0, geo_1.bearingDeg)({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 1e-9);
});
(0, node_test_1.test)('bearing: due south = 180°', () => {
    approx((0, geo_1.bearingDeg)({ lat: 1, lon: 0 }, { lat: 0, lon: 0 }), 180, 1e-9);
});
(0, node_test_1.test)('bearing: due west = 270°', () => {
    approx((0, geo_1.bearingDeg)({ lat: 0, lon: 1 }, { lat: 0, lon: 0 }), 270, 1e-9);
});
// ── angleDelta ──────────────────────────────────────────────
(0, node_test_1.test)('angleDelta: basic and wraparound', () => {
    strict_1.default.equal((0, geo_1.angleDeltaDeg)(10, 20), 10);
    strict_1.default.equal((0, geo_1.angleDeltaDeg)(350, 10), 20); // wraps through 0
    strict_1.default.equal((0, geo_1.angleDeltaDeg)(0, 180), 180);
    strict_1.default.equal((0, geo_1.angleDeltaDeg)(90, 270), 180);
    strict_1.default.equal((0, geo_1.angleDeltaDeg)(45, 45), 0);
    strict_1.default.equal((0, geo_1.angleDeltaDeg)(359, 1), 2);
});
// ── destinationPoint (roundtrip properties) ─────────────────
(0, node_test_1.test)('destination: roundtrip distance and bearing', () => {
    for (const brg of [0, 45, 137, 233, 359]) {
        const dest = (0, geo_1.destinationPoint)(MUC, brg, 500);
        approx((0, geo_1.haversineMeters)(MUC, dest), 500, 0.01, `distance for bearing ${brg}`);
        // Compare angles wraparound-aware (359.9999° ≡ 0°)
        approx((0, geo_1.angleDeltaDeg)((0, geo_1.bearingDeg)(MUC, dest), brg), 0, 0.01, `bearing for ${brg}`);
    }
});
// ── polygon: 100m square around MUC ─────────────────────────
function squareAround(center, halfSideM) {
    // Build via destination points: NE, SE, SW, NW corners
    const n = (0, geo_1.destinationPoint)(center, 0, halfSideM);
    const s = (0, geo_1.destinationPoint)(center, 180, halfSideM);
    const ne = (0, geo_1.destinationPoint)(n, 90, halfSideM);
    const nw = (0, geo_1.destinationPoint)(n, 270, halfSideM);
    const se = (0, geo_1.destinationPoint)(s, 90, halfSideM);
    const sw = (0, geo_1.destinationPoint)(s, 270, halfSideM);
    return [ne, se, sw, nw];
}
(0, node_test_1.test)('pointInPolygon: center inside, far point outside', () => {
    const sq = squareAround(MUC, 50); // 100×100 m
    strict_1.default.equal((0, geo_1.pointInPolygon)(MUC, sq), true);
    const far = (0, geo_1.destinationPoint)(MUC, 90, 500);
    strict_1.default.equal((0, geo_1.pointInPolygon)(far, sq), false);
});
(0, node_test_1.test)('pointInPolygon: just inside / just outside the edge', () => {
    const sq = squareAround(MUC, 50);
    const nearInside = (0, geo_1.destinationPoint)(MUC, 0, 48); // 2m inside north edge
    const nearOutside = (0, geo_1.destinationPoint)(MUC, 0, 52); // 2m outside
    strict_1.default.equal((0, geo_1.pointInPolygon)(nearInside, sq), true);
    strict_1.default.equal((0, geo_1.pointInPolygon)(nearOutside, sq), false);
});
(0, node_test_1.test)('polygonArea: 100×100m square ≈ 10,000 m²', () => {
    const sq = squareAround(MUC, 50);
    approx((0, geo_1.polygonAreaM2)(sq), 10000, 30); // <0.3% projection error
});
(0, node_test_1.test)('polygonArea: vertex order independent', () => {
    const sq = squareAround(MUC, 50);
    const rev = [...sq].reverse();
    approx((0, geo_1.polygonAreaM2)(sq), (0, geo_1.polygonAreaM2)(rev), 1e-6);
});
(0, node_test_1.test)('distanceToPolygonEdge: center of 100m square = 50m', () => {
    const sq = squareAround(MUC, 50);
    approx((0, geo_1.distanceToPolygonEdgeM)(MUC, sq), 50, 0.5);
});
(0, node_test_1.test)('distanceToPolygonEdge: outside point', () => {
    const sq = squareAround(MUC, 50);
    const out = (0, geo_1.destinationPoint)(MUC, 0, 80); // 30m past north edge
    approx((0, geo_1.distanceToPolygonEdgeM)(out, sq), 30, 0.5);
});
// ── self-intersection ───────────────────────────────────────
(0, node_test_1.test)('selfIntersecting: square is fine, bowtie is not', () => {
    const sq = squareAround(MUC, 50);
    strict_1.default.equal((0, geo_1.isSelfIntersecting)(sq), false);
    // Bowtie: swap two vertices so edges cross
    const bowtie = [sq[0], sq[1], sq[3], sq[2]];
    strict_1.default.equal((0, geo_1.isSelfIntersecting)(bowtie), true);
});
(0, node_test_1.test)('selfIntersecting: triangle can never self-intersect', () => {
    const tri = [
        MUC,
        (0, geo_1.destinationPoint)(MUC, 90, 100),
        (0, geo_1.destinationPoint)(MUC, 0, 100),
    ];
    strict_1.default.equal((0, geo_1.isSelfIntersecting)(tri), false);
});
